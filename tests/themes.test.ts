import { test } from "node:test";
import assert from "node:assert/strict";
import {
  builtinPreferences,
  parseTheme,
  relativeAsset,
  resolveAppearance,
} from "../src/themes.ts";

test("system appearance follows either OS mode while explicit choices take precedence", () => {
  assert.equal(builtinPreferences.appearance, "system");
  for (const system of ["light", "dark"] as const) {
    assert.equal(resolveAppearance("system", system), system);
    assert.equal(resolveAppearance("light", system), "light");
    assert.equal(resolveAppearance("dark", system), "dark");
  }
});

test("partial themes preserve alpha colors, local resources, and JSON component styles", () => {
  const theme = {
    version: 1,
    name: "Example",
    tokens: { "--color-background": "#101010cc", "--radius-control": "0px" },
    backgrounds: {
      terminal: { image: "images/wall paper.png", opacity: 0.3, blur: 4 },
    },
    styles: { ".tab:hover": { "border-radius": "0", opacity: "0.8" } },
    terminal: { fontSize: 18, cursorBlink: false, colors: { blue: "#7a8fa6" } },
    stylesheet: "styles/theme.css",
  };
  assert.deepEqual(parseTheme(theme), theme);
  assert.deepEqual(parseTheme({ version: 1, name: "Minimal" }), {
    version: 1,
    name: "Minimal",
  });
});
test("invalid versions, options, and misspelled sections are rejected before applying", () => {
  for (const patch of [
    { version: 2 },
    { name: "" },
    { colour: {} },
    { tokens: { color: "red" } },
    { backgrounds: { terminal: { opacity: 2 } } },
    { terminal: { fontSize: 0 } },
    { terminal: { lineHeight: 0.5 } },
    { terminal: { cursorStyle: "beam" } },
    { terminal: { cursorBlink: "yes" } },
    { terminal: { fontWeight: 1500 } },
    { terminal: { colors: { purple: "red" } } },
    { terminal: { scrollback: 100000 } },
    { styles: { ".tab": { borderRadius: "0" } } },
  ]) {
    assert.throws(() => parseTheme({ version: 1, name: "Invalid", ...patch }));
  }
});
test("asset paths cannot escape a theme or name external URLs", () => {
  for (const path of [
    "../wall.png",
    "/wall.png",
    "C:\\wall.png",
    "https://example.com/wall.png",
    "data:image/png,abc",
    "images//wall.png",
    "images/./wall.png",
    "wall.png?query",
    "wall.png#fragment",
    "image\n.png",
  ])
    assert.throws(() => relativeAsset(path), path);
  for (const path of ["wall.png", "images/wall paper.png", "obrazy/żółć.png"])
    assert.doesNotThrow(() => relativeAsset(path));
});

test("stylesheet lists retain order and reject ambiguous or invalid paths", () => {
  const base = { version: 1, name: "CSS theme" };
  const paths = ["base.css", "styles/żółty motyw.css", "overrides.css"];
  assert.deepEqual(
    parseTheme({ ...base, stylesheets: paths }).stylesheets,
    paths,
  );
  assert.deepEqual(parseTheme({ ...base, stylesheets: [] }).stylesheets, []);
  assert.equal(
    parseTheme({ ...base, stylesheet: "legacy.css" }).stylesheet,
    "legacy.css",
  );
  for (const patch of [
    { stylesheets: "theme.css" },
    { stylesheets: null },
    { stylesheets: ["base.css", "base.css"] },
    { stylesheets: ["../outside.css"] },
    { stylesheets: ["https://example.com/theme.css"] },
    { stylesheets: ["image.svg"] },
    { stylesheets: [false] },
    { stylesheets: ["styles/theme.css?version=1"] },
    { stylesheets: [], stylesheet: "legacy.css" },
  ])
    assert.throws(
      () => parseTheme({ ...base, ...patch }),
      JSON.stringify(patch),
    );
});
