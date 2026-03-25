import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  CharacterSpriteAsset,
  GatewayChatAttachment,
  HelloOk,
  SessionsListResult,
  TtsSynthesizeRequest,
  TtsSynthesizeResponse,
} from "./types";

export interface GatewayDisconnectedEvent {
  code: number;
  reason: string;
}

export interface GatewayErrorEvent {
  message: string;
}

export interface GatewaySessionPatch {
  label?: string | null;
  thinkingLevel?: string | null;
  model?: string | null;
  verboseLevel?: string | null;
  reasoningLevel?: string | null;
  responseUsage?: "off" | "tokens" | "full" | "on" | null;
  elevatedLevel?: string | null;
  execHost?: string | null;
  execSecurity?: string | null;
  execAsk?: string | null;
  execNode?: string | null;
  spawnedBy?: string | null;
  spawnDepth?: number | null;
  sendPolicy?: "allow" | "deny" | null;
  groupActivation?: "mention" | "always" | null;
}

export interface GatewayModelOption {
  id: string;
  label: string;
  provider?: string | null;
  source: string;
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
  attachments?: GatewayChatAttachment[],
): Promise<void> {
  await invoke("gateway_send_message", { sessionKey, message, attachments });
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

export async function gatewayModelsList(): Promise<GatewayModelOption[]> {
  return invoke("gateway_models_list");
}

export async function gatewaySessionsReset(
  sessionKey: string,
  reason: "new" | "reset" = "reset",
): Promise<void> {
  await invoke("gateway_sessions_reset", { sessionKey, reason });
}

export async function gatewaySessionsPatch(
  sessionKey: string,
  patch: GatewaySessionPatch,
): Promise<void> {
  await invoke("gateway_sessions_patch", { sessionKey, patch });
}

export async function gatewaySessionsDelete(sessionKey: string): Promise<void> {
  await invoke("gateway_sessions_delete", { sessionKey });
}

export async function gatewayChatAbort(sessionKey: string): Promise<void> {
  await invoke("gateway_chat_abort", { sessionKey });
}

export async function gatewayConfigGet(): Promise<Record<string, unknown>> {
  return invoke("gateway_config_get");
}

export async function gatewayConfigSchema(): Promise<Record<string, unknown>> {
  return invoke("gateway_config_schema");
}

export async function gatewayConfigPatch(params: {
  raw: string;
  baseHash: string;
  sessionKey?: string | null;
  note?: string | null;
  restartDelayMs?: number | null;
}): Promise<Record<string, unknown>> {
  return invoke("gateway_config_patch", {
    raw: params.raw,
    baseHash: params.baseHash,
    sessionKey: params.sessionKey ?? null,
    note: params.note ?? null,
    restartDelayMs: params.restartDelayMs ?? null,
  });
}

export async function loadCharacterSprites(): Promise<CharacterSpriteAsset[]> {
  const assets = await invoke<CharacterSpriteAsset[]>("load_character_sprites");
  return assets.map((asset) => ({
    ...asset,
    path: convertFileSrc(asset.path),
  }));
}

export async function ttsSynthesize(
  request: TtsSynthesizeRequest,
): Promise<TtsSynthesizeResponse> {
  const result = await invoke<{ path: string }>("tts_synthesize", { request });
  return {
    path: result.path,
    assetUrl: convertFileSrc(result.path),
  };
}

export async function showMainWindow(): Promise<void> {
  await invoke("show_main_window");
}

export async function startCurrentWindowDragging(): Promise<void> {
  await invoke("start_current_window_dragging");
}

export async function exitApp(): Promise<void> {
  await invoke("exit_app");
}

export async function setPetWindowVisible(visible: boolean): Promise<void> {
  await invoke("set_pet_window_visible", { visible });
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
