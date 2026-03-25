import { create } from "zustand";
import type { SessionRow, SessionsListResult } from "../lib/types";
import {
  gatewayConnect,
  gatewayDisconnect,
  gatewaySessionsDelete,
  gatewaySessionsList,
  gatewaySessionsPatch,
  gatewaySessionsReset,
  type GatewaySessionPatch,
} from "../lib/tauri-gateway";
import { shouldReconnectGateway, stringifyGatewayError } from "../lib/gateway-errors";
import { broadcastSettingsChange } from "../lib/window-sync";
import { useChat } from "./chat";
import { DEFAULT_SETTINGS, useSettings } from "./settings";

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

interface GatewayState {
  status: ConnectionStatus;
  error: string | null;
  sessions: SessionRow[];
  currentSessionKey: string | null;
  openSessionKeys: string[];
  composerFocusToken: number;
  connect: (url: string, token: string) => Promise<void>;
  disconnect: () => Promise<void>;
  createSession: () => Promise<string>;
  resetSession: (key: string) => Promise<void>;
  deleteSession: (key: string) => Promise<string | null>;
  renameSession: (key: string, label: string) => Promise<void>;
  updateSessionModel: (key: string, model: string) => Promise<void>;
  switchSession: (key: string) => void;
  closeSessionTab: (key: string) => void;
  refreshSessions: () => Promise<void>;
  requestComposerFocus: () => void;
  setStatus: (status: ConnectionStatus, error?: string | null) => void;
}

async function persistSessionKey(key: string) {
  useSettings.getState().updateGateway({ sessionKey: key });
  const next = useSettings.getState();
  await broadcastSettingsChange({
    gateway: next.gateway,
    tts: next.tts,
    pet: next.pet,
    updates: next.updates,
  });
}

async function reconnectGatewayFromSettings() {
  const gateway = useSettings.getState().gateway;
  const url = gateway.url.trim();
  const token = gateway.token.trim();
  if (!url || !token) {
    throw new Error("gateway connection settings are incomplete");
  }

  await useGateway.getState().connect(url, token);

  const { status, error } = useGateway.getState();
  if (status !== "connected") {
    throw new Error(error ?? "gateway reconnect failed");
  }
}

async function retryGatewayRequest<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!shouldReconnectGateway(error)) {
      throw error;
    }

    await reconnectGatewayFromSettings();
    return operation();
  }
}

function mergeSessionMetadata(next: SessionRow, previous?: SessionRow): SessionRow {
  const label = next.label ?? previous?.label;
  const displayName = next.displayName ?? previous?.displayName ?? label;
  return {
    ...previous,
    ...next,
    ...(label ? { label } : {}),
    ...(displayName ? { displayName } : {}),
  };
}

function sessionNamespace(key: string | null | undefined): string {
  const normalized = key?.trim();
  if (!normalized) {
    return "agent:clawtachie";
  }

  const parts = normalized.split(":").filter(Boolean);
  if (parts[0] === "agent" && parts.length >= 3) {
    return `agent:${parts[1]}`;
  }

  if (parts.length >= 2) {
    return `${parts[0]}:${parts[1]}`;
  }

  return normalized;
}

function buildNewSessionKey(sessions: SessionRow[], currentSessionKey: string | null, defaultSessionKey: string): string {
  const namespace = sessionNamespace(currentSessionKey || defaultSessionKey);
  const baseKey = `${namespace}:new-session`;
  const existingKeys = new Set(sessions.map((session) => session.key));

  if (!existingKeys.has(baseKey)) {
    return baseKey;
  }

  let index = 1;
  while (existingKeys.has(`${baseKey}${index}`)) {
    index += 1;
  }

  return `${baseKey}${index}`;
}

function splitGatewayModelValue(model: string): { model: string; provider?: string } {
  const normalized = model.trim();
  if (!normalized) {
    return { model: "" };
  }

  const slashIndex = normalized.indexOf("/");
  if (slashIndex <= 0) {
    return { model: normalized };
  }

  return {
    provider: normalized.slice(0, slashIndex),
    model: normalized.slice(slashIndex + 1),
  };
}

export const useGateway = create<GatewayState>()((set, get) => ({
  status: "disconnected",
  error: null,
  sessions: [],
  currentSessionKey: null,
  openSessionKeys: [],
  composerFocusToken: 0,

  setStatus: (status, error = null) => set({ status, error }),

  requestComposerFocus: () =>
    set((state) => ({ composerFocusToken: state.composerFocusToken + 1 })),

  connect: async (url, token) => {
    set({ status: "connecting", error: null });
    try {
      await gatewayConnect(url, token);
      const result = await gatewaySessionsList();
      applySessionsResult(result, set, get);
      set({ status: "connected", error: null });
    } catch (err) {
      const msg = stringifyGatewayError(err);
      set({ status: "error", error: msg });
    }
  },

  disconnect: async () => {
    try {
      await gatewayDisconnect();
    } catch {
      // ignore
    }
    set({ status: "disconnected", error: null, sessions: [], openSessionKeys: [] });
  },

  createSession: async () => {
    const key = buildNewSessionKey(
      get().sessions,
      get().currentSessionKey,
      useSettings.getState().gateway.sessionKey,
    );
    await retryGatewayRequest(() => gatewaySessionsReset(key, "new"));
    set((state) => ({
      currentSessionKey: key,
      openSessionKeys: state.openSessionKeys.includes(key)
        ? state.openSessionKeys
        : [...state.openSessionKeys, key],
      composerFocusToken: state.composerFocusToken + 1,
    }));
    useChat.getState().clearMessages();
    await get().refreshSessions();
    return key;
  },

  resetSession: async (key) => {
    await retryGatewayRequest(() => gatewaySessionsReset(key));
    if (get().currentSessionKey === key) {
      useChat.getState().clearMessages();
    }
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.key === key
          ? {
              ...session,
              updatedAt: Date.now(),
            }
          : session,
      ),
    }));
    await get().refreshSessions();
  },

  deleteSession: async (key) => {
    const prev = get();
    const savedSessionKey = useSettings.getState().gateway.sessionKey;
    await retryGatewayRequest(() => gatewaySessionsDelete(key));
    const sessions = prev.sessions.filter((session) => session.key !== key);
    const nextKey = prev.currentSessionKey === key ? sessions[0]?.key ?? null : prev.currentSessionKey;
    const nextDefaultKey =
      key === savedSessionKey
        ? nextKey ?? sessions[0]?.key ?? DEFAULT_SETTINGS.gateway.sessionKey
        : null;

    if (nextDefaultKey) {
      await persistSessionKey(nextDefaultKey);
    }

    set({
      sessions,
      currentSessionKey: nextKey,
      openSessionKeys: prev.openSessionKeys.filter((sessionKey) => sessionKey !== key),
    });
    if (prev.currentSessionKey === key) {
      useChat.getState().clearMessages();
    }

    await get().refreshSessions();
    return nextKey;
  },

  renameSession: async (key, label) => {
    const normalized = label.trim();
    const patch: GatewaySessionPatch = {
      label: normalized || null,
    };
    await retryGatewayRequest(() => gatewaySessionsPatch(key, patch));
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.key === key
          ? {
              ...session,
              label: normalized || undefined,
              displayName: normalized || undefined,
              updatedAt: Date.now(),
            }
          : session,
      ),
    }));
    await get().refreshSessions();
  },

  updateSessionModel: async (key, model) => {
    const normalized = model.trim();
    const patch: GatewaySessionPatch = {
      model: normalized || null,
    };
    const parsed = splitGatewayModelValue(normalized);
    await retryGatewayRequest(() => gatewaySessionsPatch(key, patch));
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.key === key
          ? {
              ...session,
              model: parsed.model || undefined,
              modelProvider: parsed.provider ?? session.modelProvider,
              updatedAt: Date.now(),
            }
          : session,
      ),
    }));
    await get().refreshSessions();
  },

  switchSession: (key) => {
    set((state) => ({
      currentSessionKey: key,
      openSessionKeys: state.openSessionKeys.includes(key)
        ? state.openSessionKeys
        : [...state.openSessionKeys, key],
    }));
  },

  closeSessionTab: (key) => {
    set((state) => {
      const index = state.openSessionKeys.indexOf(key);
      if (index === -1) {
        return state;
      }

      const openSessionKeys = state.openSessionKeys.filter((sessionKey) => sessionKey !== key);
      const nextCurrentSessionKey =
        state.currentSessionKey !== key
          ? state.currentSessionKey
          : openSessionKeys[index] ?? openSessionKeys[index - 1] ?? null;

      return {
        openSessionKeys,
        currentSessionKey: nextCurrentSessionKey,
      };
    });
  },

  refreshSessions: async () => {
    const result = await retryGatewayRequest(() => gatewaySessionsList());
    applySessionsResult(result, set, get);
  },
}));

function applySessionsResult(
  result: SessionsListResult,
  set: (partial: Partial<GatewayState> | ((state: GatewayState) => Partial<GatewayState>)) => void,
  get: () => GatewayState,
) {
  const defaultKey = useSettings.getState().gateway.sessionKey;
  const previousByKey = new Map(get().sessions.map((session) => [session.key, session]));
  const currentSessionKey = get().currentSessionKey;
  const fallbackCurrent = get().sessions.find((session) => session.key === currentSessionKey);
  const sorted = result.sessions
    .map((session) => mergeSessionMetadata(session, previousByKey.get(session.key)))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const merged =
    fallbackCurrent && !sorted.some((session) => session.key === fallbackCurrent.key)
      ? [fallbackCurrent, ...sorted]
      : sorted;
  const previousOpenSessionKeys = get().openSessionKeys;
  const openSessionKeys = previousOpenSessionKeys.filter((key) =>
    merged.some((session) => session.key === key),
  );
  const resolvedCurrent =
    currentSessionKey && merged.some((session) => session.key === currentSessionKey)
      ? currentSessionKey
      : null;

  const firstSession = merged[0];
  if (!resolvedCurrent && firstSession) {
    const match = merged.find((session) => session.key === defaultKey);
    set({
      sessions: merged,
      currentSessionKey: match?.key ?? firstSession.key,
      openSessionKeys:
        openSessionKeys.length > 0
          ? openSessionKeys
          : [match?.key ?? firstSession.key],
    });
    return;
  }

  set({
    sessions: merged,
    currentSessionKey: resolvedCurrent,
    openSessionKeys:
      openSessionKeys.length > 0 || !resolvedCurrent
        ? openSessionKeys
        : [resolvedCurrent],
  });
}
