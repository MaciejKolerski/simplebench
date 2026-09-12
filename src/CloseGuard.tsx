import { useCallback, useId, useRef, useState } from "react";
import { useEditorCloseGuard } from "./EditorCloseGuard";
import { terminalsWithProcesses } from "./terminal-runtime";
import { errorMessage } from "./api";
import { Modal } from "./ui";

export function useCloseGuard() {
  const editor = useEditorCloseGuard();
  const checking = useRef(false);
  const resolve = useRef<(close: boolean) => void>(undefined);
  const [message, setMessage] = useState("");
  const descriptionId = useId();
  const confirmButton = useRef<HTMLButtonElement>(null);
  const confirm = useCallback(
    async (fileIds?: ReadonlySet<string>, terminalIds?: readonly string[]) => {
      if (checking.current) return false;
      checking.current = true;
      try {
        let message = "";
        try {
          const count = await terminalsWithProcesses(terminalIds);
          if (count)
            message = `${count === 1 ? "This terminal has" : `${count} terminals have`} running processes. Closing will end these terminal sessions and may interrupt their work. Close anyway?`;
        } catch (error) {
          message = `${errorMessage(error)} Closing may interrupt running work. Close anyway?`;
        }
        if (message) {
          const approved = await new Promise<boolean>((finish) => {
            resolve.current = finish;
            setMessage(message);
          });
          if (!approved) return false;
        }
        return await editor.confirm(fileIds);
      } finally {
        checking.current = false;
      }
    },
    [editor.confirm],
  );
  const finish = (close: boolean) => {
    resolve.current?.(close);
    resolve.current = undefined;
    setMessage("");
  };
  return {
    confirm,
    dialog: (
      <>
        {message && (
          <Modal
            title="Close running processes?"
            descriptionId={descriptionId}
            initialFocus={confirmButton}
            onClose={() => finish(false)}
          >
            <div className="dialog-form">
              <p id={descriptionId}>{message}</p>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => finish(false)}
                >
                  Cancel
                </button>
                <button
                  ref={confirmButton}
                  type="button"
                  className="button button-primary"
                  onClick={() => finish(true)}
                >
                  Close anyway
                </button>
              </div>
            </div>
          </Modal>
        )}
        {editor.dialog}
      </>
    ),
  };
}
