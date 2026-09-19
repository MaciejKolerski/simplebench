import { expect, test, type Page } from "@playwright/test";
import { mockDesktop } from "./desktop";
import { mockAndroid } from "./android-mock";
import {
  newAndroidTab,
  newProject,
  newSession,
  newWorkspace,
  type TerminalTab,
} from "../../src/model";

async function openAndroid(page: Page) {
  await page.getByRole("button", { name: /^New tab/ }).click();
  await page
    .getByRole("menuitem", { name: "New android symulator", exact: true })
    .click();
}

test("modern phone zoom stays bounded, preserves position and maps input to guest pixels", async ({
  page,
}) => {
  await mockDesktop(page, false);
  await mockAndroid(page, true);
  await page.addInitScript(() => {
    (window as any).__androidTest.display = [1344, 2992];
  });
  await page.goto("/");
  await openAndroid(page);
  const zoom = page.getByRole("combobox", { name: "Screen zoom" });
  await expect(page.locator(".android-screen")).toBeVisible();
  await zoom.click();
  await page.getByRole("option", { name: "300%", exact: true }).click();
  await expect(zoom).toHaveText("300%");
  const point = await page.locator(".android-screen").evaluate((canvas) => {
    const host = canvas.parentElement!;
    host.scrollTop = 300;
    host.scrollLeft = 100;
    const bounds = canvas.getBoundingClientRect(),
      box = host.getBoundingClientRect();
    const x = box.left + box.width / 2,
      y = box.top + box.height / 2;
    return {
      x,
      y,
      guestX: Math.floor(((x - bounds.left) / bounds.width) * 1344),
      guestY: Math.floor(((y - bounds.top) / bounds.height) * 2992),
    };
  });
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__androidTest.input.filter(
            (e: any) => e.type === "touch",
          ).length,
      ),
    )
    .toBe(2);
  const input = await page.evaluate(() =>
    (window as any).__androidTest.input.filter((e: any) => e.type === "touch"),
  );
  expect(Math.abs(input[0].x - point.guestX)).toBeLessThanOrEqual(2);
  expect(Math.abs(input[0].y - point.guestY)).toBeLessThanOrEqual(2);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(point.x - 40, point.y - 50);
  await page.mouse.up({ button: "middle" });
  expect(
    await page.evaluate(
      () =>
        (window as any).__androidTest.input.filter(
          (e: any) => e.type === "touch",
        ).length,
    ),
  ).toBe(2);
  const position = await page
    .locator(".android-viewport")
    .evaluate((host) => ({ left: host.scrollLeft, top: host.scrollTop }));
  await page.getByRole("tab", { name: "Terminal", exact: true }).click();
  await page.getByRole("tab", { name: "Test phone", exact: true }).click();
  await expect(zoom).toHaveText("300%");
  await expect
    .poll(() =>
      page
        .locator(".android-viewport")
        .evaluate((host) => ({ left: host.scrollLeft, top: host.scrollTop })),
    )
    .toEqual(position);
  await page.getByRole("textbox", { name: "Android phone input" }).focus();
  await page.locator(".android-viewport").dispatchEvent("wheel", {
    deltaY: 80,
    ctrlKey: true,
    clientX: point.x,
    clientY: point.y,
  });
  await expect(zoom).not.toHaveText("300%");
  await page.keyboard.insertText("żółw");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__androidTest.input
          .filter((e: any) => e.type === "text")
          .map((e: any) => e.text)
          .join(""),
      ),
    )
    .toBe("żółw");
  expect(
    await page.evaluate(
      () =>
        (window as any).__androidTest.input.filter(
          (e: any) => e.type === "touch",
        ).length,
    ),
  ).toBe(2);
  const sizes = await page.evaluate(() =>
    (window as any).__nativeTest.calls
      .filter((call: any) => call.command === "android_subscribe_frames")
      .map((call: any) => call.args.size),
  );
  for (const size of sizes) {
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(1280);
    expect(size.width * size.height).toBeLessThanOrEqual(720 * 1280);
  }
  expect(await page.evaluate(() => (window as any).__androidTest.starts)).toBe(
    1,
  );
  expect(
    await page.evaluate(() => (window as any).__androidTest.live.size),
  ).toBe(1);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.locator(".android-viewport").dispatchEvent("wheel", {
    deltaY: 50,
    shiftKey: true,
    clientX: point.x,
    clientY: point.y,
  });
  await page.mouse.move(point.x + 20, point.y + 20);
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__androidTest.input
          .filter((event: any) => event.type === "touch")
          .map((event: any) => event.phase),
      ),
    )
    .toEqual(["down", "up", "down", "up"]);
});

async function modernCatalog(page: Page) {
  await page.addInitScript(() => {
    const { state, catalog } = (window as any).__androidTest;
    for (const [level, tag] of [
      ["37.2", "google_apis_playstore_ps16k"],
      ["36.1", "google_apis"],
      ["33", "default"],
    ]) {
      const id = `system-images;android-${level};${tag};arm64-v8a`;
      const [api, minorApi = 0] = level.split(".").map(Number);
      catalog.packages.push({
        ...catalog.packages.at(-1),
        id,
        image: { api, minorApi, tag, abi: "arm64-v8a" },
        revision: "5",
      });
      state.packages.packages[id] = {
        id,
        revision: "5",
        archiveSha1: "a".repeat(40),
      };
    }
    state.profiles.push(
      {
        id: "pixel_10",
        name: "Pixel 10",
        width: 1080,
        height: 2424,
        dpi: 420,
        minApi: 36,
        minMinorApi: 1,
      },
      {
        id: "pixel_10a",
        name: "Pixel 10a",
        width: 1080,
        height: 2424,
        dpi: 420,
        minApi: 37,
        minMinorApi: 0,
      },
    );
  });
}

test("device creation offers recent compatible phones and preserves user names", async ({
  page,
}) => {
  await mockDesktop(page, false);
  await mockAndroid(page, true);
  await modernCatalog(page);
  await page.goto("/?window=settings&page=android");
  await page
    .getByRole("button", { name: "Create device", exact: true })
    .click();
  const form = page.getByRole("dialog", { name: "Create Android device" });
  await expect(
    form.getByRole("combobox", { name: "Android version" }),
  ).toContainText("Android 17 (API 37.2)");
  await expect(
    form.getByRole("combobox", { name: "Phone profile" }),
  ).toHaveText("Pixel 10a");
  await expect(
    form.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("Pixel 10a");
  await form
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("My test phone");
  await form.getByRole("combobox", { name: "Android version" }).click();
  await page.getByRole("option", { name: /Android 16 \(API 36\.1\)/ }).click();
  await expect(
    form.getByRole("combobox", { name: "Phone profile" }),
  ).toHaveText("Pixel 10");
  await expect(
    form.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("My test phone");
  await form.getByRole("combobox", { name: "Phone profile" }).click();
  await expect(
    page.getByRole("option", { name: /Pixel 10a · needs/ }),
  ).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  await form
    .getByRole("checkbox", { name: "Enable SimpleBench text input" })
    .check();
  await form
    .getByRole("button", { name: "Create device", exact: true })
    .click();
  const call = await page.evaluate(() =>
    (window as any).__nativeTest.calls.findLast(
      (call: any) => call.command === "android_manage_device",
    ),
  );
  expect(call.args.action.draft.profile).toBe("pixel_10");
  expect(call.args.action.draft.image).toContain("android-36.1");
});

test("system images explain variants and filter recent versions without hiding installed images", async ({
  page,
}) => {
  await mockDesktop(page, false);
  await mockAndroid(page, true);
  await modernCatalog(page);
  await page.goto("/?window=settings&page=android");
  await page.getByRole("button", { name: "Browse available images" }).click();
  const list = page.locator(".android-image-list");
  await expect(list.locator(".android-row").first()).toContainText(
    "Android 17 (API 37.2)",
  );
  await expect(list).toContainText("16 KB memory pages");
  await expect(list).not.toContainText("Android 13");
  await page.getByRole("combobox", { name: "Filter Android version" }).click();
  await page.getByRole("option", { name: "All versions", exact: true }).click();
  await expect(list).toContainText("Android 13");
  await page.getByRole("combobox", { name: "Filter included apps" }).click();
  await page.getByRole("option", { name: "Google Play", exact: true }).click();
  await expect(list.locator(".android-row")).toHaveCount(1);
  await expect(list).toContainText("Play Store");
});

for (const appearance of ["light", "dark"] as const)
  test(`modern Android choices remain usable at minimum settings size in ${appearance}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 560, height: 420 });
    await page.emulateMedia({ colorScheme: appearance });
    await mockDesktop(page, false);
    await mockAndroid(page, true);
    await modernCatalog(page);
    await page.goto("/?window=settings&page=android");
    await page.getByRole("button", { name: "Browse available images" }).click();
    const version = page.getByRole("combobox", {
      name: "Filter Android version",
    });
    await version.scrollIntoViewIfNeeded();
    await expect(version).toBeInViewport();
    await page.screenshot({
      path: info.outputPath(`modern-catalog-${appearance}.png`),
    });
    await page
      .getByRole("button", { name: "Create device", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Create Android device" });
    const profile = dialog.getByRole("combobox", { name: "Phone profile" });
    await profile.scrollIntoViewIfNeeded();
    await expect(profile).toContainText("Pixel 10a");
    await page.screenshot({
      path: info.outputPath(`modern-phone-${appearance}.png`),
    });
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await dialog
      .getByRole("checkbox", { name: "Enable SimpleBench text input" })
      .check();
    const submit = dialog.getByRole("button", {
      name: "Create device",
      exact: true,
    });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport();
    await expect(submit).toBeEnabled();
  });

for (const command of [
  "android_subscribe_frames",
  "android_ack_frame",
  "android_unsubscribe_frames",
]) {
  test(`a retired ${command} failure cannot poison its replacement stream`, async ({
    page,
  }) => {
    await mockDesktop(page, false);
    await mockAndroid(page, true);
    await page.goto("/");
    await page.evaluate((target) => {
      const desktop = window as any;
      const invoke = desktop.__TAURI_INTERNALS__.invoke;
      let delayed = false;
      desktop.__TAURI_INTERNALS__.invoke = async (name: string, args: any) => {
        const result = await invoke(name, args);
        if (name !== target || delayed) return result;
        delayed = true;
        return new Promise((_, reject) => {
          desktop.__rejectRetiredAndroidRequest = () =>
            reject(new Error("Retired Android request failed"));
        });
      };
    }, command);
    await openAndroid(page);
    await expect(page.locator(".android-screen")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__androidTest.subscribers),
      )
      .toBeGreaterThan(0);
    await page.getByRole("tab", { name: "Terminal", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__androidTest.live.size))
      .toBe(0);
    await page.getByRole("tab", { name: "Test phone", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__androidTest.subscribers),
      )
      .toBeGreaterThan(1);
    await page.evaluate(() => (window as any).__rejectRetiredAndroidRequest());
    // Cross another subscription boundary: a stale error must not block it.
    await page.getByRole("tab", { name: "Terminal", exact: true }).click();
    await page.getByRole("tab", { name: "Test phone", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__androidTest.subscribers),
      )
      .toBeGreaterThan(2);
    await expect(page.locator(".android-screen")).toBeVisible();
    await expect(page.getByText("Retired Android request failed")).toHaveCount(
      0,
    );
    expect(
      await page.evaluate(() => (window as any).__androidTest.live.size),
    ).toBe(1);
    expect(
      await page.evaluate(() => (window as any).__androidTest.starts),
    ).toBe(1);
  });
}

test("an unqualified host preserves devices but cannot install or start Android", async ({
  page,
}) => {
  await mockDesktop(page, false);
  await mockAndroid(page, true);
  await page.addInitScript(() => {
    const state = (window as any).__androidTest.state;
    state.host = "windows_x64";
    state.qualified = false;
    state.toolchain.qualified = false;
  });
  await page.goto("/");
  await openAndroid(page);
  await expect(
    page.getByText(/Android setup and Start are unavailable on/),
  ).toBeVisible();
  await expect(page.locator(".android-screen")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__androidTest.starts)).toBe(
    0,
  );
  await page.getByRole("button", { name: "Android actions" }).click();
  await expect(
    page.getByRole("menuitem", { name: "Start", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("menuitem", { name: "Restart (cold boot)", exact: true }),
  ).toBeDisabled();
  await page.goto("/?window=settings&page=android");
  for (const name of [
    "Repair tools",
    "Create device",
    "Open in workspace",
    "Cold boot",
    "Wipe data…",
  ]) {
    await expect(
      page.getByRole("button", { name, exact: true }),
    ).toBeDisabled();
  }
  await expect(
    page.getByRole("button", { name: "Delete device…", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() =>
      (window as any).__nativeTest.calls.filter((call: any) =>
        ["android_start", "android_install_plan", "android_install"].includes(
          call.command,
        ),
      ),
    ),
  ).toEqual([]);
});

test("a delayed explicit Paste cannot target a phone after focus leaves it", async ({
  page,
}) => {
  await mockDesktop(page, false);
  await mockAndroid(page, true);
  await page.goto("/");
  await openAndroid(page);
  await expect(page.locator(".android-screen")).toBeVisible();
  await page.evaluate(() => {
    const desktop = window as any;
    const invoke = desktop.__TAURI_INTERNALS__.invoke;
    desktop.__TAURI_INTERNALS__.invoke = (command: string, args: any) =>
      command === "plugin:clipboard-manager|read_text"
        ? new Promise((resolve) => {
            desktop.__finishAndroidPaste = resolve;
          })
        : invoke(command, args);
  });
  await page.getByRole("button", { name: "Android actions" }).click();
  await page.getByRole("menuitem", { name: "Paste", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Android phone input" }),
  ).toBeFocused();
  await page.getByRole("tab", { name: "Terminal", exact: true }).click();
  await page.evaluate(() =>
    (window as any).__finishAndroidPaste("Zażółć — late"),
  );
  await page.getByRole("tab", { name: "Test phone", exact: true }).click();
  await expect(page.locator(".android-screen")).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as any).__androidTest.input.filter(
        (event: any) => event.type === "paste",
      ),
    ),
  ).toEqual([]);
});

test("Android wheel gestures accumulate movement and release modified keys on blur", async ({
  page,
}) => {
  await mockDesktop(page, false);
  await mockAndroid(page, true);
  await page.goto("/");
  await openAndroid(page);
  const canvas = page.locator(".android-screen");
  await expect(canvas).toBeVisible();
  await canvas.click();
  await page.keyboard.down("Shift");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.up("Shift");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__androidTest.input.filter(
          (event: any) => event.type === "key",
        ),
      ),
    )
    .toEqual([
      { type: "key", key: "Shift", down: true },
      { type: "key", key: "ArrowLeft", down: true },
      { type: "key", key: "ArrowLeft", down: false },
      { type: "key", key: "Shift", down: false },
    ]);
  await canvas.evaluate((element) => {
    (window as any).__androidTest.input.length = 0;
    const rect = element.getBoundingClientRect();
    for (let i = 0; i < 3; i++)
      element.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: rect.x + rect.width / 2,
          clientY: rect.y + rect.height / 2,
          deltaY: 10,
        }),
      );
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__androidTest.input
            .filter((event: any) => event.type === "touch")
            .at(-1)?.phase,
      ),
    )
    .toBe("up");
  const touches = await page.evaluate(() =>
    (window as any).__androidTest.input.filter(
      (event: any) => event.type === "touch",
    ),
  );
  expect(touches[0].phase).toBe("down");
  expect(touches.at(-1).y).toBeLessThan(touches[0].y - 20);
  await page.keyboard.down("ArrowRight");
  await page.getByRole("tab", { name: "Terminal", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__nativeTest.calls
            .filter((call: any) => call.command === "android_input")
            .at(-1)?.args.input.type,
      ),
    )
    .toBe("blur");
  await page.keyboard.up("ArrowRight");
});

test("a smaller shared framebuffer preserves full-resolution copies and actual size", async ({
  page,
}) => {
  const project = newProject("/project", "local:bash");
  const tab = project.workspaces[0].tabs[0] as TerminalTab;
  const device = "12345678-1234-4567-8123-123456789abc";
  const small = newAndroidTab(device, "Shared phone");
  const large = newAndroidTab(device, "Shared phone");
  tab.layout = {
    type: "split",
    id: crypto.randomUUID(),
    axis: "horizontal",
    ratio: 0.25,
    first: small,
    second: large,
  };
  tab.activePaneId = small.id;
  await mockDesktop(page, false, {
    ...newSession(),
    projects: [project],
    activeProjectId: project.id,
  });
  await mockAndroid(page, true);
  await page.addInitScript(() => {
    const samples = ((window as any).__androidRenderSamples = {});
    const original = WebGLRenderingContext.prototype.drawArrays;
    WebGLRenderingContext.prototype.drawArrays = function (mode, first, count) {
      original.call(this, mode, first, count);
      const canvas = this.canvas as HTMLCanvasElement;
      if (!canvas.classList.contains("android-screen")) return;
      const pixels = new Uint8Array(8);
      this.readPixels(
        0,
        0,
        1,
        1,
        this.RGBA,
        this.UNSIGNED_BYTE,
        pixels.subarray(0, 4),
      );
      this.readPixels(
        canvas.width - 1,
        canvas.height - 1,
        1,
        1,
        this.RGBA,
        this.UNSIGNED_BYTE,
        pixels.subarray(4),
      );
      const id = canvas.closest<HTMLElement>("[data-android-pane-id]")!.dataset
        .androidPaneId!;
      samples[id] = {
        width: canvas.width,
        height: canvas.height,
        pixels: [...pixels],
        error: this.getError(),
      };
    };
  });
  await page.goto("/");
  const read = () =>
    page.evaluate(() => (window as any).__androidRenderSamples);
  await expect
    .poll(async () => {
      const values = await read();
      return values[small.id]?.width < values[large.id]?.width;
    })
    .toBe(true);
  const assertPixels = async () => {
    const values = await read();
    for (const id of [small.id, large.id]) {
      expect(values[id].error).toBe(0);
      expect(values[id].pixels).toEqual([90, 90, 90, 255, 90, 90, 90, 255]);
    }
  };
  await assertPixels();
  const pane = page.locator(`[data-android-pane-id="${small.id}"]`);
  await pane.getByRole("button", { name: "Android actions" }).click();
  await page.getByRole("menuitem", { name: "Actual size (1:1)" }).click();
  await expect.poll(async () => (await read())[small.id]?.width).toBe(720);
  await expect.poll(async () => (await read())[small.id]?.height).toBe(1280);
  await assertPixels();
  await pane.getByRole("button", { name: "Android actions" }).click();
  await page.getByRole("menuitem", { name: "Fit to panel" }).click();
  await expect
    .poll(async () => {
      const values = await read();
      return values[small.id]?.width < values[large.id]?.width;
    })
    .toBe(true);
  await assertPixels();
  expect(
    await page.evaluate(() => (window as any).__androidTest.live.size),
  ).toBe(1);
  expect(await page.evaluate(() => (window as any).__androidTest.starts)).toBe(
    1,
  );
});

test("docked phones retain independent zoom and scroll across workspace teardown", async ({
  page,
}) => {
  const device = "12345678-1234-4567-8123-123456789abc";
  const project = newProject("/project", "local:bash");
  project.workspaces.push(
    newWorkspace("/project", "local:bash", "Other workspace"),
  );
  const tab = project.workspaces[0].tabs[0] as TerminalTab;
  const first = newAndroidTab(device, "Shared phone");
  const second = newAndroidTab(device, "Shared phone");
  tab.layout = {
    type: "split",
    id: crypto.randomUUID(),
    axis: "horizontal",
    ratio: 0.5,
    first,
    second,
  };
  tab.activePaneId = second.id;
  await mockDesktop(page, false, {
    ...newSession(),
    projects: [project],
    activeProjectId: project.id,
  });
  await mockAndroid(page, true);
  await page.addInitScript(() => {
    (window as any).__androidTest.display = [1344, 2992];
  });
  await page.goto("/");
  await expect(page.locator(".android-screen")).toHaveCount(2);
  const pane = page.locator(`[data-android-pane-id="${second.id}"]`);
  await pane.getByRole("combobox", { name: "Screen zoom" }).click();
  await pane.getByRole("option", { name: "300%", exact: true }).click();
  await pane.locator(".android-viewport").evaluate((host) => {
    host.scrollLeft = 35;
    host.scrollTop = 70;
  });
  const position = () =>
    pane
      .locator(".android-viewport")
      .evaluate((host) => ({ left: host.scrollLeft, top: host.scrollTop }));
  await expect.poll(position).toEqual({ left: 35, top: 70 });
  await page
    .getByRole("button", { name: "Toggle workspaces", exact: true })
    .click();
  await page
    .locator(".workspace-list-item")
    .filter({ hasText: "Other workspace" })
    .click();
  await expect(page.locator(".android-screen")).toHaveCount(0);
  await page
    .locator(".workspace-list-item")
    .filter({ hasText: "Default" })
    .click();
  await expect(page.locator(".android-screen")).toHaveCount(2);
  await expect(pane.getByRole("combobox", { name: "Screen zoom" })).toHaveText(
    "300%",
  );
  await expect.poll(position).toEqual({ left: 35, top: 70 });
  await expect(
    page
      .locator(`[data-android-pane-id="${first.id}"]`)
      .getByRole("combobox", { name: "Screen zoom" }),
  ).toHaveText("Fit");
  expect(
    await page.evaluate(() => (window as any).__androidTest.live.size),
  ).toBe(1);
  expect(await page.evaluate(() => (window as any).__androidTest.starts)).toBe(
    1,
  );
});

test("two docked views share a stream, preserve identity and stop only after the final view", async ({
  page,
}) => {
  const device = "12345678-1234-4567-8123-123456789abc";
  const project = newProject("/project", "local:bash");
  const tab = project.workspaces[0].tabs[0] as TerminalTab;
  const first = newAndroidTab(device, "Shared phone"),
    second = newAndroidTab(device, "Shared phone");
  tab.layout = {
    type: "split",
    id: crypto.randomUUID(),
    axis: "horizontal",
    ratio: 0.5,
    first,
    second,
  };
  tab.activePaneId = first.id;
  await mockDesktop(page, false, {
    ...newSession(),
    projects: [project],
    activeProjectId: project.id,
  });
  await mockAndroid(page, true);
  await page.goto("/");
  await expect(page.locator(".android-screen")).toHaveCount(2);
  await expect
    .poll(() => page.evaluate(() => (window as any).__androidTest.live.size))
    .toBe(1);
  expect(await page.evaluate(() => (window as any).__androidTest.starts)).toBe(
    1,
  );
  expect(
    await page.evaluate(() => (window as any).__androidTest.subscribers),
  ).toBe(1);
  const source = page.locator(`[data-android-pane-id="${first.id}"]`);
  const target = page.locator(`[data-android-pane-id="${second.id}"]`);
  const handle = (await source.locator(".android-pane-title").boundingBox())!;
  const destination = (await target.boundingBox())!;
  await page.keyboard.down("Control");
  await page.mouse.move(handle.x + 10, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    destination.x + destination.width / 2,
    destination.y + 20,
    { steps: 8 },
  );
  await expect(page.locator(".pane-drop-preview")).toHaveAttribute(
    "data-side",
    "top",
  );
  await page.mouse.up();
  await page.keyboard.up("Control");
  await expect
    .poll(async () => {
      const first = await source.boundingBox();
      const second = await target.boundingBox();
      return first && second && first.y < second.y;
    })
    .toBe(true);
  expect(await page.evaluate(() => (window as any).__androidTest.starts)).toBe(
    1,
  );
  expect(await page.evaluate(() => (window as any).__androidTest.stops)).toBe(
    0,
  );
  await expect
    .poll(() => page.evaluate(() => (window as any).__androidTest.live.size))
    .toBe(1);
  await page
    .getByRole("button", { name: "Close Android panel" })
    .first()
    .click();
  await expect(page.locator(".android-screen")).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__androidTest.stops)).toBe(
    0,
  );
  expect(await page.evaluate(() => (window as any).__androidTest.starts)).toBe(
    1,
  );
  await page.getByRole("button", { name: "Close Android panel" }).click();
  await expect(page.locator(".android-screen")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__androidTest.stops)).toBe(
    1,
  );
});

test("cancelling a final-view close retains the stopped descriptor without restarting", async ({
  page,
}) => {
  await mockDesktop(page, false);
  await mockAndroid(page, true);
  await page.goto("/");
  await openAndroid(page);
  await expect(page.locator(".android-screen")).toBeVisible();
  await page.evaluate(() => {
    (window as any).__androidTest.stopDelay = 800;
  });
  await page.getByRole("button", { name: "Close Android panel" }).click();
  await page
    .getByRole("dialog", { name: "Preparing to close" })
    .getByRole("button", { name: "Cancel closing" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("tab", { name: "Test phone", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).__androidTest.starts)).toBe(
    1,
  );
});

test("late Settings open cannot recreate a closed setup target", async ({
  page,
}) => {
  await mockDesktop(page, false);
  await mockAndroid(page, true);
  await page.goto("/");
  await page.evaluate(() => {
    (window as any).__androidTest.state.preferences.defaultDeviceId = null;
  });
  await openAndroid(page);
  await page.getByRole("button", { name: "Manage devices" }).click();
  const setup = await page.evaluate(() => (window as any).__androidTest.setup);
  await page.getByRole("button", { name: "Close Android panel" }).click();
  await expect(page.locator(".android-pane")).toHaveCount(0);
  await page.evaluate(async (setup) => {
    await (window as any).__nativeTest.emitEvent("android-open-request", {
      id: crypto.randomUUID(),
      deviceId: (window as any).__androidTest.deviceId,
      context: setup,
      coldBoot: false,
      deadlineMs: Date.now() + 15000,
    });
  }, setup);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__nativeTest.calls.filter(
            (c: any) => c.command === "android_open_result",
          ).length,
      ),
    )
    .toBe(1);
  expect(
    await page.evaluate(
      () =>
        (window as any).__nativeTest.calls.find(
          (c: any) => c.command === "android_open_result",
        ).args.error,
    ),
  ).toContain("was closed");
  await expect(page.locator(".android-pane")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__androidTest.starts)).toBe(
    0,
  );
});

test("Android stays lazy until explicitly opened and setup never creates a PTY", async ({
  page,
}) => {
  await mockDesktop(page, false);
  await mockAndroid(page);
  await page.goto("/");
  await expect(page.locator(".xterm-screen")).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as any).__nativeTest.calls.filter((call: any) =>
        call.command.startsWith("android_"),
      ),
    ),
  ).toEqual([]);
  const ptys = await page.evaluate(
    () =>
      (window as any).__nativeTest.calls.filter(
        (call: any) => call.command === "create_terminal",
      ).length,
  );
  await openAndroid(page);
  await expect(
    page.getByRole("button", { name: "Set up Android" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as any).__nativeTest.calls.filter(
          (call: any) => call.command === "create_terminal",
        ).length,
    ),
  ).toBe(ptys);
  await page.getByRole("button", { name: "Set up Android" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__nativeTest.calls.filter(
            (call: any) => call.command === "android_prepare_setup",
          ).length,
      ),
    )
    .toBe(1);
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(
          localStorage.getItem("test-session") ?? "null",
        )?.projects[0].workspaces[0].tabs.some(
          (tab: any) => tab.type === "android",
        ),
      ),
    )
    .toBe(true);
  const tab = await page.evaluate(() =>
    JSON.parse(
      localStorage.getItem("test-session")!,
    ).projects[0].workspaces[0].tabs.find((tab: any) => tab.type === "android"),
  );
  expect(tab.deviceId).toBeNull();
  expect(tab).not.toHaveProperty("profileId");
});

test("provider terms precede installation and cancellation survives leaving Android settings", async ({
  page,
}) => {
  await mockDesktop(page, false);
  await mockAndroid(page);
  await page.goto("/?window=settings&page=android");
  await page
    .getByRole("button", { name: "Install Android tools", exact: true })
    .click();
  const review = page.getByRole("dialog", {
    name: "Review Android installation",
  });
  await expect(review.getByText(/Fixture terms shown in full/)).toBeVisible();
  await expect(
    review.getByRole("button", { name: "Install selected components" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() =>
      (window as any).__nativeTest.calls.some(
        (call: any) => call.command === "android_install",
      ),
    ),
  ).toBe(false);
  await review
    .getByRole("checkbox", { name: "I accept android-sdk-license" })
    .check();
  await review
    .getByRole("button", { name: "Install selected components" })
    .click();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "value",
    "250000",
  );
  await page.getByRole("button", { name: "Keybinds", exact: true }).click();
  expect(
    await page.evaluate(() =>
      (window as any).__nativeTest.calls.some(
        (call: any) => call.command === "android_cancel_operation",
      ),
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Android", exact: true }).click();
  await page.getByRole("button", { name: "Cancel operation" }).click();
  await expect(page.getByText("Cancelled safely")).toBeVisible();
});

test("devices require explicit text-input consent and destructive confirmation", async ({
  page,
}) => {
  await mockDesktop(page, false);
  await mockAndroid(page, true);
  await page.goto("/?window=settings&page=android");
  await expect(
    page.getByRole("button", { name: "Remove image", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Create device", exact: true })
    .click();
  const form = page.getByRole("dialog", { name: "Create Android device" });
  await expect(
    form.getByRole("button", { name: "Create device" }),
  ).toBeDisabled();
  await form
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Żółty telefon");
  await form
    .getByRole("checkbox", { name: "Enable SimpleBench text input" })
    .check();
  await form.getByRole("button", { name: "Create device" }).click();
  const card = page.getByRole("article", { name: "Żółty telefon" });
  await card.getByRole("button", { name: "Delete device…" }).click();
  const confirmation = page.getByRole("dialog", {
    name: "Delete device",
    exact: true,
  });
  await expect(
    confirmation.getByRole("button", { name: "Delete device" }),
  ).toBeDisabled();
  await confirmation.getByRole("textbox").fill("Żółty telefon");
  await confirmation.getByRole("button", { name: "Delete device" }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole("article", { name: "Test phone" })).toBeVisible();
});

test("a phone keeps its process across tab switches, sends Unicode, and stops before its final view closes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockDesktop(page, false);
  await mockAndroid(page, true);
  await page.goto("/");
  await openAndroid(page);
  await expect(page.locator(".android-screen")).toBeVisible();
  await page.locator(".android-screen").click();
  await page.keyboard.insertText("Zażółć gęślą jaźń");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__androidTest.input
          .filter((event: any) => event.type === "text")
          .map((event: any) => event.text)
          .join(""),
      ),
    )
    .toBe("Zażółć gęślą jaźń");
  await page.getByRole("tab", { name: "Terminal", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__androidTest.live.size))
    .toBe(0);
  expect(await page.evaluate(() => (window as any).__androidTest.stops)).toBe(
    0,
  );
  await page.getByRole("tab", { name: "Test phone", exact: true }).click();
  await expect(page.locator(".android-screen")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__androidTest.starts)).toBe(
    1,
  );
  await page.evaluate(() => {
    (window as any).__androidTest.stopDelay = 500;
  });
  await page.getByRole("button", { name: "Close Android panel" }).click();
  await expect(
    page.getByRole("dialog", { name: "Preparing to close" }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Test phone", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Test phone", exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__androidTest.stops)).toBe(
    1,
  );
  expect(errors).toEqual([]);
});

for (const theme of ["light", "dark"] as const)
  test(`Android settings remains usable at minimum size in ${theme}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 560, height: 420 });
    await page.emulateMedia({ colorScheme: theme });
    await mockDesktop(page, false);
    await mockAndroid(page, true);
    await page.goto("/?window=settings&page=android");
    await expect(
      page.getByRole("heading", { name: "Android", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`android-settings-${theme}.png`),
    });
    await page.getByRole("button", { name: "Configure", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("button", { name: "Save configuration" })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "Save configuration" }),
    ).toBeInViewport();
    expect(
      await page.evaluate(
        () =>
          document.querySelector("dialog")!.getBoundingClientRect().right <=
          innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`android-device-${theme}.png`),
    });
  });
