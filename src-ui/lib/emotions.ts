export const TACHIE_SET = [
  "normal",
  "smile",
  "happy",
  "sad",
  "angry",
  "surprised",
  "thinking",
  "shy",
] as const;

export type TachieName = (typeof TACHIE_SET)[number];

export const TACHIE_LABELS: Record<TachieName, string> = {
  normal: "normal",
  smile: "smile",
  happy: "happy",
  sad: "sad",
  angry: "angry",
  surprised: "surprised",
  thinking: "thinking",
  shy: "shy",
};

export const ZC_TACHIE_MAP: Record<string, TachieName> = {
  正常: "normal",
  微笑: "smile",
  开心: "happy",
  难过: "sad",
  生气: "angry",
  惊讶: "surprised",
  思考: "thinking",
  害羞: "shy",
};

const TACHIE_ALIASES: Record<string, TachieName> = {
  normal: "normal",
  calm: "normal",
  neutral: "normal",
  正常: "normal",
  平静: "normal",
  日常: "normal",
  smile: "smile",
  smiling: "smile",
  微笑: "smile",
  happy: "happy",
  joy: "happy",
  开心: "happy",
  高兴: "happy",
  兴奋: "happy",
  充满干劲: "happy",
  sad: "sad",
  难过: "sad",
  伤心: "sad",
  失落: "sad",
  哭泣: "sad",
  担心: "sad",
  angry: "angry",
  mad: "angry",
  生气: "angry",
  愤怒: "angry",
  鄙视: "angry",
  surprised: "surprised",
  surprise: "surprised",
  惊讶: "surprised",
  惊呆: "surprised",
  thinking: "thinking",
  think: "thinking",
  思考: "thinking",
  认真: "thinking",
  观望: "thinking",
  好奇: "thinking",
  shy: "shy",
  embarrassed: "shy",
  害羞: "shy",
  尴尬: "shy",
};

export function normalizeTachieName(value: string | null | undefined): TachieName | null {
  if (!value) {
    return null;
  }

  return TACHIE_ALIASES[value.trim().toLowerCase()] ?? TACHIE_ALIASES[value.trim()] ?? null;
}

export function getTachieLabel(value: TachieName): string {
  return TACHIE_LABELS[value];
}

export const EMOTION_SET = TACHIE_SET;
export type EmotionName = TachieName;
export const EMOTION_LABELS = TACHIE_LABELS;
export const ZC_EMOTION_MAP = ZC_TACHIE_MAP;
export const normalizeEmotionName = normalizeTachieName;
export const getEmotionLabel = getTachieLabel;
