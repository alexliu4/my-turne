mod volume;

use anyhow::{bail, Context, Result};
use futures::{SinkExt, StreamExt};
use libnocturne::{HostAction, HostActionResult, HostCapability, HostHello, HostMessage, HostStatus};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::accept_hdr_async;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::Message;
use tracing::{info, warn};
use volume::VolumeManager;

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
    volume_mgr: Arc<VolumeManager>,
}

impl CompanionServer {
    pub fn new(config: CompanionConfig) -> Self {
        Self {
            config: Arc::new(config),
            volume_mgr: Arc::new(VolumeManager::default()),
        }
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
            let volume_mgr = Arc::clone(&self.volume_mgr);

            tokio::spawn(async move {
                if let Err(e) = handle_connection(stream, peer_addr, config, volume_mgr).await {
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
    volume_mgr: Arc<VolumeManager>,
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

    // Require the client to prove protocol compatibility before announcing availability.
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
    let hello_json = serde_json::to_string(&hello)?;
    ws_stream.send(Message::Text(hello_json.into())).await?;

    // Send initial volume state event if Volume capability enabled
    if config.capabilities.contains(&HostCapability::Volume) {
        let initial_vol = volume_mgr.get_state();
        let initial_vol_event = HostMessage::Action(HostAction {
            request_id: "init".to_string(),
            action: "volume.state".to_string(),
            payload: Some(initial_vol.to_json()),
        });
        let vol_json = serde_json::to_string(&initial_vol_event)?;
        ws_stream.send(Message::Text(vol_json.into())).await?;
    }

    while let Some(msg) = ws_stream.next().await {
        let msg = msg?;
        match msg {
            Message::Text(text) => {
                match serde_json::from_str::<HostMessage>(&text) {
                    Ok(HostMessage::Hello(_)) => {
                        warn!("Unexpected duplicate client hello from {}", peer_addr);
                        let _ = ws_stream.close(None).await;
                        return Ok(());
                    }
                    Ok(HostMessage::Ping) => {
                        let pong = HostMessage::Pong;
                        let pong_json = serde_json::to_string(&pong)?;
                        ws_stream.send(Message::Text(pong_json.into())).await?;
                    }
                    Ok(HostMessage::Action(action)) => {
                        if action.action.starts_with("volume.") {
                            match volume_mgr.handle_action(&action.action, action.payload.as_ref()) {
                                Ok(new_state) => {
                                    let state_value = new_state.to_json();
                                    let result = HostMessage::ActionResult(HostActionResult {
                                        request_id: action.request_id.clone(),
                                        success: true,
                                        payload: Some(state_value.clone()),
                                        error: None,
                                    });
                                    ws_stream.send(Message::Text(serde_json::to_string(&result)?.into())).await?;

                                    // Broadcast updated state event
                                    let state_event = HostMessage::Action(HostAction {
                                        request_id: action.request_id,
                                        action: "volume.state".to_string(),
                                        payload: Some(state_value),
                                    });
                                    ws_stream.send(Message::Text(serde_json::to_string(&state_event)?.into())).await?;
                                }
                                Err(err_msg) => {
                                    let result = HostMessage::ActionResult(HostActionResult {
                                        request_id: action.request_id,
                                        success: false,
                                        payload: None,
                                        error: Some(err_msg),
                                    });
                                    ws_stream.send(Message::Text(serde_json::to_string(&result)?.into())).await?;
                                }
                            }
                        } else {
                            warn!("Ignoring unsupported host action '{}' from {}", action.action, peer_addr);
                            let result = HostMessage::ActionResult(HostActionResult {
                                request_id: action.request_id,
                                success: false,
                                payload: None,
                                error: Some(format!("Unsupported action: {}", action.action)),
                            });
                            ws_stream.send(Message::Text(serde_json::to_string(&result)?.into())).await?;
                        }
                    }
                    Ok(HostMessage::Status(status)) => {
                        info!("Received host status update: connected={}", status.connected);
                    }
                    Ok(HostMessage::Pong) | Ok(HostMessage::ActionResult(_)) => {}
                    Ok(HostMessage::Unknown) | Err(_) => {
                        warn!("Received unknown or malformed host message from {}", peer_addr);
                    }
                }
            }
            Message::Ping(payload) => {
                ws_stream.send(Message::Pong(payload)).await?;
            }
            Message::Close(_) => {
                info!("Client {} closed connection", peer_addr);
                break;
            }
            _ => {}
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

        let config = Arc::new(CompanionConfig {
            bind_addr: addr,
            auth_token: None,
            host_name: "Test-PC".to_string(),
            capabilities: vec![HostCapability::Volume],
            protocol_version: 1,
        });
        let volume_mgr = Arc::new(VolumeManager::default());

        tokio::spawn(async move {
            if let Ok((stream, peer_addr)) = listener.accept().await {
                let _ = handle_connection(stream, peer_addr, config, volume_mgr).await;
            }
        });

        let url = format!("ws://{}", addr);
        let (mut ws_stream, _) = connect_async(&url).await?;
        assert!(tokio::time::timeout(Duration::from_millis(20), ws_stream.next())
            .await
            .is_err());
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
                assert_eq!(hello.protocol_version, 1);
                assert_eq!(hello.capabilities, vec![HostCapability::Volume]);
            } else {
                panic!("Expected HostMessage::Hello");
            }
        } else {
            panic!("Expected text message");
        }

        // Initial volume event
        if let Some(Ok(Message::Text(text))) = ws_stream.next().await {
            let msg: HostMessage = serde_json::from_str(&text)?;
            if let HostMessage::Action(action) = msg {
                assert_eq!(action.action, "volume.state");
            } else {
                panic!("Expected volume.state initial action event");
            }
        } else {
            panic!("Expected text message");
        }

        // Test host.ping -> host.pong
        let ping = HostMessage::Ping;
        let ping_json = serde_json::to_string(&ping)?;
        ws_stream.send(Message::Text(ping_json.into())).await?;

        if let Some(Ok(Message::Text(text))) = ws_stream.next().await {
            let msg: HostMessage = serde_json::from_str(&text)?;
            assert_eq!(msg, HostMessage::Pong);
        } else {
            panic!("Expected host.pong");
        }

        ws_stream.close(None).await?;
        Ok(())
    }

    #[tokio::test]
    async fn test_companion_volume_action() -> Result<()> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;

        let config = Arc::new(CompanionConfig {
            bind_addr: addr,
            auth_token: None,
            host_name: "Test-PC".to_string(),
            capabilities: vec![HostCapability::Volume],
            protocol_version: 1,
        });
        let volume_mgr = Arc::new(VolumeManager::new(50, false));

        tokio::spawn(async move {
            if let Ok((stream, peer_addr)) = listener.accept().await {
                let _ = handle_connection(stream, peer_addr, config, volume_mgr).await;
            }
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

        let _hello = ws_stream.next().await;
        let _init_vol = ws_stream.next().await;

        // Send volume.set action
        let set_action = HostMessage::Action(HostAction {
            request_id: "req1".to_string(),
            action: "volume.set".to_string(),
            payload: Some(serde_json::json!({ "volume": 85 })),
        });
        ws_stream.send(Message::Text(serde_json::to_string(&set_action)?.into())).await?;

        // Should receive ActionResult
        if let Some(Ok(Message::Text(text))) = ws_stream.next().await {
            let msg: HostMessage = serde_json::from_str(&text)?;
            if let HostMessage::ActionResult(res) = msg {
                assert_eq!(res.request_id, "req1");
                assert!(res.success);
            } else {
                panic!("Expected HostMessage::ActionResult");
            }
        }

        // Should receive volume.state broadcast
        if let Some(Ok(Message::Text(text))) = ws_stream.next().await {
            let msg: HostMessage = serde_json::from_str(&text)?;
            if let HostMessage::Action(action) = msg {
                assert_eq!(action.action, "volume.state");
                let payload = action.payload.unwrap();
                assert_eq!(payload["volume"], 85);
            } else {
                panic!("Expected volume.state broadcast");
            }
        }

        ws_stream.close(None).await?;
        Ok(())
    }

    #[tokio::test]
    async fn test_companion_server_auth_failure() -> Result<()> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;

        let config = Arc::new(CompanionConfig {
            bind_addr: addr,
            auth_token: Some("secret123".to_string()),
            host_name: "Test-PC".to_string(),
            capabilities: vec![],
            protocol_version: 1,
        });
        let volume_mgr = Arc::new(VolumeManager::default());

        tokio::spawn(async move {
            if let Ok((stream, peer_addr)) = listener.accept().await {
                let _ = handle_connection(stream, peer_addr, config, volume_mgr).await;
            }
        });

        let url = format!("ws://{}", addr);
        let (mut ws_stream, _) = connect_async(&url).await?;

        if let Some(Ok(Message::Text(text))) = ws_stream.next().await {
            let msg: HostMessage = serde_json::from_str(&text)?;
            if let HostMessage::Status(status) = msg {
                assert!(
                    !status.connected,
                    "Expected status.connected = false for unauthorized client"
                );
            } else {
                panic!("Expected HostMessage::Status error response for unauthorized client");
            }
        } else {
            panic!("Expected rejection message before close");
        }

        Ok(())
    }

    #[tokio::test]
    async fn test_lan_binding_without_token_fails() {
        let config = CompanionConfig {
            bind_addr: "0.0.0.0:8893".parse().unwrap(),
            auth_token: None,
            ..Default::default()
        };
        let server = CompanionServer::new(config);
        assert!(
            server.run().await.is_err(),
            "Non-loopback binding without token should be refused"
        );
    }

    #[tokio::test]
    async fn test_lan_binding_with_empty_token_fails() {
        let config = CompanionConfig {
            bind_addr: "0.0.0.0:8893".parse().unwrap(),
            auth_token: Some(String::new()),
            ..Default::default()
        };
        assert!(CompanionServer::new(config).run().await.is_err());
    }

    #[tokio::test]
    async fn test_encoded_token_and_protocol_mismatch() -> Result<()> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;
        let config = Arc::new(CompanionConfig {
            bind_addr: addr,
            auth_token: Some("a+b &/%".to_string()),
            host_name: "Test-PC".to_string(),
            capabilities: vec![],
            protocol_version: 1,
        });
        let volume_mgr = Arc::new(VolumeManager::default());
        tokio::spawn(async move {
            for _ in 0..2 {
                let (stream, peer_addr) = listener.accept().await.unwrap();
                let config = Arc::clone(&config);
                let volume_mgr = Arc::clone(&volume_mgr);
                tokio::spawn(async move {
                    let _ = handle_connection(stream, peer_addr, config, volume_mgr).await;
                });
            }
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

        let (mut ws, _) = connect_async(&url).await?;
        let compatible_hello = HostMessage::Hello(HostHello {
            protocol_version: 1,
            host_name: "CarThing".to_string(),
            capabilities: vec![],
        });
        ws.send(Message::Text(serde_json::to_string(&compatible_hello)?.into()))
            .await?;
        assert!(matches!(ws.next().await, Some(Ok(Message::Text(_)))));
        Ok(())
    }
}
