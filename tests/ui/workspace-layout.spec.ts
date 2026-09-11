import { test, expect } from "@playwright/test";
import { addWorkspace, newSession } from "../../src/model";
import { mockDesktop } from "./desktop";

for (const width of [1440, 800]) {
  test(`workspace switches keep the layout stable at ${width}px`, async ({
    page,
  }, testInfo) => {
    let session = newSession();
    for (const [path, name] of [
      ["/work/short", "First"],
      ["/work/short", "Second"],
      ["/work/plain", "Plain"],
      ["/work/a-longer-project-name", "Third"],
    ])
      session = addWorkspace(session, path, "local:bash", name);
    session.sidebar = "workspaces";
    session.rightSidebar = "git";
    session.sidebarSides.git = "right";
    await page.setViewportSize({ width, height: 600 });
    await mockDesktop(page, true, session);
    await page.addInitScript(() => {
      const native = (window as any).__TAURI_INTERNALS__;
      const invoke = native.invoke;
      native.invoke = async (
        command: string,
        args: Record<string, any> = {},
      ) => {
        if (command === "git_status") {
          await new Promise((resolve) => setTimeout(resolve, 180));
          return args.root === "/work/plain"
            ? null
            : { root: args.root, branch: args.root, changes: [] };
        }
        return invoke(command, args);
      };
    });
    await page.goto("/");
    await expect(page.locator(".branch-status")).toBeVisible();
    for (const name of ["First", "Second", "Third", "First"]) {
      await page.evaluate(() => {
        const state = ((window as any).__workspaceGeometry = {
          frames: [] as any[],
        });
        const sample = () => {
          state.frames.push(
            Object.fromEntries(
              [
                ".app-shell",
                ".titlebar",
                ".tab-bar",
                ".work-area",
                ".workspace-list",
                ".terminal-stage",
                ".statusbar",
              ].map((selector) => {
                const element = document.querySelector(selector);
                if (!element) return [selector, null];
                const { x, y, width, height } = element.getBoundingClientRect();
                return [
                  selector,
                  {
                    x,
                    y,
                    width,
                    height,
                    scrollX: element.scrollLeft,
                    scrollY: element.scrollTop,
                  },
                ];
              }),
            ),
          );
          if (state.frames.length < 30) requestAnimationFrame(sample);
        };
        sample();
      });
      const row = page
        .getByRole("navigation", { name: "Workspace list" })
        .getByRole("button", { name: new RegExp(`^${name} `) });
      await row.click();
      await expect(row).toHaveAttribute("aria-current", "true");
      await expect(page.locator(".branch-status")).toHaveText(
        name === "Third" ? "/work/a-longer-project-name" : "/work/short",
      );
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as any).__workspaceGeometry.frames.length,
          ),
        )
        .toBe(30);
      const frames = await page.evaluate(
        () => (window as any).__workspaceGeometry.frames,
      );
      const unique = Object.fromEntries(
        Object.keys(frames[0]).map((selector) => [
          selector,
          [
            ...new Set(
              frames.map((frame: any) => JSON.stringify(frame[selector])),
            ),
          ],
        ]),
      );
      for (const selector of Object.keys(unique))
        expect(
          unique[selector],
          `${name}: ${selector} must stay in place`,
        ).toHaveLength(1);
      await testInfo.attach(`${name}-frames`, {
        body: JSON.stringify(frames),
        contentType: "application/json",
      });
    }
    const sourceControl = page.getByRole("complementary", {
      name: "Source Control",
      exact: true,
    });
    await page.getByRole("button", { name: /^Plain / }).click();
    await expect(sourceControl).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^Toggle source control/ }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: /^Third / }).click();
    await expect(sourceControl).toBeVisible();
    await expect(page.locator(".branch-status")).toHaveText(
      "/work/a-longer-project-name",
    );
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
    expect(
      await page.evaluate(() =>
        (window as any).__nativeTest.calls.some(
          (call: any) => call.command === "close_terminal",
        ),
      ),
    ).toBe(false);
    await page.screenshot({
      path: testInfo.outputPath("workspace-layout.png"),
    });
  });
}
