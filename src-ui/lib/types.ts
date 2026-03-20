import type { TachieName } from "./emotions";

// Gateway WebSocket protocol types (browser version)

export interface RequestFrame {
  type: "req";
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface ResponseFrame {
  type: "res";
  id: string;
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string; details?: Record<string, unknown> };
}

export interface EventFrame {
  type: "event";
  event: string;
  payload?: Record<string, unknown>;
  seq?: number;
  stateVersion?: number;
}

export type Frame = RequestFrame | ResponseFrame | EventFrame;

// Connect
export interface ConnectParams {
  minProtocol: number;
  maxProtocol: number;
  client: {
    id: string;
    version: string;
    platform: string;
    mode: string;
  };
  role: string;
  scopes: string[];
  caps: string[];
  auth?: { token?: string };
  device?: {
    id: string;
    publicKey: string;
    signature: string;
    signedAt: number;
    nonce: string;
  };
}

export interface HelloOk {
  type: "hello-ok";
  protocol: number;
  policy?: { tickIntervalMs?: number };
  auth?: { deviceToken?: string; role?: string; scopes?: string[] };
}

// Chat
export interface ChatSendParams {
  sessionKey: string;
  message: string;
  idempotencyKey: string;
  thinking?: string;
  deliver?: boolean;
  attachments?: unknown[];
  timeoutMs?: number;
}

export interface ChatHistoryParams {
  sessionKey: string;
  limit?: number;
}

export interface ChatEvent {
  runId: string;
  sessionKey: string;
  seq: number;
  state: "delta" | "final" | "aborted" | "error";
  message?: { role?: string; content?: string | Array<{ type: string; text?: string }> };
  errorMessage?: string;
}

// Device identity (browser version — raw bytes, not PEM)
export interface DeviceIdentity {
  deviceId: string;
  privateKey: Uint8Array; // 32-byte raw Ed25519 private key
  publicKey: Uint8Array;  // 32-byte raw Ed25519 public key
}

// Sessions
export interface SessionRow {
  key: string;
  kind: "direct" | "group";
  displayName?: string;
  updatedAt: number | null;
  model?: string;
  modelProvider?: string;
}

export interface SessionsListResult {
  ts: number;
  count: number;
  sessions: SessionRow[];
}

export interface CharacterSpriteAsset {
  emotion: TachieName;
  path: string;
}

// UI Message (normalized for display)
export interface UIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  tachie: TachieName | null;
  style: string | null;
  timestamp: number;
}

export type TtsProvider = "none" | "mimo";

export interface TtsSynthesizeRequest {
  provider: Exclude<TtsProvider, "none">;
  text: string;
  style?: string | null;
  apiKey?: string;
  voice?: string;
  model?: string;
  scriptPath?: string;
  userContext?: string;
}

export interface TtsSynthesizeResponse {
  path: string;
  assetUrl: string;
}
