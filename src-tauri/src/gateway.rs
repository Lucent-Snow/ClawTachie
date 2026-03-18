use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{
  pkcs8::{DecodePrivateKey, DecodePublicKey, EncodePrivateKey, EncodePublicKey},
  Signature, Signer, SigningKey, VerifyingKey,
};
use futures_util::{SinkExt, StreamExt};
use pkcs8::LineEnding;
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};
use uuid::Uuid;

const CLIENT_ID: &str = "gateway-client";
const CLIENT_MODE: &str = "backend";
const CLIENT_VERSION: &str = "0.1.0";
const PROTOCOL_VERSION: u32 = 3;
const DEFAULT_TICK_INTERVAL_MS: u64 = 15_000;

type WsStream = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

#[derive(Clone, Default)]
pub struct GatewayState {
    connection: Arc<Mutex<Option<GatewayHandle>>>,
}

#[derive(Clone)]
struct GatewayHandle {
    sender: mpsc::UnboundedSender<GatewayCommand>,
}

enum GatewayCommand {
    Request {
        method: String,
        params: Value,
        response: oneshot::Sender<Result<Value, String>>,
    },
    Disconnect,
}

#[derive(Clone, Debug, Serialize)]
struct GatewayDisconnectedEvent {
  code: u16,
  reason: String,
}

#[derive(Clone, Debug, Serialize)]
struct GatewayErrorEvent {
  message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelloOk {
    #[serde(rename = "type")]
    kind: String,
    protocol: u32,
    policy: Option<HelloPolicy>,
    auth: Option<HelloAuth>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelloPolicy {
    #[serde(rename = "tickIntervalMs")]
    tick_interval_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelloAuth {
    #[serde(rename = "deviceToken")]
    device_token: Option<String>,
    role: Option<String>,
    scopes: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, Serialize)]
struct StoredIdentity {
    version: u8,
    #[serde(rename = "deviceId")]
    device_id: String,
    #[serde(rename = "publicKeyPem")]
    public_key_pem: String,
    #[serde(rename = "privateKeyPem")]
    private_key_pem: String,
    #[serde(rename = "createdAtMs")]
    created_at_ms: u64,
}

#[derive(Debug, Deserialize)]
struct ResponseFrame {
    id: String,
    ok: bool,
    payload: Option<Value>,
    error: Option<ResponseError>,
}

#[derive(Debug, Deserialize)]
struct ResponseError {
    message: Option<String>,
}

#[tauri::command]
pub async fn gateway_connect(
    app: AppHandle,
    state: State<'_, GatewayState>,
    url: String,
    token: String,
) -> Result<HelloOk, String> {
    let old_connection = {
        let mut guard = state
            .connection
            .lock()
            .map_err(|_| "gateway state poisoned".to_string())?;
        guard.take()
    };

    if let Some(existing) = old_connection {
        let _ = existing.sender.send(GatewayCommand::Disconnect);
    }

    let identity = load_or_create_identity()?;
    let mut ws = connect_gateway(&url).await?;
    let nonce = read_connect_challenge(&mut ws).await?;
    let hello = perform_handshake(&mut ws, &identity, &token, &nonce).await?;
    let tick_interval_ms = hello
        .policy
        .as_ref()
        .and_then(|policy| policy.tick_interval_ms)
        .unwrap_or(DEFAULT_TICK_INTERVAL_MS);

    let (sender, receiver) = mpsc::unbounded_channel();
    {
        let mut guard = state
            .connection
            .lock()
            .map_err(|_| "gateway state poisoned".to_string())?;
        *guard = Some(GatewayHandle {
            sender: sender.clone(),
        });
    }

    let state_ref = state.inner().clone();
    tauri::async_runtime::spawn(run_gateway_loop(
        app.clone(),
        state_ref,
        ws,
        receiver,
        tick_interval_ms,
    ));

    app.emit("gateway://connected", &hello)
        .map_err(|err| err.to_string())?;

    Ok(hello)
}

#[tauri::command]
pub async fn gateway_disconnect(state: State<'_, GatewayState>) -> Result<(), String> {
    let connection = {
        let mut guard = state
            .connection
            .lock()
            .map_err(|_| "gateway state poisoned".to_string())?;
        guard.take()
    };

    if let Some(handle) = connection {
        let _ = handle.sender.send(GatewayCommand::Disconnect);
    }

    Ok(())
}

#[tauri::command]
pub async fn gateway_send_message(
    state: State<'_, GatewayState>,
    session_key: String,
    message: String,
) -> Result<(), String> {
    let params = json!({
      "sessionKey": session_key,
      "message": message,
      "idempotencyKey": Uuid::new_v4().to_string(),
    });

    let _ = send_request(state, "chat.send", params).await?;
    Ok(())
}

#[tauri::command]
pub async fn gateway_history(
    state: State<'_, GatewayState>,
    session_key: String,
    limit: Option<u32>,
) -> Result<Vec<Value>, String> {
    let params = json!({
      "sessionKey": session_key,
      "limit": limit.unwrap_or(20),
    });
    let payload = send_request(state, "chat.history", params).await?;
    Ok(payload
        .get("messages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default())
}

async fn send_request(
    state: State<'_, GatewayState>,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let handle = {
        let guard = state
            .connection
            .lock()
            .map_err(|_| "gateway state poisoned".to_string())?;
        guard.clone()
    }
    .ok_or_else(|| "gateway not connected".to_string())?;

    let (response_tx, response_rx) = oneshot::channel();
    handle
        .sender
        .send(GatewayCommand::Request {
            method: method.to_string(),
            params,
            response: response_tx,
        })
        .map_err(|_| "gateway loop is not available".to_string())?;

    response_rx
        .await
        .map_err(|_| "gateway response channel closed".to_string())?
}

async fn connect_gateway(url: &str) -> Result<WsStream, String> {
    connect_async(url)
        .await
        .map(|(ws, _)| ws)
        .map_err(|err| format!("connect failed: {err}"))
}

async fn read_connect_challenge(ws: &mut WsStream) -> Result<String, String> {
    while let Some(message) = ws.next().await {
        let message = message.map_err(|err| err.to_string())?;
        match message {
            Message::Text(text) => {
                let frame: Value = serde_json::from_str(&text).map_err(|err| err.to_string())?;
                if frame.get("type").and_then(Value::as_str) != Some("event") {
                    continue;
                }
                if frame.get("event").and_then(Value::as_str) != Some("connect.challenge") {
                    continue;
                }
                let nonce = frame
                    .get("payload")
                    .and_then(|payload| payload.get("nonce"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| "connect.challenge missing nonce".to_string())?;
                return Ok(nonce.to_string());
            }
            Message::Close(frame) => {
                return Err(close_reason(
                    frame.map(|value| (value.code.into(), value.reason.to_string())),
                ));
            }
            _ => {}
        }
    }

    Err("gateway closed before challenge".to_string())
}

async fn perform_handshake(
    ws: &mut WsStream,
    identity: &StoredIdentity,
    token: &str,
    nonce: &str,
) -> Result<HelloOk, String> {
    let signed_at_ms = now_ms();
    let platform = node_platform();
    let scopes = ["operator.read", "operator.write"];
    let request_id = Uuid::new_v4().to_string();
    let payload = build_auth_payload_v3(
        &identity.device_id,
        CLIENT_ID,
        CLIENT_MODE,
        "operator",
        &scopes,
        signed_at_ms,
        token,
        nonce,
        platform,
        None,
    );
    let signature = sign_payload(&identity.private_key_pem, &payload)?;
    let public_key = public_key_raw_base64_url(&identity.public_key_pem)?;
    let connect_frame = json!({
      "type": "req",
      "id": request_id,
      "method": "connect",
      "params": {
        "minProtocol": PROTOCOL_VERSION,
        "maxProtocol": PROTOCOL_VERSION,
        "client": {
          "id": CLIENT_ID,
          "version": CLIENT_VERSION,
          "platform": platform,
          "mode": CLIENT_MODE
        },
        "role": "operator",
        "scopes": scopes,
        "caps": [],
        "auth": {
          "token": token
        },
        "device": {
          "id": identity.device_id,
          "publicKey": public_key,
          "signature": signature,
          "signedAt": signed_at_ms,
          "nonce": nonce
        }
      }
    });

    ws.send(Message::Text(connect_frame.to_string().into()))
        .await
        .map_err(|err| err.to_string())?;

    while let Some(message) = ws.next().await {
        let message = message.map_err(|err| err.to_string())?;
        match message {
            Message::Text(text) => {
                let frame: Value = serde_json::from_str(&text).map_err(|err| err.to_string())?;
                if frame.get("type").and_then(Value::as_str) != Some("res") {
                    continue;
                }
                if frame.get("id").and_then(Value::as_str) != Some(request_id.as_str()) {
                    continue;
                }
                let response: ResponseFrame =
                    serde_json::from_value(frame).map_err(|err| err.to_string())?;
                if response.ok {
                    let payload = response
                        .payload
                        .ok_or_else(|| "connect response missing payload".to_string())?;
                    return serde_json::from_value(payload).map_err(|err| err.to_string());
                }
                let message = response
                    .error
                    .and_then(|error| error.message)
                    .unwrap_or_else(|| "connect failed".to_string());
                return Err(message);
            }
            Message::Close(frame) => {
                return Err(close_reason(
                    frame.map(|value| (value.code.into(), value.reason.to_string())),
                ));
            }
            _ => {}
        }
    }

    Err("gateway closed before hello-ok".to_string())
}

async fn run_gateway_loop(
    app: AppHandle,
    state: GatewayState,
    ws: WsStream,
    mut receiver: mpsc::UnboundedReceiver<GatewayCommand>,
    tick_interval_ms: u64,
) {
    let (mut writer, mut reader) = ws.split();
    let mut pending = HashMap::<String, oneshot::Sender<Result<Value, String>>>::new();
    let mut tick = tokio::time::interval(Duration::from_millis(tick_interval_ms));

    loop {
        tokio::select! {
          _ = tick.tick() => {
            let frame = json!({
              "type": "req",
              "id": Uuid::new_v4().to_string(),
              "method": "tick",
              "params": {}
            });
            if writer.send(Message::Text(frame.to_string().into())).await.is_err() {
              emit_error(&app, "tick send failed");
              break;
            }
          }
          command = receiver.recv() => {
            match command {
              Some(GatewayCommand::Request { method, params, response }) => {
                let request_id = Uuid::new_v4().to_string();
                let frame = json!({
                  "type": "req",
                  "id": request_id,
                  "method": method,
                  "params": params,
                });
                if let Err(err) = writer.send(Message::Text(frame.to_string().into())).await {
                  let _ = response.send(Err(err.to_string()));
                  emit_error(&app, "request send failed");
                  break;
                }
                pending.insert(request_id, response);
              }
              Some(GatewayCommand::Disconnect) | None => {
                let _ = writer.send(Message::Close(None)).await;
                break;
              }
            }
          }
          message = reader.next() => {
            match message {
              Some(Ok(Message::Text(text))) => {
                if let Err(err) = handle_incoming_frame(&app, &mut pending, &text) {
                  emit_error(&app, &err);
                }
              }
              Some(Ok(Message::Close(frame))) => {
                let (code, reason) = frame
                  .map(|value| (u16::from(value.code), value.reason.to_string()))
                  .unwrap_or((1000, String::new()));
                emit_disconnected(&app, code, &reason);
                break;
              }
              Some(Ok(_)) => {}
              Some(Err(err)) => {
                emit_error(&app, &err.to_string());
                emit_disconnected(&app, 1006, "socket read error");
                break;
              }
              None => {
                emit_disconnected(&app, 1006, "gateway loop ended");
                break;
              }
            }
          }
        }
    }

    for (_, response) in pending.drain() {
        let _ = response.send(Err("gateway loop stopped".to_string()));
    }

    if let Ok(mut guard) = state.connection.lock() {
        *guard = None;
    }
}

fn handle_incoming_frame(
    app: &AppHandle,
    pending: &mut HashMap<String, oneshot::Sender<Result<Value, String>>>,
    text: &str,
) -> Result<(), String> {
    let frame: Value = serde_json::from_str(text).map_err(|err| err.to_string())?;
    match frame.get("type").and_then(Value::as_str) {
        Some("res") => {
            let response: ResponseFrame =
                serde_json::from_value(frame).map_err(|err| err.to_string())?;
            if let Some(sender) = pending.remove(&response.id) {
                if response.ok {
                    let _ = sender.send(Ok(response.payload.unwrap_or(Value::Null)));
                } else {
                    let message = response
                        .error
                        .and_then(|error| error.message)
                        .unwrap_or_else(|| "request failed".to_string());
                    let _ = sender.send(Err(message));
                }
            }
        }
        Some("event") => {
            let event = frame
                .get("event")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let payload = frame.get("payload").cloned().unwrap_or(Value::Null);
            match event {
                "chat" | "agent" => {
                    app.emit("gateway://chat", payload)
                        .map_err(|err| err.to_string())?;
                }
                "agent.run.completed" | "agent.run.error" => {
                    app.emit("gateway://run-end", payload)
                        .map_err(|err| err.to_string())?;
                }
                _ => {}
            }
        }
        _ => {}
    }
    Ok(())
}

fn emit_error(app: &AppHandle, message: &str) {
    let _ = app.emit(
        "gateway://error",
        GatewayErrorEvent {
            message: message.to_string(),
        },
    );
}

fn emit_disconnected(app: &AppHandle, code: u16, reason: &str) {
    let _ = app.emit(
        "gateway://disconnected",
        GatewayDisconnectedEvent {
            code,
            reason: reason.to_string(),
        },
    );
}

fn close_reason(frame: Option<(u16, String)>) -> String {
    match frame {
        Some((code, reason)) if reason.is_empty() => format!("gateway closed with code {code}"),
        Some((code, reason)) => format!("{code} {reason}"),
        None => "gateway closed".to_string(),
    }
}

fn load_or_create_identity() -> Result<StoredIdentity, String> {
    let path = identity_path()?;
    if path.exists() {
        let raw = fs::read_to_string(&path).map_err(|err| err.to_string())?;
        let parsed: StoredIdentity = serde_json::from_str(&raw).map_err(|err| err.to_string())?;
        if parsed.version != 1 {
            return Err("unsupported identity version".to_string());
        }
        let derived_id = fingerprint_public_key(&parsed.public_key_pem)?;
        return Ok(StoredIdentity {
            device_id: derived_id,
            ..parsed
        });
    }

    let signing_key = SigningKey::generate(&mut OsRng);
    let verifying_key = signing_key.verifying_key();
    let public_key_pem = verifying_key
        .to_public_key_pem(LineEnding::LF)
        .map_err(|err| err.to_string())?;
    let private_key_pem = signing_key
        .to_pkcs8_pem(LineEnding::LF)
        .map_err(|err| err.to_string())?
        .to_string();
    let device_id = fingerprint_public_key(&public_key_pem)?;
    let stored = StoredIdentity {
        version: 1,
        device_id,
        public_key_pem,
        private_key_pem,
        created_at_ms: now_ms(),
    };

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let data = serde_json::to_string_pretty(&stored).map_err(|err| err.to_string())?;
    fs::write(&path, format!("{data}\n")).map_err(|err| err.to_string())?;

    Ok(stored)
}

fn identity_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "failed to resolve home directory".to_string())?;
    Ok(home.join(".ciel-pet").join("device.json"))
}

fn fingerprint_public_key(public_key_pem: &str) -> Result<String, String> {
    let key = VerifyingKey::from_public_key_pem(public_key_pem).map_err(|err| err.to_string())?;
    let digest = Sha256::digest(key.as_bytes());
    Ok(hex_string(&digest))
}

fn public_key_raw_base64_url(public_key_pem: &str) -> Result<String, String> {
    let key = VerifyingKey::from_public_key_pem(public_key_pem).map_err(|err| err.to_string())?;
    Ok(URL_SAFE_NO_PAD.encode(key.as_bytes()))
}

fn sign_payload(private_key_pem: &str, payload: &str) -> Result<String, String> {
    let signing_key = SigningKey::from_pkcs8_pem(private_key_pem).map_err(|err| err.to_string())?;
    let signature: Signature = signing_key.sign(payload.as_bytes());
    Ok(URL_SAFE_NO_PAD.encode(signature.to_bytes()))
}

fn build_auth_payload_v3(
    device_id: &str,
    client_id: &str,
    client_mode: &str,
    role: &str,
    scopes: &[&str],
    signed_at_ms: u64,
    token: &str,
    nonce: &str,
    platform: &str,
    device_family: Option<&str>,
) -> String {
    [
        "v3".to_string(),
        device_id.to_string(),
        client_id.to_string(),
        client_mode.to_string(),
        role.to_string(),
        scopes.join(","),
        signed_at_ms.to_string(),
        token.to_string(),
        nonce.to_string(),
        normalize_metadata(platform),
        normalize_metadata(device_family.unwrap_or_default()),
    ]
    .join("|")
}

fn normalize_metadata(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn node_platform() -> &'static str {
    match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        other => other,
    }
}

fn hex_string(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
