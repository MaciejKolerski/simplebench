# SimpleBench

A desktop ADE built around project folders, workspaces, and terminals. The app
is developed incrementally with Tauri 2, Rust, React, TypeScript, and Vite.

## Current milestone

- The title bar contains the project location, workspace selector, tabs, a new
  tab button, and settings. Choose a folder with the native picker or enter its
  path. Previously opened projects retain their workspaces.
- Each project has named workspaces sharing its project folder. Each workspace
  has its own tabs. There is no hardcoded tab count limit; each tab starts with
  one terminal and can contain nested horizontal or vertical splits.
- The left sidebar contains a lazy file explorer with directory expansion,
  hidden-file visibility, refresh, text previews, path copying, and opening a
  terminal in a directory. The bottom bar toggles the explorer and Source Control.
- Source Control appears when Git detects a repository, including a worktree or
  an enclosing repository. It shows the branch and changes, previews diffs, stages
  and unstages files, and commits staged changes using the message you enter.
  Detection refreshes every four seconds and when the window regains focus.
- Settings opens a separate native window containing a box labeled `settings`.
- Terminals use xterm.js with WebGL, a native `portable-pty` backend, true color,
  inline search, and Ctrl/Cmd-clickable HTTP(S) links. Running terminals continue
  receiving output while their tab or workspace is inactive.
- Terminal toolbars provide splits, command blocks, and an optional multiline
  command input. Enter commands normally in the terminal, or use Ctrl/Cmd+Enter
  in the command input. Command blocks record command output positions, duration,
  and exit status when shell integration provides them; click a block to jump
  to its output.
- Drag explorer files or desktop files into a terminal to insert paths quoted for
  that terminal's shell. Dropping a path inserts text without submitting it.

## Getting started

Install Node.js 22.12 or newer, pnpm 11.25.0, a current stable Rust toolchain, and
the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.
Linux requires GTK 3 and WebKitGTK 4.1 development libraries. Install Git to use
Source Control and at least one supported shell for terminals.

```sh
pnpm install --frozen-lockfile
pnpm tauri dev
```

The desktop command starts Vite and compiles Rust automatically. The first native
build can take a few minutes. `pnpm dev` starts the browser frontend at
`http://127.0.0.1:1420`; project access and terminals require the desktop app.

## Shells and environments

Installed local shells are discovered from `PATH`, preferring `$SHELL` on Unix.
Supported profiles include bash, zsh, fish, PowerShell (`pwsh` or `powershell`),
cmd, and a basic `sh` fallback. The environment selector below the title bar is
per tab. Changing it restarts that tab's terminals after confirmation.

On Windows, installed WSL distributions appear alongside local shells. The app
uses `wsl.exe`, translates Windows paths through `wslpath`, and starts each WSL
tab in the selected distribution. Distribution discovery may start WSL to query
its default shell and home directory. Windows and WSL code needs verification
on a Windows host; the native development checks have been run on Linux.

Shell integration is generated in the application data directory and loads the
user's existing shell configuration without modifying it. Bash, zsh, and fish
provide command boundaries and exit status. PowerShell/cmd use prompt hooks and
Enter events, so completion status and multiline command boundaries are less
precise. Custom prompt frameworks can also affect these hooks. The `sh` fallback
provides a terminal without command block integration.

File drops use POSIX quoting, PowerShell literal strings, or cmd double quotes.
Paths containing `%`, `!`, or quotes are rejected for cmd because they cannot be
safely inserted into arbitrary interactive cmd input; use PowerShell for those
paths. Control characters that could submit a command are rejected.

## Session restoration and performance

Project folders, workspace names, tabs, selected environments, per-pane working
directories, split directions and ratios, and sidebar layout are saved to
`session.json` in Tauri's application data directory. On Linux, its default
location is `~/.local/share/dev.simplebench.desktop/session.json`.

Saving is debounced, serialized, and uses an atomic file replacement. Closing
the main window flushes the current layout. Invalid JSON or an unsupported
session version leaves the saved file intact and shows a recovery action.
If a saved working directory no longer exists, the terminal offers to restart
in the project folder.

Restoration creates fresh shells as tabs are first visited. Terminal output,
running processes, in-memory command blocks, and unsaved command input are not
restored; previous commands are never replayed. Closing a pane, tab, workspace,
or the main window terminates its associated PTYs.

The Rust reader sends raw binary Tauri channels directly into xterm, outside
React state. Acknowledgements follow xterm parsing and bound data in flight to
roughly 128 KiB per PTY. Hidden terminals retain their parsers and scrollback but
release WebGL renderers. Visible panes use WebGL when available, with a DOM
fallback after initialization failure or graphics context loss. Scrollback is
bounded to 10,000 lines per terminal and command block metadata to 100 entries.
Actual speed and resource use depend on the shell, output volume, and hardware.

Text previews are limited to 1 MiB of UTF-8 text and Git diff display to 2 MiB.
The session layout file is limited to 8 MiB.

## Keyboard shortcuts

Use Cmd instead of Ctrl on macOS.

| Shortcut                    | Action                                    |
| --------------------------- | ----------------------------------------- |
| Ctrl+Shift+T                | New tab                                   |
| Ctrl+Shift+W                | Close active tab                          |
| Ctrl+Tab / Ctrl+Shift+Tab   | Next / previous tab                       |
| Ctrl+Shift+E                | Toggle file explorer                      |
| Ctrl+Shift+G                | Toggle Source Control when available      |
| Ctrl+,                      | Open settings                             |
| Ctrl+Shift+F                | Search the active terminal                |
| Ctrl+Shift+C / Ctrl+Shift+V | Copy terminal selection / paste clipboard |
| Ctrl+Enter in command input | Run the composed command                  |

Double-click a tab to rename it. Drag split dividers to resize panes; focused
dividers also accept arrow keys, and double-click resets a split to 50/50.
Workspace creation, renaming, and deletion are in the workspace selector.

## Validation and builds

```sh
pnpm check
pnpm test
pnpm exec playwright install chromium
pnpm test:ui
pnpm format:check
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings
pnpm tauri build --no-bundle
```

Model tests cover session restoration and split operations. Rust tests exercise
real PTYs and temporary Git repositories. Playwright tests run real xterm in
Chromium with a mocked Tauri command bridge; they do not replace native smoke
checks. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use an existing Chromium binary.

The desktop executable is written to `src-tauri/target/release/`. Run
`pnpm tauri build` to also create the installers supported by the host OS.

## Project layout

```text
src/Workbench.tsx          Project, workspace, tab, and session coordination
src/model.ts              Session types, split operations, and restoration
src/terminal-runtime.ts   xterm lifecycle, binary channels, and shell integration
src/TerminalPane.tsx      Terminal controls, search, and command input
src/SplitView.tsx         Recursive terminal layout and resize controls
src/Explorer.tsx          File explorer and previews
src/SourceControl.tsx     Git status, staging, and commit interface
src/styles.css           Interface styles and DeepMono tokens
src-tauri/src/terminal.rs Native PTY lifecycle and flow control
src-tauri/src/shell.rs    Shell discovery, launch profiles, and path quoting
src-tauri/shell/          Shell integration scripts
src-tauri/src/files.rs    Project files and session persistence
src-tauri/src/git.rs      Git command backend
src-tauri/capabilities/   Window-specific native API permissions
tests/                   Model and interface tests
AGENTS.md                Project rules and commit conventions
```

## Theme and Linux graphics

Colors come from DeepMono 1.1.0 by viewerofall, using the default dark `mono`
flavor and `graphite` accent in
`/home/woro/.config/DankMaterialShell/themes/deepmono/theme.json`.
The palette is stored in `src/styles.css`; the app does not need the original
file at runtime. The native background also uses `#101010`. The icon source is
`public/app-icon.svg`; regenerate desktop icons with
`pnpm tauri icon public/app-icon.svg` after changing it.

On Linux with Wayland and a loaded NVIDIA module, startup defaults
`__NV_DISABLE_EXPLICIT_SYNC` to `1` before initializing Tauri. This addresses the
WebKitGTK `Error 71` reproduced on the development machine. An explicit existing
value is respected. See the [Tauri Linux graphics notes](https://v2.tauri.app/develop/debug/linux-graphics/).

## Contributing

Read [AGENTS.md](AGENTS.md) before making changes. Keep each change focused,
write meaningful technical comments in English, and use
`type(scope): short imperative summary` for commit and pull request titles.
Commit bodies explain the change and its reason, followed by validation results.
Do not add AI co-author trailers or agent attribution. Pull requests use the
[description template](.github/pull_request_template.md).
