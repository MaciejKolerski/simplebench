import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultTerminalPreferences,
  restoreTerminalPreferences,
} from "../src/terminal-preferences.ts";

test("terminal defaults inherit appearance and validate bounded, independent overrides", () => {
  const defaults = restoreTerminalPreferences(null);
  assert.deepEqual(defaults, defaultTerminalPreferences);
  defaults.behavior.scrollback = 0;
  assert.equal(defaultTerminalPreferences.behavior.scrollback, 10_000);
  const saved = {
    version: 1,
    ...defaultTerminalPreferences,
    appearance: {
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 24,
      cursorBlink: false,
      colors: { selectionBackground: "#12345680" },
    },
  };
  assert.deepEqual(restoreTerminalPreferences(saved), {
    appearance: saved.appearance,
    behavior: saved.behavior,
  });
  for (const invalid of [
    undefined,
    [],
    {},
    { ...saved, version: 2 },
    { ...saved, future: true },
    ...[
      { fontSize: 0 },
      { fontFamily: "" },
      { fontFamily: "mono; color: red" },
      { colors: { red: "invalid" } },
      { colors: { unknown: "#123456" } },
      { cursorWidth: 1.5 },
    ].map((appearance) => ({ ...saved, appearance })),
    ...[
      { scrollback: -1 },
      { scrollback: 100001 },
      { scrollback: 1.5 },
      { scrollSensitivity: NaN },
      { tabStopWidth: 0 },
      { smoothScrollDuration: Infinity },
      { wordSeparator: "\n" },
      { screenReaderMode: "true" },
      { unknown: 1 },
    ].map((patch) => ({ ...saved, behavior: { ...saved.behavior, ...patch } })),
  ])
    assert.throws(() => restoreTerminalPreferences(invalid), /left intact/);
});
