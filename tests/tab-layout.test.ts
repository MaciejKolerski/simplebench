import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canMergeTerminalTabs,
  mergeTerminalTabs,
  moveTab,
  newPane,
  newProject,
  newSession,
  newTab,
  newWorkspace,
  panes,
  restoreSession,
  splitPane,
} from "../src/model.ts";
import type { TabDropSide } from "../src/model.ts";

test("moving tabs keeps selection and tab objects, accepts every kind and ignores stale targets", () => {
  const workspace = newWorkspace("/project", "bash");
  const terminal = workspace.tabs[0];
  const file = {
    type: "file" as const,
    id: "file",
    title: "File",
    root: "/project",
    relative: "file.txt",
  };
  const commit = {
    type: "commit" as const,
    id: "commit",
    title: "Commit",
    root: "/project",
    commit: "a".repeat(40),
  };
  workspace.tabs.push(file, commit);
  const moved = moveTab(workspace, file.id, terminal.id);
  assert.deepEqual(moved.tabs, [file, terminal, commit]);
  assert.equal(moved.tabs[0], file);
  assert.equal(moved.activeTabId, terminal.id);
  const appended = moveTab(moved, terminal.id, null);
  assert.deepEqual(appended.tabs, [file, commit, terminal]);
  assert.equal(appended.activeTabId, terminal.id);
  assert.equal(moveTab(appended, terminal.id, null), appended);
  assert.equal(moveTab(workspace, "missing", null), workspace);
  assert.equal(moveTab(workspace, file.id, "missing"), workspace);
  assert.equal(moveTab(workspace, file.id, file.id), workspace);
  assert.deepEqual(workspace.tabs, [terminal, file, commit]);
});

for (const side of ["left", "right", "top", "bottom"] as TabDropSide[]) {
  test(`merging on the ${side} retains nested panes, directories and profiles through restoration`, () => {
    const project = newProject("/project", "bash");
    const workspace = project.workspaces[0];
    const target = newTab("/project/target", "bash", "Target");
    const source = newTab("/project/source", "zsh", "Source");
    const added = { ...newPane("/another"), profileId: "fish" };
    source.layout = splitPane(
      source.layout,
      source.activePaneId,
      "vertical",
      added,
    );
    source.activePaneId = added.id;
    workspace.tabs = [target, source];
    workspace.activeTabId = target.id;
    const next = mergeTerminalTabs(workspace, source.id, target.id, side, {
      width: 1200,
      height: 900,
    });
    assert.equal(next.tabs.length, 1);
    assert.equal(next.activeTabId, target.id);
    const merged = next.tabs[0];
    assert.equal(merged.type, "terminal");
    if (merged.type !== "terminal" || merged.layout.type !== "split")
      throw new Error("Expected a split terminal");
    assert.equal(merged.title, "Target");
    assert.equal(merged.activePaneId, added.id);
    assert.equal(merged.profileId, "bash");
    const before = side === "left" || side === "top";
    assert.equal(
      before ? merged.layout.second : merged.layout.first,
      target.layout,
    );
    assert.equal(
      merged.layout.axis,
      side === "left" || side === "right" ? "horizontal" : "vertical",
    );
    const moved = panes(before ? merged.layout.first : merged.layout.second);
    assert.deepEqual(
      moved.map((pane) => [pane.id, pane.cwd, pane.profileId]),
      [
        [panes(source.layout)[0].id, "/project/source", "zsh"],
        [added.id, "/another", "fish"],
      ],
    );
    const state = {
      ...newSession(),
      activeProjectId: project.id,
      projects: [{ ...project, workspaces: [next] }],
    };
    assert.deepEqual(
      restoreSession(JSON.parse(JSON.stringify(state)), {
        directory: "/project",
        home: "/home/test",
        platform: "linux",
        profiles: [],
      }),
      state,
    );
    assert.equal(workspace.tabs.length, 2);
    assert.equal(panes(source.layout)[0].profileId, undefined);
  });
}

test("merging rejects self, missing or nonterminal tabs and layouts that cannot fit", () => {
  const workspace = newWorkspace("/project", "bash");
  const target = workspace.tabs[0];
  const source = newTab("/project", "bash");
  const file = {
    type: "file" as const,
    id: "file",
    title: "File",
    root: "/project",
    relative: "file.txt",
  };
  workspace.tabs.push(source, file);
  const size = { width: 483, height: 120 };
  assert.equal(canMergeTerminalTabs(source, target, "right", size), true);
  assert.equal(
    canMergeTerminalTabs(source, target, "right", { ...size, width: 482 }),
    false,
  );
  assert.equal(canMergeTerminalTabs(source, target, "bottom", size), false);
  for (const [from, to] of [
    [target.id, target.id],
    ["missing", target.id],
    [source.id, "missing"],
    [file.id, target.id],
    [source.id, file.id],
  ]) {
    assert.equal(
      mergeTerminalTabs(workspace, from, to, "right", size),
      workspace,
    );
  }
  assert.equal(
    mergeTerminalTabs(workspace, source.id, target.id, "bottom", size),
    workspace,
  );
  const merged = mergeTerminalTabs(
    workspace,
    source.id,
    target.id,
    "right",
    size,
  ).tabs[0];
  if (merged.type !== "terminal") throw new Error("Expected a terminal");
  assert.equal(panes(merged.layout)[1], source.layout);
});
