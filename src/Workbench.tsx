import Sidebar from "./Sidebar";
import Select from "./Select";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ChevronDown,
  Folder,
  GitBranch,
  Layers,
  PanelLeft,
  Plus,
  Settings,
  Terminal,
  X,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
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
  mergeTerminalTabs,
  moveTab,
  newPane,
  newProject,
  newTab,
  newWorkspace,
  openCommitTab,
  openFileTab,
  panes,
  removePane,
  removeTabs,
  resizeSplit,
  restoreSession,
  splitPane,
  tabsToClose,
  updateDirectories,
  updateTab,
  updateWorkspace,
} from "./model";
import type {
  AppInfo,
  Session,
  ShellProfile,
  Split,
  TabCloseAction,
  TerminalTab,
} from "./model";
import {
  closeTerminals,
  configureTerminals,
  observedDirectories,
  runningTerminal,
} from "./terminal-runtime";
import { dropPaths, terminalAt } from "./file-drag";
import { IconButton, Menu, Modal, WindowControls } from "./ui";
import Explorer from "./Explorer";
import ProjectSwitcher from "./ProjectSwitcher";
import SourceControl from "./SourceControl";
import CommitDetails from "./CommitDetails";
import SplitView from "./SplitView";
import TabBar from "./TabBar";
import FileEditorStatus from "./FileEditorStatus";
import { useKeybindings } from "./KeybindingsProvider";
import { actionForEvent, isTextInput, shortcutTitle } from "./keybindings";
import {
  captureEditorPositions,
  editorRevision,
  loadedEditor,
  retainEditorTabs,
  subscribeEditors,
} from "./editor-service";
import { useEditorCloseGuard } from "./EditorCloseGuard";
import "@xterm/xterm/css/xterm.css";

const FileEditor = lazy(() => import("./FileEditor"));

type Dialog =
  | {
      type: "name";
      title: string;
      initial: string;
      submit: (name: string) => void;
    }
  | { type: "confirm"; title: string; text: string; submit: () => void }
  | {
      type: "environment";
      title: string;
      profiles: ShellProfile[];
      selected: string;
      submit: (profileId: string) => void;
    }
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
  const closeGuard = useEditorCloseGuard();
  useSyncExternalStore(subscribeEditors, editorRevision);
  const fileOpenRequest = useRef(0);
  const preferences = useKeybindings();
  const { bindings } = preferences;
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
      retainEditorTabs(next);
      renderSession(next);
    },
    [],
  );
  const [error, setError] = useState("");
  const [restoreError, setRestoreError] = useState("");
  const [paneNotice, setPaneNotice] = useState("");
  const [menu, setMenu] = useState<"project" | "workspace" | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const terminalLayout = useRef<HTMLDivElement>(null);
  const savingEnabled = useRef(false);
  const selected = session ? active(session) : undefined;
  const git = useGit(selected?.project.path ?? "");
  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    if (preferences.error) setError(preferences.error);
  }, [preferences.error]);
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
        void saveSession(captureEditorPositions(session)).catch((error) =>
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
        if (!(await closeGuard.confirm())) {
          closing = false;
          return;
        }
        if (currentSession.current && savingEnabled.current) {
          await saveSession(captureEditorPositions(currentSession.current));
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
    if (!native) return;
    void getCurrentWindow()
      .setTitle(
        selected
          ? `${basename(selected.project.path)} — ${selected.workspace.name} — SimpleBench`
          : "SimpleBench",
      )
      .catch(() => {});
  }, [selected?.project.path, selected?.workspace.name]);

  const change = (transform: (state: Session) => Session) =>
    setSession((state) => (state ? transform(state) : state));
  const addTab = (cwd?: string) =>
    change((state) => {
      const selection = active(state);
      if (!selection) return state;
      const { project, workspace, tab } = selection;
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
  const closeTab = async (id: string, action: TabCloseAction = "close") => {
    const state = currentSession.current;
    if (!state) return;
    const selection = active(state);
    if (!selection) return;
    const { project, workspace } = selection;
    const tab = workspace.tabs.find((tab) => tab.id === id);
    if (!tab) return;
    const modified = new Set(
      workspace.tabs
        .filter((tab) => tab.type === "file" && loadedEditor(tab)?.dirty)
        .map((tab) => tab.id),
    );
    const ids = new Set(
      tabsToClose(workspace.tabs, id, action, modified).map((tab) => tab.id),
    );
    if (!ids.size || !(await closeGuard.confirm(ids))) return;
    const current = currentSession.current?.projects
      .find((candidate) => candidate.id === project.id)
      ?.workspaces.find((candidate) => candidate.id === workspace.id);
    if (!current) return;
    closeTerminals(
      current.tabs.flatMap((tab) =>
        ids.has(tab.id) && tab.type === "terminal"
          ? panes(tab.layout).map((pane) => pane.id)
          : [],
      ),
    );
    change((state) =>
      updateWorkspace(state, workspace.id, (workspace) =>
        removeTabs(
          workspace,
          ids,
          project.path,
          tab.type === "terminal"
            ? tab.profileId
            : (info?.profiles[0]?.id ?? ""),
        ),
      ),
    );
  };
  const openSettings = () => {
    setMenu(null);
    void api("open_settings").catch((error) => setError(errorMessage(error)));
  };
  useEffect(() => {
    if (!session || !info || !preferences.ready) return;
    const keyboard = (event: KeyboardEvent) => {
      const selected = currentSession.current && active(currentSession.current);
      const inEditor =
        event.target instanceof Element &&
        !!event.target.closest(".file-editor");
      if (
        event.defaultPrevented ||
        document.querySelector("dialog[open]") ||
        (event.target instanceof Element &&
          event.target.closest(".tab-context-menu, .editor-status-menu")) ||
        (isTextInput(event.target) && !inEditor)
      )
        return;
      const action = actionForEvent(event, bindings);
      if (!action || action === "runCommand") return;
      const editorAction = [
        "saveFile",
        "findFile",
        "goToLine",
        "toggleWordWrap",
      ].includes(action);
      if (editorAction && selected?.tab.type !== "file") return;
      if (
        selected?.tab.type !== "terminal" &&
        [
          "newTerminal",
          "splitVertical",
          "searchTerminal",
          "commandInput",
          "commandBlocks",
          "copyTerminal",
          "pasteTerminal",
          "changeEnvironment",
        ].includes(action)
      )
        return;
      if (!selected && action !== "openSettings") return;
      if (action === "toggleSourceControl" && !git.status) return;
      if (
        (action === "copyTerminal" || action === "pasteTerminal") &&
        !(
          event.target instanceof Element &&
          event.target.classList.contains("xterm-helper-textarea")
        )
      )
        return;
      // Capture application shortcuts before xterm can forward them to the PTY.
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      setMenu(null);
      if (action === "openSettings") {
        openSettings();
        return;
      }
      if (!selected) return;
      const { workspace, tab } = selected;
      const runtime =
        tab.type === "terminal" ? runningTerminal(tab.activePaneId) : undefined;
      switch (action) {
        case "saveFile":
          if (tab.type === "file") {
            const document = loadedEditor(tab);
            void document
              ?.save()
              .catch((error) => document.reportError(errorMessage(error)));
          }
          break;
        case "findFile":
        case "goToLine":
        case "toggleWordWrap":
          if (tab.type === "file") loadedEditor(tab)?.command(action);
          break;
        case "newTerminal":
        case "splitVertical": {
          if (tab.type !== "terminal") break;
          split(action === "newTerminal" ? "horizontal" : "vertical");
          break;
        }
        case "closeTerminal":
          if (tab.type === "terminal") closePane(tab.activePaneId);
          else closeTab(tab.id);
          break;
        case "searchTerminal":
          runtime?.toggleView("searchOpen");
          break;
        case "commandInput":
          runtime?.toggleView("composerOpen");
          break;
        case "commandBlocks":
          runtime?.toggleView("blocksOpen");
          break;
        case "copyTerminal":
          void runtime?.copy();
          break;
        case "pasteTerminal":
          void runtime?.pasteClipboard();
          break;
        case "changeEnvironment":
          changeEnvironment();
          break;
        case "newTab":
          addTab();
          break;
        case "closeTab":
          closeTab(tab.id);
          break;
        case "toggleExplorer":
          change((state) => ({
            ...state,
            sidebar: state.sidebar === "files" ? null : "files",
          }));
          break;
        case "toggleSourceControl":
          change((state) => ({
            ...state,
            sidebar: state.sidebar === "git" ? null : "git",
          }));
          break;
        case "nextTab":
        case "previousTab": {
          const index =
            (workspace.tabs.findIndex((candidate) => candidate.id === tab.id) +
              (action === "previousTab" ? -1 : 1) +
              workspace.tabs.length) %
            workspace.tabs.length;
          change((state) =>
            updateWorkspace(state, workspace.id, (workspace) => ({
              ...workspace,
              activeTabId: workspace.tabs[index].id,
            })),
          );
          break;
        }
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
  if (!session || !info || !preferences.ready)
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
  const selectProject = async (path: string) => {
    setMenu(null);
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
          projects: [
            added,
            ...state.projects.filter((project) => project.id !== added.id),
          ],
          activeProjectId: added.id,
        };
      });
    } catch (error) {
      setError(errorMessage(error));
    }
  };
  const browse = async () => {
    setMenu(null);
    try {
      const path = await open({
        directory: true,
        multiple: false,
        defaultPath: selected?.project.path ?? info.home,
        title: "Open Local Folder",
      });
      if (path) await selectProject(path);
    } catch (error) {
      setError(errorMessage(error));
    }
  };
  const projectPicker = (
    <ProjectSwitcher
      projects={session.projects}
      activeProjectId={session.activeProjectId}
      expanded={menu === "project"}
      onToggle={() => setMenu(menu === "project" ? null : "project")}
      onClose={closeMenu}
      onSelect={(path) => void selectProject(path)}
      onBrowse={() => void browse()}
    />
  );
  const notice = (error || restoreError) && (
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
  );
  if (!selected)
    return (
      <div className="app-shell">
        <header className="titlebar" data-tauri-drag-region>
          {projectPicker}
          <div className="titlebar-space" data-tauri-drag-region />
          <IconButton
            title={shortcutTitle("Settings", bindings.openSettings)}
            onClick={openSettings}
          >
            <Settings size={16} />
          </IconButton>
          <WindowControls onError={setError} />
        </header>
        {notice}
        <main className="work-area" aria-label="No project open" />
        {closeGuard.dialog}
      </div>
    );
  const { project, workspace, tab } = selected;
  const editorDocument = tab.type === "file" ? loadedEditor(tab) : undefined;
  const profile =
    tab.type === "terminal"
      ? info.profiles.find((profile) => profile.id === tab.profileId)
      : undefined;
  const allPanes = tab.type === "terminal" ? panes(tab.layout) : [];
  const sidebar =
    session.sidebar === "git" && !git.status ? null : session.sidebar;
  const selectTab = (id: string) =>
    change((state) =>
      updateWorkspace(state, workspace.id, (workspace) => ({
        ...workspace,
        activeTabId: id,
      })),
    );
  const modifyTab = (transform: (tab: TerminalTab) => TerminalTab) =>
    change((state) =>
      updateTab(state, tab.id, (current) =>
        current.type === "terminal" ? transform(current) : current,
      ),
    );
  const split = (axis: Split["axis"]) => {
    const state = currentSession.current;
    const selection = state ? active(state) : undefined;
    const container = terminalLayout.current;
    if (!container || selection?.tab.type !== "terminal") return;
    const current = selection.tab;
    const hoveredId = container.querySelector<HTMLElement>(
      ".terminal-pane[data-pane-id]:hover",
    )?.dataset.paneId;
    const currentPanes = panes(current.layout);
    const pane =
      currentPanes.find((pane) => pane.id === hoveredId) ??
      currentPanes.find((pane) => pane.id === current.activePaneId);
    if (!pane) return;
    if (
      !canSplitPane(current.layout, pane.id, axis, {
        width: container.clientWidth,
        height: container.clientHeight,
      })
    ) {
      setPaneNotice(
        "No room for another terminal in this direction. Enlarge the window, hide the sidebar, or resize the panels.",
      );
      return;
    }
    const added = newPane(
      runningTerminal(pane.id)?.getSnapshot().cwd ?? pane.cwd,
    );
    if (pane.profileId !== undefined) added.profileId = pane.profileId;
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
    if (current?.type !== "terminal") return;
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
        if (pane.profileId !== undefined) added.profileId = pane.profileId;
        if (activePaneId === id) activePaneId = added.id;
        return added;
      });
      return { ...tab, layout, activePaneId };
    });
  };
  const changeEnvironment = () => {
    if (tab.type !== "terminal") return;
    setDialog({
      type: "environment",
      title: "Change terminal environment",
      profiles: info.profiles,
      selected: tab.profileId,
      submit: (profileId) => {
        closeTerminals(allPanes.map((pane) => pane.id));
        const layout = mapLayout(tab.layout, () => newPane(project.path));
        modifyTab((tab) => ({
          ...tab,
          profileId,
          layout,
          activePaneId: panes(layout)[0].id,
        }));
      },
    });
  };
  const openFile = async (relative: string) => {
    const request = ++fileOpenRequest.current;
    try {
      const normalized = await api<string>("resolve_editor_file", {
        root: project.path,
        relative,
      });
      change((state) => {
        const previous = state.projects
          .flatMap((project) => project.workspaces)
          .find((candidate) => candidate.id === workspace.id)?.activeTabId;
        const next = openFileTab(state, workspace.id, project.path, normalized);
        return request === fileOpenRequest.current || !previous
          ? next
          : updateWorkspace(next, workspace.id, (workspace) => ({
              ...workspace,
              activeTabId: previous,
            }));
      });
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
        {projectPicker}
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
                    text: `Delete “${workspace.name}” and close all of its tabs?`,
                    submit: async () => {
                      if (
                        !(await closeGuard.confirm(
                          new Set(workspace.tabs.map((tab) => tab.id)),
                        ))
                      )
                        return;
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
        <TabBar
          key={workspace.id}
          tabs={workspace.tabs}
          modified={
            new Set(
              workspace.tabs
                .filter(
                  (tab) => tab.type === "file" && loadedEditor(tab)?.dirty,
                )
                .map((tab) => tab.id),
            )
          }
          activeTabId={tab.id}
          onSelect={selectTab}
          onClose={closeTab}
          mergeContainer={terminalLayout}
          onMove={(id, beforeId) =>
            change((state) =>
              updateWorkspace(state, workspace.id, (current) =>
                moveTab(current, id, beforeId),
              ),
            )
          }
          onMerge={(id, targetId, side) => {
            const container = terminalLayout.current;
            if (!container) return;
            change((state) =>
              updateWorkspace(state, workspace.id, (current) =>
                current.activeTabId === targetId
                  ? mergeTerminalTabs(current, id, targetId, side, {
                      width: container.clientWidth,
                      height: container.clientHeight,
                    })
                  : current,
              ),
            );
          }}
          onRename={(candidate) =>
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
        />
        <div className="titlebar-space" data-tauri-drag-region />
        <IconButton
          title={shortcutTitle("Settings", bindings.openSettings)}
          onClick={openSettings}
        >
          <Settings size={16} />
        </IconButton>
        <WindowControls onError={setError} />
      </header>
      {notice}
      <div className="work-area">
        {sidebar && (
          <>
            <Sidebar
              width={session.sidebarWidth}
              label={sidebar === "files" ? "Explorer" : "Source control"}
              onResize={(width) =>
                change((state) => ({ ...state, sidebarWidth: width }))
              }
            >
              {sidebar === "files" ? (
                <Explorer
                  key={project.path}
                  root={project.path}
                  onTerminal={addTab}
                  onOpenFile={(relative) => void openFile(relative)}
                  onError={setError}
                />
              ) : (
                <SourceControl
                  key={project.path}
                  status={git.status}
                  onRefresh={git.refresh}
                  onDiff={(path, staged) => void diff(path, staged)}
                  onOpenCommit={(commit) => {
                    if (!git.status) return;
                    const root = git.status.root;
                    change((state) =>
                      openCommitTab(
                        state,
                        workspace.id,
                        root,
                        commit.id,
                        `${commit.shortId} · ${commit.subject}`,
                      ),
                    );
                  }}
                  onError={setError}
                />
              )}
            </Sidebar>
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
          ) : tab.type === "file" ? (
            <Suspense
              fallback={
                <div className="empty-message" role="status">
                  Loading editor…
                </div>
              }
            >
              <FileEditor
                key={tab.id}
                tab={tab}
                onPosition={(position) =>
                  change((state) =>
                    updateTab(state, tab.id, (current) =>
                      current.type === "file"
                        ? { ...current, position }
                        : current,
                    ),
                  )
                }
              />
            </Suspense>
          ) : (
            <div className="terminal-layout" ref={terminalLayout}>
              <SplitView
                key={tab.id}
                layout={tab.layout}
                profile={profile}
                profiles={info.profiles}
                activePaneId={tab.activePaneId}
                onFocus={(id) => {
                  if (id !== tab.activePaneId)
                    modifyTab((tab) => ({ ...tab, activePaneId: id }));
                }}
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
          )}
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
        </main>
      </div>
      <footer className="statusbar">
        <IconButton
          title={shortcutTitle("Toggle file explorer", bindings.toggleExplorer)}
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
              title={shortcutTitle(
                "Toggle source control",
                bindings.toggleSourceControl,
              )}
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
        {editorDocument && (
          <FileEditorStatus
            key={editorDocument.path}
            document={editorDocument}
          />
        )}
      </footer>
      {dialog && <AppDialog dialog={dialog} onClose={() => setDialog(null)} />}
      {closeGuard.dialog}
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
    dialog.type === "name"
      ? dialog.initial
      : dialog.type === "environment"
        ? dialog.selected
        : "",
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
            } else if (dialog.type === "environment") {
              if (
                !dialog.profiles.some((profile) => profile.id === value) ||
                value === dialog.selected
              )
                return;
              dialog.submit(value);
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
          ) : dialog.type === "environment" ? (
            <>
              <label>
                Terminal environment
                <Select
                  autoFocus
                  aria-label="Terminal environment"
                  value={value}
                  onChange={setValue}
                  options={[
                    ...(!dialog.profiles.some(
                      (profile) => profile.id === dialog.selected,
                    )
                      ? [
                          {
                            value: dialog.selected,
                            label: "Unavailable environment",
                            disabled: true,
                          },
                        ]
                      : []),
                    ...dialog.profiles.map((profile) => ({
                      value: profile.id,
                      label: profile.distro
                        ? profile.name
                        : `Local · ${profile.name}`,
                    })),
                  ]}
                />
              </label>
              <p>
                Changing the environment restarts all terminals in this tab in
                the project folder.
              </p>
            </>
          ) : (
            <p>{dialog.text}</p>
          )}
          <div className="dialog-actions">
            <button type="button" className="button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="button button-primary"
              disabled={
                dialog.type === "name"
                  ? !value.trim()
                  : dialog.type === "environment" &&
                    (!value || value === dialog.selected)
              }
            >
              {dialog.type === "name"
                ? "Save"
                : dialog.type === "environment"
                  ? "Restart terminals"
                  : "Continue"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
