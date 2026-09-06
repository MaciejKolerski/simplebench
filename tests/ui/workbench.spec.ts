import { test, expect } from "@playwright/test";
import { mockDesktop, buffer } from "./desktop";

test("tabs keep streaming in the background without starting duplicate PTYs", async ({
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
  await page
    .getByRole("button", { name: "New tab (Ctrl+Shift+T)", exact: true })
    .click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__nativeTest.calls.filter(
            (call: any) => call.command === "start_terminal",
          ).length,
      ),
    )
    .toBe(2);
  await page.evaluate(() => {
    const native = (window as any).__nativeTest;
    native.emit(
      [...native.sessions.keys()][0],
      "\r\nBACKGROUND STREAM — zażółć 🦀\r\n",
    );
  });
  await expect
    .poll(() => buffer(page, paneId!))
    .toContain("BACKGROUND STREAM — zażółć 🦀");
  await page.getByRole("tab", { name: "Terminal", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__nativeTest.calls.filter(
            (call: any) => call.command === "start_terminal",
          ).length,
      ),
    )
    .toBe(2);
  await expect(page.locator(".notice")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("nested splits, workspace names and active tabs survive a reload", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Split terminal side by side", exact: true })
    .click();
  await page
    .locator(".terminal-pane.is-active")
    .getByRole("button", { name: "Split terminal top and bottom", exact: true })
    .click();
  await expect(page.locator("[data-pane-id]")).toHaveCount(3);
  const firstPane = page.locator("[data-pane-id]").first();
  await firstPane.locator(".xterm-helper-textarea").focus();
  await expect(firstPane).toHaveClass(/is-active/);
  await page.keyboard.press("Control+Shift+F");
  await expect(
    firstPane.getByRole("textbox", { name: "Search terminal output" }),
  ).toBeVisible();
  await firstPane
    .getByRole("button", { name: "Close search", exact: true })
    .click();
  const separator = page.getByRole("separator", {
    name: "Resize terminal columns",
  });
  await separator.focus();
  await page.keyboard.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", "55");
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await page
    .getByRole("button", { name: "Rename workspace", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Backend");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("test-session")))
    .toContain("Backend");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Switch workspace" }),
  ).toContainText("Backend");
  await expect(page.locator("[data-pane-id]")).toHaveCount(3);
  await expect(
    page.getByRole("separator", { name: "Resize terminal columns" }),
  ).toHaveAttribute("aria-valuenow", "55");
  await page
    .locator(".terminal-pane.is-active")
    .getByRole("button", { name: "Close terminal", exact: true })
    .click();
  await expect(page.locator("[data-pane-id]")).toHaveCount(2);
});

test("source control appears when Git is detected and preserves the commit draft while staging", async ({
  page,
}) => {
  await mockDesktop(page, false);
  await page.goto("/");
  await expect(page.locator(".xterm-screen")).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Toggle source control (Ctrl+Shift+G)",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).__nativeTest.setRepository(true);
    window.dispatchEvent(new Event("focus"));
  });
  await page
    .getByRole("button", {
      name: "Toggle source control (Ctrl+Shift+G)",
      exact: true,
    })
    .click();
  const message =
    "docs(readme): describe the project\n\nExplain the workspace.\n\nValidation:\n- Documentation reviewed";
  await page.getByRole("textbox", { name: "Commit message" }).fill(message);
  await page
    .getByRole("button", { name: "Stage README.md", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Commit message" }),
  ).toHaveValue(message);
  await page
    .getByRole("button", { name: "Commit staged changes", exact: true })
    .click();
  await expect(page.getByText("Working tree clean.")).toBeVisible();
  const sent = await page.evaluate(
    () =>
      (window as any).__nativeTest.calls.find(
        (call: any) => call.command === "git_commit",
      ).args.message,
  );
  expect(sent).toBe(message);
});

test("project selection, file preview and dragging paths reach the native commands", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto("/");
  await page.getByRole("button", { name: "project", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Project location" })
    .fill("/another project");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator(".project-switcher")).toContainText(
    "another project",
  );
  await page.getByRole("button", { name: "README.md", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("A text file preview.");
  await page.getByRole("button", { name: "Close dialog" }).click();
  const file = await page
    .getByRole("button", { name: "it's a file.txt", exact: true })
    .boundingBox();
  const terminal = await page.locator(".terminal-mount").boundingBox();
  await page.mouse.move(file!.x + 40, file!.y + 12);
  await page.mouse.down();
  await page.mouse.move(terminal!.x + terminal!.width / 2, terminal!.y + 100, {
    steps: 8,
  });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__nativeTest.calls.filter(
            (call: any) => call.command === "quote_paths",
          ).length,
      ),
    )
    .toBe(1);
  const calls = await page.evaluate(() =>
    (window as any).__nativeTest.calls.filter(
      (call: any) => call.command === "write_terminal",
    ),
  );
  expect(calls.map((call: any) => call.args.data).join("")).toContain("'\\''");
  expect(calls.map((call: any) => call.args.data).join("")).not.toContain("\r");
});

test("command input, search and shortcuts remain functional at minimum window size", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 420 });
  await mockDesktop(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Command input", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Command input", exact: true })
    .fill("echo hello\nprintf world");
  await page
    .getByRole("textbox", { name: "Command input", exact: true })
    .press("Control+Enter");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__nativeTest.calls
          .filter((call: any) => call.command === "write_terminal")
          .map((call: any) => call.args.data)
          .join(""),
      ),
    )
    .toContain("echo hello");
  await page
    .getByRole("button", {
      name: "Find in terminal (Ctrl+Shift+F)",
      exact: true,
    })
    .click();
  await page
    .getByRole("textbox", { name: "Search terminal output" })
    .fill("bash");
  await page
    .getByRole("textbox", { name: "Search terminal output" })
    .press("Escape");
  await page.keyboard.press("Control+Shift+T");
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Settings (Ctrl+,)", exact: true })
    .click();
  expect(
    await page.evaluate(() =>
      (window as any).__nativeTest.calls.some(
        (call: any) => call.command === "open_settings",
      ),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/workbench-minimum.png" });
});

test("settings only loads a placeholder and never starts terminal sessions", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto("/?window=settings");
  await expect(page.locator(".settings-box")).toHaveText("settings");
  expect(
    await page.evaluate(() =>
      (window as any).__nativeTest.calls.some((call: any) =>
        ["app_info", "start_terminal"].includes(call.command),
      ),
    ),
  ).toBe(false);
});

test("an unsupported saved session is preserved until recovery is chosen", async ({
  page,
}) => {
  await page.clock.install();
  await mockDesktop(page);
  const future = JSON.stringify({
    version: 99,
    projects: [{ futureData: "preserve me" }],
  });
  await page.addInitScript(
    (saved) => localStorage.setItem("test-session", saved),
    future,
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("unsupported format");
  await page
    .getByRole("button", { name: "New tab (Ctrl+Shift+T)", exact: true })
    .click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.clock.fastForward(1000);
  expect(await page.evaluate(() => localStorage.getItem("test-session"))).toBe(
    future,
  );
  expect(
    await page.evaluate(
      () =>
        (window as any).__nativeTest.calls.filter(
          (call: any) => call.command === "save_session",
        ).length,
    ),
  ).toBe(0);
  await page
    .getByRole("button", { name: "Save current layout instead", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.clock.fastForward(1000);
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("test-session")!).version,
      ),
    )
    .toBe(1);
});

test("closing flushes the latest layout and a failed save keeps the window open", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "New tab (Ctrl+Shift+T)", exact: true })
    .click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.evaluate(() => {
    (window as any).__nativeTest.failSave = true;
  });
  await page.getByRole("button", { name: "Close window", exact: true }).click();
  // A pending autosave can report the same storage error after the close flush.
  await expect(page.getByRole("alert")).toContainText(
    /Could not (close the window|save the session): Disk is full/,
  );
  expect(
    await page.evaluate(() =>
      (window as any).__nativeTest.calls.some(
        (call: any) => call.command === "plugin:window|destroy",
      ),
    ),
  ).toBe(false);
  await page.evaluate(() => {
    (window as any).__nativeTest.failSave = false;
  });
  await page.getByRole("button", { name: "Close window", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__nativeTest.calls.some(
          (call: any) => call.command === "plugin:window|destroy",
        ),
      ),
    )
    .toBe(true);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("test-session")!),
  );
  expect(saved.projects[0].workspaces[0].tabs).toHaveLength(2);
});
