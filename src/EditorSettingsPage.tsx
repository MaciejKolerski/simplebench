import { useRef, useState } from "react";
import { RotateCcw } from "./icons";
import { errorMessage } from "./api";
import { useEditorPreferences } from "./EditorPreferencesProvider";
import Select from "./Select";
import { defaultEditorPreferences } from "./editor-preferences";
import type { EditorPreferences } from "./editor-preferences";

export default function EditorSettingsPage() {
  const preferences = useEditorPreferences();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const saving = useRef(false);
  const persist = async (value: EditorPreferences) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    setStatus("Saving…");
    try {
      await preferences.save(value);
      setStatus("Saved");
    } catch (error) {
      setError(errorMessage(error));
      setStatus("");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const disabled = !preferences.ready || busy || !!preferences.error;
  const { tabSize, insertSpaces } = preferences.value;
  return (
    <main className="editor-settings-page">
      <header className="settings-page-heading">
        <div>
          <h1>Editor</h1>
          <p>Choose how Tab indents your code and text.</p>
        </div>
        <button
          className="button"
          disabled={!preferences.ready || busy}
          onClick={() => void persist(defaultEditorPreferences)}
        >
          <RotateCcw size={14} />
          Reset defaults
        </button>
      </header>
      <p className="settings-help">
        Defaults save automatically and apply to files without an override. Use
        the editor status bar to change indentation for the current file.
        Existing text keeps its indentation until you edit it.
      </p>
      {(error || preferences.error) && (
        <div className="keybindings-error" role="alert">
          <span>{preferences.error || error}</span>
          {preferences.error && (
            <button
              className="text-button"
              onClick={() => {
                setError("");
                void preferences.reload();
              }}
            >
              Retry loading
            </button>
          )}
        </div>
      )}
      <div className="keybindings-status" role="status">
        {!preferences.ready ? "Loading editor settings…" : status}
      </div>
      <div className="editor-setting-row">
        <label htmlFor="editor-tab-size" className="keybinding-label">
          Tab size
          <small>
            Number of spaces per indentation level and width of a tab character.
          </small>
        </label>
        <Select
          id="editor-tab-size"
          value={String(tabSize)}
          disabled={disabled}
          onChange={(value) =>
            void persist({
              ...preferences.value,
              tabSize: Number(value),
            })
          }
          options={Array.from({ length: 16 }, (_, index) => ({
            value: String(index + 1),
            label: `${index + 1} ${index === 0 ? "space" : "spaces"}`,
          }))}
        />
      </div>
      <div className="editor-setting-row">
        <label htmlFor="editor-indent-style" className="keybinding-label">
          Indent using
          <small>Choose which characters Tab inserts into the file.</small>
        </label>
        <Select
          id="editor-indent-style"
          value={insertSpaces ? "spaces" : "tabs"}
          disabled={disabled}
          onChange={(value) =>
            void persist({
              ...preferences.value,
              insertSpaces: value === "spaces",
            })
          }
          options={[
            { value: "spaces", label: "Spaces" },
            { value: "tabs", label: "Tab characters" },
          ]}
        />
      </div>
      <p className="settings-help editor-indentation-help">
        {insertSpaces
          ? `Tab inserts ${tabSize} ${tabSize === 1 ? "space" : "spaces"} at the cursor.`
          : `Tab inserts one tab character, displayed at ${tabSize}-column tab stops.`}{" "}
        Select lines and press Tab to indent them, or Shift+Tab to remove one
        indentation level. Enter uses the same indentation settings for code.
      </p>
    </main>
  );
}
