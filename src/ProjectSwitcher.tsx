import { useEffect, useId, useRef } from "react";
import {
  Check,
  ChevronDown,
  Folder,
  FolderOpen,
  Menu as MenuIcon,
} from "lucide-react";
import { basename } from "./model";
import type { Project } from "./model";
import { Menu } from "./ui";

export default function ProjectSwitcher({
  projects,
  activeProjectId,
  expanded,
  onToggle,
  onClose,
  onSelect,
  onBrowse,
}: {
  projects: Project[];
  activeProjectId: string | null;
  expanded: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (path: string) => void;
  onBrowse: () => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);
  const menuId = useId();
  const project = projects.find((project) => project.id === activeProjectId);

  useEffect(() => {
    if (!expanded) return;
    const items = menu.current?.querySelectorAll<HTMLButtonElement>("button");
    items?.[focusLast.current ? items.length - 1 : 0]?.focus();
  }, [expanded]);

  return (
    <div className="titlebar-project">
      <button
        ref={trigger}
        type="button"
        className={`project-switcher${project ? "" : " project-switcher-empty"}`}
        data-menu-trigger
        aria-haspopup="menu"
        aria-expanded={expanded}
        aria-controls={expanded ? menuId : undefined}
        title={project?.path ?? "Open Recent Project"}
        onClick={() => {
          focusLast.current = false;
          onToggle();
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          focusLast.current = event.key === "ArrowUp";
          if (!expanded) onToggle();
        }}
      >
        {project ? (
          <Folder size={14} aria-hidden="true" />
        ) : (
          <MenuIcon size={13} aria-hidden="true" />
        )}
        <span>{project ? basename(project.path) : "Open Recent Project"}</span>
        <ChevronDown
          className="switcher-chevron"
          size={11}
          aria-hidden="true"
        />
      </button>
      {expanded && (
        <Menu className="project-menu" onClose={onClose}>
          <div
            ref={menu}
            id={menuId}
            role="menu"
            aria-label="Projects"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onClose();
                trigger.current?.focus();
                return;
              }
              if (event.key === "Tab") {
                onClose();
                return;
              }
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
                return;
              event.preventDefault();
              const items = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "button",
                ),
              );
              const current = items.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? items.length - 1
                    : (current +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        items.length) %
                      items.length;
              items[next]?.focus();
            }}
          >
            {projects.length > 0 && (
              <>
                <div className="menu-label">RECENT PROJECTS</div>
                <div
                  className="recent-projects"
                  role="group"
                  aria-label="Recent projects"
                >
                  {projects.map((candidate) => (
                    <button
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      className="menu-item"
                      key={candidate.id}
                      title={candidate.path}
                      aria-current={
                        candidate.id === activeProjectId ? "true" : undefined
                      }
                      onClick={() => {
                        trigger.current?.focus();
                        onSelect(candidate.path);
                      }}
                    >
                      <Folder size={14} aria-hidden="true" />
                      <span>{basename(candidate.path)}</span>
                      {candidate.id === activeProjectId && (
                        <Check size={13} aria-hidden="true" />
                      )}
                    </button>
                  ))}
                </div>
                <div className="menu-divider" role="separator" />
              </>
            )}
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="menu-item"
              onClick={() => {
                trigger.current?.focus();
                onBrowse();
              }}
            >
              <FolderOpen size={14} aria-hidden="true" />
              <span>Open Local Folder…</span>
            </button>
          </div>
        </Menu>
      )}
    </div>
  );
}
