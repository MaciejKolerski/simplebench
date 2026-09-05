import { useState } from "react";
import {
  Check,
  FileDiff,
  GitBranch,
  Minus,
  Plus,
  RefreshCw,
} from "lucide-react";
import { api, errorMessage } from "./api";
import type { GitChange, GitStatus } from "./api";
import { IconButton } from "./ui";

export default function SourceControl({
  status,
  onRefresh,
  onDiff,
  onError,
}: {
  status: GitStatus | null;
  onRefresh: () => void;
  onDiff: (path: string, staged: boolean) => void;
  onError: (message: string) => void;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  if (!status)
    return (
      <div className="sidebar-panel">
        <header className="sidebar-heading">SOURCE CONTROL</header>
        <p className="sidebar-empty">
          No Git repository was found in this project.
        </p>
      </div>
    );
  const staged = status.changes.filter(
    (change) => ![" ", "?", "!"].includes(change.index),
  );
  const unstaged = status.changes.filter(
    (change) => ![" ", "!"].includes(change.worktree),
  );
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      onRefresh();
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const stage = (changes: GitChange[], stage: boolean) =>
    run(() =>
      api("git_stage", {
        root: status.root,
        paths: [
          ...new Set(
            changes.flatMap((change) =>
              !stage && change.originalPath
                ? [change.path, change.originalPath]
                : [change.path],
            ),
          ),
        ],
        stage,
      }),
    );
  const group = (name: string, changes: GitChange[], isStaged: boolean) => (
    <section className="git-group">
      <header>
        <span>{name}</span>
        <span className="count-badge">{changes.length}</span>
        <IconButton
          title={isStaged ? "Unstage all changes" : "Stage all changes"}
          disabled={busy || !changes.length}
          onClick={() => void stage(changes, !isStaged)}
        >
          {isStaged ? <Minus size={14} /> : <Plus size={14} />}
        </IconButton>
      </header>
      {changes.map((change) => (
        <div className="git-file" key={change.path}>
          <button
            title={
              change.originalPath
                ? `${change.originalPath} → ${change.path}`
                : change.path
            }
            onClick={() => onDiff(change.path, isStaged)}
          >
            <FileDiff size={14} />
            <span>{change.path}</span>
            <span className="git-status-letter">
              {(isStaged ? change.index : change.worktree) === "?"
                ? "U"
                : isStaged
                  ? change.index
                  : change.worktree}
            </span>
          </button>
          <IconButton
            title={isStaged ? `Unstage ${change.path}` : `Stage ${change.path}`}
            disabled={busy}
            onClick={() => void stage([change], !isStaged)}
          >
            {isStaged ? <Minus size={14} /> : <Plus size={14} />}
          </IconButton>
        </div>
      ))}
    </section>
  );
  return (
    <div className="sidebar-panel source-panel">
      <header className="sidebar-heading">
        <span>SOURCE CONTROL</span>
        <IconButton
          title="Refresh source control"
          disabled={busy}
          onClick={onRefresh}
        >
          <RefreshCw size={14} />
        </IconButton>
      </header>
      <div className="git-branch">
        <GitBranch size={14} />
        <span>{status.branch}</span>
      </div>
      <form
        className="commit-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await api("git_commit", { root: status.root, message });
            setMessage("");
          });
        }}
      >
        <textarea
          aria-label="Commit message"
          placeholder={
            "feat(scope): describe the change\n\nExplain why.\n\nValidation:\n- Checks and results"
          }
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={5}
        />
        <button
          className="button commit-button"
          disabled={busy || !message.trim() || !staged.length}
        >
          <Check size={14} />
          {busy ? "Working…" : "Commit staged changes"}
        </button>
      </form>
      <div className="git-groups">
        {group("Staged changes", staged, true)}
        {group("Changes", unstaged, false)}
        {!status.changes.length && (
          <p className="sidebar-empty">Working tree clean.</p>
        )}
      </div>
    </div>
  );
}
