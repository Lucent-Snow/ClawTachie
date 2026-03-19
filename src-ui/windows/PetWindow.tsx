import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CharacterSprite } from "../components/CharacterSprite";
import { getEmotionLabel } from "../lib/emotions";
import { showMainWindow, startCurrentWindowDragging } from "../lib/tauri-gateway";
import { useChat } from "../stores/chat";
import { useGateway } from "../stores/gateway";
import styles from "./PetWindow.module.css";

const appWindow = getCurrentWindow();

export function PetWindow() {
  const [text, setText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [bubbleVisible, setBubbleVisible] = useState(false);

  const messages = useChat((state) => state.messages);
  const streamingText = useChat((state) => state.streamingText);
  const streamingEmotion = useChat((state) => state.streamingEmotion);
  const currentEmotion = useChat((state) => state.currentEmotion);
  const isStreaming = useChat((state) => state.isStreaming);
  const send = useChat((state) => state.send);
  const abort = useChat((state) => state.abort);

  const status = useGateway((state) => state.status);
  const sessionKey = useGateway((state) => state.currentSessionKey);

  const latestAssistant = useMemo(
    () => [...messages].reverse().find((message) => message.role === "assistant"),
    [messages],
  );

  const bubbleText = isStreaming ? streamingText : latestAssistant?.content ?? "";
  const bubbleEmotion =
    (isStreaming ? streamingEmotion : latestAssistant?.emotions.at(-1)) ?? currentEmotion;

  useEffect(() => {
    if (isStreaming && (streamingText || streamingEmotion)) {
      setBubbleVisible(true);
      return;
    }

    if (latestAssistant?.id) {
      setBubbleVisible(true);
      const timer = window.setTimeout(() => setBubbleVisible(false), 5000);
      return () => window.clearTimeout(timer);
    }

    setBubbleVisible(false);
    return undefined;
  }, [isStreaming, latestAssistant?.id, streamingEmotion, streamingText]);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || !sessionKey || status !== "connected") {
      return;
    }

    setText("");
    await send(sessionKey, trimmed);
  };

  const openMainWindow = async () => {
    await showMainWindow();
    setMenuOpen(false);
  };

  return (
    <div
      className={styles.shell}
      data-tauri-drag-region
      onClick={() => setMenuOpen(false)}
    >

      {bubbleVisible && (bubbleText || bubbleEmotion) && (
        <div className={`${styles.bubble} ${!isStreaming ? styles.fadeLater : ""}`}>
          {bubbleEmotion && (
            <div className={styles.emotionTag}>
              &#9670; {getEmotionLabel(bubbleEmotion)}
            </div>
          )}
          <div className={styles.bubbleText}>
            {bubbleText || (status === "connected" ? "..." : "Click Open to configure Gateway")}
            {isStreaming && <span className={styles.cursor}>&#9612;</span>}
          </div>
        </div>
      )}

      <div
        className={styles.spriteArea}
        onMouseDown={(event) => {
          if (event.button !== 0) {
            return;
          }

          void startCurrentWindowDragging();
        }}
        onDoubleClick={() => void openMainWindow()}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuOpen((open) => !open);
        }}
      >
        <CharacterSprite emotion={currentEmotion} alt="ClawTachie pet" />
      </div>

      {menuOpen && (
        <div
          className={styles.contextMenu}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button className={styles.contextItem} onClick={openMainWindow}>
            Open Main
          </button>
          <button className={styles.contextItem} onClick={() => appWindow.close()}>
            Exit
          </button>
        </div>
      )}

      <div
        className={styles.inputBar}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <textarea
          className={styles.input}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setText("");
              return;
            }

            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void handleSend();
            }
          }}
          placeholder={status === "connected" ? "Say something..." : "Open main window to connect"}
          disabled={status !== "connected"}
          rows={1}
        />
        {isStreaming ? (
          <button
            className={styles.sendButton}
            onClick={() => sessionKey && void abort(sessionKey)}
          >
            &#9632;
          </button>
        ) : (
          <button
            className={styles.sendButton}
            onClick={() => void handleSend()}
            disabled={!text.trim() || status !== "connected"}
          >
            &#8594;
          </button>
        )}
      </div>
    </div>
  );
}
