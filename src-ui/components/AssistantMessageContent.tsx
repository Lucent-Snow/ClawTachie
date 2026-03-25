import { Fragment } from "react";
import { parseAssistantContent, summarizeToolContent } from "../lib/message-content";
import { MarkdownRenderer } from "./MarkdownRenderer";
import styles from "./AssistantMessageContent.module.css";

interface AssistantMessageContentProps {
  content: string;
  className?: string;
  toolLabel?: string | null;
  defaultCollapseTools?: boolean;
  forceToolBlock?: boolean;
}

export function AssistantMessageContent({
  content,
  className,
  toolLabel,
  defaultCollapseTools = true,
  forceToolBlock = false,
}: AssistantMessageContentProps) {
  const segments = forceToolBlock
    ? [{ type: "tool" as const, content, label: toolLabel }]
    : parseAssistantContent(content);

  return (
    <div className={styles.root}>
      {segments.map((segment, index) => {
        if (segment.type === "markdown") {
          return (
            <Fragment key={`markdown-${index}`}>
              <MarkdownRenderer content={segment.content} className={className} />
            </Fragment>
          );
        }

        const label = summarizeToolContent(segment.content, segment.label ?? toolLabel);
        return (
          <details
            key={`tool-${index}`}
            className={styles.toolBlock}
            open={!defaultCollapseTools}
          >
            <summary className={styles.toolSummary}>
              <span className={styles.toolBadge}>工具调用</span>
              <span className={styles.toolLabel}>{label}</span>
            </summary>
            <pre className={styles.toolContent}>{segment.content}</pre>
          </details>
        );
      })}
    </div>
  );
}
