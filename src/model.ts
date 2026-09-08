export interface ShellProfile {
  id: string;
  name: string;
  kind: string;
  program: string;
  distro: string | null;
  home: string;
}

export interface AppInfo {
  directory: string;
  home: string;
  platform: string;
  profiles: ShellProfile[];
}

export interface Pane {
  type: "terminal";
  id: string;
  cwd: string;
  profileId?: string;
}
export interface Split {
  type: "split";
  id: string;
  axis: "horizontal" | "vertical";
  ratio: number;
  first: Layout;
  second: Layout;
}
export type Layout = Pane | Split;
export interface LayoutSize {
  width: number;
  height: number;
}
export const MIN_PANE_WIDTH = 240;
export const MIN_PANE_HEIGHT = 120;
export const SPLIT_DIVIDER_SIZE = 3;
export interface TerminalTab {
  type: "terminal";
  id: string;
  title: string;
  profileId: string;
  activePaneId: string;
  layout: Layout;
}
export interface CommitTab {
  type: "commit";
  id: string;
  title: string;
  root: string;
  commit: string;
}
export interface EditorPosition {
  anchor: number;
  head: number;
  scrollTop: number;
  scrollLeft: number;
}
export interface FileTab {
  type: "file";
  id: string;
  title: string;
  root: string;
  relative: string;
  position?: EditorPosition;
}
export type Tab = TerminalTab | CommitTab | FileTab;
export type TabDropSide = "left" | "right" | "top" | "bottom";
export type TabCloseAction =
  "close" | "others" | "left" | "right" | "clean" | "all";
export interface Workspace {
  id: string;
  name: string;
  activeTabId: string;
  tabs: Tab[];
}
export interface Project {
  id: string;
  path: string;
  activeWorkspaceId: string;
  workspaces: Workspace[];
}
export interface Session {
  version: 1;
  activeProjectId: string | null;
  projects: Project[];
  sidebar: "files" | "git" | null;
  sidebarWidth: number;
}

export const newId = () => crypto.randomUUID();
export const basename = (path: string) =>
  path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() || path;
export const newPane = (cwd: string): Pane => ({
  type: "terminal",
  id: newId(),
  cwd,
});
export function newTab(
  cwd: string,
  profileId: string,
  title = "Terminal",
): TerminalTab {
  const layout = newPane(cwd);
  return {
    type: "terminal",
    id: newId(),
    title,
    profileId,
    layout,
    activePaneId: layout.id,
  };
}
export function newWorkspace(
  cwd: string,
  profileId: string,
  name = "Default",
): Workspace {
  const tab = newTab(cwd, profileId);
  return { id: newId(), name, tabs: [tab], activeTabId: tab.id };
}
export function newProject(path: string, profileId: string): Project {
  const workspace = newWorkspace(path, profileId);
  return {
    id: newId(),
    path,
    workspaces: [workspace],
    activeWorkspaceId: workspace.id,
  };
}
export function newSession(): Session {
  return {
    version: 1,
    projects: [],
    activeProjectId: null,
    sidebar: "files",
    sidebarWidth: 250,
  };
}
export function panes(layout: Layout): Pane[] {
  return layout.type === "terminal"
    ? [layout]
    : [...panes(layout.first), ...panes(layout.second)];
}
export function minimumLayoutSize(layout: Layout): LayoutSize {
  if (layout.type === "terminal")
    return { width: MIN_PANE_WIDTH, height: MIN_PANE_HEIGHT };
  const first = minimumLayoutSize(layout.first);
  const second = minimumLayoutSize(layout.second);
  return layout.axis === "horizontal"
    ? {
        width: first.width + SPLIT_DIVIDER_SIZE + second.width,
        height: Math.max(first.height, second.height),
      }
    : {
        width: Math.max(first.width, second.width),
        height: first.height + SPLIT_DIVIDER_SIZE + second.height,
      };
}
export function layoutFits(layout: Layout, size: LayoutSize): boolean {
  const minimum = minimumLayoutSize(layout);
  return size.width >= minimum.width && size.height >= minimum.height;
}
export function splitGeometry(layout: Split, size: LayoutSize) {
  const dimension = layout.axis === "horizontal" ? "width" : "height";
  const available = Math.max(0, size[dimension] - SPLIT_DIVIDER_SIZE);
  const firstMinimum = minimumLayoutSize(layout.first)[dimension];
  const secondMinimum = minimumLayoutSize(layout.second)[dimension];
  const minRatio = available > 0 ? firstMinimum / available : 0.5;
  const maxRatio = available > 0 ? 1 - secondMinimum / available : 0.5;
  const ratio = Math.max(minRatio, Math.min(maxRatio, layout.ratio));
  return {
    ratio,
    minRatio,
    maxRatio,
    first: { ...size, [dimension]: available * ratio },
    second: { ...size, [dimension]: available * (1 - ratio) },
  };
}
function paneSize(
  layout: Layout,
  paneId: string,
  size: LayoutSize,
): LayoutSize | undefined {
  if (layout.type === "terminal")
    return layout.id === paneId ? size : undefined;
  const geometry = splitGeometry(layout, size);
  return (
    paneSize(layout.first, paneId, geometry.first) ??
    paneSize(layout.second, paneId, geometry.second)
  );
}
export function canSplitPane(
  layout: Layout,
  paneId: string,
  axis: Split["axis"],
  size: LayoutSize,
): boolean {
  if (!layoutFits(layout, size)) return false;
  const bounds = paneSize(layout, paneId, size);
  if (!bounds) return false;
  return axis === "horizontal"
    ? bounds.width >= MIN_PANE_WIDTH * 2 + SPLIT_DIVIDER_SIZE
    : bounds.height >= MIN_PANE_HEIGHT * 2 + SPLIT_DIVIDER_SIZE;
}
export function mapLayout(
  layout: Layout,
  transform: (pane: Pane) => Pane,
): Layout {
  return layout.type === "terminal"
    ? transform(layout)
    : {
        ...layout,
        first: mapLayout(layout.first, transform),
        second: mapLayout(layout.second, transform),
      };
}
export function splitPane(
  layout: Layout,
  paneId: string,
  axis: Split["axis"],
  added: Pane,
): Layout {
  if (layout.type === "terminal")
    return layout.id === paneId
      ? {
          type: "split",
          id: newId(),
          axis,
          ratio: 0.5,
          first: layout,
          second: added,
        }
      : layout;
  return {
    ...layout,
    first: splitPane(layout.first, paneId, axis, added),
    second: splitPane(layout.second, paneId, axis, added),
  };
}
export function removePane(layout: Layout, paneId: string): Layout | null {
  if (layout.type === "terminal") return layout.id === paneId ? null : layout;
  const first = removePane(layout.first, paneId);
  const second = removePane(layout.second, paneId);
  return first && second ? { ...layout, first, second } : (first ?? second);
}
export function resizeSplit(layout: Layout, id: string, ratio: number): Layout {
  if (!Number.isFinite(ratio)) return layout;
  if (layout.type === "terminal") return layout;
  if (layout.id === id)
    return { ...layout, ratio: Math.max(0, Math.min(1, ratio)) };
  return {
    ...layout,
    first: resizeSplit(layout.first, id, ratio),
    second: resizeSplit(layout.second, id, ratio),
  };
}
export function active(session: Session) {
  if (session.activeProjectId === null) return;
  const project =
    session.projects.find(
      (project) => project.id === session.activeProjectId,
    ) ?? session.projects[0];
  if (!project) return;
  const workspace =
    project.workspaces.find(
      (workspace) => workspace.id === project.activeWorkspaceId,
    ) ?? project.workspaces[0];
  const tab =
    workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ??
    workspace.tabs[0];
  return { project, workspace, tab };
}
export function updateWorkspace(
  session: Session,
  id: string,
  transform: (workspace: Workspace) => Workspace,
): Session {
  return {
    ...session,
    projects: session.projects.map((project) => ({
      ...project,
      workspaces: project.workspaces.map((workspace) =>
        workspace.id === id ? transform(workspace) : workspace,
      ),
    })),
  };
}
export function tabsToClose(
  tabs: Tab[],
  id: string,
  action: TabCloseAction,
  modified: ReadonlySet<string>,
): Tab[] {
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return [];
  switch (action) {
    case "close":
      return [tabs[index]];
    case "others":
      return tabs.filter((tab) => tab.id !== id);
    case "left":
      return tabs.slice(0, index);
    case "right":
      return tabs.slice(index + 1);
    case "clean":
      return tabs.filter((tab) => !modified.has(tab.id));
    case "all":
      return tabs;
  }
}

export function moveTab(
  workspace: Workspace,
  id: string,
  beforeId: string | null,
): Workspace {
  const moved = workspace.tabs.find((tab) => tab.id === id);
  if (
    !moved ||
    id === beforeId ||
    (beforeId !== null && !workspace.tabs.some((tab) => tab.id === beforeId))
  )
    return workspace;
  const tabs = workspace.tabs.filter((tab) => tab.id !== id);
  const index =
    beforeId === null
      ? tabs.length
      : tabs.findIndex((tab) => tab.id === beforeId);
  tabs.splice(index, 0, moved);
  return tabs.every((tab, index) => tab === workspace.tabs[index])
    ? workspace
    : { ...workspace, tabs };
}

export function canMergeTerminalTabs(
  source: Tab,
  target: Tab,
  side: TabDropSide,
  size: LayoutSize,
): boolean {
  if (
    source.id === target.id ||
    source.type !== "terminal" ||
    target.type !== "terminal"
  )
    return false;
  const first = minimumLayoutSize(target.layout);
  const second = minimumLayoutSize(source.layout);
  return side === "left" || side === "right"
    ? size.width >= first.width + SPLIT_DIVIDER_SIZE + second.width &&
        size.height >= Math.max(first.height, second.height)
    : size.width >= Math.max(first.width, second.width) &&
        size.height >= first.height + SPLIT_DIVIDER_SIZE + second.height;
}

export function mergeTerminalTabs(
  workspace: Workspace,
  sourceId: string,
  targetId: string,
  side: TabDropSide,
  size: LayoutSize,
): Workspace {
  const source = workspace.tabs.find((tab) => tab.id === sourceId);
  const target = workspace.tabs.find((tab) => tab.id === targetId);
  if (
    source?.type !== "terminal" ||
    target?.type !== "terminal" ||
    !canMergeTerminalTabs(source, target, side, size)
  )
    return workspace;
  // Moved panes retain their shells even after restoring or restarting them.
  const moved = mapLayout(source.layout, (pane) =>
    pane.profileId !== undefined || source.profileId === target.profileId
      ? pane
      : { ...pane, profileId: source.profileId },
  );
  const before = side === "left" || side === "top";
  const layout: Split = {
    type: "split",
    id: newId(),
    axis: side === "left" || side === "right" ? "horizontal" : "vertical",
    ratio: 0.5,
    first: before ? moved : target.layout,
    second: before ? target.layout : moved,
  };
  return {
    ...workspace,
    activeTabId: target.id,
    tabs: workspace.tabs
      .filter((tab) => tab.id !== source.id)
      .map((tab) =>
        tab.id === target.id
          ? { ...target, layout, activePaneId: source.activePaneId }
          : tab,
      ),
  };
}

export function removeTabs(
  workspace: Workspace,
  ids: ReadonlySet<string>,
  cwd: string,
  profileId: string,
): Workspace {
  const tabs = workspace.tabs.filter((tab) => !ids.has(tab.id));
  if (tabs.length === workspace.tabs.length) return workspace;
  if (!tabs.length) tabs.push(newTab(cwd, profileId));
  const activeIndex = workspace.tabs.findIndex(
    (tab) => tab.id === workspace.activeTabId,
  );
  const next = ids.has(workspace.activeTabId)
    ? (workspace.tabs.slice(activeIndex + 1).find((tab) => !ids.has(tab.id)) ??
      tabs[tabs.length - 1])
    : undefined;
  return {
    ...workspace,
    tabs,
    activeTabId: next?.id ?? workspace.activeTabId,
  };
}

export function updateTab(
  session: Session,
  id: string,
  transform: (tab: Tab) => Tab,
): Session {
  return {
    ...session,
    projects: session.projects.map((project) => ({
      ...project,
      workspaces: project.workspaces.map((workspace) => ({
        ...workspace,
        tabs: workspace.tabs.map((tab) =>
          tab.id === id ? transform(tab) : tab,
        ),
      })),
    })),
  };
}
export function openCommitTab(
  session: Session,
  workspaceId: string,
  root: string,
  commit: string,
  title: string,
): Session {
  return updateWorkspace(session, workspaceId, (workspace) => {
    const existing = workspace.tabs.find(
      (tab) =>
        tab.type === "commit" && tab.root === root && tab.commit === commit,
    );
    if (existing) return { ...workspace, activeTabId: existing.id };
    const tab: CommitTab = { type: "commit", id: newId(), root, commit, title };
    return {
      ...workspace,
      tabs: [...workspace.tabs, tab],
      activeTabId: tab.id,
    };
  });
}
export function updateDirectories(
  session: Session,
  directories: Record<string, string>,
): Session {
  let changed = false;
  const projects = session.projects.map((project) => ({
    ...project,
    workspaces: project.workspaces.map((workspace) => ({
      ...workspace,
      tabs: workspace.tabs.map((tab) =>
        tab.type !== "terminal"
          ? tab
          : {
              ...tab,
              layout: mapLayout(tab.layout, (pane) => {
                const cwd = directories[pane.id];
                if (!cwd || cwd === pane.cwd) return pane;
                changed = true;
                return { ...pane, cwd };
              }),
            },
      ),
    })),
  }));
  return changed ? { ...session, projects } : session;
}

export function openFileTab(
  session: Session,
  workspaceId: string,
  root: string,
  relative: string,
): Session {
  return updateWorkspace(session, workspaceId, (workspace) => {
    const existing = workspace.tabs.find(
      (tab) =>
        tab.type === "file" && tab.root === root && tab.relative === relative,
    );
    if (existing) return { ...workspace, activeTabId: existing.id };
    const tab: FileTab = {
      type: "file",
      id: newId(),
      title: basename(relative),
      root,
      relative,
    };
    return {
      ...workspace,
      tabs: [...workspace.tabs, tab],
      activeTabId: tab.id,
    };
  });
}

export function fileTabs(session: Session): FileTab[] {
  return session.projects.flatMap((project) =>
    project.workspaces.flatMap((workspace) =>
      workspace.tabs.filter((tab): tab is FileTab => tab.type === "file"),
    ),
  );
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
const string = (value: unknown, fallback: string) =>
  typeof value === "string" && value.length > 0 ? value : fallback;

export function restoreSession(value: unknown, info: AppInfo): Session {
  const data = record(value);
  if (data.version !== 1 || !Array.isArray(data.projects)) return newSession();
  const ids = new Set<string>();
  const id = (value: unknown) => {
    let candidate = string(value, newId());
    if (ids.has(candidate)) candidate = newId();
    ids.add(candidate);
    return candidate;
  };
  const layout = (value: unknown, cwd: string, depth = 0): Layout => {
    const node = record(value);
    // Preserve every layout accepted by the native JSON parser's nesting limit.
    if (node.type === "split" && depth < 128)
      return {
        type: "split",
        id: id(node.id),
        axis: node.axis === "vertical" ? "vertical" : "horizontal",
        ratio:
          typeof node.ratio === "number" && Number.isFinite(node.ratio)
            ? Math.max(0, Math.min(1, node.ratio))
            : 0.5,
        first: layout(node.first, cwd, depth + 1),
        second: layout(node.second, cwd, depth + 1),
      };
    return {
      type: "terminal",
      id: id(node.id),
      cwd: string(node.cwd, cwd),
      ...(typeof node.profileId === "string"
        ? { profileId: node.profileId }
        : {}),
    };
  };
  const projects = data.projects
    .map((value): Project | null => {
      const project = record(value);
      if (typeof project.path !== "string" || !project.path) return null;
      const path = project.path;
      const workspaces = (
        Array.isArray(project.workspaces) ? project.workspaces : []
      ).map((value): Workspace => {
        const workspace = record(value);
        const tabs = (Array.isArray(workspace.tabs) ? workspace.tabs : []).map(
          (value): Tab => {
            const tab = record(value);
            if (tab.type === "file") {
              const position = record(tab.position);
              const offset = (value: unknown) =>
                typeof value === "number" && Number.isFinite(value)
                  ? Math.max(0, Math.floor(value))
                  : 0;
              return {
                type: "file",
                id: id(tab.id),
                title: string(
                  tab.title,
                  basename(string(tab.relative, "File")),
                ),
                root: string(tab.root, path),
                relative: string(tab.relative, ""),
                ...(tab.position
                  ? {
                      position: {
                        anchor: offset(position.anchor),
                        head: offset(position.head),
                        scrollTop: offset(position.scrollTop),
                        scrollLeft: offset(position.scrollLeft),
                      },
                    }
                  : {}),
              };
            }
            if (tab.type === "commit") {
              return {
                type: "commit",
                id: id(tab.id),
                title: string(tab.title, "Commit"),
                root: string(tab.root, path),
                commit: string(tab.commit, ""),
              };
            }
            const tree = layout(tab.layout, path);
            const leaves = panes(tree);
            return {
              type: "terminal",
              id: id(tab.id),
              title: string(tab.title, "Terminal"),
              profileId: string(tab.profileId, info.profiles[0]?.id ?? ""),
              activePaneId: leaves.some((pane) => pane.id === tab.activePaneId)
                ? (tab.activePaneId as string)
                : leaves[0].id,
              layout: tree,
            };
          },
        );
        if (!tabs.length) tabs.push(newTab(path, info.profiles[0]?.id ?? ""));
        return {
          id: id(workspace.id),
          name: string(workspace.name, "Default"),
          tabs,
          activeTabId: tabs.some((tab) => tab.id === workspace.activeTabId)
            ? (workspace.activeTabId as string)
            : tabs[0].id,
        };
      });
      if (!workspaces.length)
        workspaces.push(newWorkspace(path, info.profiles[0]?.id ?? ""));
      return {
        id: id(project.id),
        path,
        workspaces,
        activeWorkspaceId: workspaces.some(
          (workspace) => workspace.id === project.activeWorkspaceId,
        )
          ? (project.activeWorkspaceId as string)
          : workspaces[0].id,
      };
    })
    .filter((project): project is Project => project !== null);
  return {
    version: 1,
    projects,
    activeProjectId:
      data.activeProjectId === null
        ? null
        : projects.some((project) => project.id === data.activeProjectId)
          ? (data.activeProjectId as string)
          : (projects[0]?.id ?? null),
    sidebar:
      data.sidebar === "git" ? "git" : data.sidebar === null ? null : "files",
    sidebarWidth:
      typeof data.sidebarWidth === "number" &&
      Number.isFinite(data.sidebarWidth)
        ? data.sidebarWidth > 0
          ? data.sidebarWidth
          : 180
        : 250,
  };
}
