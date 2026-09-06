import { expect, test } from "@playwright/test";
import { newId, newPane, newProject, newSession, panes } from "../../src/model";
import type { Layout } from "../../src/model";
import { buffer, mockDesktop } from "./desktop";

test.use({ colorScheme: "dark" });

test("splitting and closing preserve surviving terminal mounts and renderers", async ({
  page,
}, testInfo) => {
  const grid = (depth: number): Layout =>
    depth === 0
      ? newPane("/project")
      : {
          type: "split",
          id: newId(),
          axis: depth === 3 ? "horizontal" : "vertical",
          ratio: 0.5,
          first: grid(depth - 1),
          second: grid(depth - 1),
        };
  const project = newProject("/project", "local:bash");
  const tab = project.workspaces[0].tabs[0];
  if (tab.type !== "terminal") throw new Error("Expected terminal tab");
  const closed = newPane("/project");
  tab.layout = {
    type: "split",
    id: newId(),
    axis: "horizontal",
    ratio: 0.25,
    first: closed,
    second: grid(3),
  };
  tab.activePaneId = closed.id;
  const ids = panes(tab.layout).map((pane) => pane.id);
  await mockDesktop(page, false, {
    ...newSession(),
    projects: [project],
    activeProjectId: project.id,
  });
  await page.goto("/");
  await expect(page.locator(".xterm-screen")).toHaveCount(9);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__nativeTest.calls.filter(
            (call: any) => call.command === "start_terminal",
          ).length,
      ),
    )
    .toBe(9);
  await expect
    .poll(() =>
      page.evaluate(async (ids) => {
        const { runningTerminal } = await import("/src/terminal-runtime.ts");
        return ids.every(
          (id) => runningTerminal(id)?.getSnapshot().renderer === "WebGL",
        );
      }, ids),
    )
    .toBe(true);
  await page.evaluate(async (ids) => {
    const { TerminalRuntime, runningTerminal } =
      await import("/src/terminal-runtime.ts");
    const desktop = window as any;
    desktop.__layoutTest = {
      calls: [] as { method: string; id: string; elapsed: number }[],
      panes: new Map(
        ids.map((id) => [
          id,
          {
            element: document.querySelector(`[data-pane-id="${id}"]`),
            runtime: runningTerminal(id),
            canvases: [
              ...runningTerminal(id)!.host.querySelectorAll(
                ".xterm-screen > canvas:not(.xterm-link-layer)",
              ),
            ],
          },
        ]),
      ),
    };
    for (const method of ["attach", "detach", "dispose"] as const) {
      const original = TerminalRuntime.prototype[method];
      TerminalRuntime.prototype[method] = function (...args: any[]) {
        const start = performance.now();
        const result = (original as any).apply(this, args);
        desktop.__layoutTest.calls.push({
          method,
          id: this.paneId,
          elapsed: performance.now() - start,
        });
        return result;
      };
    }
    desktop.__nativeTest.emit(
      runningTerminal(ids[1])!.sessionId,
      "\r\nPreserved output 🦀\r\n",
    );
  }, ids);
  await expect
    .poll(() => buffer(page, ids[1]))
    .toContain("Preserved output 🦀");
  await page.keyboard.press("Control+w");
  await expect(page.locator("[data-pane-id]")).toHaveCount(8);
  const closing = await page.evaluate(() => {
    const state = (window as any).__layoutTest;
    return {
      calls: state.calls,
      preserved: [...state.panes].slice(1).every(([id, pane]: any) => {
        const element = document.querySelector(`[data-pane-id="${id}"]`);
        const canvases = element?.querySelectorAll(
          ".xterm-screen > canvas:not(.xterm-link-layer)",
        );
        return (
          pane.element === element &&
          pane.canvases.length === canvases?.length &&
          pane.canvases.every(
            (canvas: HTMLCanvasElement, index: number) =>
              canvas === canvases[index],
          )
        );
      }),
    };
  });
  expect(closing.preserved).toBe(true);
  expect(closing.calls.filter((call: any) => call.id !== closed.id)).toEqual(
    [],
  );
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
  await page.evaluate(() => {
    (window as any).__layoutTest.calls = [];
  });
  await page.keyboard.press("Control+d");
  await expect(page.locator("[data-pane-id]")).toHaveCount(9);
  const splitting = await page.evaluate(() => {
    const state = (window as any).__layoutTest;
    return {
      calls: state.calls,
      preserved: [...state.panes].slice(1).every(([id, pane]: any) => {
        const element = document.querySelector(`[data-pane-id="${id}"]`);
        const canvases = element?.querySelectorAll(
          ".xterm-screen > canvas:not(.xterm-link-layer)",
        );
        return (
          pane.element === element &&
          pane.canvases.length === canvases?.length &&
          pane.canvases.every(
            (canvas: HTMLCanvasElement, index: number) =>
              canvas === canvases[index],
          )
        );
      }),
    };
  });
  expect(splitting.preserved).toBe(true);
  expect(splitting.calls.some((call: any) => call.method === "attach")).toBe(
    true,
  );
  expect(new Set(splitting.calls.map((call: any) => call.id)).size).toBe(1);
  for (const call of splitting.calls) expect(ids).not.toContain(call.id);
  await expect
    .poll(() => buffer(page, ids[1]))
    .toContain("Preserved output 🦀");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__nativeTest.calls.filter(
            (call: any) => call.command === "start_terminal",
          ).length,
      ),
    )
    .toBe(10);
  await page.screenshot({
    path: testInfo.outputPath("terminal-layout-stable.png"),
  });
});

test("a terminal closed before its first frame cancels WebGL and closes its PTY", async ({
  page,
}) => {
  await mockDesktop(page, false);
  await page.goto("/");
  await expect(page.locator(".xterm-screen")).toHaveCount(1);
  const id = await page.evaluate(async () => {
    const { terminalFor, closeTerminals } =
      await import("/src/terminal-runtime.ts");
    const id = crypto.randomUUID();
    const runtime = terminalFor(
      { type: "terminal", id, cwd: "/project" },
      {
        id: "local:bash",
        name: "bash",
        kind: "bash",
        program: "/bin/bash",
        distro: null,
        home: "/home/test",
      },
    );
    const container = document.createElement("div");
    container.style.cssText = "width:600px;height:300px";
    document.body.append(container);
    const state = ((window as any).__closedTerminal = {
      rendererLoads: 0,
      sessionId: runtime.sessionId,
      host: runtime.host,
    });
    const load = runtime.terminal.loadAddon.bind(runtime.terminal);
    runtime.terminal.loadAddon = (addon: any) => {
      if ("onContextLoss" in addon) state.rendererLoads++;
      load(addon);
    };
    runtime.attach(container);
    closeTerminals([id]);
    runtime.detach();
    container.remove();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setTimeout(resolve, 0)),
      ),
    );
    return id;
  });
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const { runningTerminal } = await import("/src/terminal-runtime.ts");
        const desktop = window as any;
        return {
          runtime: !!runningTerminal(id),
          closed: desktop.__nativeTest.calls.some(
            (call: any) =>
              call.command === "close_terminal" &&
              call.args.id === desktop.__closedTerminal.sessionId,
          ),
          connected: desktop.__closedTerminal.host.isConnected,
          rendererLoads: desktop.__closedTerminal.rendererLoads,
        };
      }, id),
    )
    .toEqual({
      runtime: false,
      closed: true,
      connected: false,
      rendererLoads: 0,
    });
  await expect(page.locator(".xterm-screen")).toHaveCount(1);
});

test("terminal output and shortcuts remain usable when WebGL is unavailable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      kind: string,
      ...args: any[]
    ) {
      if (kind === "webgl2") return null;
      return (getContext as any).call(this, kind, ...args);
    } as typeof getContext;
  });
  await mockDesktop(page, false);
  await page.goto("/");
  await expect(page.locator(".xterm-screen")).toHaveCount(1);
  const first = await page
    .locator("[data-pane-id]")
    .getAttribute("data-pane-id");
  await page.keyboard.press("Control+d");
  await expect(page.locator(".xterm-screen")).toHaveCount(2);
  await page.keyboard.press("Control+w");
  await expect(page.locator("[data-pane-id]")).toHaveAttribute(
    "data-pane-id",
    first!,
  );
  await page.evaluate(async (id) => {
    const { runningTerminal } = await import("/src/terminal-runtime.ts");
    (window as any).__nativeTest.emit(
      runningTerminal(id!)!.sessionId,
      "\r\nFallback output 🦀\r\n",
    );
  }, first);
  await expect.poll(() => buffer(page, first!)).toContain("Fallback output 🦀");
  await expect(page.locator(".xterm-rows")).toContainText("Fallback output 🦀");
});
