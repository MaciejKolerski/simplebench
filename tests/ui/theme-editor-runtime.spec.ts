import { test, expect } from "@playwright/test";
import { mockDesktop } from "./desktop";
import { newSession, newProject, openFileTab } from "../../src/model";
test("theme application completes when a hidden native view suspends animation frames", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto("/");
  await expect(page.locator(".terminal-host")).toHaveCSS("opacity", "1");
  const result = await page.evaluate(async () => {
    const runtime = await import("/src/theme/runtime.ts");
    const frame = window.requestAnimationFrame;
    window.requestAnimationFrame = () => 0;
    try {
      const theme = await runtime.prepareTheme(
        {
          id: "hidden",
          directory: "/themes/hidden",
          revision: "new",
          raw: JSON.stringify({
            version: 2,
            name: "Hidden",
            appearance: "dark",
            common: { tokens: { "--radius-control": "13px" } },
          }),
        },
        { version: 1, active: "hidden", appearance: "dark" },
        undefined,
        41,
      );
      await theme.commit();
      return {
        revision: runtime.effectiveTheme().sourceRevision,
        radius: getComputedStyle(document.documentElement)
          .getPropertyValue("--radius-control")
          .trim(),
      };
    } finally {
      window.requestAnimationFrame = frame;
    }
  });
  expect(result).toEqual({ revision: 41, radius: "13px" });
});

test("final CSS tokens update hidden editor syntax and live xterm without losing history", async ({
  page,
  context,
}) => {
  const project = newProject("/project", "local:bash");
  const session = openFileTab(
    { ...newSession(), projects: [project], activeProjectId: project.id },
    project.workspaces[0].id,
    "/project",
    "source.ts",
  );
  await mockDesktop(page, false, session, undefined, {
    "/project/source.ts": {
      content: "const value = 1;",
      revision: "initial",
      encoding: "utf8",
      readOnly: false,
    },
  });
  const theme = {
    version: 2,
    name: "Syntax",
    appearance: "dark",
    common: {
      editor: { syntax: { keyword: { color: "#112233" } } },
      terminal: { colors: { blue: "#112233" } },
    },
    resources: { stylesheets: ["theme.css"] },
  };
  await page.addInitScript(
    (theme) =>
      localStorage.setItem(
        "test-theme-manifests",
        JSON.stringify({ syntax: theme }),
      ),
    theme,
  );
  const settings = await context.newPage();
  await mockDesktop(settings);
  for (const view of [page, settings])
    await view.route("**/theme-assets/**/theme.css", (route) =>
      route.fulfill({
        contentType: "text/css",
        body: ":root { --syntax-keyword-color: #876543; --terminal-blue: #abcdef; --editor-font-size: 15px; }",
      }),
    );
  await page.goto("/");
  const content = page.locator(".file-editor .cm-content");
  await expect(content).toHaveText("const value = 1;");
  await content.fill("const value = 99;");
  await page.getByRole("tab", { name: "Terminal", exact: true }).click();
  await expect(page.locator(".terminal-host")).toHaveCSS("opacity", "1");
  const before = await page.evaluate(() =>
    (window as any).__nativeTest.calls
      .filter((c: any) => c.command === "start_terminal")
      .map((c: any) => c.args.request.id),
  );
  await settings.goto("/?window=settings&page=themes");
  await settings.getByRole("button", { name: "Use Syntax theme" }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { effectiveTheme } = await import("/src/theme/runtime.ts");
        return effectiveTheme().terminal.theme?.blue;
      }),
    )
    .toBe("#abcdefff");
  await page.getByRole("tab", { name: /source.ts/ }).click();
  await expect(content).toHaveText("const value = 99;");
  await expect(content.getByText("const", { exact: true })).toHaveCSS(
    "color",
    "rgb(135, 101, 67)",
  );
  await expect(page.locator(".file-editor .cm-scroller")).toHaveCSS(
    "font-size",
    "15px",
  );
  await content.press("Control+z");
  await expect(content).toHaveText("const value = 1;");
  await content.press("Control+Shift+z");
  await expect(content).toHaveText("const value = 99;");
  expect(
    await page.evaluate(() =>
      (window as any).__nativeTest.calls
        .filter((c: any) => c.command === "start_terminal")
        .map((c: any) => c.args.request.id),
    ),
  ).toEqual(before);
  expect(
    await page.evaluate(() =>
      (window as any).__nativeTest.calls.filter(
        (c: any) => c.command === "close_terminal",
      ),
    ),
  ).toHaveLength(0);
});
