import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mockDesktop } from "./desktop";

async function newFile(page: Page) {
  await page.getByRole("button", { name: /^New tab/ }).click();
  await page.getByRole("menuitem", { name: "New file", exact: true }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
}

test("new tab menu opens independent drafts without touching disk and supports keyboard navigation", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto("/");
  const button = page.getByRole("button", { name: /^New tab/ });
  await button.click();
  await expect(
    page.getByRole("menuitem", { name: "New terminal" }),
  ).toBeFocused();
  await page.screenshot({ path: "test-results/new-tab-menu.png" });
  await page.keyboard.press("Escape");
  await expect(button).toBeFocused();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await button.press("Enter");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-content")).toBeEmpty();
  await expect(
    page.getByRole("button", { name: "Reload from disk", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeEnabled();
  await page.keyboard.insertText("First draft 🦀");
  await newFile(page);
  await expect(page.locator(".cm-content")).toBeEmpty();
  await page.keyboard.insertText("Second draft");
  await page.getByRole("tab", { name: /Untitled-1/ }).click();
  await expect(page.locator(".cm-content")).toHaveText("First draft 🦀");
  await page.keyboard.press("Control+z");
  await expect(page.locator(".cm-content")).toBeEmpty();
  await page.keyboard.press("Control+y");
  await page.screenshot({ path: "test-results/new-file-editor.png" });
  expect(
    await page.evaluate(() =>
      (window as any).__nativeTest.calls.filter((call: any) =>
        [
          "read_editor_file",
          "save_editor_file",
          "save_new_editor_file",
          "file_operation",
        ].includes(call.command),
      ),
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(() =>
      (window as any).__nativeTest.calls
        .filter((call: any) => call.command === "watch_editor_files")
        .every((call: any) => call.args.files.length === 0),
    ),
  ).toBe(true);
  await button.click();
  await page.getByRole("menuitem", { name: "New terminal" }).click();
  await expect(page.getByRole("tab", { selected: true })).toContainText(
    "Terminal",
  );
});

test("first save supports cancellation, failure, outside paths, queued edits and restoration", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockDesktop(page);
  await page.goto("/");
  await newFile(page);
  await page.keyboard.insertText("const first = 1;");
  const id = await page.getByRole("tab", { selected: true }).getAttribute("id");
  await page.keyboard.press("Control+s");
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".editor-notice")).toHaveCount(0);
  await expect(page.locator(".cm-content")).toHaveText("const first = 1;");
  await page.evaluate(() => {
    const native = (window as any).__nativeTest;
    native.newFilePath = "/elsewhere/note.ts";
    native.failFileSave = true;
  });
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("alert")).toContainText("Disk is full");
  await expect(page.getByRole("tab", { selected: true })).toContainText(
    "Untitled-1",
  );
  await page.evaluate(() => {
    const native = (window as any).__nativeTest;
    native.failFileSave = false;
    native.fileSaveDelay = 300;
  });
  await page.keyboard.press("Control+s");
  await expect(
    page.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("const second = 2;");
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("tab", { selected: true })).toHaveText("note.ts");
  await expect(page.getByRole("tab", { selected: true })).toHaveAttribute(
    "id",
    id!,
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__nativeTest.editorFiles["/elsewhere/note.ts"]
            ?.content,
      ),
    )
    .toBe("const first = 1;\nconst second = 2;");
  await expect(
    page.getByRole("button", { name: "Change language mode" }),
  ).toContainText("TypeScript");
  let undos = 0;
  while ((await page.locator(".cm-content").textContent()) && undos < 2) {
    await page.keyboard.press("Control+z");
    ++undos;
  }
  await expect(page.locator(".cm-content")).toBeEmpty();
  for (let index = 0; index < undos; ++index)
    await page.keyboard.press("Control+y");
  await expect(page.locator(".cm-content")).toHaveText(
    "const first = 1;const second = 2;",
  );
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("const final = 3;");
  await page.keyboard.press("Control+s");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__nativeTest.editorFiles["/elsewhere/note.ts"]
            ?.content,
      ),
    )
    .toBe("const final = 3;");
  expect(
    await page.evaluate(
      () =>
        (window as any).__nativeTest.calls.filter(
          (call: any) => call.command === "save_new_editor_file",
        ).length,
    ),
  ).toBe(3);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("test-session")))
    .toContain('"relative":"note.ts"');
  expect(
    await page.evaluate(() => localStorage.getItem("test-session")),
  ).not.toContain("const first");
  await page.reload();
  await expect(page.getByRole("tab", { selected: true })).toHaveText("note.ts");
  await expect(page.locator(".cm-content")).toHaveText("const final = 3;");
  expect(errors).toEqual([]);
});

test("save before closing retains drafts after cancellation and failure and saves empty files", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto("/");
  await newFile(page);
  await page.keyboard.insertText("Keep me");
  await page.keyboard.press("Control+w");
  const dialog = page.getByRole("dialog", {
    name: "Save changes before closing?",
  });
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => {
    (window as any).__nativeTest.newFilePath = "/project/saved.txt";
    (window as any).__nativeTest.failFileSave = true;
  });
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("Disk is full");
  await page.evaluate(() => {
    (window as any).__nativeTest.failFileSave = false;
  });
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(1);
  expect(
    await page.evaluate(
      () =>
        (window as any).__nativeTest.editorFiles["/project/saved.txt"].content,
    ),
  ).toBe("Keep me");
  await newFile(page);
  await page.evaluate(() => {
    (window as any).__nativeTest.newFilePath = "/project/empty.txt";
  });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText(
    "empty.txt",
  );
  expect(
    await page.evaluate(
      () =>
        (window as any).__nativeTest.editorFiles["/project/empty.txt"].content,
    ),
  ).toBe("");
});
