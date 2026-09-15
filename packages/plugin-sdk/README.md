# SimpleBench plugin SDK v1

Local plugins are trusted JavaScript in the main application's realm. This SDK
is an integration contract, not a sandbox. Settings lists declarative metadata
without executing modules. Installation accepts prebuilt packages only.

Use `buildPlugin` from `@simplebench/plugin-sdk/build` with tsup 8.5.1,
TypeScript 7.0.2, React/React DOM 19.2.8 and their matching types. Keep `rootDir`
explicit in tsconfig. The esbuild plugin replaces React, React DOM client and
JSX entry points with small bindings to the host's shared instances. The SDK
context has one identity in the host and all plugins. Other dependencies are
bundled into your ESM output. Relative chunks and package assets stay local.

`tsup` is no longer actively maintained. Its bundled declaration generator
requires the removed JavaScript TypeScript compiler API and fails with TS 7.
The build helper therefore uses tsup/esbuild for ESM and the installed TypeScript
CLI for declarations. It does not downgrade the host's compiler or ignore the
failure. Runtime installation invokes neither compiler nor package scripts.

Build your plugin and import its output `package` folder in Settings → Plugins.
Import does not enable execution. Review the package and
choose **Enable… → Trust and enable**. Updating an evaluated revision requires
a normal application restart after resolving unsaved work.

The `index.d.ts` file describes the complete SDK. Register only contributions
listed in `plugin.json`. Every registration returns an idempotent disposer and
belongs to the activation context. Use its `signal` for asynchronous work;
registrations after deactivation throw. Cleanup errors do not stop other cleanup.
Timers and listeners registered through the context are released by the host.
Arbitrary plugin-created resources remain the author's responsibility.

Serializable panel state is limited to 64 KiB, 4096 values and 16 nested levels.
It describes a view, not unsaved file contents. Keep dirty documents and their
save/discard handlers outside transient React mounts and register their guards
with `registerDirtyView`. A same-thread infinite loop cannot be interrupted by
a promise timeout: restart with `--disable-plugins` or `--safe-mode`.

## Build outside the host checkout

From the checkout, pack the SDK:

```sh
mkdir -p /tmp/simplebench-sdk
pnpm --dir packages/plugin-sdk pack --pack-destination /tmp/simplebench-sdk
```

In your plugin's own folder, set the SDK dependency to
`file:/tmp/simplebench-sdk/simplebench-plugin-sdk-1.0.0.tgz` and declare the
compatible React, React DOM, tsup and TypeScript peers listed above. Provide
`plugin.json`, `src/index.tsx` exporting `activate`, and a `tsconfig.json` with
`rootDir: "src"`, `jsx: "react-jsx"`, `module: "ESNext"` and
`moduleResolution: "bundler"`. Define `build` as `node build.mjs`; that module
calls `buildPlugin({ assets: [...] })` with your package's asset paths. Then:

```sh
pnpm install --ignore-scripts
pnpm build
```

The helper produces `package/plugin.json`, native ESM and declarations in
`package/dist`, and listed assets. It replaces the previous output package on
build. Copy/install this **package folder**, not the authoring directory. It must
work offline; relative chunks remain relative to the immutable revision URL.
Use the host-compatible React/DOM peer versions. The helper shares `react`,
`react-dom`, `react-dom/client`, JSX runtime/development runtime and this SDK;
unsupported React DOM subpaths fail the author build. No Vite aliases or private
host imports are available. Other runtime dependencies are bundled by tsup.

## Manifest and lifecycle

Use `plugin.schema.json` from this package for external editor validation.
The runtime checks namespacing, duplicate IDs, contribution references and
compatibility too. `schemaVersion: 1`, `hostApi: 1` and your semantic `version`
serve different purposes. Unknown fields (including dependency declarations)
are rejected. IDs look like `author.name`; contribution IDs start with the full
owner plus a dot. An executable entry must be prebuilt `.js`/`.mjs` ESM.

`activation: "startup"` activates after the workbench is ready; `"lazy"` (also
the omitted default) activates on opening a declared view or executing a command.
Concurrent triggers share a promise. States are discovered, incompatible,
disabled, activating, active, failed and deactivating; Settings shows diagnostics.
Retry a failed activation/view from its placeholder. Cleanup releases host-owned
CSS, fills, commands, views, subscriptions, timers and close guards. Use `add`
for other cooperative resources. Handle errors from your own promises and event
handlers; a React boundary cannot catch asynchronous callbacks.

The loader serves only approved immutable package snapshots through `plugin:`
(or the engine's `plugin.localhost` mapping), with JavaScript MIME, CORS and
per-resource hashes. Importing never grants trust. Trust records the complete
package content hash; it does not verify the publisher. Disable before replacing
an installed package, then review and trust the new revision. If code was
already evaluated, **Restart SimpleBench** uses normal unsaved-work and session
save guards. Modules cannot be unloaded from the JavaScript engine. Cooperative
deactivation and reactivation of the same revision are supported; old immutable
revisions are removed on the next process's catalogue read.

## Views, commands and slots

`central` views open as outer tabs and can dock into terminal-tab layouts.
`sidebar` views are singleton per workspace (`multiple: false`), with independent
placement/width persisted alongside built-in sidebars. Central `multiple: false`
reuses a retained instance in the current workspace. `multiple: true` opens a new
instance each time. Version-unsupported, disabled or missing views keep their
bounded descriptor/state as removable placeholders; no fallback shell starts.

Call `onFocus` or focus an element in the panel; use semantic, keyboard-accessible
controls and optionally `data-plugin-focus` for pointer focus. `setState` updates
small persisted JSON; dirty data requires `registerDirtyView(panel.id, ...)`.
Register guards for retained instances, release them when the instance closes,
and keep their data outside transient React mounts. `save` resolves only after
saving; `isDirty` must then be false. A throw or still-dirty result blocks closure.
Disable/uninstall asks Save/Discard/Cancel before disposing the owner. Cancel and
failed saves leave it running. Explicit placeholder closure removes its state.

Commands are discoverable through **Commands** (default Ctrl+Shift+P) and Settings
→ Keybinds, including before activation. IDs preserve user overrides even when a
plugin is absent. `null` explicitly disables a binding. Conflicting defaults stay
unassigned and explain why; they cannot take another command's key. Stored
keybindings allow 2048 assignments and 256 KiB. Context uses structured fields:
`workspace`, allowed `viewTypes`, and `textInput` (false by default). Workbench
commands execute only in main. `executeCommand` currently addresses declared
plugin commands; built-in actions use the same host picker/keyboard execution
handler but are not part of the public SDK contract.

Slots: `statusbar` (always available in main), `sidebar-actions` (plugin sidebar),
`view-actions` (plugin panel heading). Declare fills with an accessible label;
use it on the component's actual control. Fills sort by stable contribution ID.
There is no permanent terminal plugin toolbar. mitt carries only small context,
contribution and theme notifications; PTY bytes never enter that event bus.
`useHostContext` and `snapshot()` expose the same current workspace/panel and
appearance. `themeRevision` identifies the native source revision; the `theme`
event's local revision also changes for a mode/preference/preview application.

`contributes.themes` names theme **folders** with `theme.jsonc` (legacy theme.json
can be migrated on duplication). These data-only contributions appear in Themes
on import without executable activation. Their generated theme IDs survive code
revisions.

## Limits and recovery

A package is bounded to 64 MiB, 2048 entries, 16 directory levels and 20 MiB per
file; metadata is 256 KiB and each contribution list has at most 128 entries.
The library permits 128 packages. Relative paths reject traversal, encoding,
symlinks, Windows reserved names/streams, and special files. Main owns execution;
Settings manages packages and validated metadata; browser child views retain
only their browser reporting privilege. These webview boundaries do not sandbox
trusted JavaScript within main.

Start `simplebench --safe-mode` to recover from plugin code or CSS that blocks the
interface. Disable the faulty plugin in Settings, then close/reopen normally.
For corrupt `plugins/installed.json`, close the application, rename that file to
`installed.backup.json`, restart in safe mode and reimport desired packages.
Do not delete the package folders or session file. The catalogue error preserves
the original; missing plugins restore as placeholders. Same-thread infinite
loops require terminating the process; promises cannot interrupt them.
