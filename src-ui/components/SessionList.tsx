import { useGateway } from "../stores/gateway";
import { useChat } from "../stores/chat";
import { useSettings } from "../stores/settings";
import { broadcastSessionChange } from "../lib/window-sync";
import styles from "./SessionList.module.css";

function displayName(key: string, name?: string): string {
  if (name) return name;
  const parts = key.split(":");
  return parts[parts.length - 1] ?? key;
}

export function SessionList() {
  const sessions = useGateway((s) => s.sessions);
  const currentKey = useGateway((s) => s.currentSessionKey);
  const switchSession = useGateway((s) => s.switchSession);
  const clearMessages = useChat((s) => s.clearMessages);
  const loadHistory = useChat((s) => s.loadHistory);
  const updateSettings = useSettings((s) => s.update);

  const handleClick = (key: string) => {
    if (key === currentKey) return;
    switchSession(key);
    updateSettings({ sessionKey: key });
    void broadcastSessionChange(key);
    clearMessages();
    loadHistory(key);
  };

  if (sessions.length === 0) {
    return (
      <div className={styles.sidebar}>
        <div className={styles.empty}>No sessions</div>
      </div>
    );
  }

  return (
    <div className={styles.sidebar}>
      {sessions.map((s) => (
        <button
          key={s.key}
          className={`${styles.item} ${s.key === currentKey ? styles.active : ""}`}
          onClick={() => handleClick(s.key)}
          title={s.key}
        >
          {displayName(s.key, s.displayName)}
        </button>
      ))}
    </div>
  );
}
