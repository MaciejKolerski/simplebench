import type { ComponentType, Context } from "react";
export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export type Dispose = () => void;
export interface HostSnapshot {
  projectPath: string | null;
  workspaceName: string | null;
  activePanelId: string | null;
  viewType: string | null;
  appearance: "light" | "dark";
  themeRevision: number;
}
export const HostContext: Context<HostSnapshot>;
export function useHostContext(): HostSnapshot;
export interface PanelDescriptor {
  type: "plugin";
  id: string;
  title: string;
  customTitle?: string;
  owner: string;
  viewType: string;
  stateVersion: number;
  state: Json;
}
export interface ViewProps {
  panel: PanelDescriptor;
  active: boolean;
  setState(state: Json): void;
  onFocus(): void;
  onClose(): void;
}
export interface DirtyView {
  title: string;
  isDirty(): boolean;
  save(): Promise<void>;
  discard(): void;
}
export interface CommandContext {
  workspace?: boolean;
  viewTypes?: string[];
  textInput?: boolean;
}
export interface PluginManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  description: string;
  hostApi: 1;
  entry?: string;
  activation?: "startup" | "lazy";
  stylesheets?: string[];
  contributes?: {
    views?: {
      id: string;
      title: string;
      placement: "central" | "sidebar";
      multiple: boolean;
      stateVersion: number;
    }[];
    commands?: {
      id: string;
      label: string;
      description: string;
      context?: CommandContext;
    }[];
    keybindings?: { command: string; shortcut: string | null }[];
    fills?: {
      id: string;
      slot: "statusbar" | "sidebar-actions" | "view-actions";
      label: string;
    }[];
    themes?: { id: string; path: string }[];
  };
}
export interface HostEvents {
  context: HostSnapshot;
  theme: { revision: number; appearance: "light" | "dark" };
  contributions: { owner: string };
}
export interface PluginContext {
  readonly id: string;
  readonly signal: AbortSignal;
  snapshot(): HostSnapshot;
  registerView(id: string, component: ComponentType<ViewProps>): Dispose;
  registerCommand(id: string, handler: () => void | Promise<void>): Dispose;
  registerFill(id: string, component: ComponentType): Dispose;
  registerDirtyView(panelId: string, view: DirtyView): Dispose;
  openView(id: string, state?: Json): Promise<string>;
  executeCommand(id: string): Promise<void>;
  subscribe<K extends keyof HostEvents>(
    event: K,
    handler: (payload: HostEvents[K]) => void,
  ): Dispose;
  interval(callback: () => void, milliseconds: number): Dispose;
  add(dispose: Dispose): Dispose;
  assetUrl(path: string): string;
}
export interface PluginModule {
  activate(context: PluginContext): void | Dispose | Promise<void | Dispose>;
  deactivate?(): void | Promise<void>;
}
