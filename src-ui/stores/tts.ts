import { create } from "zustand";
import type { UIMessage } from "../lib/types";
import { ttsSynthesize } from "../lib/tauri-gateway";
import { useSettings } from "./settings";

let audioPlayer: HTMLAudioElement | null = null;
let requestVersion = 0;

function getAudioPlayer(): HTMLAudioElement | null {
  if (typeof Audio === "undefined") {
    return null;
  }

  if (!audioPlayer) {
    audioPlayer = new Audio();
    audioPlayer.preload = "auto";
  }

  return audioPlayer;
}

interface TtsState {
  isGenerating: boolean;
  lastSpokenMessageId: string | null;
  error: string | null;
  speakMessage: (message: UIMessage) => Promise<void>;
  stop: () => void;
  clearError: () => void;
}

export const useTts = create<TtsState>()((set, get) => ({
  isGenerating: false,
  lastSpokenMessageId: null,
  error: null,

  clearError: () => set({ error: null }),

  stop: () => {
    requestVersion += 1;

    const player = getAudioPlayer();
    if (player) {
      player.pause();
      player.currentTime = 0;
      player.removeAttribute("src");
      player.load();
    }

    set({ isGenerating: false });
  },

  speakMessage: async (message) => {
    const { tts } = useSettings.getState();

    if (message.role !== "assistant" || !message.content.trim()) {
      return;
    }

    if (!tts.enabled || tts.provider === "none") {
      return;
    }

    if (!tts.autoPlay) {
      return;
    }

    if (get().lastSpokenMessageId === message.id) {
      return;
    }

    if (!tts.mimoApiKey.trim()) {
      set({ error: "MiMo API key is empty." });
      return;
    }

    if (!tts.mimoScriptPath.trim()) {
      set({ error: "MiMo script path is empty." });
      return;
    }

    set({ isGenerating: true, error: null });
    const version = requestVersion + 1;
    requestVersion = version;

    try {
      const result = await ttsSynthesize({
        provider: "mimo",
        text: message.content,
        style: message.style,
        apiKey: tts.mimoApiKey,
        voice: tts.mimoVoice,
        model: tts.mimoModel,
        scriptPath: tts.mimoScriptPath,
        userContext: tts.mimoUserContext,
      });

      if (requestVersion !== version) {
        set({ isGenerating: false });
        return;
      }

      const player = getAudioPlayer();
      if (player && tts.autoPlay) {
        player.pause();
        player.src = result.assetUrl;
        player.currentTime = 0;
        await player.play();
      }

      if (requestVersion !== version) {
        set({ isGenerating: false });
        return;
      }

      set({
        isGenerating: false,
        lastSpokenMessageId: message.id,
        error: null,
      });
    } catch (error) {
      set({
        isGenerating: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
}));
