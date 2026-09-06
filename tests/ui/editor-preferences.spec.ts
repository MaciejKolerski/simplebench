import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { newProject, newSession, openFileTab } from "../../src/model";
import { mockDesktop } from "./desktop";

const indentationButton = (page: Page) =>
  page.getByRole("button", {
    name: "Change indentation settings",
    exact: true,
  });
const editorText = (page: Page) =>
  page
    .locator(".cm-line")
    .allTextContents()
    .then((lines) => lines.join("\n"));
async function replaceText(page: Page, content: string) {
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(content);
}
async function openSettings(page: Page) {
  await mockDesktop(page);
  await page.goto("/?window=settings&page=editor");
  await expect(page.getByRole("combobox", { name: "Tab size" })).toBeEnabled();
}

test("indentation changes reach visible and hidden buffers, keep undo, and survive reload", async ({
  page,
  context,
}) => {
  await mockDesktop(page);
  await page.goto("/");
  await page.getByRole("button", { name: "README.md", exact: true }).click();
  await expect(indentationButton(page)).toHaveText("Spaces: 4");
  await replaceText(page, "    existing\nkeep");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByText("Ln 2, Col 4", { exact: true })).toBeVisible();
  const settings = await context.newPage();
  await openSettings(settings);
  await settings.getByRole("combobox", { name: "Tab size" }).selectOption("2");
  await expect(indentationButton(page)).toHaveText("Spaces: 2");
  expect(await editorText(page)).toBe("    existing\nkeep");
  await expect(page.getByText("Ln 2, Col 4", { exact: true })).toBeVisible();
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Tab");
  expect(await editorText(page)).toBe("    existing\nkee  p");
  await page.keyboard.press("Control+z");
  expect(await editorText(page)).toBe("    existing\nkeep");
  await page.keyboard.press("Control+z");
  await expect(page.locator(".cm-content")).toContainText(
    "A text file preview.",
  );

  await replaceText(page, "hidden buffer");
  await page
    .getByRole("button", { name: "it's a file.txt", exact: true })
    .click();
  await expect(page.locator(".cm-content")).toContainText("Hello, 🦀!");
  await settings.getByRole("combobox", { name: "Tab size" }).selectOption("8");
  await expect(indentationButton(page)).toHaveText("Spaces: 8");
  await page.getByRole("tab", { name: /README.md/ }).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Tab");
  expect(await editorText(page)).toBe("hidden buffer        ");
  await page.keyboard.press("Control+s");
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await settings.reload();
  await expect(
    settings.getByRole("combobox", { name: "Tab size" }),
  ).toHaveValue("8");
  await page.reload();
  await expect(indentationButton(page)).toHaveText("Spaces: 8");
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Tab");
  expect(await editorText(page)).toBe("hidden buffer                ");

  await indentationButton(page).click();
  await page
    .getByRole("menuitem", { name: "Configure Defaults…", exact: true })
    .click();
  expect(
    await page.evaluate(
      () =>
        (window as any).__nativeTest.calls
          .filter((call: any) => call.command === "open_settings")
          .at(-1).args,
    ),
  ).toEqual({ page: "editor" });
  await settings.getByRole("button", { name: "Keybinds", exact: true }).click();
  await settings.evaluate(() =>
    (window as any).__nativeTest.emitEvent("settings-page-changed", "editor"),
  );
  await expect(
    settings.getByRole("heading", { name: "Editor", exact: true }),
  ).toBeVisible();
});

test("Tab and Shift+Tab indent selected lines using spaces or literal tabs at the chosen width", async ({
  page,
  context,
}) => {
  await mockDesktop(page);
  await page.goto("/");
  await page.getByRole("button", { name: "README.md", exact: true }).click();
  await expect(indentationButton(page)).toBeVisible();
  const settings = await context.newPage();
  await openSettings(settings);
  await settings.getByRole("combobox", { name: "Tab size" }).selectOption("2");
  await expect(indentationButton(page)).toHaveText("Spaces: 2");
  await replaceText(page, "first\nsecond");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Tab");
  expect(await editorText(page)).toBe("  first\n  second");
  await page.keyboard.press("Shift+Tab");
  expect(await editorText(page)).toBe("first\nsecond");

  await settings
    .getByRole("combobox", { name: "Indent using" })
    .selectOption("tabs");
  await expect(indentationButton(page)).toHaveText("Tabs: 2");
  await settings.getByRole("combobox", { name: "Tab size" }).selectOption("8");
  await expect(indentationButton(page)).toHaveText("Tabs: 8");
  await expect
    .poll(() =>
      page
        .locator(".cm-content")
        .evaluate((element) => getComputedStyle(element).tabSize),
    )
    .toBe("8");
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Tab");
  expect(await editorText(page)).toBe("\tfirst\n\tsecond");
  await page.keyboard.press("Shift+Tab");
  expect(await editorText(page)).toBe("first\nsecond");
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Tab");
  expect(await editorText(page)).toBe("first\nsecond\t");
  await page.keyboard.press("Control+s");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__nativeTest.editorFiles["/project/README.md"]
            .content,
      ),
    )
    .toBe("first\nsecond\t");
});

test("Enter uses the selected width in Rust while exact line endings survive saving", async ({
  page,
  context,
}) => {
  const settings = await context.newPage();
  await openSettings(settings);
  await settings.getByRole("combobox", { name: "Tab size" }).selectOption("2");
  await expect(settings.getByRole("status")).toHaveText("Saved");
  const project = newProject("/project", "local:bash");
  const session = openFileTab(
    { ...newSession(), projects: [project], activeProjectId: project.id },
    project.workspaces[0].id,
    "/project",
    "main.rs",
  );
  await mockDesktop(page, true, session, undefined, {
    "/project/main.rs": {
      content: "fn main() {\r\n}\r\n",
      revision: "rust",
      encoding: "utf8-bom",
      readOnly: false,
    },
  });
  await page.goto("/");
  await expect(indentationButton(page)).toHaveText("Spaces: 2");
  await expect
    .poll(() => page.locator(".cm-line span[class]").count())
    .toBeGreaterThan(0);
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("// indented");
  await page.keyboard.press("Control+s");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__nativeTest.editorFiles["/project/main.rs"].content,
      ),
    )
    .toBe("fn main() {\r\n  // indented\r\n}\r\n");
  await expect(page.locator(".editor-status")).toContainText("UTF8-BOM");
});

test("failed saves keep working settings and unsupported files require an explicit reset", async ({
  page,
  context,
}) => {
  await openSettings(page);
  const width = page.getByRole("combobox", { name: "Tab size" });
  await width.selectOption("2");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.evaluate(() => {
    (window as any).__nativeTest.failEditorPreferencesSave = true;
  });
  await width.selectOption("8");
  await expect(page.getByRole("alert")).toContainText("Disk is full");
  await expect(width).toHaveValue("2");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("test-editor-preferences")!).tabSize,
    ),
  ).toBe(2);
  await page.evaluate(() => {
    (window as any).__nativeTest.failEditorPreferencesSave = false;
  });
  const invalid =
    '{"version":99,"tabSize":8,"insertSpaces":true,"future":"keep me"}';
  await page.evaluate((value) => {
    localStorage.setItem("test-editor-preferences", value);
    return (window as any).__nativeTest.emitEvent("editor-preferences-changed");
  }, invalid);
  await expect(page.getByRole("alert")).toContainText("left intact");
  await expect(width).toBeDisabled();
  await expect(width).toHaveValue("2");
  await page
    .getByRole("button", { name: "Retry loading", exact: true })
    .click();
  expect(
    await page.evaluate(() => localStorage.getItem("test-editor-preferences")),
  ).toBe(invalid);
  const editor = await context.newPage();
  await mockDesktop(editor);
  await editor.goto("/");
  await editor.getByRole("button", { name: "README.md", exact: true }).click();
  await expect(indentationButton(editor)).toHaveText("Spaces: 4");
  await page
    .getByRole("button", { name: "Reset defaults", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(width).toBeEnabled();
  await expect(width).toHaveValue("4");
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("test-editor-preferences")!),
    ),
  ).toEqual({ version: 1, tabSize: 4, insertSpaces: true });
});
