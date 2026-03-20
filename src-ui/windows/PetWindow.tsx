import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize, LogicalPosition } from "@tauri-apps/api/dpi";
import { CharacterSprite } from "../components/CharacterSprite";
import { getTachieLabel, type TachieName } from "../lib/emotions";
import {
  exitApp,
  showMainWindow,
  startCurrentWindowDragging,
} from "../lib/tauri-gateway";
import { useChat } from "../stores/chat";
import { useGateway } from "../stores/gateway";
import { useSettings } from "../stores/settings";
import { useTts } from "../stores/tts";
import styles from "./PetWindow.module.css";

const PET_PLAYBACK_CPS = 12;
const MIN_SPRITE_SCALE = 0.6;
const MAX_SPRITE_SCALE = Infinity;
const SPRITE_SCALE_STEP = 0.05;
const PET_SPRITE_BASE_WIDTH = 320;
const PET_SPRITE_BASE_HEIGHT = 620;
const PET_DIALOG_HEIGHT = 120;
const PET_INPUT_HEIGHT = 62;
const PET_PADDING_X = 24; // 12px * 2
const PET_PADDING_BOTTOM = 12;
const PET_MIN_WIDTH = 280;

interface ContextMenuState {
  x: number;
  y: number;
}

const petWindow = getCurrentWindow();

export function PetWindow() {
  const [text, setText] = useState("");
  const [inputVisible, setInputVisible] = useState(false);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [playbackText, setPlaybackText] = useState("");
  const [playbackTachie, setPlaybackTachie] = useState<TachieName | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const playbackTimerRef = useRef<number | null>(null);
  const playbackVersionRef = useRef(0);

  const messages = useChat((state) => state.messages);
  const currentTachie = useChat((state) => state.currentTachie);
  const isStreaming = useChat((state) => state.isStreaming);
  const latestGeneratedAssistantMessageId = useChat(
    (state) => state.lastGeneratedAssistantMessageId,
  );
  const send = useChat((state) => state.send);
  const abort = useChat((state) => state.abort);
  const speakMessage = useTts((state) => state.speakMessage);
  const stopSpeaking = useTts((state) => state.stop);
  const spriteScale = useSettings((state) => state.pet.spriteScale);
  const updatePetSettings = useSettings((state) => state.updatePet);

  const status = useGateway((state) => state.status);
  const sessionKey = useGateway((state) => state.currentSessionKey);

  const latestAssistant = useMemo(
    () =>
      latestGeneratedAssistantMessageId
        ? messages.find(
            (message) =>
              message.id === latestGeneratedAssistantMessageId && message.role === "assistant",
          ) ?? null
        : null,
    [latestGeneratedAssistantMessageId, messages],
  );
  const latestMessage = messages.at(-1) ?? null;

  // --- Resize helper ---
  // anchorBottom=true: grow upward (for sprite scaling, feet stay put)
  // anchorBottom=false: grow downward (for input toggle, sprite stays put)
  const resizeWindow = useCallback(async (scale: number, withInput: boolean, anchorBottom: boolean) => {
    const spriteW = Math.round(PET_SPRITE_BASE_WIDTH * scale);
    const spriteH = Math.round(PET_SPRITE_BASE_HEIGHT * scale);
    const targetW = Math.max(spriteW + PET_PADDING_X, PET_MIN_WIDTH);
    const targetH = spriteH + PET_DIALOG_HEIGHT + (withInput ? PET_INPUT_HEIGHT : 0) + PET_PADDING_BOTTOM;

    try {
      const scaleFactor = await petWindow.scaleFactor();
      const pos = await petWindow.outerPosition();
      const size = await petWindow.outerSize();
      const oldLogicalH = size.height / scaleFactor;
      const deltaH = targetH - oldLogicalH;

      await petWindow.setSize(new LogicalSize(targetW, targetH));
      if (anchorBottom && Math.abs(deltaH) > 1) {
        await petWindow.setPosition(
          new LogicalPosition(pos.x / scaleFactor, pos.y / scaleFactor - deltaH),
        );
      }
    } catch {
      // Window API may fail during init
    }
  }, []);

  // --- Cursor passthrough: transparent areas let mouse through ---
  const hoverCountRef = useRef(0);
  const onInteractiveEnter = useCallback(() => {
    hoverCountRef.current += 1;
    if (hoverCountRef.current === 1) {
      void petWindow.setIgnoreCursorEvents(false);
    }
  }, []);
  const onInteractiveLeave = useCallback(() => {
    hoverCountRef.current = Math.max(0, hoverCountRef.current - 1);
    if (hoverCountRef.current === 0) {
      void petWindow.setIgnoreCursorEvents(true);
    }
  }, []);

  // Enable passthrough by default on mount
  useEffect(() => {
    void petWindow.setIgnoreCursorEvents(true);
  }, []);

  // --- Toggle input: resize window first, then show/hide ---
  const toggleInput = useCallback(async () => {
    const next = !inputVisible;
    if (next) {
      await resizeWindow(spriteScale, true, false);
      setInputVisible(true);
    } else {
      setInputVisible(false);
      void resizeWindow(spriteScale, false, false);
    }
  }, [inputVisible, spriteScale, resizeWindow]);

  // Auto-focus input when shown
  useEffect(() => {
    if (!inputVisible) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [inputVisible]);

  // Suppress native context menu
  useEffect(() => {
    const handler = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("contextmenu", handler);
    return () => window.removeEventListener("contextmenu", handler);
  }, []);

  // Window dragging via mouse move
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const dragStart = dragStartRef.current;
      if (!dragStart || (event.buttons & 1) !== 1) return;

      const movedX = Math.abs(event.clientX - dragStart.x);
      const movedY = Math.abs(event.clientY - dragStart.y);
      if (movedX < 4 && movedY < 4) return;

      dragStartRef.current = null;
      void startCurrentWindowDragging();
    };

    const clearDragState = () => { dragStartRef.current = null; };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", clearDragState);
    window.addEventListener("blur", clearDragState);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", clearDragState);
      window.removeEventListener("blur", clearDragState);
    };
  }, []);

  // Cleanup playback timer
  useEffect(() => {
    return () => {
      if (playbackTimerRef.current) window.clearInterval(playbackTimerRef.current);
    };
  }, []);

  // Resize window when sprite scale changes (anchor bottom — feet stay put)
  useEffect(() => {
    void resizeWindow(spriteScale, inputVisible, true);
  }, [spriteScale, resizeWindow, inputVisible]);

  // Reset playback on session change
  useEffect(() => {
    playbackVersionRef.current += 1;
    if (playbackTimerRef.current) {
      window.clearInterval(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    setPlaybackText("");
    setPlaybackTachie(null);
    stopSpeaking();
  }, [sessionKey, stopSpeaking]);

  // Reset playback when user sends a message (keep dialog visible, just clear text)
  useEffect(() => {
    if (!latestMessage || latestMessage.role !== "user") return;

    playbackVersionRef.current += 1;
    if (playbackTimerRef.current) {
      window.clearInterval(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    setPlaybackText("");
    setPlaybackTachie(null);
    stopSpeaking();
  }, [latestMessage, stopSpeaking]);

  // Playback assistant message character by character
  useEffect(() => {
    if (!latestAssistant) return;

    const version = playbackVersionRef.current + 1;
    playbackVersionRef.current = version;

    if (playbackTimerRef.current) {
      window.clearInterval(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }

    setPlaybackText("");
    setPlaybackTachie(latestAssistant.tachie);

    const characters = Array.from(latestAssistant.content);
    const intervalMs = Math.max(1000 / PET_PLAYBACK_CPS, 16);

    void (async () => {
      await speakMessage(latestAssistant);
      if (playbackVersionRef.current !== version) return;

      if (characters.length === 0) {
        setPlaybackText("");
        return;
      }

      let index = 0;
      playbackTimerRef.current = window.setInterval(() => {
        if (playbackVersionRef.current !== version) {
          if (playbackTimerRef.current) {
            window.clearInterval(playbackTimerRef.current);
            playbackTimerRef.current = null;
          }
          return;
        }

        index += 1;
        setPlaybackText(characters.slice(0, index).join(""));

        if (index >= characters.length && playbackTimerRef.current) {
          window.clearInterval(playbackTimerRef.current);
          playbackTimerRef.current = null;
        }
      }, intervalMs);
    })();
  }, [latestAssistant, speakMessage]);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || !sessionKey || status !== "connected") return;

    playbackVersionRef.current += 1;
    if (playbackTimerRef.current) {
      window.clearInterval(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    setPlaybackText("");
    setPlaybackTachie(null);
    setText("");
    setInputVisible(false);
    void resizeWindow(spriteScale, false, false);
    await send(sessionKey, trimmed);
  };

  const openMainWindow = async () => {
    setMenu(null);
    await showMainWindow();
  };

  const handleExit = async () => {
    setMenu(null);
    await exitApp();
  };

  // Sprite rendered at natural scale — no fit clamping
  const spriteH = Math.round(PET_SPRITE_BASE_HEIGHT * spriteScale);
  const spriteFrameStyle = {
    width: `${Math.round(PET_SPRITE_BASE_WIDTH * spriteScale)}px`,
    height: `${spriteH}px`,
  };

  return (
    <div
      className={styles.shell}
      onClick={() => {
        dragStartRef.current = null;
        setMenu(null);
      }}
    >
      {/* Sprite area — fixed height, not affected by input */}
      <div className={styles.spriteArea} style={{ height: `${spriteH}px` }}>
        <div
          className={styles.spriteScaleFrame}
          style={spriteFrameStyle}
          onMouseEnter={onInteractiveEnter}
          onMouseLeave={onInteractiveLeave}
          onWheel={(event) => {
            event.preventDefault();
            event.stopPropagation();

            const delta = event.deltaY < 0 ? SPRITE_SCALE_STEP : -SPRITE_SCALE_STEP;
            const nextScale = Math.min(
              MAX_SPRITE_SCALE,
              Math.max(MIN_SPRITE_SCALE, Number((spriteScale + delta).toFixed(2))),
            );

            if (nextScale !== spriteScale) {
              updatePetSettings({ spriteScale: nextScale });
            }
          }}
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            dragStartRef.current = { x: event.clientX, y: event.clientY };
            setMenu(null);
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            dragStartRef.current = null;
            setMenu(null);
            void toggleInput();
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            dragStartRef.current = null;
            setMenu({
              x: Math.min(event.clientX, window.innerWidth - 172),
              y: Math.min(event.clientY, window.innerHeight - 112),
            });
          }}
        >
          <CharacterSprite tachie={currentTachie} alt="ClawTachie pet" />
        </div>
      </div>

      {/* Context menu */}
      {menu && (
        <div
          className={styles.contextMenu}
          style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
          onMouseEnter={onInteractiveEnter}
          onMouseLeave={onInteractiveLeave}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button className={styles.contextItem} onClick={() => void openMainWindow()}>
            Open Main
          </button>
          <button className={styles.contextItem} onClick={() => void handleExit()}>
            Exit
          </button>
        </div>
      )}

      {/* Dialog panel — always rendered */}
      <div
        className={styles.dialogPanel}
        onMouseEnter={onInteractiveEnter}
        onMouseLeave={onInteractiveLeave}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={styles.dialogBody}>
          {playbackTachie && (
            <div className={styles.emotionTag}>
              &#9670; {getTachieLabel(playbackTachie)}
            </div>
          )}
          <div className={styles.bubbleText}>{playbackText}</div>
        </div>
      </div>

      {/* Input bar — independent toggle on double-click */}
      {inputVisible && (
        <div
          className={styles.inputBar}
          onMouseEnter={onInteractiveEnter}
          onMouseLeave={onInteractiveLeave}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <textarea
            ref={inputRef}
            className={styles.input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setText("");
                setInputVisible(false);
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
              onClick={() => {
                setInputVisible(false);
                sessionKey && void abort(sessionKey);
              }}
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
      )}
    </div>
  );
}
