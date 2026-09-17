import { expect, test, type Page } from "@playwright/test";
import { newPane, newProject, newSession, panes } from "../../src/model";
import { buffer, mockDesktop } from "./desktop";

const panels = [
  { id: "files", name: "file explorer", key: "e" },
  { id: "git", name: "source control", key: "g" },
  { id: "workspaces", name: "workspaces", key: null },
] as const;

async function finishMotion(page: Page) {
  await page.evaluate(() => {
    for (const animation of (window as any).__sidebarMotion.animations)
      animation.finish();
  });
  await expect(page.locator("html")).not.toHaveClass(/moving-panes/);
}

for (const side of ["left", "right"] as const) {
  for (const panel of panels) {
    test(`${panel.id} on the ${side} smoothly resizes retained terminals on opening and closing`, async ({
      page,
    }, testInfo) => {
      await page.emulateMedia({
        colorScheme: "dark",
        reducedMotion: "no-preference",
      });
      const project = newProject("/project", "local:bash");
      const tab = project.workspaces[0].tabs[0];
      if (tab.type !== "terminal") throw new Error("Expected terminal tab");
      if (panel.id !== "workspaces")
        tab.layout = {
          type: "split",
          id: "split",
          axis: "horizontal",
          ratio: 0.5,
          first: tab.layout,
          second: newPane("/project"),
        };
      const ids = panes(tab.layout).map((pane) => pane.id);
      const session = newSession();
      await mockDesktop(page, true, {
        ...session,
        sidebar: null,
        sidebarSides: { ...session.sidebarSides, [panel.id]: side },
        projects: [project],
        activeProjectId: project.id,
      });
      await page.goto("/");
      await expect(page.locator(".xterm-screen")).toHaveCount(ids.length);
      await expect
        .poll(() =>
          page.evaluate(async (ids) => {
            const { runningTerminal } =
              await import("/src/terminal-runtime.ts");
            return ids.every(
              (id) =>
                runningTerminal(id)?.getSnapshot().renderer === "WebGL" &&
                runningTerminal(id)?.getSnapshot().status === "running",
            );
          }, ids),
        )
        .toBe(true);
      await page.evaluate(async (ids) => {
        const { runningTerminal } = await import("/src/terminal-runtime.ts");
        const state = ((window as any).__sidebarMotion = {
          animations: [] as Animation[],
          panes: ids.map((id) => ({
            id,
            runtime: runningTerminal(id),
            element: document.querySelector(`[data-pane-id="${id}"]`)!,
            canvases: [...runningTerminal(id)!.host.querySelectorAll("canvas")],
          })),
        });
        const start = document.startViewTransition.bind(document);
        document.startViewTransition = (update) => {
          const transition = start(update);
          void transition.ready.then(() => {
            state.animations = document
              .getAnimations()
              .filter((animation) =>
                (animation.effect as KeyframeEffect).pseudoElement?.startsWith(
                  "::view-transition",
                ),
              );
            for (const animation of state.animations) {
              animation.pause();
              animation.currentTime = 90;
            }
          });
          return transition;
        };
      }, ids);
      for (const opening of [true, false]) {
        const before = await page
          .locator(".dock-pane-host > .split-child")
          .evaluateAll((panes) =>
            panes.map((pane) => pane.getBoundingClientRect().width),
          );
        await page.evaluate(() => {
          (window as any).__sidebarMotion.animations = [];
          (window as any).__sidebarMotion.callIndex = (
            window as any
          ).__nativeTest.calls.length;
        });
        if (opening || !panel.key)
          await page
            .getByRole("button", { name: new RegExp(`^Toggle ${panel.name}`) })
            .click();
        else await page.keyboard.press(`Control+Shift+${panel.key}`);
        await expect
          .poll(() =>
            page.evaluate(
              () => (window as any).__sidebarMotion.animations.length,
            ),
          )
          .toBeGreaterThan(0);
        const widths = await page
          .locator(".dock-pane-host > .split-child")
          .evaluateAll((panes) =>
            panes.map((pane) => ({
              during: parseFloat(
                getComputedStyle(
                  document.documentElement,
                  `::view-transition-group(${(pane as HTMLElement).style.viewTransitionName})`,
                ).width,
              ),
              after: pane.getBoundingClientRect().width,
            })),
          );
        for (const [index, width] of widths.entries()) {
          expect(width.during).toBeGreaterThan(
            Math.min(before[index], width.after),
          );
          expect(width.during).toBeLessThan(
            Math.max(before[index], width.after),
          );
          expect(
            opening ? width.after < before[index] : width.after > before[index],
          ).toBe(true);
        }
        await page.evaluate(
          (text) => {
            const state = (window as any).__sidebarMotion;
            for (const pane of state.panes)
              (window as any).__nativeTest.emit(
                pane.runtime.sessionId,
                `\r\n${text}\r\n`,
              );
          },
          `Streaming while ${opening ? "opening" : "closing"}`,
        );
        for (const id of ids)
          await expect
            .poll(() => buffer(page, id))
            .toContain(`Streaming while ${opening ? "opening" : "closing"}`);
        await page.screenshot({
          path: testInfo.outputPath(
            `${opening ? "open" : "close"}-midpoint.png`,
          ),
        });
        await finishMotion(page);
        expect(
          await page.evaluate(() => {
            const state = (window as any).__sidebarMotion;
            const calls = (window as any).__nativeTest.calls.slice(
              state.callIndex,
            );
            return state.panes.map(
              (pane: any) =>
                calls.filter(
                  (call: any) =>
                    call.command === "resize_terminal" &&
                    call.args.id === pane.runtime.sessionId,
                ).length,
            );
          }),
        ).toEqual(ids.map(() => 1));
      }
      expect(
        await page.evaluate(async () => {
          const { runningTerminal } = await import("/src/terminal-runtime.ts");
          return (window as any).__sidebarMotion.panes.every(
            (pane: any) =>
              runningTerminal(pane.id) === pane.runtime &&
              document.querySelector(`[data-pane-id="${pane.id}"]`) ===
                pane.element &&
              pane.canvases.every(
                (canvas: HTMLCanvasElement, index: number) =>
                  pane.runtime.host.querySelectorAll("canvas")[index] ===
                  canvas,
              ),
          );
        }),
      ).toBe(true);
      expect(
        await page.evaluate(() =>
          (window as any).__nativeTest.calls
            .filter((call: any) =>
              ["start_terminal", "close_terminal"].includes(call.command),
            )
            .map((call: any) => call.command),
        ),
      ).toEqual(ids.map(() => "start_terminal"));
    });
  }
}

for (const mode of ["animated", "reduced motion", "unsupported"] as const) {
  test(`rapid sidebar toggles preserve the latest layout with ${mode} motion`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({
      reducedMotion: mode === "reduced motion" ? "reduce" : "no-preference",
    });
    await mockDesktop(page);
    await page.goto("/");
    await expect(page.locator(".xterm-screen")).toBeVisible();
    await page.evaluate((mode) => {
      const state = ((window as any).__sidebarMotion = { transitions: 0 });
      const start = document.startViewTransition.bind(document);
      Object.defineProperty(document, "startViewTransition", {
        configurable: true,
        value:
          mode === "unsupported"
            ? undefined
            : (update: Parameters<Document["startViewTransition"]>[0]) => {
                state.transitions++;
                return start(update);
              },
      });
    }, mode);
    const button = page.getByRole("button", { name: /^Toggle file explorer/ });
    await button.evaluate((button) => {
      for (let index = 0; index < 3; index++) button.click();
    });
    await expect(
      page.getByRole("complementary", { name: "Explorer" }),
    ).toHaveCount(0);
    await button.click();
    await expect(
      page.getByRole("complementary", { name: "Explorer" }),
    ).toBeVisible();
    await expect(page.locator("html")).not.toHaveClass(/moving-panes/);
    expect(
      await page
        .locator(".split-child")
        .evaluateAll((panes) =>
          panes.every(
            (pane) => !(pane as HTMLElement).style.viewTransitionName,
          ),
        ),
    ).toBe(true);
    const transitions = await page.evaluate(
      () => (window as any).__sidebarMotion.transitions,
    );
    expect(transitions > 0).toBe(mode === "animated");
    const divider = page.getByRole("separator", {
      name: "Resize sidebar",
      exact: true,
    });
    await divider.press("ArrowRight");
    await expect(divider).toHaveAttribute("aria-valuenow", "270");
    expect(
      await page.evaluate(() => (window as any).__sidebarMotion.transitions),
    ).toBe(transitions);
    expect(
      await page.evaluate(() =>
        (window as any).__nativeTest.calls
          .filter((call: any) =>
            ["start_terminal", "close_terminal"].includes(call.command),
          )
          .map((call: any) => call.command),
      ),
    ).toEqual(["start_terminal"]);
    expect(errors).toEqual([]);
  });
}
