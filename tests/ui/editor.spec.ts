import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  newProject,
  newSession,
  newWorkspace,
  openFileTab,
} from "../../src/model";
import { buffer, mockDesktop } from "./desktop";

async function openReadme(page: Page) {
  await page.getByRole("button", { name: "README.md", exact: true }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
}

async function replaceText(page: Page, content: string) {
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(content);
}

async function diskChange(
  page: Page,
  content: string,
  revision: string,
  readOnly = false,
) {
  await page.evaluate(
    ({ content, revision, readOnly }) => {
      const native = (window as any).__nativeTest;
      native.editorFiles["/project/README.md"] = {
        content,
        revision,
        readOnly,
        encoding: "utf8",
      };
      void native.emitEvent("editor-files-changed", ["/project/README.md"]);
    },
    { content, revision, readOnly },
  );
}

test("file tabs keep their buffers and history while native terminals keep streaming", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockDesktop(page);
  await page.goto("/");
  await expect(page.locator(".xterm-screen")).toBeVisible();
  const paneId = await page
    .locator("[data-pane-id]")
    .getAttribute("data-pane-id");
  expect(
    await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .some((entry) => entry.name.includes("codemirror")),
    ),
  ).toBe(false);
  await openReadme(page);
  await openReadme(page);
  const fileInfo = page
    .getByRole("contentinfo")
    .getByRole("group", { name: "File information" });
  await expect(page.getByRole("tab")).toHaveCount(2);
  await replaceText(page, "# Edited\nZażółć 🦀\n");
  await expect(page.getByRole("tab", { name: /README.md/ })).toContainText("●");
  await page.getByRole("tab", { name: "Terminal", exact: true }).click();
  await expect(fileInfo).toHaveCount(0);
  await page.evaluate(() => {
    const native = (window as any).__nativeTest;
    native.emit([...native.sessions.keys()][0], "\r\nEDITOR BACKGROUND 🦀\r\n");
  });
  await expect
    .poll(() => buffer(page, paneId!))
    .toContain("EDITOR BACKGROUND 🦀");
  await page.evaluate(() => {
    (window as any).__editorLoadingFlashes = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (
            node instanceof Element &&
            (node.matches(".editor-loading") ||
              node.querySelector(".editor-loading"))
          )
            (window as any).__editorLoadingFlashes++;
    });
    observer.observe(document.querySelector(".terminal-stage")!, {
      childList: true,
      subtree: true,
    });
  });
  await page.getByRole("tab", { name: /README.md/ }).click();
  await expect(page.locator(".cm-content")).toContainText("Zażółć 🦀");
  expect(
    await page.evaluate(() => (window as any).__editorLoadingFlashes),
  ).toBe(0);
  await expect(fileInfo).toContainText("Modified");
  await page.keyboard.press("Control+z");
  await expect(page.locator(".cm-content")).toContainText(
    "A text file preview.",
  );
  await expect(page.getByRole("tab", { name: /README.md/ })).not.toContainText(
    "●",
  );
  await page.keyboard.press("Control+Shift+z");
  await page.keyboard.press("Control+s");
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__nativeTest.editorFiles["/project/README.md"]
            .content,
      ),
    )
    .toBe("# Edited\nZażółć 🦀\n");
  expect(
    await page.evaluate(
      () =>
        (window as any).__nativeTest.calls.filter(
          (call: any) => call.command === "start_terminal",
        ).length,
    ),
  ).toBe(1);
  expect(
    await page.evaluate(() =>
      (window as any).__nativeTest.calls.some(
        (call: any) => call.command === "close_terminal",
      ),
    ),
  ).toBe(false);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("test-session")))
    .toContain('"type":"file"');
  expect(
    await page.evaluate(() => localStorage.getItem("test-session")),
  ).not.toContain("Zażółć");
  expect(errors).toEqual([]);
});

test("typing during a save stays dirty and a queued save writes the latest buffer", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto("/");
  await openReadme(page);
  await page.evaluate(() => {
    (window as any).__nativeTest.fileSaveDelay = 400;
  });
  await replaceText(page, "first");
  await page.keyboard.press("Control+s");
  await expect(
    page.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeVisible();
  await page.keyboard.insertText(" second");
  await page.keyboard.press("Control+s");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__nativeTest.editorFiles["/project/README.md"]
            .content,
      ),
    )
    .toBe("first second");
  await expect(page.getByRole("tab", { name: /README.md/ })).not.toContainText(
    "●",
  );
  const saved = await page.evaluate(() =>
    (window as any).__nativeTest.calls
      .filter((call: any) => call.command === "save_editor_file")
      .map((call: any) => call.args.request.content),
  );
  expect(saved).toEqual(["first", "first second"]);
});

test("closing a modified tab supports cancel, failed save, retry and discard", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto("/");
  await openReadme(page);
  await replaceText(page, "unsaved 🦀");
  await page.keyboard.press("Control+w");
  const dialog = page.getByRole("dialog", {
    name: "Save changes before closing?",
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".cm-content")).toHaveText("unsaved 🦀");
  await page.evaluate(() => {
    (window as any).__nativeTest.failFileSave = true;
  });
  await page
    .getByRole("button", { name: "Close README.md", exact: true })
    .click();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("alert")).toHaveText("Disk is full");
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.evaluate(() => {
    (window as any).__nativeTest.failFileSave = false;
  });
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(1);
  await openReadme(page);
  await expect(page.locator(".cm-content")).toHaveText("unsaved 🦀");
  await replaceText(page, "discard me");
  await page.keyboard.press("Control+Shift+w");
  await dialog
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await openReadme(page);
  await expect(page.locator(".cm-content")).toHaveText("unsaved 🦀");
});

test("Close Clean keeps dirty buffers and undo history while closing terminals and saved files", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto("/");
  await expect(page.locator(".xterm-screen")).toBeVisible();
  await openReadme(page);
  await replaceText(page, "keep my edits");
  await page
    .getByRole("button", { name: "it's a file.txt", exact: true })
    .click();
  await expect(page.locator(".cm-content")).toContainText("Hello, 🦀!");
  await page.getByRole("tab", { name: /README.md/ }).click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Close Clean", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.getByRole("tab", { selected: true })).toContainText(
    "README.md",
  );
  await expect(page.locator(".cm-content")).toHaveText("keep my edits");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__nativeTest.calls
          .filter((call: any) => call.command === "close_terminal")
          .map((call: any) => call.args.id),
      ),
    )
    .toEqual(
      await page.evaluate(() => [
        ...(window as any).__nativeTest.sessions.keys(),
      ]),
    );
  await page.getByRole("tab").click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Close Clean", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".cm-content")).toContainText(
    "A text file preview.",
  );
  expect(
    await page.evaluate(() =>
      (window as any).__nativeTest.calls.some(
        (call: any) => call.command === "save_editor_file",
      ),
    ),
  ).toBe(false);
});

for (const resolution of ["Save changes", "Discard changes"]) {
  test(`Close All protects every dirty file and supports ${resolution}`, async ({
    page,
  }) => {
    await mockDesktop(page);
    await page.goto("/");
    await expect(page.locator(".xterm-screen")).toBeVisible();
    await openReadme(page);
    await replaceText(page, "first unsaved file");
    await page
      .getByRole("button", { name: "it's a file.txt", exact: true })
      .click();
    await expect(page.locator(".cm-content")).toContainText("Hello, 🦀!");
    await replaceText(page, "second unsaved file");
    const closeAll = async () => {
      await page
        .getByRole("tab", { name: "Terminal", exact: true })
        .click({ button: "right" });
      await page
        .getByRole("menuitem", { name: "Close All", exact: true })
        .click();
    };
    await closeAll();
    const dialog = page.getByRole("dialog", {
      name: "Save changes before closing?",
    });
    await expect(dialog.getByRole("listitem")).toContainText([
      "/project/README.md",
      "/project/it's a file.txt",
    ]);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("tab")).toHaveCount(3);
    await expect(page.locator(".cm-content")).toHaveText("second unsaved file");
    expect(
      await page.evaluate(() =>
        (window as any).__nativeTest.calls.some(
          (call: any) => call.command === "close_terminal",
        ),
      ),
    ).toBe(false);
    await closeAll();
    if (resolution === "Save changes") {
      await page.evaluate(() => {
        (window as any).__nativeTest.failFileSave = true;
      });
      await dialog
        .getByRole("button", { name: resolution, exact: true })
        .click();
      await expect(dialog.getByRole("alert")).toHaveText("Disk is full");
      await expect(page.getByRole("tab")).toHaveCount(3);
      expect(
        await page.evaluate(() =>
          (window as any).__nativeTest.calls.some(
            (call: any) => call.command === "close_terminal",
          ),
        ),
      ).toBe(false);
      await page.evaluate(() => {
        (window as any).__nativeTest.failFileSave = false;
      });
    }
    await dialog.getByRole("button", { name: resolution, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("tab")).toHaveCount(1);
    await expect(page.locator(".xterm-screen")).toBeVisible();
    await openReadme(page);
    await expect(page.locator(".cm-content")).toContainText(
      resolution === "Save changes"
        ? "first unsaved file"
        : "A text file preview.",
    );
    await page
      .getByRole("button", { name: "it's a file.txt", exact: true })
      .click();
    await expect(page.locator(".cm-content")).toContainText(
      resolution === "Save changes" ? "second unsaved file" : "Hello, 🦀!",
    );
  });
}

test("closing the native window checks modified files in inactive tabs", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto("/");
  await openReadme(page);
  await replaceText(page, "save on exit");
  await page.getByRole("tab", { name: "Terminal", exact: true }).click();
  await page.getByRole("button", { name: "Close window", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Save changes before closing?",
  });
  await expect(dialog).toContainText("/project/README.md");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    await page.evaluate(() =>
      (window as any).__nativeTest.calls.some(
        (call: any) => call.command === "plugin:window|destroy",
      ),
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Close window", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__nativeTest.calls.some(
          (call: any) => call.command === "plugin:window|destroy",
        ),
      ),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () =>
        (window as any).__nativeTest.editorFiles["/project/README.md"].content,
    ),
  ).toBe("save on exit");
});

test("external changes reload clean files and require a choice for modified files", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto("/");
  await openReadme(page);
  await diskChange(page, "external clean\n", "external-1");
  await expect(page.locator(".cm-content")).toContainText("external clean");
  await replaceText(page, "my edits");
  await diskChange(page, "external conflict", "external-2");
  await expect(page.getByRole("alert")).toContainText(
    "Your edits are preserved",
  );
  await expect(page.locator(".cm-content")).toHaveText("my edits");
  await page
    .getByRole("button", { name: "Overwrite disk version…", exact: true })
    .click();
  const overwrite = page.getByRole("dialog", {
    name: "Overwrite disk version?",
  });
  await overwrite.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as any).__nativeTest.editorFiles["/project/README.md"].content,
    ),
  ).toBe("external conflict");
  await page
    .getByRole("button", { name: "Overwrite disk version…", exact: true })
    .click();
  await overwrite
    .getByRole("button", { name: "Overwrite file", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as any).__nativeTest.editorFiles["/project/README.md"].content,
    ),
  ).toBe("my edits");
  await replaceText(page, "another edit");
  await diskChange(page, "reload this", "external-3");
  await page
    .getByRole("button", { name: "Reload from disk…", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Reload file", exact: true })
    .click();
  await expect(page.locator(".cm-content")).toHaveText("reload this");
  await page.locator(".cm-content").press("Control+z");
  await expect(page.locator(".cm-content")).toHaveText("reload this");
  await diskChange(page, "read only", "external-4", true);
  await expect(page.getByText("Read-only", { exact: true })).toBeVisible();
  await expect(page.locator(".cm-content")).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await diskChange(page, "writable again", "external-5");
  await expect(page.locator(".cm-content")).toHaveAttribute(
    "contenteditable",
    "true",
  );
});

test("missing files and failed reads retain edits and allow recovery", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto("/");
  await page.evaluate(() => {
    (window as any).__nativeTest.fileReadError = "Unsupported binary file";
  });
  await page.getByRole("button", { name: "README.md", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Unsupported binary file",
  );
  await page.evaluate(() => {
    (window as any).__nativeTest.fileReadError = "";
  });
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await replaceText(page, "retained edits");
  await page.evaluate(() => {
    const native = (window as any).__nativeTest;
    native.fileReadError = "The file no longer exists";
    void native.emitEvent("editor-files-changed", ["/project/README.md"]);
  });
  await expect(page.getByRole("alert")).toContainText(
    "The file no longer exists",
  );
  await expect(page.locator(".cm-content")).toHaveText("retained edits");
  await page.evaluate(() => {
    (window as any).__nativeTest.fileReadError = "";
    window.dispatchEvent(new Event("focus"));
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".cm-content")).toHaveText("retained edits");
});

test("workspaces share a file buffer and protect it when its last tab closes", async ({
  page,
}) => {
  const project = newProject("/project", "local:bash");
  const first = project.workspaces[0];
  const second = newWorkspace("/project", "local:bash", "Review");
  project.workspaces.push(second);
  let session = {
    ...newSession(),
    projects: [project],
    activeProjectId: project.id,
  };
  session = openFileTab(session, first.id, "/project", "README.md");
  session = openFileTab(session, second.id, "/project", "README.md");
  await mockDesktop(page, true, session);
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  await replaceText(page, "shared buffer");
  await page
    .getByRole("button", { name: "Toggle workspaces", exact: true })
    .click();
  const list = page.getByRole("navigation", { name: "Workspace list" });
  await list.getByRole("button", { name: /^Review / }).click();
  await expect(page.locator(".cm-content")).toHaveText("shared buffer");
  await page.keyboard.press("Control+w");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(1);
  const original = list.getByRole("button", {
    name: new RegExp(`^${first.name} `),
  });
  await original.click();
  await expect(page.locator(".cm-content")).toHaveText("shared buffer");
  await original.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Delete workspace…", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Save changes before closing?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".cm-content")).toHaveText("shared buffer");
});

test("restored large files use a virtualized editor and inactive file tabs load on demand", async ({
  page,
}) => {
  const project = newProject("/project", "local:bash");
  let session = {
    ...newSession(),
    projects: [project],
    activeProjectId: project.id,
  };
  const workspace = project.workspaces[0];
  session = openFileTab(session, workspace.id, "/project", "untouched.py");
  session = openFileTab(session, workspace.id, "/project", "main.rs");
  const text = Array.from(
    { length: 30000 },
    (_, index) => `// line ${index} ${"x".repeat(40)}\n`,
  ).join("");
  await mockDesktop(page, true, session, undefined, {
    "/project/main.rs": {
      content: text,
      revision: "large",
      encoding: "utf8",
      readOnly: false,
    },
  });
  await page.goto("/");
  await expect(
    page.getByText("Large file mode", { exact: true }),
  ).toBeVisible();
  expect(await page.locator(".cm-line").count()).toBeLessThan(200);
  expect(
    await page.evaluate(() =>
      (window as any).__nativeTest.calls.some(
        (call: any) =>
          call.command === "read_editor_file" &&
          call.args.relative === "untouched.py",
      ),
    ),
  ).toBe(false);
  await page.setViewportSize({ width: 800, height: 420 });
  await page.screenshot({ path: "test-results/editor-large-minimum.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("find, replace, line navigation and word wrap work with configurable shortcuts", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto("/");
  await openReadme(page);
  await replaceText(page, "first line\nsecond line\nthird line\n");
  await page.keyboard.press("Control+f");
  await expect(page.locator(".cm-search")).toBeVisible();
  await page.locator('.cm-search input[name="search"]').fill("second");
  await page.locator('.cm-search input[name="replace"]').fill("changed");
  await page.locator('.cm-search button[name="replaceAll"]').click();
  await expect(page.locator(".cm-content")).toContainText("changed line");
  await page.locator('.cm-search input[name="search"]').press("Escape");
  const fileInfo = page
    .getByRole("contentinfo")
    .getByRole("group", { name: "File information" });
  await fileInfo.getByText(/^Ln \d+, Col \d+$/).click();
  await expect(page.getByRole("textbox", { name: "Go to line:" })).toHaveCount(
    0,
  );
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+g");
  await page.getByRole("textbox", { name: "Go to line:" }).fill("3");
  await page.getByRole("textbox", { name: "Go to line:" }).press("Enter");
  await expect(
    fileInfo.getByText("Ln 3, Col 1", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Alt+z");
  await expect(page.locator(".cm-content")).toHaveClass(/cm-lineWrapping/);
  const wrap = fileInfo.getByRole("button", {
    name: "Toggle word wrap (Alt+Z)",
  });
  await expect(wrap).toHaveAttribute("aria-pressed", "true");
  await wrap.click();
  await expect(page.locator(".cm-content")).not.toHaveClass(/cm-lineWrapping/);
  await page.setViewportSize({ width: 800, height: 420 });
  await page.screenshot({ path: "test-results/editor-minimum.png" });
});

test("Rust editing preserves per-tab positions across switches and session restoration", async ({
  page,
}) => {
  const project = newProject("/project", "local:bash");
  const session = openFileTab(
    { ...newSession(), projects: [project], activeProjectId: project.id },
    project.workspaces[0].id,
    "/project",
    "main.rs",
  );
  const content = `fn main() {\n${"    let value = 1;\n".repeat(600)}}\n`;
  const expectedHead =
    content
      .split("\n")
      .slice(0, 249)
      .reduce((offset, line) => offset + line.length + 1, 0) + 1;
  await mockDesktop(page, true, session, undefined, {
    "/project/main.rs": {
      content,
      revision: "rust",
      encoding: "utf8",
      readOnly: false,
    },
  });
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(page.locator(".editor-status")).toContainText("Rust");
  await page.keyboard.press("Control+g");
  await page.getByRole("textbox", { name: "Go to line:" }).fill("250");
  await page.getByRole("textbox", { name: "Go to line:" }).press("Enter");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("Ln 250, Col 2", { exact: true })).toBeVisible();
  await expect
    .poll(() => page.locator(".cm-line span[class]").count())
    .toBeGreaterThan(0);
  const scroll = await page
    .locator(".cm-scroller")
    .evaluate((element) => element.scrollTop);
  await page.getByRole("tab", { name: "Terminal", exact: true }).click();
  await page.getByRole("tab", { name: "main.rs", exact: true }).click();
  await expect(page.getByText("Ln 250, Col 2", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.locator(".cm-scroller").evaluate((element) => element.scrollTop),
    )
    .toBe(scroll);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("test-session") ?? "{}",
          ).projects?.[0].workspaces[0].tabs.find(
            (tab: any) => tab.type === "file",
          )?.position?.head,
      ),
    )
    .toBe(expectedHead);
  await page.reload();
  await expect(page.getByText("Ln 250, Col 2", { exact: true })).toBeVisible();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("// inserted 🦀");
  await page.keyboard.press("Control+s");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__nativeTest.editorFiles["/project/main.rs"].content,
      ),
    )
    .toContain("\n    // inserted 🦀\n");
  await page.screenshot({ path: "test-results/editor-rust.png" });
});

test("slow reads cannot steal focus or reopen a tab that was closed while loading", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockDesktop(page);
  await page.goto("/");
  await expect(page.locator(".xterm-screen")).toBeVisible();
  await page.evaluate(() => {
    (window as any).__nativeTest.fileReadDelays["README.md"] = 500;
  });
  await page.getByRole("button", { name: "README.md", exact: true }).click();
  await page
    .getByRole("button", { name: "it's a file.txt", exact: true })
    .click();
  await expect(page.locator(".cm-content")).toContainText("Hello, 🦀!");
  await page
    .getByRole("button", { name: "Close README.md", exact: true })
    .click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__nativeTest.calls
          .filter((call: any) => call.command === "watch_editor_files")
          .at(-1)
          ?.args.files.map((file: any) => file.relative),
      ),
    )
    .toEqual(["it's a file.txt"]);
  await expect(page.getByRole("tab", { selected: true })).toHaveText(
    "it's a file.txt",
  );
  expect(errors).toEqual([]);
});
