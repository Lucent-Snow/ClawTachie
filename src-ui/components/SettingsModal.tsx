import { useState } from "react";
import { useSettings } from "../stores/settings";
import { useGateway } from "../stores/gateway";
import styles from "./SettingsModal.module.css";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  const { status, connect, disconnect } = useGateway();

  const [url, setUrl] = useState(settings.gatewayUrl);
  const [token, setToken] = useState(settings.token);
  const [sessionKey, setSessionKey] = useState(settings.sessionKey);

  const connected = status === "connected" || status === "reconnecting";

  const handleConnect = () => {
    settings.update({ gatewayUrl: url, token, sessionKey });
    connect(url, token);
  };

  const handleDisconnect = () => {
    disconnect();
  };

  const handleClose = () => {
    settings.update({ gatewayUrl: url, token, sessionKey });
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
          <label className={styles.label}>Status: {status}</label>
        </div>

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
