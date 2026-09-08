import { useRef, useState } from "react";
import { Layers, Plus } from "lucide-react";
import type { Project, Workspace } from "./model";
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
  onSelect: (path: string, workspaceId: string) => void;
  onNew: () => void;
  onRename: (workspace: Workspace) => void;
  onDelete: (workspace: Workspace) => void;
}) {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number }>();
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
            <button
              key={workspace.id}
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
              <Layers size={16} aria-hidden="true" />
              <span className="workspace-list-details">
                <span>{workspace.name}</span>
                <small>{project.path}</small>
              </span>
              <span
                className="count-badge"
                aria-label={`${workspace.tabs.length} ${workspace.tabs.length === 1 ? "tab" : "tabs"}`}
              >
                {workspace.tabs.length}
              </span>
            </button>
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
