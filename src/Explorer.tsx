import { useEffect, useState } from "react";
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
  Terminal,
} from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { api, errorMessage } from "./api";
import type { FileEntry } from "./api";
import { basename } from "./model";
import { beginFileDrag } from "./file-drag";
import { IconButton } from "./ui";

interface Props {
  root: string;
  onTerminal: (path: string) => void;
  onOpenFile: (relative: string) => void;
  onError: (message: string) => void;
}

export default function Explorer(props: Props) {
  const [revision, setRevision] = useState(0);
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
    <div className="sidebar-panel explorer-panel">
      <header className="sidebar-heading">
        <span>EXPLORER</span>
        <div>
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
          <IconButton
            title="Refresh explorer"
            onClick={() => setRevision(revision + 1)}
          >
            <RefreshCw size={14} />
          </IconButton>
        </div>
      </header>
      <div className="project-tree-heading">
        <FolderOpen size={14} />
        <span title={props.root}>{basename(props.root)}</span>
        <IconButton
          title="Open terminal in project folder"
          onClick={() => props.onTerminal(props.root)}
        >
          <Terminal size={14} />
        </IconButton>
      </div>
      <div className="file-tree" aria-label="Project files">
        <Directory
          {...props}
          relative=""
          depth={0}
          revision={revision}
          showHidden={showHidden}
          expanded={expanded}
          toggle={toggle}
        />
      </div>
    </div>
  );
}

interface DirectoryProps extends Props {
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
  }, [root, relative, revision]);
  if (loading)
    return (
      <div
        className="tree-message"
        style={{
          paddingLeft: `calc(${depth} * var(--tree-indent) + var(--space-16))`,
        }}
      >
        Loading…
      </div>
    );
  if (error)
    return (
      <div className="tree-message text-error" title={error}>
        {error}
      </div>
    );
  const visible = entries.filter(
    (entry) => showHidden || !entry.name.startsWith("."),
  );
  if (!visible.length)
    return (
      <div
        className="tree-message"
        style={{
          paddingLeft: `calc(${depth} * var(--tree-indent) + var(--space-16))`,
        }}
      >
        Empty folder
      </div>
    );
  return (
    <>
      {visible.map((entry) => {
        const open = expanded.has(entry.relativePath);
        return (
          <div key={entry.relativePath}>
            <div
              className="tree-row"
              style={{
                paddingLeft: `calc(${depth} * var(--tree-indent) + var(--space-10))`,
              }}
              onPointerDown={(event) =>
                beginFileDrag(event, entry.path, onError)
              }
            >
              <button
                className="tree-entry"
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
