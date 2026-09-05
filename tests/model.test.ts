import assert from "node:assert/strict";
import { test } from "node:test";
import {
  active,
  newPane,
  newSession,
  newTab,
  newWorkspace,
  panes,
  removePane,
  resizeSplit,
  restoreSession,
  splitPane,
  updateDirectories,
  updateWorkspace,
} from "../src/model.ts";
import type { AppInfo, Split } from "../src/model.ts";
import { inputChunks } from "../src/terminal-utils.ts";

const info: AppInfo = {
  directory: "/project",
  home: "/home/test",
  platform: "linux",
  profiles: [
    {
      id: "local:bash",
      name: "bash",
      kind: "bash",
      program: "/bin/bash",
      distro: null,
      home: "/home/test",
    },
  ],
};

test("new projects contain a workspace, a tab and one terminal", () => {
  const state = newSession(info);
  const { project, workspace, tab } = active(state);
  assert.equal(project.path, "/project");
  assert.equal(workspace.tabs.length, 1);
  assert.equal(panes(tab.layout).length, 1);
  assert.equal(panes(tab.layout)[0].cwd, "/project");
});

test("split layouts keep their ratios and collapse only the closed branch", () => {
  const left = newPane("/left");
  const right = newPane("/right");
  const bottom = newPane("/bottom");
  let layout = splitPane(left, left.id, "horizontal", right);
  layout = splitPane(layout, right.id, "vertical", bottom);
  layout = resizeSplit(layout, layout.id, 0.7);
  assert.equal((layout as Split).ratio, 0.7);
  assert.deepEqual(
    panes(layout).map((pane) => pane.cwd),
    ["/left", "/right", "/bottom"],
  );
  const collapsed = removePane(layout, right.id)!;
  assert.deepEqual(
    panes(collapsed).map((pane) => pane.cwd),
    ["/left", "/bottom"],
  );
  assert.equal((collapsed as Split).ratio, 0.7);
  assert.equal(removePane(left, left.id), null);
});

test("restores projects, active workspaces, tabs, environments and directories", () => {
  let state = newSession(info);
  const { project, workspace, tab } = active(state);
  const secondary = newWorkspace("/project", "wsl:Ubuntu", "Review");
  state.projects[0] = {
    ...project,
    activeWorkspaceId: secondary.id,
    workspaces: [workspace, secondary],
  };
  state = updateDirectories(state, {
    [panes(tab.layout)[0].id]: "/project/src",
  });
  const restored = restoreSession(JSON.parse(JSON.stringify(state)), info);
  assert.deepEqual(restored, state);
  assert.equal(active(restored).workspace.name, "Review");
  assert.equal(active(restored).tab.profileId, "wsl:Ubuntu");
});

test("does not impose an artificial tab count limit", () => {
  let state = newSession(info);
  const workspace = active(state).workspace;
  const tabs = Array.from({ length: 1200 }, (_, index) =>
    newTab("/project", "local:bash", `Tab ${index}`),
  );
  state = updateWorkspace(state, workspace.id, (workspace) => ({
    ...workspace,
    tabs,
    activeTabId: tabs.at(-1)!.id,
  }));
  assert.equal(active(restoreSession(state, info)).workspace.tabs.length, 1200);
  assert.equal(active(restoreSession(state, info)).tab.title, "Tab 1199");
});

test("repairs missing active IDs and duplicate IDs in saved data", () => {
  const state = newSession(info);
  const { workspace, tab } = active(state);
  workspace.tabs.push(structuredClone(tab));
  workspace.activeTabId = "missing";
  tab.activePaneId = "missing";
  const restored = active(restoreSession(state, info));
  assert.notEqual(restored.workspace.tabs[0].id, restored.workspace.tabs[1].id);
  assert.notEqual(
    panes(restored.workspace.tabs[0].layout)[0].id,
    panes(restored.workspace.tabs[1].layout)[0].id,
  );
  assert.equal(restored.workspace.activeTabId, restored.workspace.tabs[0].id);
  assert.equal(restored.tab.activePaneId, panes(restored.tab.layout)[0].id);
});

test("unchanged directory observations preserve state identity", () => {
  const state = newSession(info);
  const pane = panes(active(state).tab.layout)[0];
  assert.equal(updateDirectories(state, { [pane.id]: pane.cwd }), state);
  const next = updateDirectories(state, { [pane.id]: "/project/src" });
  assert.equal(panes(active(next).tab.layout)[0].cwd, "/project/src");
  assert.equal(pane.cwd, "/project");
});

test("large terminal input preserves emoji at transport boundaries", () => {
  const input = "a".repeat(16_383) + "🦀" + "Zażółć 🧪".repeat(10_000);
  const chunks = [...inputChunks(input)];
  assert.equal(chunks.join(""), input);
  assert.ok(chunks.every((chunk) => chunk.isWellFormed()));
  assert.ok(chunks.every((chunk) => chunk.length <= 16_384));
});
