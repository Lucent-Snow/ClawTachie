import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UIMessage } from "../lib/types";
import styles from "./MessageBubble.module.css";

export function MessageBubble({ message }: { message: UIMessage }) {
  const cls = message.role === "user" ? styles.user : styles.assistant;

  return (
    <div className={`${styles.bubble} ${cls}`}>
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
