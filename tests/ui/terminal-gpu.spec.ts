import { expect, test } from "@playwright/test";
import { newId, newPane, newProject, newSession, panes } from "../../src/model";
import type { Layout } from "../../src/model";
import { mockDesktop } from "./desktop";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const resources = new Map<
      WebGL2RenderingContext,
      { type: string; value: any }[]
    >();
    (window as any).__gpuResources = resources;
    for (const type of [
      "Buffer",
      "Texture",
      "Program",
      "Shader",
      "VertexArray",
    ]) {
      const prototype = WebGL2RenderingContext.prototype as any;
      const create = prototype[`create${type}`];
      prototype[`create${type}`] = function (...args: any[]) {
        const value = create.apply(this, args);
        if (!resources.has(this)) resources.set(this, []);
        resources.get(this)!.push({ type, value });
        return value;
      };
    }
  });
});

test("large terminal history reuses its GPU context and releases hidden drawing resources", async ({
  page,
}) => {
  await mockDesktop(page, false);
  await page.goto("/");
  await expect(page.locator(".terminal-host")).toHaveCSS("opacity", "1");
  const id = (await page
    .locator("[data-pane-id]")
    .getAttribute("data-pane-id"))!;
  await page.evaluate(async (id) => {
    const { runningTerminal } = await import("/src/terminal-runtime.ts");
    const terminal = runningTerminal(id)!.terminal;
    terminal.options.scrollback = 100000;
    await new Promise<void>((resolve) =>
      terminal.write(
        Array.from({ length: 50000 }, (_, i) => `Context ${i}\r\n`).join(""),
        resolve,
      ),
    );
    terminal.scrollToLine(20000);
    terminal.select(0, 20001, 8);
    (window as any).__gpuHistory = {
      scroll: terminal.buffer.active.viewportY,
      selection: terminal.getSelection(),
    };
  }, id);
  const allocations = () =>
    page.evaluate(() =>
      [...(window as any).__gpuResources.values()].map(
        (objects: unknown[]) => objects.length,
      ),
    );
  const beforeOverview = await allocations();
  const toggle = page.getByRole("button", {
    name: "Toggle terminal overview (Ctrl+Tab)",
    exact: true,
  });
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Control+Tab");
    await expect(page.locator(".terminal-overview")).toBeFocused();
    await expect(page.locator(".xterm-screen")).toBeHidden();
    await toggle.click();
    await expect(page.locator(".terminal-host")).toHaveCSS("opacity", "1");
    await expect(page.locator(".xterm-helper-textarea")).toBeFocused();
    expect(await allocations()).toEqual(beforeOverview);
  }
  await page.getByRole("button", { name: "README.md", exact: true }).click();
  for (let i = 0; i < 4; i++) {
    await expect(page.locator(".cm-content")).toBeVisible();
    expect(
      await page.evaluate(() => {
        const resources = (window as any).__gpuResources as Map<
          WebGL2RenderingContext,
          { type: string; value: any }[]
        >;
        return [...resources].map(([gl, objects]) => ({
          lost: gl.isContextLost(),
          width: gl.canvas.width,
          height: gl.canvas.height,
          live: objects
            .filter(({ type, value }) => (gl as any)[`is${type}`](value))
            .map(({ type }) => type),
        }));
      }),
    ).toEqual([{ lost: false, width: 0, height: 0, live: [] }]);
    await page.getByRole("tab", { name: "Terminal", exact: true }).click();
    await expect(page.locator(".terminal-host")).toHaveCSS("opacity", "1");
    const state = await page.evaluate(async (id) => {
      const { runningTerminal } = await import("/src/terminal-runtime.ts");
      const runtime = runningTerminal(id)!;
      return {
        renderer: runtime.getSnapshot().renderer,
        scroll: runtime.terminal.buffer.active.viewportY,
        selection: runtime.terminal.getSelection(),
        before: (window as any).__gpuHistory,
      };
    }, id);
    expect(state.renderer).toBe("WebGL");
    expect({ scroll: state.scroll, selection: state.selection }).toEqual(
      state.before,
    );
    await page.getByRole("tab", { name: /README.md/ }).click();
  }
  await page.evaluate(() => {
    const gl = (window as any).__gpuResources.keys().next()
      .value as WebGL2RenderingContext;
    gl.getExtension("WEBGL_lose_context")!.loseContext();
  });
  await page.getByRole("tab", { name: "Terminal", exact: true }).click();
  await expect(page.locator(".terminal-host")).toHaveCSS("opacity", "1");
  await expect
    .poll(() => page.evaluate(() => (window as any).__gpuResources.size))
    .toBe(2);
  await page.keyboard.type("still connected");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__nativeTest.calls
          .filter((call: any) => call.command === "write_terminal")
          .map((call: any) => call.args.data)
          .join(""),
      ),
    )
    .toBe("still connected");
});

test("switching and closing split tabs reuse empty GPU contexts", async ({
  page,
}) => {
  const grid = (depth: number): Layout =>
    depth === 0
      ? newPane("/project")
      : {
          type: "split",
          id: newId(),
          axis: depth === 3 ? "horizontal" : "vertical",
          ratio: 0.5,
          first: grid(depth - 1),
          second: grid(depth - 1),
        };
  const project = newProject("/project", "local:bash");
  const tab = project.workspaces[0].tabs[0];
  if (tab.type !== "terminal") throw new Error("Expected terminal tab");
  tab.layout = grid(3);
  tab.activePaneId = panes(tab.layout)[0].id;
  await mockDesktop(page, false, {
    ...newSession(),
    projects: [project],
    activeProjectId: project.id,
  });
  await page.goto("/");
  const canvases = page.locator(
    ".xterm-screen > canvas:not(.xterm-link-layer)",
  );
  const expectRenderers = async (count: number) => {
    await expect(canvases).toHaveCount(count);
    for (const host of await page.locator(".terminal-host").all())
      await expect(host).toHaveCSS("opacity", "1");
    expect(
      await page.evaluate(() => {
        const resources = (window as any).__gpuResources as Map<
          WebGL2RenderingContext,
          { type: string; value: any }[]
        >;
        return {
          contexts: resources.size,
          idle: [...resources].filter(
            ([gl, objects]) =>
              !gl.isContextLost() &&
              gl.canvas.width === 0 &&
              gl.canvas.height === 0 &&
              objects.every(
                ({ type, value }) => !(gl as any)[`is${type}`](value),
              ),
          ).length,
        };
      }),
    ).toEqual({ contexts: 8, idle: 8 - count });
  };
  await expectRenderers(8);
  await page.keyboard.press("Control+Shift+t");
  await expectRenderers(1);
  const sessions = await page.evaluate(() =>
    [...(window as any).__nativeTest.sessions.keys()].sort(),
  );
  await page.evaluate(() => {
    (window as any).__tabFontLoads = 0;
    const load = document.fonts.load.bind(document.fonts);
    document.fonts.load = (...args) => {
      (window as any).__tabFontLoads++;
      return load(...args);
    };
  });
  for (let i = 0; i < 3; i++) {
    await page.getByRole("tab", { name: "Terminal", exact: true }).click();
    await expectRenderers(8);
    await page.getByRole("tab", { name: "Terminal 2", exact: true }).click();
    await expectRenderers(1);
  }
  expect(await page.evaluate(() => (window as any).__tabFontLoads)).toBe(0);
  expect(
    await page.evaluate(() =>
      (window as any).__nativeTest.calls.filter(
        (call: any) => call.command === "close_terminal",
      ),
    ),
  ).toEqual([]);
  await page
    .getByRole("button", { name: "Close Terminal 2", exact: true })
    .click();
  await expectRenderers(8);
  await page
    .getByRole("button", { name: "Close Terminal", exact: true })
    .click();
  await expectRenderers(1);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__nativeTest.calls
          .filter((call: any) => call.command === "close_terminal")
          .map((call: any) => call.args.id)
          .sort(),
      ),
    )
    .toEqual(sessions);
});
