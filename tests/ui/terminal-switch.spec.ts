import { expect, test } from "@playwright/test";
import { mockDesktop, buffer } from "./desktop";

test.use({ colorScheme: "dark" });

test("switching tabs paints the final renderer without changing the terminal grid or scrollback", async ({
  page,
}, testInfo) => {
  await mockDesktop(page, false);
  await page.goto("/");
  await expect(page.locator(".xterm-screen")).toBeVisible();
  const first = (await page
    .locator("[data-pane-id]")
    .getAttribute("data-pane-id"))!;
  const renderer = (id: string) =>
    page.evaluate(async (id) => {
      const { runningTerminal } = await import("/src/terminal-runtime.ts");
      return runningTerminal(id)!.getSnapshot().renderer;
    }, id);
  await expect.poll(() => renderer(first)).toBe("WebGL");
  await page.evaluate(async (id) => {
    const { runningTerminal } = await import("/src/terminal-runtime.ts");
    const runtime = runningTerminal(id)!;
    await new Promise<void>((resolve) =>
      runtime.terminal.write(
        "\x1b[?25l\x1b[2J\x1b[H" +
          Array.from(
            { length: 160 },
            (_, i) => `Line ${i}: ${"abcdefghij".repeat(20)}\r\n`,
          ).join(""),
        resolve,
      ),
    );
    runtime.terminal.scrollToLine(50);
    runtime.terminal.select(3, 55, 8);
    (window as any).__switchTest = {
      runtime,
      before: {
        cols: runtime.terminal.cols,
        rows: runtime.terminal.rows,
        scroll: runtime.terminal.buffer.active.viewportY,
        selection: runtime.terminal.getSelection(),
      },
      frames: [],
      resizes: [],
    };
    runtime.terminal.onResize((size) =>
      (window as any).__switchTest.resizes.push(size),
    );
  }, first);
  await page.keyboard.press("Control+Shift+t");
  const second = (await page
    .locator("[data-pane-id]")
    .getAttribute("data-pane-id"))!;
  expect(second).not.toBe(first);
  await expect.poll(() => renderer(second)).toBe("WebGL");
  await page.evaluate(async (id) => {
    const { runningTerminal } = await import("/src/terminal-runtime.ts");
    (window as any).__nativeTest.emit(
      runningTerminal(id)!.sessionId,
      "\r\nBackground output while hidden\r\n",
    );
    const state = (window as any).__switchTest;
    if (
      state.runtime.host.isConnected ||
      state.runtime.host.querySelector(
        ".xterm-screen > canvas:not(.xterm-link-layer)",
      )
    )
      throw new Error("Hidden terminals must release their renderer");
    const sample = () => {
      if (state.runtime.host.isConnected) {
        const terminal = state.runtime.terminal;
        const core = (terminal as any)._core;
        state.frames.push({
          visible:
            getComputedStyle(state.runtime.host).visibility === "visible" &&
            getComputedStyle(state.runtime.host).opacity !== "0",
          renderer: core._renderService._renderer.value.constructor.name,
          dom: !!state.runtime.host.querySelector(".xterm-rows"),
          cols: terminal.cols,
          rows: terminal.rows,
          width: core._renderService.dimensions.css.cell.width,
          scroll: terminal.buffer.active.viewportY,
        });
      }
      if (state.frames.length < 12) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, first);
  await expect
    .poll(() => buffer(page, first))
    .toContain("Background output while hidden");
  await page.getByRole("tab", { name: "Terminal", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__switchTest.frames.length))
    .toBe(12);
  const result = await page.evaluate(() => {
    const state = (window as any).__switchTest;
    return {
      before: state.before,
      frames: state.frames,
      resizes: state.resizes,
      selection: state.runtime.terminal.getSelection(),
    };
  });
  await testInfo.attach("switch-frames", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
  await page.screenshot({ path: testInfo.outputPath("terminal-switch.png") });
  expect(
    result.frames
      .filter((frame: any) => frame.visible)
      .some((frame: any) => frame.dom),
  ).toBe(false);
  expect(result.frames.some((frame: any) => frame.visible)).toBe(true);
  expect(result.resizes).toEqual([]);
  expect(result.selection).toBe(result.before.selection);
  for (const frame of result.frames)
    expect(frame.scroll).toBe(result.before.scroll);
});

test("returning to a resized terminal fits once using its updated font and renderer", async ({
  page,
}) => {
  await mockDesktop(page, false);
  await page.goto("/");
  await expect(page.locator(".xterm-screen > canvas").first()).toBeVisible();
  const first = (await page
    .locator("[data-pane-id]")
    .getAttribute("data-pane-id"))!;
  await page.keyboard.press("Control+Shift+t");
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.evaluate(async (id) => {
    const { runningTerminal } = await import("/src/terminal-runtime.ts");
    const runtime = runningTerminal(id)!;
    const state = ((window as any).__resizedTerminal = {
      runtime,
      resizes: [],
      nativeStart: (window as any).__nativeTest.calls.length,
    });
    runtime.terminal.onResize((size: any) =>
      state.resizes.push({ cols: size.cols, rows: size.rows }),
    );
    runtime.terminal.options.fontSize = 18;
  }, first);
  await page.setViewportSize({ width: 960, height: 640 });
  await page.getByRole("tab", { name: "Terminal", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const { runtime } = (window as any).__resizedTerminal;
        return (
          runtime.getSnapshot().renderer === "WebGL" &&
          getComputedStyle(runtime.host).opacity === "1"
        );
      }),
    )
    .toBe(true);
  const result = await page.evaluate(() => {
    const { runtime, resizes, nativeStart } = (window as any).__resizedTerminal;
    const actual = { cols: runtime.terminal.cols, rows: runtime.terminal.rows };
    return {
      actual,
      expected: runtime.fitAddon.proposeDimensions(),
      resizes,
      native: (window as any).__nativeTest.calls
        .slice(nativeStart)
        .filter(
          (call: any) =>
            call.command === "resize_terminal" &&
            call.args.id === runtime.sessionId,
        )
        .map((call: any) => ({ cols: call.args.cols, rows: call.args.rows })),
    };
  });
  expect(result.actual).toEqual(result.expected);
  expect(result.resizes).toEqual([result.expected]);
  expect(result.native).toEqual([result.expected]);
});

test("input waits for the initial renderer and survives switching away while it loads", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested!: () => void;
  const loading = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route(/@xterm_addon-webgl\.js/, async (route) => {
    requested();
    await pending;
    await route.continue();
  });
  await mockDesktop(page, false);
  await page.goto("/");
  await loading;
  await expect(page.locator(".xterm-helper-textarea")).toBeFocused();
  const first = (await page
    .locator("[data-pane-id]")
    .getAttribute("data-pane-id"))!;
  await page.keyboard.insertText("queued input");
  await page.keyboard.press("Control+Shift+t");
  await expect(page.getByRole("tab")).toHaveCount(2);
  expect(
    await page.evaluate(() =>
      (window as any).__nativeTest.calls.filter((call: any) =>
        ["start_terminal", "write_terminal"].includes(call.command),
      ),
    ),
  ).toEqual([]);
  release();
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
  await page.getByRole("tab", { name: "Terminal", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const { runningTerminal } = await import("/src/terminal-runtime.ts");
        const runtime = runningTerminal(id)!;
        const calls = (window as any).__nativeTest.calls;
        return {
          text: calls
            .filter(
              (call: any) =>
                call.command === "write_terminal" &&
                call.args.id === runtime.sessionId,
            )
            .map((call: any) => call.args.data)
            .join(""),
          renderer: runtime.getSnapshot().renderer,
          opacity: getComputedStyle(runtime.host).opacity,
          starts: calls.filter((call: any) => call.command === "start_terminal")
            .length,
        };
      }, first),
    )
    .toEqual({
      text: "queued input",
      renderer: "WebGL",
      opacity: "1",
      starts: 2,
    });
  await expect(page.locator(".xterm-helper-textarea")).toBeFocused();
});

test("losing the GPU context restores a fitted DOM terminal with working input", async ({
  page,
}) => {
  await mockDesktop(page, false);
  await page.goto("/");
  await expect(page.locator(".xterm-screen > canvas").first()).toBeVisible();
  const first = (await page
    .locator("[data-pane-id]")
    .getAttribute("data-pane-id"))!;
  await page.evaluate(async (id) => {
    const { runningTerminal } = await import("/src/terminal-runtime.ts");
    const runtime = runningTerminal(id)!;
    await new Promise<void>((resolve) =>
      runtime.terminal.write(
        "\r\nKeep this output after context loss 🦀\r\n",
        resolve,
      ),
    );
    const canvas = runtime.host.querySelector<HTMLCanvasElement>(
      ".xterm-screen > canvas:not(.xterm-link-layer)",
    )!;
    const extension = canvas
      .getContext("webgl2")!
      .getExtension("WEBGL_lose_context");
    if (!extension) throw new Error("Context loss simulation unavailable");
    extension.loseContext();
  }, first);
  await expect(page.locator(".xterm-rows")).toContainText(
    "Keep this output after context loss 🦀",
    { timeout: 10000 },
  );
  await page.keyboard.insertText("still typing");
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const { runningTerminal } = await import("/src/terminal-runtime.ts");
        const runtime = runningTerminal(id)!;
        return {
          renderer: runtime.getSnapshot().renderer,
          actual: { cols: runtime.terminal.cols, rows: runtime.terminal.rows },
          expected: runtime.fitAddon.proposeDimensions(),
          opacity: getComputedStyle(runtime.host).opacity,
          input: (window as any).__nativeTest.calls
            .filter(
              (call: any) =>
                call.command === "write_terminal" &&
                call.args.id === runtime.sessionId,
            )
            .map((call: any) => call.args.data)
            .join(""),
        };
      }, first),
    )
    .toMatchObject({ renderer: "DOM", opacity: "1", input: "still typing" });
  const finalSize = await page.evaluate(async (id) => {
    const { runningTerminal } = await import("/src/terminal-runtime.ts");
    const runtime = runningTerminal(id)!;
    return {
      actual: { cols: runtime.terminal.cols, rows: runtime.terminal.rows },
      expected: runtime.fitAddon.proposeDimensions(),
    };
  }, first);
  expect(finalSize.actual).toEqual(finalSize.expected);
});
