import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useChat } from "../stores/chat";
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
  return s.displayName || s.label || s.key.split(":").pop() || s.key;
}

interface AgentGroup {
  agent: string;
  sessions: SessionRow[];
}

interface SessionMenuState {
  key: string;
  x: number;
  y: number;
}

export function SessionList() {
  const clearMessages = useChat((s) => s.clearMessages);
  const sessions = useGateway((s) => s.sessions);
  const currentKey = useGateway((s) => s.currentSessionKey);
  const status = useGateway((s) => s.status);
  const switchSession = useGateway((s) => s.switchSession);
  const createSession = useGateway((s) => s.createSession);
  const resetSession = useGateway((s) => s.resetSession);
  const deleteSession = useGateway((s) => s.deleteSession);
  const renameSession = useGateway((s) => s.renameSession);
  const defaultSessionKey = useSettings((s) => s.gateway.sessionKey);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [menu, setMenu] = useState<SessionMenuState | null>(null);
  const connected = status === "connected" || status === "reconnecting";

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

  useEffect(() => {
    if (!menu) {
      return;
    }

    const closeMenu = () => setMenu(null);
    const handleWindowBlur = () => closeMenu();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menu]);

  const handleClick = (key: string) => {
    if (key === currentKey) return;
    switchSession(key);
    void broadcastSessionChange(key);
  };

  const handleCreate = async () => {
    if (!connected) return;
    const key = await createSession();
    setEditingKey(key);
    setDraftLabel("");
    void broadcastSessionChange(key);
  };

  const beginRename = (session: SessionRow) => {
    setMenu(null);
    setEditingKey(session.key);
    setDraftLabel(session.displayName || session.label || "");
  };

  const cancelRename = () => {
    setEditingKey(null);
    setDraftLabel("");
  };

  const commitRename = async () => {
    if (!editingKey) return;
    const key = editingKey;
    const normalized = draftLabel.trim();
    cancelRename();
    await renameSession(key, normalized);
  };

  const handleReset = async (key: string) => {
    setMenu(null);
    await resetSession(key);
    if (key === currentKey) {
      clearMessages();
    }
  };

  const handleDelete = async (key: string) => {
    setMenu(null);
    if (!window.confirm("删除这个会话？这会移除当前 session 记录。")) {
      return;
    }
    const nextKey = await deleteSession(key);
    if (key === currentKey) {
      clearMessages();
      if (nextKey) {
        void broadcastSessionChange(nextKey);
      }
    }
  };

  const openMenu = (event: MouseEvent, session: SessionRow) => {
    event.preventDefault();
    event.stopPropagation();

    const menuWidth = 180;
    const menuHeight = 132;
    const padding = 12;
    const x = Math.min(event.clientX, window.innerWidth - menuWidth - padding);
    const y = Math.min(event.clientY, window.innerHeight - menuHeight - padding);

    setMenu({
      key: session.key,
      x: Math.max(padding, x),
      y: Math.max(padding, y),
    });
  };

  const menuSession = menu ? sessions.find((session) => session.key === menu.key) ?? null : null;

  if (sessions.length === 0) {
    return (
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <div>
            <div className={styles.headerEn}>SESSIONS</div>
            <div className={styles.headerJa}>会话列表</div>
          </div>
          <button
            className={styles.createBtn}
            onClick={() => void handleCreate()}
            title="新建会话"
            disabled={!connected}
          >
            +
          </button>
        </div>
        <div className={styles.empty}>暂无会话</div>
      </div>
    );
  }

  return (
    <div className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <div>
          <div className={styles.headerEn}>SESSIONS</div>
          <div className={styles.headerJa}>会话列表</div>
        </div>
        <button
          className={styles.createBtn}
          onClick={() => void handleCreate()}
          title="新建会话"
          disabled={!connected}
        >
          +
        </button>
      </div>
      {groups.map((g) => (
        <div key={g.agent} className={styles.group}>
          <div className={styles.groupHeader}>{g.agent}</div>
          {g.sessions.map((s) => (
            <div
              key={s.key}
              className={`${styles.itemRow} ${s.key === currentKey ? styles.active : ""} ${s.key === defaultSessionKey ? styles.default : ""}`}
              title={s.key}
              onContextMenu={(event) => openMenu(event, s)}
            >
              {editingKey === s.key ? (
                <div className={styles.renameRow}>
                  <input
                    className={styles.renameInput}
                    value={draftLabel}
                    onChange={(event) => setDraftLabel(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void commitRename();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelRename();
                      }
                    }}
                    placeholder="输入会话名"
                    autoFocus
                  />
                  <button className={styles.actionBtn} onClick={() => void commitRename()}>
                    保存
                  </button>
                  <button className={styles.actionBtn} onClick={cancelRename}>
                    取消
                  </button>
                </div>
              ) : (
                <button
                  className={styles.item}
                  onClick={() => handleClick(s.key)}
                >
                  <span className={styles.itemLabel}>{sessionLabel(s)}</span>
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
      {menu && menuSession ? (
        <div
          className={styles.contextMenu}
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className={styles.menuItem}
            onClick={() => beginRename(menuSession)}
          >
            改名
          </button>
          <button
            className={styles.menuItem}
            onClick={() => void handleReset(menuSession.key)}
            disabled={!connected}
          >
            重置
          </button>
          <button
            className={`${styles.menuItem} ${styles.menuDanger}`}
            onClick={() => void handleDelete(menuSession.key)}
            disabled={!connected}
          >
            删除
          </button>
        </div>
      ) : null}
    </div>
  );
}
