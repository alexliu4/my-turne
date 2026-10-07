use anyhow::Result;
use futures::{SinkExt, StreamExt};
use libnocturne::{HostCapability, HostHello, HostMessage, HostStatus};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::accept_hdr_async;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::Message;
use tracing::{info, warn};

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

        let host_str = std::env::var("NOCTURNE_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
        let port_str = std::env::var("NOCTURNE_PORT").unwrap_or_else(|_| "8893".to_string());
        let bind_addr: SocketAddr = format!("{}:{}", host_str, port_str)
            .parse()
            .unwrap_or_else(|_| "0.0.0.0:8893".parse().unwrap());

        let auth_token = std::env::var("NOCTURNE_AUTH_TOKEN").ok();

        Self {
            bind_addr,
            auth_token,
            host_name,
            capabilities: vec![
                HostCapability::Media,
                HostCapability::Volume,
                HostCapability::Discord,
                HostCapability::SystemStats,
                HostCapability::Macros,
                HostCapability::AppLaunch,
            ],
            protocol_version: 1,
        }
    }
}

pub struct CompanionServer {
    config: Arc<CompanionConfig>,
}

impl CompanionServer {
    pub fn new(config: CompanionConfig) -> Self {
        Self {
            config: Arc::new(config),
        }
    }

    pub async fn run(&self) -> Result<()> {
        let listener = TcpListener::bind(self.config.bind_addr).await?;
        info!("Windows Companion WebSocket server listening on {}", self.config.bind_addr);

        loop {
            let (stream, peer_addr) = listener.accept().await?;
            info!("Incoming connection from {}", peer_addr);
            let config = Arc::clone(&self.config);

            tokio::spawn(async move {
                if let Err(e) = handle_connection(stream, peer_addr, config).await {
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
) -> Result<()> {
    let mut authed = config.auth_token.is_none();
    let token_expected = config.auth_token.clone();

    let callback = |req: &Request, response: Response| -> std::result::Result<Response, tokio_tungstenite::tungstenite::handshake::server::ErrorResponse> {
        if let Some(expected_token) = &token_expected {
            if let Some(auth_hdr) = req.headers().get("authorization") {
                if let Ok(auth_str) = auth_hdr.to_str() {
                    let bearer_prefix = "Bearer ";
                    if auth_str.starts_with(bearer_prefix) && &auth_str[bearer_prefix.len()..] == expected_token {
                        authed = true;
                    }
                }
            } else if let Some(query) = req.uri().query() {
                for pair in query.split('&') {
                    let mut parts = pair.splitn(2, '=');
                    if let (Some(k), Some(v)) = (parts.next(), parts.next()) {
                        if k == "token" && v == expected_token {
                            authed = true;
                            break;
                        }
                    }
                }
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

    info!("Client {} connected and authenticated", peer_addr);

    // Send host.hello
    let hello = HostMessage::Hello(HostHello {
        protocol_version: config.protocol_version,
        host_name: config.host_name.clone(),
        capabilities: config.capabilities.clone(),
    });
    let hello_json = serde_json::to_string(&hello)?;
    ws_stream.send(Message::Text(hello_json.into())).await?;

    while let Some(msg) = ws_stream.next().await {
        let msg = msg?;
        match msg {
            Message::Text(text) => {
                match serde_json::from_str::<HostMessage>(&text) {
                    Ok(HostMessage::Hello(client_hello)) => {
                        info!(
                            "Received hello from client {}, protocol version: {}",
                            client_hello.host_name, client_hello.protocol_version
                        );
                        if client_hello.protocol_version != config.protocol_version {
                            warn!(
                                "Protocol version mismatch: host={}, client={}",
                                config.protocol_version, client_hello.protocol_version
                            );
                        }
                    }
                    Ok(HostMessage::Ping) => {
                        let pong = HostMessage::Pong;
                        let pong_json = serde_json::to_string(&pong)?;
                        ws_stream.send(Message::Text(pong_json.into())).await?;
                    }
                    Ok(HostMessage::Action(action)) => {
                        info!("Received host action: {}", action.action);
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

    let mut bind_host = std::env::var("NOCTURNE_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let mut bind_port: u16 = std::env::var("NOCTURNE_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8893);
    let mut auth_token = std::env::var("NOCTURNE_AUTH_TOKEN").ok();

    let args: Vec<String> = std::env::args().collect();
    for i in 0..args.len() {
        if args[i] == "--host" && i + 1 < args.len() {
            bind_host = args[i + 1].clone();
        } else if args[i] == "--port" && i + 1 < args.len() {
            if let Ok(p) = args[i + 1].parse() {
                bind_port = p;
            }
        } else if args[i] == "--token" && i + 1 < args.len() {
            auth_token = Some(args[i + 1].clone());
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
            capabilities: vec![HostCapability::Media, HostCapability::Volume],
            protocol_version: 1,
        });

        tokio::spawn(async move {
            if let Ok((stream, peer_addr)) = listener.accept().await {
                let _ = handle_connection(stream, peer_addr, config).await;
            }
        });

        let url = format!("ws://{}", addr);
        let (mut ws_stream, _) = connect_async(&url).await?;

        if let Some(Ok(Message::Text(text))) = ws_stream.next().await {
            let msg: HostMessage = serde_json::from_str(&text)?;
            if let HostMessage::Hello(hello) = msg {
                assert_eq!(hello.host_name, "Test-PC");
                assert_eq!(hello.protocol_version, 1);
                assert_eq!(hello.capabilities, vec![HostCapability::Media, HostCapability::Volume]);
            } else {
                panic!("Expected HostMessage::Hello");
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

        tokio::spawn(async move {
            if let Ok((stream, peer_addr)) = listener.accept().await {
                let _ = handle_connection(stream, peer_addr, config).await;
            }
        });

        let url = format!("ws://{}", addr);
        let (mut ws_stream, _) = connect_async(&url).await?;

        // Unauthorized connection should receive connected: false status then close
        if let Some(Ok(Message::Text(text))) = ws_stream.next().await {
            let msg: HostMessage = serde_json::from_str(&text)?;
            if let HostMessage::Status(status) = msg {
                assert!(!status.connected);
            }
        }

        Ok(())
    }
}
