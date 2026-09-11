import { useId, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileDiff,
  GitBranch,
  RefreshCw,
  SquareArrowRight,
  SquareDot,
  SquareMinus,
  SquarePlus,
} from "lucide-react";
import { api, errorMessage } from "./api";
import type { GitChange, GitCommitSummary, GitStatus } from "./api";
import GitHistory from "./GitHistory";
import { IconButton } from "./ui";

export default function SourceControl({
  status,
  loading = false,
  onRefresh,
  onDiff,
  onOpenCommit,
  onError,
}: {
  status: GitStatus | null;
  loading?: boolean;
  onRefresh: () => void;
  onDiff: (path: string, staged: boolean) => void;
  onOpenCommit: (commit: GitCommitSummary) => void;
  onError: (message: string) => void;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState<"changes" | "history">("changes");
  const [historyRevision, setHistoryRevision] = useState(0);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const groupId = useId();
  if (!status)
    return (
      <div className="sidebar-panel">
        <header className="sidebar-heading">SOURCE CONTROL</header>
        <p className="sidebar-empty" role={loading ? "status" : undefined}>
          {loading
            ? "Checking for a Git repository…"
            : "No Git repository was found in this project."}
        </p>
      </div>
    );
  const staged = status.changes.filter(
    (change) => ![" ", "?", "!"].includes(change.index),
  );
  const unstaged = status.changes.filter(
    (change) => ![" ", "!"].includes(change.worktree),
  );
  const tracked = unstaged.filter((change) => change.worktree !== "?");
  const untracked = unstaged.filter((change) => change.worktree === "?");
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
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
    <section className="git-group" aria-label={`${name} changes`}>
      <header>
        <button
          type="button"
          className="git-group-toggle"
          aria-expanded={!collapsed[name]}
          aria-controls={`${groupId}-${name}`}
          onClick={() =>
            setCollapsed((current) => ({ ...current, [name]: !current[name] }))
          }
        >
          {collapsed[name] ? (
            <ChevronRight size={12} />
          ) : (
            <ChevronDown size={12} />
          )}
          <span>{name}</span>
          <span className="git-count">{changes.length}</span>
        </button>
        <label className="git-stage-toggle">
          <input
            type="checkbox"
            aria-label={
              isStaged
                ? "Unstage staged changes"
                : `Stage ${name.toLowerCase()} changes`
            }
            title={
              isStaged
                ? "Unstage staged changes"
                : `Stage ${name.toLowerCase()} changes`
            }
            checked={isStaged}
            disabled={busy}
            onChange={() => void stage(changes, !isStaged)}
          />
        </label>
      </header>
      <ul
        className="git-file-list"
        id={`${groupId}-${name}`}
        hidden={collapsed[name]}
      >
        {changes.map((change) => {
          const separator = change.path.lastIndexOf("/");
          const filename = change.path.slice(separator + 1);
          const directory =
            separator < 0 ? "" : change.path.slice(0, separator);
          const code = isStaged ? change.index : change.worktree;
          const StatusIcon = ["A", "?"].includes(code)
            ? SquarePlus
            : code === "D"
              ? SquareMinus
              : ["R", "C"].includes(code)
                ? SquareArrowRight
                : SquareDot;
          const action = `${isStaged ? "Unstage" : "Stage"} ${change.path}`;
          return (
            <li className="git-file" key={change.path}>
              <button
                type="button"
                className="git-file-open"
                aria-label={`View ${isStaged ? "staged " : ""}diff for ${change.path}`}
                title={
                  change.originalPath
                    ? `${change.originalPath} → ${change.path}`
                    : change.path
                }
                onClick={() => onDiff(change.path, isStaged)}
              >
                <StatusIcon
                  size={13}
                  className="git-file-icon"
                  data-status={code}
                />
                <span className="git-file-label">
                  <span className="git-file-name">{filename}</span>
                  {directory && (
                    <span className="git-file-directory">{directory}</span>
                  )}
                </span>
              </button>
              <label className="git-stage-toggle" title={action}>
                <input
                  type="checkbox"
                  aria-label={action}
                  checked={isStaged}
                  disabled={busy}
                  onChange={() => void stage([change], !isStaged)}
                />
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
  return (
    <div className="sidebar-panel source-panel">
      <header className="source-heading">
        <div
          className="source-pages"
          role="tablist"
          aria-label="Source control pages"
        >
          {(["changes", "history"] as const).map((name, index) => (
            <button
              key={name}
              type="button"
              role="tab"
              id={`${groupId}-page-${name}`}
              aria-controls={`${groupId}-panel-${name}`}
              aria-selected={page === name}
              tabIndex={page === name ? 0 : -1}
              onClick={() => setPage(name)}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "changes"
                    : event.key === "End"
                      ? "history"
                      : index
                        ? "changes"
                        : "history";
                setPage(next);
                document.getElementById(`${groupId}-page-${next}`)?.focus();
              }}
            >
              {name === "changes" ? (
                <>
                  Changes{" "}
                  <span className="git-count">({status.changes.length})</span>
                </>
              ) : (
                "History"
              )}
            </button>
          ))}
        </div>
        <IconButton
          title="Refresh source control"
          disabled={busy}
          onClick={() => {
            onRefresh();
            setHistoryRevision((value) => value + 1);
          }}
        >
          <RefreshCw size={14} />
        </IconButton>
      </header>
      {page === "history" ? (
        <div
          className="source-page"
          role="tabpanel"
          id={`${groupId}-panel-history`}
          aria-labelledby={`${groupId}-page-history`}
        >
          <GitHistory
            key={`${status.root}:${historyRevision}`}
            root={status.root}
            onOpenCommit={onOpenCommit}
          />
        </div>
      ) : (
        <div
          className="source-page"
          role="tabpanel"
          id={`${groupId}-panel-changes`}
          aria-labelledby={`${groupId}-page-changes`}
        >
          <div className="git-toolbar">
            <span>
              <FileDiff size={13} /> Working tree
            </span>
            <button
              type="button"
              className="button git-stage-all"
              aria-label={
                unstaged.length || !staged.length
                  ? "Stage all changes"
                  : "Unstage all changes"
              }
              disabled={busy || !status.changes.length}
              onClick={() =>
                void stage(
                  unstaged.length ? unstaged : staged,
                  !!unstaged.length,
                )
              }
            >
              {unstaged.length || !staged.length ? "Stage All" : "Unstage All"}
            </button>
          </div>
          <div className="git-groups">
            {!!staged.length && group("Staged", staged, true)}
            {!!tracked.length && group("Tracked", tracked, false)}
            {!!untracked.length && group("Untracked", untracked, false)}
            {!status.changes.length && (
              <div className="git-clean">
                <Check size={20} />
                <p>Working tree clean.</p>
                <span>No changes to commit.</span>
              </div>
            )}
          </div>
          <div className="git-repository-bar">
            <div className="git-branch" title={status.branch}>
              <GitBranch size={13} />
              <span>{status.branch}</span>
            </div>
            <span className="git-staged-count">{staged.length} staged</span>
          </div>
          <form
            className="commit-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy || !message.trim() || !staged.length) return;
              void run(async () => {
                await api("git_commit", { root: status.root, message });
                setMessage("");
              });
            }}
          >
            <textarea
              aria-label="Commit message"
              placeholder="Enter commit message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              readOnly={busy}
              rows={5}
            />
            <div className="commit-actions">
              <button
                type="submit"
                className="button commit-button"
                aria-label="Commit staged changes"
                disabled={busy || !message.trim() || !staged.length}
              >
                <Check size={13} />
                {busy ? "Working…" : "Commit Staged"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
