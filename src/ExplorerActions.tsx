import { useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { api, errorMessage } from "./api";
import type { FileEntry, GitCommitSummary } from "./api";
import { normalizePath, parentPath } from "./explorer-model";
import type { FileOperation } from "./explorer-model";
import ContextMenu from "./ContextMenu";
import { Modal } from "./ui";
import GitHistory from "./GitHistory";

let clipboard: { root: string; relative: string; cut: boolean } | undefined;

interface Props {
  root: string;
  repositoryRoot?: string;
  onTerminal: (path: string) => void;
  onSearch: (relative: string) => void;
  onOpenFile: (relative: string) => void;
  onOpenCommit: (commit: GitCommitSummary) => void;
  onOperation: (relative: string, operation: FileOperation) => Promise<boolean>;
  onRefresh: () => void;
  onError: (message: string) => void;
}

export function useExplorerActions(props: Props) {
  const [context, setContext] = useState<{
    entry: FileEntry;
    x: number;
    y: number;
  }>();
  const [prompt, setPrompt] = useState<{
    entry: FileEntry;
    kind: "rename" | "newFile" | "newFolder" | "trash" | "delete";
  }>();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<FileEntry>();
  const trigger = useRef<HTMLElement>(null);
  const parent = (entry: FileEntry) =>
    entry.isDirectory ? entry.relativePath : parentPath(entry.relativePath);
  const dismiss = () => {
    setContext(undefined);
    if (trigger.current?.isConnected)
      trigger.current.focus({ preventScroll: true });
  };
  const open = (
    entry: FileEntry,
    element: HTMLElement,
    x?: number,
    y?: number,
  ) => {
    trigger.current =
      element.querySelector<HTMLElement>(".tree-entry") ?? element;
    const bounds = element.getBoundingClientRect();
    setContext({ entry, x: x || bounds.left, y: y || bounds.bottom });
  };
  const onContext = (event: MouseEvent<HTMLElement>, entry: FileEntry) => {
    event.preventDefault();
    event.stopPropagation();
    if (!busy) open(entry, event.currentTarget, event.clientX, event.clientY);
  };
  const ask = (entry: FileEntry, kind: NonNullable<typeof prompt>["kind"]) => {
    setError("");
    setValue(kind === "rename" ? entry.name : "");
    setPrompt({ entry, kind });
  };
  const run = (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    void action()
      .catch((error) => props.onError(errorMessage(error)))
      .finally(() => setBusy(false));
  };
  const operate = async (relative: string, operation: FileOperation) => {
    if (await props.onOperation(relative, operation)) {
      props.onRefresh();
      return true;
    }
    return false;
  };
  const paste = (entry: FileEntry) => {
    if (!clipboard) return;
    const source = clipboard;
    run(async () => {
      if (
        (await operate(parent(entry), {
          kind: source.cut ? "move" : "copy",
          sourceRoot: source.root,
          source: source.relative,
        })) &&
        source.cut &&
        clipboard === source
      )
        clipboard = undefined;
    });
  };
  const copy = (entry: FileEntry, cut: boolean) => {
    if (entry.relativePath)
      clipboard = { root: props.root, relative: entry.relativePath, cut };
  };
  const reveal = (entry: FileEntry, reveal: boolean) =>
    run(() =>
      api("open_project_item", {
        root: props.root,
        relative: entry.relativePath,
        reveal,
      }),
    );
  const ignore = (entry: FileEntry, local: boolean) =>
    run(async () => {
      await api("ignore_project_item", {
        root: props.root,
        relative: entry.relativePath,
        local,
      });
      props.onRefresh();
    });
  const onKey = (event: KeyboardEvent<HTMLElement>, entry: FileEntry) => {
    if (busy || event.target instanceof HTMLInputElement) return;
    const mod = event.ctrlKey || event.metaKey;
    if (
      event.key === "ContextMenu" ||
      (event.shiftKey && event.key === "F10")
    ) {
      event.preventDefault();
      event.stopPropagation();
      open(entry, event.currentTarget);
      return;
    }
    let action: (() => void) | undefined;
    if (event.key === "F2" && !mod) action = () => ask(entry, "rename");
    if (event.key === "Delete")
      action = () => ask(entry, mod ? "delete" : "trash");
    if (mod && !event.altKey && !event.shiftKey) {
      if (event.key.toLowerCase() === "x") action = () => copy(entry, true);
      if (event.key.toLowerCase() === "c") action = () => copy(entry, false);
      if (event.key.toLowerCase() === "v") action = () => paste(entry);
    }
    if (action) {
      event.preventDefault();
      event.stopPropagation();
      action();
    }
  };
  const entry = context?.entry;
  const menu = context && entry && (
    <ContextMenu
      {...context}
      label={`${entry.name} actions`}
      onClose={dismiss}
      actions={[
        { label: "New File", run: () => ask(entry, "newFile") },
        { label: "New Folder", run: () => ask(entry, "newFolder") },
        null,
        ...(entry.isDirectory
          ? [
              {
                label: "Search in Folder…",
                run: () => props.onSearch(entry.relativePath),
              },
            ]
          : []),
        { label: "Reveal in File Manager", run: () => reveal(entry, true) },
        { label: "Open in Default App", run: () => reveal(entry, false) },
        {
          label: "Open in Terminal",
          run: () =>
            props.onTerminal(
              entry.isDirectory ? entry.path : parentPath(entry.path),
            ),
        },
        null,
        {
          label: "Cut",
          shortcut: "Ctrl+X",
          disabled: !entry.relativePath,
          run: () => copy(entry, true),
        },
        {
          label: "Copy",
          shortcut: "Ctrl+C",
          disabled: !entry.relativePath,
          run: () => copy(entry, false),
        },
        {
          label: "Duplicate",
          disabled: !entry.relativePath,
          run: () =>
            run(() => operate(entry.relativePath, { kind: "duplicate" })),
        },
        {
          label: "Paste",
          shortcut: "Ctrl+V",
          disabled: !clipboard,
          run: () => paste(entry),
        },
        null,
        { label: "Copy Path", run: () => run(() => writeText(entry.path)) },
        {
          label: "Copy Relative Path",
          run: () => run(() => writeText(entry.relativePath || ".")),
        },
        null,
        {
          label: "Add to .gitignore",
          disabled: !props.repositoryRoot || !entry.relativePath,
          run: () => ignore(entry, false),
        },
        {
          label: "Add to .git/info/exclude",
          disabled: !props.repositoryRoot || !entry.relativePath,
          run: () => ignore(entry, true),
        },
        {
          label: "View History",
          disabled: !props.repositoryRoot,
          run: () => setHistory(entry),
        },
        null,
        { label: "Rename…", shortcut: "F2", run: () => ask(entry, "rename") },
        {
          label: "Move to Trash…",
          shortcut: "Delete",
          run: () => ask(entry, "trash"),
        },
        {
          label: "Delete Permanently…",
          shortcut: "Ctrl+Delete",
          danger: true,
          run: () => ask(entry, "delete"),
        },
      ]}
    />
  );
  const deleting = prompt?.kind === "delete" || prompt?.kind === "trash";
  const title =
    prompt?.kind === "rename"
      ? "Rename"
      : prompt?.kind === "newFile"
        ? "New File"
        : prompt?.kind === "newFolder"
          ? "New Folder"
          : prompt?.kind === "trash"
            ? "Move to Trash"
            : "Delete Permanently";
  const dialog = prompt && (
    <Modal
      title={title}
      onClose={() => {
        if (!busy) setPrompt(undefined);
      }}
    >
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          const { entry, kind } = prompt;
          const relative =
            kind === "newFile" || kind === "newFolder"
              ? parent(entry)
              : entry.relativePath;
          void operate(
            relative,
            kind === "trash" || kind === "delete"
              ? { kind }
              : { kind, name: value },
          )
            .then((completed) => {
              if (completed) {
                setPrompt(undefined);
                if (kind === "newFile")
                  props.onOpenFile([relative, value].filter(Boolean).join("/"));
              }
            })
            .catch((error) => setError(errorMessage(error)))
            .finally(() => setBusy(false));
        }}
      >
        <div className="dialog-body">
          {deleting ? (
            <p>
              {prompt.kind === "trash" ? "Move" : "Permanently delete"}{" "}
              <strong>{prompt.entry.name}</strong>
              {prompt.entry.isDirectory ? " and all its contents" : ""}?{" "}
              {prompt.kind === "delete" && "This cannot be undone."}
              {!prompt.entry.relativePath &&
                " This also closes the project and its terminals."}
            </p>
          ) : (
            <label>
              Name
              <input
                aria-label="Name"
                autoFocus
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onFocus={(event) => event.target.select()}
                disabled={busy}
                required
              />
            </label>
          )}
          {error && (
            <p className="text-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-actions">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => setPrompt(undefined)}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={`button ${deleting ? "text-error" : "button-primary"}`}
            disabled={busy || (!deleting && !value)}
          >
            {busy ? "Working…" : title}
          </button>
        </div>
      </form>
    </Modal>
  );
  const historyDialog = history && props.repositoryRoot && (
    <Modal
      title={`Git History · ${history.name}`}
      wide
      className="file-history-dialog"
      onClose={() => setHistory(undefined)}
    >
      <GitHistory
        key={history.path}
        root={props.repositoryRoot}
        path={normalizePath(history.path)
          .slice(normalizePath(props.repositoryRoot).length)
          .replace(/^\//, "")}
        onOpenCommit={(commit) => {
          setHistory(undefined);
          props.onOpenCommit(commit);
        }}
      />
    </Modal>
  );
  return { onContext, onKey, menu, dialog, historyDialog, busy };
}
