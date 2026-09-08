import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { buffer, mockDesktop } from "./desktop";

async function settingsPage(page: Page) {
  await mockDesktop(page, false);
  await page.goto("/?window=settings&page=terminal");
  await expect(
    page.getByRole("spinbutton", { name: "Font size", exact: true }),
  ).toBeEnabled();
}
async function field(page: Page, label: string, value: string) {
  const input = page.getByLabel(label, { exact: true });
  await expect(input).toBeEnabled();
  await input.fill(value);
  await input.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await expect(input).toBeEnabled();
}
async function options(page: Page, id: string) {
  return page.evaluate(async (id) => {
    const { runningTerminal } = await import("/src/terminal-runtime.ts");
    const runtime = runningTerminal(id);
    if (!runtime) return null;
    const { fontSize, fontFamily, scrollback, cursorStyle, theme } =
      runtime.terminal.options;
    return {
      fontSize,
      fontFamily,
      scrollback,
      cursorStyle,
      theme,
      session: runtime.sessionId,
      cols: runtime.terminal.cols,
    };
  }, id);
}

test("settings update visible and hidden terminals without restarting PTYs and survive reload", async ({
  page,
  context,
}, testInfo) => {
  await mockDesktop(page, false);
  await page.goto("/");
  await expect(page.locator(".terminal-host")).toHaveCSS("opacity", "1");
  const first = (await page
    .locator("[data-pane-id]")
    .getAttribute("data-pane-id"))!;
  const before = (await options(page, first))!;
  await page.keyboard.press("Control+Shift+t");
  await expect(page.getByRole("tab")).toHaveCount(2);
  const second = (await page
    .locator("[data-pane-id]")
    .getAttribute("data-pane-id"))!;
  const settings = await context.newPage();
  await settingsPage(settings);
  await field(settings, "Font family", "monospace");
  await field(settings, "Font size", "22");
  await field(settings, "Line height", "1.35");
  await settings
    .getByLabel("Cursor style", { exact: true })
    .selectOption("block");
  await expect(
    settings.getByLabel("Cursor style", { exact: true }),
  ).toBeEnabled();
  await field(settings, "Background", "#102030");
  await field(settings, "Text", "#f0e0d0");
  await settings
    .getByText("ANSI palette and search colors", { exact: true })
    .click();
  await field(settings, "Red", "#ff1234");
  await settings.getByText("Advanced", { exact: true }).click();
  await field(settings, "Scrollback lines", "12000");
  for (const id of [first, second]) {
    await expect
      .poll(() => options(page, id))
      .toMatchObject({
        fontSize: 22,
        fontFamily: "monospace",
        cursorStyle: "block",
        scrollback: 12000,
        theme: {
          background: "#10203000",
          foreground: "#f0e0d0ff",
          red: "#ff1234ff",
        },
      });
  }
  expect((await options(page, first))!.session).toBe(before.session);
  await page.evaluate(
    (session) =>
      (window as any).__nativeTest.emit(
        session,
        "\r\nOutput after settings change\r\n",
      ),
    before.session,
  );
  await expect
    .poll(() => buffer(page, first))
    .toContain("Output after settings change");
  await page.getByRole("tab", { name: "Terminal", exact: true }).click();
  await expect(page.locator(".terminal-host")).toHaveCSS("opacity", "1");
  await expect(page.locator(".terminal-pane")).toHaveCSS(
    "background-color",
    "rgb(16, 32, 48)",
  );
  expect((await options(page, first))!.cols).toBeLessThan(before.cols);
  expect(
    await page.evaluate(
      () =>
        (window as any).__nativeTest.calls.filter(
          (call: any) => call.command === "start_terminal",
        ).length,
    ),
  ).toBe(2);
  await page.bringToFront();
  await page.locator(".xterm-helper-textarea").focus();
  await expect(page.locator(".xterm-helper-textarea")).toBeFocused();
  await page.keyboard.type("still typing");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__nativeTest.calls
          .filter((call: any) => call.command === "write_terminal")
          .map((call: any) => call.args.data)
          .join(""),
      ),
    )
    .toBe("still typing");
  expect(
    await settings.evaluate(
      () =>
        (window as any).__nativeTest.calls.filter(
          (call: any) => call.command === "start_terminal",
        ).length,
    ),
  ).toBe(0);
  await settings.reload();
  await expect(settings.getByLabel("Font size", { exact: true })).toHaveValue(
    "22",
  );
  await page.reload();
  await expect
    .poll(() => options(page, first))
    .toMatchObject({ fontSize: 22, scrollback: 12000 });
  await settings.setViewportSize({ width: 920, height: 680 });
  await settings.screenshot({
    path: testInfo.outputPath("terminal-settings.png"),
  });
  await settings.setViewportSize({ width: 560, height: 420 });
  expect(
    await settings.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await settings.screenshot({
    path: testInfo.outputPath("terminal-settings-small.png"),
  });
});

test("appearance overrides survive theme changes and resetting follows the active theme", async ({
  page,
  context,
}) => {
  await settingsPage(page);
  await field(page, "Font size", "20");
  await page
    .getByText("ANSI palette and search colors", { exact: true })
    .click();
  await field(page, "Red", "#ff1234");
  const main = await context.newPage();
  await mockDesktop(main, false);
  await main.goto("/");
  await expect(main.locator(".terminal-host")).toHaveCSS("opacity", "1");
  const id = (await main
    .locator("[data-pane-id]")
    .getAttribute("data-pane-id"))!;
  for (const target of [page, main])
    await target.evaluate(async () => {
      const { prepareTheme } = await import("/src/theme-runtime.ts");
      const prepared = await prepareTheme(
        {
          id: "test",
          manifest: {
            version: 1,
            name: "Test",
            terminal: { fontSize: 17, colors: { red: "#aabbcc" } },
          },
        },
        { version: 1, active: "test", appearance: "dark" },
      );
      prepared.commit();
    });
  await expect
    .poll(() => options(main, id))
    .toMatchObject({ fontSize: 20, theme: { red: "#ff1234ff" } });
  await page
    .getByRole("button", { name: "Reset Font size", exact: true })
    .click();
  await expect(page.getByLabel("Font size", { exact: true })).toHaveValue("17");
  await expect
    .poll(() => options(main, id))
    .toMatchObject({ fontSize: 17, theme: { red: "#ff1234ff" } });
  await page
    .getByRole("button", { name: "Reset defaults", exact: true })
    .click();
  await expect
    .poll(() => options(main, id))
    .toMatchObject({ fontSize: 17, theme: { red: "#aabbccff" } });
});

test("failed saves retain working preferences and corrupt files require explicit recovery", async ({
  page,
}) => {
  await settingsPage(page);
  await field(page, "Font size", "19");
  await page.evaluate(() => {
    (window as any).__nativeTest.failTerminalPreferencesSave = true;
  });
  await page.getByLabel("Font size", { exact: true }).fill("23");
  await page.getByLabel("Font size", { exact: true }).press("Enter");
  await expect(page.getByRole("alert")).toContainText("Disk is full");
  await expect(page.getByLabel("Font size", { exact: true })).toHaveValue("19");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("test-terminal-preferences")!)
          .appearance.fontSize,
    ),
  ).toBe(19);
  await page.evaluate(() => {
    (window as any).__nativeTest.failTerminalPreferencesSave = false;
    localStorage.setItem(
      "test-terminal-preferences",
      '{"version":99,"future":"preserve"}',
    );
    return (window as any).__nativeTest.emitEvent(
      "terminal-preferences-changed",
    );
  });
  await expect(page.getByRole("alert")).toContainText("left intact");
  await expect(page.getByLabel("Font size", { exact: true })).toBeDisabled();
  await page
    .getByRole("button", { name: "Retry loading", exact: true })
    .click();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("test-terminal-preferences"),
    ),
  ).toBe('{"version":99,"future":"preserve"}');
  await page
    .getByRole("button", { name: "Reset defaults", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("Font size", { exact: true })).toHaveValue("13");
});
