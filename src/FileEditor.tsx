import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { FileCode, Redo2, RotateCcw, Save, Search, Undo2 } from "lucide-react";
import type { EditorPosition, FileTab } from "./model";
import { errorMessage } from "./api";
import { openEditorDocument } from "./editor-service";
import type { EditorDocument } from "./editor-runtime";
import { useKeybindings } from "./KeybindingsProvider";
import { useEditorPreferences } from "./EditorPreferencesProvider";
import { shortcutTitle } from "./keybindings";
import { IconButton, Modal } from "./ui";

interface Props {
  tab: FileTab;
  onPosition: (position: EditorPosition) => void;
}

export default function FileEditor(props: Props) {
  const { ready } = useEditorPreferences();
  const [document, setDocument] = useState<EditorDocument>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!ready) return;
    let current = true;
    setError("");
    void openEditorDocument(props.tab)
      .then((document) => {
        if (current) setDocument(document);
      })
      .catch((error) => {
        if (current) setError(errorMessage(error));
      });
    return () => {
      current = false;
    };
  }, [props.tab.id, attempt, ready]);
  if (!document)
    return (
      <div className="empty-message editor-loading" role="status">
        <FileCode size={25} />
        <strong>{props.tab.title}</strong>
        <p>{error || "Opening file…"}</p>
        {error && (
          <button
            className="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try again
          </button>
        )}
      </div>
    );
  return <DocumentEditor {...props} document={document} />;
}

function DocumentEditor({
  tab,
  document,
  onPosition,
}: Props & { document: EditorDocument }) {
  const status = useSyncExternalStore(document.subscribe, document.getSnapshot);
  const { bindings } = useKeybindings();
  const host = useRef<HTMLDivElement>(null);
  const positionCallback = useRef(onPosition);
  positionCallback.current = onPosition;
  const [confirmation, setConfirmation] = useState<
    "reload" | "overwrite" | null
  >(null);
  const [busy, setBusy] = useState(false);
  useLayoutEffect(() => {
    document.attach(host.current!, tab);
    return () => {
      const position = document.position();
      document.detach();
      positionCallback.current(position);
    };
  }, [document, tab.id]);
  const save = () =>
    void document
      .save()
      .catch((error) => document.reportError(errorMessage(error)));
  const confirm = async () => {
    setBusy(true);
    try {
      if (confirmation === "reload") await document.reload();
      else await document.save(true);
      setConfirmation(null);
    } catch (error) {
      document.reportError(errorMessage(error));
      setConfirmation(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="file-editor" aria-label={`Editor for ${tab.title}`}>
      <header className="editor-heading">
        <FileCode size={15} />
        <span className="editor-path" title={document.path}>
          {tab.relative}
        </span>
        <div className="editor-actions">
          <IconButton
            title="Undo"
            disabled={status.readOnly}
            onClick={() => document.command("undo")}
          >
            <Undo2 size={15} />
          </IconButton>
          <IconButton
            title="Redo"
            disabled={status.readOnly}
            onClick={() => document.command("redo")}
          >
            <Redo2 size={15} />
          </IconButton>
          <IconButton
            title={shortcutTitle("Find in file", bindings.findFile)}
            onClick={() => document.command("findFile")}
          >
            <Search size={15} />
          </IconButton>
          <IconButton
            title="Reload from disk"
            disabled={status.saving}
            onClick={() => setConfirmation("reload")}
          >
            <RotateCcw size={15} />
          </IconButton>
          <button
            className="button editor-save"
            title={shortcutTitle("Save file", bindings.saveFile)}
            disabled={
              status.readOnly ||
              status.saving ||
              !status.dirty ||
              status.conflict
            }
            onClick={save}
          >
            <Save size={14} />
            {status.saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>
      {status.conflict && (
        <div className="editor-notice" role="alert">
          <span>This file changed on disk. Your edits are preserved.</span>
          <button
            className="text-button"
            onClick={() => setConfirmation("reload")}
          >
            Reload from disk…
          </button>
          <button
            className="text-button"
            disabled={status.saving || status.readOnly}
            onClick={() => setConfirmation("overwrite")}
          >
            Overwrite disk version…
          </button>
        </div>
      )}
      {status.error && (
        <div className="editor-notice text-error" role="alert">
          {status.error}
        </div>
      )}
      <div className="editor-host" ref={host} />
      {confirmation && (
        <Modal
          title={
            confirmation === "reload"
              ? "Reload file from disk?"
              : "Overwrite disk version?"
          }
          onClose={() => {
            if (!busy) setConfirmation(null);
          }}
        >
          <p>
            {confirmation === "reload"
              ? "Reloading replaces the editor contents and clears its undo history. Any unsaved edits to this file will be discarded."
              : "Saving replaces the version currently on disk with your editor contents. Changes made by another program will be replaced."}
          </p>
          <p className="editor-confirm-path">{document.path}</p>
          <div className="dialog-actions">
            <button
              className="button"
              autoFocus
              disabled={busy}
              onClick={() => setConfirmation(null)}
            >
              Cancel
            </button>
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy
                ? "Working…"
                : confirmation === "reload"
                  ? "Reload file"
                  : "Overwrite file"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
