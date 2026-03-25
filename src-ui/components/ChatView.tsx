import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "../stores/chat";
import { useGateway } from "../stores/gateway";
import { useSettings } from "../stores/settings";
import { useAutoScroll } from "../hooks/useAutoScroll";
import { MessageBubble } from "./MessageBubble";
import { Composer } from "./Composer";
import styles from "./ChatView.module.css";

export function ChatView() {
  const messages = useChat((s) => s.messages);
  const streamingText = useChat((s) => s.streamingText);
  const streamingTachie = useChat((s) => s.streamingTachie);
  const isStreaming = useChat((s) => s.isStreaming);
  const petEnabled = useSettings((s) => s.pet.enabled);
  const currentKey = useGateway((s) => s.currentSessionKey);
  const sessions = useGateway((s) => s.sessions);
  const status = useGateway((s) => s.status);
  const updateSessionModel = useGateway((s) => s.updateSessionModel);
  const [modelDraft, setModelDraft] = useState("");
  const [isApplyingModel, setIsApplyingModel] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const modelRequestIdRef = useRef(0);

  const { scrollRef, isAtBottom, scrollToBottom, handleScroll } = useAutoScroll([
    messages,
    streamingText,
  ]);

  const session = sessions.find((s) => s.key === currentKey);
  const availableModels = useMemo(
    () => Array.from(new Set(sessions.map((item) => item.model?.trim()).filter(Boolean))),
    [sessions],
  );

  useEffect(() => {
    setModelDraft(session?.model ?? "");
    setModelError(null);
    setIsApplyingModel(false);
  }, [session?.key, session?.model]);

  const connected = status === "connected";
  const modelSwitchDisabled = !currentKey || !connected || isStreaming || isApplyingModel;
  const streamingMessage = isStreaming
    ? {
        id: "__streaming__",
        role: "assistant" as const,
        content: streamingText,
        tachie: petEnabled ? streamingTachie : null,
        style: null,
        timestamp: Date.now(),
        displayKind: "message" as const,
        toolLabel: null,
      }
    : null;

  const handleModelApply = async () => {
    if (!currentKey || !connected || isStreaming || isApplyingModel) {
      return;
    }

    const normalized = modelDraft.trim();
    if (normalized === (session?.model ?? "")) {
      setModelError(null);
      return;
    }

    const requestId = modelRequestIdRef.current + 1;
    modelRequestIdRef.current = requestId;
    setIsApplyingModel(true);
    setModelError(null);

    try {
      await updateSessionModel(currentKey, normalized);
    } catch (error) {
      if (modelRequestIdRef.current === requestId) {
        setModelError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (modelRequestIdRef.current === requestId) {
        setIsApplyingModel(false);
      }
    }
  };

  if (status !== "connected" && status !== "reconnecting") {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>请先连接网关</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.infoBar}>
        <span className={styles.infoLabel}>模型</span>
        <input
          className={styles.modelInput}
          list="chat-model-options"
          value={modelDraft}
          onChange={(event) => setModelDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void handleModelApply();
            }
          }}
          placeholder="输入模型名"
          disabled={modelSwitchDisabled}
        />
        <datalist id="chat-model-options">
          {availableModels.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
        <button
          type="button"
          className={styles.modelApplyBtn}
          onClick={() => void handleModelApply()}
          disabled={modelSwitchDisabled}
        >
          {isApplyingModel ? "切换中..." : "切换"}
        </button>
        {session?.modelProvider && (
          <span className={styles.modelMeta}>{session.modelProvider}</span>
        )}
        {modelError && <span className={styles.modelError}>{modelError}</span>}
      </div>
      <div className={styles.messagesShell}>
        <div className={styles.messages} ref={scrollRef} onScroll={handleScroll}>
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {streamingMessage && <MessageBubble key={streamingMessage.id} message={streamingMessage} isStreaming />}
        </div>
        {!isAtBottom && (
          <button
            className={styles.scrollToBottomBtn}
            onClick={scrollToBottom}
            type="button"
          >
            回到底部
          </button>
        )}
      </div>
      <Composer />
    </div>
  );
}
