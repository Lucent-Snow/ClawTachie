import { useEffect, useMemo, useRef, useState } from "react";
import {
  gatewayModelsList,
  type GatewayModelOption,
} from "../lib/tauri-gateway";
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
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [catalogModels, setCatalogModels] = useState<GatewayModelOption[]>([]);
  const [modelError, setModelError] = useState<string | null>(null);
  const modelRequestIdRef = useRef(0);

  const { scrollRef, isAtBottom, scrollToBottom, handleScroll } = useAutoScroll([
    messages,
    streamingText,
  ]);

  const session = sessions.find((s) => s.key === currentKey);
  const availableModels = useMemo(() => {
    const options = new Map<string, { value: string; label: string }>();

    for (const option of catalogModels) {
      const value = option.id.trim();
      if (!value || options.has(value)) {
        continue;
      }

      options.set(value, {
        value,
        label: option.label || value,
      });
    }

    return Array.from(options.values());
  }, [catalogModels]);

  const selectedKnownModel = useMemo(() => {
    const normalized = modelDraft.trim();
    return availableModels.some((option) => option.value === normalized) ? normalized : "";
  }, [availableModels, modelDraft]);

  const currentModelMissing =
    Boolean(session?.model) &&
    !availableModels.some((option) => option.value === session?.model);

  useEffect(() => {
    setModelDraft(session?.model ?? "");
    setModelError(null);
    setIsApplyingModel(false);
  }, [session?.key, session?.model]);

  useEffect(() => {
    let cancelled = false;

    const loadModelCatalog = async () => {
      if (status !== "connected" && status !== "reconnecting") {
        setCatalogModels([]);
        setIsLoadingModels(false);
        return;
      }

      setIsLoadingModels(true);

      try {
        const models = await gatewayModelsList();
        if (!cancelled) {
          setCatalogModels(models);
        }
      } catch {
        if (!cancelled) {
          setCatalogModels([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingModels(false);
        }
      }
    };

    void loadModelCatalog();

    return () => {
      cancelled = true;
    };
  }, [status]);

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
        <select
          className={styles.modelSelect}
          value={selectedKnownModel}
          onChange={(event) => {
            setModelDraft(event.target.value);
            setModelError(null);
          }}
          disabled={modelSwitchDisabled || availableModels.length === 0}
        >
          <option value="">
            {isLoadingModels
              ? "读取模型列表中..."
              : availableModels.length > 0
                ? "选择要切换的模型"
                : "未发现模型列表"}
          </option>
          {availableModels.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={styles.modelApplyBtn}
          onClick={() => void handleModelApply()}
          disabled={modelSwitchDisabled || !selectedKnownModel}
        >
          {isApplyingModel ? "切换中..." : "切换"}
        </button>
        <span className={styles.modelHint}>
          {isLoadingModels
            ? "正在同步模型候选..."
            : availableModels.length > 0
              ? `候选 ${availableModels.length} 个`
              : "网关没有返回可选模型列表"}
        </span>
        {currentModelMissing && (
          <span className={styles.modelHint}>
            当前模型 {session?.model} 不在可选列表中
          </span>
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
