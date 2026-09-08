import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { themeAppliedEvent } from "./theme-runtime";

export default function Sidebar({
  width,
  label,
  children,
  onResize,
}: {
  width: number;
  label: string;
  children: ReactNode;
  onResize: (width: number) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; width: number }>(undefined);
  const [measuredWidth, setMeasuredWidth] = useState(width);
  const [maximumWidth, setMaximumWidth] = useState(520);
  const [minimumWidth, setMinimumWidth] = useState(180);
  const minimum = () =>
    parseFloat(getComputedStyle(ref.current!).minWidth) || 180;
  const limit = () => {
    const element = ref.current!;
    const area = element.parentElement!;
    const stage = area.querySelector<HTMLElement>(".terminal-stage")!;
    const maximum =
      parseFloat(getComputedStyle(element).maxWidth) || area.clientWidth;
    return Math.max(
      minimum(),
      Math.min(
        maximum,
        element.getBoundingClientRect().width +
          stage.getBoundingClientRect().width -
          (parseFloat(getComputedStyle(stage).minWidth) || 240),
      ),
    );
  };
  useLayoutEffect(() => {
    const measure = () => {
      setMeasuredWidth(Math.round(ref.current!.getBoundingClientRect().width));
      setMinimumWidth(minimum());
      setMaximumWidth(limit());
    };
    const observer = new ResizeObserver(measure);
    observer.observe(ref.current!);
    observer.observe(ref.current!.parentElement!);
    window.addEventListener(themeAppliedEvent, measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener(themeAppliedEvent, measure);
    };
  }, []);
  const resize = (next: number) =>
    onResize(Math.max(minimum(), Math.min(limit(), next)));
  return (
    <>
      <aside ref={ref} className="sidebar" aria-label={label} style={{ width }}>
        {children}
      </aside>
      <div
        className="sidebar-divider"
        role="separator"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        aria-valuenow={measuredWidth}
        aria-valuemin={minimumWidth}
        aria-valuemax={maximumWidth}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          resize(measuredWidth + (event.key === "ArrowLeft" ? -20 : 20));
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          drag.current = {
            x: event.clientX,
            width: ref.current!.getBoundingClientRect().width,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (
            drag.current &&
            event.currentTarget.hasPointerCapture(event.pointerId)
          )
            resize(drag.current.width + (event.clientX - drag.current.x));
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          drag.current = undefined;
        }}
        onLostPointerCapture={() => {
          drag.current = undefined;
        }}
      />
    </>
  );
}
