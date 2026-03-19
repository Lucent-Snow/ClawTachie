import { type EmotionName, normalizeEmotionName } from "./emotions";

const EMOTION_RE = /\[emotion:([^\]\s]+)\]/gi;
const MARKER_PREFIX = "[emotion:";
const MAX_MARKER_LENGTH = 32;

export interface ParsedMessage {
  text: string;
  emotions: EmotionName[];
}

export interface StreamingParseResult {
  text: string;
  emotion: EmotionName | null;
}

export interface StreamingEmotionParser {
  feed: (delta: string) => StreamingParseResult;
  flush: () => string;
  reset: () => void;
}

export function parseEmotions(raw: string): ParsedMessage {
  const emotions: EmotionName[] = [];
  const text = raw
    .replace(EMOTION_RE, (match, emotion: string) => {
      const normalized = normalizeEmotionName(emotion);
      if (!normalized) {
        return match;
      }
      emotions.push(normalized);
      return "";
    })
    .trim();
  return { text, emotions };
}

export function formatWithEmotion(parsed: ParsedMessage): string {
  if (parsed.emotions.length === 0) return parsed.text;
  const tag = parsed.emotions.map((e) => e).join(",");
  return `[${tag}] ${parsed.text}`;
}

function splitTrailingPrefix(value: string): { head: string; tail: string } {
  const maxLength = Math.min(value.length, MARKER_PREFIX.length - 1);

  for (let length = maxLength; length > 0; length -= 1) {
    const tail = value.slice(-length);
    if (MARKER_PREFIX.startsWith(tail)) {
      return {
        head: value.slice(0, value.length - length),
        tail,
      };
    }
  }

  return { head: value, tail: "" };
}

export function createStreamingParser(): StreamingEmotionParser {
  let buffer = "";

  return {
    feed(delta) {
      buffer += delta;

      let text = "";
      let emotion: EmotionName | null = null;

      while (buffer.length > 0) {
        const markerIndex = buffer.indexOf(MARKER_PREFIX);

        if (markerIndex === -1) {
          const { head, tail } = splitTrailingPrefix(buffer);
          text += head;
          buffer = tail;
          break;
        }

        if (markerIndex > 0) {
          text += buffer.slice(0, markerIndex);
          buffer = buffer.slice(markerIndex);
        }

        const closeIndex = buffer.indexOf("]");
        if (closeIndex === -1) {
          if (buffer.length > MAX_MARKER_LENGTH) {
            text += buffer[0];
            buffer = buffer.slice(1);
            continue;
          }
          break;
        }

        const candidate = buffer.slice(0, closeIndex + 1);
        const match = /^\[emotion:([^\]\s]+)\]$/i.exec(candidate);
        const normalized = match ? normalizeEmotionName(match[1]) : null;

        if (!normalized) {
          text += candidate;
        } else {
          emotion = normalized;
        }

        buffer = buffer.slice(closeIndex + 1);
      }

      return { text, emotion };
    },
    flush() {
      const rest = buffer;
      buffer = "";
      return rest;
    },
    reset() {
      buffer = "";
    },
  };
}
