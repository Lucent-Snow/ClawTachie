import { create } from "zustand";
import type { UIMessage, ChatEvent } from "../lib/types";
import { parseEmotions } from "../lib/emotion";
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

let streamBuffer = "";

interface ChatState {
  messages: UIMessage[];
  streamingText: string;
  isStreaming: boolean;
  currentRunId: string | null;
  send: (sessionKey: string, text: string) => Promise<void>;
  abort: (sessionKey: string) => Promise<void>;
  loadHistory: (sessionKey: string) => Promise<void>;
  clearMessages: () => void;
  handleChatEvent: (payload: Record<string, unknown>, sessionKey: string) => void;
  finalizeStream: () => void;
}

export const useChat = create<ChatState>()((set, get) => ({
  messages: [],
  streamingText: "",
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
    streamBuffer = "";
    set({ streamingText: "", isStreaming: false });
    await gatewaySendMessage(sessionKey, text);
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
    set({ messages });
  },

  clearMessages: () => {
    streamBuffer = "";
    set({ messages: [], streamingText: "", isStreaming: false, currentRunId: null });
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
        streamBuffer += data.delta;
        set({ streamingText: streamBuffer, isStreaming: true });
      }
      return;
    }

    // Format 1: chat events
    const evt = payload as unknown as ChatEvent;
    switch (evt.state) {
      case "delta": {
        const content = extractContent(evt.message);
        if (content) {
          streamBuffer = content;
          set({ streamingText: content, isStreaming: true });
        }
        break;
      }
      case "final":
        get().finalizeStream();
        break;
      case "error":
      case "aborted":
        streamBuffer = "";
        set({ streamingText: "", isStreaming: false });
        break;
    }
  },

  finalizeStream: () => {
    const text = streamBuffer || get().streamingText;
    if (!text) {
      set({ isStreaming: false });
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
    streamBuffer = "";
    set((s) => ({
      messages: [...s.messages, msg],
      streamingText: "",
      isStreaming: false,
      currentRunId: null,
    }));
  },
}));

