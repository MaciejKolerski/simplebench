import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes } from "react";
import { Check, ChevronDown } from "lucide-react";

type Option = { value: string; label: string; disabled?: boolean };

export default function Select({
  value,
  options,
  onChange,
  className = "",
  id,
  disabled,
  ...props
}: Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  | "id"
  | "disabled"
  | "autoFocus"
  | "aria-label"
  | "aria-labelledby"
  | "aria-describedby"
  | "className"
> & {
  value: string;
  options: readonly Option[];
  onChange: (value: string) => void;
}) {
  const uid = useId();
  const buttonId = id ?? `${uid}-button`;
  const listId = `${uid}-list`;
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const query = useRef({ text: "", time: 0 });
  const [open, setOpen] = useState(false);
  const selected = options.findIndex((option) => option.value === value);
  const [active, setActive] = useState(selected);
  const enabled = options
    .map((option, index) => (option.disabled ? -1 : index))
    .filter((index) => index >= 0);
  const close = () => menu.current?.hidePopover();
  const show = (index: number) => {
    if (!menu.current?.matches(":popover-open")) trigger.current?.click();
    setActive(index);
  };
  const choose = () => {
    close();
    if (
      trigger.current?.matches(":disabled") ||
      !options[active] ||
      options[active].disabled
    )
      return;
    if (options[active].value !== value) onChange(options[active].value);
  };

  useLayoutEffect(() => {
    // Native dialog focusing runs after React's mount-time autofocus.
    trigger.current!.autofocus = !!props.autoFocus;
  }, [props.autoFocus]);

  useLayoutEffect(() => {
    if (!open) return;
    const button = trigger.current!;
    const popup = menu.current!;
    if (button.matches(":disabled")) {
      close();
      return;
    }
    let anchor = button.getBoundingClientRect();
    const position = () => {
      const rect = button.getBoundingClientRect();
      anchor = rect;
      popup.style.width = `${Math.min(rect.width, innerWidth - 16)}px`;
      const below = Math.max(0, innerHeight - rect.bottom - 12);
      const above = Math.max(0, rect.top - 12);
      const upwards = below < popup.scrollHeight && above > below;
      popup.style.maxHeight = `min(var(--select-menu-max-height, 320px), ${upwards ? above : below}px)`;
      popup.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - popup.offsetWidth - 8))}px`;
      popup.style.top = `${upwards ? rect.top - popup.offsetHeight - 4 : rect.bottom + 4}px`;
    };
    const scroll = (event: Event) => {
      if (popup.contains(event.target as Node)) return;
      const rect = button.getBoundingClientRect();
      // Ignore scroll events queued before the trigger opened the popup.
      if (rect.top !== anchor.top || rect.left !== anchor.left) close();
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(button);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", position);
    window.addEventListener("blur", close);
    return () => {
      observer.disconnect();
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", position);
      window.removeEventListener("blur", close);
    };
  }, [open, disabled, options]);

  useLayoutEffect(() => {
    if (!open) return;
    const popup = menu.current!;
    const item = popup.children[active] as HTMLElement | undefined;
    if (!item) return;
    // Scroll only the popup; scrollIntoView can also move the settings form.
    if (item.offsetTop < popup.scrollTop) popup.scrollTop = item.offsetTop;
    else if (
      item.offsetTop + item.offsetHeight >
      popup.scrollTop + popup.clientHeight
    )
      popup.scrollTop = item.offsetTop + item.offsetHeight - popup.clientHeight;
  }, [active, open]);

  return (
    <>
      <button
        {...props}
        id={buttonId}
        ref={trigger}
        type="button"
        role="combobox"
        className={`select-trigger ${className}`}
        disabled={disabled || !enabled.length}
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-activedescendant={
          open && active >= 0 ? `${listId}-${active}` : undefined
        }
        popoverTarget={listId}
        onPointerDown={(event) => {
          // Safari blurs an already focused button on mouse down, before its toggle.
          event.preventDefault();
          trigger.current?.focus({ preventScroll: true });
        }}
        onClick={() => {
          trigger.current?.focus({ preventScroll: true });
          query.current = { text: "", time: 0 };
          setActive(enabled.includes(selected) ? selected : (enabled[0] ?? -1));
        }}
        onBlur={() => close()}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey)
            return;
          const expanded = menu.current!.matches(":popover-open");
          if (event.key === "Escape" && expanded) {
            event.preventDefault();
            event.stopPropagation();
            close();
          } else if (event.key === "Tab") {
            if (expanded) choose();
          } else if (event.altKey) {
            if (event.key === "ArrowUp" && expanded) {
              event.preventDefault();
              choose();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              show(enabled.includes(selected) ? selected : enabled[0]);
            }
          } else if (
            ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
          ) {
            event.preventDefault();
            query.current = { text: "", time: 0 };
            const index = enabled.indexOf(active);
            show(
              event.key === "Home"
                ? enabled[0]
                : event.key === "End"
                  ? enabled.at(-1)!
                  : expanded
                    ? enabled[
                        (index +
                          (event.key === "ArrowDown" ? 1 : -1) +
                          enabled.length) %
                          enabled.length
                      ]
                    : enabled.includes(selected)
                      ? selected
                      : event.key === "ArrowUp"
                        ? enabled.at(-1)!
                        : enabled[0],
            );
          } else if (
            event.key === "Enter" ||
            (event.key === " " &&
              (!query.current.text || Date.now() - query.current.time >= 700))
          ) {
            event.preventDefault();
            if (expanded) choose();
            else show(enabled.includes(selected) ? selected : enabled[0]);
          } else if (event.key.length === 1) {
            event.preventDefault();
            const now = Date.now();
            const text =
              (now - query.current.time < 700 ? query.current.text : "") +
              event.key.toLowerCase();
            const search = [...text].every((character) => character === text[0])
              ? text[0]
              : text;
            const start = Math.max(
              0,
              enabled.indexOf(expanded ? active : selected) +
                (search.length === 1 ? 1 : 0),
            );
            const match = [
              ...enabled.slice(start),
              ...enabled.slice(0, start),
            ].find((index) =>
              options[index].label.toLowerCase().startsWith(search),
            );
            if (match !== undefined) show(match);
            query.current = { text, time: now };
          }
        }}
      >
        <span>{options[selected]?.label ?? value}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <div
        ref={menu}
        id={listId}
        popover="auto"
        className="select-menu"
        role="listbox"
        aria-labelledby={buttonId}
        onBeforeToggle={(event) => setOpen(event.newState === "open")}
        onPointerDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {options.map((option, index) => (
          <div
            key={option.value}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={option.value === value}
            aria-disabled={option.disabled || undefined}
            className={`select-option${active === index ? " is-highlighted" : ""}`}
            onPointerMove={() => {
              if (!option.disabled) setActive(index);
            }}
            onClick={() => {
              if (option.disabled || trigger.current?.matches(":disabled"))
                return;
              close();
              trigger.current?.focus({ preventScroll: true });
              if (option.value !== value) onChange(option.value);
            }}
          >
            <span>{option.label}</span>
            {option.value === value && <Check size={14} aria-hidden="true" />}
          </div>
        ))}
      </div>
    </>
  );
}
