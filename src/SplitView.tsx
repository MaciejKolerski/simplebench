import { useLayoutEffect, useRef, useState } from "react";
import {
  layoutFits,
  MIN_PANE_HEIGHT,
  MIN_PANE_WIDTH,
  panes,
  SPLIT_DIVIDER_SIZE,
  splitGeometry,
} from "./model";
import type { Layout, LayoutSize, Pane, ShellProfile, Split } from "./model";
import TerminalPane from "./TerminalPane";

interface Props {
  layout: Layout;
  profile?: ShellProfile;
  activePaneId: string;
  onFocus: (id: string) => void;
  onSplit: (pane: Pane, axis: Split["axis"]) => void;
  onClose: (id: string) => void;
  onRestart: (id: string, useProjectDirectory?: boolean) => void;
  onResize: (id: string, ratio: number) => void;
}

export default function SplitView({
  onKeepActivePane,
  ...props
}: Props & { onKeepActivePane: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<LayoutSize>();
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
  const fits =
    size &&
    (props.layout.type === "terminal" || layoutFits(props.layout, size));
  return (
    <div className="split-container" ref={root}>
      {size &&
        size.width > 0 &&
        size.height > 0 &&
        (fits ? (
          <LayoutView {...props} size={size} />
        ) : (
          <div className="layout-recovery" role="status">
            <h2>This terminal layout needs more space</h2>
            <p>
              This tab has {panes(props.layout).length} panels. Each panel needs
              at least {MIN_PANE_WIDTH} × {MIN_PANE_HEIGHT} pixels. Enlarge the
              window or hide the sidebar to show them.
            </p>
            <p>
              Your layout is preserved. Existing shells keep running; saved
              terminals will start when the layout fits.
            </p>
            <button className="button" onClick={onKeepActivePane}>
              Keep only the active terminal
            </button>
            <p className="muted">
              This closes the other {panes(props.layout).length - 1} panels in
              this tab.
            </p>
          </div>
        ))}
    </div>
  );
}

function LayoutView(props: Props & { size: LayoutSize }) {
  if (props.layout.type === "terminal") {
    const pane = props.layout;
    return (
      <TerminalPane
        key={pane.id}
        pane={pane}
        profile={props.profile}
        active={props.activePaneId === pane.id}
        onFocus={() => props.onFocus(pane.id)}
        onSplit={(axis) => props.onSplit(pane, axis)}
        onClose={() => props.onClose(pane.id)}
        onRestart={(useProjectDirectory) =>
          props.onRestart(pane.id, useProjectDirectory)
        }
      />
    );
  }
  return <Branch {...props} layout={props.layout} />;
}

function Branch({
  layout,
  size,
  ...props
}: Props & { layout: Split; size: LayoutSize }) {
  const root = useRef<HTMLDivElement>(null);
  const horizontal = layout.axis === "horizontal";
  const geometry = splitGeometry(layout, size);
  const resize = (ratio: number) =>
    props.onResize(
      layout.id,
      Math.max(geometry.minRatio, Math.min(geometry.maxRatio, ratio)),
    );
  return (
    <div className={`split-view split-${layout.axis}`} ref={root}>
      <div className="split-child" style={{ flex: `${geometry.ratio} 1 0` }}>
        <LayoutView {...props} layout={layout.first} size={geometry.first} />
      </div>
      <div
        className="split-divider"
        style={{ flexBasis: SPLIT_DIVIDER_SIZE }}
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
          const bounds = root.current!.getBoundingClientRect();
          resize(
            horizontal
              ? (event.clientX - bounds.left - SPLIT_DIVIDER_SIZE / 2) /
                  (bounds.width - SPLIT_DIVIDER_SIZE)
              : (event.clientY - bounds.top - SPLIT_DIVIDER_SIZE / 2) /
                  (bounds.height - SPLIT_DIVIDER_SIZE),
          );
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      />
      <div
        className="split-child"
        style={{ flex: `${1 - geometry.ratio} 1 0` }}
      >
        <LayoutView {...props} layout={layout.second} size={geometry.second} />
      </div>
    </div>
  );
}
