import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { buffer, mockDesktop } from "./desktop";

const theme = {
  version: 1,
  name: "Graphite Glass",
  author: "Test author",
  description: "A local image and softer corners.",
  appearance: "dark",
  tokens: {
    "--color-background": "#161616",
    "--radius-control": "12px",
    "--terminal-padding": "16px",
  },
  terminal: {
    fontSize: 17,
    cursorStyle: "underline",
    cursorBlink: false,
    colors: { foreground: "#e0e0e0", background: "#101010cc", blue: "#7a8fa6" },
  },
  backgrounds: {
    terminal: {
      image: "images/wall paper.svg",
      opacity: 0.4,
      overlay: "#10101080",
    },
  },
  styles: { ".statusbar": { height: "34px" } },
  stylesheets: ["styles/base.css", "styles/components.css"],
};

async function install(page: Page) {
  await mockDesktop(page);
  await page.addInitScript((theme) => {
    if (!localStorage.getItem("test-theme-manifests"))
      localStorage.setItem(
        "test-theme-manifests",
        JSON.stringify({ glass: theme }),
      );
  }, theme);
  await page.route("**/theme-assets/**", async (route) => {
    if (route.request().url().endsWith("/styles/base.css")) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({
        contentType: "text/css",
        body: '@import "parts/controls.css"; .settings-page-heading h1 { letter-spacing: 1px; } .tab { border-radius: 8px; } :root { --terminal-letter-spacing: 2px; }',
      });
    } else if (route.request().url().endsWith("/styles/parts/controls.css")) {
      await route.fulfill({
        contentType: "text/css",
        body: '@media (min-width: 500px) { .theme-library { background-image: url("../../images/wall%20paper.svg"); } }',
      });
    } else if (route.request().url().endsWith(".css"))
      await route.fulfill({
        contentType: "text/css",
        body: ".settings-page-heading h1 { letter-spacing: 3px; } .tab { border-radius: 14px; } :root { --terminal-letter-spacing: 1px; --terminal-font-family: ThemeFace, monospace; }",
      });
    else
      await route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#303030"/><circle cx="500" cy="300" r="200" fill="#6e6e6e"/></svg>',
      });
  });
}
async function settings(page: Page) {
  await page.goto("/?window=settings");
  await page.getByRole("button", { name: "Themes", exact: true }).click();
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
async function terminal(page: Page, pane: string) {
  return page.evaluate(async (pane) => {
    const { runningTerminal } = await import("/src/terminal-runtime.ts");
    const runtime = runningTerminal(pane)!;
    return {
      id: runtime.sessionId,
      fontSize: runtime.terminal.options.fontSize,
      fontFamily: runtime.terminal.options.fontFamily,
      letterSpacing: runtime.terminal.options.letterSpacing,
      theme: runtime.terminal.options.theme,
      cursor: runtime.terminal.options.cursorStyle,
      blink: runtime.terminal.options.cursorBlink,
      renderer: runtime.getSnapshot().renderer,
    };
  }, pane);
}

test("a theme updates both windows and hidden terminals without replacing PTYs", async ({
  page,
  context,
}, testInfo) => {
  await install(page);
  await page.goto("/");
  await expect(page.locator(".xterm-screen")).toBeVisible();
  const first = (await page
    .locator("[data-pane-id]")
    .getAttribute("data-pane-id"))!;
  const before = await terminal(page, first);
  await page.evaluate(
    (id) => (window as any).__nativeTest.emit(id, "\r\noutput to preserve\r\n"),
    before.id,
  );
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.press("Control+Shift+t");
  const second = (await page
    .locator("[data-pane-id]")
    .getAttribute("data-pane-id"))!;
  expect(second).not.toBe(first);
  const preferences = await context.newPage();
  await install(preferences);
  await settings(preferences);
  await preferences
    .getByRole("button", { name: "Use Graphite Glass theme" })
    .click();
  await expect(
    preferences.getByRole("button", { name: "Use Graphite Glass theme" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () => (await terminal(page, first)).fontSize)
    .toBe(17);
  await expect
    .poll(async () => (await terminal(page, second)).fontSize)
    .toBe(17);
  expect((await terminal(page, first)).id).toBe(before.id);
  expect(await buffer(page, first)).toContain("output to preserve");
  expect((await calls(page, "start_terminal")).length).toBe(2);
  expect(await calls(page, "close_terminal")).toHaveLength(0);
  expect((await terminal(page, second)).theme?.background).toBe("#10101000");
  expect((await terminal(page, second)).cursor).toBe("underline");
  expect((await terminal(page, second)).fontFamily).toContain("ThemeFace");
  expect((await terminal(page, second)).letterSpacing).toBe(1);
  expect((await terminal(page, second)).blink).toBe(false);
  await expect(page.locator(".statusbar")).toHaveCSS("height", "34px");
  await expect(page.locator(".tab").first()).toHaveCSS("border-radius", "14px");
  await expect(preferences.locator("h1")).toHaveCSS("letter-spacing", "3px");
  expect(
    await page
      .locator(".terminal-pane")
      .evaluate((node) => getComputedStyle(node, "::before").backgroundImage),
  ).toContain("wall%20paper.svg");
  await page.screenshot({ path: testInfo.outputPath("theme-terminal.png") });
  await preferences.screenshot({ path: testInfo.outputPath("themes.png") });
  await preferences.evaluate(() => {
    const manifests = JSON.parse(localStorage.getItem("test-theme-manifests")!);
    manifests.glass.stylesheets = [];
    localStorage.setItem("test-theme-manifests", JSON.stringify(manifests));
  });
  await preferences
    .getByRole("button", { name: "Refresh", exact: true })
    .click();
  await expect(page.locator(".tab").first()).toHaveCSS("border-radius", "6px");
  await expect(page.locator(".statusbar")).toHaveCSS("height", "34px");
  await expect
    .poll(async () => (await terminal(page, second)).letterSpacing)
    .toBe(0);
  await expect(preferences.locator('link[data-theme-layer="css"]')).toHaveCount(
    0,
  );
  await preferences.evaluate(() => {
    const manifests = JSON.parse(localStorage.getItem("test-theme-manifests")!);
    manifests.glass.stylesheets = ["styles/components.css", "styles/base.css"];
    localStorage.setItem("test-theme-manifests", JSON.stringify(manifests));
  });
  await preferences
    .getByRole("button", { name: "Refresh", exact: true })
    .click();
  await expect(page.locator(".tab").first()).toHaveCSS("border-radius", "8px");
  await expect
    .poll(async () => (await terminal(page, second)).letterSpacing)
    .toBe(2);
  await preferences.reload();
  await preferences
    .getByRole("button", { name: "Themes", exact: true })
    .click();
  await expect(preferences.locator("h1")).toHaveCSS("letter-spacing", "1px");
  await expect(preferences.locator('link[data-theme-layer="css"]')).toHaveCount(
    2,
  );
  expect(
    await preferences
      .locator(".theme-library")
      .evaluate((node) => getComputedStyle(node).backgroundImage),
  ).toContain("/images/wall%20paper.svg");
  await preferences.getByRole("button", { name: "Restore DeepMono" }).click();
  await expect
    .poll(async () => (await terminal(page, first)).fontSize)
    .toBe(13);
  await expect(page.locator(".statusbar")).toHaveCSS("height", "28px");
  await expect(page.locator('link[data-theme-layer="css"]')).toHaveCount(0);
  expect(
    await page
      .locator(".terminal-pane")
      .evaluate((node) => getComputedStyle(node, "::before").backgroundImage),
  ).not.toContain("wall%20paper.svg");
  expect((await calls(page, "start_terminal")).length).toBe(2);
});

test("invalid edits and failed saves preserve the previous theme, and reset recovers saved settings", async ({
  page,
}) => {
  await install(page);
  await settings(page);
  await page.getByRole("button", { name: "Use Graphite Glass theme" }).click();
  await expect(page.locator("h1")).toHaveCSS("letter-spacing", "3px");
  await page.evaluate(() => {
    const manifests = JSON.parse(localStorage.getItem("test-theme-manifests")!);
    manifests.glass.terminal.fontSize = 0;
    localStorage.setItem("test-theme-manifests", JSON.stringify(manifests));
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("fontSize");
  await expect(page.locator("h1")).toHaveCSS("letter-spacing", "3px");
  expect(
    JSON.parse(
      (await page.evaluate(() => localStorage.getItem("test-theme-settings")))!,
    ).active,
  ).toBe("glass");
  await page.evaluate(() => {
    (window as any).__nativeTest.failThemeSave = true;
  });
  await page.getByRole("button", { name: "Restore DeepMono" }).click();
  await expect(page.getByRole("alert")).toContainText("Disk is full");
  await expect(page.locator("h1")).toHaveCSS("letter-spacing", "3px");
  await page.evaluate(() => {
    (window as any).__nativeTest.failThemeSave = false;
    localStorage.setItem(
      "test-theme-settings",
      '{"version":99,"active":"future","customCss":true}',
    );
  });
  await page.reload();
  await page.getByRole("button", { name: "Themes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("left intact");
  expect(await calls(page, "save_theme_preferences")).toHaveLength(0);
  await page.getByRole("button", { name: "Restore DeepMono" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(
    JSON.parse(
      (await page.evaluate(() => localStorage.getItem("test-theme-settings")))!,
    ).active,
  ).toBeNull();
});

test("folder controls import themes without selecting them and fit the minimum window", async ({
  page,
}, testInfo) => {
  await install(page);
  await settings(page);
  await page.getByRole("button", { name: "Open folder", exact: true }).click();
  expect((await calls(page, "open_themes_folder"))[0].args.id).toBeNull();
  await page
    .getByRole("button", { name: "Import folder", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Use Imported theme theme" }),
  ).toBeVisible();
  expect(await calls(page, "save_theme_preferences")).toHaveLength(0);
  await page.getByRole("button", { name: "Use Imported theme theme" }).click();
  await expect(
    page.getByRole("button", { name: "Open folder", exact: true }),
  ).toHaveCSS("border-radius", "12px");
  await page.setViewportSize({ width: 560, height: 420 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page
      .locator(".themes-page")
      .evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await expect(page.getByLabel("Use theme CSS")).toHaveCount(0);
  await expect(page.getByText("Creating a theme", { exact: true })).toHaveCount(
    0,
  );
  await page.screenshot({ path: testInfo.outputPath("themes-minimum.png") });
  expect(await calls(page, "start_terminal")).toHaveLength(0);
});

test("a missing stylesheet or undecodable image cannot replace a working theme", async ({
  page,
}) => {
  await install(page);
  await settings(page);
  await page.route("**/theme-assets/**/styles/components.css", (route) =>
    route.abort(),
  );
  await page.getByRole("button", { name: "Use Graphite Glass theme" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Cannot load styles/components.css",
  );
  expect(await calls(page, "save_theme_preferences")).toHaveLength(0);
  await expect(page.locator('link[href*="theme-assets"]')).toHaveCount(0);
  await page.unroute("**/theme-assets/**/styles/components.css");
  await page.route("**/theme-assets/**/*.svg", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: "broken image" }),
  );
  await page.getByRole("button", { name: "Use Graphite Glass theme" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Cannot decode background",
  );
  expect(await calls(page, "save_theme_preferences")).toHaveLength(0);
  await expect(
    page.getByRole("button", { name: "Use DeepMono theme" }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("JSON style validation rejects malformed declarations before saving", async ({
  page,
}) => {
  await install(page);
  await settings(page);
  const result = await page.evaluate(async () => {
    const { compileTheme } = await import("/src/theme-runtime.ts");
    const attempt = (styles: Record<string, Record<string, string>>) => {
      try {
        return {
          css: compileTheme(
            { version: 1, name: "Style test", styles },
            () => "",
          ),
          error: "",
        };
      } catch (error) {
        return { css: "", error: String(error) };
      }
    };
    return {
      invalid: attempt({ ".tab": { "border-radius": "not-a-radius" } }),
      injection: attempt({ ".tab {} body": { display: "none" } }),
      supported: attempt({
        ".tab:hover, .button:focus-visible": {
          "border-radius": "12px !important",
        },
      }),
    };
  });
  expect(result.invalid.error).toContain("Invalid CSS value");
  expect(result.injection.error).toContain("Invalid CSS selector");
  expect(result.supported.error).toBe("");
  expect(result.supported.css).toContain("12px !important");
  expect(await calls(page, "save_theme_preferences")).toHaveLength(0);
});

test("legacy CSS preferences cannot disable a stylesheet declared by JSON", async ({
  page,
}) => {
  await install(page);
  const saved =
    '{"version":1,"active":"legacy","customCss":false,"appearance":"light"}';
  await page.addInitScript(
    ({ saved }) => {
      if (!localStorage.getItem("test-theme-settings")) {
        localStorage.setItem("test-theme-settings", saved);
        localStorage.setItem(
          "test-theme-manifests",
          JSON.stringify({
            legacy: { version: 1, name: "Legacy", stylesheet: "theme.css" },
          }),
        );
      }
    },
    { saved },
  );
  await settings(page);
  await expect(page.locator("h1")).toHaveCSS("letter-spacing", "3px");
  await expect(page.locator("html")).toHaveAttribute(
    "data-appearance",
    "light",
  );
  expect(await calls(page, "save_theme_preferences")).toHaveLength(0);
  expect(
    await page.evaluate(() => localStorage.getItem("test-theme-settings")),
  ).toBe(saved);
  await page.getByRole("button", { name: "Restore DeepMono" }).click();
  await expect(page.locator('link[data-theme-layer="css"]')).toHaveCount(0);
  expect(
    JSON.parse(
      (await page.evaluate(() => localStorage.getItem("test-theme-settings")))!,
    ),
  ).toEqual({ version: 1, active: null, appearance: "light" });
});
