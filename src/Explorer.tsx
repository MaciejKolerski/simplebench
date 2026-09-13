import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  Copy,
  Eye,
  EyeOff,
  File,
  Folder,
  FolderOpen,
  RefreshCw,
  Search,
  Terminal,
} from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { api, errorMessage } from "./api";
import type { FileEntry, GitCommitSummary, GitStatus } from "./api";
import { basename } from "./model";
import { beginFileDrag } from "./file-drag";
import { IconButton } from "./ui";

import ProjectSearch from "./ProjectSearch";
import type { SearchMatch } from "./ProjectSearch";
import type { FileOperation } from "./explorer-model";
import { explorerGitStatuses, gitFilePath } from "./explorer-model";
import { useExplorerActions } from "./ExplorerActions";

interface Props {
  root: string;
  onTerminal: (path: string) => void;
  onOpenFile: (relative: string, match?: SearchMatch) => void;
  gitStatus: GitStatus | null;
  onRefreshGit: () => void;
  onOpenCommit: (commit: GitCommitSummary) => void;
  onOperation: (relative: string, operation: FileOperation) => Promise<boolean>;
  onError: (message: string) => void;
}

export default function Explorer(props: Props) {
  const gitStatuses = useMemo(
    () => explorerGitStatuses(props.gitStatus),
    [props.gitStatus],
  );
  const gitRevision = JSON.stringify(props.gitStatus?.changes);
  const [revision, setRevision] = useState(0);
  const [searchScope, setSearchScope] = useState<string>();
  const [searchOpen, setSearchOpen] = useState(false);
  const search = (relative: string) => {
    setSearchScope(relative);
    setSearchOpen(true);
  };
  const refresh = () => {
    setRevision((revision) => revision + 1);
    props.onRefreshGit();
  };
  const actions = useExplorerActions({
    ...props,
    repositoryRoot: props.gitStatus?.root,
    onSearch: search,
    onRefresh: refresh,
    onExpand: (relative) =>
      setExpanded((previous) => new Set(previous).add(relative)),
  });
  const rootEntry: FileEntry = {
    name: basename(props.root),
    relativePath: "",
    path: props.root,
    isDirectory: true,
    isSymlink: false,
  };
  const [showHidden, setShowHidden] = useState(true);
  const [expanded, setExpanded] = useState(new Set<string>());
  const toggle = (path: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  return (
    <>
      {searchScope !== undefined && (
        <ProjectSearch
          root={props.root}
          relative={searchScope}
          hidden={!searchOpen}
          onClose={() => setSearchOpen(false)}
          onScope={setSearchScope}
          onOpenFile={props.onOpenFile}
        />
      )}
      {!searchOpen && (
        <div className="sidebar-panel explorer-panel" aria-busy={actions.busy}>
          <header className="sidebar-heading">
            <span>EXPLORER</span>
            <div>
              <IconButton title="Search in project" onClick={() => search("")}>
                <Search size={14} />
              </IconButton>
              <IconButton
                title={showHidden ? "Hide dotfiles" : "Show dotfiles"}
                onClick={() => setShowHidden(!showHidden)}
              >
                {showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
              </IconButton>
              <IconButton
                title="Collapse folders"
                onClick={() => setExpanded(new Set())}
              >
                <ChevronsDownUp size={14} />
              </IconButton>
              <IconButton title="Refresh explorer" onClick={refresh}>
                <RefreshCw size={14} />
              </IconButton>
            </div>
          </header>
          <div
            className="project-tree-heading"
            data-git-status={gitStatuses.get(gitFilePath(props.root))}
            tabIndex={0}
            role="button"
            aria-label={`Project folder ${rootEntry.name}`}
            onContextMenu={(event) => actions.onContext(event, rootEntry)}
            onKeyDown={(event) => actions.onKey(event, rootEntry)}
          >
            <FolderOpen size={14} />
            <span title={props.root}>{basename(props.root)}</span>
            <IconButton
              title="Open terminal in project folder"
              onClick={() => props.onTerminal(props.root)}
            >
              <Terminal size={14} />
            </IconButton>
          </div>
          <div
            className="file-tree"
            aria-label="Project files"
            onContextMenu={(event) => actions.onContext(event, rootEntry, true)}
          >
            <Directory
              {...props}
              relative=""
              depth={0}
              revision={revision}
              gitStatuses={gitStatuses}
              gitRevision={gitRevision}
              showHidden={showHidden}
              expanded={expanded}
              toggle={toggle}
              onContext={actions.onContext}
              onKey={actions.onKey}
              creation={actions.creation}
            />
          </div>
          {actions.menu}
          {actions.dialog}
          {actions.historyDialog}
        </div>
      )}
    </>
  );
}

interface DirectoryProps extends Props {
  gitStatuses: Map<string, string>;
  gitRevision: string | undefined;
  onContext: ReturnType<typeof useExplorerActions>["onContext"];
  onKey: ReturnType<typeof useExplorerActions>["onKey"];
  creation: ReturnType<typeof useExplorerActions>["creation"];
  relative: string;
  depth: number;
  revision: number;
  showHidden: boolean;
  expanded: Set<string>;
  toggle: (path: string) => void;
}
function Directory(props: DirectoryProps) {
  const {
    root,
    relative,
    depth,
    revision,
    gitRevision,
    showHidden,
    expanded,
    toggle,
    onTerminal,
    onOpenFile,
    onError,
  } = props;
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    void api<FileEntry[]>("list_directory", { root, relative })
      .then((entries) => {
        if (current) setEntries(entries);
      })
      .catch((error) => {
        if (current) setError(errorMessage(error));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [root, relative, revision, gitRevision]);
  const creation =
    props.creation?.relative === relative ? props.creation : undefined;
  const visible = error
    ? []
    : entries.filter((entry) => showHidden || !entry.name.startsWith("."));
  const message =
    error ||
    (loading && !entries.length
      ? "Loading…"
      : !visible.length && !creation
        ? "Empty folder"
        : "");
  return (
    <>
      {creation && (
        <div
          style={{
            paddingLeft: `calc(${depth} * var(--tree-indent) + var(--space-10))`,
          }}
        >
          {creation.node}
        </div>
      )}
      {message && (
        <div
          className={`tree-message${error ? " text-error" : ""}`}
          title={error || undefined}
          style={{
            paddingLeft: `calc(${depth} * var(--tree-indent) + var(--space-16))`,
          }}
        >
          {message}
        </div>
      )}
      {visible.map((entry) => {
        const open = expanded.has(entry.relativePath);
        return (
          <div key={entry.relativePath}>
            <div
              className="tree-row"
              onContextMenu={(event) => props.onContext(event, entry)}
              onKeyDown={(event) => props.onKey(event, entry)}
              style={{
                paddingLeft: `calc(${depth} * var(--tree-indent) + var(--space-10))`,
              }}
              onPointerDown={(event) =>
                beginFileDrag(event, entry.path, onError)
              }
            >
              <button
                className="tree-entry"
                data-git-status={props.gitStatuses.get(gitFilePath(entry.path))}
                title={entry.path}
                aria-expanded={entry.isDirectory ? open : undefined}
                onClick={() =>
                  entry.isDirectory
                    ? toggle(entry.relativePath)
                    : onOpenFile(entry.relativePath)
                }
              >
                {entry.isDirectory ? (
                  open ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )
                ) : (
                  <span className="tree-indent" />
                )}
                {entry.isDirectory ? (
                  open ? (
                    <FolderOpen size={14} />
                  ) : (
                    <Folder size={14} />
                  )
                ) : (
                  <File size={14} />
                )}
                <span className={entry.name.startsWith(".") ? "dotfile" : ""}>
                  {entry.name}
                </span>
                {entry.isSymlink && <span className="symlink-mark">↗</span>}
              </button>
              {entry.isDirectory ? (
                <button
                  className="tree-action"
                  title="Open terminal here"
                  aria-label={`Open terminal in ${entry.name}`}
                  onClick={() => onTerminal(entry.path)}
                >
                  <Terminal size={13} />
                </button>
              ) : (
                <button
                  className="tree-action"
                  title="Copy file path"
                  aria-label={`Copy path of ${entry.name}`}
                  onClick={() =>
                    void writeText(entry.path).catch((error) =>
                      onError(errorMessage(error)),
                    )
                  }
                >
                  <Copy size={12} />
                </button>
              )}
            </div>
            {entry.isDirectory && open && (
              <Directory
                {...props}
                relative={entry.relativePath}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
