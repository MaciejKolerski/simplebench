import type { Page } from "@playwright/test";

export async function mockDesktop(
  page: Page,
  repository = true,
  saved: unknown = null,
) {
  await page.addInitScript(
    ({ repository, saved }) => {
      const callbacks = new Map<number, (value: unknown) => void>();
      let callbackId = 0;
      let repositoryPresent = repository;
      let changes = [
        { path: "README.md", originalPath: null, index: " ", worktree: "M" },
      ];
      const calls: { command: string; args: Record<string, any> }[] = [];
      const sessions = new Map<string, { output: number; index: number }>();
      const events = new Map<number, { event: string; handler: number }>();
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
        calls,
        sessions,
        emit,
        failSave: false,
        setRepository: (value: boolean) => {
          repositoryPresent = value;
        },
      };
      desktop.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      desktop.__TAURI_INTERNALS__ = {
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
          if (command === "app_info")
            return {
              directory: "/project",
              home: "/home/test",
              platform: "linux",
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
          if (command === "save_session") {
            if (desktop.__nativeTest.failSave) throw new Error("Disk is full");
            localStorage.setItem("test-session", JSON.stringify(args.data));
            return;
          }
          if (command === "validate_directory") return args.path;
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
          if (command === "terminal_directories") return {};
          if (command === "quote_paths")
            return args.paths
              .map((path: string) => "'" + path.replaceAll("'", "'\\''") + "'")
              .join(" ");
          if (command === "plugin:clipboard-manager|read_text")
            return "clipboard text";
          if (command === "plugin:dialog|open") return "/chosen folder";
          if (command === "plugin:window|scale_factor") return 1;
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
    { repository, saved },
  );
}

export async function buffer(page: Page, paneId: string) {
  return page.evaluate(async (id) => {
    const { runningTerminal } = await import("/src/terminal-runtime.ts");
    const buffer = runningTerminal(id)!.terminal.buffer.active;
    return Array.from({ length: buffer.length }, (_, row) =>
      buffer.getLine(row)?.translateToString(true),
    ).join("\n");
  }, paneId);
}
