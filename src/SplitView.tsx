import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  layoutFits,
  MIN_PANE_HEIGHT,
  MIN_PANE_WIDTH,
  layoutPanes,
  SPLIT_DIVIDER_SIZE,
  splitGeometry,
} from "./model";
import type {
  EditorPosition,
  Layout,
  LayoutSize,
  MarkdownView,
  ShellProfile,
  Split,
} from "./model";
import TerminalPane from "./TerminalPane";

const FileEditor = lazy(() => import("./FileEditor"));

interface Props {
  layout: Layout;
  profile?: ShellProfile;
  profiles: ShellProfile[];
  activePaneId: string;
  overview: boolean;
  onFocus: (id: string) => void;
  onRestart: (id: string, useProjectDirectory?: boolean) => void;
  onResize: (id: string, ratio: number) => void;
  onFilePosition: (id: string, position: EditorPosition) => void;
  onMarkdownView: (id: string, view: MarkdownView) => void;
  onOpenFile: (root: string, relative: string) => void;
  onClosePane: (id: string) => void;
}

interface Bounds extends LayoutSize {
  left: number;
  top: number;
}

function layoutPositions(layout: Layout, size: LayoutSize) {
  const positions: { layout: Layout; bounds: Bounds }[] = [];
  const visit = (layout: Layout, bounds: Bounds) => {
    positions.push({ layout, bounds });
    if (layout.type !== "split") return;
    const geometry = splitGeometry(layout, bounds);
    visit(layout.first, { ...bounds, ...geometry.first });
    visit(layout.second, {
      ...bounds,
      ...geometry.second,
      ...(layout.axis === "horizontal"
        ? { left: bounds.left + geometry.first.width + SPLIT_DIVIDER_SIZE }
        : { top: bounds.top + geometry.first.height + SPLIT_DIVIDER_SIZE }),
    });
  };
  visit(layout, { ...size, left: 0, top: 0 });
  return positions;
}

export default function SplitView({
  onKeepActivePane,
  ...props
}: Props & { onKeepActivePane: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<LayoutSize>();
  const [maximizedPaneId, setMaximizedPaneId] = useState<string | null>(null);
  const allPanes = layoutPanes(props.layout);
  const showTitles =
    allPanes.filter((pane) => pane.type === "terminal").length > 1;
  const maximizedPane = allPanes.find(
    (pane) =>
      pane.type === "terminal" &&
      pane.id === maximizedPaneId &&
      pane.id === props.activePaneId,
  );
  useEffect(() => {
    if (!maximizedPane) setMaximizedPaneId(null);
  }, [maximizedPane]);
  useLayoutEffect(() => {
    const container = root.current!;
    const measure = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      setSize((previous) =>
        previous?.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const visibleLayout = props.overview
    ? props.layout
    : (maximizedPane ?? props.layout);
  const positions = useMemo(
    () =>
      size &&
      (visibleLayout.type !== "split" || layoutFits(visibleLayout, size))
        ? layoutPositions(visibleLayout, size)
        : null,
    [visibleLayout, size],
  );
  return (
    <div
      className={`split-container${props.layout.type === "split" ? " is-split" : ""}`}
      ref={root}
    >
      {size &&
        size.width > 0 &&
        size.height > 0 &&
        (positions ? (
          // Stable sibling keys keep terminal hosts and WebGL contexts mounted as the tree changes.
          positions.map(({ layout, bounds }) =>
            layout.type === "terminal" ? (
              <div key={layout.id} className="split-child" style={bounds}>
                <TerminalPane
                  pane={layout}
                  profile={
                    layout.profileId !== undefined
                      ? props.profiles.find(
                          (profile) => profile.id === layout.profileId,
                        )
                      : props.profile
                  }
                  active={props.activePaneId === layout.id}
                  overview={props.overview}
                  showTitle={showTitles}
                  canMaximize={props.layout.type === "split"}
                  maximized={maximizedPane?.id === layout.id}
                  onToggleMaximize={() => {
                    props.onFocus(layout.id);
                    setMaximizedPaneId(maximizedPane ? null : layout.id);
                  }}
                  onFocus={() => props.onFocus(layout.id)}
                  onRestart={(useProjectDirectory) =>
                    props.onRestart(layout.id, useProjectDirectory)
                  }
                />
              </div>
            ) : layout.type === "file" ? (
              <div
                key={layout.id}
                className="split-child"
                style={bounds}
                data-file-pane-id={layout.id}
                onPointerDownCapture={() => props.onFocus(layout.id)}
                onFocusCapture={() => props.onFocus(layout.id)}
              >
                <Suspense
                  fallback={
                    <div className="empty-message" role="status">
                      Loading editor…
                    </div>
                  }
                >
                  <FileEditor
                    tab={layout}
                    onOpenFile={props.onOpenFile}
                    onMarkdownView={(view) =>
                      props.onMarkdownView(layout.id, view)
                    }
                    active={props.activePaneId === layout.id}
                    onClose={() => props.onClosePane(layout.id)}
                    onPosition={(position) =>
                      props.onFilePosition(layout.id, position)
                    }
                  />
                </Suspense>
              </div>
            ) : (
              <Divider
                key={layout.id}
                layout={layout}
                bounds={bounds}
                onResize={props.onResize}
              />
            ),
          )
        ) : (
          <div className="layout-recovery" role="status">
            <h2>This panel layout needs more space</h2>
            <p>
              This tab has {layoutPanes(props.layout).length} panels. Each panel
              needs at least {MIN_PANE_WIDTH} × {MIN_PANE_HEIGHT} pixels.
              Enlarge the window or hide the sidebar to show them.
            </p>
            <p>
              Your layout is preserved. Existing shells keep running; saved
              terminals will start when the layout fits.
            </p>
            <button className="button" onClick={onKeepActivePane}>
              Keep only the active panel
            </button>
            <p className="muted">
              This closes the other {layoutPanes(props.layout).length - 1}{" "}
              panels in this tab.
            </p>
          </div>
        ))}
    </div>
  );
}

function Divider({
  layout,
  bounds,
  onResize,
}: {
  layout: Split;
  bounds: Bounds;
  onResize: Props["onResize"];
}) {
  const horizontal = layout.axis === "horizontal";
  const geometry = splitGeometry(layout, bounds);
  const resize = (ratio: number) =>
    onResize(
      layout.id,
      Math.max(geometry.minRatio, Math.min(geometry.maxRatio, ratio)),
    );
  return (
    <div
      className="split-divider"
      style={
        horizontal
          ? {
              left: bounds.left + geometry.first.width,
              top: bounds.top,
              width: SPLIT_DIVIDER_SIZE,
              height: bounds.height,
            }
          : {
              left: bounds.left,
              top: bounds.top + geometry.first.height,
              width: bounds.width,
              height: SPLIT_DIVIDER_SIZE,
            }
      }
      role="separator"
      aria-label={
        horizontal ? "Resize terminal columns" : "Resize terminal rows"
      }
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      aria-valuemin={Math.round(geometry.minRatio * 100)}
      aria-valuemax={Math.round(geometry.maxRatio * 100)}
      aria-valuenow={Math.round(geometry.ratio * 100)}
      tabIndex={0}
      onDoubleClick={() => resize(0.5)}
      onKeyDown={(event) => {
        if (
          ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(
            event.key,
          )
        ) {
          event.preventDefault();
          resize(
            geometry.ratio +
              (["ArrowLeft", "ArrowUp"].includes(event.key) ? -0.05 : 0.05),
          );
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const origin =
          event.currentTarget.parentElement!.getBoundingClientRect();
        resize(
          horizontal
            ? (event.clientX -
                origin.left -
                bounds.left -
                SPLIT_DIVIDER_SIZE / 2) /
                (bounds.width - SPLIT_DIVIDER_SIZE)
            : (event.clientY -
                origin.top -
                bounds.top -
                SPLIT_DIVIDER_SIZE / 2) /
                (bounds.height - SPLIT_DIVIDER_SIZE),
        );
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
    />
  );
}
