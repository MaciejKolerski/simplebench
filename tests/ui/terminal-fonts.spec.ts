import { expect, test } from "@playwright/test";
import { mockDesktop } from "./desktop";

for (const renderer of ["WebGL", "DOM"] as const) {
  test(`${renderer} waits for all terminal font faces before fitting and starting the shell`, async ({
    page,
  }, testInfo) => {
    if (renderer === "DOM")
      await page.addInitScript(() => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (
          kind: string,
          ...args: any[]
        ) {
          return kind === "webgl2"
            ? null
            : (getContext as any).call(this, kind, ...args);
        } as typeof getContext;
      });
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requested = false;
    await page.route("**/JetBrainsMono-BoldItalic.woff2", async (route) => {
      requested = true;
      await pending;
      await route.continue();
    });
    await mockDesktop(page, false);
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect.poll(() => requested).toBe(true);
      await expect(page.locator(".terminal-host")).toHaveCSS("opacity", "0");
      expect(
        await page.evaluate(() =>
          (window as any).__nativeTest.calls.filter(
            (call: any) => call.command === "start_terminal",
          ),
        ),
      ).toEqual([]);
    } finally {
      release();
    }
    await expect(page.locator(".terminal-host")).toHaveCSS("opacity", "1");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).__nativeTest.calls.filter(
              (call: any) => call.command === "start_terminal",
            ).length,
        ),
      )
      .toBe(1);
    const result = await page.evaluate(async () => {
      const { runningTerminal } = await import("/src/terminal-runtime.ts");
      const pane = document.querySelector<HTMLElement>("[data-pane-id]")!;
      const runtime = runningTerminal(pane.dataset.paneId!)!;
      const start = (window as any).__nativeTest.calls.find(
        (call: any) => call.command === "start_terminal",
      ).args.request;
      await new Promise<void>((resolve) =>
        runtime.terminal.write(
          "\x1b[2J\x1b[H" +
            [
              "[woro@woro-home simplebench]$ ls",
              "AGENTS.md  package.json  src-tauri  src  tests",
              "Zażółć gęślą jaźń — 0O 1Il {} [] ()",
              "\x1b[1mBold\x1b[0m  \x1b[3mItalic\x1b[0m  \x1b[1;3mBold italic\x1b[0m",
              "┌────────────┐",
              "│ Terminal   │",
              "└────────────┘",
            ].join("\r\n"),
          resolve,
        ),
      );
      return {
        renderer: runtime.getSnapshot().renderer,
        fonts: [...document.fonts]
          .filter((face) => face.family.includes("JetBrains Mono"))
          .map((face) => face.status),
        initial: { cols: start.cols, rows: start.rows },
        current: { cols: runtime.terminal.cols, rows: runtime.terminal.rows },
        fitted: runtime.fitAddon.proposeDimensions(),
      };
    });
    expect(result.renderer).toBe(renderer);
    expect(result.fonts).toEqual(["loaded", "loaded", "loaded", "loaded"]);
    expect(result.initial).toEqual(result.current);
    expect(result.current).toEqual(result.fitted);
    await page.locator(".terminal-pane").screenshot({
      path: testInfo.outputPath(`terminal-fonts-${renderer}.png`),
    });
  });
}

test("a font loading failure keeps the terminal usable with a fallback", async ({
  page,
}) => {
  await page.route("**/fonts/jetbrains-mono/*.woff2", (route) => route.abort());
  await mockDesktop(page, false);
  await page.goto("/");
  await expect(page.locator(".terminal-host")).toHaveCSS("opacity", "1");
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.insertText("fallback input");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__nativeTest.calls
          .filter((call: any) => call.command === "write_terminal")
          .map((call: any) => call.args.data)
          .join(""),
      ),
    )
    .toBe("fallback input");
});
