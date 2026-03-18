import { useEffect, useState } from "react";
import { useSettings } from "./stores/settings";
import { useGateway } from "./stores/gateway";
import { useChat } from "./stores/chat";
import { subscribeGatewayEvents } from "./lib/tauri-gateway";
import { TitleBar } from "./components/TitleBar";
import { SessionList } from "./components/SessionList";
import { ChatView } from "./components/ChatView";
import { SettingsModal } from "./components/SettingsModal";

export function App() {
  const [showSettings, setShowSettings] = useState(false);
  const settings = useSettings();
  const { setStatus, switchSession, refreshSessions, status } = useGateway();
  const { handleChatEvent, finalizeStream, clearMessages, loadHistory } = useChat();
  const currentSessionKey = useGateway((s) => s.currentSessionKey);

  // Set initial session from settings
  useEffect(() => {
    if (!currentSessionKey && settings.sessionKey) {
      switchSession(settings.sessionKey);
    }
  }, [currentSessionKey, settings.sessionKey, switchSession]);

  // Subscribe to Tauri gateway events
  useEffect(() => {
    let cancelled = false;
    let unlisteners: (() => void)[] = [];

    void subscribeGatewayEvents({
      onChatEvent: (payload) => {
        const key = useGateway.getState().currentSessionKey;
        if (key) handleChatEvent(payload, key);
      },
      onRunEnd: () => {
        finalizeStream();
      },
      onDisconnected: () => {
        setStatus("disconnected");
      },
      onError: ({ message }) => {
        setStatus("error", message);
      },
      onReconnecting: () => {
        setStatus("reconnecting");
      },
      onConnected: () => {
        setStatus("connected");
        refreshSessions();
      },
    }).then((fns) => {
      if (cancelled) { fns.forEach((f) => f()); return; }
      unlisteners = fns;
    });

    return () => { cancelled = true; unlisteners.forEach((f) => f()); };
  }, [setStatus, handleChatEvent, finalizeStream, refreshSessions]);

  // Load history when session changes
  useEffect(() => {
    if (currentSessionKey && status === "connected") {
      clearMessages();
      loadHistory(currentSessionKey);
    }
  }, [currentSessionKey, status, clearMessages, loadHistory]);

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
