import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import styles from "./MarkdownRenderer.module.css";

type MarkdownRendererProps = {
  content: string;
  className?: string;
};

function resolveCodeLanguage(className?: string): string | undefined {
  const match = /language-([\w-]+)/.exec(className ?? "");
  return match?.[1];
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const rootClassName = className ? `${styles.markdown} ${className}` : styles.markdown;

  return (
    <div className={rootClassName}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noreferrer noopener"
            />
          ),
          code: ({ className: codeClassName, children, ...props }) => {
            const language = resolveCodeLanguage(codeClassName);
            const text = String(children).replace(/\n$/, "");
            const isBlock = Boolean(language) || text.includes("\n");

            if (!isBlock) {
              return (
                <code className={styles.inlineCode} {...props}>
                  {children}
                </code>
              );
            }

            return (
              <div className={styles.codeBlock}>
                <SyntaxHighlighter
                  language={language}
                  style={oneLight}
                  customStyle={{ margin: 0, background: "transparent" }}
                  codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
                  wrapLongLines
                >
                  {text}
                </SyntaxHighlighter>
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
