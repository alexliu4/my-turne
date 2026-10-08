use anyhow::{bail, Context, Result};
use std::net::SocketAddr;
use tokio::io::copy_bidirectional;
use tokio::net::{TcpListener, TcpStream};
use tokio::time::{timeout, Duration};
use tracing::{info, warn};

fn addresses() -> Result<(SocketAddr, SocketAddr)> {
    let mut bind = None;
    let mut target = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--bind" => {
                bind = Some(args.next().context("--bind requires an IP:port")?.parse()?);
            }
            "--target" => {
                target = Some(args.next().context("--target requires an IP:port")?.parse()?);
            }
            _ => bail!("unknown argument: {arg}"),
        }
    }
    Ok((
        bind.context("--bind <mac-ip:port> is required")?,
        target.context("--target <windows-ip:port> is required")?,
    ))
}

async fn forward(mut client: TcpStream, peer: SocketAddr, target: SocketAddr) -> Result<(u64, u64)> {
    let mut server = timeout(Duration::from_secs(5), TcpStream::connect(target))
        .await
        .context("target connection timed out")?
        .with_context(|| format!("connecting to {target}"))?;
    info!("{peer} connected to {target}");
    copy_bidirectional(&mut client, &mut server)
        .await
        .context("forwarding TCP connection")
}

async fn serve(listener: TcpListener, target: SocketAddr) -> Result<()> {
    info!(
        "TCP proxy listening on {} and forwarding to {target}",
        listener.local_addr()?
    );
    loop {
        let (client, peer) = listener.accept().await?;
        tokio::spawn(async move {
            match forward(client, peer, target).await {
                Ok((up, down)) => info!(
                    "{peer} disconnected ({up} bytes to target, {down} bytes to client)"
                ),
                Err(error) => warn!("{peer} connection failed: {error:#}"),
            }
        });
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let (bind, target) = addresses()?;
    let listener = TcpListener::bind(bind).await?;
    serve(listener, target).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test]
    async fn forwards_bytes_in_both_directions() -> Result<()> {
        let target = TcpListener::bind("127.0.0.1:0").await?;
        let proxy = TcpListener::bind("127.0.0.1:0").await?;
        let proxy_addr = proxy.local_addr()?;
        let task = tokio::spawn(serve(proxy, target.local_addr()?));

        timeout(Duration::from_secs(2), async {
            let mut client = TcpStream::connect(proxy_addr).await?;
            let (mut server, _) = target.accept().await?;
            client.write_all(b"client bytes").await?;
            let mut received = [0; 12];
            server.read_exact(&mut received).await?;
            assert_eq!(&received, b"client bytes");
            server.write_all(b"server bytes").await?;
            let mut received = [0; 12];
            client.read_exact(&mut received).await?;
            assert_eq!(&received, b"server bytes");
            Ok::<_, anyhow::Error>(())
        })
        .await??;
        task.abort();
        Ok(())
    }

    #[tokio::test]
    async fn unavailable_target_does_not_stop_listener() -> Result<()> {
        let target = TcpListener::bind("127.0.0.1:0").await?;
        let target_addr = target.local_addr()?;
        drop(target);
        let proxy = TcpListener::bind("127.0.0.1:0").await?;
        let proxy_addr = proxy.local_addr()?;
        let task = tokio::spawn(serve(proxy, target_addr));

        timeout(Duration::from_secs(2), async {
            let mut client = TcpStream::connect(proxy_addr).await?;
            let mut byte = [0];
            assert_eq!(client.read(&mut byte).await?, 0);
            let target = TcpListener::bind(target_addr).await?;
            let _client = TcpStream::connect(proxy_addr).await?;
            let _server = target.accept().await?;
            Ok::<_, anyhow::Error>(())
        })
        .await??;
        assert!(!task.is_finished());
        task.abort();
        Ok(())
    }
}
