// Chat operations: send, history, event handling

import crypto from "node:crypto";
import type { GatewayClient } from "./gateway-client.js";
import type { ChatEvent } from "./types.js";
import { parseEmotions } from "./emotion.js";

export class ChatManager {
  private currentRunId: string | null = null;
  private buffer = "";

  constructor(
    private client: GatewayClient,
    private sessionKey: string,
    private onDelta?: (text: string) => void,
    private onFinal?: (text: string, emotions: string[]) => void,
    private onError?: (msg: string) => void,
  ) {}

  handleChatEvent(payload: Record<string, unknown>): void {
    // Filter by session key
    const sk = payload.sessionKey as string | undefined;
    if (sk && sk !== this.sessionKey) return;

    const runId = payload.runId as string | undefined;
    if (!runId) return;

    // Two formats:
    // 1. "chat" event: {runId, sessionKey, seq, state:"delta"|"final", message:{role,content}}
    // 2. "agent" event: {runId, sessionKey, stream:"assistant", data:{text,delta}, seq}

    // Format 2: agent stream events
    if ("stream" in payload && "data" in payload) {
      const stream = payload.stream as string;
      const data = payload.data as { text?: string; delta?: string; phase?: string } | undefined;
      
      // Lifecycle end = run complete
      if (stream === "lifecycle" && data?.phase === "end") {
        this.finishCurrentRun();
        return;
      }
      
      if (stream === "assistant" && data?.delta) {
        if (this.currentRunId !== runId) {
          this.currentRunId = runId;
          this.buffer = "";
        }
        this.buffer += data.delta;
        this.onDelta?.(data.delta);
      }
      return;
    }

    // Format 1: chat events
    const evt = payload as unknown as ChatEvent;
    switch (evt.state) {
      case "delta":
        this.handleDelta(evt);
        break;
      case "final":
        this.handleFinal(evt);
        break;
      case "error":
        this.onError?.(evt.errorMessage ?? "unknown error");
        this.reset();
        break;
      case "aborted":
        this.onError?.("response aborted");
        this.reset();
        break;
    }
  }

  // Called when agent stream ends (no explicit "final" in agent events)
  // We detect this by a gap in events or a new runId
  finishCurrentRun(): void {
    if (this.buffer) {
      const parsed = parseEmotions(this.buffer);
      this.onFinal?.(parsed.text, parsed.emotions);
      this.reset();
    }
  }

  private handleDelta(evt: ChatEvent): void {
    const content = extractContent(evt.message);
    if (!content) return;

    if (this.currentRunId !== evt.runId) {
      this.currentRunId = evt.runId;
      this.buffer = "";
    }
    const newText = content.slice(this.buffer.length);
    this.buffer = content;
    if (newText) {
      this.onDelta?.(newText);
    }
  }

  private handleFinal(evt: ChatEvent): void {
    const content = extractContent(evt.message);
    const finalText = content || this.buffer;
    const parsed = parseEmotions(finalText);
    this.onFinal?.(parsed.text, parsed.emotions);
    this.reset();
  }

  private reset(): void {
    this.currentRunId = null;
    this.buffer = "";
  }

  async send(message: string): Promise<void> {
    await this.client.request("chat.send", {
      sessionKey: this.sessionKey,
      message,
      idempotencyKey: crypto.randomUUID(),
    });
  }

  async history(limit = 20): Promise<unknown[]> {
    const res = await this.client.request("chat.history", {
      sessionKey: this.sessionKey,
      limit,
    });
    return (res as { messages?: unknown[] }).messages ?? [];
  }
}

function extractContent(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const msg = message as Record<string, unknown>;
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((c: unknown) => typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "text")
      .map((c: unknown) => (c as Record<string, unknown>).text ?? "")
      .join("");
  }
  return null;
}
