import ResourceIcon from "./ResourceIcon";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  ChevronLeft,
  ChevronRight,
  GitCommitHorizontal,
  FileCode,
  FileDiff,
  Globe,
  Plus,
  Terminal,
  Puzzle,
  X,
} from "./icons";
import type { Tab, TabCloseAction, TabDropSide } from "./model";
import { tabTitle } from "./model";
import { useTabDrag } from "./tab-drag";
import { IconButton } from "./ui";
import TabContextMenu from "./TabContextMenu";
import type { TabMenuAnchor } from "./TabContextMenu";
import ContextMenu from "./ContextMenu";

interface Props {
  tabs: Tab[];
  activeTabId: string;
  newTabTitle: string;
  onNew: () => void;
  onNewFile: () => void;
  onNewBrowser: () => void;
  onSelect: (id: string) => void;
  onClose: (id: string, action?: TabCloseAction) => void;
  onRename: (tab: Tab) => void;
  onMove: (id: string, beforeId: string | null) => void;
  onMerge: (id: string, targetId: string, side: TabDropSide) => void;
  mergeContainer: RefObject<HTMLDivElement | null>;
  modified?: ReadonlySet<string>;
}

export default function TabBar({
  tabs,
  activeTabId,
  newTabTitle,
  onNew,
  onNewFile,
  onNewBrowser,
  onSelect,
  onClose,
  onRename,
  onMove,
  onMerge,
  mergeContainer,
  modified = new Set<string>(),
}: Props) {
  const strip = useRef<HTMLDivElement>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const [newMenu, setNewMenu] = useState<{ x: number; y: number } | null>(null);
  const { beginDrag, suppressClick } = useTabDrag({
    tabs,
    activeTabId,
    strip,
    mergeContainer,
    onMove,
    onMerge,
  });
  const [contextMenu, setContextMenu] = useState<TabMenuAnchor | null>(null);
  const dismissMenu = useCallback(() => setContextMenu(null), []);
  const [scroll, setScroll] = useState({ left: false, right: false });
  const updateScroll = useCallback(() => {
    const element = strip.current;
    if (!element) return;
    const left = element.scrollLeft > 1;
    const right =
      element.scrollWidth - element.clientWidth - element.scrollLeft > 1;
    setScroll((previous) =>
      previous.left === left && previous.right === right
        ? previous
        : { left, right },
    );
  }, []);

  useLayoutEffect(() => {
    const element = strip.current!;
    const revealActive = () => {
      element
        .querySelector(".active-tab")
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      updateScroll();
    };
    revealActive();
    const observer = new ResizeObserver(revealActive);
    observer.observe(element);
    return () => observer.disconnect();
  }, [activeTabId, tabs.length, updateScroll]);

  const focusTab = (id: string) => {
    onSelect(id);
    requestAnimationFrame(() => document.getElementById(`tab-${id}`)?.focus());
  };
  const scrollTabs = (direction: number) => {
    const element = strip.current;
    if (element) element.scrollLeft += direction * element.clientWidth * 0.8;
  };

  return (
    <div
      className="tab-bar"
      onPointerDownCapture={(event) => {
        if (event.isPrimary) suppressClick.current = false;
      }}
      onClickCapture={(event) => {
        if (suppressClick.current && event.detail !== 0) {
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
        }
      }}
    >
      <div
        className={`tab-viewport${scroll.left ? " scrollable-left" : ""}${scroll.right ? " scrollable-right" : ""}`}
      >
        <div
          ref={strip}
          className="tab-strip"
          role="tablist"
          aria-label="Workspace tabs"
          data-tauri-drag-region
          onScroll={updateScroll}
          onWheel={(event) => {
            if (
              !event.ctrlKey &&
              Math.abs(event.deltaY) > Math.abs(event.deltaX)
            ) {
              const unit =
                event.deltaMode === 1
                  ? 32
                  : event.deltaMode === 2
                    ? event.currentTarget.clientWidth
                    : 1;
              event.currentTarget.scrollLeft += event.deltaY * unit;
            }
          }}
        >
          {tabs.map((tab, index) => (
            <div
              className={`tab${tab.id === activeTabId ? " active-tab" : ""}`}
              key={tab.id}
              data-tab-id={tab.id}
              role="presentation"
              onContextMenu={(event) => {
                event.preventDefault();
                const bounds = event.currentTarget.getBoundingClientRect();
                setContextMenu({
                  id: tab.id,
                  x: event.clientX || bounds.left,
                  y: event.clientY || bounds.bottom,
                });
              }}
            >
              <button
                id={`tab-${tab.id}`}
                role="tab"
                aria-selected={tab.id === activeTabId}
                aria-controls={`panel-${tab.id}`}
                aria-haspopup="menu"
                aria-expanded={contextMenu?.id === tab.id}
                tabIndex={tab.id === activeTabId ? 0 : -1}
                draggable={false}
                onPointerDown={(event) => {
                  dismissMenu();
                  beginDrag(event, tab);
                }}
                title={
                  tab.type === "file"
                    ? `${tab.untitled ? tab.title : tab.relative}${modified?.has(tab.id) ? " • Modified" : ""}`
                    : tabTitle(tab)
                }
                onClick={() => onSelect(tab.id)}
                onDoubleClick={() => {
                  if (tab.type !== "file") onRename(tab);
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "ContextMenu" ||
                    (event.shiftKey && event.key === "F10")
                  ) {
                    event.preventDefault();
                    const bounds = event.currentTarget.getBoundingClientRect();
                    setContextMenu({
                      id: tab.id,
                      x: bounds.left,
                      y: bounds.bottom,
                    });
                    return;
                  }
                  if (
                    event.altKey ||
                    event.ctrlKey ||
                    event.metaKey ||
                    event.shiftKey
                  )
                    return;
                  let next: Tab;
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    next =
                      tabs[
                        (index +
                          (event.key === "ArrowLeft" ? -1 : 1) +
                          tabs.length) %
                          tabs.length
                      ];
                  } else if (event.key === "Home") next = tabs[0];
                  else if (event.key === "End") next = tabs[tabs.length - 1];
                  else return;
                  event.preventDefault();
                  focusTab(next.id);
                }}
              >
                {tab.type === "commit" ? (
                  <GitCommitHorizontal size={14} />
                ) : tab.type === "diff" ? (
                  <ResourceIcon
                    path={`${tab.root}/${tab.relative}`}
                    size={14}
                    fallback={FileDiff}
                  />
                ) : tab.type === "browser" ? (
                  <Globe size={14} />
                ) : tab.type === "file" ? (
                  <ResourceIcon
                    path={`${tab.root}/${tab.relative}`}
                    size={14}
                  />
                ) : tab.type === "plugin" ? (
                  <Puzzle size={14} />
                ) : (
                  <Terminal size={14} />
                )}
                <span>{tabTitle(tab)}</span>
                {modified?.has(tab.id) && (
                  <span className="tab-modified" aria-label="Unsaved changes">
                    ●
                  </span>
                )}
              </button>
              <button
                className="tab-close"
                tabIndex={tab.id === activeTabId ? 0 : -1}
                aria-label={`Close ${tabTitle(tab)}`}
                title={`Close ${tabTitle(tab)}`}
                onClick={() => onClose(tab.id)}
              >
                <X size={13} iconId="tab-close" />
              </button>
            </div>
          ))}
          <IconButton
            title={newTabTitle}
            aria-haspopup="menu"
            aria-expanded={!!newMenu}
            onClick={(event) => {
              newButton.current = event.currentTarget;
              dismissMenu();
              const bounds = event.currentTarget.getBoundingClientRect();
              setNewMenu({ x: bounds.left, y: bounds.bottom });
            }}
          >
            <Plus size={16} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
      {(scroll.left || scroll.right) && (
        <div className="tab-navigation">
          <IconButton
            title="Scroll tabs left"
            disabled={!scroll.left}
            onClick={() => scrollTabs(-1)}
          >
            <ChevronLeft size={15} />
          </IconButton>
          <IconButton
            title="Scroll tabs right"
            disabled={!scroll.right}
            onClick={() => scrollTabs(1)}
          >
            <ChevronRight size={15} />
          </IconButton>
        </div>
      )}
      {contextMenu && tabs.some((tab) => tab.id === contextMenu.id) && (
        <TabContextMenu
          anchor={contextMenu}
          tabs={tabs}
          modified={modified}
          onClose={onClose}
          onRename={onRename}
          onDismiss={dismissMenu}
        />
      )}
      {newMenu && (
        <ContextMenu
          {...newMenu}
          label="New tab"
          actions={[
            {
              label: "New terminal",
              icon: <Terminal size={14} aria-hidden="true" />,
              run: onNew,
            },
            {
              label: "New file",
              icon: <FileCode size={14} aria-hidden="true" />,
              run: onNewFile,
            },
            {
              label: "New browser",
              icon: <Globe size={14} aria-hidden="true" />,
              run: onNewBrowser,
            },
          ]}
          onClose={() => {
            setNewMenu(null);
            newButton.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </div>
  );
}
