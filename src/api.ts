import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AppInfo, Session } from "./model";

export const native = isTauri();
export const api = invoke;
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export interface FileEntry {
  name: string;
  relativePath: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
}
export interface GitChange {
  path: string;
  originalPath: string | null;
  index: string;
  worktree: string;
}
export interface GitStatus {
  root: string;
  branch: string;
  changes: GitChange[];
}

export const getInfo = () => api<AppInfo>("app_info");
export const loadSession = () => api<unknown>("load_session");
let pendingSave = Promise.resolve();
export function saveSession(data: Session) {
  pendingSave = pendingSave
    .catch(() => {})
    .then(() => api("save_session", { data }));
  return pendingSave;
}
