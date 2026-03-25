import { useChat } from "../stores/chat";
import { useGateway } from "../stores/gateway";
import { useSettings } from "../stores/settings";
import { useAutoScroll } from "../hooks/useAutoScroll";
import { getTachieLabel } from "../lib/emotions";
import { AssistantMessageContent } from "./AssistantMessageContent";
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

  const { scrollRef, isAtBottom, scrollToBottom, handleScroll } = useAutoScroll([
    messages,
    streamingText,
  ]);

  const session = sessions.find((s) => s.key === currentKey);
  const model = session?.model;

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
        {model && <span className={styles.modelTag}>{model}</span>}
      </div>
      <div className={styles.messagesShell}>
        <div className={styles.messages} ref={scrollRef} onScroll={handleScroll}>
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {isStreaming && (
            <div className={styles.streaming}>
              {petEnabled && streamingTachie && (
                <div className={styles.emotionTag}>
                  &#9670; {getTachieLabel(streamingTachie)}
                </div>
              )}
              <div className={styles.streamingBody}>
                {streamingText ? (
                  <AssistantMessageContent
                    content={streamingText}
                    className={styles.streamingMarkdown}
                  />
                ) : (
                  <div className={styles.thinkingDots} aria-label="AI thinking">
                    ……
                  </div>
                )}
                <span className={styles.cursor}>&#9612;</span>
              </div>
            </div>
          )}
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
