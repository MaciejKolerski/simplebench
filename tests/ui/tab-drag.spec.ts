import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { mockDesktop, buffer } from "./desktop";
import { newProject, newSession, newTab } from "../../src/model";

test.use({ colorScheme: "dark" });

async function setup(page: Page, count = 3) {
  const project = newProject("/project", "local:bash");
  const workspace = project.workspaces[0];
  workspace.tabs = Array.from({ length: count }, (_, index) =>
    newTab("/project", "local:bash", `Terminal ${index + 1}`),
  );
  workspace.activeTabId = workspace.tabs[0].id;
  await mockDesktop(page, false, {
    ...newSession(),
    projects: [project],
    activeProjectId: project.id,
  });
  await page.goto("/");
  await expect(page.locator(".xterm-screen")).toBeVisible();
  return workspace;
}

async function grab(page: Page, source: Locator) {
  const bounds = (await source.boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
}

async function savedTabs(page: Page) {
  return page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("test-session") ?? "null")?.projects[0]
        .workspaces[0].tabs,
  );
}

test("reorders inactive tabs in both directions, preserves selection and restores the order", async ({
  page,
}) => {
  await setup(page);
  const first = page.getByRole("tab", { name: "Terminal 1", exact: true });
  const third = page.getByRole("tab", { name: "Terminal 3", exact: true });
  const bounds = (await first.boundingBox())!;
  await grab(page, third);
  await page.mouse.move(bounds.x + 1, bounds.y + bounds.height / 2, {
    steps: 8,
  });
  await expect(first).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".tab-drop-marker")).toBeVisible();
  await page.mouse.up();
  await expect(page.getByRole("tab")).toHaveText([
    "Terminal 3",
    "Terminal 1",
    "Terminal 2",
  ]);
  const strip = (await page.locator(".tab-strip").boundingBox())!;
  await grab(page, third);
  await page.mouse.move(strip.x + strip.width - 5, strip.y + strip.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(page.getByRole("tab")).toHaveText([
    "Terminal 1",
    "Terminal 2",
    "Terminal 3",
  ]);
  await expect(first).toHaveAttribute("aria-selected", "true");
  await expect
    .poll(async () => (await savedTabs(page))?.map((tab: any) => tab.title))
    .toEqual(["Terminal 1", "Terminal 2", "Terminal 3"]);
  await page.reload();
  await expect(page.getByRole("tab")).toHaveText([
    "Terminal 1",
    "Terminal 2",
    "Terminal 3",
  ]);
  await expect
    .poll(() => page.evaluate(() => (window as any).__nativeTest.sessions.size))
    .toBe(1);
});

for (const side of ["left", "right", "top", "bottom"] as const) {
  test(`dropping an inactive terminal on the ${side} merges live sessions and preserves output`, async ({
    page,
  }) => {
    const workspace = await setup(page, 2);
    const target = workspace.tabs[0];
    const source = workspace.tabs[1];
    if (source.type !== "terminal" || target.type !== "terminal")
      throw new Error("Expected terminals");
    await page.getByRole("tab", { name: "Terminal 2", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__nativeTest.sessions.size),
      )
      .toBe(2);
    await page.evaluate(() => {
      const native = (window as any).__nativeTest;
      native.emit(
        [...native.sessions.keys()][1],
        "\r\nSOURCE OUTPUT — zażółć 🦀\r\n",
      );
    });
    await page.getByRole("tab", { name: "Terminal 1", exact: true }).click();
    await page
      .locator(`[data-pane-id="${target.activePaneId}"]`)
      .evaluate((element) => {
        (window as any).__targetHost = element;
      });
    const area = (await page.locator(".terminal-layout").boundingBox())!;
    const x =
      area.x +
      area.width * (side === "left" ? 0.15 : side === "right" ? 0.85 : 0.5);
    const y =
      area.y +
      area.height * (side === "top" ? 0.15 : side === "bottom" ? 0.85 : 0.5);
    await grab(
      page,
      page.getByRole("tab", { name: "Terminal 2", exact: true }),
    );
    await page.mouse.move(x, y, { steps: 10 });
    await expect(page.getByRole("tab", { selected: true })).toHaveText(
      "Terminal 1",
    );
    await expect(page.locator(".tab-merge-preview")).toHaveAttribute(
      "data-side",
      side,
    );
    const preview = (await page.locator(".tab-merge-preview").boundingBox())!;
    expect(preview.width).toBeCloseTo(
      side === "left" || side === "right" ? (area.width - 3) / 2 : area.width,
      0,
    );
    expect(preview.height).toBeCloseTo(
      side === "top" || side === "bottom" ? (area.height - 3) / 2 : area.height,
      0,
    );
    if (side === "right")
      await page.screenshot({ path: "test-results/tab-merge-preview.png" });
    await page.mouse.up();
    await expect(page.getByRole("tab")).toHaveText(["Terminal 1"]);
    await expect(page.locator(".xterm-screen")).toHaveCount(2);
    await expect(
      page.locator(`[data-pane-id="${source.activePaneId}"]`),
    ).toHaveClass(/is-active/);
    expect(
      await page
        .locator(`[data-pane-id="${target.activePaneId}"]`)
        .evaluate((element) => element === (window as any).__targetHost),
    ).toBe(true);
    await expect
      .poll(() => buffer(page, source.activePaneId))
      .toContain("SOURCE OUTPUT — zażółć 🦀");
    await page.evaluate(() => {
      const native = (window as any).__nativeTest;
      native.emit([...native.sessions.keys()][1], "\r\nSTILL STREAMING\r\n");
    });
    await expect
      .poll(() => buffer(page, source.activePaneId))
      .toContain("STILL STREAMING");
    expect(
      await page.evaluate(() =>
        (window as any).__nativeTest.calls.filter(
          (call: any) => call.command === "close_terminal",
        ),
      ),
    ).toEqual([]);
    expect(
      await page.evaluate(() => (window as any).__nativeTest.sessions.size),
    ).toBe(2);
    if (side === "right")
      await page.screenshot({ path: "test-results/tab-merge-result.png" });
    await expect.poll(async () => (await savedTabs(page))?.length).toBe(1);
    await page.reload();
    await expect(page.locator(".xterm-screen")).toHaveCount(2);
    await expect(page.getByRole("tab")).toHaveText(["Terminal 1"]);
    await expect
      .poll(() => buffer(page, source.activePaneId))
      .not.toContain("STILL STREAMING");
    await page.keyboard.press("Control+w");
    await expect(page.locator("[data-pane-id]")).toHaveCount(1);
    await expect(
      page.locator(`[data-pane-id="${target.activePaneId}"]`),
    ).toBeVisible();
  });
}

test("Escape, pointer cancellation, lost focus and dropping outside leave tabs intact", async ({
  page,
}) => {
  await setup(page);
  const source = page.getByRole("tab", { name: "Terminal 2", exact: true });
  const area = (await page.locator(".terminal-layout").boundingBox())!;
  for (const cancel of ["escape", "pointercancel", "blur", "outside"]) {
    await grab(page, source);
    await page.mouse.move(area.x + area.width - 50, area.y + area.height / 2, {
      steps: 5,
    });
    await expect(page.locator(".tab-merge-preview")).toBeVisible();
    if (cancel === "escape") await page.keyboard.press("Escape");
    if (cancel === "pointercancel")
      await source.dispatchEvent("pointercancel", { pointerId: 1 });
    if (cancel === "blur")
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    if (cancel === "outside") await page.mouse.move(10, 120, { steps: 3 });
    await page.mouse.up();
    await expect(page.locator(".tab-drag-ghost")).toHaveCount(0);
    await expect(page.locator(".tab-merge-preview")).toHaveCount(0);
    await expect(page.getByRole("tab")).toHaveCount(3);
    await expect(page.getByRole("tab", { selected: true })).toHaveText(
      "Terminal 1",
    );
  }
  await source.click();
  await expect(source).toHaveAttribute("aria-selected", "true");
});

test("rejects self drops and splits that cannot fit without closing or starting terminals", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 420 });
  await setup(page, 2);
  await page.keyboard.press("Control+d");
  await expect(page.locator(".xterm-screen")).toHaveCount(2);
  const area = (await page.locator(".terminal-layout").boundingBox())!;
  for (const name of ["Terminal 1", "Terminal 2"]) {
    await grab(page, page.getByRole("tab", { name, exact: true }));
    await page.mouse.move(area.x + area.width - 20, area.y + area.height / 2, {
      steps: 6,
    });
    if (name === "Terminal 2")
      await expect(page.locator(".tab-merge-preview")).toHaveText(
        "Not enough room for these panels",
      );
    else await expect(page.locator(".tab-merge-preview")).toHaveCount(0);
    await page.mouse.up();
    await expect(page.getByRole("tab")).toHaveCount(2);
    await expect(page.locator(".xterm-screen")).toHaveCount(2);
  }
  expect(
    await page.evaluate(() => (window as any).__nativeTest.sessions.size),
  ).toBe(2);
});

test("holding a dragged tab at the strip edge scrolls to tabs beyond the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 420 });
  await setup(page, 12);
  const bounds = (await page.locator(".tab-strip").boundingBox())!;
  await grab(page, page.getByRole("tab", { name: "Terminal 1", exact: true }));
  await page.mouse.move(
    bounds.x + bounds.width - 2,
    bounds.y + bounds.height / 2,
    { steps: 6 },
  );
  await expect
    .poll(
      () =>
        page
          .locator(".tab-strip")
          .evaluate(
            (element) =>
              element.scrollWidth - element.clientWidth - element.scrollLeft,
          ),
      { timeout: 10000 },
    )
    .toBeLessThan(2);
  await page.mouse.up();
  await expect(page.getByRole("tab").last()).toHaveText("Terminal 1");
  await expect(page.getByRole("tab", { selected: true })).toHaveText(
    "Terminal 1",
  );
  await expect(page.locator(".tab-drag-ghost")).toHaveCount(0);
});

test("reordering a modified file retains its buffer and undo history", async ({
  page,
}) => {
  await setup(page, 2);
  await page.getByRole("button", { name: "README.md", exact: true }).click();
  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("drag keeps edits");
  const file = page.getByRole("tab", { name: /README.md/ });
  const first = (await page
    .getByRole("tab", { name: "Terminal 1", exact: true })
    .boundingBox())!;
  await grab(page, file);
  await page.mouse.move(first.x, first.y + first.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByRole("tab").first()).toContainText("README.md");
  await expect(file).toHaveAttribute("aria-selected", "true");
  await expect(editor).toContainText("drag keeps edits");
  await editor.click();
  await page.keyboard.press("Control+z");
  await expect(editor).not.toContainText("drag keeps edits");
});

test("merging different shells preserves profiles when restoring and splitting a moved pane", async ({
  page,
}) => {
  const project = newProject("/project", "local:bash");
  const workspace = project.workspaces[0];
  workspace.tabs[0].title = "Target";
  workspace.tabs.push(newTab("/project/source", "local:fish", "Source"));
  await mockDesktop(page, false, {
    ...newSession(),
    projects: [project],
    activeProjectId: project.id,
  });
  await page.addInitScript(() => {
    const native = (window as any).__TAURI_INTERNALS__;
    const invoke = native.invoke;
    native.invoke = async (command: string, args: unknown) => {
      const result = await invoke(command, args);
      if (command === "app_info")
        result.profiles.push({
          ...result.profiles[0],
          id: "local:fish",
          name: "fish",
          kind: "fish",
          program: "/bin/fish",
        });
      return result;
    };
  });
  await page.goto("/");
  await expect(page.locator(".xterm-screen")).toBeVisible();
  const area = (await page.locator(".terminal-layout").boundingBox())!;
  await grab(page, page.getByRole("tab", { name: "Source", exact: true }));
  await page.mouse.move(area.x + area.width - 40, area.y + area.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(page.getByRole("tab")).toHaveText(["Target"]);
  await expect(
    page.getByRole("region", { name: "Terminal fish", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await savedTabs(page))?.[0].layout.second?.profileId)
    .toBe("local:fish");
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Terminal fish", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+Shift+d");
  await expect(
    page.getByRole("region", { name: "Terminal fish", exact: true }),
  ).toHaveCount(2);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__nativeTest.calls
          .filter((call: any) => call.command === "start_terminal")
          .map((call: any) => call.args.request.profileId),
      ),
    )
    .toEqual(["local:bash", "local:fish", "local:fish"]);
});
