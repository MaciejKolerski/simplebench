import { basename, layoutPanes, newTab } from "./model.ts";
import type { FileTab, Layout, Project, Session, Tab } from "./model.ts";

export interface FileChange {
  oldPath: string | null;
  newPath: string | null;
}
export type FileOperation =
  | { kind: "newFile" | "newFolder" | "rename"; name: string }
  | { kind: "copy" | "move"; sourceRoot: string; source: string }
  | { kind: "duplicate" | "trash" | "delete" };
export const normalizePath = (path: string) =>
  path.replaceAll("\\", "/").replace(/\/$/, "");
export const absoluteFilePath = (file: Pick<FileTab, "root" | "relative">) =>
  `${normalizePath(file.root)}/${normalizePath(file.relative)}`;
export const containsPath = (parent: string, path: string) => {
  const base = normalizePath(parent);
  const candidate = normalizePath(path);
  return candidate === base || candidate.startsWith(`${base}/`);
};
export const parentPath = (path: string) =>
  normalizePath(path).split("/").slice(0, -1).join("/");

export function applyFileChange(
  session: Session,
  change: FileChange,
  profileId: string,
): Session {
  if (!change.oldPath) return session;
  const oldPath = normalizePath(change.oldPath);
  const newPath =
    change.newPath === null ? null : normalizePath(change.newPath);
  const relocate = (path: string) =>
    containsPath(oldPath, path) && newPath !== null
      ? newPath + normalizePath(path).slice(oldPath.length)
      : path;
  const projects = session.projects
    .filter(
      (project) => newPath !== null || !containsPath(oldPath, project.path),
    )
    .map((project) => ({ ...project, path: relocate(project.path) }));
  const file = (file: FileTab): FileTab | null => {
    if (file.untitled) return file;
    const path = absoluteFilePath(file);
    if (!containsPath(oldPath, path)) return file;
    if (newPath === null) return null;
    const destination = relocate(path);
    const previousRoot = relocate(file.root);
    const root = containsPath(previousRoot, destination)
      ? previousRoot
      : (projects
          .filter((project) => containsPath(project.path, destination))
          .sort((a, b) => b.path.length - a.path.length)[0]?.path ??
        parentPath(destination));
    return {
      ...file,
      root,
      relative: normalizePath(destination).slice(
        normalizePath(root).length + 1,
      ),
      title: basename(destination),
    };
  };
  const layout = (item: Layout, project: Project): Layout | null => {
    if (item.type === "file") return file(item);
    if (item.type === "terminal")
      return {
        ...item,
        cwd:
          newPath === null && containsPath(oldPath, item.cwd)
            ? project.path
            : relocate(item.cwd),
      };
    const first = layout(item.first, project);
    const second = layout(item.second, project);
    return first && second ? { ...item, first, second } : (first ?? second);
  };
  const updated = projects.map((project) => ({
    ...project,
    workspaces: project.workspaces.map((workspace) => {
      const tabs = workspace.tabs.flatMap((tab): Tab[] => {
        if (tab.type === "file") {
          const updated = file(tab);
          return updated ? [updated] : [];
        }
        if (tab.type === "commit")
          return newPath === null && containsPath(oldPath, tab.root)
            ? []
            : [{ ...tab, root: relocate(tab.root) }];
        const updated = layout(tab.layout, project);
        if (!updated) return [];
        const panels = layoutPanes(updated);
        return [
          {
            ...tab,
            layout: updated,
            activePaneId: panels.some((pane) => pane.id === tab.activePaneId)
              ? tab.activePaneId
              : panels[0].id,
          },
        ];
      });
      if (!tabs.length) tabs.push(newTab(project.path, profileId));
      return {
        ...workspace,
        tabs,
        activeTabId: tabs.some((tab) => tab.id === workspace.activeTabId)
          ? workspace.activeTabId
          : tabs[0].id,
      };
    }),
  }));
  return {
    ...session,
    projects: updated,
    activeProjectId: updated.some(
      (project) => project.id === session.activeProjectId,
    )
      ? session.activeProjectId
      : (updated[0]?.id ?? null),
  };
}
