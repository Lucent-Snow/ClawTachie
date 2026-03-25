import type { UIMessage } from "../lib/types";
import { getTachieLabel } from "../lib/emotions";
import { useSettings } from "../stores/settings";
import { AssistantMessageContent } from "./AssistantMessageContent";
import styles from "./MessageBubble.module.css";

export function MessageBubble({ message }: { message: UIMessage }) {
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
        <AssistantMessageContent
          content={message.content}
          toolLabel={message.toolLabel}
          forceToolBlock={isToolMessage}
        />
      ) : (
        <div className={styles.userText}>{message.content}</div>
      )}
    </div>
  );
}
