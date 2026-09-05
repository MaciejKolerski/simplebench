import { useRef } from "react";
import type { Layout, Pane, ShellProfile, Split } from "./model";
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

export default function SplitView(props: Props) {
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

function Branch({ layout, ...props }: Props & { layout: Split }) {
  const root = useRef<HTMLDivElement>(null);
  const horizontal = layout.axis === "horizontal";
  return (
    <div className={`split-view split-${layout.axis}`} ref={root}>
      <div className="split-child" style={{ flex: `${layout.ratio} 1 0` }}>
        <SplitView {...props} layout={layout.first} />
      </div>
      <div
        className="split-divider"
        role="separator"
        aria-label={
          horizontal ? "Resize terminal columns" : "Resize terminal rows"
        }
        aria-orientation={horizontal ? "vertical" : "horizontal"}
        aria-valuemin={10}
        aria-valuemax={90}
        aria-valuenow={Math.round(layout.ratio * 100)}
        tabIndex={0}
        onDoubleClick={() => props.onResize(layout.id, 0.5)}
        onKeyDown={(event) => {
          if (
            ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(
              event.key,
            )
          ) {
            event.preventDefault();
            props.onResize(
              layout.id,
              layout.ratio +
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
          props.onResize(
            layout.id,
            horizontal
              ? (event.clientX - bounds.left) / bounds.width
              : (event.clientY - bounds.top) / bounds.height,
          );
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      />
      <div className="split-child" style={{ flex: `${1 - layout.ratio} 1 0` }}>
        <SplitView {...props} layout={layout.second} />
      </div>
    </div>
  );
}
