# SimpleBench

A desktop ADE built around project folders, workspaces, and terminals. The app
is developed incrementally with Tauri 2, Rust, React, TypeScript, and Vite.

## Current milestone

- The title bar contains a compact project menu, workspace selector, tabs, a new
  tab button, and settings. On first launch, choose “Open Recent Project” and
  “Open Local Folder…” to select a folder with the native picker. Recent projects
  appear in order of last use and retain their workspaces. Hover a project name
  to see its full path.
- Each project has named workspaces sharing its project folder. Each workspace
  has its own tabs. There is no hardcoded tab count limit; each terminal tab starts with
  one terminal and can contain nested horizontal or vertical splits.
- Drag a tab along the title bar to reorder it. Drag an inactive terminal tab
  onto the active terminal view to combine them; the nearest edge selects the
  split direction. The source tab disappears and its panels keep their running
  shells, output, directories, and environments. Hold near the tab strip's edge
  to scroll, or press Escape to cancel. Both layouts must fit in the window.
- The left sidebar contains a lazy file explorer with directory expansion,
  hidden-file visibility, refresh, file editing, path copying, and opening a
  terminal in a directory. The bottom bar toggles the explorer and Source Control.
- Click a text file to open a CodeMirror 6 editor tab. Reopening the same file
  selects its tab. Editors support syntax highlighting, indentation, bracket
  matching, folding, multiple selections, undo/redo, find/replace, line navigation,
  and word wrap. Modified tabs show a dot; closing their last view or the application
  asks whether to save, discard, or cancel.
- Source Control appears when Git detects a repository, including a worktree or
  an enclosing repository. It shows the branch and changes, previews diffs, stages
  and unstages files, and commits staged changes using the message you enter.
  Detection refreshes every four seconds and when the window regains focus.
- The Source Control **History** page lists commits from all locally available
  branches, tags, and HEAD, loading 50 at a time with **Load more commits**.
  Select a commit to open a workspace tab with its full message, author and
  committer, dates, hashes, changed files, line counts, and a selectable file
  diff. Merge commits are compared with their first parent; initial commits
  show the files they introduced. Reopening a commit selects its existing tab.
- Settings opens a separate native window with Keybinds, Editor, and Themes pages.
  Record, clear, or reset shortcuts. Create/import JSON theme folders with local
  backgrounds, fonts, and CSS files declared in JSON. Changes apply to both
  windows immediately and persist across launches without restarting terminals.
- Terminals use xterm.js with WebGL, a native `portable-pty` backend, true color,
  inline search, and Ctrl/Cmd-clickable HTTP(S) links. Running terminals continue
  receiving output while their tab or workspace is inactive.
- Terminal pages show the terminal without permanent toolbars. Shortcuts open
  splits, search, command blocks, and an optional multiline command input.
  Enter commands normally in the terminal, or use Ctrl/Cmd+Enter
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
cmd, and a basic `sh` fallback. Ctrl/Cmd+Shift+L opens environment selection for
the active tab. Choosing another environment and pressing Restart terminals
restarts that tab's terminals in the project folder.

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

## File editing

Editor buffers and undo history stay outside React state and remain available
while switching tabs, workspaces, or projects. Views of the same canonical file
share one buffer. Only the visible editor mounts a CodeMirror view; its core and
each language parser load on demand. Supported languages include Rust,
JavaScript/TypeScript/JSX, Python, Go, C/C++, Java, HTML, CSS, JSON, Markdown, YAML,
SQL, XML, TOML, shell scripts, and Dockerfiles. Other text files use plain text.
Completion is local and syntax based where supported by the language package;
this milestone does not include language servers, AI, Vim, or media previews.

Click **Spaces: 4** in the bottom status bar to open the current file's
indentation menu. **Indent Using Spaces** and **Indent Using Tabs** let you
choose a width from 1 to 16. **Change Tab Display Size** adjusts tab stops
without changing the number of spaces inserted. **Use Default Indentation**
clears the file's overrides. Tab inserts at the cursor; with a
selection, Tab and Shift+Tab indent and unindent entire lines. Code indentation
after Enter follows the selected indentation. Click the language name (such as
**HTML**) to search available language modes, use plain text, or return to
automatic detection from the filename. These choices update the shared buffer
without replacing its text, selection, or undo history and remain active while
switching tabs and workspaces. They reset when the file's final tab closes or
the app restarts; choosing a language does not rename the file.

**Settings → Editor** configures the persisted defaults, initially four spaces.
Changes apply to open and future buffers except fields overridden for a file.
Defaults are saved atomically in
`editor-preferences.json` and restored on startup. Invalid files remain intact
until an explicit **Reset defaults**; a load failure keeps the last working
preferences (or four spaces on first launch).

Ctrl/Cmd+S saves the current file through Rust with an atomic replacement and
checks that its disk contents still match the version opened. Saves retain UTF-8
(with or without BOM), BOM-marked UTF-16 LE/BE, existing line endings including
mixed LF/CRLF/CR, and file permissions. Internal symbolic links resolve to their
target inside the project; links outside the project are rejected. Unsupported
encodings, binary files, and files over 16 MiB show an error without modifying
the source file. Editors do not create new files or provide Save As in this milestone.

Native directory watches and window-focus checks detect external changes.
Unmodified buffers reload automatically. Modified buffers retain their contents
and offer an explicit reload or overwrite choice. Save failures and deleted files
leave edits in memory and keep the close confirmation open if saving fails.
Reloading clears undo history and requires confirmation when requested manually.

Files above roughly one million characters, or containing a line longer than
20,000 characters, open in a lightweight mode with highlighting, completion,
folding, and word wrap disabled. The editor still virtualizes visible lines and
supports editing, saving, searching, and undo. The 16 MiB limit also applies to
encoded saved contents.

## Session restoration and performance

Project folders, workspace names, tabs, selected environments, per-pane working
directories, split directions and ratios, and sidebar layout are saved to
`session.json` in Tauri's application data directory. On Linux, its default
location is `~/.local/share/dev.simplebench.desktop/session.json`.
Commit tabs save their repository and full commit hash, reload their details
when visited, and never start a shell. Existing terminal sessions remain
compatible with the added tab type.
File tabs save their project path, relative filename, selection, and scroll
position. On a new launch their contents load from disk when first visited.
Unsaved editor buffers and undo history are not restored after a crash or forced
termination; normal window closing offers to save modified files.

Saving is debounced, serialized, and uses an atomic file replacement. Closing
the main window flushes the current layout. Invalid JSON or an unsupported
session version leaves the saved file intact and shows a recovery action.
If a saved working directory no longer exists, the terminal offers to restart
in the project folder.

Restoration creates fresh shells as tabs are first visited. Terminal output,
running processes, in-memory command blocks, and unsaved command input are not
restored; previous commands are never replayed. Closing a pane, tab, workspace,
or the main window terminates its associated PTYs.

Panel splits require at least 240 × 120 CSS pixels per terminal, plus
space for the dividers. The limit follows the available terminal area, sidebar
width, split direction, and nested layout. Divider resizing preserves this
minimum, and repeated shortcuts cannot queue more panels than fit. Tab counts
remain unlimited.

A restored tab whose panels do not fit shows a recovery view before starting
any of its shells. Enlarge the window, hide the sidebar, close individual
panels with the configured shortcut, or choose **Keep only the active terminal**
to close the other panels in that tab. Resizing never deletes panels or stops
existing shells; their output continues parsing while the recovery view is
visible. Saved panels remain available until you explicitly close them.

The Rust reader sends raw binary Tauri channels directly into xterm, outside
React state. Acknowledgements follow xterm parsing and bound data in flight to
roughly 128 KiB per PTY. Hidden terminals retain their parsers and scrollback but
release WebGL renderers. Visible panes use WebGL when available, with a DOM
fallback after initialization failure or graphics context loss. Scrollback is
bounded to 10,000 lines per terminal and command block metadata to 100 entries.
Actual speed and resource use depend on the shell, output volume, and hardware.

Git diff display is limited to 2 MiB.
Commit file diffs also stop at 20,000 lines and clearly indicate truncation;
their file statistics still describe the complete change.
The session layout file is limited to 8 MiB.

## Keyboard shortcuts

These are the defaults; use Cmd instead of Ctrl on macOS. Configure them in
Settings → Keybinds by clicking an assignment and pressing a key combination.
Escape cancels recording. Conflicts must be resolved before saving. Clear an
assignment to let the terminal receive those keys normally.

Shortcuts are saved in `keybindings.json` beside `session.json`. Saving is
serialized and atomic, and updates reach the main window without restarting
PTYs. An invalid settings file remains intact until you choose Reset all.
Application shortcuts do not intercept ordinary text-field editing.

| Shortcut                    | Action                                    |
| --------------------------- | ----------------------------------------- |
| Ctrl+D                      | New terminal panel in the current tab     |
| Ctrl+Shift+D                | New terminal below the active panel       |
| Ctrl+W                      | Close active terminal panel               |
| Ctrl+Shift+T                | New tab                                   |
| Ctrl+Shift+W                | Close active tab                          |
| Ctrl+S in an editor         | Save the active file                      |
| Ctrl+F in an editor         | Find and replace                          |
| Ctrl+G in an editor         | Go to line                                |
| Alt+Z in an editor          | Toggle word wrap                          |
| Ctrl+Tab / Ctrl+Shift+Tab   | Next / previous tab                       |
| Ctrl+Shift+E                | Toggle file explorer                      |
| Ctrl+Shift+G                | Toggle Source Control when available      |
| Ctrl+,                      | Open settings                             |
| Ctrl+Shift+F                | Search the active terminal                |
| Ctrl+Shift+I                | Toggle multiline command input            |
| Ctrl+Shift+H                | Toggle command blocks                     |
| Ctrl+Shift+L                | Change the active tab's environment       |
| Ctrl+Shift+C / Ctrl+Shift+V | Copy terminal selection / paste clipboard |
| Ctrl+Enter in command input | Run the composed command                  |

Ctrl/Cmd+W also closes the active editor tab. Editor shortcuts do not consume
terminal input. Existing custom shortcuts take precedence over newly introduced
editor defaults; any colliding new defaults start unassigned.

Double-click a terminal or commit tab to rename it. File tabs retain their
filenames. Drag split dividers to resize panes; focused
dividers also accept arrow keys, and double-click resets a split to 50/50.
Workspace creation, renaming, and deletion are in the workspace selector.
Closing the last panel closes its tab. Closing the last tab creates a fresh
terminal so the workspace remains usable.

Right-click a tab (or press Shift+F10 while it is focused) to close it, other
tabs, tabs to its left or right, clean tabs, or all tabs in the current workspace.
Close Clean skips files with unsaved edits and includes terminal and commit tabs.
Bulk closing asks once about modified files whose last view would close;
cancelling or a failed save leaves the tabs open.

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

Model tests cover session restoration, split operations, file tabs, and exact
line ending preservation through undo/redo. Rust tests exercise file encoding,
conflict checks, project boundaries, real PTYs, and temporary Git repositories.
Playwright tests run real CodeMirror and xterm in
Chromium with a mocked Tauri command bridge; they do not replace native smoke
checks. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use an existing Chromium binary.

The desktop executable is written to `src-tauri/target/release/`. Run
`pnpm tauri build` to also create the installers supported by the host OS.

## Project layout

```text
src/Workbench.tsx          Project, workspace, tab, and session coordination
src/model.ts              Session types, split operations, and restoration
src/terminal-runtime.ts   xterm lifecycle, binary channels, and shell integration
src/TerminalPane.tsx      Terminal view, search, and command input
src/FileEditor.tsx        Editor view, save actions, and conflict resolution
src/editor-service.ts    Lazy editor loading and document retention
src/editor-runtime.ts    Shared CodeMirror buffers, history, and file monitoring
src/editor-text.ts       Exact line ending preservation and undo integration
src/editor-languages.ts  On-demand language parsers
src/EditorCloseGuard.tsx  Save/discard/cancel before closing modified files
src/keybindings.ts       Shortcut actions, defaults, and validation
src/KeybindingsProvider.tsx Shared shortcut state and native synchronization
src/SettingsWindow.tsx    Settings navigation and keybindings
src/ThemesPage.tsx        Theme library, import, creation, and selection
src/ThemeProvider.tsx     Theme persistence and cross-window synchronization
src/themes.ts            Theme format and validation
src/theme-runtime.ts     CSS application, local assets, and terminal appearance
src/SplitView.tsx         Recursive terminal layout and resize controls
src/Explorer.tsx          File explorer and editor opening
src/SourceControl.tsx     Git status, staging, and commit interface
src/styles.css           Interface styles and DeepMono tokens
src-tauri/src/terminal.rs Native PTY lifecycle and flow control
src-tauri/src/shell.rs    Shell discovery, launch profiles, and path quoting
src-tauri/shell/          Shell integration scripts
src-tauri/src/files.rs    Project files and session persistence
src-tauri/src/files/editor.rs Scoped file editing, revisions, and native watches
src-tauri/src/keybindings.rs Shortcut persistence and window access checks
src-tauri/src/themes.rs   Theme packages, scoped assets, and preferences
themes/                  Starter theme, JSON schema, and authoring guide
src-tauri/src/git.rs      Git command backend
src-tauri/capabilities/   Window-specific native API permissions
tests/                   Model and interface tests
AGENTS.md                Project rules and commit conventions
```

## Themes and Linux graphics

Use **Settings → Themes → Create theme** to create a complete starter package,
or **Open folder** to open the theme library. Import/drop a folder containing
`theme.json`, then select it. Themes control colors, typography, spacing, corners,
shadows, transparency, terminal appearance, and local image backgrounds. JSON
styles and ordered CSS files declared in `stylesheets` provide element-level
customization. All declared sheets load automatically.

The default **Color mode → System** follows the operating system at startup and
when its appearance changes. Select **Light** or **Dark** for a persistent
override. Both windows, editors, and running terminals update together. Custom
themes without an explicit `appearance` follow this setting; themes that declare
an appearance keep their own mode.

The [theme authoring guide](themes/README.md) documents the format, tokens,
resources, terminal options, limits, and recovery. It includes a
[JSON schema](themes/theme.schema.json) and a
[starter theme](themes/deepmono-custom/theme.json). Refresh reloads edited files
in both windows. Restore DeepMono recovers the default appearance. For a theme
that hides the settings interface, launch with `SIMPLEBENCH_SAFE_THEME=1`.

Colors come from DeepMono 1.1.0 by viewerofall, using the dark `mono` and light
`mono-light` flavors with the `graphite` accent in
`/home/woro/.config/DankMaterialShell/themes/deepmono/theme.json`.
The palette is stored in `src/styles.css`; the app does not need the original
file at runtime. CSS paints the selected palette over a transparent native
surface from startup. The icon source is
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
