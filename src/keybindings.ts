export const actions = [
  {
    id: "saveFile",
    label: "Save file",
    description: "Save the active editor file.",
    group: "Editor",
    shortcut: "Ctrl+KeyS",
  },
  {
    id: "findFile",
    label: "Find in file",
    description: "Find and replace text in the active editor.",
    group: "Editor",
    shortcut: "Ctrl+KeyF",
  },
  {
    id: "goToLine",
    label: "Go to line",
    description: "Jump to a line in the active editor.",
    group: "Editor",
    shortcut: "Ctrl+KeyG",
  },
  {
    id: "toggleWordWrap",
    label: "Toggle word wrap",
    description: "Wrap long lines in the active editor.",
    group: "Editor",
    shortcut: "Alt+KeyZ",
  },
  {
    id: "newTerminal",
    label: "New terminal",
    description: "Split the active panel side by side.",
    group: "Terminals",
    shortcut: "Ctrl+KeyD",
  },
  {
    id: "splitVertical",
    label: "Split terminal vertically",
    description: "Place a terminal below the active panel.",
    group: "Terminals",
    shortcut: "Ctrl+Shift+KeyD",
  },
  {
    id: "closeTerminal",
    label: "Close terminal",
    description: "Close the active panel.",
    group: "Terminals",
    shortcut: "Ctrl+KeyW",
  },
  {
    id: "searchTerminal",
    label: "Find in terminal",
    description: "Search the active terminal's output.",
    group: "Terminals",
    shortcut: "Ctrl+Shift+KeyF",
  },
  {
    id: "copyTerminal",
    label: "Copy terminal selection",
    description: "Copy selected terminal text.",
    group: "Terminals",
    shortcut: "Ctrl+Shift+KeyC",
  },
  {
    id: "pasteTerminal",
    label: "Paste into terminal",
    description: "Paste text from the clipboard.",
    group: "Terminals",
    shortcut: "Ctrl+Shift+KeyV",
  },
  {
    id: "commandInput",
    label: "Command input",
    description: "Show or hide the multiline command input.",
    group: "Terminals",
    shortcut: "Ctrl+Shift+KeyI",
  },
  {
    id: "runCommand",
    label: "Run command input",
    description: "Run a command while the command input is focused.",
    group: "Terminals",
    shortcut: "Ctrl+Enter",
  },
  {
    id: "commandBlocks",
    label: "Command blocks",
    description: "Show or hide command history and output positions.",
    group: "Terminals",
    shortcut: "Ctrl+Shift+KeyH",
  },
  {
    id: "changeEnvironment",
    label: "Change terminal environment",
    description: "Choose the shell or WSL distribution for the active tab.",
    group: "Terminals",
    shortcut: "Ctrl+Shift+KeyL",
  },
  {
    id: "newTab",
    label: "New tab",
    description: "Open a tab with one terminal.",
    group: "Tabs",
    shortcut: "Ctrl+Shift+KeyT",
  },
  {
    id: "closeTab",
    label: "Close tab",
    description: "Close the active tab and all its terminals.",
    group: "Tabs",
    shortcut: "Ctrl+Shift+KeyW",
  },
  {
    id: "nextTab",
    label: "Next tab",
    description: "Switch to the next tab in this workspace.",
    group: "Tabs",
    shortcut: "Ctrl+Tab",
  },
  {
    id: "previousTab",
    label: "Previous tab",
    description: "Switch to the previous tab in this workspace.",
    group: "Tabs",
    shortcut: "Ctrl+Shift+Tab",
  },
  {
    id: "toggleExplorer",
    label: "Toggle file explorer",
    description: "Show or hide the file explorer.",
    group: "Workspace",
    shortcut: "Ctrl+Shift+KeyE",
  },
  {
    id: "toggleSourceControl",
    label: "Toggle source control",
    description: "Show or hide Source Control when Git is available.",
    group: "Workspace",
    shortcut: "Ctrl+Shift+KeyG",
  },
  {
    id: "toggleWorkspaces",
    label: "Toggle workspaces",
    description: "Show or hide the workspace list for all folders.",
    group: "Workspace",
    shortcut: null,
  },
  {
    id: "openSettings",
    label: "Open settings",
    description: "Open the settings window.",
    group: "Workspace",
    shortcut: "Ctrl+Comma",
  },
] as const;

export type ActionId = (typeof actions)[number]["id"];
export type Keybindings = Record<ActionId, string | null>;
export interface KeybindingSettings {
  version: 1;
  bindings: Partial<Keybindings>;
  focusFollowsPointer?: boolean;
}

const modifiers = ["Ctrl", "Alt", "Meta", "Shift"];
const keyNames: Record<string, string> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
  Space: "Space",
  Tab: "Tab",
  Enter: "Enter",
  Escape: "Esc",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "Page Up",
  PageDown: "Page Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  ArrowDown: "Down",
};
const isFunctionKey = (code: string) => /^F([1-9]|1\d|2[0-4])$/.test(code);
const supportedCode = (code: string) =>
  /^(Key[A-Z]|Digit[0-9])$/.test(code) ||
  isFunctionKey(code) ||
  Object.hasOwn(keyNames, code);

export function defaultKeybindings(mac = false): Keybindings {
  return Object.fromEntries(
    actions.map(({ id, shortcut }) => [
      id,
      mac ? (shortcut?.replace("Ctrl", "Meta") ?? null) : shortcut,
    ]),
  ) as Keybindings;
}

export function validShortcut(value: string): boolean {
  const parts = value.split("+");
  const code = parts.pop() ?? "";
  return (
    supportedCode(code) &&
    parts.every((part) => modifiers.includes(part)) &&
    new Set(parts).size === parts.length &&
    modifiers.filter((part) => parts.includes(part)).join("+") ===
      parts.join("+") &&
    (parts.some((part) => part !== "Shift") || isFunctionKey(code))
  );
}

export interface KeyEvent {
  code: string;
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
  getModifierState?: (key: string) => boolean;
}

export function shortcutFromEvent(event: KeyEvent): string | null {
  if (
    event.isComposing ||
    ["Dead", "Process"].includes(event.key) ||
    event.getModifierState?.("AltGraph")
  )
    return null;
  const shortcut = [
    event.ctrlKey && "Ctrl",
    event.altKey && "Alt",
    event.metaKey && "Meta",
    event.shiftKey && "Shift",
    event.code,
  ]
    .filter(Boolean)
    .join("+");
  return validShortcut(shortcut) ? shortcut : null;
}

export function actionForEvent(
  event: KeyEvent,
  bindings: Keybindings,
): ActionId | undefined {
  const shortcut = shortcutFromEvent(event);
  return shortcut
    ? actions.find(({ id }) => bindings[id] === shortcut)?.id
    : undefined;
}

export function formatShortcut(shortcut: string | null): string {
  if (!shortcut) return "Not set";
  return shortcut
    .split("+")
    .map((part) =>
      part === "Meta"
        ? "Cmd"
        : (keyNames[part] ?? part.replace(/^(Key|Digit)/, "")),
    )
    .join("+");
}

export function shortcutTitle(label: string, binding: string | null): string {
  return binding ? `${label} (${formatShortcut(binding)})` : label;
}

export function bindingConflict(
  bindings: Keybindings,
  id: ActionId,
  shortcut: string | null,
): string | undefined {
  if (!shortcut) return;
  return actions.find(
    (action) => action.id !== id && bindings[action.id] === shortcut,
  )?.label;
}

export function restoreKeybindings(value: unknown, mac = false): Keybindings {
  const result = defaultKeybindings(mac);
  if (value === null || value === undefined) return result;
  if (
    typeof value !== "object" ||
    !("version" in value) ||
    value.version !== 1 ||
    !("bindings" in value) ||
    !value.bindings ||
    typeof value.bindings !== "object" ||
    Array.isArray(value.bindings) ||
    ("focusFollowsPointer" in value &&
      typeof value.focusFollowsPointer !== "boolean")
  ) {
    throw new Error(
      "The saved keybindings use an unsupported format. The file has been left intact.",
    );
  }
  for (const { id } of actions) {
    if (!Object.hasOwn(value.bindings, id)) continue;
    const shortcut = (value.bindings as Record<string, unknown>)[id];
    if (
      shortcut !== null &&
      (typeof shortcut !== "string" || !validShortcut(shortcut))
    )
      throw new Error(
        `The saved shortcut for ${id} is invalid. The file has been left intact.`,
      );
    result[id] = shortcut;
  }
  // New editor defaults must not invalidate existing custom terminal shortcuts.
  for (const { id, group } of actions) {
    if (
      group === "Editor" &&
      !Object.hasOwn(value.bindings, id) &&
      bindingConflict(result, id, result[id])
    )
      result[id] = null;
  }
  for (const { id, label } of actions) {
    const conflict = bindingConflict(result, id, result[id]);
    if (conflict)
      throw new Error(
        `The saved shortcuts for ${label} and ${conflict} conflict. The file has been left intact.`,
      );
  }
  return result;
}

export function isTextInput(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !target.classList.contains("xterm-helper-textarea") &&
    !!target.closest(
      "input, textarea, select, [role='combobox'], [contenteditable]:not([contenteditable='false'])",
    )
  );
}
