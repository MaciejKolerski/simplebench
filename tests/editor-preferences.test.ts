import assert from "node:assert/strict";
import { test } from "node:test";
import { restoreEditorPreferences } from "../src/editor-preferences.ts";

test("missing editor settings use four spaces; saved widths and literal tabs are restored", () => {
  assert.deepEqual(restoreEditorPreferences(null), {
    tabSize: 4,
    insertSpaces: true,
  });
  for (const tabSize of [1, 2, 4, 8, 16]) {
    for (const insertSpaces of [true, false]) {
      assert.deepEqual(
        restoreEditorPreferences({ version: 1, tabSize, insertSpaces }),
        {
          tabSize,
          insertSpaces,
        },
      );
    }
  }
});

test("invalid editor settings never silently turn into defaults", () => {
  for (const value of [
    undefined,
    [],
    {},
    "broken",
    { version: 2, tabSize: 4, insertSpaces: true },
    { version: 1, tabSize: 4 },
    ...[0, -1, 17, 2.5, NaN, Infinity, "4"].map((tabSize) => ({
      version: 1,
      tabSize,
      insertSpaces: true,
    })),
    { version: 1, tabSize: 4, insertSpaces: "true" },
  ])
    assert.throws(() => restoreEditorPreferences(value), /left intact/);
});
