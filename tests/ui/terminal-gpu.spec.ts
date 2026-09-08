import { expect, test } from "@playwright/test";
import { mockDesktop } from "./desktop";

test("large terminal history reuses its GPU context and releases hidden drawing resources", async ({
  page,
}) => {
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
  await page.keyboard.insertText("still connected");
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

test("hiding a split tab keeps at most one spare GPU context", async ({
  page,
}) => {
  await mockDesktop(page, false);
  await page.goto("/");
  await expect(page.locator(".terminal-host")).toHaveCSS("opacity", "1");
  await page.keyboard.press("Control+d");
  await expect(page.locator(".terminal-host")).toHaveCount(2);
  await page.keyboard.press("Control+d");
  await expect(page.locator(".terminal-host")).toHaveCount(3);
  const canvases = page.locator(
    ".xterm-screen > canvas:not(.xterm-link-layer)",
  );
  await expect(canvases).toHaveCount(3);
  await page.evaluate(() => {
    (window as any).__splitContexts = Array.from(
      document.querySelectorAll<HTMLCanvasElement>(
        ".xterm-screen > canvas:not(.xterm-link-layer)",
      ),
      (canvas) => canvas.getContext("webgl2")!,
    );
  });
  await page.getByRole("button", { name: "README.md", exact: true }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__splitContexts.filter(
            (gl: WebGL2RenderingContext) => !gl.isContextLost(),
          ).length,
      ),
    )
    .toBe(1);
  await page.getByRole("tab", { name: "Terminal", exact: true }).click();
  await expect(canvases).toHaveCount(3);
  for (const host of await page.locator(".terminal-host").all())
    await expect(host).toHaveCSS("opacity", "1");
});
