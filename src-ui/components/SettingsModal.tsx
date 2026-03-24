import { useState } from "react";
import { broadcastSessionChange, broadcastSettingsChange } from "../lib/window-sync";
import { useGateway } from "../stores/gateway";
import { useSettings } from "../stores/settings";
import { type UpdateStatus, useUpdater } from "../stores/updater";
import styles from "./SettingsModal.module.css";

type Tab = "gateway" | "tts" | "pet" | "updates";

function formatUpdateStatus(status: UpdateStatus): string {
  switch (status) {
    case "idle":
      return "待命";
    case "checking":
      return "检查中";
    case "upToDate":
      return "已是最新版本";
    case "downloading":
      return "下载中";
    case "installing":
      return "安装中";
    case "error":
      return "更新失败";
  }
}

function formatLastCheckedAt(value: number | null): string {
  if (!value) {
    return "尚未检查";
  }

  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  const { status, error, connect, disconnect, sessions, currentSessionKey, switchSession } = useGateway();
  const currentVersion = useUpdater((state) => state.currentVersion);
  const latestVersion = useUpdater((state) => state.latestVersion);
  const updateStatus = useUpdater((state) => state.status);
  const updateProgress = useUpdater((state) => state.progress);
  const updateError = useUpdater((state) => state.error);
  const lastCheckedAt = useUpdater((state) => state.lastCheckedAt);
  const checkForUpdates = useUpdater((state) => state.checkForUpdates);

  const [tab, setTab] = useState<Tab>("gateway");
  const [url, setUrl] = useState(settings.gateway.url);
  const [token, setToken] = useState(settings.gateway.token);
  const [ttsEnabled, setTtsEnabled] = useState(settings.tts.enabled);
  const [provider, setProvider] = useState(settings.tts.provider);
  const [autoPlay, setAutoPlay] = useState(settings.tts.autoPlay);
  const [mimoApiKey, setMimoApiKey] = useState(settings.tts.mimoApiKey);
  const [mimoVoice, setMimoVoice] = useState(settings.tts.mimoVoice);
  const [mimoModel, setMimoModel] = useState(settings.tts.mimoModel);
  const [mimoScriptPath, setMimoScriptPath] = useState(settings.tts.mimoScriptPath);
  const [mimoUserContext, setMimoUserContext] = useState(settings.tts.mimoUserContext);
  const [petEnabled, setPetEnabled] = useState(settings.pet.enabled);
  const [autoCheckUpdates, setAutoCheckUpdates] = useState(settings.updates.autoCheck);

  const connected = status === "connected" || status === "reconnecting";
  const updateBusy = updateStatus === "checking" || updateStatus === "downloading" || updateStatus === "installing";

  const persistSettings = () => {
    const snapshot = {
      gateway: {
        url: url.trim(),
        token,
        sessionKey: settings.gateway.sessionKey,
        autoConnect: settings.gateway.autoConnect,
      },
      tts: {
        enabled: ttsEnabled,
        provider: ttsEnabled ? provider : "none",
        autoPlay,
        mimoApiKey,
        mimoVoice: mimoVoice.trim() || settings.tts.mimoVoice,
        mimoModel: mimoModel.trim() || settings.tts.mimoModel,
        mimoScriptPath: mimoScriptPath.trim(),
        mimoUserContext,
      },
      pet: {
        ...settings.pet,
        enabled: petEnabled,
      },
      updates: {
        autoCheck: autoCheckUpdates,
      },
    } as const;

    settings.updateGateway(snapshot.gateway);
    settings.updateTts(snapshot.tts);
    settings.updatePet(snapshot.pet);
    settings.updateUpdates(snapshot.updates);
    void broadcastSettingsChange(snapshot);

    return snapshot;
  };

  const handleConnect = () => {
    persistSettings();
    void connect(url.trim(), token);
  };

  const handleDisconnect = () => {
    persistSettings();
    void disconnect();
  };

  const handleClose = () => {
    persistSettings();
    onClose();
  };

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.panel} onClick={(event) => event.stopPropagation()}>
        <button className={styles.closeBtn} onClick={handleClose}>关闭 &#10005;</button>

        <div className={styles.nav}>
          <div className={styles.navTitle}>设置</div>
          <button
            className={`${styles.navItem} ${tab === "gateway" ? styles.navItemActive : ""}`}
            onClick={() => setTab("gateway")}
          >
            连接
          </button>
          <button
            className={`${styles.navItem} ${tab === "tts" ? styles.navItemActive : ""}`}
            onClick={() => setTab("tts")}
          >
            语音
          </button>
          <button
            className={`${styles.navItem} ${tab === "pet" ? styles.navItemActive : ""}`}
            onClick={() => setTab("pet")}
          >
            立绘
          </button>
          <button
            className={`${styles.navItem} ${tab === "updates" ? styles.navItemActive : ""}`}
            onClick={() => setTab("updates")}
          >
            更新
          </button>
        </div>

        <div className={styles.content}>
          {tab === "gateway" && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>网关连接</div>
                  <div className={styles.sectionHint}>服务器地址和默认会话。</div>
                </div>
                <div className={styles.statusBadge}>{status}</div>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>网关地址</label>
                <input
                  className={styles.input}
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>令牌</label>
                <input
                  className={styles.input}
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                />
              </div>

              {error && (
                <div className={styles.field}>
                  <label className={styles.label}>错误</label>
                  <div className={styles.errorText}>{error}</div>
                </div>
              )}

              <label className={styles.toggleRow}>
                <input
                  type="checkbox"
                  checked={settings.gateway.autoConnect}
                  onChange={(event) => settings.updateGateway({ autoConnect: event.target.checked })}
                />
                <span>启动时自动连接</span>
              </label>

              <div className={styles.actions}>
                {connected ? (
                  <button className={styles.secondaryBtn} onClick={handleDisconnect}>
                    断开连接
                  </button>
                ) : (
                  <button
                    className={styles.primaryBtn}
                    onClick={handleConnect}
                    disabled={status === "connecting"}
                  >
                    {status === "connecting" ? "连接中..." : "连接"}
                  </button>
                )}
              </div>

              {connected && sessions.length > 0 && (
                <div className={styles.field} style={{ marginTop: 18 }}>
                  <label className={styles.label}>默认会话</label>
                  <select
                    className={styles.input}
                    value={settings.gateway.sessionKey}
                    onChange={(event) => {
                      const key = event.target.value;
                      settings.updateGateway({ sessionKey: key });
                      switchSession(key);
                      void broadcastSessionChange(key);
                    }}
                  >
                    {sessions.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.displayName || s.key}
                        {s.model ? ` (${s.model})` : ""}
                      </option>
                    ))}
                  </select>
                  <div className={styles.sectionHint}>
                    选择后将作为下次连接的默认会话。
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "tts" && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>语音合成</div>
                  <div className={styles.sectionHint}>语音服务配置。</div>
                </div>
              </div>

              <label className={styles.toggleRow}>
                <input
                  type="checkbox"
                  checked={ttsEnabled}
                  onChange={(event) => setTtsEnabled(event.target.checked)}
                />
                <span>启用语音合成</span>
              </label>

              <div className={styles.grid}>
                <div className={styles.field}>
                  <label className={styles.label}>服务商</label>
                  <select
                    className={styles.input}
                    value={provider}
                    onChange={(event) => setProvider(event.target.value as "none" | "mimo")}
                    disabled={!ttsEnabled}
                  >
                    <option value="none">无</option>
                    <option value="mimo">MiMo TTS</option>
                  </select>
                </div>

                <label className={`${styles.toggleRow} ${styles.inlineToggle}`}>
                  <input
                    type="checkbox"
                    checked={autoPlay}
                    onChange={(event) => setAutoPlay(event.target.checked)}
                    disabled={!ttsEnabled || provider !== "mimo"}
                  />
                  <span>自动播放</span>
                </label>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>MiMo API 密钥</label>
                <input
                  className={styles.input}
                  type="password"
                  value={mimoApiKey}
                  onChange={(event) => setMimoApiKey(event.target.value)}
                  disabled={!ttsEnabled || provider !== "mimo"}
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>MiMo 脚本路径</label>
                <input
                  className={styles.input}
                  value={mimoScriptPath}
                  onChange={(event) => setMimoScriptPath(event.target.value)}
                  disabled={!ttsEnabled || provider !== "mimo"}
                />
              </div>

              <div className={styles.grid}>
                <div className={styles.field}>
                  <label className={styles.label}>音色</label>
                  <input
                    className={styles.input}
                    value={mimoVoice}
                    onChange={(event) => setMimoVoice(event.target.value)}
                    disabled={!ttsEnabled || provider !== "mimo"}
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>模型</label>
                  <input
                    className={styles.input}
                    value={mimoModel}
                    onChange={(event) => setMimoModel(event.target.value)}
                    disabled={!ttsEnabled || provider !== "mimo"}
                  />
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>用户上下文</label>
                <textarea
                  className={`${styles.input} ${styles.textarea}`}
                  value={mimoUserContext}
                  onChange={(event) => setMimoUserContext(event.target.value)}
                  disabled={!ttsEnabled || provider !== "mimo"}
                  rows={3}
                />
              </div>
            </div>
          )}

          {tab === "pet" && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>立绘与桌宠</div>
                  <div className={styles.sectionHint}>控制桌面立绘窗口是否启用。</div>
                </div>
              </div>

              <label className={styles.toggleRow}>
                <input
                  type="checkbox"
                  checked={petEnabled}
                  onChange={(event) => setPetEnabled(event.target.checked)}
                />
                <span>启用桌面立绘窗口</span>
              </label>

              <div className={styles.sectionHint}>
                关闭后只保留主聊天窗口，立绘资源不会显示。
              </div>
            </div>
          )}

          {tab === "updates" && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>自动更新</div>
                  <div className={styles.sectionHint}>检测到新版本后会自动下载、安装并重启应用。</div>
                </div>
                <div className={styles.statusBadge}>{formatUpdateStatus(updateStatus)}</div>
              </div>

              <label className={styles.toggleRow}>
                <input
                  type="checkbox"
                  checked={autoCheckUpdates}
                  onChange={(event) => setAutoCheckUpdates(event.target.checked)}
                />
                <span>启动时自动检查更新</span>
              </label>

              <div className={styles.field}>
                <label className={styles.label}>当前版本</label>
                <div className={styles.valueText}>{currentVersion ?? "读取中..."}</div>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>可用版本</label>
                <div className={styles.valueText}>{latestVersion ?? "尚未检测到更新"}</div>
              </div>

              <div className={styles.sectionHint}>
                上次检查：{formatLastCheckedAt(lastCheckedAt)}
              </div>

              {updateProgress !== null && (
                <div className={styles.progressGroup}>
                  <div className={styles.progressTrack}>
                    <div
                      className={styles.progressFill}
                      style={{ width: `${Math.round(updateProgress * 100)}%` }}
                    />
                  </div>
                  <div className={styles.sectionHint}>
                    下载进度：{Math.round(updateProgress * 100)}%
                  </div>
                </div>
              )}

              {updateError && (
                <div className={styles.field}>
                  <label className={styles.label}>错误</label>
                  <div className={styles.errorText}>{updateError}</div>
                </div>
              )}

              <div className={styles.actions}>
                <button
                  className={styles.primaryBtn}
                  onClick={() => void checkForUpdates()}
                  disabled={updateBusy}
                >
                  {updateBusy ? "处理中..." : "立即检查更新"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
