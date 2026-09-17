import ResourceIcon from "./ResourceIcon";
import { useRef, useState } from "react";
import {
  FileDiff,
  ChevronRight,
  GitCommitHorizontal,
  Layers,
  Plus,
  Terminal,
} from "./icons";
import type { Project, Workspace } from "./model";
import { basename, tabTitle } from "./model";
import ContextMenu from "./ContextMenu";
import { IconButton } from "./ui";

export default function Workspaces({
  projects,
  activeWorkspaceId,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: {
  projects: Project[];
  activeWorkspaceId?: string;
  onSelect: (path: string, workspaceId: string, tabId?: string) => void;
  onNew: () => void;
  onRename: (workspace: Workspace) => void;
  onDelete: (workspace: Workspace) => void;
}) {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number }>();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const trigger = useRef<HTMLButtonElement>(null);
  const workspace =
    menu &&
    projects
      .flatMap((project) => project.workspaces)
      .find((workspace) => workspace.id === menu.id);
  const showMenu = (
    id: string,
    element: HTMLButtonElement,
    x?: number,
    y?: number,
  ) => {
    trigger.current = element;
    const bounds = element.getBoundingClientRect();
    setMenu({ id, x: x || bounds.left, y: y || bounds.bottom });
  };
  return (
    <div className="sidebar-panel">
      <div className="sidebar-heading">
        <span>WORKSPACES</span>
        <IconButton title="New workspace" onClick={onNew}>
          <Plus size={15} />
        </IconButton>
      </div>
      <nav className="workspace-list" aria-label="Workspace list">
        {projects.flatMap((project) =>
          project.workspaces.map((workspace) => (
            <div
              className={`workspace-list-entry${workspace.id === activeWorkspaceId ? " is-active" : ""}`}
              key={workspace.id}
            >
              <div className="workspace-list-heading">
                <button
                  type="button"
                  className="workspace-list-item"
                  aria-current={
                    workspace.id === activeWorkspaceId ? "true" : undefined
                  }
                  title={`${workspace.name}\n${project.path}`}
                  onClick={() => onSelect(project.path, workspace.id)}
                  aria-haspopup="menu"
                  aria-expanded={menu?.id === workspace.id}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    showMenu(
                      workspace.id,
                      event.currentTarget,
                      event.clientX,
                      event.clientY,
                    );
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === "ContextMenu" ||
                      (event.shiftKey && event.key === "F10")
                    ) {
                      event.preventDefault();
                      showMenu(workspace.id, event.currentTarget);
                    }
                  }}
                >
                  <span className="workspace-list-icon" aria-hidden="true">
                    <Layers size={17} />
                  </span>
                  <span className="workspace-list-details">
                    <span>{workspace.name}</span>
                    <small>
                      <span className="workspace-folder">
                        {basename(project.path)}
                      </span>
                      <span className="workspace-tab-count">
                        {workspace.tabs.length}{" "}
                        {workspace.tabs.length === 1 ? "tab" : "tabs"}
                      </span>
                    </small>
                  </span>
                </button>
                <IconButton
                  className="icon-button workspace-tabs-toggle"
                  title={`${expanded.has(workspace.id) ? "Collapse" : "Expand"} tabs in ${workspace.name}`}
                  aria-expanded={expanded.has(workspace.id)}
                  aria-controls={`workspace-tabs-${workspace.id}`}
                  onClick={() =>
                    setExpanded((current) => {
                      const next = new Set(current);
                      if (next.has(workspace.id)) next.delete(workspace.id);
                      else next.add(workspace.id);
                      return next;
                    })
                  }
                >
                  <ChevronRight size={15} aria-hidden="true" />
                </IconButton>
              </div>
              <ul
                id={`workspace-tabs-${workspace.id}`}
                className="workspace-tab-list"
                aria-label={`Tabs in ${workspace.name}`}
                hidden={!expanded.has(workspace.id)}
              >
                {workspace.tabs.map((tab) => (
                  <li key={tab.id}>
                    <button
                      type="button"
                      className="workspace-tab-item"
                      aria-current={
                        workspace.id === activeWorkspaceId &&
                        tab.id === workspace.activeTabId
                          ? "true"
                          : undefined
                      }
                      title={tab.type === "file" ? tab.relative : tabTitle(tab)}
                      onClick={() =>
                        onSelect(project.path, workspace.id, tab.id)
                      }
                    >
                      {tab.type === "commit" ? (
                        <GitCommitHorizontal size={14} aria-hidden="true" />
                      ) : tab.type === "diff" ? (
                        <ResourceIcon
                          path={`${tab.root}/${tab.relative}`}
                          size={14}
                          fallback={FileDiff}
                        />
                      ) : tab.type === "file" ? (
                        <ResourceIcon
                          path={`${tab.root}/${tab.relative}`}
                          size={14}
                        />
                      ) : (
                        <Terminal size={14} aria-hidden="true" />
                      )}
                      <span>{tabTitle(tab)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )),
        )}
        {projects.length === 0 && (
          <p className="sidebar-empty">Add a workspace to choose its folder.</p>
        )}
      </nav>
      {menu && workspace && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label="Workspace actions"
          actions={[
            { label: "Rename workspace", run: () => onRename(workspace) },
            {
              label: "Delete workspace…",
              danger: true,
              run: () => onDelete(workspace),
            },
          ]}
          onClose={() => {
            setMenu(undefined);
            trigger.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </div>
  );
}
