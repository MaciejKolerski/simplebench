import { useCallback, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import type { RefObject } from "react";

type Motion = "panes" | "sidebars" | false;

export function usePaneMotion(
  root: RefObject<HTMLDivElement | null>,
  tabId: string | undefined,
) {
  const pending = useRef<(() => void) | null>(null);
  const finishMotion = useRef<(() => void) | null>(null);
  const queued = useRef<{ render: () => void; motion: Motion } | null>(null);
  const sidebarMotion = useRef(false);
  useLayoutEffect(() => () => finishMotion.current?.(), [tabId]);
  useLayoutEffect(
    () => () => {
      pending.current = null;
      queued.current = null;
    },
    [],
  );

  return useCallback(
    function renderLayout(
      render: () => void,
      motion: Motion = false,
      interrupt = false,
    ) {
      // State changes remain synchronous; renders queued during capture use the latest state.
      if (interrupt) {
        queued.current = null;
        finishMotion.current?.();
      }
      if (pending.current) {
        pending.current = render;
        return;
      }
      // Complete sidebar motion before capturing another layout, keeping its visible
      // geometry continuous. Only the latest requested layout needs to be rendered.
      if (sidebarMotion.current && (motion || queued.current)) {
        queued.current = { render, motion: motion || queued.current!.motion };
        return;
      }
      const container = root.current;
      if (
        !motion ||
        !container ||
        !document.startViewTransition ||
        matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        render();
        return;
      }
      finishMotion.current?.();
      const selector =
        ".dock-pane-host > .split-child, .split-container > .split-divider" +
        (motion === "sidebars" ? ", .terminal-title-box" : "");
      const panels = [...container.querySelectorAll<HTMLElement>(selector)];
      if (!panels.length) {
        render();
        return;
      }
      const names = panels.map((panel) => panel.style.viewTransitionName);
      panels.forEach((panel, index) => {
        panel.style.viewTransitionName = `terminal-pane-${index}`;
      });
      document.documentElement.classList.add("moving-panes");
      sidebarMotion.current = motion === "sidebars";
      document.documentElement.classList.toggle(
        "moving-sidebars",
        sidebarMotion.current,
      );
      pending.current = render;
      // Animate captured panels while xterm fits each live terminal only to its final size.
      const transition = document.startViewTransition(() => {
        const render = pending.current;
        pending.current = null;
        if (render) flushSync(render);
        if (finishMotion.current !== cancel) return;
        // New panels and dividers join the transition instead of appearing behind it.
        for (const panel of container.querySelectorAll<HTMLElement>(selector)) {
          if (panels.includes(panel)) continue;
          names.push(panel.style.viewTransitionName);
          panel.style.viewTransitionName = `terminal-pane-${panels.length}`;
          panels.push(panel);
        }
      });
      const clean = () => {
        if (finishMotion.current !== cancel) return;
        panels.forEach((panel, index) => {
          panel.style.viewTransitionName = names[index];
        });
        document.documentElement.classList.remove(
          "moving-panes",
          "moving-sidebars",
        );
        sidebarMotion.current = false;
        finishMotion.current = null;
      };
      const cancel = () => {
        transition.skipTransition();
        clean();
      };
      finishMotion.current = cancel;
      void transition.ready.catch(() => {});
      const finished = () => {
        if (finishMotion.current !== cancel) return;
        clean();
        const next = queued.current;
        queued.current = null;
        if (next) renderLayout(next.render, next.motion);
      };
      void transition.finished.then(finished, finished);
    },
    [root],
  );
}
