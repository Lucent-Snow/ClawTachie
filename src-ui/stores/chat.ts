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
import { useSettings } from "./settings";
import { useTts } from "./tts";
import { useGateway } from "./gateway";

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

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

function extractToolContent(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;

  const entry = message as Record<string, unknown>;
  const content = entry.content;

  if (typeof content === "string" && content.trim() !== "") {
    return content;
  }

  if (Array.isArray(content)) {
    const parts = content
      .map((part) => {
        if (!part || typeof part !== "object") {
          return null;
        }

        const item = part as Record<string, unknown>;
        if (typeof item.text === "string" && item.text.trim() !== "") {
          return item.text;
        }

        return stringifyUnknown(item);
      })
      .filter((part): part is string => Boolean(part && part.trim()));

    if (parts.length > 0) {
      return parts.join("\n\n");
    }
  }

  const fallback = {
    kind: entry.kind,
    name: entry.name,
    content: entry.content,
    input: entry.input,
    args: entry.args,
    arguments: entry.arguments,
    output: entry.output,
    result: entry.result,
    payload: entry.payload,
  };
  const text = stringifyUnknown(fallback).trim();
  return text && text !== "{}" ? text : null;
}

function readMessageRole(message: unknown): "user" | "assistant" | null {
  if (!message || typeof message !== "object") return null;

  const role = (message as Record<string, unknown>).role;
  if (role === "user") return "user";
  if (role === "assistant" || role === "tool") return "assistant";
  return null;
}

function isToolHistoryMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;

  const entry = message as Record<string, unknown>;
  const kind = typeof entry.kind === "string" ? entry.kind : null;
  if (kind && /tool/i.test(kind)) {
    return true;
  }

  const name = typeof entry.name === "string" ? entry.name : null;
  return Boolean(name && /tool/i.test(name));
}

function buildToolLabel(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;

  const entry = message as Record<string, unknown>;
  const name = typeof entry.name === "string" ? entry.name.trim() : "";
  if (name && !/tool/i.test(name)) {
    return name;
  }

  const kind = typeof entry.kind === "string" ? entry.kind.trim() : "";
  if (kind) {
    return kind.replace(/[_-]+/g, " ");
  }

  return null;
}

function isHiddenHistoryMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") return true;

  const entry = message as Record<string, unknown>;
  const role = readMessageRole(entry);
  if (!role) return true;

  if (entry.hidden === true || entry.internal === true) {
    return true;
  }

  const kind = typeof entry.kind === "string" ? entry.kind : null;
  if (kind && /system|internal/i.test(kind)) {
    return true;
  }

  const name = typeof entry.name === "string" ? entry.name : null;
  if (name && /system|internal/i.test(name)) {
    return true;
  }

  const content = entry.content;
  if (Array.isArray(content) && !isToolHistoryMessage(entry)) {
    const hasVisibleText = content.some((part) => {
      if (!part || typeof part !== "object") return false;
      const item = part as Record<string, unknown>;
      return item.type === "text" && typeof item.text === "string" && item.text.trim() !== "";
    });

    if (!hasVisibleText) {
      return true;
    }
  }

  return false;
}

function normalizeHistoryMessage(message: unknown): UIMessage | null {
  if (isHiddenHistoryMessage(message)) {
    return null;
  }

  const entry = message as Record<string, unknown>;
  const role = readMessageRole(entry);
  const isToolMessage = isToolHistoryMessage(entry);
  const content = isToolMessage ? extractToolContent(entry) ?? "" : extractContent(entry) ?? "";
  const parsed = isToolMessage ? null : parseMessageTags(content);

  if (!role) {
    return null;
  }

  if (isToolMessage && content.trim() === "") {
    return null;
  }

  if (!isToolMessage && (!parsed || parsed.text.trim() === "")) {
    return null;
  }

  return {
    id: (entry.id as string) ?? crypto.randomUUID(),
    role,
    content: isToolMessage ? content : parsed!.text,
    tachie: isToolMessage ? null : parsed!.tachie,
    style: isToolMessage ? null : parsed!.style,
    timestamp: (entry.createdAt as number) ?? Date.now(),
    displayKind: isToolMessage ? "tool" : "message",
    toolLabel: isToolMessage ? buildToolLabel(entry) : null,
  };
}

function dedupeMessages(messages: UIMessage[]): UIMessage[] {
  const seenIds = new Set<string>();
  const seenFallbackKeys = new Set<string>();

  return messages.filter((message) => {
    if (message.id) {
      if (seenIds.has(message.id)) {
        return false;
      }

      seenIds.add(message.id);
      return true;
    }

    const fallbackKey = [
      message.role,
      message.content,
      message.tachie ?? "",
      message.style ?? "",
      message.timestamp,
      message.displayKind ?? "message",
      message.toolLabel ?? "",
    ].join("|");

    if (seenFallbackKeys.has(fallbackKey)) {
      return false;
    }

    seenFallbackKeys.add(fallbackKey);
    return true;
  });
}

let rawStreamBuffer = "";
const streamingParser = createStreamingParser();
let historyLoadRequestId = 0;

async function reconnectForHistoryIfNeeded(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (!/gateway not connected/i.test(message)) {
    throw error;
  }

  const gateway = useSettings.getState().gateway;
  if (!gateway.url.trim() || !gateway.token.trim()) {
    throw error;
  }

  await useGateway.getState().connect(gateway.url.trim(), gateway.token);
  if (useGateway.getState().status !== "connected") {
    throw error;
  }
}

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
      displayKind: "message",
      toolLabel: null,
    };
    set((s) => ({ messages: [...s.messages, userMsg] }));
    resetStreamingState();
    set({
      streamingText: "",
      streamingTachie: null,
      streamingStyle: null,
      currentTachie: "thinking",
      isStreaming: true,
    });
    try {
      await gatewaySendMessage(sessionKey, text);
      void broadcastUserMessage(sessionKey, userMsg);
      void useGateway.getState().refreshSessions();
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
    const requestId = historyLoadRequestId + 1;
    historyLoadRequestId = requestId;
    let raw: unknown[] = [];
    try {
      raw = await gatewayHistory(sessionKey, 50);
    } catch (error) {
      try {
        await reconnectForHistoryIfNeeded(error);
        raw = await gatewayHistory(sessionKey, 50);
      } catch {
        if (historyLoadRequestId !== requestId) {
          return;
        }
        set({
          messages: [],
          currentTachie: "normal",
          streamingTachie: null,
          streamingStyle: null,
          streamingText: "",
          isStreaming: false,
          lastGeneratedAssistantMessageId: null,
        });
        return;
      }
    }

    if (historyLoadRequestId !== requestId) {
      return;
    }

    const messages = dedupeMessages(
      raw
        .map((item: unknown) => normalizeHistoryMessage(item))
        .filter((message): message is UIMessage => message !== null),
    );
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
    historyLoadRequestId += 1;
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
          displayKind: "message",
          toolLabel: null,
        }
      : null;
    const nextTachie = parsed.tachie ?? "normal";
    resetStreamingState();
    set((s) => ({
      messages: nextMessage ? dedupeMessages([...s.messages, nextMessage]) : s.messages,
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

