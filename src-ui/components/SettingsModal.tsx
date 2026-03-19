import { useState } from "react";
import { useSettings } from "../stores/settings";
import { useGateway } from "../stores/gateway";
import { broadcastSessionChange } from "../lib/window-sync";
import styles from "./SettingsModal.module.css";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  const { status, error, connect, disconnect, currentSessionKey, switchSession } = useGateway();

  const [url, setUrl] = useState(settings.gatewayUrl);
  const [token, setToken] = useState(settings.token);
  const [sessionKey, setSessionKey] = useState(settings.sessionKey);

  const connected = status === "connected" || status === "reconnecting";

  const syncSessionKey = () => {
    const nextSessionKey = sessionKey.trim();
    if (!nextSessionKey || nextSessionKey === currentSessionKey) {
      return;
    }

    switchSession(nextSessionKey);
    void broadcastSessionChange(nextSessionKey);
  };

  const handleConnect = () => {
    settings.update({ gatewayUrl: url, token, sessionKey });
    syncSessionKey();
    connect(url, token);
  };

  const handleDisconnect = () => {
    settings.update({ gatewayUrl: url, token, sessionKey });
    disconnect();
  };

  const handleClose = () => {
    settings.update({ gatewayUrl: url, token, sessionKey });
    syncSessionKey();
    onClose();
  };

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.title}>Settings</div>

        <div className={styles.field}>
          <label className={styles.label}>Gateway URL</label>
          <input
            className={styles.input}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Token</label>
          <input
            className={styles.input}
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Session Key</label>
          <input
            className={styles.input}
            value={sessionKey}
            onChange={(e) => setSessionKey(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Status: {status}</label>
        </div>

        {error && (
          <div className={styles.field}>
            <label className={styles.label}>Error</label>
            <div className={styles.errorText}>{error}</div>
          </div>
        )}

        <div className={styles.actions}>
          {connected ? (
            <button className={styles.secondaryBtn} onClick={handleDisconnect}>
              Disconnect
            </button>
          ) : (
            <button
              className={styles.primaryBtn}
              onClick={handleConnect}
              disabled={status === "connecting"}
            >
              {status === "connecting" ? "Connecting..." : "Connect"}
            </button>
          )}
          <button className={styles.secondaryBtn} onClick={handleClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
