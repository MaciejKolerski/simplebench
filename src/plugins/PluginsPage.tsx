import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { api, errorMessage } from "../api";
import { useThemes } from "../ThemeProvider";
import { Modal } from "../ui";
import { usePlugins } from "./PluginsProvider";
import type { PluginEntry } from "./host";
interface Finished {
  token: string;
  approved: boolean;
  error?: string | null;
}
export default function PluginsPage() {
  const plugins = usePlugins(),
    themes = useThemes();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [trust, setTrust] = useState<PluginEntry | null>(null),
    [fallback, setFallback] = useState<PluginEntry | null>(null),
    [pending, setPending] = useState<string | null>(null);
  const working = useRef(false),
    pendingToken = useRef<string | null>(null),
    finished = useRef(new Map<string, Finished>()),
    listener = useRef<Promise<UnlistenFn> | null>(null);
  const complete = (result: Finished) => {
    pendingToken.current = null;
    setPending(null);
    if (!result.approved)
      setError(
        result.error ??
          "The operation was canceled. The plugin and its views remain available.",
      );
    void plugins.reload();
  };
  useEffect(() => {
    const stop = listen<Finished>(
      "plugin-operation-finished",
      ({ payload }) => {
        if (payload.token === pendingToken.current) complete(payload);
        else {
          finished.current.set(payload.token, payload);
          if (finished.current.size > 128)
            finished.current.delete(finished.current.keys().next().value!);
        }
      },
    );
    listener.current = stop;
    void stop.catch((error) => setError(errorMessage(error)));
    return () => {
      void stop.then((stop) => stop()).catch(() => {});
    };
  }, [plugins.reload]);
  const run = async (action: () => Promise<unknown>) => {
    if (working.current || pendingToken.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      await plugins.reload();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const remove = async (entry: PluginEntry, uninstall: boolean) => {
    await listener.current;
    const token = await api<string>("request_plugin_removal", {
      id: entry.id,
      expected: entry.revision,
      uninstall,
    });
    const result = finished.current.get(token);
    if (result) {
      finished.current.delete(token);
      complete(result);
    } else {
      pendingToken.current = token;
      setPending(token);
    }
  };
  return (
    <main className="keybindings-page">
      <header className="settings-page-heading">
        <div>
          <h1>Plugins</h1>
          <p>Install prebuilt packages from a local folder.</p>
        </div>
        <button
          className="button"
          disabled={busy || !!pending}
          onClick={() =>
            void run(async () => {
              const path = await open({
                directory: true,
                multiple: false,
                title: "Import plugin package",
              });
              if (typeof path === "string")
                await api("import_plugin", { path });
            })
          }
        >
          Import plugin
        </button>
      </header>
      <p className="settings-help">
        Importing a package does not run its code. Enable only plugins whose
        code you trust. Data-only themes appear in Themes without enabling code.
      </p>
      {plugins.catalog.safeMode && (
        <p role="status">
          Safe startup is active. Third-party code is skipped. Restart normally
          after disabling the faulty plugin.
        </p>
      )}
      {(error || plugins.error) && (
        <p className="text-error" role="alert">
          {error || plugins.error}
        </p>
      )}
      {plugins.error && (
        <p className="settings-help">
          Recovery: close SimpleBench, back up plugins/installed.json by
          renaming it to installed.backup.json in the application data folder,
          then restart with --safe-mode and reimport your packages. Keep package
          folders and the session file.
        </p>
      )}
      {pending && (
        <p role="status">
          Resolve unsaved plugin views in the workspace window to finish.
        </p>
      )}
      <button
        className="text-button"
        disabled={busy || !!pending}
        onClick={() => void plugins.reload()}
      >
        Refresh
      </button>
      {plugins.catalog.entries.length === 0 && (
        <p className="empty-message">No plugins installed.</p>
      )}
      {plugins.catalog.entries.map((entry) => (
        <section className="keybindings-group" key={entry.id}>
          <h2>{entry.manifest?.name ?? entry.id}</h2>
          <p>{entry.manifest?.description}</p>
          <p className="settings-help">
            {entry.id} · {entry.manifest?.version ?? "Unknown version"} ·{" "}
            {entry.enabled ? "Enabled" : "Disabled"} ·{" "}
            {entry.trustedRevision === entry.revision
              ? "Trusted revision"
              : "Not trusted"}
            {entry.status ? ` · ${entry.status.phase}` : ""}
          </p>
          <p className="settings-help">Source: {entry.source}</p>
          {(entry.error || entry.status?.error) && (
            <p className="text-error" role="alert">
              {entry.error || entry.status?.error}
            </p>
          )}
          {entry.restartRequired && (
            <p role="status">
              Replacement code requires a restart. Running terminals will end
              after the close checks succeed.{" "}
              <button
                className="button"
                disabled={busy || !!pending}
                onClick={() => void run(() => api("request_plugin_restart"))}
              >
                Restart SimpleBench
              </button>
            </p>
          )}
          <div className="dialog-actions">
            {entry.manifest?.entry && (
              <button
                className="button"
                disabled={busy || !!pending || !!entry.error}
                onClick={() =>
                  entry.enabled
                    ? void run(() => remove(entry, false))
                    : setTrust(entry)
                }
              >
                {entry.enabled ? "Disable" : "Enable…"}
              </button>
            )}
            <button
              className="button"
              disabled={busy || !!pending}
              onClick={() =>
                entry.themeIds?.includes(themes.preferences.active ?? "")
                  ? setFallback(entry)
                  : void run(() => remove(entry, true))
              }
            >
              Uninstall
            </button>
          </div>
        </section>
      ))}
      {trust && (
        <Modal
          title={`Enable ${trust.manifest?.name ?? trust.id}?`}
          onClose={() => {
            if (!busy) setTrust(null);
          }}
        >
          <div className="dialog-form">
            <p>
              {trust.id} · {trust.manifest?.version}
            </p>
            <p>Source: {trust.source}</p>
            <p>
              Enabling this plugin executes trusted code with application
              access, including files and terminals available to SimpleBench. It
              is not sandboxed. Approve only code you trust.
            </p>
            <p className="settings-help">
              Approval applies to this installed revision. Changed code requires
              a new review.
            </p>
            <div className="dialog-actions">
              <button
                className="button"
                disabled={busy}
                onClick={() => setTrust(null)}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api("enable_plugin", {
                      id: trust.id,
                      expected: trust.revision,
                    });
                    setTrust(null);
                  })
                }
              >
                Trust and enable
              </button>
            </div>
          </div>
        </Modal>
      )}
      {fallback && (
        <Modal
          title="Replace the active theme?"
          onClose={() => {
            if (!busy) setFallback(null);
          }}
        >
          <div className="dialog-form">
            <p>
              This package supplies the selected theme. Switch to DeepMono
              before uninstalling it. The package stays installed if the switch
              or its close checks fail.
            </p>
            <div className="dialog-actions">
              <button
                className="button"
                disabled={busy}
                onClick={() => setFallback(null)}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await themes.select(null);
                    await remove(fallback, true);
                    setFallback(null);
                  })
                }
              >
                Switch to DeepMono and uninstall
              </button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}
