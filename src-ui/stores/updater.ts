import { create } from "zustand";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { getUpdaterProxy, hasTauriBackend } from "../lib/tauri-gateway";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "upToDate"
  | "downloading"
  | "installing"
  | "error";

interface CheckForUpdatesOptions {
  silent?: boolean;
}

interface UpdaterState {
  currentVersion: string | null;
  latestVersion: string | null;
  status: UpdateStatus;
  lastCheckedAt: number | null;
  progress: number | null;
  error: string | null;
  initialize: () => Promise<void>;
  checkForUpdates: (options?: CheckForUpdatesOptions) => Promise<boolean>;
}

let initializePromise: Promise<void> | null = null;
let checkPromise: Promise<boolean> | null = null;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown update error";
}

export const useUpdater = create<UpdaterState>()((set, get) => ({
  currentVersion: null,
  latestVersion: null,
  status: "idle",
  lastCheckedAt: null,
  progress: null,
  error: null,

  initialize: async () => {
    if (!hasTauriBackend() || get().currentVersion) {
      return;
    }

    if (initializePromise) {
      return initializePromise;
    }

    initializePromise = (async () => {
      try {
        const currentVersion = await getVersion();
        set({ currentVersion });
      } finally {
        initializePromise = null;
      }
    })();

    return initializePromise;
  },

  checkForUpdates: async ({ silent = false } = {}) => {
    if (!hasTauriBackend()) {
      if (!silent) {
        set({
          status: "error",
          error: "Auto update is only available in the packaged desktop app.",
        });
      }
      return false;
    }

    await get().initialize();

    if (checkPromise) {
      return checkPromise;
    }

    checkPromise = (async () => {
      const checkedAt = Date.now();
      set({
        status: "checking",
        error: null,
        progress: null,
      });

      try {
        const proxy = await getUpdaterProxy();
        const update = await check(proxy ? { proxy } : undefined);

        if (!update) {
          set((state) => ({
            status: "upToDate",
            latestVersion: state.currentVersion,
            lastCheckedAt: checkedAt,
            progress: null,
            error: null,
          }));
          return false;
        }

        let downloadedBytes = 0;
        let totalBytes: number | null = null;

        set({
          status: "downloading",
          latestVersion: update.version,
          lastCheckedAt: checkedAt,
          progress: 0,
          error: null,
        });

        await update.downloadAndInstall((event) => {
          switch (event.event) {
            case "Started":
              downloadedBytes = 0;
              totalBytes = event.data.contentLength ?? null;
              set({ status: "downloading", progress: 0 });
              break;
            case "Progress":
              downloadedBytes += event.data.chunkLength;
              set({
                status: "downloading",
                progress: totalBytes ? Math.min(downloadedBytes / totalBytes, 1) : null,
              });
              break;
            case "Finished":
              set({
                status: "installing",
                progress: 1,
              });
              break;
          }
        });

        set({
          status: "installing",
          progress: 1,
          error: null,
        });

        await relaunch();
        return true;
      } catch (error) {
        set({
          status: "error",
          error: getErrorMessage(error),
          lastCheckedAt: checkedAt,
          progress: null,
        });
        return false;
      } finally {
        checkPromise = null;
      }
    })();

    return checkPromise;
  },
}));
