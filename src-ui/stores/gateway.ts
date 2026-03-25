import { create } from "zustand";
import type { SessionRow } from "../lib/types";
import {
  gatewayConnect,
  gatewayDisconnect,
  gatewaySessionsDelete,
  gatewaySessionsList,
  gatewaySessionsPatch,
  gatewaySessionsReset,
  type GatewaySessionPatch,
} from "../lib/tauri-gateway";
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
  composerFocusToken: number;
  connect: (url: string, token: string) => Promise<void>;
  disconnect: () => Promise<void>;
  createSession: () => Promise<string>;
  resetSession: (key: string) => Promise<void>;
  deleteSession: (key: string) => Promise<string | null>;
  renameSession: (key: string, label: string) => Promise<void>;
  updateSessionModel: (key: string, model: string) => Promise<void>;
  switchSession: (key: string) => void;
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

export const useGateway = create<GatewayState>()((set, get) => ({
  status: "disconnected",
  error: null,
  sessions: [],
  currentSessionKey: null,
  composerFocusToken: 0,

  setStatus: (status, error = null) => set({ status, error }),

  requestComposerFocus: () =>
    set((state) => ({ composerFocusToken: state.composerFocusToken + 1 })),

  connect: async (url, token) => {
    set({ status: "connecting", error: null });
    try {
      await gatewayConnect(url, token);
      set({ status: "connected", error: null });
      // Auto-fetch sessions after connect
      await get().refreshSessions();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ status: "error", error: msg });
    }
  },

  disconnect: async () => {
    try {
      await gatewayDisconnect();
    } catch {
      // ignore
    }
    set({ status: "disconnected", error: null, sessions: [] });
  },

  createSession: async () => {
    const key = `agent:clawtachie:${Date.now()}`;
    await gatewaySessionsReset(key, "new");
    set((state) => ({
      currentSessionKey: key,
      composerFocusToken: state.composerFocusToken + 1,
    }));
    useChat.getState().clearMessages();
    await get().refreshSessions();
    return key;
  },

  resetSession: async (key) => {
    await gatewaySessionsReset(key);
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
    await gatewaySessionsDelete(key);
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
    await gatewaySessionsPatch(key, patch);
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
    await gatewaySessionsPatch(key, patch);
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.key === key
          ? {
              ...session,
              model: normalized || undefined,
              updatedAt: Date.now(),
            }
          : session,
      ),
    }));
    await get().refreshSessions();
  },

  switchSession: (key) => {
    set({ currentSessionKey: key });
  },

  refreshSessions: async () => {
    try {
      const result = await gatewaySessionsList();
      const defaultKey = useSettings.getState().gateway.sessionKey;
      const previousByKey = new Map(get().sessions.map((session) => [session.key, session]));
      const currentSessionKey = get().currentSessionKey;
      const fallbackCurrent = get().sessions.find((session) => session.key === currentSessionKey);
      const sorted = result.sessions
        .map((session) => mergeSessionMetadata(session, previousByKey.get(session.key)))
        .sort(
        (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
      );
      const merged =
        fallbackCurrent && !sorted.some((session) => session.key === fallbackCurrent.key)
          ? [fallbackCurrent, ...sorted]
          : sorted;
      const resolvedCurrent =
        currentSessionKey && merged.some((session) => session.key === currentSessionKey)
          ? currentSessionKey
          : null;

      // Auto-select: prefer saved default, fallback to first session
      const firstSession = merged[0];
      if (!resolvedCurrent && firstSession) {
        const match = merged.find((s) => s.key === defaultKey);
        set({
          sessions: merged,
          currentSessionKey: match?.key ?? firstSession.key,
        });
        return;
      }
      set({ sessions: merged, currentSessionKey: resolvedCurrent });
    } catch {
      // ignore — sessions list may not be available
    }
  },
}));
