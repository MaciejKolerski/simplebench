import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { mockDesktop, buffer } from "./desktop";
import { newProject, newSession, newTab } from "../../src/model";

test.use({ colorScheme: "dark" });

async function setup(page: Page, count = 3) {
  const project = newProject("/project", "local:bash");
  const workspace = project.workspaces[0];
  workspace.tabs = Array.from({ length: count }, (_, index) =>
    newTab("/project", "local:bash", `Terminal ${index + 1}`),
  );
  workspace.activeTabId = workspace.tabs[0].id;
  await mockDesktop(page, false, {
    ...newSession(),
    projects: [project],
    activeProjectId: project.id,
  });
  await page.goto("/");
  await expect(page.locator(".xterm-screen")).toBeVisible();
  return workspace;
}

async function grab(page: Page, source: Locator) {
  const bounds = (await source.boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
}

async function savedTabs(page: Page) {
  return page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("test-session") ?? "null")?.projects[0]
        .workspaces[0].tabs,
  );
}

for (const title of ["Browser", "README.md"]) {
  test(`${title} preview interpolates, retargets smoothly and keeps drop-zone boundaries stable`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await setup(page, 1);
    if (title === "Browser") {
      await page.getByRole("button", { name: /^New tab/ }).click();
      await page.getByRole("menuitem", { name: "New browser" }).click();
    } else {
      await page.getByRole("button", { name: title, exact: true }).click();
      await expect(page.locator(".cm-content")).toBeVisible();
    }
    await page.getByRole("tab", { name: "Terminal 1", exact: true }).click();
    const area = (await page.locator(".terminal-layout").boundingBox())!;
    await page.keyboard.down("Control");
    await grab(page, page.getByRole("tab", { name: title, exact: true }));
    await page.mouse.move(area.x + 20, area.y + area.height / 2);
    const preview = page.locator(".tab-merge-preview");
    await expect(preview).toHaveText(`Move ${title} here`);
    await preview.evaluate((element) =>
      Promise.all(
        element.getAnimations().map((animation) => animation.finished),
      ),
    );
    const before = (await preview.boundingBox())!;
    await page.mouse.move(area.x + area.width / 2, area.y + 20);
    const motion = await preview.evaluate((element) => {
      const animations = element.getAnimations();
      for (const animation of animations) {
        animation.pause();
        animation.currentTime = 80;
      }
      return {
        count: animations.length,
        width: parseFloat(element.style.width),
        height: parseFloat(element.style.height),
      };
    });
    expect(motion.count).toBeGreaterThan(0);
    const midway = (await preview.boundingBox())!;
    for (const dimension of ["width", "height"] as const) {
      expect(midway[dimension]).toBeGreaterThan(
        Math.min(before[dimension], motion[dimension]),
      );
      expect(midway[dimension]).toBeLessThan(
        Math.max(before[dimension], motion[dimension]),
      );
    }
    await page.mouse.move(area.x + area.width / 2 + 2, area.y + 20);
    expect(await preview.boundingBox()).toEqual(midway);
    await page.screenshot({
      path: testInfo.outputPath("preview-midpoint.png"),
    });
    const next = { x: area.x + area.width - 20, y: area.y + area.height / 2 };
    const retargeted = await preview.evaluate((element, next) => {
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 1,
          clientX: next.x,
          clientY: next.y,
          ctrlKey: true,
        }),
      );
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }, next);
    for (const dimension of ["x", "y", "width", "height"] as const)
      expect(retargeted[dimension]).toBeCloseTo(midway[dimension], 0);
    await page.mouse.move(next.x, next.y);
    await expect(preview).toHaveAttribute("data-side", "right");
    await page.mouse.move(
      area.x + area.width * 0.2,
      area.y + area.height * 0.25,
    );
    await expect(preview).toHaveAttribute("data-side", "left");
    for (const offset of [-1, 1, -2, 2]) {
      await page.mouse.move(
        area.x + area.width * 0.25 + offset,
        area.y + area.height * 0.25,
      );
      await expect(preview).toHaveAttribute("data-side", "left");
    }
    await page.mouse.move(10, 120);
    await expect(preview).toBeHidden();
    await page.mouse.move(next.x, next.y);
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("data-side", "right");
    const destination = await preview.evaluate((element) => ({
      x: parseFloat(element.style.left),
      y: parseFloat(element.style.top),
      width: parseFloat(element.style.width),
      height: parseFloat(element.style.height),
    }));
    await page.mouse.up();
    await page.keyboard.up("Control");
    await expect(preview).toHaveCount(0);
    await expect(page.getByRole("tab")).toHaveCount(1);
    const panel =
      title === "Browser"
        ? page.locator("[data-browser-pane-id]").locator("..")
        : page.locator("[data-file-pane-id]");
    await expect(async () => {
      const actual = (await panel.boundingBox())!;
      for (const dimension of ["x", "y", "width", "height"] as const)
        expect(actual[dimension]).toBeCloseTo(destination[dimension], 0);
    }).toPass();
  });
}

test("reorders inactive tabs in both directions, preserves selection and restores the order", async ({
  page,
}) => {
  await setup(page);
  const first = page.getByRole("tab", { name: "Terminal 1", exact: true });
  const third = page.getByRole("tab", { name: "Terminal 3", exact: true });
  const bounds = (await first.boundingBox())!;
  await grab(page, third);
  await page.mouse.move(bounds.x + 1, bounds.y + bounds.height / 2, {
    steps: 8,
  });
  await expect(first).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".tab-drop-marker")).toBeVisible();
  await page.mouse.up();
  await expect(page.getByRole("tab")).toHaveText([
    "Terminal 3",
    "Terminal 1",
    "Terminal 2",
  ]);
  const strip = (await page.locator(".tab-strip").boundingBox())!;
  await grab(page, third);
  await page.mouse.move(strip.x + strip.width - 5, strip.y + strip.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(page.getByRole("tab")).toHaveText([
    "Terminal 1",
    "Terminal 2",
    "Terminal 3",
  ]);
  await expect(first).toHaveAttribute("aria-selected", "true");
  await expect
    .poll(async () => (await savedTabs(page))?.map((tab: any) => tab.title))
    .toEqual(["Terminal 1", "Terminal 2", "Terminal 3"]);
  await page.reload();
  await expect(page.getByRole("tab")).toHaveText([
    "Terminal 1",
    "Terminal 2",
    "Terminal 3",
  ]);
  await expect
    .poll(() => page.evaluate(() => (window as any).__nativeTest.sessions.size))
    .toBe(1);
});

for (const side of ["left", "right", "top", "bottom"] as const) {
  test(`dropping an inactive terminal on the ${side} merges live sessions and preserves output`, async ({
    page,
  }) => {
    const workspace = await setup(page, 2);
    const target = workspace.tabs[0];
    const source = workspace.tabs[1];
    if (source.type !== "terminal" || target.type !== "terminal")
      throw new Error("Expected terminals");
    await page.getByRole("tab", { name: "Terminal 2", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__nativeTest.sessions.size),
      )
      .toBe(2);
    await page.evaluate(() => {
      const native = (window as any).__nativeTest;
      native.emit(
        [...native.sessions.keys()][1],
        "\r\nSOURCE OUTPUT — zażółć 🦀\r\n",
      );
    });
    await page.getByRole("tab", { name: "Terminal 1", exact: true }).click();
    await page
      .locator(`[data-pane-id="${target.activePaneId}"]`)
      .evaluate((element) => {
        (window as any).__targetHost = element;
      });
    const area = (await page.locator(".terminal-layout").boundingBox())!;
    const x =
      area.x +
      area.width * (side === "left" ? 0.15 : side === "right" ? 0.85 : 0.5);
    const y =
      area.y +
      area.height * (side === "top" ? 0.15 : side === "bottom" ? 0.85 : 0.5);
    await grab(
      page,
      page.getByRole("tab", { name: "Terminal 2", exact: true }),
    );
    await page.mouse.move(x, y, { steps: 10 });
    await expect(page.getByRole("tab", { selected: true })).toHaveText(
      "Terminal 1",
    );
    await expect(page.locator(".tab-merge-preview")).toHaveAttribute(
      "data-side",
      side,
    );
    await page
      .locator(".tab-merge-preview")
      .evaluate((element) =>
        Promise.all(
          element.getAnimations().map((animation) => animation.finished),
        ),
      );
    const preview = (await page.locator(".tab-merge-preview").boundingBox())!;
    expect(preview.width).toBeCloseTo(
      side === "left" || side === "right" ? (area.width - 3) / 2 : area.width,
      0,
    );
    expect(preview.height).toBeCloseTo(
      side === "top" || side === "bottom" ? (area.height - 3) / 2 : area.height,
      0,
    );
    if (side === "right")
      await page.screenshot({ path: "test-results/tab-merge-preview.png" });
    await page.mouse.up();
    await expect(page.getByRole("tab")).toHaveText(["Terminal 1"]);
    await expect(page.locator(".xterm-screen")).toHaveCount(2);
    await expect(
      page.locator(`[data-pane-id="${source.activePaneId}"]`),
    ).toHaveClass(/is-active/);
    expect(
      await page
        .locator(`[data-pane-id="${target.activePaneId}"]`)
        .evaluate((element) => element === (window as any).__targetHost),
    ).toBe(true);
    await expect
      .poll(() => buffer(page, source.activePaneId))
      .toContain("SOURCE OUTPUT — zażółć 🦀");
    await page.evaluate(() => {
      const native = (window as any).__nativeTest;
      native.emit([...native.sessions.keys()][1], "\r\nSTILL STREAMING\r\n");
    });
    await expect
      .poll(() => buffer(page, source.activePaneId))
      .toContain("STILL STREAMING");
    expect(
      await page.evaluate(() =>
        (window as any).__nativeTest.calls.filter(
          (call: any) => call.command === "close_terminal",
        ),
      ),
    ).toEqual([]);
    expect(
      await page.evaluate(() => (window as any).__nativeTest.sessions.size),
    ).toBe(2);
    if (side === "right")
      await page.screenshot({ path: "test-results/tab-merge-result.png" });
    await expect.poll(async () => (await savedTabs(page))?.length).toBe(1);
    await page.reload();
    await expect(page.locator(".xterm-screen")).toHaveCount(2);
    await expect(page.getByRole("tab")).toHaveText(["Terminal 1"]);
    await expect
      .poll(() => buffer(page, source.activePaneId))
      .not.toContain("STILL STREAMING");
    await page.keyboard.press("Control+w");
    await expect(page.locator("[data-pane-id]")).toHaveCount(1);
    await expect(
      page.locator(`[data-pane-id="${target.activePaneId}"]`),
    ).toBeVisible();
  });
}

test("Escape, pointer cancellation, lost focus and dropping outside leave tabs intact", async ({
  page,
}) => {
  await setup(page);
  const source = page.getByRole("tab", { name: "Terminal 2", exact: true });
  const area = (await page.locator(".terminal-layout").boundingBox())!;
  for (const cancel of ["escape", "pointercancel", "blur", "outside"]) {
    await grab(page, source);
    await page.mouse.move(area.x + area.width - 50, area.y + area.height / 2, {
      steps: 5,
    });
    await expect(page.locator(".tab-merge-preview")).toBeVisible();
    if (cancel === "escape") await page.keyboard.press("Escape");
    if (cancel === "pointercancel")
      await source.dispatchEvent("pointercancel", { pointerId: 1 });
    if (cancel === "blur")
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    if (cancel === "outside") await page.mouse.move(10, 120, { steps: 3 });
    await page.mouse.up();
    await expect(page.locator(".tab-drag-ghost")).toHaveCount(0);
    await expect(page.locator(".tab-merge-preview")).toHaveCount(0);
    await expect(page.getByRole("tab")).toHaveCount(3);
    await expect(page.getByRole("tab", { selected: true })).toHaveText(
      "Terminal 1",
    );
  }
  await source.click();
  await expect(source).toHaveAttribute("aria-selected", "true");
});

test("rejects self drops and splits that cannot fit without closing or starting terminals", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 420 });
  await setup(page, 2);
  await page.keyboard.press("Control+d");
  await expect(page.locator(".xterm-screen")).toHaveCount(2);
  const area = (await page.locator(".terminal-layout").boundingBox())!;
  for (const name of ["Terminal 1", "Terminal 2"]) {
    await grab(page, page.getByRole("tab", { name, exact: true }));
    await page.mouse.move(area.x + area.width - 20, area.y + area.height / 2, {
      steps: 6,
    });
    if (name === "Terminal 2")
      await expect(page.locator(".tab-merge-preview")).toHaveText(
        "Not enough room for these panels",
      );
    else await expect(page.locator(".tab-merge-preview")).toHaveCount(0);
    await page.mouse.up();
    await expect(page.getByRole("tab")).toHaveCount(2);
    await expect(page.locator(".xterm-screen")).toHaveCount(2);
  }
  expect(
    await page.evaluate(() => (window as any).__nativeTest.sessions.size),
  ).toBe(2);
});

test("holding a dragged tab at the strip edge scrolls to tabs beyond the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 420 });
  await setup(page, 12);
  const bounds = (await page.locator(".tab-strip").boundingBox())!;
  await grab(page, page.getByRole("tab", { name: "Terminal 1", exact: true }));
  await page.mouse.move(
    bounds.x + bounds.width - 2,
    bounds.y + bounds.height / 2,
    { steps: 6 },
  );
  await expect
    .poll(
      () =>
        page
          .locator(".tab-strip")
          .evaluate(
            (element) =>
              element.scrollWidth - element.clientWidth - element.scrollLeft,
          ),
      { timeout: 10000 },
    )
    .toBeLessThan(2);
  await page.mouse.up();
  await expect(page.getByRole("tab").last()).toHaveText("Terminal 1");
  await expect(page.getByRole("tab", { selected: true })).toHaveText(
    "Terminal 1",
  );
  await expect(page.locator(".tab-drag-ghost")).toHaveCount(0);
});

test("reordering a modified file retains its buffer and undo history", async ({
  page,
}) => {
  await setup(page, 2);
  await page.getByRole("button", { name: "README.md", exact: true }).click();
  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("drag keeps edits");
  const file = page.getByRole("tab", { name: /README.md/ });
  const first = (await page
    .getByRole("tab", { name: "Terminal 1", exact: true })
    .boundingBox())!;
  await grab(page, file);
  await page.mouse.move(first.x, first.y + first.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByRole("tab").first()).toContainText("README.md");
  await expect(file).toHaveAttribute("aria-selected", "true");
  await expect(editor).toContainText("drag keeps edits");
  await editor.click();
  await page.keyboard.press("Control+z");
  await expect(editor).not.toContainText("drag keeps edits");
});

test("merging different shells preserves profiles when restoring and splitting a moved pane", async ({
  page,
}) => {
  const project = newProject("/project", "local:bash");
  const workspace = project.workspaces[0];
  workspace.tabs[0].title = "Target";
  workspace.tabs.push(newTab("/project/source", "local:fish", "Source"));
  await mockDesktop(page, false, {
    ...newSession(),
    projects: [project],
    activeProjectId: project.id,
  });
  await page.addInitScript(() => {
    const native = (window as any).__TAURI_INTERNALS__;
    const invoke = native.invoke;
    native.invoke = async (command: string, args: unknown) => {
      const result = await invoke(command, args);
      if (command === "app_info")
        result.profiles.push({
          ...result.profiles[0],
          id: "local:fish",
          name: "fish",
          kind: "fish",
          program: "/bin/fish",
        });
      return result;
    };
  });
  await page.goto("/");
  await expect(page.locator(".xterm-screen")).toBeVisible();
  const area = (await page.locator(".terminal-layout").boundingBox())!;
  await grab(page, page.getByRole("tab", { name: "Source", exact: true }));
  await page.mouse.move(area.x + area.width - 40, area.y + area.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(page.getByRole("tab")).toHaveText(["Target"]);
  await expect(
    page.getByRole("region", { name: "Terminal fish", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await savedTabs(page))?.[0].layout.second?.profileId)
    .toBe("local:fish");
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Terminal fish", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+Shift+d");
  await expect(
    page.getByRole("region", { name: "Terminal fish", exact: true }),
  ).toHaveCount(2);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__nativeTest.calls
          .filter((call: any) => call.command === "start_terminal")
          .map((call: any) => call.args.request.profileId),
      ),
    )
    .toEqual(["local:bash", "local:fish", "local:fish"]);
});

async function dockFile(
  page: Page,
  name = "README.md",
  side: "left" | "right" | "top" | "bottom" = "right",
) {
  const area = (await page.locator(".terminal-layout").boundingBox())!;
  await grab(page, page.getByRole("tab", { name: new RegExp(name) }));
  await page.mouse.move(
    area.x +
      area.width * (side === "left" ? 0.1 : side === "right" ? 0.9 : 0.5),
    area.y +
      area.height * (side === "top" ? 0.1 : side === "bottom" ? 0.9 : 0.5),
    { steps: 10 },
  );
  await expect(page.locator(".tab-merge-preview")).toHaveAttribute(
    "data-side",
    side,
  );
  await expect(page.locator(".tab-merge-preview")).not.toHaveClass(
    /is-blocked/,
  );
  await page.mouse.up();
  await expect(
    page.getByRole("region", { name: `Editor for ${name}` }),
  ).toBeVisible();
}

for (const side of ["left", "right", "top", "bottom"] as const) {
  test(`docks a modified file on the ${side} beside three live terminals and restores the layout`, async ({
    page,
  }) => {
    await setup(page, 1);
    await page.keyboard.press("Control+d");
    await page.keyboard.press("Control+Shift+d");
    await expect(page.locator(".xterm-screen")).toHaveCount(3);
    await page.getByRole("button", { name: "README.md", exact: true }).click();
    const editor = page.locator(".cm-content");
    await expect(editor).toBeVisible();
    await editor.fill("mixed panels 🦀");
    await page.getByRole("tab", { name: "Terminal 1", exact: true }).click();
    await page.locator("[data-pane-id]").evaluateAll((elements) => {
      (window as any).__terminalHosts = elements;
    });
    await dockFile(page, "README.md", side);
    await expect(page.getByRole("tab")).toHaveCount(1);
    await expect(page.getByRole("tab")).toContainText("●");
    await expect(editor).toHaveText("mixed panels 🦀");
    await expect(editor).toBeFocused();
    expect(
      await page
        .locator("[data-pane-id]")
        .evaluateAll((elements) =>
          elements.every(
            (element, index) =>
              element === (window as any).__terminalHosts[index],
          ),
        ),
    ).toBe(true);
    await page.evaluate(() => {
      const native = (window as any).__nativeTest;
      for (const id of native.sessions.keys())
        native.emit(id, "\r\nRUNNING WITH EDITOR\r\n");
    });
    for (const pane of await page.locator("[data-pane-id]").all()) {
      const id = (await pane.getAttribute("data-pane-id"))!;
      await expect
        .poll(() => buffer(page, id))
        .toContain("RUNNING WITH EDITOR");
    }
    await page.keyboard.press("Control+s");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).__nativeTest.editorFiles["/project/README.md"]
              .content,
        ),
      )
      .toBe("mixed panels 🦀");
    await page.keyboard.press("Control+z");
    await expect(editor).toContainText("A text file preview.");
    await page.keyboard.press("Control+Shift+z");
    await expect(editor).toHaveText("mixed panels 🦀");
    await page.locator(".xterm-helper-textarea").first().focus();
    await expect(page.locator(".editor-status")).toHaveCount(0);
    await page.getByRole("button", { name: "README.md", exact: true }).click();
    await expect(editor).toBeFocused();
    await expect(page.getByRole("tab")).toHaveCount(1);
    await expect(page.locator(".editor-status")).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          (window as any).__nativeTest.calls.filter(
            (call: any) => call.command === "start_terminal",
          ).length,
      ),
    ).toBe(3);
    expect(
      await page.evaluate(() =>
        (window as any).__nativeTest.calls.filter(
          (call: any) => call.command === "close_terminal",
        ),
      ),
    ).toEqual([]);
    await expect.poll(async () => (await savedTabs(page))?.length).toBe(1);
    if (side === "right")
      await page.screenshot({
        path: "test-results/three-terminals-and-file.png",
      });
    await page.reload();
    await expect(page.locator(".xterm-screen")).toHaveCount(3);
    await expect(editor).toHaveText("mixed panels 🦀");
    await expect(editor).toBeFocused();
    await page.keyboard.press("Control+w");
    await expect(editor).toHaveCount(0);
    await expect(page.locator(".xterm-screen")).toHaveCount(3);
    await expect(page.getByRole("tab")).toHaveCount(1);
  });
}

test("closing a file panel or its whole tab protects unsaved edits and failed saves", async ({
  page,
}) => {
  await setup(page, 1);
  await page.getByRole("button", { name: "README.md", exact: true }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.locator(".cm-content").fill("keep this file");
  await page.getByRole("tab", { name: "Terminal 1", exact: true }).click();
  await dockFile(page);
  const dialog = page.getByRole("dialog", {
    name: "Save changes before closing?",
  });
  await page.keyboard.press("Control+w");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".cm-content")).toHaveText("keep this file");
  await page
    .getByRole("button", { name: "Close README.md panel", exact: true })
    .click();
  await page.evaluate(() => {
    (window as any).__nativeTest.failFileSave = true;
  });
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveText("Disk is full");
  await expect(page.locator(".cm-content")).toHaveText("keep this file");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("tab").click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Close Clean", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+Shift+w");
  await expect(dialog).toBeVisible();
  await expect(page.locator(".xterm-screen")).toHaveCount(1);
  await dialog
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(page.locator(".cm-content")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__nativeTest.calls.filter(
            (call: any) => call.command === "close_terminal",
          ).length,
      ),
    )
    .toBe(1);
});

test("two file panels retain independent focus, positions and buffers when the last terminal closes", async ({
  page,
}) => {
  const workspace = await setup(page, 1);
  await page.getByRole("button", { name: "README.md", exact: true }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.getByRole("tab", { name: "Terminal 1", exact: true }).click();
  await dockFile(page);
  await page
    .getByRole("button", { name: "it's a file.txt", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Editor for it's a file.txt" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Terminal 1", exact: true }).click();
  await dockFile(page, "it's a file.txt", "bottom");
  const readme = page
    .getByRole("region", { name: "Editor for README.md" })
    .locator(".cm-content");
  const text = page
    .getByRole("region", { name: "Editor for it's a file.txt" })
    .locator(".cm-content");
  await readme.fill("first file");
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowRight");
  await text.fill("second file");
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.press("Control+w");
  await expect(page.locator(".xterm-screen")).toHaveCount(0);
  await expect(readme).toHaveText("first file");
  await expect(text).toHaveText("second file");
  await page.keyboard.press("Control+Shift+t");
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.locator(".cm-content")).toHaveCount(0);
  await page.getByRole("tab", { name: /Terminal 1/ }).click();
  await expect(readme).toHaveText("first file");
  await expect(text).toHaveText("second file");
  await readme.focus();
  await expect(page.locator(".editor-status")).toContainText("Ln 1, Col 2");
  await page.keyboard.press("Control+s");
  await text.focus();
  await expect(page.locator(".editor-status")).toContainText("Ln 1, Col 3");
  await page.keyboard.press("Control+s");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const saved = JSON.parse(localStorage.getItem("test-session") ?? "null")
          ?.projects[0].workspaces[0];
        return {
          activeTabId: saved?.activeTabId,
          head: saved?.tabs[0].layout?.second?.position?.head,
        };
      }),
    )
    .toEqual({ activeTabId: workspace.tabs[0].id, head: 2 });
  await page.reload();
  await expect(readme).toHaveText("first file");
  await expect(text).toHaveText("second file");
  await expect(page.locator(".xterm-screen")).toHaveCount(0);
  await readme.focus();
  await page.keyboard.press("Control+d");
  await expect(page.locator(".xterm-screen")).toHaveCount(1);
  await expect(readme).toHaveText("first file");
});

test("a docked editor remains usable at minimum window size", async ({
  page,
}) => {
  await setup(page, 1);
  await page.getByRole("button", { name: "README.md", exact: true }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.getByRole("tab", { name: "Terminal 1", exact: true }).click();
  await dockFile(page);
  await page.setViewportSize({ width: 800, height: 420 });
  await expect(page.locator(".cm-content")).toBeVisible();
  const heading = page.locator(".editor-heading");
  expect(
    await heading.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Close README.md panel", exact: true }),
  ).toBeInViewport();
  await page.screenshot({ path: "test-results/mixed-panels-minimum.png" });
});
