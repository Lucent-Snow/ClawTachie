import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSettings } from "./stores/settings";
import { useUpdater } from "./stores/updater";
import { useGateway } from "./stores/gateway";
import { useChat } from "./stores/chat";
import { hasTauriBackend, setPetWindowVisible, subscribeGatewayEvents } from "./lib/tauri-gateway";
import { subscribeWindowSync } from "./lib/window-sync";
import { MainWindow } from "./windows/MainWindow";
import { PetWindow } from "./windows/PetWindow";

const currentWindow = getCurrentWindow();

export function App() {
  const settings = useSettings();
  const { setStatus, switchSession, refreshSessions, status, connect } = useGateway();
  const {
    appendExternalUserMessage,
    handleChatEvent,
    finalizeStream,
    clearMessages,
    loadHistory,
  } = useChat();
  const currentSessionKey = useGateway((s) => s.currentSessionKey);
  const isPetWindow = currentWindow.label === "pet";
  const petEnabled = useSettings((s) => s.pet.enabled);
  const autoCheckUpdates = useSettings((s) => s.updates.autoCheck);
  const initializeUpdater = useUpdater((s) => s.initialize);
  const checkForUpdates = useUpdater((s) => s.checkForUpdates);

  // Set initial session from settings
  useEffect(() => {
    if (!currentSessionKey && settings.gateway.sessionKey) {
      switchSession(settings.gateway.sessionKey);
    }
  }, [currentSessionKey, settings.gateway.sessionKey, switchSession]);

  // Auto-connect on startup
  useEffect(() => {
    const { url, token, autoConnect } = settings.gateway;
    if (autoConnect && token && status === "disconnected") {
      void connect(url, token);
    }
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  useEffect(() => {
    let cancelled = false;
    let unlisteners: (() => void)[] = [];

    void subscribeWindowSync({
      onSessionChange: ({ sessionKey }) => {
        if (sessionKey === useGateway.getState().currentSessionKey) {
          return;
        }
        useGateway.getState().switchSession(sessionKey);
      },
      onUserMessage: ({ sessionKey, message }) => {
        if (sessionKey !== useGateway.getState().currentSessionKey) {
          return;
        }

        useChat.getState().appendExternalUserMessage(message);
      },
      onSettingsChange: ({ settings: nextSettings }) => {
        useSettings.getState().applySnapshot(nextSettings);
      },
    }).then((fns) => {
      if (cancelled) {
        fns.forEach((fn) => fn());
        return;
      }

      unlisteners = fns;
    });

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [appendExternalUserMessage]);

  // Load history when session changes
  useEffect(() => {
    if (currentSessionKey && status === "connected") {
      clearMessages();
      loadHistory(currentSessionKey);
    }
  }, [currentSessionKey, status, clearMessages, loadHistory]);

  useEffect(() => {
    document.body.dataset.window = isPetWindow ? "pet" : "main";
  }, [isPetWindow]);

  useEffect(() => {
    if (!hasTauriBackend() || isPetWindow) {
      return;
    }

    void setPetWindowVisible(petEnabled);
  }, [isPetWindow, petEnabled]);

  useEffect(() => {
    if (!hasTauriBackend() || isPetWindow) {
      return;
    }

    void initializeUpdater();

    if (autoCheckUpdates) {
      void checkForUpdates({ silent: true });
    }
  }, [autoCheckUpdates, checkForUpdates, initializeUpdater, isPetWindow]);

  if (isPetWindow && !petEnabled) {
    return null;
  }

  return isPetWindow ? <PetWindow /> : <MainWindow />;
}
