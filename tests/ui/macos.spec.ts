import { expect, test } from "@playwright/test";
import { mockDesktop } from "./desktop";

test("hidden settings cancel shortcut recording before being reused", async ({
  page,
}) => {
  await mockDesktop(page, true, undefined, undefined, {}, "macos");
  await page.goto("/?window=settings");
  const recorder = page.getByRole("button", {
    name: "Shortcut for New terminal",
    exact: true,
  });
  await recorder.click();
  await expect(recorder).toContainText("Press keys…");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(recorder).not.toContainText("Press keys…");
  await page.keyboard.press("Meta+w");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__nativeTest.calls.some(
          (call: any) => call.command === "plugin:window|close",
        ),
      ),
    )
    .toBe(true);
});

test("Cmd+W closes macOS settings while shortcut recording keeps the key", async ({
  page,
}) => {
  await mockDesktop(page, true, undefined, undefined, {}, "macos");
  await page.goto("/?window=settings");
  const closed = () =>
    page.evaluate(
      () =>
        (window as any).__nativeTest.calls.filter(
          (call: any) => call.command === "plugin:window|close",
        ).length,
    );
  const recorder = page.getByRole("button", {
    name: "Shortcut for New terminal",
    exact: true,
  });
  await recorder.click();
  await recorder.press("Meta+w");
  await expect(page.getByRole("alert")).toContainText("already assigned");
  expect(await closed()).toBe(0);
  await recorder.press("Escape");
  await page.keyboard.press("Meta+w");
  await expect.poll(closed).toBe(1);
});

for (const settings of [false, true]) {
  test(`macOS ${settings ? "settings" : "workspace"} reclaims native-control space in fullscreen and restores it on exit`, async ({
    page,
  }, testInfo) => {
    await mockDesktop(page, true, undefined, undefined, {}, "macos");
    await page.addInitScript(() => {
      (window as any).__nativeTest.fullscreen = true;
    });
    await page.goto(settings ? "/?window=settings" : "/");
    const titlebar = page.locator(".titlebar");
    await expect(titlebar).toHaveCSS("padding-left", "8px");
    const setFullscreen = (fullscreen: boolean) =>
      page.evaluate(async (fullscreen) => {
        const desktop = (window as any).__nativeTest;
        desktop.fullscreen = fullscreen;
        await desktop.emitEvent("tauri://resize", {
          width: innerWidth,
          height: innerHeight,
        });
      }, fullscreen);
    await setFullscreen(false);
    await expect(titlebar).toHaveCSS("padding-left", "88px");
    await page.keyboard.press("Meta+Minus");
    await page.keyboard.press("Meta+Minus");
    await expect(titlebar).toHaveCSS("padding-left", "110px");
    await expect(titlebar).toHaveCSS("min-height", "55px");
    await setFullscreen(true);
    await expect(titlebar).toHaveCSS("padding-left", "8px");
    await expect(titlebar).toHaveCSS("height", "44px");
    const content = await titlebar
      .locator(":scope > :first-child")
      .boundingBox();
    expect(content!.x).toBeLessThan(20);
    await page.screenshot({
      path: testInfo.outputPath("macos-fullscreen.png"),
    });
    await setFullscreen(false);
    await expect(titlebar).toHaveCSS("padding-left", "110px");
    await expect(titlebar).toHaveCSS("min-height", "55px");
  });

  test(`macOS ${settings ? "settings" : "workspace"} leaves room for native controls at minimum size`, async ({
    page,
  }, testInfo) => {
    await mockDesktop(page, true, undefined, undefined, {}, "macos");
    await page.setViewportSize({ width: settings ? 560 : 800, height: 420 });
    await page.goto(settings ? "/?window=settings" : "/");
    await expect(page.locator(".titlebar")).toBeVisible();
    await expect(page.locator(".window-controls")).toHaveCount(0);
    await expect(page.locator(".titlebar")).toHaveCSS("padding-left", "88px");
    const content = await page
      .locator(".titlebar > :first-child")
      .boundingBox();
    expect(content!.x).toBeGreaterThanOrEqual(88);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(settings ? 560 : 800);
    await page.screenshot({ path: testInfo.outputPath("macos-minimum.png") });
  });
}

test("macOS panel shortcuts preserve PTYs and leave Control keys available to the shell", async ({
  page,
}) => {
  await mockDesktop(page, true, undefined, undefined, {}, "macos");
  await page.goto("/");
  await expect(page.locator(".xterm-screen")).toBeVisible();
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.press("Meta+d");
  await expect(page.locator(".terminal-pane")).toHaveCount(2);
  await page.keyboard.press("Meta+w");
  await expect(page.locator(".terminal-pane")).toHaveCount(1);
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+d");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__nativeTest.calls
          .filter((call: any) => call.command === "write_terminal")
          .map((call: any) => call.args.data)
          .join(""),
      ),
    )
    .toContain("\x03\x04");
  expect(
    await page.evaluate(() =>
      (window as any).__nativeTest.calls.some(
        (call: any) => call.command === "plugin:window|destroy",
      ),
    ),
  ).toBe(false);
  await page.keyboard.press("Control+Tab");
  await expect(page.locator(".terminal-overview")).toBeVisible();
  await page.keyboard.press("Control+Tab");
  await expect(page.locator(".xterm-screen")).toBeVisible();
});

test("macOS native close requests retain dirty editors on cancellation and save failure", async ({
  page,
}) => {
  await mockDesktop(page, true, undefined, undefined, {}, "macos");
  await page.goto("/");
  await page.getByRole("button", { name: "README.md", exact: true }).click();
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Meta+a");
  await page.keyboard.insertText("Unsaved on macOS — Zażółć 🦀");
  const requestClose = () =>
    page.evaluate(() => {
      void (window as any).__nativeTest.emitEvent("tauri://close-requested");
    });
  const dialog = page.getByRole("dialog", {
    name: "Save changes before closing?",
  });
  await requestClose();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate(() => {
    (window as any).__nativeTest.failFileSave = true;
  });
  await requestClose();
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(dialog).toContainText("Disk is full");
  await expect(page.locator(".cm-content")).toContainText("Zażółć 🦀");
  expect(
    await page.evaluate(() =>
      (window as any).__nativeTest.calls.some(
        (call: any) => call.command === "plugin:window|destroy",
      ),
    ),
  ).toBe(false);
  await page.evaluate(() => {
    (window as any).__nativeTest.failFileSave = false;
  });
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__nativeTest.calls.some(
          (call: any) => call.command === "plugin:window|destroy",
        ),
      ),
    )
    .toBe(true);
});
