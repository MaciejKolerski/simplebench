import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  fileIconId,
  fileIconDefinition,
  iconCharacter,
  productIconDefinition,
  type IconTheme,
} from "../src/theme/icon-theme.ts";

const theme: IconTheme = {
  iconDefinitions: Object.fromEntries(
    [
      "file",
      "folder",
      "open",
      "root",
      "named",
      "namedOpen",
      "ts",
      "dts",
      "parent",
      "name",
      "language",
      "light",
      "contrast",
    ].map((id) => [id, { iconPath: `${id}.svg` }]),
  ),
  file: "file",
  folder: "folder",
  folderExpanded: "open",
  rootFolder: "root",
  folderNames: { src: "named" },
  folderNamesExpanded: { src: "namedOpen" },
  fileExtensions: { ts: "ts", "d.ts": "dts", "src/ts": "parent" },
  fileNames: { "src/special.d.ts": "name" },
  languageIds: { python: "language", json: "language" },
  light: { file: "light", fileExtensions: { ts: "light" } },
  highContrast: { fileExtensions: { ts: "contrast" } },
};
test("file associations respect filenames, parent folders, multipart extensions and language fallbacks", () => {
  assert.equal(
    fileIconId(theme, { path: "/project/SRC/SPECIAL.D.TS" }, "dark"),
    "name",
  );
  assert.equal(
    fileIconId(theme, { path: "/project/lib/types.d.ts" }, "dark"),
    "dts",
  );
  assert.equal(
    fileIconId(theme, { path: "/project/src/main.ts" }, "dark"),
    "parent",
  );
  assert.equal(
    fileIconId(theme, { path: "/project/lib/test.py" }, "dark"),
    "language",
  );
  assert.equal(
    fileIconId(theme, { path: "settings.jsonc" }, "dark"),
    "language",
  );
  assert.equal(
    fileIconId(theme, { path: "unknown", language: "python" }, "dark"),
    "language",
  );
  assert.equal(fileIconId(theme, { path: "unknown" }, "dark"), "file");
});
test("mode variants obey selector specificity instead of overwriting more specific associations", () => {
  assert.equal(fileIconId(theme, { path: "unknown" }, "light"), "light");
  assert.equal(fileIconId(theme, { path: "test.py" }, "light"), "light");
  assert.equal(fileIconId(theme, { path: "test.ts" }, "light"), "light");
  assert.equal(
    fileIconId(theme, { path: "src/special.d.ts" }, "light"),
    "name",
  );
  assert.equal(
    fileIconId(theme, { path: "test.ts" }, "light", true),
    "contrast",
  );
});
test("expanded and root folders use VS Code specificity and fallback rules", () => {
  assert.equal(
    fileIconId(theme, { path: "src", folder: true }, "dark"),
    "named",
  );
  assert.equal(
    fileIconId(theme, { path: "src", folder: true, expanded: true }, "dark"),
    "namedOpen",
  );
  assert.equal(
    fileIconId(theme, { path: "project", folder: true, root: true }, "dark"),
    "root",
  );
  assert.equal(
    fileIconId(
      theme,
      { path: "project", folder: true, root: true, expanded: true },
      "dark",
    ),
    "open",
  );
  assert.equal(
    fileIconId(
      { ...theme, folderNamesExpanded: undefined },
      { path: "src", folder: true, expanded: true },
      "dark",
    ),
    "open",
  );
  assert.equal(
    fileIconId({ iconDefinitions: {} }, { path: "file" }, "dark"),
    undefined,
  );
});
test("font definitions inherit individual style properties and decode escaped glyphs", () => {
  const icons: IconTheme = {
    iconDefinitions: {
      base: { fontCharacter: "\\e001", fontColor: "#abcdef" },
      specific: { fontColor: "#112233" },
    },
    file: "base",
    fileNames: { file: "specific" },
  };
  assert.deepEqual(
    fileIconDefinition(icons, { path: "file" }, "dark")?.definition,
    { fontCharacter: "\\e001", fontColor: "#112233" },
  );
  assert.equal(iconCharacter("\\e001"), "\ue001");
  assert.equal(iconCharacter("\ue001"), "\ue001");
  assert.equal(productIconDefinition(icons, ["missing", "base"])?.id, "base");
  assert.equal(productIconDefinition(icons, ["missing"]), undefined);
});
