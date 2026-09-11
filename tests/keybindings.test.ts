import assert from "node:assert/strict";
import test from "node:test";
import {
  actionForEvent,
  bindingConflict,
  defaultKeybindings,
  formatShortcut,
  restoreKeybindings,
  shortcutFromEvent,
  validShortcut,
} from "../src/keybindings.ts";
import type { KeyEvent } from "../src/keybindings.ts";

const key = (overrides: Partial<KeyEvent> = {}): KeyEvent => ({
  code: "KeyD",
  key: "d",
  ctrlKey: true,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...overrides,
});

test("macOS overview leaves application switching to the system", () => {
  const bindings = defaultKeybindings(true);
  assert.equal(
    actionForEvent(key({ code: "Tab", key: "Tab" }), bindings),
    "terminalOverview",
  );
  assert.equal(
    actionForEvent(
      key({ code: "Tab", key: "Tab", ctrlKey: false, metaKey: true }),
      bindings,
    ),
    undefined,
  );
  assert.equal(bindings.newTerminal, "Meta+KeyD");
  assert.equal(bindings.closeTerminal, "Meta+KeyW");
  assert.equal(
    restoreKeybindings(
      { version: 1, bindings: { terminalOverview: "Meta+KeyO" } },
      true,
    ).terminalOverview,
    "Meta+KeyO",
  );
});

test("new editor defaults preserve older custom terminal shortcuts", () => {
  const restored = restoreKeybindings({
    version: 1,
    bindings: { newTerminal: "Ctrl+KeyS", toggleExplorer: "Ctrl+KeyF" },
  });
  assert.equal(restored.newTerminal, "Ctrl+KeyS");
  assert.equal(restored.saveFile, null);
  assert.equal(restored.findFile, null);
  assert.equal(restored.goToLine, "Ctrl+KeyG");
  assert.throws(
    () =>
      restoreKeybindings({
        version: 1,
        bindings: { newTerminal: "Ctrl+KeyS", saveFile: "Ctrl+KeyS" },
      }),
    /conflict/,
  );
});

test("terminal panel shortcuts require exact modifiers and distinguish tabs", () => {
  const bindings = defaultKeybindings();
  assert.equal(actionForEvent(key(), bindings), "newTerminal");
  assert.equal(
    actionForEvent(key({ shiftKey: true }), bindings),
    "splitVertical",
  );
  assert.equal(
    actionForEvent(key({ code: "KeyW", key: "w" }), bindings),
    "closeTerminal",
  );
  assert.equal(
    actionForEvent(key({ code: "KeyW", key: "W", shiftKey: true }), bindings),
    "closeTab",
  );
  assert.equal(actionForEvent(key({ altKey: true }), bindings), undefined);
  assert.equal(actionForEvent(key({ ctrlKey: false }), bindings), undefined);
  assert.equal(
    actionForEvent(key({ code: "KeyC", key: "c" }), bindings),
    undefined,
  );
});

test("overview takes the old tab default while custom assignments remain intact", () => {
  for (const mac of [false, true]) {
    const mod = mac ? "Meta" : "Ctrl";
    const saved = {
      version: 1,
      bindings: { nextTab: `${mod}+Tab`, previousTab: `${mod}+Shift+Tab` },
    };
    const restored = restoreKeybindings(saved, mac);
    assert.equal(restored.terminalOverview, "Ctrl+Tab");
    assert.equal(restored.nextTab, `${mod}+PageDown`);
    assert.equal(restored.previousTab, `${mod}+PageUp`);
    assert.equal(saved.bindings.nextTab, `${mod}+Tab`);
    assert.deepEqual(
      restoreKeybindings({ version: 1, bindings: restored }, mac),
      restored,
    );
  }
  const restored = restoreKeybindings({
    version: 1,
    bindings: {
      nextTab: "Ctrl+Tab",
      newTerminal: "Ctrl+PageDown",
      previousTab: null,
    },
  });
  assert.equal(restored.terminalOverview, "Ctrl+Tab");
  assert.equal(restored.newTerminal, "Ctrl+PageDown");
  assert.equal(restored.nextTab, null);
  assert.equal(restored.previousTab, null);
  const custom = restoreKeybindings({
    version: 1,
    bindings: { newTerminal: "Ctrl+Tab" },
  });
  assert.equal(custom.newTerminal, "Ctrl+Tab");
  assert.equal(custom.terminalOverview, null);
  assert.equal(
    restoreKeybindings({
      version: 1,
      bindings: { terminalOverview: null, nextTab: "Ctrl+Tab" },
    }).nextTab,
    "Ctrl+Tab",
  );
  assert.throws(
    () =>
      restoreKeybindings({
        version: 1,
        bindings: { terminalOverview: "Ctrl+KeyD" },
      }),
    /conflict/,
  );
});

test("recording preserves composition, AltGr and unmodified terminal input", () => {
  assert.equal(shortcutFromEvent(key({ isComposing: true })), null);
  assert.equal(shortcutFromEvent(key({ key: "Dead" })), null);
  assert.equal(
    shortcutFromEvent(key({ getModifierState: (name) => name === "AltGraph" })),
    null,
  );
  assert.equal(
    shortcutFromEvent(key({ ctrlKey: false, shiftKey: true })),
    null,
  );
  assert.equal(
    shortcutFromEvent(key({ ctrlKey: false, code: "F8", key: "F8" })),
    "F8",
  );
  assert.equal(
    shortcutFromEvent(key({ code: "Comma", key: "," })),
    "Ctrl+Comma",
  );
  assert.equal(validShortcut("Shift+Ctrl+KeyD"), false);
  assert.equal(validShortcut("Ctrl+Ctrl+KeyD"), false);
  assert.equal(validShortcut("Ctrl+Unidentified"), false);
});

test("saved overrides and disabled shortcuts replace defaults without collisions", () => {
  const bindings = restoreKeybindings({
    version: 1,
    bindings: {
      newTerminal: "Ctrl+KeyK",
      closeTerminal: null,
      futureAction: "Ctrl+KeyZ",
    },
  });
  assert.equal(actionForEvent(key(), bindings), undefined);
  assert.equal(
    actionForEvent(key({ code: "KeyK", key: "k" }), bindings),
    "newTerminal",
  );
  assert.equal(
    actionForEvent(key({ code: "KeyW", key: "w" }), bindings),
    undefined,
  );
  assert.equal(bindings.openSettings, "Ctrl+Comma");
  assert.equal(
    bindingConflict(bindings, "newTerminal", "Ctrl+Comma"),
    "Open settings",
  );
  assert.equal(
    bindingConflict(bindings, "newTerminal", "Ctrl+KeyK"),
    undefined,
  );
  assert.equal(bindingConflict(bindings, "newTerminal", null), undefined);
  assert.deepEqual(restoreKeybindings({ version: 1, bindings }), bindings);
  assert.deepEqual(restoreKeybindings(null), defaultKeybindings());
});

test("invalid settings and duplicate bindings are rejected instead of discarded", () => {
  for (const data of [
    { version: 2, bindings: {} },
    { version: 1, bindings: [] },
    { version: 1, bindings: { newTerminal: "KeyD" } },
    { version: 1, bindings: { newTerminal: "Ctrl+KeyW" } },
    { version: 1, bindings: {}, focusFollowsPointer: "false" },
    { version: 1, bindings: {}, focusFollowsPointer: null },
  ])
    assert.throws(() => restoreKeybindings(data), /left intact/);
});

test("pointer focus settings preserve shortcut overrides in either mode", () => {
  for (const focusFollowsPointer of [true, false]) {
    const bindings = restoreKeybindings({
      version: 1,
      bindings: { newTerminal: "Ctrl+KeyK" },
      focusFollowsPointer,
    });
    assert.equal(bindings.newTerminal, "Ctrl+KeyK");
    assert.equal(bindings.closeTerminal, "Ctrl+KeyW");
  }
});

test("macOS defaults use the same canonical modifier order as recorded keys", () => {
  const event = key({ ctrlKey: false, metaKey: true, shiftKey: true });
  assert.equal(
    actionForEvent(event, defaultKeybindings(true)),
    "splitVertical",
  );
  assert.equal(shortcutFromEvent(event), "Meta+Shift+KeyD");
  assert.equal(formatShortcut(shortcutFromEvent(event)), "Cmd+Shift+D");
  assert.equal(formatShortcut("Ctrl+Comma"), "Ctrl+,");
  assert.equal(formatShortcut(null), "Not set");
  assert.deepEqual(
    restoreKeybindings(
      { version: 1, bindings: defaultKeybindings(true) },
      true,
    ),
    defaultKeybindings(true),
  );
});

test("workspace panel shortcuts are opt-in and restore custom assignments", () => {
  assert.equal(defaultKeybindings().toggleWorkspaces, null);
  assert.equal(defaultKeybindings(true).toggleWorkspaces, null);
  const restored = restoreKeybindings({
    version: 1,
    bindings: { toggleWorkspaces: "Ctrl+Shift+KeyB" },
  });
  assert.equal(
    actionForEvent(key({ code: "KeyB", key: "B", shiftKey: true }), restored),
    "toggleWorkspaces",
  );
});
