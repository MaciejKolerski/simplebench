import { useEffect, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export interface ContextAction {
  label: string;
  icon?: ReactNode;
  run: () => void;
  disabled?: boolean;
  shortcut?: string;
  danger?: boolean;
}

export default function ContextMenu({
  x,
  y,
  label,
  actions,
  onClose,
}: {
  x: number;
  y: number;
  label: string;
  actions: (ContextAction | null)[];
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const element = menu.current!;
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
    element.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [x, y]);
  useEffect(() => {
    const outside = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) close.current();
    };
    const dismiss = () => close.current();
    document.addEventListener("pointerdown", outside);
    // Let scrolling caused by focusing the trigger finish before dismissing on scroll.
    const frame = requestAnimationFrame(() =>
      document.addEventListener("scroll", outside, true),
    );
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, []);
  return createPortal(
    <div
      ref={menu}
      className="menu explorer-context-menu"
      role="menu"
      aria-label={label}
      style={{ left: x, top: y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (["Escape", "Tab"].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const items = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ),
        ];
        const index = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        items[
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
                items.length
        ]?.focus();
      }}
    >
      {actions.map((action, index) =>
        action ? (
          <button
            type="button"
            role="menuitem"
            aria-label={action.label}
            tabIndex={-1}
            key={action.label}
            className={`menu-item${action.danger ? " text-error" : ""}`}
            disabled={action.disabled}
            onClick={() => {
              onClose();
              action.run();
            }}
          >
            {action.icon}
            <span>{action.label}</span>
            {action.shortcut && <kbd>{action.shortcut}</kbd>}
          </button>
        ) : (
          <div key={index} role="separator" className="menu-divider" />
        ),
      )}
    </div>,
    document.body,
  );
}
