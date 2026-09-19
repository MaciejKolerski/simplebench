import { expect, test } from "@playwright/test";
import { mockDesktop } from "./desktop";
import { mockChats } from "./chat-mock";

test.beforeEach(async ({ page }) => {
  await mockDesktop(page, false);
  await mockChats(page);
  await page.goto("/?window=settings&page=chat-ai");
  await expect(
    page.getByRole("region", { name: "OpenAI configuration" }),
  ).toBeVisible();
});

test("provider presets connect with the right service and keep entered keys private", async ({
  page,
}) => {
  const providers = page.getByRole("navigation", { name: "AI providers" });
  await providers.getByRole("button", { name: /NVIDIA Build/ }).click();
  await expect(
    page.getByRole("region", { name: "NVIDIA Build configuration" }),
  ).toContainText("https://integrate.api.nvidia.com/v1");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("combobox", { name: "Provider", exact: true }),
  ).toHaveValue("nvidia");
  const key = dialog.getByLabel("API key", { exact: true });
  await key.fill("fixture-key");
  await expect(key).toHaveAttribute("type", "password");
  await dialog.getByRole("button", { name: "Show key" }).click();
  await expect(key).toHaveAttribute("type", "text");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(key).toHaveValue("");
  await expect(key).toHaveAttribute("type", "password");
  await key.fill("fixture-key");
  await dialog.getByRole("button", { name: "Save connection" }).click();
  await expect(
    providers.getByRole("button", { name: /NVIDIA Build/ }),
  ).toContainText("Key saved");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(dialog.getByLabel(/Replacement API key/)).toHaveValue("");
  expect(
    await page.evaluate(() => localStorage.getItem("chat-preferences")),
  ).not.toContain("fixture-key");
});

test("models can be added, refreshed, searched and used as defaults without a paid test", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add model", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add model" });
  await dialog.getByLabel("Model ID").fill("custom/model");
  await dialog.getByRole("button", { name: "Add model", exact: true }).click();
  await page
    .getByRole("button", { name: "Use custom/model by default" })
    .click();
  await expect(
    page.getByRole("button", { name: "custom/model is the default model" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).__chatTest.connectionActions),
  ).toEqual([]);
  await page.getByRole("button", { name: "Refresh models" }).click();
  await page.getByRole("searchbox", { name: "Search models" }).fill("custom");
  await expect(
    page.getByRole("list", { name: "Provider models" }).getByRole("listitem"),
  ).toHaveCount(1);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "custom/model is the default model" }),
  ).toBeVisible();
  await page.getByRole("switch", { name: "Enable Fixture" }).uncheck();
  await expect(
    page.getByRole("button", { name: "Refresh models" }),
  ).toBeDisabled();
  await page.getByRole("switch", { name: "Enable Fixture" }).check();
  await page.evaluate(() => {
    (window as any).__chatTest.failConnectionAction = true;
  });
  await page.getByRole("button", { name: "Refresh models" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Could not refresh models",
  );
  await expect(
    page.getByRole("button", { name: "custom/model is the default model" }),
  ).toBeVisible();
});

test("unsaved chat defaults are not persisted by a connection action", async ({
  page,
}) => {
  await page.getByText("Chat preferences", { exact: false }).first().click();
  await page
    .getByRole("textbox", { name: "System instructions" })
    .fill("Unfinished draft");
  await page.getByRole("switch", { name: "Enable Fixture" }).uncheck();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("chat-preferences")!),
  );
  expect(saved.defaults.system).toBe("");
  await expect(
    page.getByRole("textbox", { name: "System instructions" }),
  ).toHaveValue("Unfinished draft");
  await page.getByRole("button", { name: "Save defaults" }).click();
  await expect(page.getByRole("alert")).toContainText("conflict");
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(
    page.getByRole("textbox", { name: "System instructions" }),
  ).toHaveValue("");
});

test("provider settings fit dark, light, narrow and zoomed windows", async ({
  page,
}, info) => {
  for (const colorScheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.screenshot({
      path: info.outputPath(`settings-${colorScheme}.png`),
    });
  }
  for (const [width, height, zoom] of [
    [800, 600, 1],
    [640, 360, 1],
    [800, 600, 2],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate((zoom) => {
      document.documentElement.style.zoom = String(zoom);
    }, zoom);
    const panel = page.locator(".chat-settings");
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    await page
      .getByRole("button", { name: "Add model", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "Add model", exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: info.outputPath(`settings-${width}-${zoom}.png`),
    });
  }
});
