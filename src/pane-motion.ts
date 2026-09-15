import { useCallback, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import type { RefObject } from "react";

export function usePaneMotion(
  root: RefObject<HTMLDivElement | null>,
  tabId: string | undefined,
) {
  const pending = useRef<(() => void) | null>(null);
  const finishMotion = useRef<(() => void) | null>(null);
  useLayoutEffect(() => () => finishMotion.current?.(), [tabId]);
  useLayoutEffect(
    () => () => {
      pending.current = null;
    },
    [],
  );

  return useCallback(
    (render: () => void, animate = false) => {
      // State changes remain synchronous; renders queued during capture use the latest state.
      if (pending.current) {
        pending.current = render;
        return;
      }
      const container = root.current;
      if (
        !animate ||
        !container ||
        !document.startViewTransition ||
        matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        render();
        return;
      }
      finishMotion.current?.();
      const panels = [
        ...container.querySelectorAll<HTMLElement>(
          ".dock-pane-host > .split-child, .split-container > .split-divider",
        ),
      ];
      if (!panels.length) {
        render();
        return;
      }
      const names = panels.map((panel) => panel.style.viewTransitionName);
      panels.forEach((panel, index) => {
        panel.style.viewTransitionName = `terminal-pane-${index}`;
      });
      document.documentElement.classList.add("moving-panes");
      pending.current = render;
      // Animate captured panels while xterm fits each live terminal only to its final size.
      const transition = document.startViewTransition(() => {
        const render = pending.current;
        pending.current = null;
        if (render) flushSync(render);
        if (finishMotion.current !== cancel) return;
        // New panels and dividers join the transition instead of appearing behind it.
        for (const panel of container.querySelectorAll<HTMLElement>(
          ".dock-pane-host > .split-child, .split-container > .split-divider",
        )) {
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
        document.documentElement.classList.remove("moving-panes");
        finishMotion.current = null;
      };
      const cancel = () => {
        transition.skipTransition();
        clean();
      };
      finishMotion.current = cancel;
      void transition.ready.catch(() => {});
      void transition.finished.then(clean, clean);
    },
    [root],
  );
}
