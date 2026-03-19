import { useState } from "react";
import { TitleBar } from "../components/TitleBar";
import { SessionList } from "../components/SessionList";
import { ChatView } from "../components/ChatView";
import { SettingsModal } from "../components/SettingsModal";

export function MainWindow() {
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <TitleBar onOpenSettings={() => setShowSettings(true)} />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <SessionList />
        <ChatView />
      </div>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
