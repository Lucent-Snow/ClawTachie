import { getCurrentWindow } from "@tauri-apps/api/window";
import { useGateway } from "../stores/gateway";
import styles from "./TitleBar.module.css";

const appWindow = getCurrentWindow();

export function TitleBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const status = useGateway((s) => s.status);

  return (
    <div className={styles.titlebar}>
      <div className={styles.drag} data-tauri-drag-region>
        <div className={styles.titleGroup}>
          <span className={styles.titleEn}>CLAWTACHIE</span>
          <span className={styles.titleJa}>桌面助手</span>
        </div>
      </div>
      <div className={styles.right}>
        <div className={styles.status}>
          <span className={`${styles.dot} ${styles[status]}`} />
          {status}
        </div>
        <button className={styles.iconBtn} onClick={onOpenSettings} title="Settings">
          &#9881;
        </button>
        <button className={styles.iconBtn} onClick={() => appWindow.minimize()}>
          &#8211;
        </button>
        <button className={styles.iconBtn} onClick={() => appWindow.toggleMaximize()}>
          &#9633;
        </button>
        <button className={styles.iconBtn} onClick={() => appWindow.close()}>
          &#10005;
        </button>
      </div>
    </div>
  );
}
