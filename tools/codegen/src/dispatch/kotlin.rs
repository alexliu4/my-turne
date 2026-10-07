//! Kotlin wire-type emitter for the generated shared schema surface.

use std::path::Path;

use anyhow::{Context, Result};

use super::{
    casing::{pascal_to_snake, snake_to_camel},
    inventory::{EVENT_INVENTORY, Event, Family, Inventory, METHOD_INVENTORY, Method},
    rust::{self, RustEnum, RustField, RustFieldType, RustItem, RustModule, RustSchema, RustStruct},
};

pub const KOTLIN_OUTPUT_DIR: &str = "crates/shared/generated/kotlin";
pub const KOTLIN_PACKAGE: &str = "dev.nocturne.schema";

pub fn emit_kotlin() -> Result<()> {
    emit_kotlin_to_dir(KOTLIN_OUTPUT_DIR)
}

pub fn emit_kotlin_from_methods_events(methods: &[Method], events: &[Event]) -> Result<()> {
    emit_kotlin_methods_events_to_dir(methods, events, KOTLIN_OUTPUT_DIR)
}

pub fn emit_kotlin_to_dir(out_dir: impl AsRef<Path>) -> Result<()> {
    emit_kotlin_methods_events_to_dir(METHOD_INVENTORY, EVENT_INVENTORY, out_dir)
}

pub fn emit_kotlin_from_inventory(inventory: &Inventory) -> Result<()> {
    emit_kotlin_inventory_to_dir(inventory, KOTLIN_OUTPUT_DIR)
}

pub fn emit_kotlin_inventory_to_dir(
    inventory: &Inventory,
    out_dir: impl AsRef<Path>,
) -> Result<()> {
    let schema = schema_from_inventory(inventory);
    write_schema_to_dir(&schema, out_dir)
}

pub fn emit_kotlin_methods_events_to_dir(
    methods: &[Method],
    events: &[Event],
    out_dir: impl AsRef<Path>,
) -> Result<()> {
    let schema = rust::schema_from_methods_events(methods, events);
    write_schema_to_dir(&schema, out_dir)
}

pub fn write_schema_to_dir(schema: &RustSchema, out_dir: impl AsRef<Path>) -> Result<()> {
    let out_dir = out_dir.as_ref();
    std::fs::create_dir_all(out_dir).with_context(|| format!("create {}", out_dir.display()))?;

    for module in complete_modules(schema) {
        let path = out_dir.join(format!("{}.kt", family_type_name(module.family)));
        std::fs::write(&path, render_family_module(&module))
            .with_context(|| format!("write {}", path.display()))?;
    }

    let aggregate_path = out_dir.join("Generated.kt");
    std::fs::write(&aggregate_path, render_aggregate_file())
        .with_context(|| format!("write {}", aggregate_path.display()))?;
    Ok(())
}

fn schema_from_inventory(inventory: &Inventory) -> RustSchema {
    let mut schema = rust::schema_from_inventory(inventory);
    merge_schema(
        &mut schema,
        rust::schema_from_methods_events(inventory.methods, inventory.events),
    );

    // Explicitly add Host structs to Kotlin schema
    push_item(
        &mut schema,
        Family::Host,
        RustItem::Struct(RustStruct {
            name: "HostHello".to_string(),
            iap2_csm: None,
            fields: vec![
                RustField {
                    name: "protocolVersion".to_string(),
                    ty: RustFieldType::U32,
                },
                RustField {
                    name: "hostName".to_string(),
                    ty: RustFieldType::String,
                },
                RustField {
                    name: "capabilities".to_string(),
                    ty: RustFieldType::Vec(Box::new(RustFieldType::Named("HostCapability".to_string()))),
                },
            ],
        }),
    );
    push_item(
        &mut schema,
        Family::Host,
        RustItem::Struct(RustStruct {
            name: "HostStatus".to_string(),
            iap2_csm: None,
            fields: vec![RustField {
                name: "connected".to_string(),
                ty: RustFieldType::Bool,
            }],
        }),
    );
    push_item(
        &mut schema,
        Family::Host,
        RustItem::Struct(RustStruct {
            name: "HostAction".to_string(),
            iap2_csm: None,
            fields: vec![
                RustField {
                    name: "requestId".to_string(),
                    ty: RustFieldType::String,
                },
                RustField {
                    name: "action".to_string(),
                    ty: RustFieldType::String,
                },
                RustField {
                    name: "payload".to_string(),
                    ty: RustFieldType::Option(Box::new(RustFieldType::JsonValue)),
                },
            ],
        }),
    );
    push_item(
        &mut schema,
        Family::Host,
        RustItem::Struct(RustStruct {
            name: "HostActionResult".to_string(),
            iap2_csm: None,
            fields: vec![
                RustField {
                    name: "requestId".to_string(),
                    ty: RustFieldType::String,
                },
                RustField {
                    name: "success".to_string(),
                    ty: RustFieldType::Bool,
                },
                RustField {
                    name: "payload".to_string(),
                    ty: RustFieldType::Option(Box::new(RustFieldType::JsonValue)),
                },
                RustField {
                    name: "error".to_string(),
                    ty: RustFieldType::Option(Box::new(RustFieldType::String)),
                },
            ],
        }),
    );

    schema
}

fn push_item(schema: &mut RustSchema, family: Family, item: RustItem) {
    let module = schema
        .modules
        .iter_mut()
        .find(|module| module.family == family)
        .expect("all families initialized");
    module.items.push(item);
}

fn merge_schema(target: &mut RustSchema, source: RustSchema) {
    for mut source_module in source.modules {
        let target_module = target
            .modules
            .iter_mut()
            .find(|module| module.family == source_module.family)
            .expect("all families initialized");
        target_module.items.append(&mut source_module.items);
    }
}

fn complete_modules(schema: &RustSchema) -> Vec<RustModule> {
    all_families()
        .into_iter()
        .map(|family| {
            let mut module = schema
                .modules
                .iter()
                .find(|module| module.family == family)
                .cloned()
                .unwrap_or_else(|| RustModule {
                    family,
                    items: Vec::new(),
                });
            module.items.sort_by(|a, b| item_name(a).cmp(item_name(b)));
            module
        })
        .collect()
}

fn render_aggregate_file() -> String {
    let mut out = generated_header();
    out.push_str("@file:Suppress(\"unused\")\n\n");
    out.push_str(&format!("package {KOTLIN_PACKAGE}\n"));
    out
}

fn render_family_module(module: &RustModule) -> String {
    let mut out = generated_header();
    out.push_str(&format!("package {KOTLIN_PACKAGE}\n\n"));
    if module.family == Family::Iap2 {
        out.push_str("// iap2 family: not emitted, daemon-internal only.\n");
        return out;
    }
    out.push_str("import kotlinx.serialization.SerialName\n");
    out.push_str("import kotlinx.serialization.Serializable\n");
    if module
        .items
        .iter()
        .any(|item| matches!(item, RustItem::Enum(item) if item.name == "HostMessage"))
    {
        out.push_str("import kotlinx.serialization.KSerializer\n");
        out.push_str("import kotlinx.serialization.descriptors.SerialDescriptor\n");
        out.push_str("import kotlinx.serialization.descriptors.buildClassSerialDescriptor\n");
        out.push_str("import kotlinx.serialization.encoding.Decoder\n");
        out.push_str("import kotlinx.serialization.encoding.Encoder\n");
        out.push_str("import kotlinx.serialization.json.JsonDecoder\n");
        out.push_str("import kotlinx.serialization.json.JsonEncoder\n");
        out.push_str("import kotlinx.serialization.json.JsonObject\n");
        out.push_str("import kotlinx.serialization.json.JsonPrimitive\n");
    }
    out.push('\n');

    for item in &module.items {
        match item {
            RustItem::Struct(item) => render_struct(&mut out, item),
            RustItem::Enum(item) => render_enum(&mut out, item),
        }
        out.push('\n');
    }

    out
}

fn render_struct(out: &mut String, item: &RustStruct) {
    out.push_str("@Serializable\n");
    if item.fields.is_empty() {
        out.push_str(&format!("object {}\n", item.name));
        return;
    }

    out.push_str(&format!("data class {}(\n", item.name));
    for field in &item.fields {
        let field_name = snake_to_camel(&field.name);
        out.push_str(&format!(
            "  @SerialName({:?}) val {field_name}: {},\n",
            field.name,
            field.ty.kotlin()
        ));
    }
    out.push_str(")\n");
}

fn render_enum(out: &mut String, item: &RustEnum) {
    if item.name == "HostMessage" {
        render_host_message_enum_and_serializer(out);
        return;
    }

    out.push_str("@Serializable\n");
    out.push_str(&format!("enum class {} {{\n", item.name));
    for variant in &item.variants {
        let serial_name = if item.name == "HostCapability" {
            lower_first(&variant.name)
        } else {
            pascal_to_snake(&variant.name)
        };
        let case_name = enum_case_name(&pascal_to_snake(&variant.name));
        out.push_str(&format!(
            "  @SerialName({serial_name:?})\n  {case_name},\n"
        ));
    }
    out.push_str("}\n");
}

fn render_host_message_enum_and_serializer(out: &mut String) {
    out.push_str("@Serializable(with = HostMessageSerializer::class)\n");
    out.push_str("sealed class HostMessage {\n");
    out.push_str("  @Serializable\n");
    out.push_str("  @SerialName(\"host.hello\")\n");
    out.push_str("  data class Hello(\n");
    out.push_str("    @SerialName(\"protocolVersion\") val protocolVersion: UInt,\n");
    out.push_str("    @SerialName(\"hostName\") val hostName: String,\n");
    out.push_str("    @SerialName(\"capabilities\") val capabilities: List<HostCapability>,\n");
    out.push_str("  ) : HostMessage()\n\n");
    out.push_str("  @Serializable\n");
    out.push_str("  @SerialName(\"host.status\")\n");
    out.push_str("  data class Status(\n");
    out.push_str("    @SerialName(\"connected\") val connected: Boolean,\n");
    out.push_str("  ) : HostMessage()\n\n");
    out.push_str("  @Serializable\n");
    out.push_str("  @SerialName(\"host.action\")\n");
    out.push_str("  data class Action(\n");
    out.push_str("    @SerialName(\"requestId\") val requestId: String,\n");
    out.push_str("    @SerialName(\"action\") val action: String,\n");
    out.push_str("    @SerialName(\"payload\") val payload: Value? = null,\n");
    out.push_str("  ) : HostMessage()\n\n");
    out.push_str("  @Serializable\n");
    out.push_str("  @SerialName(\"host.actionResult\")\n");
    out.push_str("  data class ActionResult(\n");
    out.push_str("    @SerialName(\"requestId\") val requestId: String,\n");
    out.push_str("    @SerialName(\"success\") val success: Boolean,\n");
    out.push_str("    @SerialName(\"payload\") val payload: Value? = null,\n");
    out.push_str("    @SerialName(\"error\") val error: String? = null,\n");
    out.push_str("  ) : HostMessage()\n\n");
    out.push_str("  @Serializable\n");
    out.push_str("  @SerialName(\"host.ping\")\n");
    out.push_str("  object Ping : HostMessage()\n\n");
    out.push_str("  @Serializable\n");
    out.push_str("  @SerialName(\"host.pong\")\n");
    out.push_str("  object Pong : HostMessage()\n\n");
    out.push_str("  @Serializable\n");
    out.push_str("  object Unknown : HostMessage()\n");
    out.push_str("}\n\n");

    out.push_str("object HostMessageSerializer : KSerializer<HostMessage> {\n");
    out.push_str("  override val descriptor: SerialDescriptor = buildClassSerialDescriptor(\"HostMessage\")\n\n");
    out.push_str("  override fun deserialize(decoder: Decoder): HostMessage {\n");
    out.push_str("    val jsonDecoder = decoder as? JsonDecoder ?: error(\"HostMessageSerializer requires JsonDecoder\")\n");
    out.push_str("    val jsonElement = jsonDecoder.decodeJsonElement()\n");
    out.push_str("    val jsonObject = jsonElement as? JsonObject ?: error(\"Expected JsonObject for HostMessage\")\n");
    out.push_str("    val typePrimitive = jsonObject[\"type\"] as? JsonPrimitive ?: error(\"Missing or invalid 'type' in HostMessage\")\n");
    out.push_str("    if (!typePrimitive.isString) error(\"'type' in HostMessage must be a string\")\n");
    out.push_str("    val fields = JsonObject(jsonObject.filterKeys { it != \"type\" })\n");
    out.push_str("    return when (typePrimitive.content) {\n");
    out.push_str("      \"host.hello\" -> jsonDecoder.json.decodeFromJsonElement(HostMessage.Hello.serializer(), fields)\n");
    out.push_str("      \"host.status\" -> jsonDecoder.json.decodeFromJsonElement(HostMessage.Status.serializer(), fields)\n");
    out.push_str("      \"host.action\" -> jsonDecoder.json.decodeFromJsonElement(HostMessage.Action.serializer(), fields)\n");
    out.push_str("      \"host.actionResult\" -> jsonDecoder.json.decodeFromJsonElement(HostMessage.ActionResult.serializer(), fields)\n");
    out.push_str("      \"host.ping\" -> HostMessage.Ping\n");
    out.push_str("      \"host.pong\" -> HostMessage.Pong\n");
    out.push_str("      else -> HostMessage.Unknown\n");
    out.push_str("    }\n");
    out.push_str("  }\n\n");

    out.push_str("  override fun serialize(encoder: Encoder, value: HostMessage) {\n");
    out.push_str("    val jsonEncoder = encoder as? JsonEncoder ?: error(\"HostMessageSerializer requires JsonEncoder\")\n");
    out.push_str("    val jsonObject = when (value) {\n");
    out.push_str("      is HostMessage.Hello -> encodeKnown(jsonEncoder, \"host.hello\", HostMessage.Hello.serializer(), value)\n");
    out.push_str("      is HostMessage.Status -> encodeKnown(jsonEncoder, \"host.status\", HostMessage.Status.serializer(), value)\n");
    out.push_str("      is HostMessage.Action -> encodeKnown(jsonEncoder, \"host.action\", HostMessage.Action.serializer(), value)\n");
    out.push_str("      is HostMessage.ActionResult -> encodeKnown(jsonEncoder, \"host.actionResult\", HostMessage.ActionResult.serializer(), value)\n");
    out.push_str("      is HostMessage.Ping -> JsonObject(mapOf(\"type\" to JsonPrimitive(\"host.ping\")))\n");
    out.push_str("      is HostMessage.Pong -> JsonObject(mapOf(\"type\" to JsonPrimitive(\"host.pong\")))\n");
    out.push_str("      is HostMessage.Unknown -> JsonObject(mapOf(\"type\" to JsonPrimitive(\"Unknown\")))\n");
    out.push_str("    }\n");
    out.push_str("    jsonEncoder.encodeJsonElement(jsonObject)\n");
    out.push_str("  }\n");
    out.push_str("\n");
    out.push_str("  private fun <T> encodeKnown(jsonEncoder: JsonEncoder, type: String, serializer: KSerializer<T>, value: T): JsonObject {\n");
    out.push_str("    val fields = jsonEncoder.json.encodeToJsonElement(serializer, value) as JsonObject\n");
    out.push_str("    return JsonObject(mapOf(\"type\" to JsonPrimitive(type)) + fields)\n");
    out.push_str("  }\n");
    out.push_str("}\n");
}

fn lower_first(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    if let Some(first) = chars.next() {
        out.extend(first.to_lowercase());
    }
    out.push_str(chars.as_str());
    out
}

impl KotlinFieldType for RustFieldType {
    fn kotlin(&self) -> String {
        match self {
            Self::Bool => "Boolean".to_string(),
            Self::I8 => "Byte".to_string(),
            Self::U8 => "UByte".to_string(),
            Self::I16 => "Short".to_string(),
            Self::U16 => "UShort".to_string(),
            Self::U32 => "UInt".to_string(),
            Self::U64 => "ULong".to_string(),
            Self::I32 => "Int".to_string(),
            Self::I64 => "Long".to_string(),
            Self::F32 => "Float".to_string(),
            Self::F64 => "Double".to_string(),
            Self::String => "String".to_string(),
            Self::Bytes => "ByteArray".to_string(),
            Self::JsonValue => "Value".to_string(),
            Self::Named(name) => name.clone(),
            Self::Vec(inner) => format!("List<{}>", inner.kotlin()),
            Self::Option(inner) => format!("{}? = null", inner.kotlin()),
        }
    }
}

trait KotlinFieldType {
    fn kotlin(&self) -> String;
}

fn item_name(item: &RustItem) -> &str {
    match item {
        RustItem::Struct(item) => &item.name,
        RustItem::Enum(item) => &item.name,
    }
}

fn generated_header() -> String {
    "// THIS FILE IS GENERATED BY tools/codegen. Do not edit by hand.\n// Re-generate with `just codegen`.\n\n".to_string()
}

fn all_families() -> [Family; 11] {
    [
        Family::Bluetooth,
        Family::Device,
        Family::Audio,
        Family::MediaControl,
        Family::Phone,
        Family::Spotify,
        Family::Voice,
        Family::BtOnly,
        Family::Ota,
        Family::Iap2,
        Family::Host,
    ]
}

fn family_type_name(family: Family) -> &'static str {
    match family {
        Family::Bluetooth => "Bluetooth",
        Family::Device => "Device",
        Family::Audio => "Audio",
        Family::MediaControl => "MediaControl",
        Family::Phone => "Phone",
        Family::Spotify => "Spotify",
        Family::Voice => "Voice",
        Family::BtOnly => "BtOnly",
        Family::Ota => "Ota",
        Family::Iap2 => "Iap2",
        Family::Host => "Host",
    }
}

fn enum_case_name(serial_name: &str) -> String {
    serial_name.to_ascii_uppercase()
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeSet, HashMap};

    use super::*;
    use crate::dispatch::inventory::{
        EMPTY_PAYLOAD, EnumDef, Field, FieldKind, Payload, WireVariant,
    };

    const SET_VOLUME_FIELDS: &[Field] = &[Field {
        name: "volume_percent",
        source: "volumePercent",
        kind: FieldKind::U8,
        required: true,
        doc: "Requested volume percentage.",
    }];
    const SET_VOLUME_REQUEST: Payload = Payload {
        fields: SET_VOLUME_FIELDS,
        example: r#"{"volume_percent":42}"#,
        doc: "Set volume request.",
    };
    const SET_VOLUME_RESPONSE_FIELDS: &[Field] = &[Field {
        name: "success",
        source: "success",
        kind: FieldKind::Bool,
        required: true,
        doc: "Whether volume changed.",
    }];
    const SET_VOLUME_RESPONSE: Payload = Payload {
        fields: SET_VOLUME_RESPONSE_FIELDS,
        example: r#"{"success":true}"#,
        doc: "Set volume response.",
    };
    const BATTERY_EVENT_FIELDS: &[Field] = &[Field {
        name: "is_charging",
        source: "isCharging",
        kind: FieldKind::Bool,
        required: true,
        doc: "Whether external power is present.",
    }];
    const BATTERY_EVENT_PAYLOAD: Payload = Payload {
        fields: BATTERY_EVENT_FIELDS,
        example: r#"{"is_charging":true}"#,
        doc: "Battery state update.",
    };

    const SET_VOLUME_METHOD: Method = Method {
        name: "set_volume",
        family: Family::Device,
        source: "setVolume",
        aliases: &[],
        request: SET_VOLUME_REQUEST,
        response: SET_VOLUME_RESPONSE,
        doc: "Set playback volume.",
    };
    const BATTERY_CHANGED_EVENT: Event = Event {
        name: "battery_changed",
        family: Family::Device,
        source: "batteryChanged",
        aliases: &[],
        payload: BATTERY_EVENT_PAYLOAD,
        iap2_csm: None,
        doc: "Battery state changed.",
    };
    const EMPTY_REQUEST_METHOD: Method = Method {
        name: "empty_request",
        family: Family::Device,
        source: "emptyRequest",
        aliases: &[],
        request: EMPTY_PAYLOAD,
        response: SET_VOLUME_RESPONSE,
        doc: "Empty request payload.",
    };

    #[test]
    fn emits_serializable_data_classes_with_snake_wire_names() {
        let schema =
            rust::schema_from_methods_events(&[SET_VOLUME_METHOD], &[BATTERY_CHANGED_EVENT]);
        let module = schema
            .modules
            .iter()
            .find(|module| module.family == Family::Device)
            .expect("device module emitted");

        let out = render_family_module(module);

        assert!(out.contains("package dev.nocturne.schema"));
        assert!(out.contains("import kotlinx.serialization.SerialName"));
        assert!(out.contains("@Serializable\ndata class SetVolumeRequest("));
        assert!(out.contains("@SerialName(\"volume_percent\") val volumePercent: UByte,"));
        assert!(out.contains("@SerialName(\"is_charging\") val isCharging: Boolean,"));
        assert!(out.contains("@Serializable\nenum class DeviceMethod"));
        assert!(out.contains("@SerialName(\"set_volume\")\n  SET_VOLUME,"));
        assert!(out.contains("@Serializable\nenum class DeviceEvent"));
        assert!(out.contains("@SerialName(\"battery_changed\")\n  BATTERY_CHANGED,"));
    }

    #[test]
    fn emits_serializable_objects_for_empty_payloads() {
        let schema = rust::schema_from_methods_events(&[EMPTY_REQUEST_METHOD], &[]);
        let module = schema
            .modules
            .iter()
            .find(|module| module.family == Family::Device)
            .expect("device module emitted");

        let out = render_family_module(module);

        assert!(out.contains("@Serializable\nobject EmptyRequestRequest"));
        assert!(out.contains("@Serializable\ndata class EmptyRequestResponse("));
        assert!(!out.contains("@Transient val unused"));
    }

    #[test]
    fn inventory_schema_keeps_common_enums_and_method_event_payloads() {
        let mut enums = HashMap::new();
        enums.insert(
            "DeviceMode".to_string(),
            EnumDef {
                name: "DeviceMode".to_string(),
                tag_field: "type".to_string(),
                variants: vec![WireVariant {
                    name: "Ready".to_string(),
                    payload: None,
                    is_struct: false,
                    tag: None,
                }],
            },
        );
        let inventory = Inventory {
            wire_enums: HashMap::new(),
            enums,
            markers: HashMap::new(),
            typed_requests: Vec::new(),
            methods: Box::leak(vec![SET_VOLUME_METHOD].into_boxed_slice()),
            events: Box::leak(vec![BATTERY_CHANGED_EVENT].into_boxed_slice()),
            csms: &[],
            uuid_field_names: BTreeSet::new(),
        };
        let schema = schema_from_inventory(&inventory);
        let module = schema
            .modules
            .iter()
            .find(|module| module.family == Family::Device)
            .expect("device module emitted");

        let out = render_family_module(module);

        assert!(out.contains("@Serializable\nenum class DeviceMode"));
        assert!(out.contains("@SerialName(\"ready\")\n  READY,"));
        assert!(out.contains("@Serializable\ndata class SetVolumeRequest("));
        assert!(out.contains("@Serializable\ndata class SetVolumeResponse("));
        assert!(out.contains("@Serializable\ndata class BatteryChangedEvent("));
        assert!(out.contains("@SerialName(\"set_volume\")\n  SET_VOLUME,"));
        assert!(out.contains("@SerialName(\"battery_changed\")\n  BATTERY_CHANGED,"));
    }

    #[test]
    fn aggregate_file_keeps_generated_package() {
        let out = render_aggregate_file();

        assert!(out.contains("@file:Suppress(\"unused\")"));
        assert!(out.contains("package dev.nocturne.schema"));
    }

    #[test]
    fn host_message_uses_custom_serializer_and_unknown_fallback() {
        let module = RustModule {
            family: Family::Device,
            items: vec![RustItem::Enum(RustEnum {
                name: "HostMessage".to_string(),
                tag_field: None,
                variants: Vec::new(),
            })],
        };
        let out = render_family_module(&module);

        assert!(out.contains("@Serializable(with = HostMessageSerializer::class)"));
        assert!(out.contains("sealed class HostMessage"));
        assert!(out.contains("object HostMessageSerializer : KSerializer<HostMessage>"));
        for import in [
            "kotlinx.serialization.KSerializer",
            "kotlinx.serialization.descriptors.SerialDescriptor",
            "kotlinx.serialization.descriptors.buildClassSerialDescriptor",
            "kotlinx.serialization.encoding.Decoder",
            "kotlinx.serialization.encoding.Encoder",
            "kotlinx.serialization.json.JsonDecoder",
            "kotlinx.serialization.json.JsonEncoder",
            "kotlinx.serialization.json.JsonObject",
            "kotlinx.serialization.json.JsonPrimitive",
        ] {
            assert!(out.contains(&format!("import {import}\n")), "missing {import}");
        }
        for (variant, discriminator) in [
            ("Hello", "host.hello"),
            ("Status", "host.status"),
            ("Action", "host.action"),
            ("ActionResult", "host.actionResult"),
        ] {
            assert!(out.contains(&format!(
                "is HostMessage.{variant} -> encodeKnown(jsonEncoder, \"{discriminator}\", HostMessage.{variant}.serializer(), value)"
            )));
            assert!(out.contains(&format!(
                "\"{discriminator}\" -> jsonDecoder.json.decodeFromJsonElement(HostMessage.{variant}.serializer(), fields)"
            )));
        }
        assert!(out.contains("val fields = JsonObject(jsonObject.filterKeys { it != \"type\" })"));
        assert!(out.contains("return JsonObject(mapOf(\"type\" to JsonPrimitive(type)) + fields)"));
        assert!(out.contains("if (!typePrimitive.isString) error("));
        assert!(out.contains("else -> HostMessage.Unknown"));
        assert!(out.contains("is HostMessage.Unknown -> JsonObject(mapOf(\"type\" to JsonPrimitive(\"Unknown\")))"));
    }
}
