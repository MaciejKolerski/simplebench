# SimpleBench agent instructions

## Project

SimpleBench is a desktop ADE application developed incrementally around project
folders, named workspaces, and terminal tabs. A project owns workspaces sharing
its folder; each workspace owns tabs; each tab owns a shell environment and a
tree of terminal panes. There is no hardcoded tab count limit.

The current milestone includes project selection, workspaces, tabs, a file
explorer, conditional Git Source Control, native terminals with splits and
background streaming, session restoration, and a separate placeholder settings
window. Add further product functionality only when requested. Do not infer a
detailed ADE feature set from the project name or acronym.

## Technology and structure

- Tauri 2 hosts the desktop application and its native window.
- Rust implements the native application in `src-tauri/src/`.
- React and TypeScript implement the interface in `src/`.
- Vite serves the frontend during development and builds it into `dist/`.
- Plain CSS defines the interface and theme in `src/styles.css`.
- `src/model.ts` owns the persisted layout and pure layout transformations.
- `src/Workbench.tsx` coordinates projects, workspaces, tabs, and persistence.
- xterm.js renders terminals; `src/terminal-runtime.ts` owns their lifecycle and
  streaming independently of React. Rust `portable-pty` owns native processes.
- `src-tauri/src/shell.rs` discovers shell environments and quotes dropped paths;
  `src-tauri/shell/` contains integration hooks. Do not edit user shell profiles.
- `src-tauri/src/files.rs` handles file access and session saving;
  `src-tauri/src/git.rs` handles Git through argument-based CLI calls.
- pnpm manages frontend dependencies; Cargo manages Rust dependencies.
- `src-tauri/tauri.conf.json` connects Vite to Tauri and configures the window.
- `src-tauri/capabilities/` defines the native commands available to the frontend.
- `src-tauri/src/main.rs` contains a startup workaround for WebKitGTK's Wayland
  Error 71 on NVIDIA. Keep it scoped to that environment, preserve explicit user
  overrides, and set the process environment before Tauri starts GUI threads.
- Commit `pnpm-lock.yaml` and `src-tauri/Cargo.lock` when dependencies change.
  Do not add lockfiles from other JavaScript package managers.

## Scope and simplicity

- Implement the smallest complete solution for the requested milestone.
- Avoid overengineering: do not add speculative features, premature abstractions,
  generic frameworks, unused dependencies, or infrastructure for hypothetical needs.
- Prefer straightforward code and the existing stack. Extract shared code only
  when real duplication or current complexity justifies it.
- Do not prebuild editors, AI integrations, remote services, or additional
  settings before the corresponding feature is requested.
- Keep changes focused. Do not mix unrelated refactors into a task.
- Add native commands, plugins, and permissions only when a current feature needs
  them, and grant only the access that feature requires.

## Terminal and persistence invariants

- Keep terminal output outside React state. Send binary output directly through
  Tauri channels and acknowledge it after xterm parses it. Preserve bounded flow
  control, ordered input/output, and the ordered end-of-stream marker.
- Switching tabs or workspaces must not restart running PTYs or stop parsing
  their output. Release hidden WebGL renderers and dispose closed PTYs.
- Preserve WebGL initialization and context-loss fallback. Do not impose an
  arbitrary tab cap; retain bounded scrollback and command metadata.
- Shell commands, control keys, terminal escape sequences, and Unicode must pass
  through without speculative interpretation or automatic command execution.
- Dropped paths must use the selected shell's quoting rules, including WSL path
  translation. Never append Enter when inserting a dropped path.
- Restore layouts and working directories with fresh shells when tabs are first
  visited. Never replay commands or claim to restore live processes or output.
- Serialize session saves and replace the layout file atomically. Preserve an
  unreadable or unsupported saved session until the user chooses recovery.
- Keep custom native commands restricted to the main window. Settings has only
  the permissions required for its own window controls.
- Git mutations must follow an explicit UI action. Preserve the user's identity
  and exact commit text; never silently stage, commit, push, or add attribution.

## Language and comments

- Keep this entire `AGENTS.md` file in English.
- Write all code comments and documentation comments in English.
- Comments must be technical and refer directly to the code: explain behavior,
  constraints, invariants, non-obvious decisions, or platform-specific workarounds.
- Do not add filler, narration of the task, obvious restatements of the code,
  promotional text, or AI attribution to comments. Omit unnecessary comments.

## Appearance

- Use the DeepMono palette from
  `/home/woro/.config/DankMaterialShell/themes/deepmono/theme.json`.
- The foundation uses the default dark `mono` flavor and `graphite` accent from
  DeepMono 1.1.0. Their values are stored as CSS custom properties in
  `src/styles.css`; reuse these tokens instead of inventing additional colors.
- The native window background in `src-tauri/tauri.conf.json` must match the CSS
  background token. The app icon source is `public/app-icon.svg`.
- The application must work without access to the original local theme file.
  Keep the selected colors in the repository; do not read that path at runtime.
- Keep the initial interface minimal and usable at the configured minimum window
  size. Use semantic HTML and preserve readable contrast.

## Development and validation

- Install dependencies: `pnpm install --frozen-lockfile`.
- Start the desktop app: `pnpm tauri dev`.
- Start only the browser frontend: `pnpm dev`.
- Check TypeScript: `pnpm check`.
- Run model tests: `pnpm test`.
- Run interface tests: `pnpm test:ui` (install Chromium with
  `pnpm exec playwright install chromium` first).
- Check frontend/document formatting: `pnpm format:check`.
- Build the frontend: `pnpm build`.
- Check Rust: `cargo check --manifest-path src-tauri/Cargo.toml --locked`.
- Run Rust and native PTY tests:
  `cargo test --manifest-path src-tauri/Cargo.toml --locked`.
- Check Rust formatting: `cargo fmt --manifest-path src-tauri/Cargo.toml --check`.
- Check Rust lints:
  `cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings`.
- Build the desktop executable: `pnpm tauri build --no-bundle`.
- Build platform installers: `pnpm tauri build`.
- Run checks appropriate to the changed code. For UI changes, inspect the rendered
  result. Add tests for meaningful behavior, not static markup or trivial wrappers.
- Playwright uses mocked native commands. Verify PTY transport, native windows,
  renderer behavior, and platform-specific shells in the desktop application
  when changing those paths. State which operating systems were actually tested.
- Report what was verified and any checks that could not run. Never claim a check
  passed unless it actually ran successfully.

## Commit and GitHub conventions

- Use English for commit subjects, commit bodies, pull request titles, and pull
  request descriptions.
- Use this subject format for every commit and pull request title:
  `type(scope): short imperative summary`.
- Use a lowercase type and scope. Allowed types: `feat`, `fix`, `docs`, `style`,
  `refactor`, `test`, `build`, `ci`, `chore`, and `perf`.
- Choose a short scope that identifies the changed area, such as `app`, `ui`,
  `rust`, `deps`, or `repo`.
- Keep the subject at most 72 characters, without a trailing period. Use an
  imperative verb such as `add`, `fix`, or `remove`.
- Each commit should represent one coherent change.
- After a blank line, include a short body explaining what changed and why, then
  a `Validation:` section listing the checks and their results. If checks were
  not run, state that and give the reason. Wrap body text at about 72 characters.
- Describe breaking changes in a `BREAKING CHANGE:` footer when applicable.
- Never add an AI agent as an author or co-author. Never add an AI
  `Co-authored-by:` trailer, agent signature, or "generated by" attribution to
  commits or pull requests. Preserve the user's configured Git identity.
- Use `.github/pull_request_template.md` for pull request descriptions. Describe
  the final behavior, its reason, and actual validation results. Link an existing
  issue when relevant; do not invent issue numbers.

Example commit:

```text
feat(app): initialize the desktop foundation

Add a Tauri window and an empty React workspace using the DeepMono palette.
Keep the first milestone small so ADE features can be added incrementally.

Validation:
- pnpm build: passed
- cargo check --manifest-path src-tauri/Cargo.toml --locked: passed
```
