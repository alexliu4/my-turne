mod volume;

use anyhow::{bail, Context, Result};
use futures::{SinkExt, StreamExt};
use libnocturne::{HostAction, HostActionResult, HostCapability, HostHello, HostMessage, HostStatus};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::accept_hdr_async;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::Message;
use tracing::{info, warn};
use volume::{VolumeManager, VolumeStatePayload};

pub struct CompanionConfig {
    pub bind_addr: SocketAddr,
    pub auth_token: Option<String>,
    pub host_name: String,
    pub capabilities: Vec<HostCapability>,
    pub protocol_version: u32,
}

impl Default for CompanionConfig {
    fn default() -> Self {
        let host_name = std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "Windows-PC".to_string());

        Self {
            bind_addr: "127.0.0.1:8893".parse().unwrap(),
            auth_token: None,
            host_name,
            capabilities: vec![HostCapability::Volume],
            protocol_version: 1,
        }
    }
}

pub struct CompanionServer {
    config: Arc<CompanionConfig>,
    volume_mgr: Option<Arc<VolumeManager>>,
    volume_rx: broadcast::Sender<VolumeStatePayload>,
}

impl CompanionServer {
    pub fn new(mut config: CompanionConfig) -> Self {
        let (tx_chan, _) = broadcast::channel(16);
        let (volume_mgr, capabilities) = match VolumeManager::try_new_auto() {
            Ok((mgr, rx)) => {
                let tx_clone = tx_chan.clone();
                let mut rx_event = rx;
                tokio::spawn(async move {
                    loop {
                        match rx_event.recv().await {
                            Ok(state) => {
                                let _ = tx_clone.send(state);
                            }
                            Err(broadcast::error::RecvError::Lagged(_)) => continue,
                            Err(broadcast::error::RecvError::Closed) => break,
                        }
                    }
                });
                (Some(Arc::new(mgr)), config.capabilities.clone())
            }
            Err(err) => {
                warn!("Volume backend initialization failed; volume capability disabled: {err}");
                let caps: Vec<HostCapability> = config
                    .capabilities
                    .into_iter()
                    .filter(|c| *c != HostCapability::Volume)
                    .collect();
                (None, caps)
            }
        };

        config.capabilities = capabilities;

        Self {
            config: Arc::new(config),
            volume_mgr,
            volume_rx: tx_chan,
        }
    }

    pub fn new_with_mock(
        config: CompanionConfig,
        volume_mgr: VolumeManager,
        rx: broadcast::Receiver<VolumeStatePayload>,
    ) -> (Self, Arc<VolumeManager>) {
        let (tx_chan, _) = broadcast::channel(16);
        let tx_clone = tx_chan.clone();
        let mut rx_event = rx;
        tokio::spawn(async move {
            loop {
                match rx_event.recv().await {
                    Ok(state) => {
                        let _ = tx_clone.send(state);
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });

        let mgr_arc = Arc::new(volume_mgr);
        let server = Self {
            config: Arc::new(config),
            volume_mgr: Some(mgr_arc.clone()),
            volume_rx: tx_chan,
        };
        (server, mgr_arc)
    }

    pub async fn run(&self) -> Result<()> {
        if !self.config.bind_addr.ip().is_loopback()
            && self.config.auth_token.as_deref().is_none_or(str::is_empty)
        {
            bail!(
                "Refusing to bind to non-loopback address {} without an authentication token (--token or NOCTURNE_AUTH_TOKEN)",
                self.config.bind_addr
            );
        }

        let listener = TcpListener::bind(self.config.bind_addr).await?;
        info!("Windows Companion WebSocket server listening on {}", self.config.bind_addr);

        loop {
            let (stream, peer_addr) = listener.accept().await?;
            info!("Incoming connection from {}", peer_addr);
            let config = Arc::clone(&self.config);
            let volume_mgr = self.volume_mgr.clone();
            let volume_sub = self.volume_rx.subscribe();

            tokio::spawn(async move {
                if let Err(e) = handle_connection(stream, peer_addr, config, volume_mgr, volume_sub).await {
                    warn!("Connection error with {}: {:?}", peer_addr, e);
                }
            });
        }
    }
}

pub async fn handle_connection(
    stream: TcpStream,
    peer_addr: SocketAddr,
    config: Arc<CompanionConfig>,
    volume_mgr: Option<Arc<VolumeManager>>,
    mut volume_sub: broadcast::Receiver<VolumeStatePayload>,
) -> Result<()> {
    let mut authed = config.auth_token.is_none();
    let token_expected = config.auth_token.clone();

    let callback =
        |req: &Request, response: Response| -> std::result::Result<Response, ErrorResponse> {
        if let Some(expected_token) = &token_expected {
            if let Some(auth_hdr) = req.headers().get("authorization") {
                if let Ok(auth_str) = auth_hdr.to_str() {
                    if auth_str.strip_prefix("Bearer ") == Some(expected_token.as_str()) {
                        authed = true;
                    }
                }
            }
            if let Some(query) = req.uri().query() {
                authed |= url::form_urlencoded::parse(query.as_bytes()).any(|(key, value)| {
                    key == "token" && value.as_ref() == expected_token.as_str()
                });
            }
        }
        Ok(response)
    };

    let mut ws_stream = accept_hdr_async(stream, callback).await?;

    if !authed {
        warn!("Unauthorized connection attempt from {}", peer_addr);
        let err_msg = HostMessage::Status(HostStatus { connected: false });
        let err_json = serde_json::to_string(&err_msg)?;
        let _ = ws_stream.send(Message::Text(err_json.into())).await;
        let _ = ws_stream.close(None).await;
        return Ok(());
    }

    let client_hello = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            match ws_stream.next().await {
                Some(Ok(Message::Text(text))) => {
                    break serde_json::from_str::<HostMessage>(&text).ok()
                }
                Some(Ok(Message::Ping(payload))) => {
                    if ws_stream.send(Message::Pong(payload)).await.is_err() {
                        break None;
                    }
                }
                _ => break None,
            }
        }
    })
    .await
    .ok()
    .flatten();

    match client_hello {
        Some(HostMessage::Hello(hello)) if hello.protocol_version == config.protocol_version => {}
        _ => {
            warn!("Invalid or incompatible client hello from {}", peer_addr);
            let _ = ws_stream.close(None).await;
            return Ok(());
        }
    }
    info!("Client {} connected and authenticated", peer_addr);

    let hello = HostMessage::Hello(HostHello {
        protocol_version: config.protocol_version,
        host_name: config.host_name.clone(),
        capabilities: config.capabilities.clone(),
    });
    ws_stream.send(Message::Text(serde_json::to_string(&hello)?.into())).await?;

    // Send initial volume state if capability enabled and volume_mgr present
    if config.capabilities.contains(&HostCapability::Volume) {
        if let Some(ref mgr) = volume_mgr {
            if let Ok(initial_vol) = mgr.get_state() {
                let initial_vol_event = HostMessage::Action(HostAction {
                    request_id: "init".to_string(),
                    action: "volume.state".to_string(),
                    payload: Some(initial_vol.to_json()),
                });
                if let Ok(json) = serde_json::to_string(&initial_vol_event) {
                    let _ = ws_stream.send(Message::Text(json.into())).await;
                }
            }
        }
    }

    loop {
        tokio::select! {
            ext_vol = volume_sub.recv() => {
                match ext_vol {
                    Ok(new_state) => {
                        let event = HostMessage::Action(HostAction {
                            request_id: "ext".to_string(),
                            action: "volume.state".to_string(),
                            payload: Some(new_state.to_json()),
                        });
                        if let Ok(json) = serde_json::to_string(&event) {
                            if ws_stream.send(Message::Text(json.into())).await.is_err() {
                                break;
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            msg = ws_stream.next() => {
                let msg = match msg {
                    Some(Ok(m)) => m,
                    _ => break,
                };

                match msg {
                    Message::Text(text) => {
                        match serde_json::from_str::<HostMessage>(&text) {
                            Ok(HostMessage::Hello(_)) => {
                                warn!("Unexpected duplicate client hello from {}", peer_addr);
                                break;
                            }
                            Ok(HostMessage::Ping) => {
                                let pong = HostMessage::Pong;
                                if let Ok(json) = serde_json::to_string(&pong) {
                                    if ws_stream.send(Message::Text(json.into())).await.is_err() {
                                        break;
                                    }
                                }
                            }
                            Ok(HostMessage::Action(action)) => {
                                if action.action.starts_with("volume.") {
                                    if let Some(ref mgr) = volume_mgr {
                                        match mgr.handle_action(&action.action, action.payload.as_ref()) {
                                            Ok(new_state) => {
                                                let state_value = new_state.to_json();
                                                let result = HostMessage::ActionResult(HostActionResult {
                                                    request_id: action.request_id,
                                                    success: true,
                                                    payload: Some(state_value),
                                                    error: None,
                                                });
                                                if let Ok(json) = serde_json::to_string(&result) {
                                                    if ws_stream.send(Message::Text(json.into())).await.is_err() {
                                                        break;
                                                    }
                                                }
                                            }
                                            Err(err_msg) => {
                                                let result = HostMessage::ActionResult(HostActionResult {
                                                    request_id: action.request_id,
                                                    success: false,
                                                    payload: None,
                                                    error: Some(err_msg),
                                                });
                                                if let Ok(json) = serde_json::to_string(&result) {
                                                    if ws_stream.send(Message::Text(json.into())).await.is_err() {
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                    } else {
                                        let result = HostMessage::ActionResult(HostActionResult {
                                            request_id: action.request_id,
                                            success: false,
                                            payload: None,
                                            error: Some("Volume capability unavailable".to_string()),
                                        });
                                        if let Ok(json) = serde_json::to_string(&result) {
                                            if ws_stream.send(Message::Text(json.into())).await.is_err() {
                                                break;
                                            }
                                        }
                                    }
                                } else {
                                    warn!("Ignoring unsupported host action '{}' from {}", action.action, peer_addr);
                                }
                            }
                            Ok(HostMessage::Status(status)) => {
                                info!("Received host status update: connected={}", status.connected);
                            }
                            _ => {}
                        }
                    }
                    Message::Close(_) => {
                        info!("Client {} closed connection", peer_addr);
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    info!("Client {} disconnected", peer_addr);
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    info!("Starting Nocturne Windows Companion");

    let mut bind_host = std::env::var("NOCTURNE_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let mut bind_port: u16 = std::env::var("NOCTURNE_PORT")
        .ok()
        .map(|port| port.parse())
        .transpose()?
        .unwrap_or(8893);
    let mut auth_token = std::env::var("NOCTURNE_AUTH_TOKEN").ok();

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--host" => bind_host = args.next().context("--host requires an address")?,
            "--port" => bind_port = args.next().context("--port requires a number")?.parse()?,
            "--token" => auth_token = Some(args.next().context("--token requires a value")?),
            _ => bail!("Unknown argument: {arg}"),
        }
    }

    let bind_addr: SocketAddr = format!("{}:{}", bind_host, bind_port).parse()?;
    let config = CompanionConfig {
        bind_addr,
        auth_token,
        ..Default::default()
    };

    let server = CompanionServer::new(config);
    server.run().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_tungstenite::connect_async;

    #[tokio::test]
    async fn test_companion_server_handshake() -> Result<()> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;
        let config = CompanionConfig {
            bind_addr: addr,
            auth_token: None,
            host_name: "Test-PC".to_string(),
            capabilities: vec![HostCapability::Volume],
            protocol_version: 1,
        };
        let (volume_mgr, rx) = VolumeManager::new_mock(50, false);
        let (server, _mgr) = CompanionServer::new_with_mock(config, volume_mgr, rx);

        tokio::spawn(async move {
            let _ = server.run().await;
        });

        let url = format!("ws://{}", addr);
        let (mut ws_stream, _) = connect_async(&url).await?;

        let client_hello = HostMessage::Hello(HostHello {
            protocol_version: 1,
            host_name: "CarThing".to_string(),
            capabilities: vec![],
        });
        ws_stream
            .send(Message::Text(serde_json::to_string(&client_hello)?.into()))
            .await?;

        if let Some(Ok(Message::Text(text))) = ws_stream.next().await {
            let msg: HostMessage = serde_json::from_str(&text)?;
            if let HostMessage::Hello(hello) = msg {
                assert_eq!(hello.host_name, "Test-PC");
                assert_eq!(hello.capabilities, vec![HostCapability::Volume]);
            } else {
                panic!("Expected HostMessage::Hello");
            }
        }

        // Initial volume event
        if let Some(Ok(Message::Text(text))) = ws_stream.next().await {
            let msg: HostMessage = serde_json::from_str(&text)?;
            if let HostMessage::Action(action) = msg {
                assert_eq!(action.action, "volume.state");
            } else {
                panic!("Expected volume.state action");
            }
        }

        ws_stream.close(None).await?;
        Ok(())
    }

    #[tokio::test]
    async fn test_volume_broadcast_propagation() -> Result<()> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;

        let (volume_mgr, rx) = VolumeManager::new_mock(50, false);
        let config = CompanionConfig {
            bind_addr: addr,
            auth_token: None,
            host_name: "Test-PC".to_string(),
            capabilities: vec![HostCapability::Volume],
            protocol_version: 1,
        };
        let (server, mgr_arc) = CompanionServer::new_with_mock(config, volume_mgr, rx);

        tokio::spawn(async move {
            let _ = server.run().await;
        });

        let url = format!("ws://{}", addr);
        let (mut ws_stream, _) = connect_async(&url).await?;

        let client_hello = HostMessage::Hello(HostHello {
            protocol_version: 1,
            host_name: "CarThing".to_string(),
            capabilities: vec![],
        });
        ws_stream
            .send(Message::Text(serde_json::to_string(&client_hello)?.into()))
            .await?;

        // Read hello and initial volume state
        let _hello = ws_stream.next().await;
        let _init_vol = ws_stream.next().await;

        // Trigger volume action on volume_mgr to exercise the actual forwarding channel
        let _ = mgr_arc.handle_action("volume.set", Some(&serde_json::json!({ "volumePercent": 88 })));

        // Verify WebSocket client receives volume.state update via the forwarding path
        if let Some(Ok(Message::Text(text))) = ws_stream.next().await {
            let msg: HostMessage = serde_json::from_str(&text)?;
            if let HostMessage::Action(action) = msg {
                assert_eq!(action.action, "volume.state");
                let payload = action.payload.unwrap();
                assert_eq!(payload["volumePercent"], 88);
            } else {
                panic!("Expected volume.state broadcast message");
            }
        } else {
            panic!("Expected WebSocket text message");
        }

        ws_stream.close(None).await?;
        Ok(())
    }

    #[tokio::test]
    async fn test_companion_server_auth_failure() -> Result<()> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;

        let config = CompanionConfig {
            bind_addr: addr,
            auth_token: Some("secret123".to_string()),
            host_name: "Test-PC".to_string(),
            capabilities: vec![],
            protocol_version: 1,
        };
        let (volume_mgr, rx) = VolumeManager::new_mock(50, false);
        let (server, _mgr) = CompanionServer::new_with_mock(config, volume_mgr, rx);

        tokio::spawn(async move {
            let _ = server.run().await;
        });

        let url = format!("ws://{}", addr);
        let (mut ws_stream, _) = connect_async(&url).await?;

        if let Some(Ok(Message::Text(text))) = ws_stream.next().await {
            let msg: HostMessage = serde_json::from_str(&text)?;
            if let HostMessage::Status(status) = msg {
                assert!(!status.connected);
            } else {
                panic!("Expected status.connected = false");
            }
        }

        Ok(())
    }

    #[tokio::test]
    async fn test_lan_binding_without_token_fails() {
        let config = CompanionConfig {
            bind_addr: "0.0.0.0:0".parse().unwrap(),
            auth_token: None,
            ..Default::default()
        };
        let server = CompanionServer::new(config);
        assert!(server.run().await.is_err());
    }

    #[tokio::test]
    async fn test_lan_binding_with_empty_token_fails() {
        let config = CompanionConfig {
            bind_addr: "0.0.0.0:0".parse().unwrap(),
            auth_token: Some(String::new()),
            ..Default::default()
        };
        assert!(CompanionServer::new(config).run().await.is_err());
    }

    #[tokio::test]
    async fn test_encoded_token_and_protocol_mismatch() -> Result<()> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;
        let config = CompanionConfig {
            bind_addr: addr,
            auth_token: Some("a+b &/%".to_string()),
            host_name: "Test-PC".to_string(),
            capabilities: vec![],
            protocol_version: 1,
        };
        let (volume_mgr, rx) = VolumeManager::new_mock(50, false);
        let (server, _mgr) = CompanionServer::new_with_mock(config, volume_mgr, rx);

        tokio::spawn(async move {
            let _ = server.run().await;
        });

        let url = format!("ws://{addr}/?token=a%2Bb+%26%2F%25");
        let (mut ws, _) = connect_async(&url).await?;
        let incompatible_hello = HostMessage::Hello(HostHello {
            protocol_version: 2,
            host_name: "CarThing".to_string(),
            capabilities: vec![],
        });
        ws.send(Message::Text(serde_json::to_string(&incompatible_hello)?.into()))
            .await?;
        assert!(matches!(ws.next().await, Some(Ok(Message::Close(_)))));

        Ok(())
    }
}
