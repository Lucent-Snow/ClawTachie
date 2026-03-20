# ClawTachie — Terminal Prototype

## Goal

Build a Node.js/TypeScript CLI client that connects to an OpenClaw Gateway via WebSocket, sends messages, and receives streaming responses. This is the foundation for a future Tauri desktop pet app.

## Tech Stack

- Node.js + TypeScript (ESM)
- `ws` library for WebSocket
- `readline` for terminal input
- `crypto` for device identity signing

## Architecture

```
Terminal CLI  ←→  WebSocket  ←→  OpenClaw Gateway (ws://127.0.0.1:18789)
```

The client is an "operator" role client that uses the Gateway's `chat.send` / `chat.history` methods and listens for `chat` events for streaming responses.

## Gateway WebSocket Protocol

### Connection Flow

1. Client opens WebSocket to `ws://127.0.0.1:18789`
2. Server sends a `connect.challenge` event:
   ```json
   {"type":"event","event":"connect.challenge","payload":{"nonce":"<random>","ts":1737264000000}}
   ```
3. Client sends `connect` request with auth + device identity:
   ```json
   {
     "type": "req",
     "id": "<uuid>",
     "method": "connect",
     "params": {
       "minProtocol": 3,
       "maxProtocol": 3,
       "client": {
         "id": "clawtachie",
         "version": "0.1.0",
         "platform": "linux",
         "mode": "operator"
       },
       "role": "operator",
       "scopes": ["operator.read", "operator.write"],
       "caps": [],
       "auth": { "token": "<gateway_token>" },
       "device": {
         "id": "<device_fingerprint>",
         "publicKey": "<base64url_public_key>",
         "signature": "<signed_payload>",
         "signedAt": <timestamp_ms>,
         "nonce": "<server_nonce>"
       }
     }
   }
   ```
4. Server responds with `hello-ok`:
   ```json
   {"type":"res","id":"<uuid>","ok":true,"payload":{"type":"hello-ok","protocol":3,"policy":{"tickIntervalMs":15000}}}
   ```

### Device Identity

Generate an Ed25519 keypair on first run, persist to `~/.clawtachie/device.json`.

The device ID is derived from the public key fingerprint (SHA-256 of the raw public key, base64url encoded).

The signature payload for v3 is a JSON string containing: deviceId, clientId, clientMode, role, scopes, signedAtMs, token, nonce, platform. Sign with Ed25519 private key.

**IMPORTANT**: Look at the reference implementation in `/home/william/openclaw/src/gateway/client.ts` (lines 270-320) and `/home/william/openclaw/src/gateway/device-identity.ts` for the exact signing format. The functions `buildDeviceAuthPayloadV3`, `signDevicePayload`, and `publicKeyRawBase64UrlFromPem` define the exact format.

### Framing

- **Request**: `{"type":"req","id":"<uuid>","method":"<method>","params":{...}}`
- **Response**: `{"type":"res","id":"<uuid>","ok":true,"payload":{...}}` or `{"type":"res","id":"<uuid>","ok":false,"error":{...}}`
- **Event**: `{"type":"event","event":"<name>","payload":{...}}`

### Sending Messages

Method: `chat.send`
```json
{
  "type": "req",
  "id": "<uuid>",
  "method": "chat.send",
  "params": {
    "sessionKey": "agent:clawtachie:main",
    "message": "Hello from desktop pet!",
    "idempotencyKey": "<uuid>"
  }
}
```

### Receiving Responses

The server broadcasts `chat` events:
```json
{
  "type": "event",
  "event": "chat",
  "payload": {
    "runId": "<uuid>",
    "sessionKey": "agent:clawtachie:main",
    "seq": 1,
    "state": "delta",
    "message": { "role": "assistant", "content": "partial text..." }
  }
}
```

States: `delta` (streaming chunk), `final` (complete), `aborted`, `error`.

### Chat History

Method: `chat.history`
```json
{
  "type": "req",
  "id": "<uuid>",
  "method": "chat.history",
  "params": {
    "sessionKey": "agent:clawtachie:main",
    "limit": 20
  }
}
```

### Keepalive

After `hello-ok`, send periodic `tick` requests at the interval specified in `policy.tickIntervalMs` (default 15000ms):
```json
{"type":"req","id":"<uuid>","method":"tick","params":{}}
```

## CLI Behavior

1. On startup: connect to Gateway, complete handshake
2. Show connection status
3. Enter interactive REPL mode:
   - User types a message → sends via `chat.send`
   - Streaming response displayed in real-time (delta events)
   - Final response shown with emotion marker parsed out
4. Special commands:
   - `/history` — fetch and display recent chat history
   - `/quit` — disconnect and exit
   - `/status` — show connection status

## Emotion Parsing

Responses may contain emotion markers like `[emotion:smile]`, `[emotion:angry]`, etc.
Parse these out and display them separately:
```
[smile] 你好啊，今天过得怎么样？
```

## Configuration

Read from environment variables:
- `OPENCLAW_GATEWAY_URL` — WebSocket URL (default: `ws://127.0.0.1:18789`)
- `OPENCLAW_GATEWAY_TOKEN` — Auth token (required)
- `CLAWTACHIE_SESSION` — Session key (default: `agent:clawtachie:main`)

## File Structure

```
clawtachie/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          — Entry point, REPL loop
│   ├── gateway-client.ts — WebSocket client, connect handshake, request/response
│   ├── device-identity.ts — Ed25519 keypair generation, signing, persistence
│   ├── chat.ts           — chat.send, chat.history, event handling
│   ├── emotion.ts        — Emotion marker parsing
│   └── types.ts          — TypeScript type definitions
└── SPEC.md
```

## Reference Code

The OpenClaw source code is available at `/home/william/openclaw/`. Key files:
- `/home/william/openclaw/src/gateway/client.ts` — Reference WebSocket client implementation
- `/home/william/openclaw/src/gateway/device-identity.ts` — Device identity and signing
- `/home/william/openclaw/src/gateway/protocol/schema/logs-chat.ts` — Chat message schemas
- `/home/william/openclaw/src/gateway/protocol/schema/protocol-schemas.ts` — Protocol version (3)
- `/home/william/openclaw/src/gateway/protocol/schema/frames.ts` — Frame schemas

Read these files to understand the exact protocol format, especially the device auth signing.

## Testing

After building, test with:
```bash
OPENCLAW_GATEWAY_TOKEN=<token> npx tsx src/index.ts
```

The gateway is running locally at ws://127.0.0.1:18789.
