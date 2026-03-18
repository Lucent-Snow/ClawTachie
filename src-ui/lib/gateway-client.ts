import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { HelloOk } from "./types";

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

interface DisconnectPayload {
  code?: number;
  reason?: string;
}

export class GatewayClient {
  private connected = false;
  private unlisteners: UnlistenFn[] = [];

  constructor(private opts: GatewayClientOptions) {}

  async connect(): Promise<void> {
    try {
      await this.attachListeners();
      const hello = await invoke<HelloOk>("gateway_connect", {
        url: this.opts.url,
        token: this.opts.token,
      });
      this.connected = true;
      this.opts.onConnected?.(hello);
    } catch (err) {
      await this.cleanupListeners();
      this.opts.onError?.(toError(err));
    }
  }

  disconnect(): void {
    this.connected = false;
    void invoke("gateway_disconnect")
      .catch((err) => {
        this.opts.onError?.(toError(err));
      })
      .finally(() => {
        void this.cleanupListeners();
      });
  }

  isConnected(): boolean {
    return this.connected;
  }

  async request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    switch (method) {
      case "chat.send":
        await invoke("gateway_send_message", {
          sessionKey: params["sessionKey"],
          message: params["message"],
        });
        return {};
      case "chat.history": {
        const messages = await invoke<unknown[]>("gateway_history", {
          sessionKey: params["sessionKey"],
          limit: params["limit"],
        });
        return { messages };
      }
      default:
        throw new Error(`unsupported request method: ${method}`);
    }
  }

  private async attachListeners(): Promise<void> {
    await this.cleanupListeners();

    const gatewayEvent = await listen<Record<string, unknown>>("gateway://chat", (event) => {
      this.opts.onChatEvent?.(event.payload ?? {});
    });

    const gatewayRunEnd = await listen("gateway://run-end", () => {
      this.opts.onAgentRunEnd?.();
    });

    const gatewayError = await listen<{ message?: string }>("gateway://error", (event) => {
      this.opts.onError?.(new Error(event.payload?.message ?? "gateway error"));
    });

    const gatewayDisconnected = await listen<DisconnectPayload>("gateway://disconnected", (event) => {
      this.connected = false;
      this.opts.onDisconnected?.(event.payload?.code ?? 1000, event.payload?.reason ?? "disconnected");
    });

    this.unlisteners = [gatewayEvent, gatewayRunEnd, gatewayError, gatewayDisconnected];
  }

  private async cleanupListeners(): Promise<void> {
    for (const unlisten of this.unlisteners.splice(0)) {
      unlisten();
    }
  }
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
