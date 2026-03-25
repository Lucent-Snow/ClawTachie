import type { GatewayChatAttachment, UIAttachment } from "./types";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Unexpected file reader result"));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function splitDataUrl(dataUrl: string): { mimeType: string | null; base64Content: string | null } {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) {
    return {
      mimeType: null,
      base64Content: null,
    };
  }

  return {
    mimeType: match[1] || null,
    base64Content: match[2] || null,
  };
}

function buildDataUrl(mimeType: string | null, base64Content: string | null): string | null {
  if (!mimeType || !base64Content) {
    return null;
  }

  return `data:${mimeType};base64,${base64Content}`;
}

export async function fileToImageAttachment(file: File): Promise<UIAttachment> {
  const dataUrl = await readFileAsDataUrl(file);
  const { mimeType, base64Content } = splitDataUrl(dataUrl);

  return {
    id: crypto.randomUUID(),
    kind: "image",
    name: file.name || null,
    mimeType: (mimeType ?? file.type) || null,
    url: dataUrl,
    base64Content,
  };
}

export function extractImageFiles(items: ArrayLike<DataTransferItem>): File[] {
  const files: File[] = [];

  for (const item of Array.from(items)) {
    if (item.kind !== "file") {
      continue;
    }

    const file = item.getAsFile();
    if (!file || !file.type.startsWith("image/")) {
      continue;
    }

    files.push(file);
  }

  return files;
}

export function attachmentsToGatewayPayload(
  attachments: UIAttachment[] | undefined,
): GatewayChatAttachment[] | undefined {
  const payload = attachments
    ?.filter((attachment) => attachment.kind === "image" && attachment.base64Content)
    .map((attachment) => ({
      type: "image",
      mimeType: attachment.mimeType ?? undefined,
      fileName: attachment.name ?? undefined,
      content: attachment.base64Content ?? undefined,
    }))
    .filter((attachment) => typeof attachment.content === "string" && attachment.content.length > 0);

  return payload && payload.length > 0 ? payload : undefined;
}

function extractImageAttachmentFromContentPart(
  part: Record<string, unknown>,
  index: number,
): UIAttachment | null {
  if (part.type !== "image") {
    return null;
  }

  const source = typeof part.source === "object" && part.source !== null
    ? (part.source as Record<string, unknown>)
    : null;

  const directUrl =
    typeof part.url === "string" && part.url.trim().length > 0 ? part.url.trim() : null;
  const sourceUrl =
    source && typeof source.url === "string" && source.url.trim().length > 0
      ? source.url.trim()
      : null;
  const mimeType =
    (source && typeof source.media_type === "string" && source.media_type.trim().length > 0
      ? source.media_type.trim()
      : null)
    ?? (typeof part.mimeType === "string" && part.mimeType.trim().length > 0
      ? part.mimeType.trim()
      : null);
  const base64Content =
    (source && typeof source.data === "string" && source.data.trim().length > 0
      ? source.data.trim()
      : null)
    ?? (typeof part.content === "string" && part.content.trim().length > 0
      ? part.content.trim()
      : null);
  const inlineDataUrl =
    base64Content && base64Content.startsWith("data:") ? base64Content : null;
  const inlineUrl = buildDataUrl(
    mimeType,
    base64Content && !base64Content.startsWith("data:") ? base64Content : null,
  );
  const url = directUrl ?? sourceUrl ?? inlineDataUrl ?? inlineUrl;

  if (!url) {
    return null;
  }

  return {
    id: `${index}:${url}`,
    kind: "image",
    name: typeof part.fileName === "string" ? part.fileName : null,
    mimeType,
    url,
    base64Content: base64Content && !base64Content.startsWith("data:") ? base64Content : null,
  };
}

export function extractImageAttachments(message: Record<string, unknown>): UIAttachment[] {
  const attachments: UIAttachment[] = [];

  const content = message.content;
  if (Array.isArray(content)) {
    attachments.push(
      ...content
        .map((part, index) => {
          if (!part || typeof part !== "object") {
            return null;
          }
          return extractImageAttachmentFromContentPart(part as Record<string, unknown>, index);
        })
        .filter((attachment): attachment is UIAttachment => attachment !== null),
    );
  }

  const rawAttachments = message.attachments;
  if (Array.isArray(rawAttachments)) {
    attachments.push(
      ...rawAttachments
        .map((part, index) => {
          if (!part || typeof part !== "object") {
            return null;
          }
          return extractImageAttachmentFromContentPart(
            {
              type: "image",
              ...part,
            } as Record<string, unknown>,
            content && Array.isArray(content) ? content.length + index : index,
          );
        })
        .filter((attachment): attachment is UIAttachment => attachment !== null),
    );
  }

  return attachments.filter((attachment, index, list) =>
      list.findIndex((candidate) => candidate.url === attachment.url) === index,
    );
}
