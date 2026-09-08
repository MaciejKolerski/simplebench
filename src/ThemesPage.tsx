import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  FolderOpen,
  Import,
  Monitor,
  Moon,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  Sun,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { api, errorMessage, native } from "./api";
import { useThemes } from "./ThemeProvider";
import { builtinTheme, parseTheme } from "./themes";
import type { ThemeBundle, ThemeCatalog, ThemeManifest } from "./themes";
import ThemeEditor from "./ThemeEditor";

export default function ThemesPage() {
  const themes = useThemes();
  const [catalog, setCatalog] = useState<ThemeCatalog>({
    directory: "",
    themes: [],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState<{
    id: string;
    manifest: ThemeManifest;
  } | null>(null);
  const working = useRef(false);
  const mounted = useRef(false);
  const refreshCatalog = useCallback(async () => {
    if (!native) return;
    const next = await api<ThemeCatalog>("list_themes");
    if (mounted.current) setCatalog(next);
  }, []);
  const run = useCallback(
    async (operation: () => Promise<void>, message: string) => {
      if (working.current) return;
      working.current = true;
      setBusy(true);
      setError("");
      setStatus("");
      try {
        await operation();
        if (mounted.current && message) setStatus(message);
      } catch (error) {
        if (mounted.current) setError(errorMessage(error));
      } finally {
        working.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [],
  );
  const importFolder = useCallback(
    (path: string) =>
      run(async () => {
        await api<string>("import_theme", { path });
        await refreshCatalog();
      }, "Theme imported. Select it below to apply it."),
    [run, refreshCatalog],
  );
  useEffect(() => {
    mounted.current = true;
    void refreshCatalog().catch((error) => {
      if (mounted.current) setError(errorMessage(error));
    });
    const focused = () =>
      void refreshCatalog().catch((error) => {
        if (mounted.current) setError(errorMessage(error));
      });
    window.addEventListener("focus", focused);
    const unlisten = native
      ? getCurrentWebviewWindow().onDragDropEvent(({ payload }) => {
          if (!mounted.current) return;
          setDragging(payload.type === "enter" || payload.type === "over");
          if (payload.type === "drop") {
            if (payload.paths.length !== 1)
              setError("Drop one theme folder at a time.");
            else void importFolder(payload.paths[0]);
          }
        })
      : Promise.resolve(() => {});
    void unlisten.catch((error) => {
      if (mounted.current) setError(errorMessage(error));
    });
    return () => {
      mounted.current = false;
      window.removeEventListener("focus", focused);
      void unlisten.then((stop) => stop()).catch(() => {});
    };
  }, [refreshCatalog, importFolder]);
  const select = (id: string | null) =>
    void run(() => themes.select(id), "Theme applied to all windows.");
  const edit = async (id: string) => {
    const bundle = await api<ThemeBundle>("load_theme", { id });
    setEditing({ id, manifest: parseTheme(bundle.manifest) });
  };
  return (
    <main
      className={`themes-page${dragging ? " theme-dragging" : ""}`}
      aria-busy={busy}
    >
      <header className="settings-page-heading">
        <div>
          <h1>Themes</h1>
          <p>Make SimpleBench feel like your workspace.</p>
        </div>
        <button
          className="button"
          disabled={busy || !themes.ready}
          onClick={() => select(null)}
        >
          <RotateCcw size={14} />
          Restore DeepMono
        </button>
      </header>
      <fieldset
        className="theme-appearance"
        disabled={busy || !themes.ready || !!themes.fixedAppearance}
      >
        <legend>Color mode</legend>
        <div className="theme-appearance-options">
          {(
            [
              ["system", "System", Monitor],
              ["light", "Light", Sun],
              ["dark", "Dark", Moon],
            ] as const
          ).map(([appearance, label, Icon]) => (
            <label key={appearance}>
              <input
                type="radio"
                name="appearance"
                value={appearance}
                checked={
                  (themes.fixedAppearance ?? themes.preferences.appearance) ===
                  appearance
                }
                onChange={() =>
                  void run(
                    () => themes.select(themes.preferences.active, appearance),
                    "Color mode saved for all windows.",
                  )
                }
              />
              <Icon size={16} aria-hidden="true" />
              {label}
            </label>
          ))}
        </div>
        <p className="settings-help">
          {themes.fixedAppearance
            ? `This theme defines its own ${themes.fixedAppearance} appearance. Choose DeepMono to use the color mode setting.`
            : "System follows your computer’s appearance at startup and whenever it changes."}
        </p>
      </fieldset>
      <section className="theme-library" aria-label="Theme library">
        <div className="theme-library-heading">
          <FolderOpen size={19} />
          <div>
            <h2>Your theme folder</h2>
            <p>Manage colors, spacing, borders, layouts, styles, and images.</p>
          </div>
        </div>
        {catalog.directory && (
          <code className="theme-directory">{catalog.directory}</code>
        )}
        <div className="theme-actions">
          <button
            className="button"
            disabled={busy || !native}
            onClick={() =>
              void run(() => api("open_themes_folder", { id: null }), "")
            }
          >
            <FolderOpen size={14} />
            Open folder
          </button>
          <button
            className="button"
            disabled={busy || !native}
            onClick={() =>
              void run(async () => {
                const path = await open({
                  directory: true,
                  multiple: false,
                  title: "Import a SimpleBench theme folder",
                });
                if (!path) return;
                await api("import_theme", { path });
                await refreshCatalog();
                setStatus("Theme imported. Select it below to apply it.");
              }, "")
            }
          >
            <Import size={14} />
            Import folder
          </button>
          <button
            className="button"
            disabled={busy || !native}
            onClick={() =>
              void run(async () => {
                await refreshCatalog();
                await api("refresh_themes");
                await themes.reload();
              }, "Theme files refreshed.")
            }
          >
            <RefreshCw size={14} />
            Refresh
          </button>
          <button
            className="button"
            disabled={busy || !native}
            onClick={() =>
              void run(async () => {
                const id = await api<string>("create_theme");
                await refreshCatalog();
                await edit(id);
              }, "Starter theme created. Customize it, then select it below.")
            }
          >
            <Plus size={14} />
            Create theme
          </button>
        </div>
        <p className="settings-help">
          You can also drop a theme folder into this page. After editing files,
          use Refresh.
        </p>
      </section>
      {(error || themes.error) && (
        <div className="keybindings-error" role="alert">
          {error || themes.error}
        </div>
      )}
      {themes.safeMode && (
        <p className="settings-help" role="status">
          Safe theme mode is active. Remove SIMPLEBENCH_SAFE_THEME when you next
          launch the app to restore your saved selection.
        </p>
      )}
      {!native && (
        <p className="settings-help">
          Theme folders are available in the desktop application.
        </p>
      )}
      <div className="keybindings-status" role="status">
        {busy ? "Updating themes…" : !themes.ready ? "Loading themes…" : status}
      </div>
      <div className="theme-list" aria-label="Available themes">
        {[
          {
            id: null,
            name: builtinTheme.name,
            description: builtinTheme.description,
            author: "Built in",
            error: null,
          },
          ...catalog.themes,
        ].map((entry) => {
          const active = entry.id === themes.preferences.active;
          return (
            <article
              className={`theme-card${active ? " active-theme" : ""}`}
              key={entry.id ? `theme:${entry.id}` : "builtin"}
            >
              <button
                className="theme-choice"
                aria-pressed={active}
                aria-label={`Use ${entry.name} theme`}
                disabled={busy || !themes.ready || !!entry.error}
                onClick={() => select(entry.id)}
              >
                <span className="theme-symbol">
                  <Palette size={19} />
                </span>
                <span className="theme-details">
                  <strong>{entry.name}</strong>
                  {entry.author && <small>{entry.author}</small>}
                  <span>
                    {entry.error ?? entry.description ?? "Custom theme"}
                  </span>
                </span>
                {active && (
                  <span className="theme-active-label">
                    <Check size={14} />
                    Active
                  </span>
                )}
              </button>
              {entry.id && (
                <div className="theme-card-actions">
                  <button
                    className="text-button theme-edit"
                    disabled={busy || !!entry.error}
                    onClick={() => void run(() => edit(entry.id!), "")}
                  >
                    Edit theme
                  </button>
                  <button
                    className="text-button theme-edit"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => api("open_themes_folder", { id: entry.id }),
                        "",
                      )
                    }
                  >
                    Open theme folder
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
      {editing && (
        <ThemeEditor
          key={editing.id}
          id={editing.id}
          initial={editing.manifest}
          onClose={() => setEditing(null)}
          onSaved={refreshCatalog}
        />
      )}
    </main>
  );
}
