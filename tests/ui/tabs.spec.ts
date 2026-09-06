import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mockDesktop } from "./desktop";
import { newProject, newSession, newTab, newWorkspace } from "../../src/model";

async function restoreTabs(
  page: Page,
  count: number,
  activeIndex = count - 1,
  path = "/project",
) {
  const project = newProject(path, "local:bash");
  const workspace = project.workspaces[0];
  workspace.tabs = Array.from({ length: count }, (_, index) =>
    newTab(path, "local:bash", index ? `Terminal ${index + 1}` : "Terminal"),
  );
  workspace.activeTabId = workspace.tabs[activeIndex].id;
  await mockDesktop(page, true, {
    ...newSession(),
    projects: [project],
    activeProjectId: project.id,
  });
  await page.goto("/");
  await expect(page.getByRole("tab")).toHaveCount(count);
  await expect
    .poll(() => page.evaluate(() => (window as any).__nativeTest.sessions.size))
    .toBe(1);
}

async function expectActiveTabInView(page: Page) {
  await expect
    .poll(() =>
      page.locator(".tab-strip").evaluate((strip) => {
        const active = strip.querySelector(".active-tab")!;
        const tabBounds = active.getBoundingClientRect();
        const stripBounds = strip.getBoundingClientRect();
        return (
          tabBounds.left >= stripBounds.left - 1 &&
          tabBounds.right <= stripBounds.right + 1
        );
      }),
    )
    .toBe(true);
}

test("many tabs remain usable with scrolling and tab shortcuts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 420 });
  await restoreTabs(page, 24);
  await expectActiveTabInView(page);
  const closedSessionId = await page.evaluate(
    () => [...(window as any).__nativeTest.sessions.keys()][0],
  );
  await expect(
    page.getByRole("button", { name: "Scroll tabs right" }),
  ).toBeDisabled();
  const strip = page.locator(".tab-strip");
  const initialScroll = await strip.evaluate((element) => element.scrollLeft);
  await page.getByRole("button", { name: "Scroll tabs left" }).click();
  await expect
    .poll(() => strip.evaluate((element) => element.scrollLeft))
    .toBeLessThan(initialScroll);
  const beforeWheel = await strip.evaluate((element) => element.scrollLeft);
  await strip.hover();
  await page.mouse.wheel(0, -200);
  await expect
    .poll(() => strip.evaluate((element) => element.scrollLeft))
    .toBeLessThan(beforeWheel);
  await expect(page.getByRole("tab", { selected: true })).toHaveText(
    "Terminal 24",
  );
  await page.keyboard.press("Control+Shift+W");
  await expect(page.getByRole("tab")).toHaveCount(23);
  await expect(page.getByRole("tab", { selected: true })).toHaveText(
    "Terminal 23",
  );
  await expectActiveTabInView(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__nativeTest.calls
          .filter((call: any) => call.command === "close_terminal")
          .map((call: any) => call.args.id),
      ),
    )
    .toEqual([closedSessionId]);
  await page.keyboard.press("Control+Shift+T");
  await expect(page.getByRole("tab")).toHaveCount(24);
  await expectActiveTabInView(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/tabs-many-minimum.png" });
});

test("tab navigation reveals the entire active tab after switching and resizing", async ({
  page,
}) => {
  await restoreTabs(page, 12, 0);
  await page.getByRole("tab", { selected: true }).focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { selected: true })).toHaveText(
    "Terminal 12",
  );
  await expectActiveTabInView(page);
  await page.keyboard.press("Control+Home");
  await expect(page.getByRole("tab", { selected: true })).toHaveText(
    "Terminal 12",
  );
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { selected: true })).toHaveText(
    "Terminal",
  );
  await expectActiveTabInView(page);
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { selected: true })).toHaveText(
    "Terminal 12",
  );
  await expectActiveTabInView(page);
  await page.setViewportSize({ width: 800, height: 420 });
  await expectActiveTabInView(page);
  await page.setViewportSize({ width: 2560, height: 900 });
  await expectActiveTabInView(page);
  await expect(
    page.getByRole("button", { name: "Scroll tabs left" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Scroll tabs right" }),
  ).toHaveCount(0);
});

test("closing the only tab disposes its terminal and opens a fresh tab", async ({
  page,
}) => {
  await restoreTabs(page, 1);
  await expect(page.locator(".xterm-screen")).toBeVisible();
  const closedTabId = await page.getByRole("tab").getAttribute("id");
  const closedSessionId = await page.evaluate(
    () => [...(window as any).__nativeTest.sessions.keys()][0],
  );
  await page.screenshot({ path: "test-results/tabs-single.png" });
  await page
    .getByRole("button", {
      name: "Close Terminal",
      exact: true,
    })
    .click();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.getByRole("tab")).not.toHaveAttribute("id", closedTabId!);
  await expect(page.locator(".xterm-screen")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__nativeTest.calls
          .filter((call: any) => call.command === "close_terminal")
          .map((call: any) => call.args.id),
      ),
    )
    .toEqual([closedSessionId]);
});

test("long names keep the active tab centered and its close button visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 420 });
  await restoreTabs(page, 24, 23, "/a-project-with-a-long-folder-name");
  const active = page.getByRole("tab", { selected: true });
  await active.dblclick();
  const title =
    "Backend — watching tests and streaming development server logs";
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(title);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(active).toHaveText(title);
  await expectActiveTabInView(page);
  const bounds = await page.locator(".tab-strip").evaluate((strip) => {
    const tab = strip.querySelector(".active-tab")!.getBoundingClientRect();
    const viewport = strip.getBoundingClientRect();
    return {
      top: tab.top - viewport.top,
      bottom: viewport.bottom - tab.bottom,
    };
  });
  expect(Math.abs(bounds.top - bounds.bottom)).toBeLessThan(1);
  await page.screenshot({ path: "test-results/tabs-long-name.png" });
  await page
    .getByRole("button", { name: `Close ${title}`, exact: true })
    .click();
  await expect(page.getByRole("tab")).toHaveCount(23);
  await expectActiveTabInView(page);
});

for (const { action, remaining, active } of [
  {
    action: "Close",
    remaining: ["Terminal", "Terminal 2", "Terminal 4", "Terminal 5"],
    active: "Terminal 5",
  },
  { action: "Close Others", remaining: ["Terminal 3"], active: "Terminal 3" },
  {
    action: "Close Left",
    remaining: ["Terminal 3", "Terminal 4", "Terminal 5"],
    active: "Terminal 5",
  },
  {
    action: "Close Right",
    remaining: ["Terminal", "Terminal 2", "Terminal 3"],
    active: "Terminal 3",
  },
]) {
  test(`tab context menu ${action} operates on the clicked inactive tab`, async ({
    page,
  }) => {
    await restoreTabs(page, 5);
    await page
      .getByRole("tab", { name: "Terminal 3", exact: true })
      .click({ button: "right" });
    await expect(page.getByRole("tab", { selected: true })).toHaveText(
      "Terminal 5",
    );
    await page.getByRole("menuitem", { name: action, exact: true }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.getByRole("tab")).toHaveText(remaining);
    await expect(page.getByRole("tab", { selected: true })).toHaveText(active);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const session = JSON.parse(
            localStorage.getItem("test-session") ?? "null",
          );
          return session?.projects[0].workspaces[0].tabs.map(
            (tab: any) => tab.title,
          );
        }),
      )
      .toEqual(remaining);
  });
}

test("Close All disposes each started pane, leaves other workspaces intact and opens one fresh terminal", async ({
  page,
}) => {
  const project = newProject("/project", "local:bash");
  const workspace = project.workspaces[0];
  workspace.tabs.push(newTab("/project", "local:bash", "Terminal 2"));
  const other = newWorkspace("/project", "local:bash", "Review");
  project.workspaces.push(other);
  await mockDesktop(page, true, {
    ...newSession(),
    projects: [project],
    activeProjectId: project.id,
  });
  await page.goto("/");
  await expect(page.locator(".xterm-screen")).toBeVisible();
  await page.keyboard.press("Control+d");
  await expect(page.locator(".xterm-screen")).toHaveCount(2);
  await page.getByRole("tab", { name: "Terminal 2", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__nativeTest.sessions.size))
    .toBe(3);
  const originalSessions = await page.evaluate(() =>
    [...(window as any).__nativeTest.sessions.keys()].sort(),
  );
  await page
    .getByRole("tab", { name: "Terminal", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Close All", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.getByRole("tab")).not.toHaveAttribute(
    "id",
    `tab-${workspace.tabs[0].id}`,
  );
  await expect(page.locator(".xterm-screen")).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__nativeTest.calls.filter(
            (call: any) => call.command === "start_terminal",
          ).length,
      ),
    )
    .toBe(4);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__nativeTest.calls
          .filter((call: any) => call.command === "close_terminal")
          .map((call: any) => call.args.id)
          .sort(),
      ),
    )
    .toEqual(originalSessions);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("test-session") ?? "null")
            ?.projects[0].workspaces[1],
      ),
    )
    .toEqual(other);
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await page.getByRole("button", { name: "Review 1", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveAttribute(
    "id",
    `tab-${other.tabs[0].id}`,
  );
});

test("tab context menu supports keyboard navigation, disabled actions and dismissal", async ({
  page,
}) => {
  await restoreTabs(page, 1);
  const tab = page.getByRole("tab");
  await tab.focus();
  await page.keyboard.press("Shift+F10");
  await expect(
    page.getByRole("menuitem", { name: "Close", exact: true }),
  ).toBeFocused();
  for (const name of ["Close Others", "Close Left", "Close Right"])
    await expect(
      page.getByRole("menuitem", { name, exact: true }),
    ).toBeDisabled();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitem", { name: "Close Clean", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("menuitem", { name: "Close All", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("menuitem", { name: "Close", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(tab).toBeFocused();
  await tab.click({ button: "right" });
  await page.keyboard.press("Tab");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await tab.click({ button: "right" });
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await expect(page.getByRole("menu", { name: "Tab actions" })).toHaveCount(0);
  await expect(tab).toHaveCount(1);
});

test("tab context menu fits the minimum window in dark and light appearances", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 420 });
  await restoreTabs(page, 12);
  for (const colorScheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.getByRole("tab", { selected: true }).click({ button: "right" });
    const menu = page.getByRole("menu", { name: "Tab actions" });
    await expect(menu).toBeVisible();
    const bounds = (await menu.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(800);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(420);
    await expect(
      page.getByRole("menuitem", { name: "Close Right", exact: true }),
    ).toBeDisabled();
    await page.screenshot({
      path: `test-results/tab-context-menu-${colorScheme}.png`,
    });
    await page.keyboard.press("Escape");
  }
});
