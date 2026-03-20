import { useCallback, useRef, useState } from "react";
import { useChat } from "../stores/chat";
import { useGateway } from "../stores/gateway";
import styles from "./Composer.module.css";

export function Composer() {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const isStreaming = useChat((s) => s.isStreaming);
  const send = useChat((s) => s.send);
  const abort = useChat((s) => s.abort);
  const status = useGateway((s) => s.status);
  const sessionKey = useGateway((s) => s.currentSessionKey);
  const connected = status === "connected";

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || !connected || !sessionKey) return;
    setText("");
    send(sessionKey, trimmed);
    ref.current?.focus();
  }, [text, connected, sessionKey, send]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={styles.wrapper}>
      <textarea
        ref={ref}
        className={styles.input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入消息..."
        disabled={!connected}
        rows={1}
      />
      {isStreaming ? (
        <button
          className={styles.stopBtn}
          onClick={() => sessionKey && abort(sessionKey)}
        >
          &#9632; 停止
        </button>
      ) : (
        <button
          className={styles.sendBtn}
          onClick={handleSend}
          disabled={!connected || !text.trim()}
        >
          发送
        </button>
      )}
    </div>
  );
}
