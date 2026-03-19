import { useChat } from "../stores/chat";
import { useGateway } from "../stores/gateway";
import { useAutoScroll } from "../hooks/useAutoScroll";
import { getEmotionLabel } from "../lib/emotions";
import { MessageBubble } from "./MessageBubble";
import { Composer } from "./Composer";
import styles from "./ChatView.module.css";

export function ChatView() {
  const messages = useChat((s) => s.messages);
  const streamingText = useChat((s) => s.streamingText);
  const streamingEmotion = useChat((s) => s.streamingEmotion);
  const isStreaming = useChat((s) => s.isStreaming);
  const currentKey = useGateway((s) => s.currentSessionKey);
  const sessions = useGateway((s) => s.sessions);
  const status = useGateway((s) => s.status);

  const scrollRef = useAutoScroll([messages, streamingText]);

  const session = sessions.find((s) => s.key === currentKey);
  const model = session?.model;

  if (status !== "connected" && status !== "reconnecting") {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>Connect to Gateway to start chatting</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.infoBar}>
        <span>{currentKey ?? "no session"}</span>
        {model && <span className={styles.modelTag}>{model}</span>}
      </div>
      <div className={styles.messages} ref={scrollRef}>
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {isStreaming && (streamingText || streamingEmotion) && (
          <div className={styles.streaming}>
            {streamingEmotion && (
              <div className={styles.emotionTag}>
                &#9670; {getEmotionLabel(streamingEmotion)}
              </div>
            )}
            <div className={styles.streamingText}>{streamingText}</div>
            <span className={styles.cursor}>&#9612;</span>
          </div>
        )}
      </div>
      <Composer />
    </div>
  );
}
