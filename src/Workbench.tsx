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
import { Folder, GitBranch, Layers, Settings, Terminal, X } from "lucide-react";
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
  activePanel,
  browserTabs,
  newBrowserTab,
  updateBrowser,
  addWorkspace,
  filesInTab,
  fileTabs,
  layoutPanes,
  updateFilePosition,
  updateMarkdownView,
  basename,
  canSplitPane,
  mapLayout,
  mergeTabs,
  moveTab,
  movePane,
  moveSidebar,
  showSidebar,
  toggleSidebar,
  newPane,
  newProject,
  newTab,
  newFileTab,
  openCommitTab,
  openFileTab,
  panes,
  removePane,
  removeTabs,
  removeWorkspace,
  resizeSplit,
  restoreSession,
  splitPane,
  tabsToClose,
  tabTitle,
  updateDirectories,
  updateTab,
  updateFile,
  updateWorkspace,
} from "./model";
import type {
  AppInfo,
  Session,
  ShellProfile,
  SidebarPanel,
  Split,
  TabCloseAction,
  TerminalTab,
  Workspace,
} from "./model";
import {
  closeTerminals,
  configureTerminals,
  observeTerminalContexts,
  runningTerminal,
} from "./terminal-runtime";
import type { TerminalContext } from "./terminal-runtime";
import { dropPaths, terminalAt } from "./file-drag";
import { IconButton, Modal, WindowControls } from "./ui";
import Explorer from "./Explorer";
import ProjectSwitcher from "./ProjectSwitcher";
import SourceControl from "./SourceControl";
import Sidebar from "./Sidebar";
import SidebarToggle from "./SidebarToggle";
import Workspaces from "./Workspaces";
import Welcome from "./Welcome";
import CommitDetails from "./CommitDetails";
import BrowserPane from "./BrowserPane";
import { configureBrowsers, retainBrowsers } from "./browser-runtime";
import SplitView from "./SplitView";
import { usePointerFocus } from "./usePointerFocus";
import { useWindowZoom } from "./useWindowZoom";
import TabBar from "./TabBar";
import FileEditorStatus from "./FileEditorStatus";
import { useKeybindings } from "./KeybindingsProvider";
import {
  actionForEvent,
  isTextInput,
  isZoomAction,
  shortcutTitle,
} from "./keybindings";
import {
  captureEditorPositions,
  editorRevision,
  loadedEditor,
  openEditorDocument,
  pauseEditorFileOperations,
  relocateEditorFiles,
  retainEditorTabs,
  subscribeEditors,
  subscribeEditorSaves,
} from "./editor-service";
import { useCloseGuard } from "./CloseGuard";
import { useCliTitleSetup } from "./CliTitleSetup";
import {
  absoluteFilePath,
  applyFileChange,
  containsPath,
} from "./explorer-model";
import type { FileChange, FileOperation } from "./explorer-model";
import type { SearchMatch } from "./ProjectSearch";
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
  const [results, setResults] = useState<
    Record<string, { status: GitStatus | null; error: string }>
  >({});
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
          setResults((previous) => ({
            ...previous,
            [root]: { status: next, error: "" },
          }));
        }
      } catch (error) {
        if (current) {
          setResults((previous) => ({
            ...previous,
            [root]: { status: null, error: errorMessage(error) },
          }));
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
    status: results[root]?.status ?? null,
    loading: !!root && !results[root],
    error: results[root]?.error ?? "",
    refresh,
  };
}

export default function Workbench() {
  const closeGuard = useCloseGuard();
  useSyncExternalStore(subscribeEditors, editorRevision);
  const fileOpenRequest = useRef(0);
  const fileOperationBusy = useRef(false);
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
      retainBrowsers(next);
      renderSession(next);
    },
    [],
  );
  const [error, setError] = useState("");
  useWindowZoom(setError);
  const [restoreError, setRestoreError] = useState("");
  useEffect(
    () =>
      subscribeEditorSaves((id, location) => {
        setSession((state) =>
          state
            ? updateFile(state, id, (file) => {
                const { untitled: _untitled, ...saved } = file;
                return {
                  ...saved,
                  ...location,
                  title: basename(location.relative),
                };
              })
            : state,
        );
      }),
    [setSession],
  );
  const [paneNotice, setPaneNotice] = useState("");
  const cliTitles = useCliTitleSetup(setError, setPaneNotice);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const folderPickerBusy = useRef(false);
  const [browsing, setBrowsing] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [terminalOverview, setTerminalOverview] = useState(false);
  const terminalLayout = useRef<HTMLDivElement>(null);
  usePointerFocus(
    preferences.focusFollowsPointer && !terminalOverview,
    terminalLayout,
  );
  const savingEnabled = useRef(false);
  const selected = session ? active(session) : undefined;
  const git = useGit(selected?.project.path ?? "");
  const closeProjectMenu = useCallback(() => setProjectMenuOpen(false), []);

  useEffect(() => {
    configureBrowsers(
      (id, change) =>
        setSession((state) =>
          state ? updateBrowser(state, id, change) : state,
        ),
      (id, url) =>
        setSession((state) => {
          if (!state) return state;
          const workspace = state.projects
            .flatMap((project) => project.workspaces)
            .find((workspace) =>
              workspace.tabs.some((tab) =>
                tab.type === "browser"
                  ? tab.id === id
                  : tab.type === "terminal" &&
                    layoutPanes(tab.layout).some((pane) => pane.id === id),
              ),
            );
          if (!workspace || !browserTabs(state).some((tab) => tab.id === id))
            return state;
          const added = newBrowserTab(url);
          return updateWorkspace(state, workspace.id, (current) => ({
            ...current,
            tabs: [...current.tabs, added],
            activeTabId: added.id,
          }));
        }),
      setError,
    );
  }, [setSession]);

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
      void api<Record<string, TerminalContext>>("terminal_contexts")
        .then((contexts) => {
          const directories = observeTerminalContexts(contexts);
          void cliTitles.observe(contexts);
          setSession((state) =>
            state ? updateDirectories(state, directories) : state,
          );
        })
        .catch(() => {});
    }, 1000);
    return () => clearInterval(timer);
  }, [info, cliTitles.observe]);
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
        .filter((tab) =>
          filesInTab(tab).some((file) => loadedEditor(file)?.dirty),
        )
        .map((tab) => tab.id),
    );
    const ids = new Set(
      tabsToClose(workspace.tabs, id, action, modified).map((tab) => tab.id),
    );
    const fileIds = new Set(
      workspace.tabs
        .filter((tab) => ids.has(tab.id))
        .flatMap(filesInTab)
        .map((file) => file.id),
    );
    if (
      !ids.size ||
      !(await closeGuard.confirm(
        fileIds,
        workspace.tabs.flatMap((tab) =>
          ids.has(tab.id) && tab.type === "terminal"
            ? panes(tab.layout).map((pane) => pane.id)
            : [],
        ),
      ))
    )
      return;
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
    setProjectMenuOpen(false);
    void api("open_settings").catch((error) => setError(errorMessage(error)));
  };
  useEffect(() => {
    if (!session || !info || !preferences.ready) return;
    const keyboard = (event: KeyboardEvent) => {
      const selected = currentSession.current && active(currentSession.current);
      const panel = selected && activePanel(selected.tab);
      const inEditor =
        event.target instanceof Element &&
        !!event.target.closest(".file-editor");
      const action = actionForEvent(event, bindings);
      if (
        event.defaultPrevented ||
        document.querySelector("dialog[open]") ||
        (event.target instanceof Element &&
          event.target.closest(
            ".tab-context-menu, .editor-status-menu, .sidebar-context-menu, .markdown-preview-menu, .explorer-context-menu",
          )) ||
        (isTextInput(event.target) &&
          !inEditor &&
          !(
            action === "terminalOverview" &&
            event.target instanceof Element &&
            event.target.closest(".terminal-pane")
          ))
      )
        return;
      if (!action || action === "runCommand" || isZoomAction(action)) return;
      if (
        action === "terminalOverview" &&
        (selected?.tab.type !== "terminal" ||
          !panes(selected.tab.layout).length)
      )
        return;
      const editorAction = [
        "saveFile",
        "findFile",
        "goToLine",
        "toggleWordWrap",
      ].includes(action);
      if (editorAction && panel?.type !== "file") return;
      if (
        ["newTerminal", "splitVertical"].includes(action) &&
        selected?.tab.type !== "terminal"
      )
        return;
      if (
        panel?.type !== "terminal" &&
        [
          "searchTerminal",
          "commandInput",
          "commandBlocks",
          "copyTerminal",
          "pasteTerminal",
          "changeEnvironment",
        ].includes(action)
      )
        return;
      if (
        !selected &&
        action !== "openSettings" &&
        action !== "toggleWorkspaces"
      )
        return;
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
      setProjectMenuOpen(false);
      if (action === "openSettings") {
        openSettings();
        return;
      }
      if (action === "toggleWorkspaces") {
        change((state) => toggleSidebar(state, "workspaces"));
        return;
      }
      if (!selected) return;
      const { workspace, tab } = selected;
      const runtime =
        panel?.type === "terminal" ? runningTerminal(panel.id) : undefined;
      switch (action) {
        case "terminalOverview":
          setTerminalOverview((shown) => !shown);
          break;
        case "saveFile":
          if (panel?.type === "file") {
            const document = loadedEditor(panel);
            void document
              ?.save()
              .catch((error) => document.reportError(errorMessage(error)));
          }
          break;
        case "findFile":
        case "goToLine":
        case "toggleWordWrap":
          if (panel?.type === "file") loadedEditor(panel)?.command(action);
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
          change((state) => toggleSidebar(state, "files"));
          break;
        case "toggleSourceControl":
          change((state) => toggleSidebar(state, "git"));
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
  const selectProject = async (
    path: string,
    {
      workspaceId,
      tabId,
      createFile = false,
    }: { workspaceId?: string; tabId?: string; createFile?: boolean } = {},
  ) => {
    setProjectMenuOpen(false);
    try {
      const normalized = await api<string>("validate_directory", { path });
      change((state) => {
        const found = state.projects.find(
          (project) => project.path === normalized,
        );
        if (workspaceId) {
          const workspace = found?.workspaces.find(
            (workspace) => workspace.id === workspaceId,
          );
          if (
            !found ||
            !workspace ||
            (tabId && !workspace.tabs.some((tab) => tab.id === tabId))
          )
            return state;
          return {
            ...state,
            activeProjectId: found.id,
            projects: state.projects.map((project) =>
              project.id === found.id
                ? {
                    ...project,
                    activeWorkspaceId: workspaceId,
                    workspaces: project.workspaces.map((workspace) =>
                      workspace.id === workspaceId && tabId
                        ? { ...workspace, activeTabId: tabId }
                        : workspace,
                    ),
                  }
                : project,
            ),
          };
        }
        const added =
          found ?? newProject(normalized, info.profiles[0]?.id ?? "");
        const next = {
          ...state,
          projects: [
            added,
            ...state.projects.filter((project) => project.id !== added.id),
          ],
          activeProjectId: added.id,
        };
        if (!createFile) return next;
        const file = newFileTab(next);
        return updateWorkspace(next, added.activeWorkspaceId, (workspace) => ({
          ...workspace,
          tabs: found ? [...workspace.tabs, file] : [file],
          activeTabId: file.id,
        }));
      });
    } catch (error) {
      setError(errorMessage(error));
    }
  };
  const browse = async (
    intent: "project" | "workspace" | "file" = "project",
  ) => {
    if (folderPickerBusy.current) return;
    folderPickerBusy.current = true;
    setBrowsing(true);
    setProjectMenuOpen(false);
    try {
      const path = await open({
        directory: true,
        multiple: false,
        defaultPath: selected?.project.path ?? info.home,
        title:
          intent === "workspace"
            ? "Choose workspace folder"
            : intent === "file"
              ? "Choose a folder for your new file"
              : "Open Local Folder",
      });
      if (!path) return;
      if (intent === "workspace") {
        const normalized = await api<string>("validate_directory", { path });
        const count =
          currentSession.current?.projects.find(
            (project) => project.path === normalized,
          )?.workspaces.length ?? 0;
        setDialog({
          type: "name",
          title: "New workspace",
          initial: `${basename(normalized)}${count ? ` ${count + 1}` : ""}`,
          submit: (name) =>
            change((state) =>
              addWorkspace(state, normalized, info.profiles[0]?.id ?? "", name),
            ),
        });
      } else await selectProject(path, { createFile: intent === "file" });
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      folderPickerBusy.current = false;
      setBrowsing(false);
    }
  };
  const projectPicker = (
    <ProjectSwitcher
      projects={session.projects}
      activeProjectId={session.activeProjectId}
      expanded={projectMenuOpen}
      onToggle={() => setProjectMenuOpen(!projectMenuOpen)}
      onClose={closeProjectMenu}
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
  const sidebarOpen = (panel: SidebarPanel) =>
    session.sidebarSides[panel] === "left"
      ? session.sidebar === panel
      : session.rightSidebar === panel;
  const workspaceSide = session.sidebarSides.workspaces;
  const workspaceWidthKey =
    workspaceSide === "left" ? "sidebarWidth" : "rightSidebarWidth";
  const deleteWorkspace = (workspace: Workspace) => {
    setDialog({
      type: "confirm",
      title: "Delete workspace",
      text: `Delete “${workspace.name}” and close all of its tabs? Files in its folder will remain on disk.`,
      submit: async () => {
        const current = () =>
          currentSession.current?.projects
            .flatMap((project) => project.workspaces)
            .find((candidate) => candidate.id === workspace.id);
        const target = current();
        if (
          !target ||
          !(await closeGuard.confirm(
            new Set(target.tabs.flatMap(filesInTab).map((file) => file.id)),
            target.tabs.flatMap((tab) =>
              tab.type === "terminal"
                ? panes(tab.layout).map((pane) => pane.id)
                : [],
            ),
          ))
        )
          return;
        const remaining = current();
        if (!remaining) return;
        closeTerminals(
          remaining.tabs.flatMap((tab) =>
            tab.type === "terminal"
              ? panes(tab.layout).map((pane) => pane.id)
              : [],
          ),
        );
        change((state) => removeWorkspace(state, workspace.id));
      },
    });
  };
  const workspacePanel = sidebarOpen("workspaces") && (
    <Sidebar
      key="workspaces"
      side={workspaceSide}
      width={session[workspaceWidthKey]}
      label="Workspaces"
      onResize={(width) =>
        change((state) => ({ ...state, [workspaceWidthKey]: width }))
      }
    >
      <Workspaces
        projects={session.projects}
        activeWorkspaceId={selected?.workspace.id}
        onSelect={(path, id, tabId) =>
          void selectProject(path, { workspaceId: id, tabId })
        }
        onNew={() => void browse("workspace")}
        onRename={(workspace) =>
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
          })
        }
        onDelete={deleteWorkspace}
      />
    </Sidebar>
  );
  const workspaceToggle = (
    <div className="status-panel-control" data-side={workspaceSide}>
      <SidebarToggle
        panel="workspaces"
        side={workspaceSide}
        active={sidebarOpen("workspaces")}
        title={shortcutTitle("Toggle workspaces", bindings.toggleWorkspaces)}
        onToggle={() => change((state) => toggleSidebar(state, "workspaces"))}
        onMove={(side) =>
          change((state) => moveSidebar(state, "workspaces", side))
        }
      />
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
        <div className="work-area">
          {workspacePanel}
          <Welcome
            busy={browsing}
            onOpenFolder={() => void browse()}
            onNewFile={() => void browse("file")}
          />
        </div>
        <footer className="statusbar">
          {workspaceToggle}
          <span className="status-spacer" />
        </footer>
        {dialog && (
          <AppDialog dialog={dialog} onClose={() => setDialog(null)} />
        )}
        {closeGuard.dialog}
        {cliTitles.dialog}
      </div>
    );
  const { project, workspace, tab } = selected;
  const panel = activePanel(tab);
  const editorDocument =
    panel?.type === "file" ? loadedEditor(panel) : undefined;
  const profile =
    tab.type === "terminal"
      ? info.profiles.find((profile) => profile.id === tab.profileId)
      : undefined;
  const allPanes = tab.type === "terminal" ? layoutPanes(tab.layout) : [];
  const sidebarPanels: SidebarPanel[] =
    git.status || (git.loading && sidebarOpen("git"))
      ? ["files", "git"]
      : ["files"];
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
    const pane = layoutPanes(current.layout).find(
      (pane) => pane.id === current.activePaneId,
    );
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
      pane.type === "terminal"
        ? (runningTerminal(pane.id)?.getSnapshot().cwd ?? pane.cwd)
        : selection.project.path,
    );
    if (pane.type === "terminal" && pane.profileId !== undefined)
      added.profileId = pane.profileId;
    setPaneNotice("");
    change((state) =>
      updateTab(state, current.id, (tab) => ({
        ...tab,
        layout: splitPane(current.layout, pane.id, axis, added),
        activePaneId: added.id,
      })),
    );
  };
  const closePane = async (id: string) => {
    const state = currentSession.current;
    if (!state) return;
    const current = active(state)?.tab;
    if (current?.type !== "terminal") return;
    const pane = layoutPanes(current.layout).find((pane) => pane.id === id);
    if (!pane) return;
    if (current.layout.type !== "split") {
      await closeTab(current.id);
      return;
    }
    if (
      !(await closeGuard.confirm(
        new Set(pane.type === "file" ? [id] : []),
        pane.type === "terminal" ? [id] : [],
      ))
    )
      return;
    if (pane.type === "terminal") closeTerminals([id]);
    change((state) =>
      updateTab(state, current.id, (tab) => {
        if (tab.type !== "terminal") return tab;
        const layout = removePane(tab.layout, id);
        if (!layout) return tab;
        return {
          ...tab,
          layout,
          activePaneId:
            tab.activePaneId === id
              ? layoutPanes(layout)[0].id
              : tab.activePaneId,
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
        if (pane.type === "terminal" && pane.profileId !== undefined)
          added.profileId = pane.profileId;
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
        closeTerminals(panes(tab.layout).map((pane) => pane.id));
        const layout = mapLayout(tab.layout, () => newPane(project.path));
        modifyTab((tab) => ({
          ...tab,
          profileId,
          layout,
          activePaneId: panel?.type === "file" ? panel.id : panes(layout)[0].id,
        }));
      },
    });
  };
  const openFile = async (
    relative: string,
    root = project.path,
    match?: SearchMatch,
  ) => {
    const request = ++fileOpenRequest.current;
    try {
      const normalized = await api<string>("resolve_editor_file", {
        root,
        relative,
      });
      change((state) => {
        const previous = state.projects
          .flatMap((project) => project.workspaces)
          .find((candidate) => candidate.id === workspace.id)?.activeTabId;
        const opened = openFileTab(state, workspace.id, root, normalized);
        const file = match
          ? opened.projects
              .flatMap((project) => project.workspaces)
              .find((candidate) => candidate.id === workspace.id)
              ?.tabs.flatMap(filesInTab)
              .find(
                (file) => file.root === root && file.relative === normalized,
              )
          : undefined;
        const next = file
          ? updateMarkdownView(opened, file.id, "editor")
          : opened;
        return request === fileOpenRequest.current || !previous
          ? next
          : updateWorkspace(next, workspace.id, (workspace) => ({
              ...workspace,
              activeTabId: previous,
            }));
      });
      if (match && request === fileOpenRequest.current) {
        const file = currentSession.current?.projects
          .flatMap((project) => project.workspaces)
          .find((candidate) => candidate.id === workspace.id)
          ?.tabs.flatMap(filesInTab)
          .find((file) => file.root === root && file.relative === normalized);
        if (file) {
          const document = await openEditorDocument(file);
          if (
            request === fileOpenRequest.current &&
            active(currentSession.current!)?.workspace.id === workspace.id
          )
            document.selectMatch(match);
        }
      }
    } catch (error) {
      setError(errorMessage(error));
    }
  };
  const operateFile = async (
    relative: string,
    operation: FileOperation,
  ): Promise<boolean> => {
    if (fileOperationBusy.current)
      throw new Error("Another file operation is in progress.");
    fileOperationBusy.current = true;
    let resume: (() => void) | undefined;
    try {
      const deleting =
        operation.kind === "trash" || operation.kind === "delete";
      const expectedPath = deleting
        ? await api<string>("resolve_project_entry", {
            root: project.path,
            relative,
          })
        : undefined;
      if (expectedPath) {
        const path = expectedPath;
        const ids = new Set(
          fileTabs(currentSession.current!)
            .filter(
              (file) =>
                containsPath(path, absoluteFilePath(file)) ||
                currentSession.current!.projects.some(
                  (project) =>
                    containsPath(path, project.path) &&
                    project.workspaces.some((workspace) =>
                      workspace.tabs
                        .flatMap(filesInTab)
                        .some((view) => view.id === file.id),
                    ),
                ),
            )
            .map((file) => file.id),
        );
        if (
          !(await closeGuard.confirm(
            ids,
            currentSession
              .current!.projects.filter((project) =>
                containsPath(path, project.path),
              )
              .flatMap((project) =>
                project.workspaces.flatMap((workspace) =>
                  workspace.tabs.flatMap((tab) =>
                    tab.type === "terminal"
                      ? panes(tab.layout).map((pane) => pane.id)
                      : [],
                  ),
                ),
              ),
          ))
        )
          return false;
      }
      resume = await pauseEditorFileOperations();
      const result = await api<FileChange>("file_operation", {
        root: project.path,
        relative,
        operation,
        expectedPath,
      });
      change((state) => {
        const next = applyFileChange(state, result, info.profiles[0]?.id ?? "");
        relocateEditorFiles(state, next);
        const kept = new Set(next.projects.map((project) => project.id));
        closeTerminals(
          state.projects
            .filter((project) => !kept.has(project.id))
            .flatMap((project) =>
              project.workspaces.flatMap((workspace) =>
                workspace.tabs.flatMap((tab) =>
                  tab.type === "terminal"
                    ? panes(tab.layout).map((pane) => pane.id)
                    : [],
                ),
              ),
            ),
        );
        return next;
      });
      git.refresh();
      return true;
    } finally {
      resume?.();
      fileOperationBusy.current = false;
    }
  };
  const openHistoryCommit = (
    commit: import("./api").GitCommitSummary,
    root = git.status?.root,
  ) => {
    if (!root) return;
    change((state) =>
      openCommitTab(
        state,
        workspace.id,
        root,
        commit.id,
        `${commit.shortId} · ${commit.subject}`,
      ),
    );
  };
  const diff = async (path: string, staged: boolean) => {
    try {
      const content = await api<string>("git_diff", {
        root: git.status?.root ?? project.path,
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
        <TabBar
          key={workspace.id}
          tabs={workspace.tabs}
          modified={
            new Set(
              workspace.tabs
                .filter((tab) =>
                  filesInTab(tab).some((file) => loadedEditor(file)?.dirty),
                )
                .map((tab) => tab.id),
            )
          }
          activeTabId={tab.id}
          newTabTitle={shortcutTitle("New tab", bindings.newTab)}
          onNew={() => addTab()}
          onNewBrowser={() =>
            change((state) => {
              const added = newBrowserTab();
              return updateWorkspace(state, workspace.id, (current) => ({
                ...current,
                tabs: [...current.tabs, added],
                activeTabId: added.id,
              }));
            })
          }
          onNewFile={() =>
            change((state) => {
              const file = newFileTab(state);
              return updateWorkspace(state, workspace.id, (current) => ({
                ...current,
                tabs: [...current.tabs, file],
                activeTabId: file.id,
              }));
            })
          }
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
                  ? mergeTabs(current, id, targetId, side, {
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
              initial: tabTitle(candidate),
              submit: (title) =>
                change((state) =>
                  updateTab(state, candidate.id, (tab) => ({
                    ...tab,
                    customTitle: title,
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
        {workspacePanel}
        {sidebarPanels.filter(sidebarOpen).map((panel) => {
          const side = session.sidebarSides[panel];
          const widthKey =
            side === "left" ? "sidebarWidth" : "rightSidebarWidth";
          return (
            <Sidebar
              key={panel}
              side={side}
              width={session[widthKey]}
              label={panel === "files" ? "Explorer" : "Source Control"}
              onResize={(width) =>
                change((state) => ({ ...state, [widthKey]: width }))
              }
            >
              {panel === "files" ? (
                <Explorer
                  key={project.path}
                  root={project.path}
                  onTerminal={addTab}
                  onOpenFile={(relative, match) =>
                    void openFile(relative, project.path, match)
                  }
                  repositoryRoot={git.status?.root}
                  onOpenCommit={openHistoryCommit}
                  onOperation={operateFile}
                  onError={setError}
                />
              ) : (
                <SourceControl
                  key={project.path}
                  status={git.status}
                  loading={git.loading}
                  onRefresh={git.refresh}
                  onDiff={(path, staged) => void diff(path, staged)}
                  onOpenCommit={openHistoryCommit}
                  onOpenFile={(path) => void openFile(path, git.status!.root)}
                  onDiscard={async (change) => {
                    const root = git.status!.root;
                    if (fileOperationBusy.current)
                      throw new Error(
                        "Wait for the current file operation to finish.",
                      );
                    fileOperationBusy.current = true;
                    let resume: (() => void) | undefined;
                    try {
                      resume = await pauseEditorFileOperations();
                      const path = `${root.replace(/[\\/]$/, "")}/${change.path}`;
                      if (
                        fileTabs(currentSession.current!).some((file) => {
                          const document = loadedEditor(file);
                          return (
                            document?.dirty && containsPath(path, document.path)
                          );
                        })
                      )
                        throw new Error(
                          "Save or discard unsaved editor changes before discarding Git changes.",
                        );
                      await api("git_discard", { root, change });
                    } finally {
                      resume?.();
                      fileOperationBusy.current = false;
                    }
                  }}
                  onError={setError}
                />
              )}
            </Sidebar>
          );
        })}
        <main
          className="terminal-stage"
          id={`panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${tab.id}`}
        >
          {tab.type === "commit" ? (
            <CommitDetails
              key={tab.id}
              root={tab.root}
              commitId={tab.commit}
              onOpenFile={(path) => void openFile(path, tab.root)}
              onOpenCommit={(commit) => openHistoryCommit(commit, tab.root)}
              onError={setError}
            />
          ) : tab.type === "browser" ? (
            <BrowserPane
              key={tab.id}
              tab={tab}
              onClose={() => void closeTab(tab.id)}
            />
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
                onOpenFile={(root, relative) => void openFile(relative, root)}
                onMarkdownView={(view) =>
                  change((state) => updateMarkdownView(state, tab.id, view))
                }
                onPosition={(position) =>
                  change((state) => updateFilePosition(state, tab.id, position))
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
                overview={terminalOverview}
                onFocus={(id) => {
                  if (id !== tab.activePaneId)
                    modifyTab((tab) => ({ ...tab, activePaneId: id }));
                }}
                onRestart={restartPane}
                onMove={(id, targetId, side) => {
                  const container = terminalLayout.current;
                  if (!container) return;
                  modifyTab((tab) => {
                    const layout = movePane(tab.layout, id, targetId, side, {
                      width: container.clientWidth,
                      height: container.clientHeight,
                    });
                    return layout === tab.layout
                      ? tab
                      : { ...tab, layout, activePaneId: id };
                  });
                }}
                onClosePane={closePane}
                onFilePosition={(id, position) =>
                  change((state) => updateFilePosition(state, id, position))
                }
                onMarkdownView={(id, view) =>
                  change((state) => updateMarkdownView(state, id, view))
                }
                onOpenFile={(root, relative) => void openFile(relative, root)}
                onKeepActivePane={async () => {
                  const kept = allPanes.find(
                    (pane) => pane.id === tab.activePaneId,
                  )!;
                  const removed = allPanes.filter(
                    (pane) => pane.id !== kept.id,
                  );
                  if (
                    !(await closeGuard.confirm(
                      new Set(
                        removed
                          .filter((pane) => pane.type === "file")
                          .map((pane) => pane.id),
                      ),
                      removed
                        .filter((pane) => pane.type === "terminal")
                        .map((pane) => pane.id),
                    ))
                  )
                    return;
                  closeTerminals(
                    removed
                      .filter((pane) => pane.type === "terminal")
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
        {workspaceToggle}
        {sidebarPanels.map((panel) => (
          <div
            key={panel}
            className="status-panel-control"
            data-side={session.sidebarSides[panel]}
          >
            <SidebarToggle
              panel={panel}
              side={session.sidebarSides[panel]}
              active={sidebarOpen(panel)}
              title={
                panel === "files"
                  ? shortcutTitle(
                      "Toggle file explorer",
                      bindings.toggleExplorer,
                    )
                  : shortcutTitle(
                      "Toggle source control",
                      bindings.toggleSourceControl,
                    )
              }
              onToggle={() => change((state) => toggleSidebar(state, panel))}
              onMove={(side) =>
                change((state) => moveSidebar(state, panel, side))
              }
            />
            {panel === "git" && git.status && (
              <>
                <span className="status-divider" />
                <button
                  className="branch-status"
                  title="Show source control"
                  onClick={() => change((state) => showSidebar(state, "git"))}
                >
                  <GitBranch size={12} />
                  {git.status.branch}
                  {git.status.changes.length > 0 && (
                    <span className="count-badge">
                      {git.status.changes.length}
                    </span>
                  )}
                </button>
              </>
            )}
          </div>
        ))}
        <div
          className="status-panel-control"
          data-side={session.terminalOverviewSide}
        >
          <SidebarToggle
            panel="terminalOverview"
            side={session.terminalOverviewSide}
            title={shortcutTitle(
              "Toggle terminal overview",
              bindings.terminalOverview,
            )}
            active={tab.type === "terminal" && terminalOverview}
            disabled={tab.type !== "terminal" || !panes(tab.layout).length}
            onToggle={() => setTerminalOverview((shown) => !shown)}
            onMove={(side) =>
              change((state) => ({ ...state, terminalOverviewSide: side }))
            }
          />
        </div>
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
      {cliTitles.dialog}
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
  const nameInput = useRef<HTMLInputElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
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
      initialFocus={
        dialog.type === "name"
          ? nameInput
          : dialog.type === "confirm"
            ? confirmButton
            : undefined
      }
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
                ref={nameInput}
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
              ref={confirmButton}
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
