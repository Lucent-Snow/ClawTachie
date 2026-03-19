import { create } from "zustand";
import type { UIMessage, ChatEvent } from "../lib/types";
import { createStreamingParser, parseEmotions } from "../lib/emotion";
import { type EmotionName } from "../lib/emotions";
import { broadcastUserMessage } from "../lib/window-sync";
import {
  gatewaySendMessage,
  gatewayHistory,
  gatewayChatAbort,
} from "../lib/tauri-gateway";

function extractContent(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const msg = message as Record<string, unknown>;
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter(
        (c: unknown) =>
          typeof c === "object" &&
          c !== null &&
          (c as Record<string, unknown>).type === "text",
      )
      .map((c: unknown) => (c as Record<string, unknown>).text ?? "")
      .join("");
  }
  return null;
}

let rawStreamBuffer = "";
const streamingParser = createStreamingParser();

function getLatestEmotion(emotions: EmotionName[]): EmotionName | null {
  return emotions.at(-1) ?? null;
}

function resetStreamingState() {
  rawStreamBuffer = "";
  streamingParser.reset();
}

function deriveEmotionFromHistory(messages: UIMessage[]): EmotionName {
  const latestAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.emotions.length > 0);

  return getLatestEmotion(latestAssistant?.emotions ?? []) ?? "normal";
}

interface ChatState {
  messages: UIMessage[];
  streamingText: string;
  streamingEmotion: EmotionName | null;
  currentEmotion: EmotionName;
  isStreaming: boolean;
  currentRunId: string | null;
  send: (sessionKey: string, text: string) => Promise<void>;
  abort: (sessionKey: string) => Promise<void>;
  loadHistory: (sessionKey: string) => Promise<void>;
  clearMessages: () => void;
  appendExternalUserMessage: (message: UIMessage) => void;
  handleChatEvent: (payload: Record<string, unknown>, sessionKey: string) => void;
  finalizeStream: () => void;
}

export const useChat = create<ChatState>()((set, get) => ({
  messages: [],
  streamingText: "",
  streamingEmotion: null,
  currentEmotion: "normal",
  isStreaming: false,
  currentRunId: null,

  send: async (sessionKey, text) => {
    const userMsg: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      emotions: [],
      timestamp: Date.now(),
    };
    set((s) => ({ messages: [...s.messages, userMsg] }));
    resetStreamingState();
    set({
      streamingText: "",
      streamingEmotion: null,
      currentEmotion: "thinking",
      isStreaming: false,
    });
    try {
      await gatewaySendMessage(sessionKey, text);
      void broadcastUserMessage(sessionKey, userMsg);
    } catch {
      set((state) => {
        const messages = state.messages.filter((message) => message.id !== userMsg.id);
        return {
          messages,
          currentEmotion: deriveEmotionFromHistory(messages),
          streamingText: "",
          streamingEmotion: null,
          isStreaming: false,
        };
      });
    }
  },

  abort: async (sessionKey) => {
    await gatewayChatAbort(sessionKey);
    get().finalizeStream();
  },

  loadHistory: async (sessionKey) => {
    const raw = await gatewayHistory(sessionKey, 50);
    const messages: UIMessage[] = raw
      .map((item: unknown) => {
        const m = item as Record<string, unknown>;
        const content = extractContent(m) ?? "";
        const parsed = parseEmotions(content);
        return {
          id: (m.id as string) ?? crypto.randomUUID(),
          role: (m.role as "user" | "assistant") ?? "assistant",
          content: parsed.text,
          emotions: parsed.emotions,
          timestamp: (m.createdAt as number) ?? Date.now(),
        };
      })
      .filter((m: UIMessage) => m.content.trim() !== "");
    set({
      messages,
      currentEmotion: deriveEmotionFromHistory(messages),
      streamingEmotion: null,
      streamingText: "",
      isStreaming: false,
    });
  },

  clearMessages: () => {
    resetStreamingState();
    set({
      messages: [],
      streamingText: "",
      streamingEmotion: null,
      currentEmotion: "normal",
      isStreaming: false,
      currentRunId: null,
    });
  },

  appendExternalUserMessage: (message) => {
    set((state) => {
      if (state.messages.some((item) => item.id === message.id)) {
        return state;
      }

      return {
        messages: [...state.messages, message],
        currentEmotion: "thinking" as const,
      };
    });
  },

  handleChatEvent: (payload, sessionKey) => {
    const sk = payload.sessionKey as string | undefined;
    if (sk && sk !== sessionKey) return;

    // Format 2: agent stream events
    if ("stream" in payload && "data" in payload) {
      const stream = payload.stream as string;
      const data = payload.data as
        | { text?: string; delta?: string; phase?: string }
        | undefined;

      if (stream === "lifecycle" && data?.phase === "end") {
        get().finalizeStream();
        return;
      }
      if (stream === "assistant" && data?.delta) {
        rawStreamBuffer += data.delta;
        const parsed = streamingParser.feed(data.delta);
        set((state) => ({
          streamingText: state.streamingText + parsed.text,
          streamingEmotion: parsed.emotion ?? state.streamingEmotion,
          currentEmotion: parsed.emotion ?? state.currentEmotion,
          isStreaming: true,
        }));
      }
      return;
    }

    // Format 1: chat events
    const evt = payload as unknown as ChatEvent;
    switch (evt.state) {
      case "delta": {
        const content = extractContent(evt.message);
        if (content) {
          resetStreamingState();
          rawStreamBuffer = content;

          const parsed = streamingParser.feed(content);
          set({
            streamingText: parsed.text,
            streamingEmotion: parsed.emotion,
            currentEmotion: parsed.emotion ?? get().currentEmotion,
            isStreaming: true,
          });
        }
        break;
      }
      case "final":
        get().finalizeStream();
        break;
      case "error":
      case "aborted":
        resetStreamingState();
        set({
          streamingText: "",
          streamingEmotion: null,
          currentEmotion: "normal",
          isStreaming: false,
        });
        break;
    }
  },

  finalizeStream: () => {
    const text = rawStreamBuffer;
    if (!text) {
      resetStreamingState();
      set({
        streamingText: "",
        streamingEmotion: null,
        currentEmotion: "normal",
        isStreaming: false,
      });
      return;
    }

    const parsed = parseEmotions(text);
    const msg: UIMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: parsed.text,
      emotions: parsed.emotions,
      timestamp: Date.now(),
    };
    const latestEmotion = getLatestEmotion(parsed.emotions) ?? "normal";
    resetStreamingState();
    set((s) => ({
      messages: [...s.messages, msg],
      streamingText: "",
      streamingEmotion: null,
      currentEmotion: latestEmotion,
      isStreaming: false,
      currentRunId: null,
    }));
  },
}));

