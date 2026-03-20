import { create } from "zustand";
import type { UIMessage, ChatEvent } from "../lib/types";
import { createStreamingParser, parseMessageTags } from "../lib/emotion";
import { type TachieName } from "../lib/emotions";
import { broadcastUserMessage } from "../lib/window-sync";
import {
  gatewaySendMessage,
  gatewayHistory,
  gatewayChatAbort,
} from "../lib/tauri-gateway";
import { useTts } from "./tts";

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

function deriveTachieFromHistory(messages: UIMessage[]): TachieName {
  const latestAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.tachie);

  return latestAssistant?.tachie ?? "normal";
}

function resetStreamingState() {
  rawStreamBuffer = "";
  streamingParser.reset();
}

interface ChatState {
  messages: UIMessage[];
  streamingText: string;
  streamingTachie: TachieName | null;
  streamingStyle: string | null;
  currentTachie: TachieName;
  isStreaming: boolean;
  currentRunId: string | null;
  lastGeneratedAssistantMessageId: string | null;
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
  streamingTachie: null,
  streamingStyle: null,
  currentTachie: "normal",
  isStreaming: false,
  currentRunId: null,
  lastGeneratedAssistantMessageId: null,

  send: async (sessionKey, text) => {
    useTts.getState().stop();

    const userMsg: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      tachie: null,
      style: null,
      timestamp: Date.now(),
    };
    set((s) => ({ messages: [...s.messages, userMsg] }));
    resetStreamingState();
    set({
      streamingText: "",
      streamingTachie: null,
      streamingStyle: null,
      currentTachie: "thinking",
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
          currentTachie: deriveTachieFromHistory(messages),
          streamingText: "",
          streamingTachie: null,
          streamingStyle: null,
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
        const parsed = parseMessageTags(content);
        return {
          id: (m.id as string) ?? crypto.randomUUID(),
          role: (m.role as "user" | "assistant") ?? "assistant",
          content: parsed.text,
          tachie: parsed.tachie,
          style: parsed.style,
          timestamp: (m.createdAt as number) ?? Date.now(),
        };
      })
      .filter((m: UIMessage) => m.content.trim() !== "");
    set({
      messages,
      currentTachie: deriveTachieFromHistory(messages),
      streamingTachie: null,
      streamingStyle: null,
      streamingText: "",
      isStreaming: false,
      lastGeneratedAssistantMessageId: null,
    });
  },

  clearMessages: () => {
    resetStreamingState();
    set({
      messages: [],
      streamingText: "",
      streamingTachie: null,
      streamingStyle: null,
      currentTachie: "normal",
      isStreaming: false,
      currentRunId: null,
      lastGeneratedAssistantMessageId: null,
    });
  },

  appendExternalUserMessage: (message) => {
    set((state) => {
      if (state.messages.some((item) => item.id === message.id)) {
        return state;
      }

      return {
        messages: [...state.messages, message],
        currentTachie: "thinking" as const,
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
          streamingTachie: parsed.tachie ?? state.streamingTachie,
          streamingStyle: parsed.style ?? state.streamingStyle,
          currentTachie: parsed.tachie ?? state.currentTachie,
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
            streamingTachie: parsed.tachie,
            streamingStyle: parsed.style,
            currentTachie: parsed.tachie ?? get().currentTachie,
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
        set((state) => ({
          streamingText: "",
          streamingTachie: null,
          streamingStyle: null,
          currentTachie: deriveTachieFromHistory(state.messages),
          isStreaming: false,
        }));
        break;
    }
  },

  finalizeStream: () => {
    const text = rawStreamBuffer;
    if (!text) {
      resetStreamingState();
      set((state) => ({
        streamingText: "",
        streamingTachie: null,
        streamingStyle: null,
        currentTachie: deriveTachieFromHistory(state.messages),
        isStreaming: false,
      }));
      return;
    }

    const parsed = parseMessageTags(text);
    const nextMessage: UIMessage | null = parsed.text.trim()
      ? {
          id: crypto.randomUUID(),
          role: "assistant",
          content: parsed.text,
          tachie: parsed.tachie,
          style: parsed.style,
          timestamp: Date.now(),
        }
      : null;
    const nextTachie = parsed.tachie ?? "normal";
    resetStreamingState();
    set((s) => ({
      messages: nextMessage ? [...s.messages, nextMessage] : s.messages,
      streamingText: "",
      streamingTachie: null,
      streamingStyle: null,
      currentTachie: nextTachie,
      isStreaming: false,
      currentRunId: null,
      lastGeneratedAssistantMessageId: nextMessage?.id ?? null,
    }));
  },
}));

