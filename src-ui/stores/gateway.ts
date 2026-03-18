import { create } from "zustand";
import type { SessionRow } from "../lib/types";
import {
  gatewayConnect,
  gatewayDisconnect,
  gatewaySessionsList,
} from "../lib/tauri-gateway";

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
  connect: (url: string, token: string) => Promise<void>;
  disconnect: () => Promise<void>;
  switchSession: (key: string) => void;
  refreshSessions: () => Promise<void>;
  setStatus: (status: ConnectionStatus, error?: string | null) => void;
}

export const useGateway = create<GatewayState>()((set, get) => ({
  status: "disconnected",
  error: null,
  sessions: [],
  currentSessionKey: null,

  setStatus: (status, error = null) => set({ status, error }),

  connect: async (url, token) => {
    set({ status: "connecting", error: null });
    try {
      await gatewayConnect(url, token);
      set({ status: "connected", error: null });
      // Auto-fetch sessions after connect
      get().refreshSessions();
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

  switchSession: (key) => set({ currentSessionKey: key }),

  refreshSessions: async () => {
    try {
      const result = await gatewaySessionsList();
      const sorted = [...result.sessions].sort(
        (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
      );
      set({ sessions: sorted });
    } catch {
      // ignore — sessions list may not be available
    }
  },
}));
