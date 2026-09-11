# macOS compatibility

SimpleBench uses Tauri 2 and AppKit for native windows, WKWebView for the
React interface, and Rust/portable-pty for terminal processes. The macOS
integration keeps this architecture and the existing DeepMono themes.

## Window behavior

`src-tauri/tauri.macos.conf.json` enables native decorations with an overlay
title bar for the main window. The settings window uses the same options in
`src-tauri/src/settings_window.rs`. AppKit supplies the rounded window outline, shadow,
traffic lights, resizing, and full-screen transitions. CSS reserves space for
the traffic lights and keeps status-bar controls away from the corners.
Both windows grant Tauri's internal title-bar double-click action permission;
the drag region can therefore follow the system's title-bar action.

The native window owns corner clipping, including in full screen; the macOS
interface does not apply a second CSS window radius. Custom themes still
control the interface and its transparency. Windows and Linux retain their
existing window configuration and custom controls.

This follows [Tauri's window customization guidance](https://v2.tauri.app/learn/window-customization/).
Apple describes how the system chooses corner geometry for different window
styles in [Build an AppKit app with the new design](https://developer.apple.com/videos/play/wwdc2025/310/).
It does not require replacing the interface with Liquid Glass components.

## Platform corrections

- Application Quit requests, including the menu and Dock path, go through
  the main window's editor close guard and session save before exiting.
  Cancel and failed saves keep the application open. Closing the main window
  still exits the application and stops its PTYs, as on the other platforms.
- The native menu leaves Cmd+W available to the configurable panel shortcut.
  Window → Close Window explicitly closes the focused window. Native Edit,
  Hide, Minimize, Zoom, and Full Screen actions remain available.
  Cmd+W closes Settings while leaving its shortcut recorder able to capture
  that combination.
- Opening settings again restores its minimized window. Reopening the running
  application from the Dock restores and focuses the main window.
- Settings are prepared in a hidden, unfocused window alongside the main window
  during application startup. Closing settings hides that window so later requests reuse the
  loaded interface. Requests made during preparation retain their target page
  until the settings listener is ready. macOS background throttling limits
  hidden work without fully suspending the prepared webview. Main-window
  closing and application Quit retain their existing exit guards.
- The default terminal overview shortcut is Control+Tab on macOS, because
  Cmd+Tab belongs to system application switching. Other existing Cmd defaults
  remain in place. Saved assignments are preserved; an existing Cmd+Tab
  assignment can be changed or reset in Settings → Keybinds.
- Local zsh terminals start as login shells on macOS. The integration forwards
  `.zprofile`, including common Homebrew environment setup, before `.zshrc`;
  `.zlogin` then runs from the user's configuration directory. User startup
  files are not edited. The fallback shell is `/bin/zsh` when `SHELL` is absent.
  Shell discovery also checks the standard Homebrew `bin` directories after
  `PATH`, so shells remain discoverable when launching from Finder.
- The zsh prompt hook uses a writable local exit-code variable. Its previous
  `status` variable conflicted with a read-only zsh parameter, preventing
  working-directory and command-status reports.

## Architecture review and validation

Validation host: **macOS 26.6.2, Apple Silicon (arm64)**, with the macOS 26.5 SDK.

| Area                       | Validation                                                                                                                                                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native windows             | Both decorated windows rendered and captured at their minimum sizes; main window maximize/restore and full-screen/restore exercised in the desktop app.                                                                             |
| Terminal transport         | Real zsh PTY, Unicode output, split/close without replacing the original PTY, and output while an editor is active exercised in WKWebView. Rust tests cover binary channel transport, resizing, and exit.                           |
| Shell startup              | A native zsh test checks `.zshenv` → `.zprofile` → `.zshrc` → `.zlogin` ordering and OSC command/directory reports using isolated startup files.                                                                                    |
| Editors and files          | Native tests cover scoped access, atomic saves, revisions, encodings, symlinks, and permissions. Interface tests cover dirty buffers, history, watches, and close/save failures. Native Quit cancellation preserves a dirty editor. |
| Projects, workspaces, tabs | Interface tests cover layout changes, restoration, background terminals, and unsaved-file guards. The native smoke test uses an isolated session and project.                                                                       |
| Git                        | Rust tests execute Git in temporary repositories; interface tests cover Source Control and commit history with mocked commands.                                                                                                     |
| Preferences and themes     | Native persistence tests and interface tests cover validation, separate window permissions, theme failures, and synchronization without restarting PTYs.                                                                            |
| Keyboard and layout        | macOS interface tests check Cmd panel actions, Control input to the PTY, overview, minimum sizes, and native close-request handling.                                                                                                |

The model suite passed **74 tests**, the Rust suite passed **52 tests**, and
the Chromium interface suite passed **207 tests**. A subsequent focused run
passed **10 keyboard/macOS tests**, including the added Settings Cmd+W test.
Chromium tests mock native commands; the separate desktop smoke test exercises
real WKWebView, WebGL rendering, and PTYs.

TypeScript checking, the frontend build, Prettier, Rust formatting,
`cargo check --locked`, and `cargo clippy --locked -- -D warnings` passed.
`pnpm tauri build --no-bundle` produced the arm64 release executable at
`src-tauri/target/release/simplebench`.

Disk space was limited during the initial validation. Rust development/test
checks initially used `CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0`,
and `CARGO_INCREMENTAL=0`. A subsequent ordinary `pnpm tauri dev` reproduced
an out-of-space compilation failure. The project now keeps Rust backtrace line
information and disables incremental artifacts in its default development
profile; tests inherit that profile. Old build caches were removed while
retaining the release executable. Ordinary `pnpm tauri dev` then built and
displayed the native application successfully, and all 52 Rust tests passed
without profile environment overrides. No dependency versions were changed.

A subsequent settings-startup check used an isolated native development build
and the local Vite server. Before reuse, four opens took 468–481 ms to show the
window and 523–539 ms to reach the second animation frame with settings rendered.
After hidden preparation, ordinary opens took 7–12 ms to show and 38–62 ms to
reach that frame. Preparation now starts alongside the workspace. Clicking
immediately when the main window became visible showed settings in 6–11 ms;
the second animation frame arrived in 226–236 ms while startup was still
settling. These are local development measurements, not fixed latency bounds.
Restoring a minimized window retains the system's animation.

Native checks verified hidden preparation without taking focus, reuse after
native close and Cmd+W, minimized-window restoration, direct page requests,
rapid repeated clicks, requests arriving during preparation, and application
exit with hidden settings. Startup interface tests cover theme readiness,
listener registration, deferred painting, and focus arriving before the native
readiness reply. The Rust suite still passes all 52 tests.

## Remaining verification boundaries

- Intel Macs, older macOS releases, Windows, and Linux were not run during this
  validation. macOS integration is conditionally compiled and configured.
- Automatic CLI title configuration and foreground-process fallback remain
  Linux-only. macOS terminals still accept standard OSC titles from programs
  and working-directory reports from the shell hooks.
- This is a local compatibility validation. Distribution signing,
  notarization, Gatekeeper installation on a clean Mac, and installer testing
  require a separate release validation with the publisher's credentials.
  The existing transparent webview uses Tauri's `macos-private-api` feature;
  this work does not establish Mac App Store eligibility.
- Native smoke automation invokes window operations and dispatches application
  shortcuts in WKWebView. Physical keyboard layouts, VoiceOver, external
  monitors, and trackpad window-tiling gestures were not exhaustively tested.
