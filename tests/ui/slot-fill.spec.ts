import { test, expect } from "@playwright/test";
import { mockDesktop } from "./desktop";
test("react-slot-fill supports React 19 context, StrictMode, changes and removal", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto("/");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(async () => {
    const element = document.createElement("div");
    element.id = "slot-proof";
    element.style.cssText =
      "position:fixed;inset:100px;z-index:10000;background:var(--color-background)";
    document.body.append(element);
    const fixture = await import("/tests/ui/fixtures/slot-fill.tsx");
    fixture.mount(element);
  });
  const fixture = page.locator("#slot-proof");
  await fixture.getByRole("button", { name: "shared context 0" }).click();
  await expect(fixture.getByRole("region", { name: "left" })).toContainText(
    "shared context 1",
  );
  await fixture.getByRole("button", { name: "Move fill" }).click();
  await expect(fixture.getByRole("region", { name: "left" })).toBeEmpty();
  await expect(fixture.getByRole("region", { name: "right" })).toContainText(
    "shared context",
  );
  await fixture.getByRole("button", { name: "Toggle fill" }).click();
  await expect(fixture.getByRole("region", { name: "right" })).toBeEmpty();
  await fixture.getByRole("button", { name: "Toggle fill" }).click();
  await expect(
    fixture.getByRole("button", { name: "shared context 0" }),
  ).toHaveCount(1);
  expect(errors).toEqual([]);
});
