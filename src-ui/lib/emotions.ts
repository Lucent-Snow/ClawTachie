export const EMOTION_SET = [
  "normal",
  "smile",
  "happy",
  "sad",
  "angry",
  "surprised",
  "thinking",
  "shy",
] as const;

export type EmotionName = (typeof EMOTION_SET)[number];

export const EMOTION_LABELS: Record<EmotionName, string> = {
  normal: "normal",
  smile: "smile",
  happy: "happy",
  sad: "sad",
  angry: "angry",
  surprised: "surprised",
  thinking: "thinking",
  shy: "shy",
};

export const ZC_EMOTION_MAP: Record<string, EmotionName> = {
  正常: "normal",
  微笑: "smile",
  开心: "happy",
  难过: "sad",
  生气: "angry",
  惊讶: "surprised",
  思考: "thinking",
  害羞: "shy",
};

const EMOTION_ALIASES: Record<string, EmotionName> = {
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

export function normalizeEmotionName(value: string | null | undefined): EmotionName | null {
  if (!value) {
    return null;
  }

  return EMOTION_ALIASES[value.trim().toLowerCase()] ?? EMOTION_ALIASES[value.trim()] ?? null;
}

export function getEmotionLabel(value: EmotionName): string {
  return EMOTION_LABELS[value];
}
