import { useMemo, useState } from "react";
import { broadcastSessionChange } from "../lib/window-sync";
import {
  buildDisambiguatedSessionTitles,
  getSessionSourceTitle,
} from "../lib/session-display";
import type { SessionRow } from "../lib/types";
import { useGateway } from "../stores/gateway";
import { useWorkspace } from "../stores/workspace";
import styles from "./SessionWorkspaceModal.module.css";

function matchesSearch(session: SessionRow, query: string): boolean {
  if (!query) {
    return true;
  }

  const normalized = query.toLowerCase();
  return [
    session.label,
    session.displayName,
    session.key,
    session.model,
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(normalized));
}

export function SessionWorkspaceModal({ onClose }: { onClose: () => void }) {
  const sessions = useGateway((state) => state.sessions);
  const status = useGateway((state) => state.status);
  const createSession = useGateway((state) => state.createSession);
  const renameSession = useGateway((state) => state.renameSession);
  const switchSession = useGateway((state) => state.switchSession);
  const workspaceSessionKeys = useWorkspace((state) => state.sessionKeys);
  const addSession = useWorkspace((state) => state.addSession);
  const [search, setSearch] = useState("");
  const [newSessionLabel, setNewSessionLabel] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const connected = status === "connected" || status === "reconnecting";

  const workspaceKeySet = useMemo(() => new Set(workspaceSessionKeys), [workspaceSessionKeys]);
  const filteredSessions = useMemo(
    () => sessions.filter((session) => matchesSearch(session, search.trim())),
    [search, sessions],
  );
  const titles = useMemo(
    () => buildDisambiguatedSessionTitles(filteredSessions),
    [filteredSessions],
  );

  const workspaceSessions = filteredSessions.filter((session) => workspaceKeySet.has(session.key));
  const availableSessions = filteredSessions.filter((session) => !workspaceKeySet.has(session.key));

  const handleAddToWorkspace = (sessionKey: string) => {
    addSession(sessionKey);
  };

  const handleCreateSession = async () => {
    if (!connected || isCreating) {
      return;
    }

    const nextLabel = newSessionLabel.trim() || "new-session";
    setIsCreating(true);
    setCreateError(null);
    try {
      const key = await createSession();
      addSession(key);
      try {
        await renameSession(key, nextLabel);
      } catch (error) {
        setCreateError(error instanceof Error ? error.message : String(error));
        return;
      }
      switchSession(key);
      void broadcastSessionChange(key);
      setNewSessionLabel("");
      onClose();
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={(event) => event.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <div className={styles.title}>添加会话</div>
            <div className={styles.subtitle}>左侧只显示工作区中的会话。</div>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            关闭
          </button>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>新建会话</div>
          <div className={styles.sectionHint}>
            不填名称时默认使用 `new-session`，之后仍可重命名。
          </div>
          <div className={styles.createRow}>
            <input
              className={styles.input}
              value={newSessionLabel}
              onChange={(event) => setNewSessionLabel(event.target.value)}
              placeholder="输入会话名称"
              disabled={!connected || isCreating}
            />
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => void handleCreateSession()}
              disabled={!connected || isCreating}
            >
              {isCreating ? "创建中..." : "新建并加入"}
            </button>
          </div>
          {createError && <div className={styles.errorText}>{createError}</div>}
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>现有会话</div>
          <div className={styles.sectionHint}>搜索后可把现有 session 加入左侧工作区。</div>
          <input
            className={styles.input}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索 label、displayName、key"
          />

          <div className={styles.listShell}>
            {workspaceSessions.length > 0 && (
              <div className={styles.group}>
                <div className={styles.groupTitle}>已在工作区</div>
                {workspaceSessions.map((session) => (
                  <div key={session.key} className={styles.sessionRow}>
                    <div className={styles.sessionCopy}>
                      <div className={styles.sessionTitle}>
                        {titles.get(session.key) ?? session.key}
                      </div>
                      {getSessionSourceTitle(session) && (
                        <div className={styles.sessionMeta}>
                          来源: {getSessionSourceTitle(session)}
                        </div>
                      )}
                      <div className={styles.sessionKey}>{session.key}</div>
                    </div>
                    <button type="button" className={styles.secondaryButton} disabled>
                      已加入
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className={styles.group}>
              <div className={styles.groupTitle}>可加入的会话</div>
              {availableSessions.length === 0 ? (
                <div className={styles.empty}>没有可加入的会话。</div>
              ) : (
                availableSessions.map((session) => (
                  <div key={session.key} className={styles.sessionRow}>
                    <div className={styles.sessionCopy}>
                      <div className={styles.sessionTitle}>
                        {titles.get(session.key) ?? session.key}
                      </div>
                      {getSessionSourceTitle(session) && (
                        <div className={styles.sessionMeta}>
                          来源: {getSessionSourceTitle(session)}
                        </div>
                      )}
                      <div className={styles.sessionKey}>{session.key}</div>
                    </div>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      onClick={() => handleAddToWorkspace(session.key)}
                    >
                      加入
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
