import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, errorMessage, native } from "./api";
import { useThemes } from "./ThemeProvider";
import { prepareTheme } from "./theme-runtime";
import { parseTheme } from "./themes";
import type { ThemeManifest } from "./themes";
import Select from "./Select";
import { Modal } from "./ui";
import defaults from "../themes/default-tokens.json";

export default function ThemeEditor({
  id,
  initial,
  onClose,
  onSaved,
}: {
  id: string;
  initial: ThemeManifest;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const themes = useThemes();
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [json, setJson] = useState<string | null>(null);
  const [JsonEditor, setJsonEditor] =
    useState<typeof import("./ThemeJsonEditor").default>();
  const [editorAttempt, setEditorAttempt] = useState(0);
  const [search, setSearch] = useState("");
  const [overridesOnly, setOverridesOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [discard, setDiscard] = useState(false);
  const working = useRef(false);
  const jsonVisible = json !== null;
  useEffect(() => {
    if (!jsonVisible || JsonEditor) return;
    let active = true;
    setError("");
    void import("./ThemeJsonEditor")
      .then((module) => {
        if (active) setJsonEditor(() => module.default);
      })
      .catch((error) => {
        if (active) setError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [jsonVisible, JsonEditor, editorAttempt]);
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(saved) ||
    (json !== null && json !== JSON.stringify(draft, null, 2));
  const closeState = useRef({ dirty, busy });
  closeState.current = { dirty, busy };
  const requestClose = () => {
    if (working.current) return;
    if (dirty) setDiscard(true);
    else onClose();
  };
  useEffect(() => {
    if (!native) return;
    const unlisten = getCurrentWindow().onCloseRequested((event) => {
      if (!closeState.current.dirty && !closeState.current.busy) return;
      event.preventDefault();
      if (!closeState.current.busy) setDiscard(true);
    });
    void unlisten.catch((error) => setError(errorMessage(error)));
    return () => {
      void unlisten.then((stop) => stop()).catch(() => {});
    };
  }, []);
  const save = async () => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const manifest = parseTheme(json === null ? draft : JSON.parse(json));
      // Load every declared resource before replacing a working theme on disk.
      const prepared = await prepareTheme({ id, manifest }, themes.preferences);
      prepared.dispose();
      await api("save_theme_manifest", { id, expected: saved, data: manifest });
      setSaved(manifest);
      setDraft(manifest);
      if (json !== null) setJson(JSON.stringify(manifest, null, 2));
      await onSaved();
      await themes.reload();
      setStatus(
        themes.preferences.active === id
          ? "Theme saved and applied to all windows."
          : "Theme saved. Select it in the library to use it.",
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const tokens = { ...defaults, ...draft.tokens };
  return (
    <Modal
      title={`Edit theme: ${saved.name}`}
      wide
      className={`theme-editor${jsonVisible ? " theme-editor-json" : ""}`}
      onClose={requestClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy} className="theme-editor-fields">
          <div className="theme-editor-toolbar">
            <p className="settings-help">
              Save updates this theme’s JSON. Empty token fields inherit
              defaults. CSS files can override these values.
            </p>
            <button
              type="button"
              className="button"
              onClick={() => {
                setError("");
                if (json === null) setJson(JSON.stringify(draft, null, 2));
                else {
                  try {
                    setDraft(parseTheme(JSON.parse(json)));
                    setJson(null);
                  } catch (error) {
                    setError(errorMessage(error));
                  }
                }
              }}
            >
              {json === null ? "Edit JSON" : "Show controls"}
            </button>
          </div>
          {JsonEditor && (
            <JsonEditor
              value={json}
              disabled={busy}
              onChange={setJson}
              onSave={() => void save()}
              onError={setError}
            />
          )}
          {jsonVisible && !JsonEditor && (
            <div className="empty-message" role="status">
              {error ? (
                <button
                  type="button"
                  className="button"
                  onClick={() => setEditorAttempt((value) => value + 1)}
                >
                  Try again
                </button>
              ) : (
                "Opening JSON editor…"
              )}
            </div>
          )}
          {!jsonVisible && (
            <>
              <label className="theme-token-row">
                <span>Name</span>
                <input
                  required
                  maxLength={160}
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                />
              </label>
              <div className="theme-layout-controls">
                {(
                  [
                    [
                      "tabs",
                      "Tab placement",
                      ["inline", "above", "below"],
                      "inline",
                    ],
                    [
                      "statusbar",
                      "Status bar placement",
                      ["top", "bottom"],
                      "bottom",
                    ],
                    [
                      "settingsNavigation",
                      "Settings navigation",
                      ["left", "right", "top", "bottom"],
                      "left",
                    ],
                  ] as const
                ).map(([key, label, values, fallback]) => (
                  <label key={key}>
                    {label}
                    <Select
                      aria-label={label}
                      value={draft.layout?.[key] ?? fallback}
                      onChange={(value) =>
                        setDraft({
                          ...draft,
                          layout: { ...draft.layout, [key]: value },
                        })
                      }
                      options={values.map((value) => ({
                        value,
                        label: value[0].toUpperCase() + value.slice(1),
                      }))}
                    />
                  </label>
                ))}
              </div>
              <div className="theme-token-filter">
                <input
                  type="search"
                  aria-label="Search theme tokens"
                  placeholder="Search spacing, radius, border, font, color…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <label>
                  <input
                    type="checkbox"
                    checked={overridesOnly}
                    onChange={(event) => setOverridesOnly(event.target.checked)}
                  />{" "}
                  Overrides only
                </label>
              </div>
              <div className="theme-token-list">
                {Object.entries(tokens)
                  .filter(
                    ([name]) =>
                      (!overridesOnly || draft.tokens?.[name] !== undefined) &&
                      name.includes(
                        search.toLowerCase().trim().replaceAll(" ", "-"),
                      ),
                  )
                  .map(([name, fallback]) => (
                    <label key={name} className="theme-token-row">
                      <code>{name}</code>
                      <input
                        aria-label={name}
                        spellCheck={false}
                        value={draft.tokens?.[name] ?? ""}
                        placeholder={fallback}
                        onChange={(event) => {
                          const tokens = { ...draft.tokens };
                          if (event.target.value)
                            tokens[name] = event.target.value;
                          else delete tokens[name];
                          setDraft({ ...draft, tokens });
                        }}
                      />
                    </label>
                  ))}
              </div>
            </>
          )}
        </fieldset>
        <footer className="theme-editor-footer">
          {error && (
            <p className="text-error" role="alert">
              {error}
            </p>
          )}
          {status && <p role="status">{status}</p>}
          <div className="dialog-actions">
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={requestClose}
            >
              Close
            </button>
            <button
              type="submit"
              className="button button-primary"
              disabled={busy || !dirty}
            >
              {busy ? "Saving…" : "Save theme"}
            </button>
          </div>
        </footer>
      </form>
      {discard && (
        <Modal title="Discard theme changes?" onClose={() => setDiscard(false)}>
          <div className="dialog-form">
            <p>Your unsaved theme changes will be lost.</p>
            <div className="dialog-actions">
              <button
                type="button"
                className="button"
                onClick={() => setDiscard(false)}
              >
                Keep editing
              </button>
              <button type="button" className="button" onClick={onClose}>
                Discard changes
              </button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
