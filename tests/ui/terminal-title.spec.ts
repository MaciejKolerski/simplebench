import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { newId, newPane, newProject, newSession } from "../../src/model";
import { buffer, mockDesktop } from "./desktop";

async function emit(page: Page, id: string, ...chunks: string[]) {
  await page.evaluate(
    async ({ id, chunks }) => {
      const { runningTerminal } = await import("/src/terminal-runtime.ts");
      const runtime = runningTerminal(id)!;
      for (const chunk of chunks)
        (window as any).__nativeTest.emit(runtime.sessionId, chunk);
      await new Promise<void>((resolve) => runtime.terminal.write("", resolve));
    },
    { id, chunks },
  );
}

async function setup(page: Page) {
  const project = newProject("/project", "local:bash");
  const tab = project.workspaces[0].tabs[0];
  if (tab.type !== "terminal") throw new Error("Expected terminal tab");
  const first = tab.activePaneId;
  const second = newPane("/project");
  tab.layout = {
    type: "split",
    id: newId(),
    axis: "horizontal",
    ratio: 0.45,
    first: tab.layout,
    second,
  };
  await mockDesktop(page, false, {
    ...newSession(),
    projects: [project],
    activeProjectId: project.id,
  });
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => (window as any).__nativeTest.sessions.size))
    .toBe(2);
  await expect.poll(() => buffer(page, first)).toContain("bash $ ");
  await expect.poll(() => buffer(page, second.id)).toContain("bash $ ");
  return { first, second: second.id, layout: tab.layout };
}

test("titles appear only for multiple terminals in the same tab and retain hidden updates", async ({
  page,
}, testInfo) => {
  const { first, second } = await setup(page);
  const pane = page.locator(`[data-pane-id="${first}"]`);
  const other = page.locator(`[data-pane-id="${second}"]`);
  await emit(page, first, "\x1b]133;C\x07\x1b]2;Pierwsza rozmowa\x07");
  await emit(page, second, "\x1b]133;C\x07\x1b]2;Druga rozmowa\x07");
  await expect(pane.locator(".terminal-title")).toHaveText("Pierwsza rozmowa");
  await expect(other.locator(".terminal-title")).toHaveText("Druga rozmowa");
  await other.locator(".xterm-helper-textarea").focus();
  await page.keyboard.press("Control+w");
  await expect(page.locator("[data-pane-id]")).toHaveCount(1);
  await expect(page.locator(".terminal-heading")).toHaveCount(0);
  await emit(page, first, "\x1b]2;⠋ Zmieniona rozmowa po /resume\x07");
  await expect(page.locator(".terminal-heading")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("single-terminal.png") });

  await page.keyboard.press("Control+Shift+t");
  await expect(page.getByRole("tab")).toHaveCount(2);
  const newId = (await page
    .locator("[data-pane-id]")
    .getAttribute("data-pane-id"))!;
  await expect.poll(() => buffer(page, newId)).toContain("bash $ ");
  await emit(page, newId, "\x1b]133;C\x07\x1b]2;Inna zakładka\x07");
  await expect(page.locator(".terminal-heading")).toHaveCount(0);
  await page.getByRole("tab", { name: "Terminal", exact: true }).click();
  await expect(pane).toBeVisible();
  await expect(pane.locator(".terminal-heading")).toHaveCount(0);
  await pane.locator(".xterm-helper-textarea").focus();
  await page.keyboard.press("Control+d");
  await expect(page.locator("[data-pane-id]")).toHaveCount(2);
  const added = page.locator("[data-pane-id]").last();
  const addedId = (await added.getAttribute("data-pane-id"))!;
  await expect.poll(() => buffer(page, addedId)).toContain("bash $ ");
  await emit(page, addedId, "\x1b]133;C\x07\x1b]2;Nowa rozmowa\x07");
  await expect(pane.locator(".terminal-title")).toHaveText(
    "Zmieniona rozmowa po /resume",
  );
  await expect(pane.getByRole("img", { name: "Working" })).toBeVisible();
  await expect(added.locator(".terminal-title")).toHaveText("Nowa rozmowa");
  await page.screenshot({
    path: testInfo.outputPath("split-terminal-titles.png"),
  });
});

test("CLI titles parse across chunks, restore from the title stack and update while hidden", async ({
  page,
}) => {
  const { first, second } = await setup(page);
  const title = page.locator(`[data-pane-id="${first}"] .terminal-title`);
  await expect(title).toHaveCount(0);
  await emit(page, first, "\x1b]0;Shell title\x07\x1b[22;2t");
  await expect(title).toHaveCount(0);
  await emit(
    page,
    first,
    "codex\r\n\x1b]133;C\x07",
    "\x1b]2;Codex · Napraw ",
    "logowanie 🦀\x1b",
    "\\",
  );
  await expect(title).toHaveText("Codex · Napraw logowanie 🦀");
  await emit(page, first, "\x1b]2;Codex · Resumed conversation\x07");
  await expect(title).toHaveText("Codex · Resumed conversation");
  await emit(page, first, "\x1b[23;2t");
  await expect(title).toHaveText("Shell title");
  await emit(page, first, "\x1b]2;<img src=x onerror=alert(1)>\x07");
  await expect(title).toHaveText("<img src=x onerror=alert(1)>");
  await expect(title.locator("img")).toHaveCount(0);
  await emit(page, first, `\x1b]2;${"Long title ".repeat(300)}\x07`);
  await expect.poll(async () => (await title.textContent())!.length).toBe(1024);
  await emit(page, first, "\x1b]2;\x07");
  await expect(title).toHaveCount(0);
  await page.keyboard.press("Control+Shift+t");
  await expect(page.getByRole("tab")).toHaveCount(2);
  await emit(
    page,
    first,
    "\x1b]2;Claude Code · Background rename\x07\r\nStill running\r\n",
  );
  await emit(
    page,
    second,
    "cursor\r\n\x1b]133;C\x07\x1b]0;Cursor · Independent conversation\x07",
  );
  await expect.poll(() => buffer(page, first)).toContain("Still running");
  await page.getByRole("tab", { name: "Terminal", exact: true }).click();
  await expect(title).toHaveText("Claude Code · Background rename");
  await expect(
    page.locator(`[data-pane-id="${second}"] .terminal-title`),
  ).toHaveText("Cursor · Independent conversation");
  expect(await buffer(page, first)).not.toContain("Background rename");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const workspace = JSON.parse(
          localStorage.getItem("test-session") ?? "null",
        )?.projects[0].workspaces[0];
        return (
          workspace?.tabs.length === 2 &&
          workspace.activeTabId === workspace.tabs[0].id
        );
      }),
    )
    .toBe(true);
  expect(
    await page.evaluate(() => localStorage.getItem("test-session")),
  ).not.toContain("Background rename");
  await page.reload();
  await expect(
    page.locator(`[data-pane-id="${first}"] .xterm-screen`),
  ).toBeVisible();
  await expect.poll(() => buffer(page, first)).toContain("bash $ ");
  await expect(title).toHaveCount(0);
});

test("CLI titles overlay the terminal and disappear at the prompt without resizing it", async ({
  page,
}) => {
  const { first } = await setup(page);
  const pane = page.locator(`[data-pane-id="${first}"]`);
  const mount = pane.locator(".terminal-mount");
  const title = pane.locator(".terminal-title");
  const before = await mount.boundingBox();
  const dimensions = () =>
    page.evaluate(async (id) => {
      const { runningTerminal } = await import("/src/terminal-runtime.ts");
      const { cols, rows } = runningTerminal(id)!.terminal;
      return { cols, rows };
    }, first);
  const size = await dimensions();
  await expect(title).toHaveCount(0);
  // Command lifecycle reports work even when the prompt text was not captured.
  await emit(page, first, "\x1b]133;C\x07\x1b]2;Codex\x07");
  await expect(title).toHaveText("Codex");
  expect(await mount.boundingBox()).toEqual(before);
  expect(await dimensions()).toEqual(size);
  const heading = (await pane.locator(".terminal-title-box").boundingBox())!;
  expect(heading.y).toBeLessThan(before!.y + 8);
  await page.mouse.click(before!.x + 12, heading.y + heading.height / 2);
  await expect(pane.locator(".xterm-helper-textarea")).toBeFocused();
  await page.keyboard.press("Control+Shift+f");
  const search = pane.getByRole("textbox", { name: "Search terminal output" });
  await expect(search).toBeFocused();
  expect((await title.boundingBox())!.y).toBeGreaterThan(
    (await search.boundingBox())!.y + (await search.boundingBox())!.height,
  );
  await search.press("Escape");
  await emit(page, first, "\x1b]133;D;0\x07\x1b]0;Shell title\x07");
  await expect(title).toHaveCount(0);
  expect(await mount.boundingBox()).toEqual(before);
  expect(await dimensions()).toEqual(size);
  await emit(page, first, "\x1b]133;C\x07");
  await expect(title).toHaveCount(0);
  await emit(page, first, "\x1b]2;Next CLI\x07");
  await expect(title).toHaveText("Next CLI");
  await pane
    .getByRole("button", { name: "Maximize terminal", exact: true })
    .click();
  await emit(page, first, "\x1b]133;A\x07bash $ \x1b]133;B\x07");
  await expect(title).toHaveCount(0);
  await pane.getByRole("button", { name: "Restore terminal size" }).click();
  await expect(page.locator("[data-pane-id]")).toHaveCount(2);
  await expect(pane.locator(".terminal-heading")).toHaveCount(0);
});

test("any CLI can publish a title without a shell pre-execution report", async ({
  page,
}) => {
  const { first } = await setup(page);
  const pane = page.locator(`[data-pane-id="${first}"]`);
  const title = pane.locator(".terminal-title");
  await emit(page, first, "\x1b]2;Shell prompt\x07");
  await expect(title).toHaveCount(0);
  await pane.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("unlisted-agent --resume");
  await page.keyboard.press("Enter");
  await expect(title).toHaveCount(0);
  await emit(page, first, "\x1b]2;Rozmowa 🦀\x1b\\");
  await expect(title).toHaveText("Rozmowa 🦀");
  const input = await page.evaluate(() => {
    return (window as any).__nativeTest.calls
      .filter((call: any) => call.command === "write_terminal")
      .map((call: any) => call.args.data)
      .join("");
  });
  expect(input).toBe("unlisted-agent --resume\r");
  await emit(page, first, "\x1b]0;Nowy tytuł\x07");
  await expect(title).toHaveText("Nowy tytuł");
  await emit(page, first, "\x1b]133;A\x07\x1b]2;Shell prompt\x07");
  await expect(title).toHaveCount(0);
});

test("terminal titles work without any shell reports", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const { TerminalRuntime } = await import("/src/terminal-runtime.ts");
    const runtime = new TerminalRuntime(
      "without-shell-reports",
      {
        id: "local:sh",
        kind: "sh",
        name: "sh",
        program: "/bin/sh",
        home: "/project",
        distro: null,
      },
      "/project",
    );
    const titles: string[] = [];
    for (const output of [
      "\x1b]2;Dowolne CLI 🦀\x07",
      "\x1b[22;2t\x1b]0;Wznowiona rozmowa\x1b\\",
      "\x1b[23;2t",
      "\x1b]2;\x07",
    ]) {
      await new Promise<void>((resolve) =>
        runtime.terminal.write(output, resolve),
      );
      titles.push(runtime.getSnapshot().title);
    }
    runtime.dispose();
    return titles;
  });
  expect(result).toEqual([
    "Dowolne CLI 🦀",
    "Wznowiona rozmowa",
    "Dowolne CLI 🦀",
    "",
  ]);
});

test("a foreground process supplies a fallback without replacing a published title", async ({
  page,
}, testInfo) => {
  const { first } = await setup(page);
  const pane = page.locator(`[data-pane-id="${first}"]`);
  const title = pane.locator(".terminal-title");
  await emit(page, first, "agy\r\n\x1b]133;C\x07");
  await page.evaluate(async (id) => {
    const { runningTerminal } = await import("/src/terminal-runtime.ts");
    (window as any).__nativeTest.terminalContexts[
      runningTerminal(id)!.sessionId
    ] = { cwd: "/project", foregroundProgram: "agy" };
  }, first);
  await expect(title).toHaveText("agy");
  await pane.locator(".terminal-title-box").screenshot({
    path: testInfo.outputPath("foreground-program.png"),
  });
  await emit(page, first, "\x1b]2;Data Wydania Dipsick V4\x07");
  await expect(title).toHaveText("Data Wydania Dipsick V4");
  await pane.locator(".terminal-title-box").screenshot({
    path: testInfo.outputPath("agy-conversation-title.png"),
  });
  await emit(page, first, "\x1b]2;Inna rozmowa po /resume\x07");
  await expect(title).toHaveText("Inna rozmowa po /resume");
  await emit(page, first, "\x1b]2;\x07");
  await expect(title).toHaveText("agy");
  await emit(page, first, "\x1b]133;D;0\x07\x1b]133;A\x07");
  await expect(title).toHaveCount(0);
  const observations = () =>
    page.evaluate(
      () =>
        (window as any).__nativeTest.calls.filter(
          (call: any) => call.command === "terminal_contexts",
        ).length,
    );
  const before = await observations();
  await expect.poll(observations).toBeGreaterThan(before);
  await expect(title).toHaveCount(0);
});

for (const colorScheme of ["dark", "light"] as const) {
  test(`overview toggles live titles without restarting terminals in ${colorScheme} mode`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme });
    const { first, second } = await setup(page);
    const pane = page.locator(`[data-pane-id="${first}"]`);
    const other = page.locator(`[data-pane-id="${second}"]`);
    const toggle = page.getByRole("button", {
      name: "Toggle terminal overview (Ctrl+Tab)",
      exact: true,
    });
    await emit(
      page,
      first,
      "\x1b]133;C\x07\x1b]2;Data Wydania Dipsick V4\x07\r\nExisting context\r\n",
    );
    await emit(page, second, "\x1b]133;C\x07\x1b]2;Inna rozmowa 🦀\x07");
    await pane.locator(".xterm-helper-textarea").focus();
    await page.keyboard.press("Control+Shift+i");
    const composer = pane.getByRole("textbox", {
      name: "Command input",
      exact: true,
    });
    await composer.fill("Unsent draft");
    const before = await pane.boundingBox();
    const sessions = await page.evaluate(() => [
      ...(window as any).__nativeTest.sessions.keys(),
    ]);
    await composer.press("Control+Tab");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(pane.locator(".terminal-overview")).toHaveText(
      "Data Wydania Dipsick V4",
    );
    await expect(other.locator(".terminal-overview")).toHaveText(
      "Inna rozmowa 🦀",
    );
    await expect(pane.locator(".terminal-overview")).toBeFocused();
    await expect(composer).toBeHidden();
    await expect(page.locator(".xterm-screen")).toHaveCount(2);
    await expect(pane.locator(".xterm-screen")).toBeHidden();
    await expect(other.locator(".xterm-screen")).toBeHidden();
    expect(await pane.boundingBox()).toEqual(before);
    await page.keyboard.type("must not reach the shell");
    await page.keyboard.press("Enter");
    await emit(
      page,
      first,
      "\x1b]2;Nowa nazwa po /resume\x07\r\nBackground context\r\n",
    );
    await expect(pane.locator(".terminal-overview")).toHaveText(
      "Nowa nazwa po /resume",
    );
    await expect
      .poll(() => buffer(page, first))
      .toContain("Background context");
    const card = (await pane.locator(".terminal-overview span").boundingBox())!;
    expect(card.x + card.width / 2).toBeCloseTo(
      before!.x + before!.width / 2,
      0,
    );
    expect(card.y + card.height / 2).toBeCloseTo(
      before!.y + before!.height / 2,
      0,
    );
    await page.screenshot({
      path: testInfo.outputPath(`overview-${colorScheme}.png`),
    });
    await page.keyboard.press("Control+Tab");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".xterm-screen")).toHaveCount(2);
    await expect(composer).toHaveValue("Unsent draft");
    await expect(pane.locator(".xterm-helper-textarea")).toBeFocused();
    await expect(pane.locator(".terminal-title")).toHaveText(
      "Nowa nazwa po /resume",
    );
    expect(await buffer(page, first)).toContain("Existing context");
    await toggle.click();
    await expect(page.locator(".terminal-overview")).toHaveCount(2);
    await other.locator(".terminal-overview").click();
    await toggle.click();
    await expect(other.locator(".xterm-helper-textarea")).toBeFocused();
    expect(
      await page.evaluate(() => [
        ...(window as any).__nativeTest.sessions.keys(),
      ]),
    ).toEqual(sessions);
    expect(
      await page.evaluate(() =>
        (window as any).__nativeTest.calls.filter((call: any) =>
          ["write_terminal", "close_terminal"].includes(call.command),
        ),
      ),
    ).toEqual([]);
  });

  test(`CLI activity keeps a stable spinner and animation across state changes in ${colorScheme} mode`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme, reducedMotion: "no-preference" });
    const { first } = await setup(page);
    const pane = page.locator(`[data-pane-id="${first}"]`);
    const title = pane.locator(".terminal-title");
    const heading = pane.locator(".terminal-title-box");
    const spinner = pane.getByRole("img", { name: "Working", exact: true });
    const name = "Ulepsz system zakładek";
    await emit(page, first, `codex\r\n\x1b]133;C\x07\x1b]2;${name}\x07`);
    await expect(title).toHaveText(name);
    await expect(spinner).toHaveCount(0);
    const bounds = await heading.boundingBox();
    await pane.locator(".terminal-spinner").evaluate((element) => {
      (window as any).__titleIndicator = element;
      (window as any).__titleAnimation = element
        .querySelector("circle")!
        .getAnimations()
        .find(
          (animation) =>
            (animation as CSSAnimation).animationName === "terminal-spin",
        );
    });
    await emit(page, first, `\x1b]2;⠋ ${name}\x07`);
    await expect(spinner).toBeVisible();
    await expect(title).toHaveText(name);
    await expect(title).toHaveAttribute("title", name);
    expect(await heading.boundingBox()).toEqual(bounds);
    await expect(spinner.locator("circle")).toHaveCSS(
      "animation-name",
      "terminal-spin",
    );
    const frames = await spinner.evaluate(async (element) => {
      const slot = element.parentElement!;
      const frames = [];
      for (let index = 0; index < 10; index++) {
        await new Promise((resolve) => setTimeout(resolve, 90));
        const bounds = element.getBoundingClientRect();
        frames.push({
          slot: slot.getBoundingClientRect().toJSON(),
          x: bounds.x + bounds.width / 2,
          y: bounds.y + bounds.height / 2,
          time: Number((window as any).__titleAnimation.currentTime),
        });
      }
      return frames;
    });
    for (const [index, frame] of frames.entries()) {
      expect(frame.slot).toEqual(frames[0].slot);
      expect(frame.x).toBeCloseTo(frame.slot.x + frame.slot.width / 2, 3);
      expect(frame.y).toBeCloseTo(frame.slot.y + frame.slot.height / 2, 3);
      expect(frame.y).toBeCloseTo(bounds!.y + bounds!.height / 2, 3);
      if (index) expect(frame.time).toBeGreaterThan(frames[index - 1].time);
    }
    await page.evaluate(async (id) => {
      const { runningTerminal } = await import("/src/terminal-runtime.ts");
      (window as any).__spinnerSnapshot = runningTerminal(id)!.getSnapshot();
    }, first);
    for (const frame of "⠙⠹⠸⠼⠴⠦⠧⠇⠏⠋")
      await emit(page, first, `\x1b]2;${frame} ${name}\x07`);
    expect(
      await page.evaluate(async (id) => {
        const { runningTerminal } = await import("/src/terminal-runtime.ts");
        return (
          runningTerminal(id)!.getSnapshot() ===
          (window as any).__spinnerSnapshot
        );
      }, first),
    ).toBe(true);
    await emit(page, first, `\x1b]2;${name}\x07`);
    await expect(spinner).toHaveCount(0);
    await expect(pane.locator(".terminal-spinner circle")).toHaveCSS(
      "animation-play-state",
      "paused",
    );
    expect(await heading.boundingBox()).toEqual(bounds);
    await emit(page, first, `\x1b]2;⠙ ${name}\x07`);
    await expect(spinner).toBeVisible();
    expect(
      await spinner.evaluate(
        (element) =>
          element === (window as any).__titleIndicator &&
          element
            .querySelector("circle")!
            .getAnimations()
            .includes((window as any).__titleAnimation),
      ),
    ).toBe(true);
    await expect(spinner).toHaveCSS("opacity", "1");
    await heading.screenshot({
      path: testInfo.outputPath(`spinner-${colorScheme}.png`),
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(spinner.locator("circle")).toHaveCSS("animation-name", "none");
    await page.keyboard.press("Control+Shift+t");
    await page.getByRole("tab", { name: "Terminal", exact: true }).click();
    await expect(spinner).toBeVisible();
    await emit(page, first, `\x1b]2;${name}\x07`);
    await expect(spinner).toHaveCount(0);
    await expect(title).toHaveText(name);
    await emit(page, first, "\x1b]2;Znaki ⠋ w tytule\x07");
    await expect(title).toHaveText("Znaki ⠋ w tytule");
    await expect(spinner).toHaveCount(0);
    await emit(page, first, "\x1b]2;⠋\x07");
    await expect(spinner).toBeVisible();
    await expect(title).toHaveCount(0);
    await emit(page, first, "\x1b]133;D;0\x07");
    await expect(heading).toHaveCount(0);
  });

  test(`maximizing preserves PTYs and restores the layout in ${colorScheme} mode`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme });
    const { first, second, layout } = await setup(page);
    const pane = page.locator(`[data-pane-id="${first}"]`);
    const before = (await pane.boundingBox())!;
    await emit(
      page,
      first,
      "codex\r\n\x1b]133;C\x07\x1b]2;Codex · Napraw logowanie i przywracanie sesji\x07\r\nConversation stays alive\r\n",
    );
    await expect(pane.locator(".terminal-title")).toContainText(
      "Napraw logowanie",
    );
    await page.evaluate(async (id) => {
      const { runningTerminal } = await import("/src/terminal-runtime.ts");
      const runtime = runningTerminal(id)!;
      (window as any).__maximizedTest = { runtime, host: runtime.host };
    }, first);
    await pane
      .getByRole("button", { name: "Maximize terminal", exact: true })
      .click();
    await expect(page.locator("[data-pane-id]")).toHaveCount(1);
    await expect(
      pane.getByRole("button", { name: "Restore terminal size" }),
    ).toHaveAttribute("aria-pressed", "true");
    const area = (await page.locator(".terminal-layout").boundingBox())!;
    const expanded = (await pane.boundingBox())!;
    expect(expanded.width).toBeCloseTo(area.width, 0);
    expect(expanded.height).toBeCloseTo(area.height, 0);
    expect(expanded.width).toBeGreaterThan(before.width);
    await expect(pane.locator(".xterm-helper-textarea")).toBeFocused();
    await emit(
      page,
      second,
      "cursor\r\n\x1b]133;C\x07\x1b]2;Cursor · Working in background\x07\r\nBackground work\r\n",
    );
    await expect.poll(() => buffer(page, second)).toContain("Background work");
    expect(
      await page.evaluate(async (id) => {
        const { runningTerminal } = await import("/src/terminal-runtime.ts");
        const runtime = runningTerminal(id)!;
        return {
          connected: runtime.host.isConnected,
          webgl: !!runtime.host.querySelector(
            ".xterm-screen > canvas:not(.xterm-link-layer)",
          ),
        };
      }, second),
    ).toEqual({ connected: false, webgl: false });
    await page.setViewportSize({ width: 800, height: 420 });
    await expect(
      pane.getByRole("button", { name: "Restore terminal size" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const runtime = (window as any).__maximizedTest.runtime;
          const size = runtime.fitAddon.proposeDimensions();
          return (
            runtime.terminal.cols === size?.cols &&
            runtime.terminal.rows === size?.rows
          );
        }),
      )
      .toBe(true);
    await expect
      .poll(async () => {
        const heading = (await pane
          .locator(".terminal-title-box")
          .boundingBox())!;
        const small = (await pane.boundingBox())!;
        return heading.x + heading.width / 2 - small.x - small.width / 2;
      })
      .toBeCloseTo(0, 0);
    await page.screenshot({
      path: testInfo.outputPath(`terminal-maximized-${colorScheme}.png`),
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await pane.getByRole("button", { name: "Restore terminal size" }).click();
    await expect(page.locator("[data-pane-id]")).toHaveCount(2);
    await expect
      .poll(async () => (await pane.boundingBox())!.width)
      .toBeCloseTo(before.width, 0);
    await expect(
      page.locator(`[data-pane-id="${second}"] .terminal-title`),
    ).toHaveText("Cursor · Working in background");
    expect(await buffer(page, first)).toContain("Conversation stays alive");
    const state = await page.evaluate(async (id) => {
      const { runningTerminal } = await import("/src/terminal-runtime.ts");
      const state = (window as any).__maximizedTest;
      const calls = (window as any).__nativeTest.calls;
      return {
        same:
          runningTerminal(id) === state.runtime &&
          state.host === state.runtime.host,
        starts: calls.filter((call: any) => call.command === "start_terminal")
          .length,
        closes: calls.filter((call: any) => call.command === "close_terminal")
          .length,
      };
    }, first);
    expect(state).toEqual({ same: true, starts: 2, closes: 0 });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("test-session") ?? "null")
              ?.projects[0].workspaces[0].tabs[0].layout,
        ),
      )
      .toEqual(layout);
    await page.screenshot({
      path: testInfo.outputPath(`terminal-titles-${colorScheme}.png`),
    });
    await pane
      .getByRole("button", { name: "Maximize terminal", exact: true })
      .click();
    await page.keyboard.press("Control+d");
    await expect(page.locator("[data-pane-id]")).toHaveCount(3);
    await expect(
      page.getByRole("button", { name: "Restore terminal size" }),
    ).toHaveCount(0);
    await pane
      .getByRole("button", { name: "Maximize terminal", exact: true })
      .click();
    await page.keyboard.press("Control+w");
    await page
      .getByRole("dialog", { name: "Close running processes?" })
      .getByRole("button", { name: "Close anyway", exact: true })
      .click();
    await expect(pane).toHaveCount(0);
    await expect(page.locator("[data-pane-id]")).toHaveCount(2);
    await expect(
      page.getByRole("button", { name: "Restore terminal size" }),
    ).toHaveCount(0);
  });
}

test("overview reveals maximized splits and restores the previous view", async ({
  page,
}) => {
  const { first } = await setup(page);
  const pane = page.locator(`[data-pane-id="${first}"]`);
  await emit(page, first, "\x1b]133;C\x07\x1b]2;Maximized conversation\x07");
  await pane
    .getByRole("button", { name: "Maximize terminal", exact: true })
    .click();
  await expect(page.locator("[data-pane-id]")).toHaveCount(1);
  await page.keyboard.press("Control+Tab");
  await expect(page.locator(".terminal-overview")).toHaveText([
    "Maximized conversation",
    "bash",
  ]);
  await page.keyboard.press("Control+Tab");
  await expect(page.locator("[data-pane-id]")).toHaveCount(1);
  await expect(
    pane.getByRole("button", { name: "Restore terminal size" }),
  ).toBeVisible();
});

test("overview respects custom bindings and pointer focus with a single terminal", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.addInitScript(() =>
    localStorage.setItem(
      "test-keybindings",
      JSON.stringify({
        version: 1,
        focusFollowsPointer: true,
        bindings: { terminalOverview: "Ctrl+KeyO", nextTab: "Ctrl+Tab" },
      }),
    ),
  );
  await page.goto("/");
  await expect(page.locator(".xterm-screen")).toBeVisible();
  const toggle = page.getByRole("button", {
    name: "Toggle terminal overview (Ctrl+O)",
    exact: true,
  });
  await page.keyboard.press("Control+Shift+t");
  await expect(page.getByRole("tab", { selected: true })).toHaveText(
    "Terminal 2",
  );
  await page.keyboard.press("Control+Tab");
  await expect(page.getByRole("tab", { selected: true })).toHaveText(
    "Terminal",
  );
  await page.keyboard.press("Control+o");
  await expect(page.locator(".terminal-overview")).toHaveText("bash");
  await page.locator(".sidebar-heading").hover();
  await page.locator(".terminal-overview").hover();
  await expect(page.locator(".terminal-overview")).toBeFocused();
  await toggle.click();
  await expect(page.locator(".xterm-helper-textarea")).toBeFocused();
  await expect(page.locator(".terminal-heading")).toHaveCount(0);
  await page.keyboard.press("Control+Shift+l");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Control+o");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});

test("maximizing a terminal retains a hidden editor's unsaved text and undo history", async ({
  page,
}) => {
  const project = newProject("/project", "local:bash");
  const tab = project.workspaces[0].tabs[0];
  if (tab.type !== "terminal") throw new Error("Expected terminal tab");
  tab.layout = {
    type: "split",
    id: newId(),
    axis: "horizontal",
    ratio: 0.5,
    first: tab.layout,
    second: {
      type: "file",
      id: newId(),
      title: "main.ts",
      root: "/project",
      relative: "main.ts",
    },
  };
  await mockDesktop(page, false, {
    ...newSession(),
    projects: [project],
    activeProjectId: project.id,
  });
  await page.goto("/");
  await expect(page.locator(".xterm-screen")).toBeVisible();
  await expect.poll(() => buffer(page, tab.activePaneId)).toContain("bash $ ");
  await emit(page, tab.activePaneId, "codex\r\n\x1b]133;C\x07\x1b]2;Codex\x07");
  await expect(page.locator(".terminal-title")).toHaveCount(0);
  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible();
  const original = await editor.innerText();
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\nUnsaved work");
  await expect(editor).toContainText("Unsaved work");
  await page
    .getByRole("button", { name: "Maximize terminal", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await page.getByRole("button", { name: "Restore terminal size" }).click();
  await expect(editor).toContainText("Unsaved work");
  await editor.click();
  await page.keyboard.press("Control+z");
  await expect.poll(() => editor.innerText()).toBe(original);
  expect(
    await page.evaluate(() =>
      (window as any).__nativeTest.calls.filter(
        (call: any) => call.command === "save_editor_file",
      ),
    ),
  ).toEqual([]);
});
