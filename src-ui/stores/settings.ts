import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
  gatewayUrl: string;
  token: string;
  sessionKey: string;
  update: (partial: Partial<Omit<SettingsState, "update">>) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      gatewayUrl: "ws://127.0.0.1:18789",
      token: "",
      sessionKey: "agent:main:clawtachie",
      update: (partial) => set(partial),
    }),
    { name: "clawtachie-settings" },
  ),
);
