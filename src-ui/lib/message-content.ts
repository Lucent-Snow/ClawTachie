export interface AssistantContentSegment {
  type: "markdown" | "tool";
  content: string;
  label?: string | null;
}

const TOOL_LINE_RE =
  /^(?:tool(?:\s+(?:call|result))?|function(?:\s+(?:call|result))?|calling tool|tool use|工具(?:调用|结果)|调用工具)\b/i;
const TOOL_FENCE_RE = /^```[ \t]*([\w-]+)?[ \t]*$/;
const TOOL_XML_OPEN_RE = /^<(tool_call|tool_result|function_call|function_result|tool-use|tool_result)\b/i;
const TOOL_XML_CLOSE_RE = /<\/(tool_call|tool_result|function_call|function_result|tool-use|tool_result)>/i;

function normalizeLineBreaks(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

function isToolFence(line: string): boolean {
  const match = line.match(TOOL_FENCE_RE);
  if (!match) return false;
  return /(tool|function)/i.test(match[1] ?? "");
}

function isToolLabelLine(line: string): boolean {
  return TOOL_LINE_RE.test(line.trim());
}

function isToolXmlLine(line: string): boolean {
  return TOOL_XML_OPEN_RE.test(line.trim());
}

function isLikelyToolContinuation(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;

  return (
    /^[\[{(]/.test(trimmed) ||
    /^[\]})]/.test(trimmed) ||
    /^["']/.test(trimmed) ||
    /^[-*]/.test(trimmed) ||
    /^[@#$]/.test(trimmed) ||
    /^</.test(trimmed) ||
    /^\s/.test(line) ||
    /^[A-Za-z0-9_-]+\s*[:=]/.test(trimmed) ||
    /^(args?|arguments?|input|output|result|name|id|status|tool)\b/i.test(trimmed)
  );
}

function summarizeToolLabel(content: string, explicitLabel?: string | null): string {
  if (explicitLabel?.trim()) {
    return explicitLabel.trim();
  }

  const lines = normalizeLineBreaks(content)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const firstMeaningfulLine = lines.find(
    (line) => !line.startsWith("```") && !line.startsWith("</") && !line.startsWith("<"),
  );

  if (!firstMeaningfulLine) {
    return "工具调用";
  }

  const compact = firstMeaningfulLine
    .replace(TOOL_LINE_RE, "")
    .replace(/^[:：\-\s]+/, "")
    .trim();

  return compact ? compact.slice(0, 48) : "工具调用";
}

export function parseAssistantContent(content: string): AssistantContentSegment[] {
  const normalized = normalizeLineBreaks(content);
  const lines = normalized.split("\n");
  const segments: AssistantContentSegment[] = [];
  const markdownBuffer: string[] = [];

  const flushMarkdown = () => {
    const joined = markdownBuffer.join("\n").trim();
    markdownBuffer.length = 0;
    if (!joined) return;
    segments.push({
      type: "markdown",
      content: joined,
    });
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (isToolFence(line)) {
      flushMarkdown();
      const toolLines = [line];
      index += 1;
      while (index < lines.length) {
        toolLines.push(lines[index] ?? "");
        if ((lines[index] ?? "").trim() === "```") {
          index += 1;
          break;
        }
        index += 1;
      }
      const toolContent = toolLines.join("\n").trim();
      segments.push({
        type: "tool",
        content: toolContent,
        label: summarizeToolLabel(toolContent),
      });
      continue;
    }

    if (isToolXmlLine(line)) {
      flushMarkdown();
      const toolLines = [line];
      index += 1;
      while (index < lines.length) {
        const nextLine = lines[index] ?? "";
        toolLines.push(nextLine);
        index += 1;
        if (TOOL_XML_CLOSE_RE.test(nextLine.trim())) {
          break;
        }
      }
      const toolContent = toolLines.join("\n").trim();
      segments.push({
        type: "tool",
        content: toolContent,
        label: summarizeToolLabel(toolContent),
      });
      continue;
    }

    if (isToolLabelLine(line)) {
      flushMarkdown();
      const toolLines = [line];
      index += 1;
      while (index < lines.length) {
        const nextLine = lines[index] ?? "";
        const nextTrimmed = nextLine.trim();
        if (!nextTrimmed) {
          toolLines.push(nextLine);
          index += 1;
          break;
        }
        if (isToolLabelLine(nextLine) || isLikelyToolContinuation(nextLine)) {
          toolLines.push(nextLine);
          index += 1;
          continue;
        }
        break;
      }
      const toolContent = toolLines.join("\n").trim();
      segments.push({
        type: "tool",
        content: toolContent,
        label: summarizeToolLabel(toolContent),
      });
      continue;
    }

    markdownBuffer.push(line);
    index += 1;
  }

  flushMarkdown();

  return segments.length > 0
    ? segments
    : [{ type: "markdown", content: normalized.trim() }];
}

export function summarizeToolContent(
  content: string,
  explicitLabel?: string | null,
): string {
  return summarizeToolLabel(content, explicitLabel);
}
