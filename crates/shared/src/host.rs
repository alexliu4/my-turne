use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;
use typeshare::typeshare;

#[typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "host.ts")]
pub enum HostCapability {
    Media,
    Volume,
    Discord,
    SystemStats,
    Macros,
    AppLaunch,
}

#[typeshare]
#[serde_with::skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "host.ts")]
pub struct HostHello {
    pub protocol_version: u32,
    pub host_name: String,
    pub capabilities: Vec<HostCapability>,
}

#[typeshare]
#[serde_with::skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "host.ts")]
pub struct HostStatus {
    pub connected: bool,
}

#[typeshare]
#[serde_with::skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "host.ts")]
pub struct HostAction {
    pub request_id: String,
    pub action: String,
    #[ts(optional, type = "unknown")]
    pub payload: Option<Value>,
}

#[typeshare]
#[serde_with::skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "host.ts")]
pub struct HostActionResult {
    pub request_id: String,
    pub success: bool,
    #[ts(optional, type = "unknown")]
    pub payload: Option<Value>,
    #[ts(optional)]
    pub error: Option<String>,
}

#[typeshare]
#[serde_with::skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[serde(tag = "type")]
#[ts(export, export_to = "host.ts")]
pub enum HostMessage {
    #[serde(rename = "host.hello")]
    Hello(HostHello),
    #[serde(rename = "host.status")]
    Status(HostStatus),
    #[serde(rename = "host.action")]
    Action(HostAction),
    #[serde(rename = "host.actionResult")]
    ActionResult(HostActionResult),
    #[serde(rename = "host.ping")]
    Ping,
    #[serde(rename = "host.pong")]
    Pong,
    #[serde(other)]
    Unknown,
}
