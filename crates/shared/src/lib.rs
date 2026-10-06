mod host;
mod shared;

pub mod client;
pub mod gateway;
pub mod generated;
pub use host::*;

#[cfg(feature = "protocol")]
pub mod protocol;

pub use shared::{
    OtaError, OtaErrorCode, OtaKind, OtaPhase, OtaProgress, Priority, RangePart, RangeSpec,
};

pub const NOCTURNE_WS_CLIENT_PORT: u16 = 5000;
pub const NOCTURNE_WEBAPP_HTTP_PORT: u16 = 8080;
pub const NOCTURNE_GATEWAY_NETWORK_PORT: u16 = 8892;
