import { type TachieName, normalizeTachieName } from "./emotions";

const LEGACY_EMOTION_RE = /\[emotion:([^\]\s]+)\]/gi;
const TACHIE_TAG_RE = /<tachie>([\s\S]*?)<\/tachie>/gi;
const STYLE_TAG_RE = /<style>([\s\S]*?)<\/style>/gi;
const OPENING_PREFIXES = ["<tachie>", "<style>", "[emotion:"] as const;
const MAX_TAG_BUFFER = 2048;

export interface ParsedMessage {
  text: string;
  tachie: TachieName | null;
  style: string | null;
}

export interface StreamingParseResult {
  text: string;
  tachie: TachieName | null;
  style: string | null;
}

export interface StreamingTagParser {
  feed: (delta: string) => StreamingParseResult;
  flush: () => string;
  reset: () => void;
}

export function parseMessageTags(raw: string): ParsedMessage {
  let tachie: TachieName | null = null;
  let style: string | null = null;

  const text = raw
    .replace(TACHIE_TAG_RE, (match, value: string) => {
      const normalized = normalizeTachieName(value);
      if (!normalized) {
        return match;
      }
      tachie = normalized;
      return "";
    })
    .replace(STYLE_TAG_RE, (_match, value: string) => {
      const nextStyle = value.trim();
      if (nextStyle) {
        style = nextStyle;
      }
      return "";
    })
    .replace(LEGACY_EMOTION_RE, (match, value: string) => {
      const normalized = normalizeTachieName(value);
      if (!normalized) {
        return match;
      }
      tachie = normalized;
      return "";
    })
    .trim();

  return { text, tachie, style };
}

export function parseEmotions(raw: string): { text: string; emotions: TachieName[] } {
  const parsed = parseMessageTags(raw);
  return {
    text: parsed.text,
    emotions: parsed.tachie ? [parsed.tachie] : [],
  };
}

function splitTrailingPrefix(value: string): { head: string; tail: string } {
  const maxLength = Math.min(
    value.length,
    Math.max(...OPENING_PREFIXES.map((prefix) => prefix.length - 1)),
  );

  for (let length = maxLength; length > 0; length -= 1) {
    const tail = value.slice(-length);
    if (OPENING_PREFIXES.some((prefix) => prefix.startsWith(tail))) {
      return {
        head: value.slice(0, value.length - length),
        tail,
      };
    }
  }

  return { head: value, tail: "" };
}

function consumeKnownMarker(buffer: string): {
  consumed: number;
  text: string;
  tachie: TachieName | null;
  style: string | null;
  wait: boolean;
} {
  if (buffer.startsWith("<tachie>")) {
    const closeIndex = buffer.indexOf("</tachie>");
    if (closeIndex === -1) {
      if (buffer.length > MAX_TAG_BUFFER) {
        return { consumed: 1, text: buffer.charAt(0), tachie: null, style: null, wait: false };
      }
      return { consumed: 0, text: "", tachie: null, style: null, wait: true };
    }

    const candidate = buffer.slice(0, closeIndex + "</tachie>".length);
    const normalized = normalizeTachieName(buffer.slice("<tachie>".length, closeIndex));

    return normalized
      ? { consumed: candidate.length, text: "", tachie: normalized, style: null, wait: false }
      : { consumed: candidate.length, text: candidate, tachie: null, style: null, wait: false };
  }

  if (buffer.startsWith("<style>")) {
    const closeIndex = buffer.indexOf("</style>");
    if (closeIndex === -1) {
      if (buffer.length > MAX_TAG_BUFFER) {
        return { consumed: 1, text: buffer.charAt(0), tachie: null, style: null, wait: false };
      }
      return { consumed: 0, text: "", tachie: null, style: null, wait: true };
    }

    const consumed = closeIndex + "</style>".length;
    const style = buffer.slice("<style>".length, closeIndex).trim();

    return {
      consumed,
      text: "",
      tachie: null,
      style: style || null,
      wait: false,
    };
  }

  if (buffer.startsWith("[emotion:")) {
    const closeIndex = buffer.indexOf("]");
    if (closeIndex === -1) {
      if (buffer.length > MAX_TAG_BUFFER) {
        return { consumed: 1, text: buffer.charAt(0), tachie: null, style: null, wait: false };
      }
      return { consumed: 0, text: "", tachie: null, style: null, wait: true };
    }

    const candidate = buffer.slice(0, closeIndex + 1);
    const match = /^\[emotion:([^\]\s]+)\]$/i.exec(candidate);
    const normalized = match ? normalizeTachieName(match[1]) : null;

    return normalized
      ? { consumed: candidate.length, text: "", tachie: normalized, style: null, wait: false }
      : { consumed: candidate.length, text: candidate, tachie: null, style: null, wait: false };
  }

  if (OPENING_PREFIXES.some((prefix) => prefix.startsWith(buffer))) {
    return { consumed: 0, text: "", tachie: null, style: null, wait: true };
  }

  return { consumed: 1, text: buffer.charAt(0), tachie: null, style: null, wait: false };
}

export function createStreamingParser(): StreamingTagParser {
  let buffer = "";

  return {
    feed(delta) {
      buffer += delta;

      let text = "";
      let tachie: TachieName | null = null;
      let style: string | null = null;

      while (buffer.length > 0) {
        const markerIndexCandidates = [buffer.indexOf("<"), buffer.indexOf("[emotion:")]
          .filter((index) => index >= 0);
        const markerIndex = markerIndexCandidates.length > 0
          ? Math.min(...markerIndexCandidates)
          : -1;

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

        const consumed = consumeKnownMarker(buffer);
        if (consumed.wait) {
          break;
        }

        text += consumed.text;
        tachie = consumed.tachie ?? tachie;
        style = consumed.style ?? style;
        buffer = buffer.slice(consumed.consumed);
      }

      return { text, tachie, style };
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
