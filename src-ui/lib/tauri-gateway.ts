import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { HelloOk } from "./types";

export interface GatewayDisconnectedEvent {
  code: number;
  reason: string;
}

export interface GatewayErrorEvent {
  message: string;
}

export function hasTauriBackend(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function gatewayConnect(
  url: string,
  token: string,
): Promise<HelloOk> {
  return invoke("gateway_connect", { url, token });
}

export async function gatewayDisconnect(): Promise<void> {
  await invoke("gateway_disconnect");
}

export async function gatewaySendMessage(
  sessionKey: string,
  message: string,
): Promise<void> {
  await invoke("gateway_send_message", { sessionKey, message });
}

export async function gatewayHistory(
  sessionKey: string,
  limit = 20,
): Promise<unknown[]> {
  return invoke("gateway_history", { sessionKey, limit });
}

export async function subscribeGatewayEvents(listeners: {
  onChatEvent: (payload: Record<string, unknown>) => void;
  onRunEnd: () => void;
  onDisconnected: (payload: GatewayDisconnectedEvent) => void;
  onError: (payload: GatewayErrorEvent) => void;
}): Promise<UnlistenFn[]> {
  if (!hasTauriBackend()) {
    return [];
  }

  return Promise.all([
    listen<Record<string, unknown>>("gateway://chat", (event) => {
      listeners.onChatEvent(event.payload);
    }),
    listen("gateway://run-end", () => {
      listeners.onRunEnd();
    }),
    listen<GatewayDisconnectedEvent>("gateway://disconnected", (event) => {
      listeners.onDisconnected(event.payload);
    }),
    listen<GatewayErrorEvent>("gateway://error", (event) => {
      listeners.onError(event.payload);
    }),
  ]);
}
