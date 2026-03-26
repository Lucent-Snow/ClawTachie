import { create } from "zustand";
import { persist } from "zustand/middleware";

interface WorkspaceState {
  sessionKeys: string[];
  initialized: boolean;
  initialize: (keys: string[]) => void;
  addSession: (key: string) => void;
  removeSession: (key: string) => void;
  pruneSessions: (availableKeys: string[]) => void;
}

function uniqueKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const key of keys) {
    const normalized = key.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set) => ({
      sessionKeys: [],
      initialized: false,

      initialize: (keys) =>
        set((state) => {
          if (state.initialized) {
            return state;
          }

          return {
            sessionKeys: uniqueKeys(keys),
            initialized: true,
          };
        }),

      addSession: (key) =>
        set((state) => ({
          sessionKeys: state.sessionKeys.includes(key)
            ? state.sessionKeys
            : [...state.sessionKeys, key],
          initialized: true,
        })),

      removeSession: (key) =>
        set((state) => ({
          sessionKeys: state.sessionKeys.filter((sessionKey) => sessionKey !== key),
          initialized: true,
        })),

      pruneSessions: (availableKeys) =>
        set((state) => {
          const available = new Set(availableKeys);
          const nextSessionKeys = state.sessionKeys.filter((key) => available.has(key));

          if (nextSessionKeys.length === state.sessionKeys.length) {
            return state;
          }

          if (state.sessionKeys.length > 0 && nextSessionKeys.length === 0) {
            return {
              sessionKeys: [],
              initialized: false,
            };
          }

          return {
            sessionKeys: nextSessionKeys,
          };
        }),
    }),
    {
      name: "clawtachie-workspace",
      version: 1,
      partialize: (state) => ({
        sessionKeys: state.sessionKeys,
        initialized: state.initialized,
      }),
    },
  ),
);
