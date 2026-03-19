import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UIMessage } from "../lib/types";
import { getEmotionLabel } from "../lib/emotions";
import styles from "./MessageBubble.module.css";

export function MessageBubble({ message }: { message: UIMessage }) {
  const cls = message.role === "user" ? styles.user : styles.assistant;
  const emotion = message.role === "assistant" ? message.emotions.at(-1) : null;

  return (
    <div className={`${styles.bubble} ${cls}`}>
      {emotion && (
        <div className={styles.emotionTag} aria-label={`emotion ${emotion}`}>
          &#9670; {getEmotionLabel(emotion)}
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
