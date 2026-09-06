import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Copy,
  Folder,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  Layers,
  PanelLeft,
  Plus,
  Settings,
  Terminal,
  X,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  api,
  errorMessage,
  getInfo,
  loadSession,
  native,
  saveSession,
} from "./api";
import type { GitStatus } from "./api";
import {
  active,
  basename,
  canSplitPane,
  mapLayout,
  newPane,
  newProject,
  newTab,
  newWorkspace,
  openCommitTab,
  panes,
  removePane,
  resizeSplit,
  restoreSession,
  splitPane,
  updateDirectories,
  updateTab,
  updateWorkspace,
} from "./model";
import type { AppInfo, Session, Split, TerminalTab } from "./model";
import {
  closeTerminals,
  configureTerminals,
  observedDirectories,
  runningTerminal,
} from "./terminal-runtime";
import { dropPaths, terminalAt } from "./file-drag";
import { IconButton, Menu, Modal, WindowControls } from "./ui";
import Explorer from "./Explorer";
import SourceControl from "./SourceControl";
import CommitDetails from "./CommitDetails";
import SplitView from "./SplitView";
import "@xterm/xterm/css/xterm.css";

type Dialog =
  | {
      type: "name";
      title: string;
      initial: string;
      submit: (name: string) => void;
    }
  | { type: "confirm"; title: string; text: string; submit: () => void }
  | { type: "preview"; title: string; content: string };
let bootstrap:
  Promise<{ info: AppInfo; saved: unknown; restoreError: string }> | undefined;
function initialize() {
  return (bootstrap ??= (async () => {
    const info = await getInfo();
    await api("reset_terminals");
    try {
      const saved = await loadSession();
      if (
        saved &&
        typeof saved === "object" &&
        "version" in saved &&
        saved.version !== 1
      ) {
        throw new Error(
          "This session was saved in an unsupported format. The saved file has been left intact.",
        );
      }
      return { info, saved, restoreError: "" };
    } catch (error) {
      return { info, saved: null, restoreError: errorMessage(error) };
    }
  })());
}

function useGit(root: string) {
  const [result, setResult] = useState<{
    project: string;
    status: GitStatus | null;
  }>({ project: "", status: null });
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!root || !native) return;
    let current = true;
    let busy = false;
    const update = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const next = await api<GitStatus | null>("git_status", { root });
        if (current) {
          setResult({ project: root, status: next });
          setError("");
        }
      } catch (error) {
        if (current) {
          setResult({ project: root, status: null });
          setError(errorMessage(error));
        }
      } finally {
        busy = false;
      }
    };
    void update();
    const timer = setInterval(() => void update(), 4000);
    window.addEventListener("focus", update);
    return () => {
      current = false;
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [root, revision]);
  return {
    status: result.project === root ? result.status : null,
    error,
    refresh,
  };
}

export default function Workbench() {
  const [info, setInfo] = useState<AppInfo>();
  const [session, renderSession] = useState<Session>();
  const currentSession = useRef<Session>(undefined);
  const setSession = useCallback(
    (
      update: Session | ((state: Session | undefined) => Session | undefined),
    ) => {
      const next =
        typeof update === "function" ? update(currentSession.current) : update;
      // Queued shortcuts must see the updated layout before React renders it.
      currentSession.current = next;
      renderSession(next);
    },
    [],
  );
  const [error, setError] = useState("");
  const [restoreError, setRestoreError] = useState("");
  const [paneNotice, setPaneNotice] = useState("");
  const [menu, setMenu] = useState<"project" | "workspace" | null>(null);
  const [location, setLocation] = useState("");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const terminalLayout = useRef<HTMLDivElement>(null);
  const savingEnabled = useRef(false);
  const selected = session ? active(session) : undefined;
  const git = useGit(selected?.project.path ?? "");
  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    if (!paneNotice) return;
    const timer = setTimeout(() => setPaneNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [paneNotice]);

  useEffect(() => {
    if (!native) return;
    let current = true;
    void initialize()
      .then(({ info, saved, restoreError }) => {
        if (!current) return;
        setInfo(info);
        setSession(restoreSession(saved, info));
        setRestoreError(restoreError);
        savingEnabled.current = !restoreError;
      })
      .catch((error) => {
        if (current) setError(errorMessage(error));
      });
    return () => {
      current = false;
    };
  }, []);
  useEffect(() => {
    configureTerminals(
      (id, cwd) =>
        setSession((state) =>
          state ? updateDirectories(state, { [id]: cwd }) : state,
        ),
      setError,
    );
  }, []);
  useEffect(() => {
    if (!session || !savingEnabled.current) return;
    const timer = setTimeout(
      () =>
        void saveSession(session).catch((error) =>
          setError(`Could not save the session: ${errorMessage(error)}`),
        ),
      400,
    );
    return () => clearTimeout(timer);
  }, [session]);
  useEffect(() => {
    if (!info) return;
    const timer = setInterval(() => {
      void api<Record<string, string>>("terminal_directories")
        .then((directories) =>
          setSession((state) =>
            state
              ? updateDirectories(state, observedDirectories(directories))
              : state,
          ),
        )
        .catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [info]);
  useEffect(() => {
    if (!info) return;
    let current = true;
    let closing = false;
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      if (closing) return;
      closing = true;
      try {
        if (currentSession.current && savingEnabled.current) {
          await saveSession(currentSession.current);
        }
        await getCurrentWindow().destroy();
      } catch (error) {
        closing = false;
        setError(`Could not close the window: ${errorMessage(error)}`);
      }
    });
    void unlisten
      .then((stop) => {
        if (!current) stop();
      })
      .catch((error) => setError(errorMessage(error)));
    return () => {
      current = false;
      void unlisten.then((stop) => stop()).catch(() => {});
    };
  }, [info]);
  useEffect(() => {
    if (!info) return;
    let current = true;
    let target: HTMLElement | null = null;
    const unlisten = getCurrentWebviewWindow().onDragDropEvent(
      ({ payload }) => {
        target?.classList.remove("drop-target");
        if (payload.type === "leave") {
          target = null;
          return;
        }
        target = terminalAt(
          payload.position.x / window.devicePixelRatio,
          payload.position.y / window.devicePixelRatio,
        );
        if (payload.type === "drop") {
          void dropPaths(target, payload.paths, setError);
          target = null;
        } else target?.classList.add("drop-target");
      },
    );
    void unlisten
      .then((stop) => {
        if (!current) stop();
      })
      .catch((error) => setError(errorMessage(error)));
    return () => {
      current = false;
      target?.classList.remove("drop-target");
      void unlisten.then((stop) => stop()).catch(() => {});
    };
  }, [info]);
  useEffect(() => {
    if (!selected || !native) return;
    void getCurrentWindow()
      .setTitle(
        `${basename(selected.project.path)} — ${selected.workspace.name} — SimpleBench`,
      )
      .catch(() => {});
    document
      .getElementById(`tab-${selected.tab.id}`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected?.project.path, selected?.workspace.name, selected?.tab.id]);

  const change = (transform: (state: Session) => Session) =>
    setSession((state) => (state ? transform(state) : state));
  const addTab = (cwd?: string) =>
    change((state) => {
      const { project, workspace, tab } = active(state);
      const added = newTab(
        cwd ?? project.path,
        tab.type === "terminal" ? tab.profileId : (info?.profiles[0]?.id ?? ""),
        `Terminal ${workspace.tabs.length + 1}`,
      );
      return updateWorkspace(state, workspace.id, (workspace) => ({
        ...workspace,
        tabs: [...workspace.tabs, added],
        activeTabId: added.id,
      }));
    });
  const closeTab = (id: string) => {
    const state = currentSession.current;
    if (!state) return;
    const { project, workspace } = active(state);
    const tab = workspace.tabs.find((tab) => tab.id === id);
    if (!tab) return;
    if (tab.type === "terminal")
      closeTerminals(panes(tab.layout).map((pane) => pane.id));
    change((state) =>
      updateWorkspace(state, workspace.id, (workspace) => {
        const index = workspace.tabs.findIndex((tab) => tab.id === id);
        const tabs = workspace.tabs.filter((tab) => tab.id !== id);
        if (!tabs.length)
          tabs.push(
            newTab(
              project.path,
              tab.type === "terminal"
                ? tab.profileId
                : (info?.profiles[0]?.id ?? ""),
            ),
          );
        return {
          ...workspace,
          tabs,
          activeTabId:
            workspace.activeTabId === id
              ? tabs[Math.min(index, tabs.length - 1)].id
              : workspace.activeTabId,
        };
      }),
    );
  };
  const openSettings = () => {
    setMenu(null);
    void api("open_settings").catch((error) => setError(errorMessage(error)));
  };
  useEffect(() => {
    if (!session) return;
    const keyboard = (event: KeyboardEvent) => {
      if (
        document.querySelector("dialog[open]") ||
        !(event.ctrlKey || event.metaKey)
      )
        return;
      if (
        !event.altKey &&
        !event.isComposing &&
        !event.getModifierState("AltGraph") &&
        (event.code === "KeyD" || (!event.shiftKey && event.code === "KeyW"))
      ) {
        const target = event.target;
        if (
          target instanceof Element &&
          !target.classList.contains("xterm-helper-textarea") &&
          target.closest(
            "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
          )
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        if (event.code === "KeyD")
          split(event.shiftKey ? "vertical" : "horizontal");
        else {
          const tab = active(currentSession.current!).tab;
          if (tab.type === "commit") closeTab(tab.id);
          else closePane(tab.activePaneId);
        }
        return;
      }
      if (event.shiftKey && event.code === "KeyT") {
        event.preventDefault();
        addTab();
      }
      if (event.shiftKey && event.code === "KeyW") {
        event.preventDefault();
        closeTab(active(session).tab.id);
      }
      if (event.shiftKey && event.code === "KeyE") {
        event.preventDefault();
        change((state) => ({
          ...state,
          sidebar: state.sidebar === "files" ? null : "files",
        }));
      }
      if (event.shiftKey && event.code === "KeyG" && git.status) {
        event.preventDefault();
        change((state) => ({
          ...state,
          sidebar: state.sidebar === "git" ? null : "git",
        }));
      }
      if (event.code === "Comma") {
        event.preventDefault();
        openSettings();
      }
      if (event.code === "Tab") {
        event.preventDefault();
        const { workspace, tab } = active(session);
        const index =
          (workspace.tabs.findIndex((candidate) => candidate.id === tab.id) +
            (event.shiftKey ? -1 : 1) +
            workspace.tabs.length) %
          workspace.tabs.length;
        change((state) =>
          updateWorkspace(state, workspace.id, (workspace) => ({
            ...workspace,
            activeTabId: workspace.tabs[index].id,
          })),
        );
      }
    };
    window.addEventListener("keydown", keyboard, true);
    return () => window.removeEventListener("keydown", keyboard, true);
  });

  if (!native)
    return (
      <div className="app-shell browser-preview">
        <header className="titlebar">
          <Folder size={16} />
          <span>SimpleBench</span>
        </header>
        <main className="empty-message">
          <Terminal size={28} />
          <h1>Your development workspace</h1>
          <p>Open the desktop app to use local projects and terminals.</p>
        </main>
      </div>
    );
  if (!session || !info || !selected)
    return (
      <div className="app-shell">
        <main className="empty-message">
          <Layers size={28} />
          <h1>SimpleBench</h1>
          <p>{error || "Restoring your workspace…"}</p>
          {error && (
            <button
              className="button"
              onClick={() => {
                bootstrap = undefined;
                window.location.reload();
              }}
            >
              Try again
            </button>
          )}
        </main>
      </div>
    );
  const { project, workspace, tab } = selected;
  const profile =
    tab.type === "terminal"
      ? info.profiles.find((profile) => profile.id === tab.profileId)
      : undefined;
  const allPanes = tab.type === "terminal" ? panes(tab.layout) : [];
  const sidebar =
    session.sidebar === "git" && !git.status ? null : session.sidebar;
  const selectProject = async (path: string) => {
    try {
      const normalized = await api<string>("validate_directory", { path });
      change((state) => {
        const found = state.projects.find(
          (project) => project.path === normalized,
        );
        const added =
          found ?? newProject(normalized, info.profiles[0]?.id ?? "");
        return {
          ...state,
          projects: found ? state.projects : [...state.projects, added],
          activeProjectId: added.id,
        };
      });
      setMenu(null);
    } catch (error) {
      setError(errorMessage(error));
    }
  };
  const browse = async () => {
    try {
      const path = await open({
        directory: true,
        multiple: false,
        defaultPath: project.path,
        title: "Choose a project folder",
      });
      if (path) await selectProject(path);
    } catch (error) {
      setError(errorMessage(error));
    }
  };
  const selectTab = (id: string) =>
    change((state) =>
      updateWorkspace(state, workspace.id, (workspace) => ({
        ...workspace,
        activeTabId: id,
      })),
    );
  const modifyTab = (transform: (tab: TerminalTab) => TerminalTab) =>
    change((state) =>
      updateTab(state, tab.id, (tab) =>
        tab.type === "terminal" ? transform(tab) : tab,
      ),
    );
  const split = (axis: Split["axis"], paneId?: string) => {
    const state = currentSession.current;
    const selection = state ? active(state) : undefined;
    const container = terminalLayout.current;
    if (!container || !selection) return;
    const current = selection.tab;
    if (current.type !== "terminal") return;
    const targetId = paneId ?? current.activePaneId;
    if (
      !canSplitPane(current.layout, targetId, axis, {
        width: container.clientWidth,
        height: container.clientHeight,
      })
    ) {
      setPaneNotice(
        "No room for another terminal in this direction. Enlarge the window, hide the sidebar, or resize the panels.",
      );
      return;
    }
    const pane = panes(current.layout).find((pane) => pane.id === targetId)!;
    const added = newPane(
      runningTerminal(pane.id)?.getSnapshot().cwd ?? pane.cwd,
    );
    setPaneNotice("");
    change((state) =>
      updateTab(state, current.id, (tab) => ({
        ...tab,
        layout: splitPane(current.layout, pane.id, axis, added),
        activePaneId: added.id,
      })),
    );
  };
  const closePane = (id: string) => {
    const state = currentSession.current;
    if (!state) return;
    const current = active(state)?.tab;
    if (!current || current.type !== "terminal") return;
    if (!panes(current.layout).some((pane) => pane.id === id)) return;
    if (current.layout.type === "terminal") {
      closeTab(current.id);
      return;
    }
    closeTerminals([id]);
    change((state) =>
      updateTab(state, current.id, (tab) => {
        if (tab.type !== "terminal") return tab;
        const layout = removePane(tab.layout, id)!;
        return {
          ...tab,
          layout,
          activePaneId:
            tab.activePaneId === id ? panes(layout)[0].id : tab.activePaneId,
        };
      }),
    );
  };
  const restartPane = (id: string, useProjectDirectory = false) => {
    closeTerminals([id]);
    modifyTab((tab) => {
      let activePaneId = tab.activePaneId;
      const layout = mapLayout(tab.layout, (pane) => {
        if (pane.id !== id) return pane;
        const added = newPane(useProjectDirectory ? project.path : pane.cwd);
        if (activePaneId === id) activePaneId = added.id;
        return added;
      });
      return { ...tab, layout, activePaneId };
    });
  };
  const preview = async (relative: string) => {
    try {
      const content = await api<string>("preview_file", {
        root: project.path,
        relative,
      });
      setDialog({ type: "preview", title: relative, content });
    } catch (error) {
      setError(errorMessage(error));
    }
  };
  const diff = async (path: string, staged: boolean) => {
    try {
      const content = await api<string>("git_diff", {
        root: project.path,
        path,
        staged,
      });
      setDialog({
        type: "preview",
        title: `${staged ? "Staged" : "Working tree"} · ${path}`,
        content,
      });
    } catch (error) {
      setError(errorMessage(error));
    }
  };

  return (
    <div className="app-shell">
      <header className="titlebar" data-tauri-drag-region>
        <div className="titlebar-project">
          <button
            className="project-switcher"
            data-menu-trigger
            aria-expanded={menu === "project"}
            title={project.path}
            onClick={() => {
              setLocation(project.path);
              setMenu(menu === "project" ? null : "project");
            }}
          >
            <Folder size={15} />
            <span>{basename(project.path)}</span>
            <ChevronDown size={12} />
          </button>
          {menu === "project" && (
            <Menu className="project-menu" onClose={closeMenu}>
              <span className="menu-label">PROJECT LOCATION</span>
              <form
                className="location-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void selectProject(location);
                }}
              >
                <input
                  aria-label="Project location"
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  autoFocus
                />
                <button className="button" type="submit">
                  Open
                </button>
              </form>
              <button className="menu-item" onClick={() => void browse()}>
                <FolderOpen size={15} />
                Browse for a folder…
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  void writeText(project.path).catch((error) =>
                    setError(errorMessage(error)),
                  );
                  setMenu(null);
                }}
              >
                <Copy size={14} />
                Copy project path
              </button>
              <div className="menu-divider" />
              <span className="menu-label">PROJECTS</span>
              <div className="recent-projects">
                {session.projects.map((candidate) => (
                  <button
                    className={`menu-item${candidate.id === project.id ? " selected" : ""}`}
                    key={candidate.id}
                    title={candidate.path}
                    onClick={() => void selectProject(candidate.path)}
                  >
                    <Folder size={14} />
                    <span className="project-menu-path">
                      <strong>{basename(candidate.path)}</strong>
                      <small>{candidate.path}</small>
                    </span>
                  </button>
                ))}
              </div>
            </Menu>
          )}
        </div>
        <div className="titlebar-workspace">
          <button
            className="workspace-switcher"
            data-menu-trigger
            aria-expanded={menu === "workspace"}
            aria-label="Switch workspace"
            title="Switch workspace"
            onClick={() => setMenu(menu === "workspace" ? null : "workspace")}
          >
            <Layers size={14} />
            <span>{workspace.name}</span>
            <ChevronDown size={12} />
          </button>
          {menu === "workspace" && (
            <Menu className="workspace-menu" onClose={closeMenu}>
              <span className="menu-label">WORKSPACES</span>
              {project.workspaces.map((candidate) => (
                <button
                  className={`menu-item${candidate.id === workspace.id ? " selected" : ""}`}
                  key={candidate.id}
                  onClick={() => {
                    change((state) => ({
                      ...state,
                      projects: state.projects.map((project) =>
                        project.id === selected.project.id
                          ? { ...project, activeWorkspaceId: candidate.id }
                          : project,
                      ),
                    }));
                    setMenu(null);
                  }}
                >
                  <Layers size={14} />
                  <span>{candidate.name}</span>
                  <span className="count-badge">{candidate.tabs.length}</span>
                </button>
              ))}
              <div className="menu-divider" />
              <button
                className="menu-item"
                onClick={() => {
                  setMenu(null);
                  setDialog({
                    type: "name",
                    title: "New workspace",
                    initial: "",
                    submit: (name) => {
                      const added = newWorkspace(
                        project.path,
                        info.profiles[0]?.id ?? "",
                        name,
                      );
                      change((state) => ({
                        ...state,
                        projects: state.projects.map((candidate) =>
                          candidate.id === project.id
                            ? {
                                ...candidate,
                                workspaces: [...candidate.workspaces, added],
                                activeWorkspaceId: added.id,
                              }
                            : candidate,
                        ),
                      }));
                    },
                  });
                }}
              >
                <Plus size={14} />
                New workspace
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  setMenu(null);
                  setDialog({
                    type: "name",
                    title: "Rename workspace",
                    initial: workspace.name,
                    submit: (name) =>
                      change((state) =>
                        updateWorkspace(state, workspace.id, (workspace) => ({
                          ...workspace,
                          name,
                        })),
                      ),
                  });
                }}
              >
                Rename workspace
              </button>
              <button
                className="menu-item"
                disabled={project.workspaces.length === 1}
                onClick={() => {
                  setMenu(null);
                  setDialog({
                    type: "confirm",
                    title: "Delete workspace",
                    text: `Delete “${workspace.name}” and close all of its terminals?`,
                    submit: () => {
                      closeTerminals(
                        workspace.tabs.flatMap((tab) =>
                          tab.type === "terminal"
                            ? panes(tab.layout).map((pane) => pane.id)
                            : [],
                        ),
                      );
                      change((state) => ({
                        ...state,
                        projects: state.projects.map((candidate) => {
                          if (candidate.id !== project.id) return candidate;
                          const workspaces = candidate.workspaces.filter(
                            (item) => item.id !== workspace.id,
                          );
                          return {
                            ...candidate,
                            workspaces,
                            activeWorkspaceId: workspaces[0].id,
                          };
                        }),
                      }));
                    },
                  });
                }}
              >
                Delete workspace…
              </button>
            </Menu>
          )}
        </div>
        <div
          className="tab-strip"
          role="tablist"
          aria-label="Workspace tabs"
          onWheel={(event) => {
            if (Math.abs(event.deltaY) > Math.abs(event.deltaX))
              event.currentTarget.scrollLeft += event.deltaY;
          }}
        >
          {workspace.tabs.map((candidate, index) => (
            <div
              className={`tab${candidate.id === tab.id ? " active-tab" : ""}`}
              key={candidate.id}
            >
              <button
                id={`tab-${candidate.id}`}
                role="tab"
                aria-selected={candidate.id === tab.id}
                aria-controls={`panel-${candidate.id}`}
                tabIndex={candidate.id === tab.id ? 0 : -1}
                title={candidate.title}
                onClick={() => selectTab(candidate.id)}
                onDoubleClick={() =>
                  setDialog({
                    type: "name",
                    title: "Rename tab",
                    initial: candidate.title,
                    submit: (title) =>
                      change((state) =>
                        updateTab(state, candidate.id, (tab) => ({
                          ...tab,
                          title,
                        })),
                      ),
                  })
                }
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    event.preventDefault();
                    const next =
                      workspace.tabs[
                        (index +
                          (event.key === "ArrowLeft" ? -1 : 1) +
                          workspace.tabs.length) %
                          workspace.tabs.length
                      ];
                    selectTab(next.id);
                    requestAnimationFrame(() =>
                      document.getElementById(`tab-${next.id}`)?.focus(),
                    );
                  }
                }}
              >
                {candidate.type === "commit" ? (
                  <GitCommitHorizontal size={13} />
                ) : (
                  <Terminal size={13} />
                )}
                <span>{candidate.title}</span>
              </button>
              <button
                className="tab-close"
                aria-label={`Close ${candidate.title}`}
                title="Close tab and its terminals"
                onClick={() => closeTab(candidate.id)}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <IconButton title="New tab (Ctrl+Shift+T)" onClick={() => addTab()}>
            <Plus size={16} />
          </IconButton>
        </div>
        <div className="titlebar-space" data-tauri-drag-region />
        <IconButton title="Settings (Ctrl+,)" onClick={openSettings}>
          <Settings size={16} />
        </IconButton>
        <WindowControls onError={setError} />
      </header>
      {(error || restoreError) && (
        <div className="notice" role="alert">
          <span>{error || restoreError}</span>
          {restoreError && (
            <button
              className="text-button"
              onClick={() => {
                savingEnabled.current = true;
                setRestoreError("");
                void saveSession(session).catch((error) =>
                  setError(errorMessage(error)),
                );
              }}
            >
              Save current layout instead
            </button>
          )}
          <IconButton title="Dismiss message" onClick={() => setError("")}>
            <X size={14} />
          </IconButton>
        </div>
      )}
      <div className="work-area">
        {sidebar && (
          <>
            <aside className="sidebar" style={{ width: session.sidebarWidth }}>
              {sidebar === "files" ? (
                <Explorer
                  key={project.path}
                  root={project.path}
                  onTerminal={addTab}
                  onPreview={(relative) => void preview(relative)}
                  onError={setError}
                />
              ) : (
                <SourceControl
                  key={project.path}
                  status={git.status}
                  onRefresh={git.refresh}
                  onDiff={(path, staged) => void diff(path, staged)}
                  onOpenCommit={(commit) =>
                    change((state) =>
                      openCommitTab(
                        state,
                        workspace.id,
                        git.status!.root,
                        commit.id,
                        `${commit.shortId} · ${commit.subject || "Commit"}`,
                      ),
                    )
                  }
                  onError={setError}
                />
              )}
            </aside>
            <div
              className="sidebar-divider"
              role="separator"
              aria-label="Resize sidebar"
              aria-orientation="vertical"
              aria-valuenow={session.sidebarWidth}
              aria-valuemin={180}
              aria-valuemax={520}
              tabIndex={0}
              onKeyDown={(event) => {
                if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
                  event.preventDefault();
                  change((state) => ({
                    ...state,
                    sidebarWidth: Math.max(
                      180,
                      Math.min(
                        520,
                        state.sidebarWidth +
                          (event.key === "ArrowLeft" ? -20 : 20),
                      ),
                    ),
                  }));
                }
              }}
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  change((state) => ({
                    ...state,
                    sidebarWidth: Math.max(
                      180,
                      Math.min(520, window.innerWidth * 0.5, event.clientX),
                    ),
                  }));
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
              }}
            />
          </>
        )}
        <main
          className="terminal-stage"
          id={`panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${tab.id}`}
        >
          {tab.type === "commit" ? (
            <CommitDetails key={tab.id} root={tab.root} commitId={tab.commit} />
          ) : (
            <>
              <div className="tab-context">
                <span className="tab-context-path" title={project.path}>
                  {project.path}
                </span>
                <label>
                  <span>Environment</span>
                  <select
                    aria-label="Tab environment"
                    value={tab.profileId}
                    onChange={(event) => {
                      const profileId = event.target.value;
                      setDialog({
                        type: "confirm",
                        title: "Change terminal environment",
                        text: "This will restart the terminals in this tab in the project folder. Continue?",
                        submit: () => {
                          closeTerminals(allPanes.map((pane) => pane.id));
                          const layout = mapLayout(tab.layout, () =>
                            newPane(project.path),
                          );
                          modifyTab((tab) => ({
                            ...tab,
                            profileId,
                            layout,
                            activePaneId: panes(layout)[0].id,
                          }));
                        },
                      });
                    }}
                  >
                    {!profile && (
                      <option value={tab.profileId}>
                        Unavailable environment
                      </option>
                    )}
                    {info.profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.distro
                          ? profile.name
                          : `Local · ${profile.name}`}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="terminal-layout" ref={terminalLayout}>
                <SplitView
                  key={tab.id}
                  layout={tab.layout}
                  profile={profile}
                  activePaneId={tab.activePaneId}
                  onFocus={(id) => {
                    if (id !== tab.activePaneId)
                      modifyTab((tab) => ({ ...tab, activePaneId: id }));
                  }}
                  onSplit={(pane, axis) => split(axis, pane.id)}
                  onClose={closePane}
                  onRestart={restartPane}
                  onKeepActivePane={() => {
                    const kept = allPanes.find(
                      (pane) => pane.id === tab.activePaneId,
                    )!;
                    closeTerminals(
                      allPanes
                        .filter((pane) => pane.id !== kept.id)
                        .map((pane) => pane.id),
                    );
                    modifyTab((tab) => ({ ...tab, layout: kept }));
                    setPaneNotice("");
                  }}
                  onResize={(id, ratio) =>
                    modifyTab((tab) => ({
                      ...tab,
                      layout: resizeSplit(tab.layout, id, ratio),
                    }))
                  }
                />
              </div>
              {paneNotice && (
                <div className="pane-limit-notice" role="status">
                  <span>{paneNotice}</span>
                  <IconButton
                    title="Dismiss panel limit"
                    onClick={() => setPaneNotice("")}
                  >
                    <X size={14} />
                  </IconButton>
                </div>
              )}
            </>
          )}
        </main>
      </div>
      <footer className="statusbar">
        <IconButton
          title="Toggle file explorer (Ctrl+Shift+E)"
          aria-pressed={sidebar === "files"}
          onClick={() =>
            change((state) => ({
              ...state,
              sidebar: state.sidebar === "files" ? null : "files",
            }))
          }
        >
          <PanelLeft size={15} />
        </IconButton>
        {git.status && (
          <>
            <IconButton
              title="Toggle source control (Ctrl+Shift+G)"
              aria-pressed={sidebar === "git"}
              onClick={() =>
                change((state) => ({
                  ...state,
                  sidebar: state.sidebar === "git" ? null : "git",
                }))
              }
            >
              <GitBranch size={15} />
            </IconButton>
            <span className="status-divider" />
            <button
              className="branch-status"
              title="Show source control"
              onClick={() => change((state) => ({ ...state, sidebar: "git" }))}
            >
              <GitBranch size={12} />
              {git.status.branch}
              {git.status.changes.length > 0 && (
                <span className="count-badge">{git.status.changes.length}</span>
              )}
            </button>
          </>
        )}
        {git.error && (
          <span className="status-warning" title={git.error}>
            Git unavailable
          </span>
        )}
        <span className="status-spacer" />
        <span>
          {workspace.tabs.length} {workspace.tabs.length === 1 ? "tab" : "tabs"}
        </span>
        <span className="status-divider" />
        <span>
          {allPanes.length} {allPanes.length === 1 ? "terminal" : "terminals"}
        </span>
        <span className="status-divider" />
        <span>SimpleBench</span>
      </footer>
      {dialog && <AppDialog dialog={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}

function AppDialog({
  dialog,
  onClose,
}: {
  dialog: Dialog;
  onClose: () => void;
}) {
  const [value, setValue] = useState(
    dialog.type === "name" ? dialog.initial : "",
  );
  return (
    <Modal
      title={dialog.title}
      onClose={onClose}
      wide={dialog.type === "preview"}
    >
      {dialog.type === "preview" ? (
        <pre className="file-preview">{dialog.content || "(empty file)"}</pre>
      ) : (
        <form
          className="dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (dialog.type === "name") {
              if (!value.trim()) return;
              dialog.submit(value.trim());
            } else dialog.submit();
            onClose();
          }}
        >
          {dialog.type === "name" ? (
            <label>
              Name
              <input
                autoFocus
                value={value}
                onChange={(event) => setValue(event.target.value)}
                maxLength={120}
              />
            </label>
          ) : (
            <p>{dialog.text}</p>
          )}
          <div className="dialog-actions">
            <button type="button" className="button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="button button-primary"
              disabled={dialog.type === "name" && !value.trim()}
            >
              {dialog.type === "name" ? "Save" : "Continue"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
