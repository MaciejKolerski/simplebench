# README screenshots

These PNGs are captures of the running Tauri desktop application. They were
recorded on Linux with Hyprland/Wayland and WebKitGTK on 2026-09-15, using the
bundled DeepMono dark theme and application source at commit
`9fce16549daafe33b63dffc2e885744d1c92490c`.

| Image                                       | Native window size | Content                                                                                       |
| ------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------- |
| [Workbench](images/workbench.png)           | 1600 × 960         | Explorer, `src/browser-url.ts`, real Node test output, and a running Vite development server. |
| [Source Control](images/source-control.png) | 1600 × 960         | Repository history and the `src/Explorer.tsx` diff in commit `9fce165`.                       |
| [Keybinds](images/keybindings.png)          | 1120 × 820         | The separate Settings window showing configurable shortcuts.                                  |

The capture session used a temporary local clone and separate XDG data, config,
and cache directories. The native backend was built with
`cargo build --manifest-path src-tauri/Cargo.toml --locked`; `pnpm dev` served the
frontend. The terminal output came from eight tests in `browser.test.ts`,
`editor-text.test.ts`, and `editor-preferences.test.ts`, followed by a Vite server
on port 4175. Git displayed the clone's actual commit history.

Window bounds were captured directly with `grim`. The images have no mock native
commands, generated UI, compositing, or added annotations. Application behavior
and rendering code were not changed for the screenshots.

## Refreshing the images

1. Run the current desktop build with a separate demonstration session and a
   disposable project copy.
2. Use the built-in theme, keep text legible, and run the commands shown in the
   terminals. Wait for files, diffs, and fonts to finish loading.
3. Capture the application window without unrelated desktop content, dialogs,
   tooltips, or private information. Keep the sizes above for consistent framing.
4. Replace the PNGs, update their descriptions and capture details here, and
   inspect the rendered README at desktop and narrow widths.

For browser, PTY, and native-window imagery, capture the desktop application;
the Playwright test frontend uses mocked native commands.
