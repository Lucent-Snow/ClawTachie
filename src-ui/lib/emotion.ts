// Emotion marker parsing
// Format: [emotion:xxx] anywhere in text

const EMOTION_RE = /\[emotion:(\w+)\]/g;

export interface ParsedMessage {
  text: string;
  emotions: string[];
}

export function parseEmotions(raw: string): ParsedMessage {
  const emotions: string[] = [];
  const text = raw.replace(EMOTION_RE, (_match, emotion: string) => {
    emotions.push(emotion);
    return "";
  }).trim();
  return { text, emotions };
}

export function formatWithEmotion(parsed: ParsedMessage): string {
  if (parsed.emotions.length === 0) return parsed.text;
  const tag = parsed.emotions.map((e) => e).join(",");
  return `[${tag}] ${parsed.text}`;
}
