import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { newPane, newProject, newSession, splitPane } from "../../src/model";
import { mockDesktop } from "./desktop";

async function openSplit(page: Page, ratio = 0.5) {
  const project = newProject("/project", "local:bash");
  const tab = project.workspaces[0].tabs[0];
  if (tab.type !== "terminal") throw new Error("Expected terminal tab");
  const firstId = tab.activePaneId;
  const second = newPane("/project/second");
  tab.layout = splitPane(tab.layout, firstId, "horizontal", second);
  if (tab.layout.type === "split") tab.layout.ratio = ratio;
  await mockDesktop(page, false, {
    ...newSession(),
    projects: [project],
    activeProjectId: project.id,
  });
  await page.goto("/");
  await expect(page.locator(".xterm-screen")).toHaveCount(2);
  const first = page.locator(`[data-pane-id="${firstId}"]`);
  const hovered = page.locator(`[data-pane-id="${second.id}"]`);
  await first.click();
  await hovered.hover();
  await expect(first.locator(".xterm-helper-textarea")).toBeFocused();
  return { first, hovered };
}

async function calls(page: Page, command: string) {
  return page.evaluate(
    (command) =>
      (window as any).__nativeTest.calls.filter(
        (call: any) => call.command === command,
      ),
    command,
  );
}

for (const shortcut of ["Control+d", "Control+Shift+d"]) {
  test(`${shortcut} splits the hovered terminal while typing keeps the clicked terminal focused`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({
      colorScheme: shortcut === "Control+d" ? "dark" : "light",
    });
    const { first, hovered } = await openSplit(page);
    const originalBounds = await first.boundingBox();
    const hoveredBounds = (await hovered.boundingBox())!;
    await page.keyboard.type("pwd");
    await expect
      .poll(async () =>
        (await calls(page, "write_terminal"))
          .map((call: any) => call.args.data)
          .join(""),
      )
      .toBe("pwd");
    await expect(first.locator(".xterm-helper-textarea")).toBeFocused();

    await page.keyboard.press(shortcut);
    await expect(page.locator("[data-pane-id]")).toHaveCount(3);
    expect(await first.boundingBox()).toEqual(originalBounds);
    const added = page.locator(".terminal-pane.is-active");
    await expect(added.locator(".xterm-helper-textarea")).toBeFocused();
    const addedBounds = (await added.boundingBox())!;
    if (shortcut === "Control+d") {
      expect(addedBounds.x).toBeGreaterThan(hoveredBounds.x);
      expect(addedBounds.height).toBe(hoveredBounds.height);
    } else {
      expect(addedBounds.y).toBeGreaterThan(hoveredBounds.y);
      expect(addedBounds.width).toBe(hoveredBounds.width);
    }
    await expect
      .poll(async () =>
        (await calls(page, "start_terminal")).map(
          (call: any) => call.args.request.cwd,
        ),
      )
      .toEqual(["/project", "/project/second", "/project/second"]);
    expect(
      (await calls(page, "write_terminal"))
        .map((call: any) => call.args.data)
        .join(""),
    ).toBe("pwd");
    await page.screenshot({ path: testInfo.outputPath("hovered-split.png") });
  });
}

test("split shortcuts fall back to the active terminal after the pointer leaves the panes", async ({
  page,
}) => {
  const { first, hovered } = await openSplit(page);
  const originalBounds = (await first.boundingBox())!;
  const hoveredBounds = await hovered.boundingBox();
  await page.locator(".sidebar-heading").hover();
  await page.keyboard.press("Control+d");
  await expect(page.locator("[data-pane-id]")).toHaveCount(3);
  expect(await hovered.boundingBox()).toEqual(hoveredBounds);
  expect((await first.boundingBox())!.width).toBeLessThan(originalBounds.width);
});

test("a hovered terminal without room does not split the larger active terminal", async ({
  page,
}) => {
  const { first, hovered } = await openSplit(page, 0.75);
  const originalBounds = await first.boundingBox();
  const hoveredBounds = await hovered.boundingBox();
  await page.keyboard.press("Control+d");
  await expect(page.locator(".pane-limit-notice")).toContainText("No room");
  await expect(page.locator("[data-pane-id]")).toHaveCount(2);
  expect(await first.boundingBox()).toEqual(originalBounds);
  expect(await hovered.boundingBox()).toEqual(hoveredBounds);
  await expect(first.locator(".xterm-helper-textarea")).toBeFocused();
  expect(await calls(page, "write_terminal")).toHaveLength(0);
});
