// Gateway WebSocket protocol types

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

// Device identity
export interface DeviceIdentity {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

export interface StoredIdentity {
  version: 1;
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
  createdAtMs: number;
}
