import { useCallback, useEffect, useRef, useState } from "react";
import { extractImageFiles, fileToImageAttachment } from "../lib/chat-attachments";
import type { UIAttachment } from "../lib/types";
import { useChat } from "../stores/chat";
import { useGateway } from "../stores/gateway";
import styles from "./Composer.module.css";

export function Composer() {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<UIAttachment[]>([]);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isStreaming = useChat((s) => s.isStreaming);
  const send = useChat((s) => s.send);
  const abort = useChat((s) => s.abort);
  const status = useGateway((s) => s.status);
  const sessionKey = useGateway((s) => s.currentSessionKey);
  const composerFocusToken = useGateway((s) => s.composerFocusToken);
  const connected = status === "connected";

  useEffect(() => {
    ref.current?.focus();
  }, [composerFocusToken]);

  const appendFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) {
      return;
    }

    const nextAttachments = await Promise.all(files.map((file) => fileToImageAttachment(file)));
    setAttachments((current) => [...current, ...nextAttachments]);
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || !connected || !sessionKey) return;
    setText("");
    setAttachments([]);
    send(sessionKey, trimmed, attachments);
    ref.current?.focus();
  }, [attachments, text, connected, sessionKey, send]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter((file) =>
      file.type.startsWith("image/"),
    );
    event.target.value = "";
    await appendFiles(files);
  };

  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = extractImageFiles(event.clipboardData.items);
    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    await appendFiles(files);
  };

  const handleDrop = async (event: React.DragEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.dataTransfer.files ?? []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    await appendFiles(files);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.composerColumn}>
        {attachments.length > 0 && (
          <div className={styles.previewRow}>
            {attachments.map((attachment) => (
              <div key={attachment.id} className={styles.previewCard}>
                <img
                  src={attachment.url}
                  alt={attachment.name ?? "attachment"}
                  className={styles.previewImage}
                />
                <button
                  type="button"
                  className={styles.removeAttachmentBtn}
                  onClick={() => {
                    setAttachments((current) =>
                      current.filter((item) => item.id !== attachment.id),
                    );
                  }}
                  aria-label={`移除 ${attachment.name ?? "图片附件"}`}
                >
                  ×
                </button>
                <div className={styles.previewLabel}>{attachment.name ?? "图片"}</div>
              </div>
            ))}
          </div>
        )}
        <div className={styles.inputRow}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className={styles.fileInput}
            onChange={(event) => void handleFileChange(event)}
          />
          <button
            type="button"
            className={styles.attachBtn}
            onClick={() => fileInputRef.current?.click()}
            disabled={!connected}
          >
            图片
          </button>
          <textarea
            ref={ref}
            className={styles.input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={(event) => void handlePaste(event)}
            onDragOver={(event) => {
              if (Array.from(event.dataTransfer.types).includes("Files")) {
                event.preventDefault();
              }
            }}
            onDrop={(event) => void handleDrop(event)}
            placeholder="输入消息，或粘贴/选择图片..."
            disabled={!connected}
            rows={1}
          />
        </div>
      </div>
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
          disabled={!connected || (!text.trim() && attachments.length === 0)}
        >
          发送
        </button>
      )}
    </div>
  );
}
