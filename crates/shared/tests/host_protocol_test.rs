use libnocturne::*;
use serde_json::json;

#[test]
fn test_host_hello_serialization() {
    let hello = HostHello {
        protocol_version: 1,
        host_name: "DESKTOP-TEST".to_string(),
        capabilities: vec![
            HostCapability::Media,
            HostCapability::Volume,
            HostCapability::Discord,
        ],
    };

    let msg = HostMessage::Hello(hello);
    let serialized = serde_json::to_value(&msg).unwrap();

    assert_eq!(serialized["type"], "host.hello");
    assert_eq!(serialized["protocolVersion"], 1);
    assert_eq!(serialized["hostName"], "DESKTOP-TEST");
    assert_eq!(
        serialized["capabilities"],
        json!(["media", "volume", "discord"])
    );

    let deserialized: HostMessage = serde_json::from_value(serialized).unwrap();
    match deserialized {
        HostMessage::Hello(h) => {
            assert_eq!(h.protocol_version, 1);
            assert_eq!(h.host_name, "DESKTOP-TEST");
            assert_eq!(
                h.capabilities,
                vec![
                    HostCapability::Media,
                    HostCapability::Volume,
                    HostCapability::Discord
                ]
            );
        }
        _ => panic!("expected HostMessage::Hello"),
    }
}

#[test]
fn test_host_status_serialization() {
    let status = HostStatus { connected: true };
    let msg = HostMessage::Status(status);
    let serialized = serde_json::to_value(&msg).unwrap();

    assert_eq!(serialized["type"], "host.status");
    assert_eq!(serialized["connected"], true);

    let deserialized: HostMessage = serde_json::from_value(serialized).unwrap();
    match deserialized {
        HostMessage::Status(s) => {
            assert!(s.connected);
        }
        _ => panic!("expected HostMessage::Status"),
    }
}

#[test]
fn test_host_action_serialization() {
    let action = HostAction {
        request_id: "req-123".to_string(),
        action: "volume.set".to_string(),
        payload: Some(json!({ "value": 80 })),
    };
    let msg = HostMessage::Action(action);
    let serialized = serde_json::to_value(&msg).unwrap();

    assert_eq!(serialized["type"], "host.action");
    assert_eq!(serialized["requestId"], "req-123");
    assert_eq!(serialized["action"], "volume.set");
    assert_eq!(serialized["payload"], json!({ "value": 80 }));

    let deserialized: HostMessage = serde_json::from_value(serialized).unwrap();
    match deserialized {
        HostMessage::Action(a) => {
            assert_eq!(a.request_id, "req-123");
            assert_eq!(a.action, "volume.set");
            assert_eq!(a.payload, Some(json!({ "value": 80 })));
        }
        _ => panic!("expected HostMessage::Action"),
    }
}

#[test]
fn test_host_action_result_serialization() {
    let result = HostActionResult {
        request_id: "req-123".to_string(),
        success: true,
        payload: Some(json!({ "volume": 80 })),
        error: None,
    };
    let msg = HostMessage::ActionResult(result);
    let serialized = serde_json::to_value(&msg).unwrap();

    assert_eq!(serialized["type"], "host.actionResult");
    assert_eq!(serialized["requestId"], "req-123");
    assert_eq!(serialized["success"], true);
    assert_eq!(serialized["payload"], json!({ "volume": 80 }));

    let deserialized: HostMessage = serde_json::from_value(serialized).unwrap();
    match deserialized {
        HostMessage::ActionResult(r) => {
            assert_eq!(r.request_id, "req-123");
            assert!(r.success);
            assert_eq!(r.payload, Some(json!({ "volume": 80 })));
            assert_eq!(r.error, None);
        }
        _ => panic!("expected HostMessage::ActionResult"),
    }
}

#[test]
fn test_unknown_host_message_type_fails_safely() {
    let raw_json = json!({
        "type": "host.futureFeature",
        "someField": 123
    });

    let deserialized: HostMessage = serde_json::from_value(raw_json).unwrap();
    assert_eq!(deserialized, HostMessage::Unknown);
}

#[test]
fn test_malformed_host_message_handling() {
    // Missing required field 'hostName' for host.hello
    let malformed_hello = json!({
        "type": "host.hello",
        "protocolVersion": 1,
        "capabilities": ["media"]
    });

    let result: Result<HostMessage, _> = serde_json::from_value(malformed_hello);
    assert!(result.is_err());
}

#[test]
fn test_host_hello_missing_protocol_version_fails() {
    let missing_pv = json!({
        "type": "host.hello",
        "hostName": "DESKTOP-TEST",
        "capabilities": ["media"]
    });
    let result: Result<HostMessage, _> = serde_json::from_value(missing_pv);
    assert!(result.is_err());
}

#[test]
fn test_host_action_without_payload() {
    let action = HostAction {
        request_id: "req-456".to_string(),
        action: "system.mute".to_string(),
        payload: None,
    };
    let msg = HostMessage::Action(action);
    let serialized = serde_json::to_value(&msg).unwrap();

    assert_eq!(serialized["type"], "host.action");
    assert_eq!(serialized["requestId"], "req-456");
    assert_eq!(serialized["action"], "system.mute");
    assert!(serialized.get("payload").is_none());

    let deserialized: HostMessage = serde_json::from_value(serialized).unwrap();
    match deserialized {
        HostMessage::Action(a) => {
            assert_eq!(a.request_id, "req-456");
            assert_eq!(a.action, "system.mute");
            assert_eq!(a.payload, None);
        }
        _ => panic!("expected HostMessage::Action"),
    }
}

#[test]
fn test_host_action_result_without_payload_or_error() {
    let result = HostActionResult {
        request_id: "req-789".to_string(),
        success: true,
        payload: None,
        error: None,
    };
    let msg = HostMessage::ActionResult(result);
    let serialized = serde_json::to_value(&msg).unwrap();

    assert_eq!(serialized["type"], "host.actionResult");
    assert_eq!(serialized["requestId"], "req-789");
    assert_eq!(serialized["success"], true);
    assert!(serialized.get("payload").is_none());
    assert!(serialized.get("error").is_none());

    let deserialized: HostMessage = serde_json::from_value(serialized).unwrap();
    match deserialized {
        HostMessage::ActionResult(r) => {
            assert_eq!(r.request_id, "req-789");
            assert!(r.success);
            assert_eq!(r.payload, None);
            assert_eq!(r.error, None);
        }
        _ => panic!("expected HostMessage::ActionResult"),
    }
}

#[test]
fn test_capability_wire_names() {
    assert_eq!(
        serde_json::to_value(HostCapability::SystemStats).unwrap(),
        json!("systemStats")
    );
    assert_eq!(
        serde_json::to_value(HostCapability::AppLaunch).unwrap(),
        json!("appLaunch")
    );
    assert_eq!(
        serde_json::to_value(HostCapability::Media).unwrap(),
        json!("media")
    );
    assert_eq!(
        serde_json::to_value(HostCapability::Volume).unwrap(),
        json!("volume")
    );
    assert_eq!(
        serde_json::to_value(HostCapability::Discord).unwrap(),
        json!("discord")
    );
    assert_eq!(
        serde_json::to_value(HostCapability::Macros).unwrap(),
        json!("macros")
    );
}
