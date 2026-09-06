import { useCallback, useRef, useState } from "react";
import { closingEditorDocuments } from "./editor-service";
import type { EditorDocument } from "./editor-runtime";
import { errorMessage } from "./api";
import { Modal } from "./ui";

interface Request {
  documents: EditorDocument[];
  finish: (close: boolean) => void;
}

export function useEditorCloseGuard() {
  const [request, setRequest] = useState<Request>();
  const current = useRef<Request>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirm = useCallback((ids?: ReadonlySet<string>): Promise<boolean> => {
    if (current.current) return Promise.resolve(false);
    const documents = closingEditorDocuments(ids);
    if (!documents.length) return Promise.resolve(true);
    return new Promise((finish) => {
      const request = { documents, finish };
      current.current = request;
      setRequest(request);
      setError("");
    });
  }, []);
  const finish = (close: boolean) => {
    if (busy) return;
    current.current?.finish(close);
    current.current = undefined;
    setRequest(undefined);
  };
  const save = async () => {
    if (!request || busy) return;
    setBusy(true);
    setError("");
    try {
      for (const document of request.documents)
        if (document.dirty) await document.save();
      if (request.documents.some((document) => document.dirty))
        throw new Error("Some files still have unsaved changes.");
      request.finish(true);
      current.current = undefined;
      setRequest(undefined);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return {
    confirm,
    dialog: request && (
      <Modal title="Save changes before closing?" onClose={() => finish(false)}>
        <p>
          These files have unsaved changes. Save them, discard the changes, or
          return to the editor.
        </p>
        <ul className="editor-unsaved-files">
          {request.documents.map((document) => (
            <li key={document.path} title={document.path}>
              {document.path}
            </li>
          ))}
        </ul>
        {error && (
          <p className="text-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            className="button"
            autoFocus
            disabled={busy}
            onClick={() => finish(false)}
          >
            Cancel
          </button>
          <button
            className="button"
            disabled={busy}
            onClick={() => finish(true)}
          >
            Discard changes
          </button>
          <button
            className="button button-primary"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </Modal>
    ),
  };
}
