import { useState } from "react";
import { TitleBar } from "../components/TitleBar";
import { SessionTabs } from "../components/SessionTabs";
import { SessionList } from "../components/SessionList";
import { SessionWorkspaceModal } from "../components/SessionWorkspaceModal";
import { ChatView } from "../components/ChatView";
import { SettingsModal } from "../components/SettingsModal";
import styles from "./MainWindow.module.css";

export function MainWindow() {
  const [showSettings, setShowSettings] = useState(false);
  const [showWorkspaceManager, setShowWorkspaceManager] = useState(false);

  return (
    <div className={styles.window}>
      <TitleBar onOpenSettings={() => setShowSettings(true)} />
      <div className={styles.content}>
        <SessionList onOpenWorkspaceManager={() => setShowWorkspaceManager(true)} />
        <div className={styles.mainPane}>
          <SessionTabs />
          <ChatView />
        </div>
      </div>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showWorkspaceManager && (
        <SessionWorkspaceModal onClose={() => setShowWorkspaceManager(false)} />
      )}
    </div>
  );
}
