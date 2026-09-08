import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canMergeTabs,
  activePanel,
  fileTabs,
  filesInTab,
  layoutPanes,
  mapLayout,
  openFileTab,
  removePane,
  updateDirectories,
  updateFilePosition,
  mergeTabs,
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
    const next = mergeTabs(workspace, source.id, target.id, side, {
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

test("merging rejects self, missing or commit tabs, file targets and layouts that cannot fit", () => {
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
  const commit = {
    type: "commit" as const,
    id: "commit",
    title: "Commit",
    root: "/project",
    commit: "a".repeat(40),
  };
  workspace.tabs.push(source, file, commit);
  const size = { width: 483, height: 120 };
  assert.equal(canMergeTabs(source, target, "right", size), true);
  assert.equal(
    canMergeTabs(source, target, "right", { ...size, width: 482 }),
    false,
  );
  assert.equal(canMergeTabs(source, target, "bottom", size), false);
  for (const [from, to] of [
    [target.id, target.id],
    ["missing", target.id],
    [source.id, "missing"],
    [source.id, file.id],
    [commit.id, target.id],
    [source.id, commit.id],
  ]) {
    assert.equal(mergeTabs(workspace, from, to, "right", size), workspace);
  }
  assert.equal(
    mergeTabs(workspace, source.id, target.id, "bottom", size),
    workspace,
  );
  const merged = mergeTabs(workspace, source.id, target.id, "right", size)
    .tabs[0];
  if (merged.type !== "terminal") throw new Error("Expected a terminal");
  assert.equal(panes(merged.layout)[1], source.layout);
});

for (const side of ["left", "right", "top", "bottom"] as const) {
  test(`a file dropped on the ${side} joins three terminals without acquiring a shell`, () => {
    const project = newProject("/project", "bash");
    const workspace = project.workspaces[0];
    const target = newTab("/project", "bash");
    const second = newPane("/second");
    target.layout = splitPane(
      target.layout,
      target.activePaneId,
      "horizontal",
      second,
    );
    target.layout = splitPane(
      target.layout,
      second.id,
      "vertical",
      newPane("/third"),
    );
    const file = {
      type: "file" as const,
      id: "file",
      title: "test.html",
      root: "/project",
      relative: "test.html",
      position: { anchor: 10, head: 20, scrollTop: 100, scrollLeft: 5 },
    };
    workspace.tabs = [target, file];
    const size = { width: 1440, height: 900 };
    assert.equal(canMergeTabs(file, target, side, size), true);
    const merged = mergeTabs(workspace, file.id, target.id, side, size);
    const tab = merged.tabs[0];
    if (tab.type !== "terminal") throw new Error("Expected a panel layout");
    assert.equal(merged.tabs.length, 1);
    assert.equal(layoutPanes(tab.layout).length, 4);
    assert.deepEqual(panes(tab.layout), panes(target.layout));
    assert.equal(activePanel(tab), file);
    assert.deepEqual(filesInTab(tab), [file]);
    let state = {
      ...newSession(),
      projects: [{ ...project, workspaces: [merged] }],
      activeProjectId: project.id,
    };
    const info = {
      directory: "/project",
      home: "/home",
      platform: "linux",
      profiles: [],
    };
    assert.deepEqual(
      restoreSession(JSON.parse(JSON.stringify(state)), info),
      state,
    );
    assert.deepEqual(fileTabs(state), [file]);
    const reopened = openFileTab(state, workspace.id, file.root, file.relative);
    assert.equal(reopened.projects[0].workspaces[0].tabs.length, 1);
    assert.equal(reopened.projects[0].workspaces[0].activeTabId, target.id);
    const position = { anchor: 30, head: 30, scrollTop: 150, scrollLeft: 0 };
    state = updateFilePosition(state, file.id, position);
    assert.deepEqual(fileTabs(state)[0].position, position);
    assert.deepEqual(
      fileTabs(updateDirectories(state, { [file.id]: "/ignored" })),
      fileTabs(state),
    );
    let calls = 0;
    const restarted = mapLayout(tab.layout, () => {
      calls++;
      return newPane("/restart");
    });
    assert.equal(calls, 3);
    assert.equal(
      layoutPanes(restarted).find((pane) => pane.id === file.id),
      file,
    );
    const remaining = panes(tab.layout).reduce(
      (layout, pane) => removePane(layout, pane.id)!,
      tab.layout,
    );
    assert.equal(remaining, file);
    assert.deepEqual(panes(remaining), []);
    assert.equal(removePane(remaining, file.id), null);
    assert.equal(
      canMergeTabs(file, target, side, { width: 480, height: 240 }),
      false,
    );
  });
}
