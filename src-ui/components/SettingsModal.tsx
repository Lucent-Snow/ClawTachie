import { useEffect, useState } from "react";
import {
  gatewayConfigGet,
  gatewayConfigPatch,
  gatewayConfigSchema,
} from "../lib/tauri-gateway";
import { getSessionDisplayTitle } from "../lib/session-display";
import { broadcastSessionChange, broadcastSettingsChange } from "../lib/window-sync";
import { useGateway } from "../stores/gateway";
import { useSettings } from "../stores/settings";
import { type UpdateStatus, useUpdater } from "../stores/updater";
import styles from "./SettingsModal.module.css";

type Tab = "gateway" | "admin" | "tts" | "pet" | "updates";

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

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function extractConfigRaw(payload: Record<string, unknown>): string {
  if (typeof payload.raw === "string") {
    return payload.raw;
  }

  const candidate =
    payload.value ??
    payload.config ??
    payload.current ??
    payload.data ??
    payload;

  return stringifyJson(candidate);
}

function extractBaseHash(payload: Record<string, unknown>): string {
  const direct = payload.baseHash ?? payload.hash;
  if (typeof direct === "string") {
    return direct;
  }

  const meta = payload.meta;
  if (meta && typeof meta === "object") {
    const hash = (meta as Record<string, unknown>).baseHash ?? (meta as Record<string, unknown>).hash;
    if (typeof hash === "string") {
      return hash;
    }
  }

  return "";
}

function extractSchemaText(payload: Record<string, unknown>): string {
  const schema = payload.schema ?? payload.value ?? payload;
  return stringifyJson(schema);
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  const {
    status,
    error,
    connect,
    disconnect,
    sessions,
    currentSessionKey,
    switchSession,
  } = useGateway();
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
  const [adminConfigText, setAdminConfigText] = useState("");
  const [adminSchemaText, setAdminSchemaText] = useState("");
  const [adminPatchText, setAdminPatchText] = useState('{\n  \n}');
  const [adminBaseHash, setAdminBaseHash] = useState("");
  const [adminPatchNote, setAdminPatchNote] = useState("ClawTachie settings panel");
  const [adminRestartDelayMs, setAdminRestartDelayMs] = useState("1500");
  const [adminLoadingConfig, setAdminLoadingConfig] = useState(false);
  const [adminLoadingSchema, setAdminLoadingSchema] = useState(false);
  const [adminSavingPatch, setAdminSavingPatch] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminSuccess, setAdminSuccess] = useState<string | null>(null);

  const connected = status === "connected" || status === "reconnecting";
  const updateBusy =
    updateStatus === "checking" ||
    updateStatus === "downloading" ||
    updateStatus === "installing";

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

  const loadAdminConfig = async () => {
    if (!connected) {
      return;
    }

    setAdminLoadingConfig(true);
    setAdminError(null);
    setAdminSuccess(null);

    try {
      const payload = await gatewayConfigGet();
      setAdminConfigText(extractConfigRaw(payload));
      setAdminBaseHash(extractBaseHash(payload));
    } catch (loadError) {
      setAdminError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setAdminLoadingConfig(false);
    }
  };

  const loadAdminSchema = async () => {
    if (!connected) {
      return;
    }

    setAdminLoadingSchema(true);
    setAdminError(null);
    setAdminSuccess(null);

    try {
      const payload = await gatewayConfigSchema();
      setAdminSchemaText(extractSchemaText(payload));
    } catch (loadError) {
      setAdminError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setAdminLoadingSchema(false);
    }
  };

  const applyAdminPatch = async () => {
    if (!connected) {
      return;
    }

    if (!adminBaseHash.trim()) {
      setAdminError("当前还没有 base hash，请先读取配置。");
      setAdminSuccess(null);
      return;
    }

    let parsedPatch: unknown;
    try {
      parsedPatch = JSON.parse(adminPatchText);
    } catch (parseError) {
      setAdminError(`Patch 不是合法 JSON：${parseError instanceof Error ? parseError.message : String(parseError)}`);
      setAdminSuccess(null);
      return;
    }

    if (!parsedPatch || typeof parsedPatch !== "object" || Array.isArray(parsedPatch)) {
      setAdminError("Patch 必须是 JSON object。");
      setAdminSuccess(null);
      return;
    }

    const parsedDelay = adminRestartDelayMs.trim()
      ? Number(adminRestartDelayMs.trim())
      : null;

    if (parsedDelay !== null && (!Number.isFinite(parsedDelay) || parsedDelay < 0)) {
      setAdminError("重启延迟必须是大于等于 0 的数字。");
      setAdminSuccess(null);
      return;
    }

    setAdminSavingPatch(true);
    setAdminError(null);
    setAdminSuccess(null);

    try {
      await gatewayConfigPatch({
        raw: JSON.stringify(parsedPatch, null, 2),
        baseHash: adminBaseHash.trim(),
        sessionKey: currentSessionKey,
        note: adminPatchNote.trim() || null,
        restartDelayMs: parsedDelay === null ? null : Math.round(parsedDelay),
      });

      await loadAdminConfig();
      setAdminSuccess("配置 patch 已提交，已重新读取当前配置。");
    } catch (saveError) {
      setAdminError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setAdminSavingPatch(false);
    }
  };

  useEffect(() => {
    if (tab !== "admin" || !connected) {
      return;
    }

    if (!adminConfigText) {
      void loadAdminConfig();
    }

    if (!adminSchemaText) {
      void loadAdminSchema();
    }
  }, [tab, connected]); // eslint-disable-line react-hooks/exhaustive-deps

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
            className={`${styles.navItem} ${tab === "admin" ? styles.navItemActive : ""}`}
            onClick={() => setTab("admin")}
          >
            OpenClaw
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
                        {getSessionDisplayTitle(s)}
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

          {tab === "admin" && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>OpenClaw 配置编辑器</div>
                  <div className={styles.sectionHint}>
                    通过 `config.get / config.schema / config.patch` 直接读取和修改 OpenClaw 配置。
                  </div>
                </div>
                <div className={styles.statusBadge}>{connected ? "connected" : status}</div>
              </div>

              <div className={styles.metaGrid}>
                <div className={styles.field}>
                  <label className={styles.label}>Base Hash</label>
                  <div className={styles.valueText}>{adminBaseHash || "尚未读取"}</div>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>当前会话</label>
                  <div className={styles.valueText}>{currentSessionKey ?? "未选择"}</div>
                </div>
              </div>

              <div className={styles.actions}>
                <button
                  className={styles.primaryBtn}
                  onClick={() => void loadAdminConfig()}
                  disabled={!connected || adminLoadingConfig || adminSavingPatch}
                >
                  {adminLoadingConfig ? "读取中..." : "读取配置"}
                </button>
                <button
                  className={styles.secondaryBtn}
                  onClick={() => void loadAdminSchema()}
                  disabled={!connected || adminLoadingSchema || adminSavingPatch}
                >
                  {adminLoadingSchema ? "读取中..." : "读取 Schema"}
                </button>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>当前配置</label>
                <textarea
                  className={`${styles.input} ${styles.textarea} ${styles.codeArea}`}
                  value={adminConfigText}
                  readOnly
                  rows={12}
                />
              </div>

              <div className={styles.grid}>
                <div className={styles.field}>
                  <label className={styles.label}>Patch 备注</label>
                  <input
                    className={styles.input}
                    value={adminPatchNote}
                    onChange={(event) => setAdminPatchNote(event.target.value)}
                    placeholder="例如：adjust model policy"
                    disabled={!connected || adminSavingPatch}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>重启延迟 (ms)</label>
                  <input
                    className={styles.input}
                    value={adminRestartDelayMs}
                    onChange={(event) => setAdminRestartDelayMs(event.target.value)}
                    placeholder="1500"
                    disabled={!connected || adminSavingPatch}
                  />
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>JSON Merge Patch</label>
                <textarea
                  className={`${styles.input} ${styles.textarea} ${styles.codeArea}`}
                  value={adminPatchText}
                  onChange={(event) => setAdminPatchText(event.target.value)}
                  rows={10}
                  placeholder='{\n  "models": {\n    "allowlist": ["gpt-5.4"]\n  }\n}'
                  disabled={!connected || adminSavingPatch}
                />
                <div className={styles.sectionHint}>
                  建议只提交小 patch。发送前会校验 JSON 是否为 object。
                </div>
              </div>

              <div className={styles.actions}>
                <button
                  className={styles.primaryBtn}
                  onClick={() => void applyAdminPatch()}
                  disabled={!connected || adminSavingPatch || adminLoadingConfig}
                >
                  {adminSavingPatch ? "提交中..." : "应用 Patch"}
                </button>
              </div>

              {adminError && (
                <div className={styles.field}>
                  <label className={styles.label}>错误</label>
                  <div className={styles.errorText}>{adminError}</div>
                </div>
              )}

              {adminSuccess && (
                <div className={styles.field}>
                  <label className={styles.label}>结果</label>
                  <div className={styles.successText}>{adminSuccess}</div>
                </div>
              )}

              <div className={styles.field}>
                <label className={styles.label}>Config Schema</label>
                <textarea
                  className={`${styles.input} ${styles.textarea} ${styles.codeArea}`}
                  value={adminSchemaText}
                  readOnly
                  rows={14}
                />
              </div>
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
