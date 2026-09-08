import { Layers, Plus } from "lucide-react";
import type { Project } from "./model";
import { IconButton } from "./ui";

export default function Workspaces({
  projects,
  activeWorkspaceId,
  onSelect,
  onNew,
}: {
  projects: Project[];
  activeWorkspaceId?: string;
  onSelect: (path: string, workspaceId: string) => void;
  onNew: () => void;
}) {
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
    </div>
  );
}
