# SimpleBench

A desktop ADE built around project folders, workspaces, and terminals. The app
is developed incrementally with Tauri 2, Rust, React, TypeScript, and Vite.

See [GitHub Releases](https://github.com/MaciejKolerski/simplebench/releases) for published installers.
The [release guide](docs/releases.md) describes Apple signing, platform builds,
AUR publication, and the optional Flathub handoff.

## Current milestone

- The title bar contains a compact project menu, tabs, a new
  tab button, and settings. On first launch, choose “Open Recent Project” and
  “Open Local Folder…” to select a folder with the native picker. Recent projects
  appear in order of last use and retain their workspaces. Hover a project name
  to see its full path.
- Each project has named workspaces sharing its project folder. Each workspace
  has its own tabs. There is no hardcoded tab count limit; each terminal tab starts with
  one terminal and can contain nested horizontal or vertical splits.
- The Workspaces button in the bottom bar opens a list of all workspaces with
  their folder paths. Select a row to switch folders and workspaces in one click.
  Use **New workspace** in this panel to choose a folder and name the workspace;
  choosing the same folder again creates separate tabs and terminals for it.
  Files remain shared. Right-click a workspace (or focus it and press Shift+F10)
  to rename or delete it. Any workspace can be deleted, including the last one;
  deletion closes its tabs and checks unsaved edits without deleting its folder.
  A shortcut for the panel can be assigned in Settings → Keybinds.
- Drag a tab along the title bar to reorder it. Drag an inactive terminal, browser, or file tab
  onto the active terminal view to combine them; the nearest edge selects the
  split direction. The source tab disappears and its panels keep their running
  shells, output, directories, and environments. Hold near the tab strip's edge
  to scroll, or press Escape to cancel. Both layouts must fit in the window.
  File panels share the layout with terminals and retain unsaved edits and undo
  history. Reopening a docked file selects its panel; Ctrl+W closes the active
  panel and checks unsaved changes.
- The file sidebar contains a lazy explorer with directory expansion,
  hidden-file visibility, refresh, file editing, path copying, and opening a
  terminal in a directory. The bottom bar toggles Workspaces, Explorer, and Source Control.
  Right-click a panel icon to place its panel on the left or right. Panels on
  opposite sides can stay open together; panels on the same side switch between
  views. Their bottom-bar controls follow the selected side. Positions, visibility,
  and the width of each side are restored with the session.
- Right-click a file or folder for creation, rename, cut/copy/paste, duplicate,
  system opening, path copying, trash and permanent deletion. Folder operations
  update open editors across workspaces and preserve their buffers and undo
  history. Deletion checks unsaved files before removing their views; deleting
  the project folder also closes its workspaces and terminals. Existing
  destinations are not overwritten. Copies of symbolic links and special files
  are rejected. Cut/copy/paste use an application clipboard; these file operations
  do not have an application undo stack.
- Use the Explorer search button or **Search in Folder…** on any folder, including
  the project root, to search saved file contents. Results open the matching line
  and selection. Search supports literal text, case matching, UTF-8 and UTF-16;
  Git-ignored files are excluded unless **Include ignored files** is checked.
  `.git` and symbolic links are not traversed. Binary, unreadable and over-16-MiB
  files are skipped. Results stop at 1,000 matches, 100,000 entries or 15 seconds;
  the panel reports incomplete results and allows a narrower query or folder.
  Unsaved buffer contents are not searched.
- **View History** in the Explorer menu filters Git commits to that file or
  folder across local branches. The menu can also append an escaped path rule to
  `.gitignore` or the repository's local `info/exclude`, including in worktrees.
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
- Settings opens a separate native window with Keybinds, Editor, Terminal, Themes, and Plugins pages.
  Record, clear, or reset shortcuts. Create/import JSON theme folders with local
  backgrounds, fonts, and CSS files declared in JSON. Changes apply to both
  windows immediately and persist across launches without restarting terminals.
- Terminals use xterm.js with WebGL, a native `portable-pty` backend, true color,
  inline search, and Ctrl/Cmd-clickable HTTP(S) links. Running terminals continue
  receiving output while their tab or workspace is inactive.
- Tabs with multiple terminal panels show a separate centered title for each.
  Split panels have a maximize/restore button. Shortcuts open
  splits, search, command blocks, and an optional multiline command input.
  Enter commands normally in the terminal, or use Ctrl/Cmd+Enter
  in the command input. Command blocks record command output positions, duration,
  and exit status when shell integration provides them; click a block to jump
  to its output.
- Drag explorer files or desktop files into a terminal to insert paths quoted for
  that terminal's shell. Dropping a path inserts text without submitting it.

## Browser panels

Use **+ → New browser**, enter an HTTP(S) address (including `localhost:3000`),
then press Enter. Other text searches DuckDuckGo. The toolbar provides back,
forward, reload/stop, and opening the page in your default external browser.
Ctrl/Cmd+L selects the address; Ctrl/Cmd+F searches the page.

Focusing the address shows active local HTTP servers, such as
`http://localhost:3000`. Click an address or select it with the arrow keys and
Enter. Typing filters the list, which refreshes every five seconds while open.
Detected addresses appear as they respond, without waiting for other ports.
Reopening the list reuses the last results while checking for changes in the background.
Discovery checks local listening sockets with a bounded HTTP probe; HTTPS-only
servers and servers inside containers/VMs without a host port are not discovered.
Their addresses can still be entered manually.

To place a browser beside terminals, select the terminal tab and drag the browser
tab onto an edge of its layout. The page, form contents and history remain loaded
when docking or switching tabs/workspaces. Closing the browser panel releases its
webview. Restarting SimpleBench restores its saved address with a fresh page;
unsent forms and browsing history are not session backups.

Pages use Tauri's existing system engine: WebKitGTK on Linux, WKWebView on macOS,
and WebView2 on Windows. No additional browser engine is bundled. Cookies and
site storage belong to SimpleBench, separate from the user's external browser.
The same system prerequisites as the desktop app apply.

This does not reproduce every Firefox/Chrome feature. Extensions, external browser
profiles/passwords, DRM and some authentication flows depend on the system webview.
Links requesting a new window open in another browser tab; script-controlled popup
relationships (`window.opener`) are not preserved. Use **Open in default browser**
for sites that require those features. Web pages cannot access project files,
terminals or application preferences.

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

Development and test builds retain line information for Rust backtraces and
disable incremental artifacts to reduce disk usage. Full variable-level native
debugging can be enabled with `CARGO_PROFILE_DEV_DEBUG=2 pnpm tauri dev`, which
requires more disk space. These settings use Cargo's standard
[development profile](https://doc.rust-lang.org/cargo/reference/profiles.html).

## Shells and environments

Installed local shells are discovered from `PATH`, preferring `$SHELL` on Unix.
Supported profiles include bash, zsh, fish, PowerShell (`pwsh` or `powershell`),
cmd, and a basic `sh` fallback. Ctrl/Cmd+Shift+L opens environment selection for
the active tab. Choosing another environment and pressing Restart terminals
restarts that tab's terminals in the project folder.

On Windows, PowerShell 7, Windows PowerShell, and cmd take priority over Unix
shells. WSL's legacy `bash.exe` launchers are excluded from local shell discovery;
installed WSL distributions appear as separate environments. The app uses the
system `wsl.exe`, translates Windows paths through `wslpath`, and starts each WSL
tab in the selected distribution. Distribution discovery may start WSL to query
its default shell and home directory. Windows and WSL code needs verification
on a Windows host; the native development checks have been run on Linux.

Shell integration loads the user's existing shell configuration without modifying
it. Bash, zsh, and fish hooks are generated in the application data directory.
PowerShell receives its bundled prompt hook through `-Command`, so integration
works with `Restricted` execution policy without changing the policy or registry.
Bash, zsh, and fish provide command boundaries and exit status. PowerShell/cmd use
prompt hooks and Enter events, so completion status and multiline command
boundaries are less precise. Custom prompt frameworks can also affect these hooks. The `sh` fallback
provides a terminal without command block integration.

The [Windows shell checks](.github/workflows/windows-shells.yml) workflow tests
local shell discovery and native ConPTY startup for PowerShell and cmd, including
PowerShell's `Restricted` policy and project paths with spaces and Unicode.
Run these checks locally with
`cargo test --manifest-path src-tauri/Cargo.toml --locked shell::tests`.

### Terminal titles and maximized panels

When a tab contains at least two terminal panels, each displays its own window
title sent by any program through standard OSC 0 or OSC 2 sequences. A lone
terminal hides its title, even alongside file editors or with other tabs open.
Title updates continue while hidden and appear when another terminal is added.
Conversation renames and resumed sessions appear when the
program publishes them as its title. Programs can save and restore titles with
the standard terminal title stack. Titles overlay the terminal without reducing
its usable rows. Shell prompt reports hide the title until the next command is
submitted. Titles are also accepted without shell hooks; in that case, the program
must clear or restore its title when it finishes. Titles stay with running terminals
across tab and workspace switches; they are not saved as session data.

With at least two terminal panels visible, hold **Ctrl** and drag a terminal's
title to the left, right, top, or bottom of another panel. A preview smoothly
tracks its new position and size. Untitled terminals show their shell name while Ctrl is held.
Release the mouse to move; **Escape**, releasing Ctrl, or dropping outside the
layout cancels. The saved layout changes without restarting shells or losing
output, editor buffers, or undo history.
Panels briefly animate into place without repeatedly resizing the running shells.
The system's reduced-motion preference disables panel and preview animations.

On Linux, a program that does not publish a title gets a fallback showing the
foreground process name (for example, `agy`). SimpleBench reads it from the PTY
and operating system, without inspecting command arguments or CLI data files.
Published terminal titles take precedence. The process name cannot identify a
conversation selected inside a CLI. Other platforms use published titles only.

Use the button beside the title to fill the central work area, then press it
again to restore the split layout. Other shells continue parsing output in the
background. Splitting or closing the maximized panel returns to the layout.

Press **Ctrl+Tab** or the **Toggle terminal overview** button in the status bar
to replace terminal contents with their centered titles. This also works for a
single terminal; shells without a published title show their environment name.
Click a title to select that panel, then toggle again to return to its terminal.
Output and title updates continue while hidden, preserving shells, scrollback,
and command drafts. Renderers stay mounted so returning to the terminals does
not rebuild their graphics resources. A maximized panel temporarily shows the
full split layout.
The overview is temporary and can be reassigned in Settings → Keybinds.
Right-click its status-bar button to place it on the left or right. The position
is saved with the session.

Title handling is independent of CLI names and vendors. SimpleBench does not wrap
CLI commands, inject arguments, or read conversation histories.
A terminal stream has no standard flag identifying an AI agent and
cannot expose a conversation name or activity state that the program does not
send. CLI title updates must be enabled; the optional agy formatter below can
resolve a conversation name from local title metadata. Leading dot-spinner frames
in received titles use a font-independent loading icon.

On Linux, SimpleBench detects local Codex, agy, Cursor CLI (`agent` or
`cursor-agent`), and Claude Code processes in the terminal's foreground process
group, including their native and Node launchers. Detection examines executable
and launcher paths; prompt text is not interpreted. When a CLI's user settings
need title support enabled, a dialog asks permission. **Not now**, Escape, and
closing the dialog leave the file untouched. A declined request is not repeated
for the same configuration until SimpleBench restarts. Existing dialogs take
priority.

The dialog shows the configuration path. **Allow changes** makes these updates:

| CLI         | User configuration                                                                                                        | Title settings                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Codex       | `$CODEX_HOME/config.toml`, default `~/.codex/config.toml`                                                                 | `tui.terminal_title = ["activity", "thread-title"]`                                                      |
| agy         | `~/.gemini/antigravity-cli/settings.json`                                                                                 | Enables `title.enabled`; preserves an existing `title.command`, or adds SimpleBench's local formatter    |
| Cursor CLI  | `$CURSOR_CONFIG_DIR/cli-config.json`, then `$XDG_CONFIG_HOME/cursor/cli-config.json`, default `~/.cursor/cli-config.json` | `display.showStatusIndicators = true`                                                                    |
| Claude Code | `$CLAUDE_CONFIG_DIR/settings.json`, default `~/.claude/settings.json`                                                     | `env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE = "0"`; enables `terminalTitleFromRename` if explicitly disabled |

Paths use the running process's environment. Claude Code already enables titles
by default, so an unconfigured installation needs no prompt. Its inherited title
disable variable is also checked. These are user settings for all terminals.
After approving agy setup, enter `/title on` in the running CLI to activate
titles; `/resume` alone does not activate them. SimpleBench keeps this instruction
open until dismissed. Alternatively, restart agy and resume the conversation.
Restart the other CLIs and resume the conversation after approval. CLI flags,
project settings, or managed settings can take precedence.

Existing settings are preserved (TOML comments remain; JSON is reformatted), and
an exact `<filename>.simplebench-backup-*` copy is saved beside the file before
replacement. Invalid, read-only, oversized, or concurrently edited files are not
overwritten. After a conflict, **Check again** reads the current settings and
requires another **Allow changes** click. SimpleBench never restarts a CLI or
sends a command automatically. Automatic setup currently supports local Linux
terminals; other platforms and remote sessions can use each CLI's own settings.

agy requires a title command before `/title on` can work. SimpleBench's
`--agy-terminal-title` formatter emits the conversation name without a status,
folder, ID, or `[CURRENT]` prefix. It reads the exact active conversation's
`~/.gemini/antigravity-cli/annotations/<conversation_id>.pbtxt` title, which agy
updates for new conversations and renames in `/resume`. The summaries database
can lag behind these updates and is not used. The formatter falls back to the
name supplied in agy's JSON state, or `agy` when no name is available yet.
Reads are bounded and conversation IDs cannot escape the annotations directory.
It does not access transcripts or make network requests.
Keep SimpleBench installed at the configured path when using this formatter.
See [agy title customization](https://antigravity.google/docs/cli/title/),
[Cursor CLI configuration](https://cursor.com/docs/cli/reference/configuration),
and [Claude Code environment variables](https://code.claude.com/docs/en/env-vars).

For Codex CLI, include the conversation name in its own title configuration.
The default title contains the project name, so selecting another conversation
with `/resume` in the same project does not change that name. In
`~/.codex/config.toml`, add this setting to the `[tui]` table (create the table
if it does not exist), then restart Codex and resume the conversation:

```toml
[tui]
terminal_title = ["activity", "thread-title"]
```

To try it for one invocation, run
`codex -c 'tui.terminal_title=["activity","thread-title"]'`.
This was verified with Codex CLI 0.153.4. See the
[Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).
Other CLIs need their own title updates enabled; SimpleBench displays the title
they publish.

File drops use POSIX quoting, PowerShell literal strings, or cmd double quotes.
Paths containing `%`, `!`, or quotes are rejected for cmd because they cannot be
safely inserted into arbitrary interactive cmd input; use PowerShell for those
paths. Control characters that could submit a command are rejected.

## File editing

Editor buffers and undo history stay outside React state and remain available
while switching tabs, workspaces, or projects. Views of the same canonical file
share one buffer. Only the visible editor mounts a CodeMirror view; its core and
each language parser load on demand. Supported languages include Rust,
JavaScript/TypeScript/JSX, Python, Lua, Go, C/C++, Java, HTML, CSS, JSON, Markdown, YAML,
SQL, XML, TOML, shell scripts, and Dockerfiles. Other text files use plain text.
Completion is local and syntax based where supported by the language package;
this milestone does not include language servers, AI, Vim, or media previews.

Markdown files (`.md` and `.markdown`, case insensitive) have a **Preview**
button in the bottom-right corner. Click it to see the source and rendered
document side by side. Right-click it for **Preview beside editor** or
**Preview only**; click **Editor** to return to the source. The preview updates
from the current buffer, including unsaved edits. Switching modes preserves
the selection, scroll position, and undo history. Each file tab remembers its
preview mode across sessions, while its contents still load fresh from disk.
Tables, task lists, code blocks, and local images are supported. Relative links
open files inside the project; web links open in the browser. Local images are
limited to 16 MiB. Remote images appear as links, and raw HTML is disabled.

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
panels with the configured shortcut, or choose **Keep only the active panel**
to close the other panels in that tab. Resizing never deletes panels or stops
existing shells; their output continues parsing while the recovery view is
visible. Saved panels remain available until you explicitly close them.

The Rust reader sends raw binary Tauri channels directly into xterm, outside
React state. Acknowledgements follow xterm parsing and bound data in flight to
roughly 128 KiB per PTY. Terminals in hidden tabs or workspaces retain their
parsers and scrollback but release WebGL renderers. Empty graphics contexts are
reused across tabs; their count follows the largest simultaneous layout, while
hidden renderers release their textures, shaders, and buffers. Unchanged font
metrics are reused when returning to a terminal. Visible panes use WebGL when
available, with a DOM fallback after initialization failure or graphics context
loss. Scrollback is
10,000 lines per terminal by default (configurable up to 100,000), with command
block metadata bounded to 100 entries.
Actual speed and resource use depend on the shell, output volume, and hardware.

Git diff display is limited to 2 MiB.
Commit file diffs also stop at 20,000 lines and clearly indicate truncation;
their file statistics still describe the complete change.
The session layout file is limited to 8 MiB.

## Terminal settings

Settings → Terminal customizes fonts, size, weight, spacing, the cursor, text
and background colors, selection, the 16 ANSI colors, and search highlights.
A terminal preview shows the applied appearance. Use an installed font or the
bundled JetBrains Mono. Bundled Noto Sans Symbols (1 and 2) and Symbols Nerd Font Mono
provide Braille patterns, CLI symbols, and Nerd Font icons without installing
system fonts or downloading them at runtime. These fallbacks also apply to
custom terminal fonts and themes, before generic system families. Characters
outside the bundled fonts' coverage still need a suitable system or theme font.
Colors accept `#RRGGBB` and `#RRGGBBAA` (including opacity).

On Windows, Default shell selects PowerShell or CMD for new tabs and workspaces.
PowerShell uses version 7 when installed, otherwise Windows PowerShell. Existing
and restored terminals keep their environment; splits inherit it.

Advanced settings control scrollback, scrolling speed and animation, tab stops,
mouse selection, macOS Option behavior, screen readers, glyph rendering, and
minimum text contrast. Reducing scrollback permanently drops older output.
Changes save when you leave a text/number field; choices apply immediately.
They reach visible and hidden terminals without restarting shells.

Preferences are saved atomically in `terminal-preferences.json` beside
`session.json`. Only the settings window can write them. Appearance inherits the
active theme until overridden; individual resets restore inheritance, and Reset
defaults clears all overrides and restores terminal behavior. An invalid file
is preserved until an explicit reset. Custom colors stay fixed across light and
dark mode changes.

## Keyboard shortcuts

These are the defaults; use Cmd instead of Ctrl on macOS, except for terminal
overview, which uses Control+Tab to leave Cmd+Tab to the system. Configure them in
Settings → Keybinds by clicking an assignment and pressing a key combination.
Escape cancels recording. Conflicts must be resolved before saving. Clear an
assignment to let the terminal receive those keys normally.

Shortcuts are saved in `keybindings.json` beside `session.json`. Saving is
serialized and atomic, and updates reach the main window without restarting
PTYs. An invalid settings file remains intact until you choose Reset all.
Application shortcuts do not intercept ordinary text-field editing.

Settings → Keybinds → **Focus follows pointer** controls panel selection.
It is off by default: typing, pasting, and panel shortcuts use the panel you
clicked. When enabled, moving the mouse onto a terminal or file panel focuses
it, and input goes there without another click. Moving outside the panels keeps
the current panel active. Dialogs, ordinary form fields, text-selection drags,
and in-progress input composition keep their focus. This preference is saved
in `keybindings.json` and applies across windows without restarting terminals.

| Shortcut                    | Action                                    |
| --------------------------- | ----------------------------------------- |
| Ctrl+D                      | New terminal panel in the current tab     |
| Ctrl+Shift+D                | New terminal below the active panel       |
| Ctrl+W                      | Close active panel                        |
| Ctrl+Shift+T                | New tab                                   |
| Ctrl+Shift+W                | Close active tab                          |
| Ctrl+S in an editor         | Save the active file                      |
| Ctrl+F in an editor         | Find and replace                          |
| Ctrl+G in an editor         | Go to line                                |
| Alt+Z in an editor          | Toggle word wrap                          |
| Ctrl+Tab                    | Toggle terminal overview                  |
| Ctrl+PageDown / Ctrl+PageUp | Next / previous tab                       |
| Ctrl+Shift+E                | Toggle file explorer                      |
| Ctrl+Shift+G                | Toggle Source Control when available      |
| Ctrl+,                      | Open settings                             |
| Ctrl+- / Ctrl+= or Ctrl++   | Zoom out / in across the entire interface |
| Ctrl+0                      | Reset zoom to 100%                        |
| Ctrl+Shift+F                | Search the active terminal                |
| Ctrl+Shift+I                | Toggle multiline command input            |
| Ctrl+Shift+H                | Toggle command blocks                     |
| Ctrl+Shift+L                | Change the active tab's environment       |
| Ctrl+Shift+C / Ctrl+Shift+V | Copy terminal selection / paste clipboard |
| Ctrl+Enter in command input | Run the composed command                  |

Ctrl/Cmd+W also closes the active editor tab. Editor shortcuts do not consume
terminal input. Existing custom shortcuts take precedence over newly introduced
editor defaults; any colliding new defaults start unassigned.

Zoom changes the whole window's content, including terminal text, editors,
sidebars, and dialogs, in 10% steps between 50% and 200%. Use Cmd on macOS;
the plus and minus keys on the numeric keypad also work with the default
assignments. The main and Settings windows remember their own zoom levels.
Zoom shortcuts work in text fields and dialogs, and pause while recording a
shortcut in Keybinds. Existing custom assignments take precedence over the
new zoom defaults.

Right-click any tab and choose **Rename tab…** to set a custom title that
persists across app restarts, file saves, and browser navigation. File names
stay unchanged. Double-clicking terminal, browser, or commit tabs also opens
the rename dialog. Drag split dividers to resize panes; focused
dividers also accept arrow keys, and double-click resets a split to 50/50.
Workspace creation, renaming, and deletion are in the Workspaces sidebar.
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

`pnpm test:ui` builds the required plugin fixture under `tests/fixtures/`.
On Linux, native integration runs in isolated XDG folders with a real external
plugin build, PTY, browser, theme watch and safe restart:

```sh
pnpm tauri build --no-bundle --features native-smoke
node --experimental-strip-types tests/native/run-plugin-smoke.mjs
```

Native test support lives in `tests/native/` and is excluded from ordinary builds.
The runner's isolation is Linux-specific; test WebView2 and WKWebView separately
on their native operating systems.

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
src/ThemeEditor.tsx       Theme token controls, layout presets, and JSON editing
src/ThemeProvider.tsx     Theme persistence and cross-window synchronization
src/theme/format.ts            Theme format and validation
src/theme/runtime.ts     CSS application, local assets, and terminal appearance
src/SplitView.tsx         Recursive terminal layout and resize controls
src/Explorer.tsx          File explorer and editor opening
src/SourceControl.tsx     Git status, staging, and commit interface
src/styles.css           Interface styles
src/theme/baseline.css   Startup DeepMono tokens
src-tauri/src/terminal.rs Native PTY lifecycle and flow control
src-tauri/src/shell.rs    Shell discovery, launch profiles, and path quoting
src-tauri/shell/          Shell integration scripts
src-tauri/src/files.rs    Project files and session persistence
src-tauri/src/files/editor.rs Scoped file editing, revisions, and native watches
src-tauri/src/keybindings.rs Shortcut persistence and window access checks
src-tauri/src/themes.rs   Theme packages, scoped assets, and preferences
themes/                  Built-in theme, JSON schema, and authoring guide
src-tauri/src/git.rs      Git command backend
src-tauri/capabilities/   Window-specific native API permissions
tests/                   Model, interface, and native tests with required fixtures
AGENTS.md                Project rules and commit conventions
```

## Local plugins and docking

Use **Settings → Plugins → Import plugin** to copy a prebuilt local package.
Import inspects metadata only. **Enable… → Trust and enable** grants execution
trust for that exact installed revision. Trusted plugins run with main-window
application access; the SDK is not a sandbox. Settings never imports plugin code.

Open declared commands/views through **Commands** (Ctrl+Shift+P), assign shortcuts
in **Keybinds**, and place plugin sidebars independently of Explorer/Workspaces.
Central plugin, terminal, editor and native-browser panels share Dockview inside
terminal tabs. Ctrl-drag a pane's heading or drag an outer tab to dock it. Commands
**Move active panel** and **Dock current tab** provide keyboard alternatives.
The existing domain tree remains the only saved layout; Dockview renders it.

Disable/uninstall resolves plugin-owned dirty views first. Cancel or failed saves
leave the plugin working. Missing/disabled views keep their descriptor and state.
Replacing evaluated code requires the explicit guarded restart in Settings.
The [SDK guide](packages/plugin-sdk/README.md) includes public types/schema and
the standalone build contract. Installing a prebuilt package requires no compiler
or host rebuild. Package-supplied themes are available without enabling code.

Session v1 migrates to v2 on a successful save, preserving `session.v1.json`.
Theme v1 data migrates to JSONC while keeping its original file. Shortcut and
terminal preference formats remain compatible. Start `simplebench --safe-mode`
to skip third-party themes/code before loading. See the [recovery instructions](packages/plugin-sdk/README.md#limits-and-recovery).

## Themes and Linux graphics

Use **Settings → Themes → Create theme** to create a minimal adaptive theme
with its JSON schema, inheriting DeepMono until you add overrides,
or **Open folder** to open the theme library. Import/drop a folder containing
`theme.jsonc`, then select it. Themes control colors, typography, spacing, corners,
shadows, transparency, terminal appearance, and local image backgrounds. JSON
styles and ordered CSS files declared in `stylesheets` provide element-level
customization. All declared sheets load automatically.

**Edit theme** exposes searchable controls for all theme tokens and a JSON
editor. Section tokens independently control padding, gaps, borders, and corners.
Layout presets place tabs above/below the title controls, move the status bar,
and position settings navigation on any edge. Saves update active themes in both
windows, retain drafts on failure, and detect external changes before replacing
the manifest. Create theme opens this editor for its new package.

The default **Color mode → System** follows the operating system at startup and
when its appearance changes. Select **Light** or **Dark** for a persistent
override. Both windows, editors, and running terminals update together. Custom
themes without an explicit `appearance` follow this setting; themes that declare
an appearance keep their own mode.

The [theme authoring guide](themes/README.md) documents the format, tokens,
resources, terminal options, limits, and recovery. The
[JSON schema](themes/theme.schema.json) describes the supported fields.
Refresh reloads edited files
in both windows. Restore DeepMono recovers the default appearance. For a theme
that hides the settings interface, launch with `SIMPLEBENCH_SAFE_THEME=1`.

Colors come from DeepMono 1.1.0 by viewerofall, using the dark `mono` and light
`mono-light` flavors with the `graphite` accent in
`/home/woro/.config/DankMaterialShell/themes/deepmono/theme.json`.
The palette is stored in `src/theme/baseline.css` and `themes/deepmono.json`; the app does not need the original
file at runtime. CSS paints the selected palette over a transparent native
surface from startup. The SVG icon source is
`public/app-icon.svg`; the macOS source asset is
`public/Simplebench.icon/Assets/app-icon-transparent.svg`.
Regenerate desktop icons with
`pnpm tauri icon public/app-icon.svg` after changing it.

The native macOS icon comes from `public/Simplebench.icon`, edited in Apple's
Icon Composer. On macOS, `pnpm tauri dev` and app bundling automatically run
`pnpm icon:macos`, which requires Xcode 26 or later. It compiles `Assets.car`
into `src-tauri/target/macos-icon/` for the packaged app's system appearances
and refreshes `src-tauri/icons/icon.icns` for development and older macOS versions.
On macOS, the Cargo runner launches development builds inside
`src-tauri/target/debug/dev-bundle/SimpleBench.app`, preserving arguments,
terminal output, and hot reload. AppKit selects the icon's system appearance
from the catalog in both development and packaged builds. Direct `cargo run`
without this runner uses the static ICNS fallback.

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

## License

Copyright 2026 Maciej Kolerski. SimpleBench is licensed under the
[Apache License 2.0](LICENSE).
