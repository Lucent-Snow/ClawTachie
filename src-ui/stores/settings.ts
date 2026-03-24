import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TtsProvider } from "../lib/types";

export interface GatewaySettings {
  url: string;
  token: string;
  sessionKey: string;
  autoConnect: boolean;
}

export interface TtsSettings {
  enabled: boolean;
  provider: TtsProvider;
  autoPlay: boolean;
  mimoApiKey: string;
  mimoVoice: string;
  mimoModel: string;
  mimoScriptPath: string;
  mimoUserContext: string;
}

export interface PetSettings {
  enabled: boolean;
  spriteScale: number;
}

export interface UpdateSettings {
  autoCheck: boolean;
}

export interface SettingsSnapshot {
  gateway: GatewaySettings;
  tts: TtsSettings;
  pet: PetSettings;
  updates: UpdateSettings;
}

type SettingsSnapshotPatch = {
  gateway?: Partial<GatewaySettings>;
  tts?: Partial<TtsSettings>;
  pet?: Partial<PetSettings>;
  updates?: Partial<UpdateSettings>;
};

interface SettingsState extends SettingsSnapshot {
  updateGateway: (partial: Partial<GatewaySettings>) => void;
  updateTts: (partial: Partial<TtsSettings>) => void;
  updatePet: (partial: Partial<PetSettings>) => void;
  updateUpdates: (partial: Partial<UpdateSettings>) => void;
  applySnapshot: (snapshot: SettingsSnapshotPatch) => void;
}

export const DEFAULT_SETTINGS: SettingsSnapshot = {
  gateway: {
    url: "ws://127.0.0.1:18789",
    token: "",
    sessionKey: "agent:clawtachie:main",
    autoConnect: true,
  },
  tts: {
    enabled: false,
    provider: "none",
    autoPlay: true,
    mimoApiKey: "",
    mimoVoice: "default_zh",
    mimoModel: "mimo-v2-tts",
    mimoScriptPath: "E:\\Desktop\\code\\tts\\mimo-tts\\generate_mimo_tts.py",
    mimoUserContext: "",
  },
  pet: {
    enabled: false,
    spriteScale: 1,
  },
  updates: {
    autoCheck: true,
  },
};

function normalizeSessionKey(value: string | undefined): string {
  if (!value) {
    return DEFAULT_SETTINGS.gateway.sessionKey;
  }

  if (value === "agent:main:clawtachie") {
    return DEFAULT_SETTINGS.gateway.sessionKey;
  }

  return value;
}

function mergeSnapshot(
  snapshot: SettingsSnapshotPatch | undefined,
  options?: { petEnabledFallback?: boolean },
): SettingsSnapshot {
  const gatewayInput: Partial<GatewaySettings> = snapshot?.gateway ?? {};
  const ttsInput: Partial<TtsSettings> = snapshot?.tts ?? {};
  const petInput: Partial<PetSettings> = snapshot?.pet ?? {};
  const updatesInput: Partial<UpdateSettings> = snapshot?.updates ?? {};
  const petEnabledFallback = options?.petEnabledFallback ?? DEFAULT_SETTINGS.pet.enabled;

  return {
    gateway: {
      ...DEFAULT_SETTINGS.gateway,
      ...gatewayInput,
      sessionKey: normalizeSessionKey(gatewayInput.sessionKey),
    },
    tts: {
      ...DEFAULT_SETTINGS.tts,
      ...ttsInput,
    },
    pet: {
      ...DEFAULT_SETTINGS.pet,
      ...petInput,
      enabled:
        typeof petInput.enabled === "boolean"
          ? petInput.enabled
          : petEnabledFallback,
      spriteScale:
        typeof petInput.spriteScale === "number" && Number.isFinite(petInput.spriteScale)
          ? petInput.spriteScale
          : DEFAULT_SETTINGS.pet.spriteScale,
    },
    updates: {
      ...DEFAULT_SETTINGS.updates,
      ...updatesInput,
      autoCheck:
        typeof updatesInput.autoCheck === "boolean"
          ? updatesInput.autoCheck
          : DEFAULT_SETTINGS.updates.autoCheck,
    },
  };
}

function normalizePersistedState(value: unknown): SettingsSnapshot {
  if (!value || typeof value !== "object") {
    return DEFAULT_SETTINGS;
  }

  const candidate = value as Record<string, unknown>;

  if ("gateway" in candidate || "tts" in candidate || "updates" in candidate) {
    const gatewayInput = (candidate.gateway as Partial<GatewaySettings> | undefined) ?? {};
    const ttsInput = (candidate.tts as Partial<TtsSettings> | undefined) ?? {};
    const petInput = (candidate.pet as Partial<PetSettings> | undefined) ?? {};
    const updatesInput = (candidate.updates as Partial<UpdateSettings> | undefined) ?? {};
    const hasLegacyPetConfig = "pet" in candidate;

    return mergeSnapshot({
      gateway: gatewayInput,
      tts: ttsInput,
      pet: petInput,
      updates: updatesInput,
    }, {
      petEnabledFallback: hasLegacyPetConfig,
    });
  }

  const legacyGateway: Partial<GatewaySettings> = {};
  if (typeof candidate.gatewayUrl === "string") {
    legacyGateway.url = candidate.gatewayUrl;
  }
  if (typeof candidate.token === "string") {
    legacyGateway.token = candidate.token;
  }
  if (typeof candidate.sessionKey === "string") {
    legacyGateway.sessionKey = candidate.sessionKey;
  }

  return mergeSnapshot({
    gateway: legacyGateway,
  });
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      updateGateway: (partial) =>
        set((state) => ({
          gateway: {
            ...state.gateway,
            ...partial,
            sessionKey: normalizeSessionKey(partial.sessionKey ?? state.gateway.sessionKey),
          },
        })),
      updateTts: (partial) =>
        set((state) => ({
          tts: {
            ...state.tts,
            ...partial,
          },
        })),
      updatePet: (partial) =>
        set((state) => ({
          pet: {
            ...state.pet,
            ...partial,
          },
        })),
      updateUpdates: (partial) =>
        set((state) => ({
          updates: {
            ...state.updates,
            ...partial,
          },
        })),
      applySnapshot: (snapshot) =>
        set((state) => ({
          gateway: {
            ...state.gateway,
            ...(snapshot.gateway ?? {}),
            sessionKey: normalizeSessionKey(
              snapshot.gateway?.sessionKey ?? state.gateway.sessionKey,
            ),
          },
          tts: {
            ...state.tts,
            ...(snapshot.tts ?? {}),
          },
          pet: {
            ...state.pet,
            ...(snapshot.pet ?? {}),
          },
          updates: {
            ...state.updates,
            ...(snapshot.updates ?? {}),
          },
        })),
    }),
    {
      name: "clawtachie-settings",
      version: 5,
      partialize: (state) => ({
        gateway: state.gateway,
        tts: state.tts,
        pet: state.pet,
        updates: state.updates,
      }),
      migrate: (persistedState) => normalizePersistedState(persistedState),
    },
  ),
);
