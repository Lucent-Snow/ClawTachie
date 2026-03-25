import type { UIAttachment } from "../lib/types";
import styles from "./MessageAttachments.module.css";

export function MessageAttachments({ attachments }: { attachments: UIAttachment[] }) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className={styles.grid}>
      {attachments.map((attachment) => (
        <a
          key={attachment.id}
          className={styles.card}
          href={attachment.url}
          target="_blank"
          rel="noreferrer"
        >
          <img
            src={attachment.url}
            alt={attachment.name ?? "image attachment"}
            className={styles.image}
          />
          {attachment.name && <span className={styles.label}>{attachment.name}</span>}
        </a>
      ))}
    </div>
  );
}
