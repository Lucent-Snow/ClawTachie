import type { UIMessage } from "../lib/types";
import { getTachieLabel } from "../lib/emotions";
import { useSettings } from "../stores/settings";
import { AssistantMessageContent } from "./AssistantMessageContent";
import styles from "./MessageBubble.module.css";

export function MessageBubble({
  message,
  isStreaming = false,
}: {
  message: UIMessage;
  isStreaming?: boolean;
}) {
  const petEnabled = useSettings((s) => s.pet.enabled);
  const isToolMessage = message.displayKind === "tool";
  const cls = message.role === "user"
    ? styles.user
    : isToolMessage
      ? styles.tool
      : styles.assistant;
  const tachie = petEnabled && message.role === "assistant" ? message.tachie : null;

  return (
    <div className={`${styles.bubble} ${cls}`}>
      <div className={styles.meta}>
        {message.role === "user"
          ? "我 \u25C6"
          : isToolMessage
            ? "\u25C6 工具"
            : "\u25C6 助手"}
      </div>
      {tachie && (
        <div className={styles.emotionTag} aria-label={`tachie ${tachie}`}>
          &#9670; {getTachieLabel(tachie)}
        </div>
      )}
      {message.role === "assistant" ? (
        <div className={styles.assistantContent}>
          {message.content.trim() ? (
            <AssistantMessageContent
              content={message.content}
              toolLabel={message.toolLabel}
              forceToolBlock={isToolMessage}
            />
          ) : isStreaming ? (
            <div className={styles.thinkingDots} aria-label="AI thinking">
              ……
            </div>
          ) : null}
          {isStreaming && message.content.trim() && (
            <span className={styles.cursor} aria-hidden="true">
              &#9612;
            </span>
          )}
        </div>
      ) : (
        <div className={styles.userText}>{message.content}</div>
      )}
    </div>
  );
}
