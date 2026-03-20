import { useMemo } from "react";
import { useGateway } from "../stores/gateway";
import { useSettings } from "../stores/settings";
import { broadcastSessionChange } from "../lib/window-sync";
import type { SessionRow } from "../lib/types";
import styles from "./SessionList.module.css";

/** Extract agent name from session key like "agent:clawtachie:main" → "clawtachie" */
function agentName(key: string): string {
  const parts = key.split(":");
  const [first = key, second = key] = parts;
  // "agent:<name>:<session>" or "<name>:<session>" or just "<key>"
  if (parts.length >= 3 && first === "agent") return second;
  if (parts.length >= 2) return first;
  return key;
}

function sessionLabel(s: SessionRow): string {
  return s.displayName || s.key.split(":").pop() || s.key;
}

interface AgentGroup {
  agent: string;
  sessions: SessionRow[];
}

export function SessionList() {
  const sessions = useGateway((s) => s.sessions);
  const currentKey = useGateway((s) => s.currentSessionKey);
  const switchSession = useGateway((s) => s.switchSession);
  const defaultSessionKey = useSettings((s) => s.gateway.sessionKey);

  const groups = useMemo(() => {
    const map = new Map<string, SessionRow[]>();
    for (const s of sessions) {
      const agent = agentName(s.key);
      const list = map.get(agent) ?? [];
      list.push(s);
      map.set(agent, list);
    }

    const result: AgentGroup[] = [];
    const defaultAgent = agentName(defaultSessionKey);

    // Default agent group first
    if (map.has(defaultAgent)) {
      const list = map.get(defaultAgent)!;
      // Within group, default session first
      list.sort((a, b) =>
        a.key === defaultSessionKey ? -1 : b.key === defaultSessionKey ? 1 : 0,
      );
      result.push({ agent: defaultAgent, sessions: list });
      map.delete(defaultAgent);
    }

    // Remaining groups
    for (const [agent, list] of map) {
      result.push({ agent, sessions: list });
    }

    return result;
  }, [sessions, defaultSessionKey]);

  const handleClick = (key: string) => {
    if (key === currentKey) return;
    switchSession(key);
    void broadcastSessionChange(key);
  };

  if (sessions.length === 0) {
    return (
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <div className={styles.headerEn}>SESSIONS</div>
          <div className={styles.headerJa}>会话列表</div>
        </div>
        <div className={styles.empty}>暂无会话</div>
      </div>
    );
  }

  return (
    <div className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <div className={styles.headerEn}>SESSIONS</div>
        <div className={styles.headerJa}>会话列表</div>
      </div>
      {groups.map((g) => (
        <div key={g.agent} className={styles.group}>
          <div className={styles.groupHeader}>{g.agent}</div>
          {g.sessions.map((s) => (
            <button
              key={s.key}
              className={`${styles.item} ${s.key === currentKey ? styles.active : ""} ${s.key === defaultSessionKey ? styles.default : ""}`}
              onClick={() => handleClick(s.key)}
              title={s.key}
            >
              {sessionLabel(s)}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
