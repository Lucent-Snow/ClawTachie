import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useChat } from "../stores/chat";
import { useGateway } from "../stores/gateway";
import { useSettings } from "../stores/settings";
import { useWorkspace } from "../stores/workspace";
import {
  buildDisambiguatedSessionTitles,
  getSessionSourceTitle,
} from "../lib/session-display";
import { broadcastSessionChange } from "../lib/window-sync";
import type { SessionRow } from "../lib/types";
import styles from "./SessionList.module.css";

interface SessionMenuState {
  key: string;
  x: number;
  y: number;
}

export function SessionList({ onOpenWorkspaceManager }: { onOpenWorkspaceManager: () => void }) {
  const clearMessages = useChat((state) => state.clearMessages);
  const sessions = useGateway((state) => state.sessions);
  const currentKey = useGateway((state) => state.currentSessionKey);
  const status = useGateway((state) => state.status);
  const switchSession = useGateway((state) => state.switchSession);
  const resetSession = useGateway((state) => state.resetSession);
  const deleteSession = useGateway((state) => state.deleteSession);
  const renameSession = useGateway((state) => state.renameSession);
  const defaultSessionKey = useSettings((state) => state.gateway.sessionKey);
  const workspaceSessionKeys = useWorkspace((state) => state.sessionKeys);
  const workspaceInitialized = useWorkspace((state) => state.initialized);
  const initializeWorkspace = useWorkspace((state) => state.initialize);
  const addToWorkspace = useWorkspace((state) => state.addSession);
  const removeFromWorkspace = useWorkspace((state) => state.removeSession);
  const pruneWorkspace = useWorkspace((state) => state.pruneSessions);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [menu, setMenu] = useState<SessionMenuState | null>(null);
  const connected = status === "connected" || status === "reconnecting";

  const workspaceSessions = useMemo(() => {
    const byKey = new Map(sessions.map((session) => [session.key, session]));
    return workspaceSessionKeys
      .map((key) => byKey.get(key))
      .filter((session): session is SessionRow => Boolean(session));
  }, [sessions, workspaceSessionKeys]);
  const sessionTitles = useMemo(
    () => buildDisambiguatedSessionTitles(workspaceSessions),
    [workspaceSessions],
  );

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

  useEffect(() => {
    pruneWorkspace(sessions.map((session) => session.key));
  }, [pruneWorkspace, sessions]);

  useEffect(() => {
    if (workspaceInitialized || sessions.length === 0) {
      return;
    }

    const preferredKey =
      sessions.find((session) => session.key === currentKey)?.key ??
      sessions.find((session) => session.key === defaultSessionKey)?.key ??
      sessions[0]?.key;

    initializeWorkspace(preferredKey ? [preferredKey] : []);
  }, [currentKey, defaultSessionKey, initializeWorkspace, sessions, workspaceInitialized]);

  const handleClick = (key: string) => {
    if (key === currentKey) {
      return;
    }

    switchSession(key);
    void broadcastSessionChange(key);
  };

  const beginRename = (session: SessionRow) => {
    setMenu(null);
    setEditingKey(session.key);
    setDraftLabel(session.label || "");
  };

  const cancelRename = () => {
    setEditingKey(null);
    setDraftLabel("");
  };

  const commitRename = async () => {
    if (!editingKey) {
      return;
    }

    const key = editingKey;
    const normalized = draftLabel.trim();
    cancelRename();
    await renameSession(key, normalized);
  };

  const handleReset = async (key: string) => {
    setMenu(null);
    await resetSession(key);
    if (key === currentKey) {
      clearMessages(key);
    }
  };

  const handleDelete = async (key: string) => {
    setMenu(null);
    if (!window.confirm("删除这个会话？这会移除当前 session 记录。")) {
      return;
    }

    const remainingWorkspaceKeys = workspaceSessionKeys.filter((sessionKey) => sessionKey !== key);
    const nextKey = await deleteSession(key);
    removeFromWorkspace(key);

    if (key === currentKey) {
      clearMessages(key);
      if (remainingWorkspaceKeys[0]) {
        switchSession(remainingWorkspaceKeys[0]);
        void broadcastSessionChange(remainingWorkspaceKeys[0]);
      } else if (nextKey) {
        addToWorkspace(nextKey);
        switchSession(nextKey);
        void broadcastSessionChange(nextKey);
      }
    }
  };

  const handleRemoveFromWorkspace = (key: string) => {
    setMenu(null);
    const remainingWorkspaceKeys = workspaceSessionKeys.filter((sessionKey) => sessionKey !== key);
    removeFromWorkspace(key);

    if (key === currentKey && remainingWorkspaceKeys[0]) {
      switchSession(remainingWorkspaceKeys[0]);
      void broadcastSessionChange(remainingWorkspaceKeys[0]);
    }
  };

  const openMenu = (event: MouseEvent, session: SessionRow) => {
    event.preventDefault();
    event.stopPropagation();

    const menuWidth = 180;
    const menuHeight = 168;
    const padding = 12;
    const x = Math.min(event.clientX, window.innerWidth - menuWidth - padding);
    const y = Math.min(event.clientY, window.innerHeight - menuHeight - padding);

    setMenu({
      key: session.key,
      x: Math.max(padding, x),
      y: Math.max(padding, y),
    });
  };

  const menuSession = menu
    ? workspaceSessions.find((session) => session.key === menu.key) ?? null
    : null;

  if (workspaceSessions.length === 0) {
    return (
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <div>
            <div className={styles.headerEn}>WORKSPACE</div>
            <div className={styles.headerJa}>工作区会话</div>
          </div>
          <button
            className={styles.createBtn}
            onClick={onOpenWorkspaceManager}
            title="添加会话"
          >
            +
          </button>
        </div>
        <div className={styles.empty}>工作区里还没有会话，点击右上角添加。</div>
      </div>
    );
  }

  return (
    <div className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <div>
          <div className={styles.headerEn}>WORKSPACE</div>
          <div className={styles.headerJa}>工作区会话</div>
        </div>
        <button
          className={styles.createBtn}
          onClick={onOpenWorkspaceManager}
          title="添加会话"
        >
          +
        </button>
      </div>
      {workspaceSessions.map((session) => (
        <div
          key={session.key}
          className={`${styles.itemRow} ${session.key === currentKey ? styles.active : ""} ${session.key === defaultSessionKey ? styles.default : ""}`}
          title={session.key}
          onContextMenu={(event) => openMenu(event, session)}
        >
          {editingKey === session.key ? (
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
            <button className={styles.item} onClick={() => handleClick(session.key)}>
              <span className={styles.itemLabel}>{sessionTitles.get(session.key) ?? session.key}</span>
              {getSessionSourceTitle(session) && (
                <span className={styles.itemMeta}>{getSessionSourceTitle(session)}</span>
              )}
            </button>
          )}
        </div>
      ))}
      {menu && menuSession ? (
        <div
          className={styles.contextMenu}
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button className={styles.menuItem} onClick={() => beginRename(menuSession)}>
            改名
          </button>
          <button className={styles.menuItem} onClick={() => handleRemoveFromWorkspace(menuSession.key)}>
            移出工作区
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
