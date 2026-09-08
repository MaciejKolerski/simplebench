import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mockDesktop } from "./desktop";

async function setup(page: Page, git = true) {
  await mockDesktop(page, git, undefined, undefined, {
    "/project/src/main.ts": {
      content: "first\n🦀 needle here\nneedle again\n",
      revision: "initial",
      encoding: "utf8",
      readOnly: false,
    },
    "/project/README.md": {
      content: "# Project\nneedle in readme\n",
      revision: "initial",
      encoding: "utf8",
      readOnly: false,
    },
  });
  await page.addInitScript(() => {
    const native = (window as any).__nativeTest;
    native.operationError = "";
    native.searchDelays = {};
    let entries = [
      { relative: "src", directory: true },
      { relative: "src/main.ts", directory: false },
      { relative: "README.md", directory: false },
    ];
    const bridge = (window as any).__TAURI_INTERNALS__;
    const invoke = bridge.invoke;
    bridge.invoke = async (command: string, args: any = {}) => {
      if (
        ![
          "list_directory",
          "resolve_project_entry",
          "file_operation",
          "search_project",
          "cancel_project_search",
          "open_project_item",
          "ignore_project_item",
        ].includes(command)
      )
        return invoke(command, args);
      native.calls.push({ command, args });
      if (command === "resolve_project_entry")
        return `${args.root}/${args.relative}`.replace(/\/$/, "");
      if (command === "list_directory")
        return entries
          .filter(
            (entry) =>
              entry.relative.split("/").slice(0, -1).join("/") ===
              args.relative,
          )
          .map((entry) => ({
            name: entry.relative.split("/").at(-1),
            relativePath: entry.relative,
            path: `${args.root}/${entry.relative}`,
            isDirectory: entry.directory,
            isSymlink: false,
          }));
      if (command === "search_project") {
        const result = { matches: [] as any[], limited: false, skipped: 0 };
        for (const [path, file] of Object.entries(native.editorFiles) as [
          string,
          any,
        ][]) {
          const relative = path.slice(args.root.length + 1);
          if (args.relative && !relative.startsWith(args.relative + "/"))
            continue;
          file.content.split("\n").forEach((line: string, index: number) => {
            const column = args.caseSensitive
              ? line.indexOf(args.query)
              : line.toLowerCase().indexOf(args.query.toLowerCase());
            if (column >= 0)
              result.matches.push({
                relative,
                line: index + 1,
                column: column + 1,
                length: args.query.length,
                preview: line,
                previewStart: 0,
              });
          });
        }
        if (native.searchDelays[args.query])
          await new Promise((resolve) =>
            setTimeout(resolve, native.searchDelays[args.query]),
          );
        return result;
      }
      if (command !== "file_operation") return;
      if (native.operationError) throw new Error(native.operationError);
      const { operation, relative, root } = args;
      const source = operation.source ?? relative;
      const oldPath = `${operation.sourceRoot ?? root}/${source}`.replace(
        /\/$/,
        "",
      );
      if (["delete", "trash"].includes(operation.kind)) {
        entries = entries.filter(
          (entry) =>
            entry.relative !== source &&
            !entry.relative.startsWith(source + "/"),
        );
        for (const key of Object.keys(native.editorFiles))
          if (key === oldPath || key.startsWith(oldPath + "/"))
            delete native.editorFiles[key];
        return { oldPath, newPath: null };
      }
      const target =
        operation.kind === "rename"
          ? [...source.split("/").slice(0, -1), operation.name].join("/")
          : operation.kind === "duplicate"
            ? source.replace(/(\.[^/.]+)?$/, " copy$1")
            : [relative, operation.name ?? source.split("/").at(-1)]
                .filter(Boolean)
                .join("/");
      if (entries.some((entry) => entry.relative === target))
        throw new Error("A file or folder with that name already exists.");
      const moving = ["rename", "move"].includes(operation.kind);
      if (operation.kind.startsWith("new"))
        entries.push({
          relative: target,
          directory: operation.kind === "newFolder",
        });
      else {
        const copied = entries
          .filter(
            (entry) =>
              entry.relative === source ||
              entry.relative.startsWith(source + "/"),
          )
          .map((entry) => ({
            ...entry,
            relative: target + entry.relative.slice(source.length),
          }));
        if (moving)
          entries = entries.filter(
            (entry) =>
              entry.relative !== source &&
              !entry.relative.startsWith(source + "/"),
          );
        entries.push(...copied);
        for (const [path, content] of Object.entries(native.editorFiles))
          if (path === oldPath || path.startsWith(oldPath + "/")) {
            native.editorFiles[
              `${root}/${target}${path.slice(oldPath.length)}`
            ] = structuredClone(content);
            if (moving) delete native.editorFiles[path];
          }
      }
      return { oldPath: moving ? oldPath : null, newPath: `${root}/${target}` };
    };
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "README.md", exact: true }),
  ).toBeVisible();
}
async function menu(page: Page, name: string, item: string) {
  await page
    .getByRole("button", { name, exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

test("searches the project or a folder and opens the matching editor selection", async ({
  page,
}) => {
  await setup(page);
  await menu(page, "src", "Search in Folder…");
  await page.getByRole("textbox", { name: "Search in files" }).fill("needle");
  await expect(page.getByRole("status")).toContainText("2 matches in 1 file");
  await page
    .getByRole("button", { name: "src/main.ts, line 2, column 4", exact: true })
    .click();
  await expect(page.locator(".cm-content")).toContainText("🦀 needle here");
  await expect(page.getByRole("contentinfo")).toContainText("Ln 2, Col 10");
  await page.keyboard.insertText("REPLACED");
  await expect(page.locator(".cm-content")).toContainText("🦀 REPLACED here");
  await page.getByRole("button", { name: "Search entire project" }).click();
  await expect(page.getByRole("status")).toContainText("3 matches in 2 files");
  await page.screenshot({ path: test.info().outputPath("project-search.png") });
  await page.getByRole("button", { name: "Back to Explorer" }).click();
  await menu(page, "Project folder project", "Search in Folder…");
  await expect(page.getByText("Entire project", { exact: true })).toBeVisible();
});

test("renames a folder without losing dirty editor text or undo history", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "src", exact: true }).click();
  await page.getByRole("button", { name: "main.ts", exact: true }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("unsaved");
  await menu(page, "src", "Rename…");
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("code");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".editor-path")).toContainText("code/main.ts");
  await expect(page.locator(".cm-content")).toContainText("unsaved");
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".cm-content")).not.toContainText("unsaved");
  await page.keyboard.press("Control+Shift+z");
  await page.keyboard.press("Control+s");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__nativeTest.editorFiles["/project/code/main.ts"]
            .content,
      ),
    )
    .toContain("unsaved");
  await expect(
    page.getByRole("tab", { name: "Terminal", exact: true }),
  ).toBeVisible();
});

test("deleting a dirty folder supports cancel and retains edits after a failed save", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "src", exact: true }).click();
  await page.getByRole("button", { name: "main.ts", exact: true }).click();
  await page.locator(".cm-content").fill("dirty");
  await menu(page, "src", "Delete Permanently…");
  await page
    .getByRole("button", { name: "Delete Permanently", exact: true })
    .click();
  const guard = page.getByRole("dialog", {
    name: "Save changes before closing?",
  });
  await guard.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("dirty");
  await page
    .getByRole("button", { name: "Delete Permanently", exact: true })
    .click();
  await page.evaluate(() => {
    (window as any).__nativeTest.failFileSave = true;
  });
  await guard.getByRole("button", { name: /Save/ }).click();
  await expect(guard).toContainText("Disk is full");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__nativeTest.calls.filter(
            (call: any) => call.command === "file_operation",
          ).length,
      ),
    )
    .toBe(0);
  await page.evaluate(() => {
    (window as any).__nativeTest.failFileSave = false;
  });
  await guard.getByRole("button", { name: /Save/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /main.ts/ })).toHaveCount(0);
  await expect(page.locator(".xterm-screen")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "src", exact: true }),
  ).toHaveCount(0);
});

test("creates and copies items and exposes scoped Git history", async ({
  page,
}) => {
  await setup(page);
  await menu(page, "README.md", "Copy");
  await menu(page, "src", "Paste");
  await page.getByRole("button", { name: "src", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "README.md", exact: true }),
  ).toHaveCount(2);
  await menu(page, "Project folder project", "New Folder");
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("docs");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "New Folder", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "docs", exact: true }),
  ).toBeVisible();
  await menu(page, "src", "View History");
  await expect(
    page.getByRole("dialog", { name: "Git History · src" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__nativeTest.calls
            .filter((call: any) => call.command === "git_history")
            .at(-1)?.args.path,
      ),
    )
    .toBe("src");
});

test("context menus fit small windows and report failed renames without closing the editor", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 420 });
  await setup(page, false);
  await page
    .getByRole("button", { name: "README.md", exact: true })
    .click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "View History", exact: true }),
  ).toBeDisabled();
  const bounds = await page.getByRole("menu").boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(420);
  await page.screenshot({
    path: test.info().outputPath("explorer-menu-small.png"),
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "README.md", exact: true }).focus();
  await page.keyboard.press("F2");
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("src");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("already exists");
  await expect(
    page.getByRole("button", { name: "README.md", exact: true }),
  ).toBeVisible();
});

test("a newer search cannot be replaced by a slower previous response", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    (window as any).__nativeTest.searchDelays.needle = 1000;
  });
  await page
    .getByRole("button", { name: "Search in project", exact: true })
    .click();
  const input = page.getByRole("textbox", { name: "Search in files" });
  await input.fill("needle");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__nativeTest.calls.some(
          (call: any) =>
            call.command === "search_project" && call.args.query === "needle",
        ),
      ),
    )
    .toBe(true);
  await input.fill("first");
  await expect(page.getByRole("status")).toContainText("1 matches in 1 file");
  await page.waitForTimeout(1100);
  await expect(page.getByRole("status")).toContainText("1 matches in 1 file");
  await expect(
    page.getByRole("button", {
      name: "src/main.ts, line 1, column 1",
      exact: true,
    }),
  ).toBeVisible();
});

test("moving a dirty file updates its buffer location and keeps failed operations reviewable", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "README.md", exact: true }).click();
  await page.locator(".cm-content").fill("unsaved move");
  await menu(page, "README.md", "Cut");
  await menu(page, "src", "Paste");
  await expect(page.locator(".editor-path")).toContainText("src/README.md");
  await expect(page.locator(".cm-content")).toContainText("unsaved move");
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+s");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__nativeTest.editorFiles["/project/src/README.md"]
            .content,
      ),
    )
    .toBe("unsaved move");
  await page.emulateMedia({ colorScheme: "dark" });
  await menu(page, "src", "Rename…");
  await page.screenshot({
    path: test.info().outputPath("rename-folder-dark.png"),
  });
});
