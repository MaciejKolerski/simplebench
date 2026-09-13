import type { Locator, Page } from "@playwright/test";
import { newProject, newSession } from "../../src/model";
import type {
  GitCommitDetails,
  GitCommitDiff,
  GitCommitSummary,
} from "../../src/api";

export interface MockGitHistory {
  commits: GitCommitSummary[];
  details: Record<string, GitCommitDetails>;
  diffs: Record<string, GitCommitDiff>;
}

const project = newProject("/project", "local:bash");
const initialSession = {
  ...newSession(),
  projects: [project],
  activeProjectId: project.id,
};

export async function mockDesktop(
  page: Page,
  repository = true,
  saved: unknown = initialSession,
  gitHistory?: MockGitHistory,
  editorFiles: Record<
    string,
    { content: string; revision: string; encoding: string; readOnly: boolean }
  > = {},
  platform: "linux" | "macos" | "windows" = "linux",
) {
  await page.addInitScript(
    ({ repository, saved, gitHistory, editorFiles, platform }) => {
      Object.defineProperty(navigator, "platform", {
        configurable: true,
        value:
          platform === "macos"
            ? "MacIntel"
            : platform === "windows"
              ? "Win32"
              : "Linux x86_64",
      });
      const callbacks = new Map<number, (value: unknown) => void>();
      let callbackId = 0;
      let repositoryPresent = repository;
      let changes = [
        { path: "README.md", originalPath: null, index: " ", worktree: "M" },
      ];
      const calls: { command: string; args: Record<string, any> }[] = [];
      const browsers = new Map<string, any>();
      const sessions = new Map<string, { output: number; index: number }>();
      const events = new Map<number, { event: string; handler: number }>();
      const emitEvent = async (event: string, payload: unknown = null) => {
        for (const [id, listener] of events) {
          if (listener.event === event)
            await callbacks.get(listener.handler)?.({
              event,
              id,
              payload,
            });
        }
      };
      const emit = (id: string, text: string) => {
        const session = sessions.get(id)!;
        callbacks.get(session.output)?.({
          index: session.index++,
          message: new TextEncoder().encode(text).buffer,
        });
      };
      const desktop = window as any;
      desktop.isTauri = true;
      desktop.__nativeTest = {
        localWebServers: [] as string[],
        localWebServersError: "",
        localWebServersDelay: 0,
        localWebServersProgress: null as string[] | null,
        localWebServersCompleted: 0,
        editorFiles: JSON.parse(
          localStorage.getItem("test-editor-files") ??
            JSON.stringify(editorFiles),
        ),
        fileReadError: "",
        failFileSave: false,
        fileSaveDelay: 0,
        failZoom: false,
        zoomDelay: 0,
        zoom: 1,
        fullscreen: false,
        newFilePath: null as string | null,
        fileReadDelays: {} as Record<string, number>,
        emitEvent,
        calls,
        sessions,
        browsers,
        terminalContexts: {},
        busyTerminals: [] as string[],
        terminalProcessError: "",
        terminalProcessDelay: 0,
        cliTitleSetup: null,
        cliTitleError: "",
        cliTitleSaveDelay: 0,
        emit,
        failSave: false,
        gitHistory,
        failHistory: false,
        failCommitDetails: false,
        failCommitDiff: false,
        diffDelays: {} as Record<string, number>,
        resolvedDiffs: [] as string[],
        folder: "/chosen folder",
        directoryError: "",
        failKeybindingsSave: false,
        failEditorPreferencesSave: false,
        failTerminalPreferencesSave: false,
        failThemeSave: false,
        themeLoadError: "",
        themeImportError: "",
        setRepository: (value: boolean) => {
          repositoryPresent = value;
        },
      };
      window.addEventListener("storage", (event) => {
        if (event.key === "test-terminal-preferences")
          void emitEvent("terminal-preferences-changed");
        if (event.key === "test-editor-preferences")
          void emitEvent("editor-preferences-changed");
        if (event.key === "test-keybindings")
          void emitEvent("keybindings-changed");
        if (
          event.key === "test-theme-settings" ||
          event.key === "test-theme-refresh"
        )
          void emitEvent("theme-changed");
      });
      desktop.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      desktop.__TAURI_INTERNALS__ = {
        convertFileSrc(path: string, protocol: string) {
          return `${location.origin}/${protocol}-assets/${path}`;
        },
        metadata: {
          currentWindow: {
            label: location.search.includes("settings") ? "settings" : "main",
          },
          currentWebview: {
            label: location.search.includes("settings") ? "settings" : "main",
          },
        },
        transformCallback(callback: (value: unknown) => void) {
          const id = ++callbackId;
          callbacks.set(id, callback);
          return id;
        },
        unregisterCallback(id: number) {
          callbacks.delete(id);
        },
        async invoke(command: string, args: Record<string, any> = {}) {
          calls.push({ command, args: JSON.parse(JSON.stringify(args)) });
          if (command === "local_web_servers") {
            const result = [...desktop.__nativeTest.localWebServers];
            let index = 0;
            try {
              if (desktop.__nativeTest.localWebServersError)
                throw new Error(desktop.__nativeTest.localWebServersError);
              for (const url of desktop.__nativeTest.localWebServersProgress ??
                result)
                callbacks.get(args.onFound.id)?.({
                  index: index++,
                  message: url,
                });
              if (desktop.__nativeTest.localWebServersDelay)
                await new Promise((resolve) =>
                  setTimeout(
                    resolve,
                    desktop.__nativeTest.localWebServersDelay,
                  ),
                );
              desktop.__nativeTest.localWebServersCompleted++;
              return result;
            } finally {
              callbacks.get(args.onFound.id)?.({ index, end: true });
            }
          }
          if (command === "sync_browsers") {
            for (const id of browsers.keys())
              if (!args.retained.includes(id)) browsers.delete(id);
            for (const browser of browsers.values()) browser.visible = false;
            for (const slot of args.slots) {
              if (!browsers.has(slot.id))
                browsers.set(slot.id, {
                  id: slot.id,
                  url: slot.url,
                  title: "Browser",
                  loading: false,
                  error: "",
                  download: "",
                  visits: 1,
                });
              Object.assign(browsers.get(slot.id), {
                visible: true,
                bounds: slot.bounds,
              });
            }
            return [...browsers.values()].map(
              ({ id, url, title, loading, error, download }) => ({
                id,
                url,
                title,
                loading,
                error,
                download,
              }),
            );
          }
          if (command === "browser_action") {
            const browser = browsers.get(args.id);
            if (!browser) throw new Error("Browser panel is closed.");
            if (args.action.type === "navigate") {
              browser.url = args.action.url;
              browser.visits++;
            }
            if (args.action.type === "reload") browser.visits++;
            await emitEvent("browser-page", {
              id: browser.id,
              url: browser.url,
              title: browser.title,
              loading: false,
              error: "",
              download: "",
            });
            return;
          }
          if (command === "show_ready_window") return true;
          if (command === "plugin:webview|set_webview_zoom") {
            if (desktop.__nativeTest.zoomDelay)
              await new Promise((resolve) =>
                setTimeout(resolve, desktop.__nativeTest.zoomDelay),
              );
            if (desktop.__nativeTest.failZoom)
              throw new Error("Zoom unavailable");
            desktop.__nativeTest.zoom = args.value;
            return;
          }
          if (command === "resolve_editor_file") return args.relative;
          if (command === "watch_editor_files") return;
          if (command === "save_new_editor_file") {
            if (desktop.__nativeTest.fileSaveDelay)
              await new Promise((resolve) =>
                setTimeout(resolve, desktop.__nativeTest.fileSaveDelay),
              );
            if (desktop.__nativeTest.failFileSave)
              throw { kind: "io", message: "Disk is full" };
            const path = desktop.__nativeTest.newFilePath;
            if (!path) return null;
            const separator = path.lastIndexOf("/");
            const root = path.slice(0, separator);
            const relative = path.slice(separator + 1);
            if (
              args.openFiles.some(
                (file: any) => `${file.root}/${file.relative}` === path,
              )
            )
              throw {
                kind: "openFile",
                message:
                  "This file is already open. Close its editor tabs before replacing it.",
              };
            const file = {
              content: args.content,
              revision: crypto.randomUUID(),
              encoding: "utf8",
              readOnly: false,
            };
            desktop.__nativeTest.editorFiles[path] = file;
            localStorage.setItem(
              "test-editor-files",
              JSON.stringify(desktop.__nativeTest.editorFiles),
            );
            return {
              location: { root, relative },
              file: { ...file, path, relative },
            };
          }
          if (
            command === "read_editor_file" ||
            command === "save_editor_file"
          ) {
            const request =
              command === "read_editor_file" ? args : args.request;
            const key = `${request.root}/${request.relative}`;
            const files = desktop.__nativeTest.editorFiles;
            if (!Object.hasOwn(files, key))
              files[key] = {
                content: request.relative.endsWith(".md")
                  ? "# Project\nA text file preview.\n"
                  : 'fn main() {\n    println!("Hello, 🦀!");\n}\n',
                revision: "initial",
                encoding: "utf8",
                readOnly: false,
              };
            if (command === "read_editor_file") {
              if (desktop.__nativeTest.fileReadError)
                throw {
                  kind: "io",
                  message: desktop.__nativeTest.fileReadError,
                };
              const delay =
                desktop.__nativeTest.fileReadDelays[request.relative];
              if (delay)
                await new Promise((resolve) => setTimeout(resolve, delay));
              const file = files[key];
              if (!file)
                throw { kind: "io", message: "The file no longer exists." };
              return {
                ...file,
                path: key,
                relative: request.relative,
                content:
                  file.revision === args.knownRevision ? null : file.content,
              };
            }
            if (desktop.__nativeTest.fileSaveDelay)
              await new Promise((resolve) =>
                setTimeout(resolve, desktop.__nativeTest.fileSaveDelay),
              );
            if (desktop.__nativeTest.failFileSave)
              throw { kind: "io", message: "Disk is full" };
            const file = files[key];
            if (!file)
              throw { kind: "io", message: "The file no longer exists." };
            if (request.revision !== file.revision)
              throw { kind: "conflict", message: "The file changed on disk." };
            if (file.readOnly)
              throw { kind: "readOnly", message: "This file is read-only." };
            file.content = request.content;
            file.revision += "+saved";
            localStorage.setItem("test-editor-files", JSON.stringify(files));
            await emitEvent("editor-files-changed", [key]);
            return file.revision;
          }
          if (command === "app_info")
            return {
              directory: "/project",
              home: "/home/test",
              platform,
              profiles: [
                {
                  id: "local:bash",
                  name: "bash",
                  kind: "bash",
                  program: "/bin/bash",
                  distro: null,
                  home: "/home/test",
                },
              ],
            };
          if (command === "load_session")
            return JSON.parse(
              localStorage.getItem("test-session") ?? JSON.stringify(saved),
            );
          if (command === "load_keybindings")
            return JSON.parse(
              localStorage.getItem("test-keybindings") ?? "null",
            );
          if (command === "load_terminal_preferences")
            return JSON.parse(
              localStorage.getItem("test-terminal-preferences") ?? "null",
            );
          if (command === "load_editor_preferences")
            return JSON.parse(
              localStorage.getItem("test-editor-preferences") ?? "null",
            );
          if (command === "list_themes") {
            const manifests = JSON.parse(
              localStorage.getItem("test-theme-manifests") ?? "{}",
            );
            return {
              directory:
                "/home/test/.local/share/dev.simplebench.desktop/themes",
              themes: Object.entries(manifests).map(
                ([id, value]: [string, any]) => ({
                  id,
                  name: value.name ?? id,
                  description: value.description ?? "",
                  author: value.author ?? "",
                  error:
                    value.version === 1 ? null : "Unsupported theme version",
                }),
              ),
            };
          }
          if (command === "load_theme") {
            const manifest = JSON.parse(
              localStorage.getItem("test-theme-manifests") ?? "{}",
            )[args.id];
            if (!manifest) throw new Error("Theme folder is missing.");
            return { id: args.id, manifest };
          }
          if (command === "load_theme_preferences") {
            if (desktop.__nativeTest.themeLoadError)
              throw new Error(desktop.__nativeTest.themeLoadError);
            const preferences = JSON.parse(
              localStorage.getItem("test-theme-settings") ??
                '{"version":1,"active":null}',
            );
            if (preferences.version !== 1)
              throw new Error(
                "Unsupported theme settings version. The file has been left intact.",
              );
            delete preferences.customCss;
            preferences.appearance ??= "system";
            if (!["system", "light", "dark"].includes(preferences.appearance))
              throw new Error(
                "Invalid color mode. The file has been left intact.",
              );
            const manifest = JSON.parse(
              localStorage.getItem("test-theme-manifests") ?? "{}",
            )[preferences.active];
            if (preferences.active && !manifest)
              throw new Error("Theme folder is missing.");
            return {
              preferences,
              theme: manifest ? { id: preferences.active, manifest } : null,
              safeMode: false,
            };
          }
          if (command === "save_theme_preferences") {
            if (desktop.__nativeTest.failThemeSave)
              throw new Error("Cannot save theme: Disk is full");
            localStorage.setItem(
              "test-theme-settings",
              JSON.stringify(args.data),
            );
            await emitEvent("theme-changed");
            return;
          }
          if (command === "save_theme_manifest") {
            if (desktop.__nativeTest.failThemeSave)
              throw new Error("Cannot save theme: Disk is full");
            const manifests = JSON.parse(
              localStorage.getItem("test-theme-manifests") ?? "{}",
            );
            if (
              JSON.stringify(manifests[args.id]) !==
              JSON.stringify(args.expected)
            )
              throw new Error(
                "This theme changed on disk. Reopen the editor before saving; your draft is still available.",
              );
            manifests[args.id] = args.data;
            localStorage.setItem(
              "test-theme-manifests",
              JSON.stringify(manifests),
            );
            localStorage.setItem("test-theme-refresh", String(Date.now()));
            await emitEvent("theme-changed");
            return;
          }
          if (command === "refresh_themes") {
            localStorage.setItem("test-theme-refresh", String(Date.now()));
            await emitEvent("theme-changed");
            return;
          }
          if (command === "import_theme" || command === "create_theme") {
            if (desktop.__nativeTest.themeImportError)
              throw new Error(desktop.__nativeTest.themeImportError);
            const manifests = JSON.parse(
              localStorage.getItem("test-theme-manifests") ?? "{}",
            );
            manifests.imported = {
              version: 1,
              name: "Imported theme",
              tokens: { "--radius-control": "12px" },
            };
            localStorage.setItem(
              "test-theme-manifests",
              JSON.stringify(manifests),
            );
            return "imported";
          }
          if (["sync_theme_window", "open_themes_folder"].includes(command))
            return;
          if (command === "save_keybindings") {
            if (desktop.__nativeTest.failKeybindingsSave)
              throw new Error("Cannot save shortcuts: Disk is full");
            localStorage.setItem("test-keybindings", JSON.stringify(args.data));
            await emitEvent("keybindings-changed");
            return;
          }
          if (command === "save_terminal_preferences") {
            if (desktop.__nativeTest.failTerminalPreferencesSave)
              throw "Disk is full";
            localStorage.setItem(
              "test-terminal-preferences",
              JSON.stringify(args.data),
            );
            await emitEvent("terminal-preferences-changed");
            return;
          }
          if (command === "save_editor_preferences") {
            if (desktop.__nativeTest.failEditorPreferencesSave)
              throw new Error("Cannot save editor settings: Disk is full");
            localStorage.setItem(
              "test-editor-preferences",
              JSON.stringify(args.data),
            );
            await emitEvent("editor-preferences-changed");
            return;
          }
          if (command === "save_session") {
            if (desktop.__nativeTest.failSave) throw new Error("Disk is full");
            localStorage.setItem("test-session", JSON.stringify(args.data));
            return;
          }
          if (command === "validate_directory") {
            if (desktop.__nativeTest.directoryError)
              throw new Error(desktop.__nativeTest.directoryError);
            return args.path;
          }
          if (command === "list_directory")
            return args.relative
              ? [
                  {
                    name: "main.ts",
                    relativePath: "src/main.ts",
                    path: `${args.root}/src/main.ts`,
                    isDirectory: false,
                    isSymlink: false,
                  },
                ]
              : [
                  {
                    name: "src",
                    relativePath: "src",
                    path: `${args.root}/src`,
                    isDirectory: true,
                    isSymlink: false,
                  },
                  {
                    name: "README.md",
                    relativePath: "README.md",
                    path: `${args.root}/README.md`,
                    isDirectory: false,
                    isSymlink: false,
                  },
                  {
                    name: "it's a file.txt",
                    relativePath: "it's a file.txt",
                    path: `${args.root}/it's a file.txt`,
                    isDirectory: false,
                    isSymlink: false,
                  },
                ];
          if (command === "preview_file")
            return "# Project\nA text file preview.";
          if (command === "git_status")
            return repositoryPresent
              ? { root: args.root, branch: "main", changes }
              : null;
          if (command === "git_history") {
            if (desktop.__nativeTest.failHistory)
              throw new Error("History is unavailable");
            const commits = desktop.__nativeTest.gitHistory?.commits ?? [];
            return {
              commits: commits.slice(args.skip, args.skip + 50),
              tips:
                args.tips ??
                commits.slice(0, 1).map((commit: any) => commit.id),
              hasMore: commits.length > args.skip + 50,
            };
          }
          if (command === "git_commit_details") {
            if (desktop.__nativeTest.failCommitDetails)
              throw new Error("Commit is unavailable");
            const details = desktop.__nativeTest.gitHistory?.details[args.id];
            if (!details) throw new Error("Commit was not found");
            return details;
          }
          if (command === "git_commit_diff") {
            if (desktop.__nativeTest.failCommitDiff)
              throw new Error("Diff is unavailable");
            const diff = desktop.__nativeTest.gitHistory?.diffs[args.path];
            if (!diff) throw new Error("Diff was not found");
            const delay = desktop.__nativeTest.diffDelays[args.path];
            if (delay)
              await new Promise((resolve) => setTimeout(resolve, delay));
            desktop.__nativeTest.resolvedDiffs.push(args.path);
            return diff;
          }
          if (command === "git_stage") {
            changes = changes.map((change) => ({
              ...change,
              index: args.stage ? "M" : " ",
              worktree: args.stage ? " " : "M",
            }));
            return;
          }
          if (command === "git_diff")
            return "diff --git a/README.md b/README.md\n-old\n+new";
          if (command === "git_commit") {
            changes = [];
            return;
          }
          if (command === "start_terminal") {
            sessions.set(args.request.id, { output: args.output.id, index: 0 });
            setTimeout(
              () =>
                emit(
                  args.request.id,
                  `\x1b]7;file://localhost${args.request.cwd}\x07\x1b]133;A\x07bash $ \x1b]133;B\x07`,
                ),
              10,
            );
            return { cwd: args.request.cwd, profileId: args.request.profileId };
          }
          if (command === "terminal_contexts")
            return desktop.__nativeTest.terminalContexts;
          if (command === "busy_terminals") {
            if (desktop.__nativeTest.terminalProcessDelay)
              await new Promise((resolve) =>
                setTimeout(resolve, desktop.__nativeTest.terminalProcessDelay),
              );
            if (desktop.__nativeTest.terminalProcessError)
              throw new Error(desktop.__nativeTest.terminalProcessError);
            return desktop.__nativeTest.busyTerminals.filter((id: string) =>
              args.ids.includes(id),
            );
          }
          if (command === "inspect_cli_titles")
            return desktop.__nativeTest.cliTitleSetup;
          if (command === "enable_cli_titles") {
            await new Promise((resolve) =>
              setTimeout(resolve, desktop.__nativeTest.cliTitleSaveDelay),
            );
            if (desktop.__nativeTest.cliTitleError)
              throw new Error(desktop.__nativeTest.cliTitleError);
            desktop.__nativeTest.cliTitleSetup = null;
            return;
          }
          if (command === "quote_paths")
            return args.paths
              .map((path: string) => "'" + path.replaceAll("'", "'\\''") + "'")
              .join(" ");
          if (command === "plugin:clipboard-manager|read_text")
            return "clipboard text";
          if (command === "plugin:dialog|open")
            return desktop.__nativeTest.folder;
          if (command === "plugin:window|scale_factor") return 1;
          if (command === "plugin:window|is_fullscreen")
            return desktop.__nativeTest.fullscreen;
          if (command === "plugin:event|listen") {
            const id = ++callbackId;
            events.set(id, { event: args.event, handler: args.handler });
            return id;
          }
          if (command === "plugin:event|unlisten") {
            events.delete(args.eventId);
            return;
          }
          if (command === "plugin:window|close") {
            for (const [id, listener] of events) {
              if (listener.event === "tauri://close-requested")
                await callbacks.get(listener.handler)?.({
                  event: listener.event,
                  id,
                  payload: null,
                });
            }
            return;
          }
          if (
            [
              "write_terminal",
              "resize_terminal",
              "acknowledge_terminal",
              "close_terminal",
              "reset_terminals",
              "open_settings",
              "finish_window_startup",
              "plugin:event|unlisten",
              "plugin:window|set_title",
              "plugin:window|destroy",
              "plugin:window|minimize",
              "plugin:window|toggle_maximize",
              "plugin:clipboard-manager|write_text",
              "plugin:opener|open_url",
            ].includes(command)
          )
            return;
          throw new Error(`Unexpected native command: ${command}`);
        },
      };
    },
    { repository, saved, gitHistory, editorFiles, platform },
  );
}

export async function buffer(page: Page, paneId: string) {
  return page.evaluate(async (id) => {
    // Reuse the application's module when Vite adds a version after an update.
    const runtimeUrl = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((url) => new URL(url).pathname === "/src/terminal-runtime.ts")
      .at(-1);
    const { runningTerminal } = await import(
      runtimeUrl ?? "/src/terminal-runtime.ts"
    );
    const buffer = runningTerminal(id)!.terminal.buffer.active;
    return Array.from({ length: buffer.length }, (_, row) =>
      buffer.getLine(row)?.translateToString(true),
    ).join("\n");
  }, paneId);
}

export async function chooseOption(control: Locator, label: string) {
  await control.click();
  await control
    .page()
    .getByRole("option", { name: label, exact: true })
    .click();
}
