import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { layoutPositions, movePane } from "./model";
import type { Layout, TabDropSide } from "./model";

interface Props {
  layout: Layout;
  root: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  onMove: (id: string, targetId: string, side: TabDropSide) => void;
}

// Use pointer capture, as native webviews can intercept HTML drag-and-drop.
export function usePaneDrag({ layout, root, enabled, onMove }: Props) {
  const [controlHeld, setControlHeld] = useState(false);
  const cleanup = useRef<(() => void) | null>(null);
  const suppressClick = useRef(false);
  useLayoutEffect(() => () => cleanup.current?.(), [layout, enabled]);
  useEffect(() => {
    if (!enabled) return;
    const key = (event: KeyboardEvent) => {
      setControlHeld(event.ctrlKey);
      if (event.key === "Escape" && cleanup.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        cleanup.current();
      }
      if (!event.ctrlKey) cleanup.current?.();
    };
    const blur = () => {
      setControlHeld(false);
      cleanup.current?.();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("keyup", key, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("keyup", key, true);
      window.removeEventListener("blur", blur);
      setControlHeld(false);
    };
  }, [enabled]);

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || !event.ctrlKey || event.button !== 0 || !event.isPrimary)
      return;
    const element = event.target as Element;
    const handle = element.closest<HTMLElement>(
      ".terminal-title-box, [data-pane-drag-handle]",
    );
    const source = handle?.closest<HTMLElement>(
      "[data-pane-id], [data-plugin-pane-id], [data-file-pane-id], [data-browser-pane-id], [data-chat-pane-id]",
    );
    const id =
      source?.dataset.paneId ??
      source?.dataset.pluginPaneId ??
      source?.dataset.filePaneId ??
      source?.dataset.browserPaneId ??
      source?.dataset.chatPaneId;
    const container = root.current;
    if (
      !handle ||
      !id ||
      !container ||
      element.closest("button, input, textarea, select")
    )
      return;
    cleanup.current?.();
    event.preventDefault();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let ghost: HTMLDivElement | undefined;
    let indicator: HTMLDivElement | undefined;
    let destination: { targetId: string; side: TabDropSide } | undefined;
    handle.setPointerCapture(pointerId);

    const preview = (x: number, y: number) => {
      if (!ghost || !indicator) return;
      ghost.style.left = `${Math.max(0, Math.min(x + 12, innerWidth - ghost.offsetWidth))}px`;
      ghost.style.top = `${Math.max(0, Math.min(y + 12, innerHeight - ghost.offsetHeight))}px`;
      const area = container.getBoundingClientRect();
      const positions = layoutPositions(layout, area);
      const target = positions.find(
        ({ layout, bounds }) =>
          layout.type !== "split" &&
          layout.id !== id &&
          x >= area.left + bounds.left &&
          x <= area.left + bounds.left + bounds.width &&
          y >= area.top + bounds.top &&
          y <= area.top + bounds.top + bounds.height,
      );
      if (!target) {
        destination = undefined;
        indicator.hidden = true;
        return;
      }
      const { bounds } = target;
      const horizontal = (x - area.left - bounds.left) / bounds.width;
      const vertical = (y - area.top - bounds.top) / bounds.height;
      const side: TabDropSide =
        Math.min(horizontal, 1 - horizontal) <= Math.min(vertical, 1 - vertical)
          ? horizontal < 0.5
            ? "left"
            : "right"
          : vertical < 0.5
            ? "top"
            : "bottom";
      const distances = {
        left: horizontal,
        right: 1 - horizontal,
        top: vertical,
        bottom: 1 - vertical,
      };
      // Small pointer movements along a zone boundary should not flip the preview.
      if (
        destination?.targetId === target.layout.id &&
        distances[destination.side] - distances[side] <
          12 / Math.min(bounds.width, bounds.height)
      )
        return;
      const moved = movePane(layout, id, target.layout.id, side, area);
      const allowed = moved !== layout;
      const proposed = allowed
        ? layoutPositions(moved, area).find(({ layout }) => layout.id === id)!
            .bounds
        : bounds;
      destination = allowed ? { targetId: target.layout.id, side } : undefined;
      indicator.className = `pane-drop-preview${allowed ? "" : " is-blocked"}`;
      indicator.dataset.side = side;
      indicator.textContent = allowed
        ? "Move panel here"
        : "Not enough room for these panels";
      Object.assign(indicator.style, {
        left: `${area.left + proposed.left}px`,
        top: `${area.top + proposed.top}px`,
        width: `${proposed.width}px`,
        height: `${proposed.height}px`,
      });
      indicator.hidden = false;
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      if (!event.ctrlKey) {
        clean();
        return;
      }
      if (
        !ghost &&
        Math.hypot(event.clientX - startX, event.clientY - startY) < 6
      )
        return;
      if (!ghost) {
        suppressClick.current = true;
        ghost = document.createElement("div");
        ghost.className = "pane-drag-ghost";
        ghost.textContent = handle.textContent;
        indicator = document.createElement("div");
        indicator.className = "pane-drop-preview";
        indicator.hidden = true;
        document.body.append(indicator, ghost);
        document.body.classList.add("dragging-pane");
        handle.classList.add("is-dragging");
      }
      event.preventDefault();
      preview(event.clientX, event.clientY);
    };
    const clean = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      handle.removeEventListener("lostpointercapture", clean);
      observer.disconnect();
      if (handle.hasPointerCapture(pointerId))
        handle.releasePointerCapture(pointerId);
      ghost?.remove();
      ghost = undefined;
      indicator?.remove();
      document.body.classList.remove("dragging-pane");
      handle.classList.remove("is-dragging");
      cleanup.current = null;
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      preview(event.clientX, event.clientY);
      const drop = event.ctrlKey && ghost ? destination : undefined;
      clean();
      if (drop) onMove(id, drop.targetId, drop.side);
    };
    const cancel = (event: PointerEvent) => {
      if (event.pointerId === pointerId) clean();
    };
    const area = container.getBoundingClientRect();
    const observer = new ResizeObserver(() => {
      const resized = container.getBoundingClientRect();
      if (area.width !== resized.width || area.height !== resized.height)
        clean();
    });
    observer.observe(container);
    cleanup.current = clean;
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    handle.addEventListener("lostpointercapture", clean);
  };
  return { beginDrag, controlHeld: enabled && controlHeld, suppressClick };
}
