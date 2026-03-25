import { WebSocket } from "ws";
import crypto from "node:crypto";
import {
  loadOrCreateIdentity,
  publicKeyRawBase64Url,
  signPayload,
  buildAuthPayloadV3,
} from "./device-identity.js";
import type { ConnectParams, HelloOk, Frame, EventFrame, ResponseFrame } from "./types.js";

const PROTOCOL_VERSION = 3;

export interface GatewayClientOptions {
  url: string;
  token: string;
  sessionKey: string;
  onChatEvent?: (payload: Record<string, unknown>) => void;
  onAgentRunEnd?: () => void;
  onConnected?: (hello: HelloOk) => void;
  onDisconnected?: (code: number, reason: string) => void;
  onError?: (err: Error) => void;
}

type PendingRequest = {
  resolve: (payload: Record<string, unknown>) => void;
  reject: (err: Error) => void;
};

export class GatewayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private identity = loadOrCreateIdentity();
  private connectNonce: string | null = null;
  private connected = false;

  constructor(private opts: GatewayClientOptions) {}

  connect(): void {
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;

    ws.on("open", () => {
      // Wait for connect.challenge event
    });

    ws.on("message", (data) => {
      try {
        const frame = JSON.parse(data.toString()) as Frame;
        this.handleFrame(frame);
      } catch (err) {
        this.opts.onError?.(new Error(`parse error: ${err}`));
      }
    });

    ws.on("close", (code, reason) => {
      this.connected = false;
      if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
      this.opts.onDisconnected?.(code, reason.toString());
    });

    ws.on("error", (err) => {
      this.opts.onError?.(err);
    });
  }

  disconnect(): void {
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      this.pending.set(id, { resolve, reject });
      const frame = { type: "req", id, method, params };
      this.ws?.send(JSON.stringify(frame));
      // Timeout after 30s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`request ${method} timed out`));
        }
      }, 30_000);
    });
  }

  private handleFrame(frame: Frame): void {
    if (frame.type === "event") {
      this.handleEvent(frame as EventFrame);
    } else if (frame.type === "res") {
      this.handleResponse(frame as ResponseFrame);
    }
  }

  private handleEvent(evt: EventFrame): void {
    if (evt.event === "connect.challenge") {
      const payload = evt.payload as { nonce?: string } | undefined;
      const nonce = payload?.nonce?.trim();
      if (!nonce) {
        this.opts.onError?.(new Error("connect.challenge missing nonce"));
        this.ws?.close(1008, "missing nonce");
        return;
      }
      this.connectNonce = nonce;
      this.sendConnect();
    } else if (evt.event === "chat") {
      this.opts.onChatEvent?.(evt.payload ?? {});
    } else if (evt.event === "agent") {
      this.opts.onChatEvent?.(evt.payload ?? {});
    } else if (evt.event === "agent.run.completed" || evt.event === "agent.run.error") {
      this.opts.onAgentRunEnd?.();
    }
    // Ignore other events (health, tick, etc.)
  }

  private handleResponse(res: ResponseFrame): void {
    const pending = this.pending.get(res.id);
    if (!pending) return;
    this.pending.delete(res.id);
    if (res.ok) {
      pending.resolve(res.payload ?? {});
    } else {
      const msg = res.error?.message ?? "unknown error";
      pending.reject(new Error(msg));
    }
  }

  private sendConnect(): void {
    const nonce = this.connectNonce;
    if (!nonce) return;

    const role = "operator";
    const scopes = [
      "operator.admin",
      "operator.read",
      "operator.write",
      "operator.approvals",
      "operator.pairing",
      "operator.talk.secrets",
    ];
    const platform = process.platform;
    const clientId = "gateway-client";
    const clientMode = "backend";
    const signedAtMs = Date.now();

    const authPayload = buildAuthPayloadV3({
      deviceId: this.identity.deviceId,
      clientId,
      clientMode,
      role,
      scopes,
      signedAtMs,
      token: this.opts.token,
      nonce,
      platform,
    });
    const signature = signPayload(this.identity.privateKeyPem, authPayload);

    const params: ConnectParams = {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: { id: clientId, version: "0.1.0", platform, mode: clientMode },
      role,
      scopes,
      caps: [],
      auth: { token: this.opts.token },
      device: {
        id: this.identity.deviceId,
        publicKey: publicKeyRawBase64Url(this.identity.publicKeyPem),
        signature,
        signedAt: signedAtMs,
        nonce,
      },
    };

    this.request("connect", params as unknown as Record<string, unknown>)
      .then((payload) => {
        this.connected = true;
        const hello = payload as unknown as HelloOk;
        const tickMs = hello.policy?.tickIntervalMs ?? 15_000;
        this.tickTimer = setInterval(() => {
          this.request("tick", {}).catch(() => {});
        }, tickMs);
        this.opts.onConnected?.(hello);
      })
      .catch((err) => {
        this.opts.onError?.(err instanceof Error ? err : new Error(String(err)));
        this.ws?.close(1008, "connect failed");
      });
  }
}
