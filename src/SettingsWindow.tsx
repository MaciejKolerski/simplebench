import { useEffect, useRef, useState } from "react";
import { Code, Keyboard, Palette, Terminal, RotateCcw, X } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import ThemesPage from "./ThemesPage";
import TerminalSettingsPage from "./TerminalSettingsPage";
import EditorSettingsPage from "./EditorSettingsPage";
import { IconButton, WindowControls } from "./ui";
import { errorMessage, native } from "./api";
import {
  actions,
  bindingConflict,
  formatShortcut,
  shortcutFromEvent,
} from "./keybindings";
import type { ActionId, Keybindings } from "./keybindings";
import { useKeybindings } from "./KeybindingsProvider";

export default function SettingsWindow() {
  const [page, setPage] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get("page");
    return requested === "editor" ||
      requested === "themes" ||
      requested === "terminal"
      ? requested
      : "keybinds";
  });
  const preferences = useKeybindings();
  const [recording, setRecording] = useState<ActionId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const busyRef = useRef(false);
  const recordingButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!native) return;
    let current = true;
    const unlisten = listen<string>("settings-page-changed", ({ payload }) => {
      if (
        current &&
        ["keybinds", "editor", "themes", "terminal"].includes(payload)
      ) {
        setRecording(null);
        setPage(payload);
      }
    });
    void unlisten.catch((error) => {
      if (current) setError(errorMessage(error));
    });
    return () => {
      current = false;
      void unlisten.then((stop) => stop()).catch(() => {});
    };
  }, []);
  useEffect(() => {
    recordingButton.current?.focus();
  }, [recording]);

  const persist = async (bindings: Keybindings) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setStatus("Saving…");
    setRecording(null);
    try {
      await preferences.save(bindings);
      setStatus("Saved");
    } catch (error) {
      setError(errorMessage(error));
      setStatus("");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const assign = (id: ActionId, shortcut: string | null) => {
    const conflict = bindingConflict(preferences.bindings, id, shortcut);
    if (conflict) {
      setError(
        `${formatShortcut(shortcut)} is already assigned to “${conflict}”. Change or clear that shortcut first.`,
      );
      return;
    }
    void persist({ ...preferences.bindings, [id]: shortcut });
  };
  return (
    <div className="app-shell settings-window">
      <header className="titlebar" data-tauri-drag-region>
        <span className="settings-title" data-tauri-drag-region>
          Settings
        </span>
        <div className="titlebar-space" data-tauri-drag-region />
        <WindowControls onError={setError} />
      </header>
      <div className="settings-layout">
        <nav className="settings-navigation" aria-label="Settings pages">
          <button
            className="settings-nav-item"
            aria-current={page === "keybinds" ? "page" : undefined}
            onClick={() => setPage("keybinds")}
          >
            <Keyboard size={16} />
            Keybinds
          </button>
          <button
            className="settings-nav-item"
            aria-current={page === "editor" ? "page" : undefined}
            onClick={() => setPage("editor")}
          >
            <Code size={16} />
            Editor
          </button>
          <button
            className="settings-nav-item"
            aria-current={page === "terminal" ? "page" : undefined}
            onClick={() => setPage("terminal")}
          >
            <Terminal size={16} />
            Terminal
          </button>
          <button
            className="settings-nav-item"
            aria-current={page === "themes" ? "page" : undefined}
            onClick={() => setPage("themes")}
          >
            <Palette size={16} />
            Themes
          </button>
        </nav>
        {page === "terminal" ? (
          <TerminalSettingsPage />
        ) : page === "themes" ? (
          <ThemesPage />
        ) : page === "editor" ? (
          <EditorSettingsPage />
        ) : (
          <main className="keybindings-page">
            <header className="settings-page-heading">
              <div>
                <h1>Keybinds</h1>
                <p>
                  Customize shortcuts for terminals, tabs, and the workspace.
                </p>
              </div>
              <button
                className="button"
                disabled={!preferences.ready || busy}
                onClick={() => void persist(preferences.defaults)}
              >
                <RotateCcw size={14} />
                Reset all
              </button>
            </header>
            <p className="settings-help">
              Click a shortcut and press a new key combination. Changes apply
              immediately. Escape cancels recording.
            </p>
            <p className="settings-help">
              Clear a shortcut to pass those keys to the terminal. Shortcuts are
              active while SimpleBench is focused.
            </p>
            {(error || preferences.error) && (
              <div className="keybindings-error" role="alert">
                <span>{error || preferences.error}</span>
                {preferences.error && (
                  <button
                    className="text-button"
                    onClick={() => void preferences.reload()}
                  >
                    Retry loading
                  </button>
                )}
              </div>
            )}
            <div className="keybindings-status" role="status">
              {!preferences.ready
                ? "Loading shortcuts…"
                : recording
                  ? "Press a shortcut, or Escape to cancel."
                  : status}
            </div>
            {(["Terminals", "Tabs", "Workspace"] as const).map((group) => (
              <section
                className="keybindings-group"
                key={group}
                aria-label={group}
              >
                <h2>{group}</h2>
                {actions
                  .filter((action) => action.group === group)
                  .map((action) => (
                    <div className="keybinding-row" key={action.id}>
                      <div className="keybinding-label">
                        <span>{action.label}</span>
                        <small>{action.description}</small>
                      </div>
                      <div className="keybinding-controls">
                        <button
                          ref={
                            recording === action.id
                              ? recordingButton
                              : undefined
                          }
                          className={`shortcut-recorder${recording === action.id ? " recording" : ""}`}
                          aria-label={`Shortcut for ${action.label}`}
                          disabled={
                            !preferences.ready || busy || !!preferences.error
                          }
                          onClick={() => {
                            setRecording(action.id);
                            setError("");
                            setStatus("");
                          }}
                          onBlur={() => {
                            if (recording === action.id) setRecording(null);
                          }}
                          onKeyDown={(event) => {
                            if (recording !== action.id) return;
                            event.preventDefault();
                            event.stopPropagation();
                            if (
                              event.key === "Escape" &&
                              !event.ctrlKey &&
                              !event.altKey &&
                              !event.metaKey &&
                              !event.shiftKey
                            ) {
                              setRecording(null);
                              setError("");
                              return;
                            }
                            if (
                              event.repeat ||
                              ["Control", "Shift", "Alt", "Meta"].includes(
                                event.key,
                              )
                            )
                              return;
                            const shortcut = shortcutFromEvent(
                              event.nativeEvent,
                            );
                            if (!shortcut) {
                              setError(
                                "Use Ctrl, Alt, or Cmd with a key, or use a function key.",
                              );
                              return;
                            }
                            assign(action.id, shortcut);
                          }}
                        >
                          <kbd>
                            {recording === action.id
                              ? "Press keys…"
                              : formatShortcut(preferences.bindings[action.id])}
                          </kbd>
                        </button>
                        <IconButton
                          title={`Clear shortcut for ${action.label}`}
                          disabled={
                            !preferences.ready ||
                            busy ||
                            !!preferences.error ||
                            !preferences.bindings[action.id]
                          }
                          onClick={() => assign(action.id, null)}
                        >
                          <X size={14} />
                        </IconButton>
                        <IconButton
                          title={`Reset shortcut for ${action.label}`}
                          disabled={
                            !preferences.ready ||
                            busy ||
                            !!preferences.error ||
                            preferences.bindings[action.id] ===
                              preferences.defaults[action.id]
                          }
                          onClick={() =>
                            assign(action.id, preferences.defaults[action.id])
                          }
                        >
                          <RotateCcw size={14} />
                        </IconButton>
                      </div>
                    </div>
                  ))}
              </section>
            ))}
          </main>
        )}
      </div>
    </div>
  );
}
