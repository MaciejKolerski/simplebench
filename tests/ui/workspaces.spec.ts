import { expect, test } from "@playwright/test";
import { addWorkspace, newSession } from "../../src/model";
import { buffer, mockDesktop } from "./desktop";

test("the global list switches folders and independent workspaces without restarting terminals", async ({
  page,
}, testInfo) => {
  let session = newSession();
  for (const [path, name] of [
    ["/work/simplevoice", "Voice 1"],
    ["/work/simplevoice", "Voice 2"],
    ["/work/simplebench", "Bench"],
  ]) {
    session = addWorkspace(session, path, "local:bash", name);
  }
  await mockDesktop(page, true, session);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator(".xterm-screen")).toBeVisible();
  await page
    .getByRole("button", { name: "Toggle workspaces", exact: true })
    .click();
  const panel = page.getByRole("complementary", {
    name: "Workspaces",
    exact: true,
  });
  const list = panel.getByRole("navigation", { name: "Workspace list" });
  await expect(list.getByRole("button")).toHaveCount(3);
  const paneIds: string[] = [];
  for (const name of ["Voice 1", "Voice 2", "Bench"]) {
    const row = list.getByRole("button", { name: new RegExp(`^${name} `) });
    await row.click();
    await expect(row).toHaveAttribute("aria-current", "true");
    await expect(page.locator(".xterm-screen")).toBeVisible();
    await expect(page.locator(".workspace-switcher")).toHaveText(name);
    await expect(page.locator(".project-switcher")).toHaveText(
      name === "Bench" ? "simplebench" : "simplevoice",
    );
    paneIds.push(
      (await page.locator("[data-pane-id]").getAttribute("data-pane-id"))!,
    );
  }
  expect(new Set(paneIds).size).toBe(3);
  await page.evaluate(() => {
    const native = (window as any).__nativeTest;
    const started = native.calls.find(
      (call: any) =>
        call.command === "start_terminal" &&
        call.args.request.cwd === "/work/simplevoice",
    );
    native.emit(started.args.request.id, "\r\nVOICE AGENT STILL RUNNING\r\n");
  });
  await expect
    .poll(() => buffer(page, paneIds[0]))
    .toContain("VOICE AGENT STILL RUNNING");
  await list.getByRole("button", { name: /^Voice 1 / }).click();
  await expect(page.locator("[data-pane-id]")).toHaveAttribute(
    "data-pane-id",
    paneIds[0],
  );
  expect(
    await page.evaluate(
      () =>
        (window as any).__nativeTest.calls.filter(
          (call: any) => call.command === "start_terminal",
        ).length,
    ),
  ).toBe(3);
  expect(
    await page.evaluate(
      () =>
        (window as any).__nativeTest.calls.filter(
          (call: any) => call.command === "close_terminal",
        ).length,
    ),
  ).toBe(0);

  await page
    .getByRole("button", { name: "Toggle workspaces", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitemradio", { name: "Panel on the right" }).click();
  await page.getByRole("button", { name: /^Toggle file explorer/ }).click();
  await expect(panel).toHaveAttribute("data-side", "right");
  await expect(
    page.getByRole("complementary", { name: "Explorer", exact: true }),
  ).toBeVisible();
  await page.getByRole("separator", { name: "Resize right sidebar" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("test-session") ?? "null")
            ?.rightSidebarWidth,
      ),
    )
    .toBeGreaterThan(250);
  await page.screenshot({ path: testInfo.outputPath("workspaces-dark.png") });
  await page.setViewportSize({ width: 800, height: 420 });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(list.getByRole("button").first()).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("workspaces-light-minimum.png"),
  });
  await page.reload();
  await expect(panel).toHaveAttribute("data-side", "right");
  await expect(list.getByRole("button", { name: /^Voice 1 / })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page.locator(".xterm-screen")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as any).__nativeTest.calls.filter(
          (call: any) => call.command === "start_terminal",
        ).length,
    ),
  ).toBe(1);
});

test("adding a workspace chooses a folder every time, including the same folder, and cancellation preserves the session", async ({
  page,
}) => {
  await mockDesktop(page, false, null);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Toggle workspaces", exact: true })
    .click();
  const panel = page.getByRole("complementary", {
    name: "Workspaces",
    exact: true,
  });
  const create = panel.getByRole("button", {
    name: "New workspace",
    exact: true,
  });
  await create.click();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Agent 1");
  await page.getByRole("textbox", { name: "Name", exact: true }).press("Enter");
  await expect(page.locator(".xterm-screen")).toBeVisible();
  await create.click();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Agent 2");
  await page.getByRole("textbox", { name: "Name", exact: true }).press("Enter");
  await expect(page.locator(".workspace-switcher")).toHaveText("Agent 2");
  await expect(panel.getByRole("navigation").getByRole("button")).toHaveCount(
    2,
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("test-session") ?? "null")
            ?.projects[0]?.workspaces.length,
      ),
    )
    .toBe(2);
  await page.evaluate(() => {
    (window as any).__nativeTest.folder = "/work/simplebench";
  });
  await create.click();
  await page.getByRole("textbox", { name: "Name", exact: true }).press("Enter");
  await expect(page.locator(".project-switcher")).toHaveText("simplebench");
  await expect(panel.getByRole("navigation").getByRole("button")).toHaveCount(
    3,
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("test-session") ?? "null")?.projects
            .length,
      ),
    )
    .toBe(2);
  const before = await page.evaluate(() =>
    localStorage.getItem("test-session"),
  );
  await create.click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate(() => {
    (window as any).__nativeTest.folder = null;
  });
  await create.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("test-session"))).toBe(
    before,
  );
  await page.evaluate(() => {
    (window as any).__nativeTest.directoryError = "Folder not found";
  });
  await panel.getByRole("button", { name: /^Agent 1 / }).click();
  await expect(page.getByRole("alert")).toContainText("Folder not found");
  await expect(page.locator(".workspace-switcher")).toHaveText("simplebench");
});

test("a configured workspace shortcut works before folder selection and is captured before terminal input", async ({
  page,
}) => {
  await mockDesktop(page, false, null);
  await page.addInitScript(() =>
    localStorage.setItem(
      "test-keybindings",
      JSON.stringify({
        version: 1,
        bindings: { toggleWorkspaces: "Ctrl+Shift+KeyB" },
      }),
    ),
  );
  await page.goto("/");
  await expect(page.locator(".statusbar")).toBeVisible();
  await page.keyboard.press("Control+Shift+b");
  const panel = page.getByRole("complementary", {
    name: "Workspaces",
    exact: true,
  });
  await expect(panel).toBeVisible();
  await panel
    .getByRole("button", { name: "New workspace", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Name", exact: true }).press("Enter");
  await expect(page.locator(".xterm-screen")).toBeVisible();
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.press("Control+Shift+b");
  await expect(panel).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as any).__nativeTest.calls.filter(
          (call: any) => call.command === "write_terminal",
        ).length,
    ),
  ).toBe(0);
});
