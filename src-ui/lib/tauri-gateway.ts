import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  CharacterSpriteAsset,
  HelloOk,
  SessionsListResult,
} from "./types";

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

export async function gatewaySessionsList(): Promise<SessionsListResult> {
  return invoke("gateway_sessions_list");
}

export async function gatewayChatAbort(sessionKey: string): Promise<void> {
  await invoke("gateway_chat_abort", { sessionKey });
}

export async function loadCharacterSprites(): Promise<CharacterSpriteAsset[]> {
  const assets = await invoke<CharacterSpriteAsset[]>("load_character_sprites");
  return assets.map((asset) => ({
    ...asset,
    path: convertFileSrc(asset.path),
  }));
}

export async function showMainWindow(): Promise<void> {
  await invoke("show_main_window");
}

export async function startCurrentWindowDragging(): Promise<void> {
  await invoke("start_current_window_dragging");
}

export async function subscribeGatewayEvents(listeners: {
  onChatEvent: (payload: Record<string, unknown>) => void;
  onRunEnd: () => void;
  onDisconnected: (payload: GatewayDisconnectedEvent) => void;
  onError: (payload: GatewayErrorEvent) => void;
  onReconnecting?: () => void;
  onConnected?: (payload: HelloOk) => void;
}): Promise<UnlistenFn[]> {
  if (!hasTauriBackend()) {
    return [];
  }

  const promises: Promise<UnlistenFn>[] = [
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
  ];

  if (listeners.onReconnecting) {
    const cb = listeners.onReconnecting;
    promises.push(listen("gateway://reconnecting", () => cb()));
  }
  if (listeners.onConnected) {
    const cb = listeners.onConnected;
    promises.push(listen<HelloOk>("gateway://connected", (e) => cb(e.payload)));
  }

  return Promise.all(promises);
}
