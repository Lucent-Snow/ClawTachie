import { create } from "zustand";
import type { CharacterSpriteAsset } from "../lib/types";
import { type EmotionName } from "../lib/emotions";
import { loadCharacterSprites } from "../lib/tauri-gateway";

interface CharacterState {
  sprites: Partial<Record<EmotionName, string>>;
  ready: boolean;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
}

function mapSprites(assets: CharacterSpriteAsset[]): Partial<Record<EmotionName, string>> {
  return assets.reduce<Partial<Record<EmotionName, string>>>((acc, asset) => {
    acc[asset.emotion] = asset.path;
    return acc;
  }, {});
}

export const useCharacter = create<CharacterState>()((set, get) => ({
  sprites: {},
  ready: false,
  loading: false,
  error: null,

  load: async () => {
    if (get().ready || get().loading) {
      return;
    }

    set({ loading: true, error: null });
    try {
      const assets = await loadCharacterSprites();
      set({
        sprites: mapSprites(assets),
        ready: true,
        loading: false,
        error: assets.length === 0 ? "no-sprites" : null,
      });
    } catch (error) {
      set({
        ready: true,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
}));
