import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UIMessage } from "../lib/types";
import { getTachieLabel } from "../lib/emotions";
import styles from "./MessageBubble.module.css";

export function MessageBubble({ message }: { message: UIMessage }) {
  const cls = message.role === "user" ? styles.user : styles.assistant;
  const tachie = message.role === "assistant" ? message.tachie : null;

  return (
    <div className={`${styles.bubble} ${cls}`}>
      <div className={styles.meta}>
        {message.role === "user" ? "我 \u25C6" : "\u25C6 助手"}
      </div>
      {tachie && (
        <div className={styles.emotionTag} aria-label={`tachie ${tachie}`}>
          &#9670; {getTachieLabel(tachie)}
        </div>
      )}
      {message.role === "assistant" ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {message.content}
        </ReactMarkdown>
      ) : (
        message.content
      )}
    </div>
  );
}
