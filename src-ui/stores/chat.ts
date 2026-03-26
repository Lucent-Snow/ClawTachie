import { create } from "zustand";
import { attachmentsToGatewayPayload, extractImageAttachments } from "../lib/chat-attachments";
import { shouldReconnectGateway } from "../lib/gateway-errors";
import type { UIAttachment, UIMessage, ChatEvent } from "../lib/types";
import { createStreamingParser, parseMessageTags, type StreamingTagParser } from "../lib/emotion";
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

function serializeAttachmentsKey(attachments: UIAttachment[] | undefined): string {
  if (!attachments || attachments.length === 0) {
    return "";
  }

  return attachments
    .map((attachment) => `${attachment.kind}:${attachment.url}:${attachment.name ?? ""}`)
    .join("|");
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
  if (name && /tool/i.test(name)) {
    return true;
  }

  return entry.role === "tool";
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
    const hasVisibleImage = content.some((part) => {
      if (!part || typeof part !== "object") return false;
      const item = part as Record<string, unknown>;
      return item.type === "image";
    });

    if (!hasVisibleText && !hasVisibleImage) {
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
  const attachments = isToolMessage ? undefined : extractImageAttachments(entry);
  const parsed = isToolMessage ? null : parseMessageTags(content);

  if (!role) {
    return null;
  }

  if (isToolMessage && content.trim() === "") {
    return null;
  }

  if (
    !isToolMessage &&
    (!parsed || (parsed.text.trim() === "" && (!attachments || attachments.length === 0)))
  ) {
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
    attachments,
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
      serializeAttachmentsKey(message.attachments),
    ].join("|");

    if (seenFallbackKeys.has(fallbackKey)) {
      return false;
    }

    seenFallbackKeys.add(fallbackKey);
    return true;
  });
}

function messagesEquivalent(left: UIMessage | undefined, right: UIMessage | undefined): boolean {
  if (!left || !right) {
    return false;
  }

  return (
    left.role === right.role &&
    left.content === right.content &&
    (left.tachie ?? null) === (right.tachie ?? null) &&
    (left.style ?? null) === (right.style ?? null) &&
    (left.displayKind ?? "message") === (right.displayKind ?? "message") &&
    (left.toolLabel ?? null) === (right.toolLabel ?? null) &&
    serializeAttachmentsKey(left.attachments) === serializeAttachmentsKey(right.attachments)
  );
}

async function reconnectForHistoryIfNeeded(error: unknown) {
  if (!shouldReconnectGateway(error)) {
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

interface SessionChatState {
  messages: UIMessage[];
  streamingText: string;
  streamingTachie: TachieName | null;
  streamingStyle: string | null;
  currentTachie: TachieName;
  isStreaming: boolean;
  currentRunId: string | null;
  lastGeneratedAssistantMessageId: string | null;
}

function createEmptySessionState(): SessionChatState {
  return {
    messages: [],
    streamingText: "",
    streamingTachie: null,
    streamingStyle: null,
    currentTachie: "normal",
    isStreaming: false,
    currentRunId: null,
    lastGeneratedAssistantMessageId: null,
  };
}

const sessionStateCache = new Map<string, SessionChatState>();
const sessionRawStreamBuffers = new Map<string, string>();
const sessionStreamingParsers = new Map<string, StreamingTagParser>();
const historyLoadRequestIds = new Map<string, number>();

function cloneSessionState(state: SessionChatState): SessionChatState {
  return {
    ...state,
    messages: [...state.messages],
  };
}

function getCachedSessionState(sessionKey: string): SessionChatState {
  const cached = sessionStateCache.get(sessionKey);
  return cached ? cloneSessionState(cached) : createEmptySessionState();
}

function setCachedSessionState(sessionKey: string, nextState: SessionChatState) {
  sessionStateCache.set(sessionKey, cloneSessionState(nextState));
}

function getStreamingParser(sessionKey: string): StreamingTagParser {
  let parser = sessionStreamingParsers.get(sessionKey);
  if (!parser) {
    parser = createStreamingParser();
    sessionStreamingParsers.set(sessionKey, parser);
  }
  return parser;
}

function resetStreamingState(sessionKey: string) {
  sessionRawStreamBuffers.set(sessionKey, "");
  getStreamingParser(sessionKey).reset();
}

function snapshotToVisibleState(sessionState: SessionChatState): Pick<
  ChatState,
  | "messages"
  | "streamingText"
  | "streamingTachie"
  | "streamingStyle"
  | "currentTachie"
  | "isStreaming"
  | "currentRunId"
  | "lastGeneratedAssistantMessageId"
> {
  return {
    messages: sessionState.messages,
    streamingText: sessionState.streamingText,
    streamingTachie: sessionState.streamingTachie,
    streamingStyle: sessionState.streamingStyle,
    currentTachie: sessionState.currentTachie,
    isStreaming: sessionState.isStreaming,
    currentRunId: sessionState.currentRunId,
    lastGeneratedAssistantMessageId: sessionState.lastGeneratedAssistantMessageId,
  };
}

function formatToolStreamLabel(stream: string): string {
  return stream.replace(/[_-]+/g, " ").trim() || "tool";
}

function upsertToolMessage(messages: UIMessage[], label: string, content: string): UIMessage[] {
  const normalizedContent = content.trim();
  if (!normalizedContent) {
    return messages;
  }

  const nextLabel = label.trim() || "tool";
  const nextMessages = [...messages];
  const lastMessage = nextMessages.at(-1);

  if (
    lastMessage &&
    lastMessage.displayKind === "tool" &&
    (lastMessage.toolLabel ?? "") === nextLabel
  ) {
    nextMessages[nextMessages.length - 1] = {
      ...lastMessage,
      content: normalizedContent,
      timestamp: Date.now(),
    };
    return nextMessages;
  }

  nextMessages.push({
    id: crypto.randomUUID(),
    role: "assistant",
    content: normalizedContent,
    tachie: null,
    style: null,
    timestamp: Date.now(),
    displayKind: "tool",
    toolLabel: nextLabel,
  });

  return nextMessages;
}

interface ChatState extends SessionChatState {
  activeSessionKey: string | null;
  activateSession: (sessionKey: string) => void;
  hasSessionState: (sessionKey: string) => boolean;
  send: (sessionKey: string, text: string, attachments?: UIAttachment[]) => Promise<void>;
  abort: (sessionKey: string) => Promise<void>;
  loadHistory: (sessionKey: string) => Promise<void>;
  clearMessages: (sessionKey?: string | null) => void;
  appendExternalUserMessage: (sessionKey: string, message: UIMessage) => void;
  handleChatEvent: (payload: Record<string, unknown>) => void;
  finalizeStream: (sessionKey?: string | null) => void;
}

export const useChat = create<ChatState>()((set, get) => {
  function applySessionUpdate(
    sessionKey: string,
    updater: (state: SessionChatState) => SessionChatState,
  ) {
    const previousState = getCachedSessionState(sessionKey);
    const nextState = updater(previousState);
    setCachedSessionState(sessionKey, nextState);

    if (get().activeSessionKey === sessionKey) {
      set(snapshotToVisibleState(nextState));
    }
  }

  function replaceSessionState(sessionKey: string, nextState: SessionChatState) {
    setCachedSessionState(sessionKey, nextState);
    if (get().activeSessionKey === sessionKey) {
      set(snapshotToVisibleState(nextState));
    }
  }

  return {
    activeSessionKey: null,
    ...createEmptySessionState(),

    activateSession: (sessionKey) => {
      const nextState = getCachedSessionState(sessionKey);
      set({
        activeSessionKey: sessionKey,
        ...snapshotToVisibleState(nextState),
      });
    },

    hasSessionState: (sessionKey) => sessionStateCache.has(sessionKey),

    send: async (sessionKey, text, attachments) => {
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
        attachments,
      };

      resetStreamingState(sessionKey);
      applySessionUpdate(sessionKey, (state) => ({
        ...state,
        messages: [...state.messages, userMsg],
        streamingText: "",
        streamingTachie: null,
        streamingStyle: null,
        currentTachie: "thinking",
        isStreaming: true,
      }));

      try {
        await gatewaySendMessage(sessionKey, text, attachmentsToGatewayPayload(attachments));
        void broadcastUserMessage(sessionKey, userMsg);
        void useGateway.getState().refreshSessions();
      } catch (error) {
        try {
          await reconnectForHistoryIfNeeded(error);
          await gatewaySendMessage(sessionKey, text, attachmentsToGatewayPayload(attachments));
          void broadcastUserMessage(sessionKey, userMsg);
          void useGateway.getState().refreshSessions();
        } catch {
          applySessionUpdate(sessionKey, (state) => {
            const messages = state.messages.filter((message) => message.id !== userMsg.id);
            return {
              ...state,
              messages,
              currentTachie: deriveTachieFromHistory(messages),
              streamingText: "",
              streamingTachie: null,
              streamingStyle: null,
              isStreaming: false,
            };
          });
        }
      }
    },

    abort: async (sessionKey) => {
      try {
        await gatewayChatAbort(sessionKey);
      } catch (error) {
        await reconnectForHistoryIfNeeded(error);
        await gatewayChatAbort(sessionKey);
      }
      get().finalizeStream(sessionKey);
    },

    loadHistory: async (sessionKey) => {
      const requestId = (historyLoadRequestIds.get(sessionKey) ?? 0) + 1;
      historyLoadRequestIds.set(sessionKey, requestId);
      let raw: unknown[] = [];

      try {
        raw = await gatewayHistory(sessionKey, 50);
      } catch (error) {
        try {
          await reconnectForHistoryIfNeeded(error);
          raw = await gatewayHistory(sessionKey, 50);
        } catch {
          if (historyLoadRequestIds.get(sessionKey) !== requestId) {
            return;
          }

          resetStreamingState(sessionKey);
          replaceSessionState(sessionKey, createEmptySessionState());
          return;
        }
      }

      if (historyLoadRequestIds.get(sessionKey) !== requestId) {
        return;
      }

      const messages = dedupeMessages(
        raw
          .map((item: unknown) => normalizeHistoryMessage(item))
          .filter((message): message is UIMessage => message !== null),
      );

      resetStreamingState(sessionKey);
      replaceSessionState(sessionKey, {
        ...createEmptySessionState(),
        messages,
        currentTachie: deriveTachieFromHistory(messages),
      });
    },

    clearMessages: (sessionKey) => {
      const targetSessionKey = sessionKey ?? get().activeSessionKey;
      if (!targetSessionKey) {
        return;
      }

      historyLoadRequestIds.delete(targetSessionKey);
      resetStreamingState(targetSessionKey);
      sessionStateCache.delete(targetSessionKey);

      if (get().activeSessionKey === targetSessionKey) {
        set(snapshotToVisibleState(createEmptySessionState()));
      }
    },

    appendExternalUserMessage: (sessionKey, message) => {
      applySessionUpdate(sessionKey, (state) => {
        if (state.messages.some((item) => item.id === message.id)) {
          return state;
        }

        return {
          ...state,
          messages: [...state.messages, message],
          currentTachie: "thinking",
        };
      });
    },

    handleChatEvent: (payload) => {
      const sessionKey =
        (typeof payload.sessionKey === "string" ? payload.sessionKey : null) ??
        get().activeSessionKey;
      if (!sessionKey) {
        return;
      }

      if ("stream" in payload && "data" in payload) {
        const stream = typeof payload.stream === "string" ? payload.stream : "";
        const data = payload.data as Record<string, unknown> | undefined;

        if (stream === "lifecycle" && data?.phase === "end") {
          get().finalizeStream(sessionKey);
          return;
        }

        if (stream === "assistant" && typeof data?.delta === "string") {
          const parser = getStreamingParser(sessionKey);
          const nextRaw = `${sessionRawStreamBuffers.get(sessionKey) ?? ""}${data.delta}`;
          sessionRawStreamBuffers.set(sessionKey, nextRaw);
          const parsed = parser.feed(data.delta);

          applySessionUpdate(sessionKey, (state) => ({
            ...state,
            streamingText: state.streamingText + parsed.text,
            streamingTachie: parsed.tachie ?? state.streamingTachie,
            streamingStyle: parsed.style ?? state.streamingStyle,
            currentTachie: parsed.tachie ?? state.currentTachie,
            isStreaming: true,
          }));
          return;
        }

        if (stream && stream !== "lifecycle" && data) {
          const content = stringifyUnknown(data).trim();
          if (!content) {
            return;
          }

          applySessionUpdate(sessionKey, (state) => ({
            ...state,
            messages: upsertToolMessage(state.messages, formatToolStreamLabel(stream), content),
          }));
        }
        return;
      }

      const evt = payload as unknown as ChatEvent;
      const isToolEvent = evt.message?.role === "tool" || isToolHistoryMessage(evt.message);

      switch (evt.state) {
        case "delta": {
          if (isToolEvent) {
            const content = extractToolContent(evt.message);
            if (!content) {
              return;
            }

            applySessionUpdate(sessionKey, (state) => ({
              ...state,
              messages: upsertToolMessage(
                state.messages,
                buildToolLabel(evt.message) ?? "tool",
                content,
              ),
            }));
            return;
          }

          const content = extractContent(evt.message);
          if (content) {
            resetStreamingState(sessionKey);
            sessionRawStreamBuffers.set(sessionKey, content);
            const parsed = getStreamingParser(sessionKey).feed(content);
            applySessionUpdate(sessionKey, (state) => ({
              ...state,
              streamingText: parsed.text,
              streamingTachie: parsed.tachie,
              streamingStyle: parsed.style,
              currentTachie: parsed.tachie ?? state.currentTachie,
              isStreaming: true,
            }));
          }
          break;
        }
        case "final":
          if (isToolEvent) {
            const content = extractToolContent(evt.message);
            if (!content) {
              return;
            }

            applySessionUpdate(sessionKey, (state) => ({
              ...state,
              messages: upsertToolMessage(
                state.messages,
                buildToolLabel(evt.message) ?? "tool",
                content,
              ),
            }));
            return;
          }

          get().finalizeStream(sessionKey);
          break;
        case "error":
        case "aborted":
          resetStreamingState(sessionKey);
          applySessionUpdate(sessionKey, (state) => ({
            ...state,
            streamingText: "",
            streamingTachie: null,
            streamingStyle: null,
            currentTachie: deriveTachieFromHistory(state.messages),
            isStreaming: false,
          }));
          break;
      }
    },

    finalizeStream: (sessionKey) => {
      const targetSessionKey = sessionKey ?? get().activeSessionKey;
      if (!targetSessionKey) {
        return;
      }

      const text = sessionRawStreamBuffers.get(targetSessionKey) ?? "";
      if (!text) {
        resetStreamingState(targetSessionKey);
        applySessionUpdate(targetSessionKey, (state) => ({
          ...state,
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

      resetStreamingState(targetSessionKey);
      applySessionUpdate(targetSessionKey, (state) => ({
        ...state,
        messages:
          nextMessage && !messagesEquivalent(state.messages.at(-1), nextMessage)
            ? dedupeMessages([...state.messages, nextMessage])
            : state.messages,
        streamingText: "",
        streamingTachie: null,
        streamingStyle: null,
        currentTachie: nextTachie,
        isStreaming: false,
        currentRunId: null,
        lastGeneratedAssistantMessageId: nextMessage?.id ?? null,
      }));
    },
  };
});
