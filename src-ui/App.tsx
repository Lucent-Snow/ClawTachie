import { useCallback, useEffect, useRef, useState } from "react";
import { parseEmotions } from "./lib/emotion";
import type { ChatEvent } from "./lib/types";
import {
  gatewayConnect,
  gatewayDisconnect,
  gatewaySendMessage,
  hasTauriBackend,
  subscribeGatewayEvents,
} from "./lib/tauri-gateway";

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

export function App() {
  const [url, setUrl] = useState("ws://127.0.0.1:18789");
  const [token, setToken] = useState("");
  const [sessionKey, setSessionKey] = useState("agent:main:clawtachie");
  const [status, setStatus] = useState("disconnected");
  const [message, setMessage] = useState("");
  const [output, setOutput] = useState("");
  const [emotions, setEmotions] = useState<string[]>([]);
  const [log, setLog] = useState<string[]>([]);

  const bufferRef = useRef("");
  const respondingRef = useRef(false);
  const tauriReady = hasTauriBackend();

  const appendLog = useCallback((text: string) => {
    setLog((prev) => [...prev.slice(-50), text]);
  }, []);

  const handleChatEvent = useCallback(
    (payload: Record<string, unknown>) => {
      const sk = payload.sessionKey as string | undefined;
      // Filter by our session key — allow if not set or matches
      if (sk && sk !== sessionKey) return;

      // Format 2: agent stream events
      if ("stream" in payload && "data" in payload) {
        const stream = payload.stream as string;
        const data = payload.data as
          | { text?: string; delta?: string; phase?: string }
          | undefined;

        if (stream === "lifecycle" && data?.phase === "end") {
          // Run complete
          const parsed = parseEmotions(bufferRef.current);
          setEmotions(parsed.emotions);
          setOutput(parsed.text);
          respondingRef.current = false;
          appendLog("[lifecycle] run ended");
          return;
        }

        if (stream === "assistant" && data?.delta) {
          respondingRef.current = true;
          bufferRef.current += data.delta;
          setOutput(bufferRef.current);
        }
        return;
      }

      // Format 1: chat events
      const evt = payload as unknown as ChatEvent;
      switch (evt.state) {
        case "delta": {
          respondingRef.current = true;
          const content = extractContent(evt.message);
          if (content) {
            bufferRef.current = content;
            setOutput(content);
          }
          break;
        }
        case "final": {
          const content = extractContent(evt.message) || bufferRef.current;
          const parsed = parseEmotions(content);
          setOutput(parsed.text);
          setEmotions(parsed.emotions);
          bufferRef.current = "";
          respondingRef.current = false;
          appendLog("[chat] final received");
          break;
        }
        case "error":
          appendLog(`[error] ${evt.errorMessage ?? "unknown"}`);
          bufferRef.current = "";
          respondingRef.current = false;
          break;
        case "aborted":
          appendLog("[aborted]");
          bufferRef.current = "";
          respondingRef.current = false;
          break;
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [sessionKey, appendLog],
  );

  useEffect(() => {
    let cancelled = false;
    let unlisteners: (() => void)[] = [];

    void subscribeGatewayEvents({
      onChatEvent: (payload) => {
        handleChatEvent(payload);
      },
      onRunEnd: () => {
        if (respondingRef.current) {
          const parsed = parseEmotions(bufferRef.current);
          setOutput(parsed.text);
          setEmotions(parsed.emotions);
          bufferRef.current = "";
          respondingRef.current = false;
          appendLog("[agent.run.completed]");
        }
      },
      onDisconnected: ({ code, reason }) => {
        setStatus(`disconnected (${code} ${reason})`);
        appendLog(`disconnected: ${code} ${reason}`);
      },
      onError: ({ message: errorMessage }) => {
        setStatus(`error: ${errorMessage}`);
        appendLog(`error: ${errorMessage}`);
      },
    }).then((cleanupFns) => {
      if (cancelled) {
        cleanupFns.forEach((cleanup) => cleanup());
        return;
      }
      unlisteners = cleanupFns;
    });

    return () => {
      cancelled = true;
      unlisteners.forEach((cleanup) => cleanup());
    };
  }, [appendLog, handleChatEvent]);

  const handleConnect = useCallback(async () => {
    if (!tauriReady) {
      setStatus("tauri backend unavailable");
      appendLog("error: Tauri backend unavailable");
      return;
    }

    if (!token) {
      appendLog("error: token is required");
      return;
    }

    setStatus("connecting");
    appendLog(`connecting to ${url}...`);

    try {
      const hello = await gatewayConnect(url, token);
      setStatus(`connected, protocol ${hello.protocol}`);
      appendLog(`connected! protocol=${hello.protocol}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(`error: ${message}`);
      appendLog(`error: ${message}`);
    }
  }, [appendLog, tauriReady, token, url]);

  const handleDisconnect = useCallback(async () => {
    try {
      await gatewayDisconnect();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog(`disconnect failed: ${message}`);
    }
    setStatus("disconnected");
  }, [appendLog]);

  const handleSend = useCallback(async () => {
    if (!status.startsWith("connected") || !message.trim()) return;

    const text = message.trim();
    setMessage("");
    bufferRef.current = "";
    setOutput("");
    setEmotions([]);
    appendLog(`> ${text}`);

    try {
      await gatewaySendMessage(sessionKey, text);
    } catch (err) {
      appendLog(`send failed: ${err}`);
    }
  }, [appendLog, message, sessionKey, status]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  return (
    <main
      style={{
        padding: 24,
        fontFamily: "monospace",
        maxWidth: 720,
        margin: "0 auto",
      }}
    >
      <h2>ClawTachie — Data Layer PoC</h2>

      {/* Connection config */}
      <fieldset style={{ marginBottom: 16 }}>
        <legend>Gateway Connection</legend>
        <div style={{ marginBottom: 8 }}>
          <label>URL: </label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            style={{ width: 300 }}
          />
        </div>
        <div style={{ marginBottom: 8 }}>
          <label>Token: </label>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            style={{ width: 300 }}
          />
        </div>
        <div style={{ marginBottom: 8 }}>
          <label>Session: </label>
          <input
            value={sessionKey}
            onChange={(e) => setSessionKey(e.target.value)}
            style={{ width: 300 }}
          />
        </div>
        <button
          onClick={() => void handleConnect()}
          disabled={status.startsWith("connect")}
        >
          Connect
        </button>{" "}
        <button onClick={() => void handleDisconnect()}>Disconnect</button>
        <div style={{ marginTop: 8, fontWeight: "bold" }}>Status: {status}</div>
        {!tauriReady && (
          <div style={{ marginTop: 8, color: "#8b0000" }}>
            This screen requires the Tauri backend. Open it through `npm run
            tauri:dev`.
          </div>
        )}
      </fieldset>

      {/* Chat */}
      <fieldset style={{ marginBottom: 16 }}>
        <legend>Chat</legend>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            style={{ flex: 1 }}
            disabled={!status.startsWith("connected")}
          />
          <button
            onClick={() => void handleSend()}
            disabled={!status.startsWith("connected")}
          >
            Send
          </button>
        </div>

        {/* Streaming output */}
        <div style={{ marginBottom: 8 }}>
          <strong>Response:</strong>
          <pre
            style={{
              background: "#f0f0f0",
              padding: 12,
              minHeight: 100,
              maxHeight: 300,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {output || "(waiting for response...)"}
            {respondingRef.current && (
              <span style={{ animation: "blink 1s infinite" }}>▌</span>
            )}
          </pre>
        </div>

        {/* Emotion tags */}
        {emotions.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <strong>Emotions: </strong>
            {emotions.map((e, i) => (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  padding: "2px 8px",
                  margin: "0 4px",
                  background: "#004789",
                  color: "white",
                  fontSize: 12,
                }}
              >
                ◆ {e}
              </span>
            ))}
          </div>
        )}
      </fieldset>

      {/* Debug log */}
      <fieldset>
        <legend>Log</legend>
        <pre
          style={{
            background: "#1a1a2e",
            color: "#a0b0c0",
            padding: 12,
            minHeight: 80,
            maxHeight: 200,
            overflow: "auto",
            fontSize: 11,
            whiteSpace: "pre-wrap",
          }}
        >
          {log.join("\n") || "(no events yet)"}
        </pre>
      </fieldset>
    </main>
  );
}
