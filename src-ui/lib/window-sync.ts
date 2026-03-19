import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UIMessage } from "./types";
import { hasTauriBackend } from "./tauri-gateway";

const WINDOW_LABELS = ["main", "pet"] as const;
const SESSION_EVENT = "clawtachie://sync-session";
const USER_MESSAGE_EVENT = "clawtachie://sync-user-message";

interface SessionSyncPayload {
  sessionKey: string;
}

interface UserMessageSyncPayload {
  sessionKey: string;
  message: UIMessage;
}

async function emitToOtherWindows<T>(event: string, payload: T) {
  if (!hasTauriBackend()) {
    return;
  }

  const currentLabel = getCurrentWindow().label;
  const targets = WINDOW_LABELS.filter((label) => label !== currentLabel);

  await Promise.all(
    targets.map((target) =>
      emitTo(target, event, payload).catch(() => undefined),
    ),
  );
}

export async function broadcastSessionChange(sessionKey: string) {
  await emitToOtherWindows<SessionSyncPayload>(SESSION_EVENT, { sessionKey });
}

export async function broadcastUserMessage(sessionKey: string, message: UIMessage) {
  await emitToOtherWindows<UserMessageSyncPayload>(USER_MESSAGE_EVENT, {
    sessionKey,
    message,
  });
}

export async function subscribeWindowSync(listeners: {
  onSessionChange?: (payload: SessionSyncPayload) => void;
  onUserMessage?: (payload: UserMessageSyncPayload) => void;
}): Promise<UnlistenFn[]> {
  if (!hasTauriBackend()) {
    return [];
  }

  const subscriptions: Promise<UnlistenFn>[] = [];

  if (listeners.onSessionChange) {
    subscriptions.push(
      listen<SessionSyncPayload>(SESSION_EVENT, (event) => {
        listeners.onSessionChange?.(event.payload);
      }),
    );
  }

  if (listeners.onUserMessage) {
    subscriptions.push(
      listen<UserMessageSyncPayload>(USER_MESSAGE_EVENT, (event) => {
        listeners.onUserMessage?.(event.payload);
      }),
    );
  }

  return Promise.all(subscriptions);
}
