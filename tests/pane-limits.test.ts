import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canSplitPane,
  layoutFits,
  minimumLayoutSize,
  newPane,
  newProject,
  newSession,
  newTab,
  panes,
  restoreSession,
  resizeSplit,
  splitGeometry,
  splitPane,
} from "../src/model.ts";
import type { Layout, Split } from "../src/model.ts";

test("splits require space for both panels and the divider in the chosen direction", () => {
  const pane = newPane("/project");
  const canSplit = (width: number, height: number, axis: Split["axis"]) =>
    canSplitPane(pane, pane.id, axis, { width, height });
  assert.equal(canSplit(483, 120, "horizontal"), true);
  assert.equal(canSplit(482, 120, "horizontal"), false);
  assert.equal(canSplit(483, 119, "horizontal"), false);
  assert.equal(canSplit(240, 243, "vertical"), true);
  assert.equal(canSplit(240, 242, "vertical"), false);
  assert.equal(canSplit(239, 243, "vertical"), false);
  assert.equal(canSplit(0, 0, "horizontal"), false);
  assert.equal(canSplit(Number.NaN, 900, "horizontal"), false);
});

test("split limits follow the selected panel's space in a nested layout", () => {
  const left = newPane("/left");
  const top = newPane("/top");
  const bottom = newPane("/bottom");
  const layout = splitPane(
    splitPane(left, left.id, "horizontal", top),
    top.id,
    "vertical",
    bottom,
  );
  const size = { width: 1000, height: 400 };
  assert.equal(canSplitPane(layout, left.id, "vertical", size), true);
  assert.equal(canSplitPane(layout, bottom.id, "vertical", size), false);
  assert.equal(canSplitPane(layout, bottom.id, "horizontal", size), true);
  assert.equal(canSplitPane(layout, "missing", "horizontal", size), false);
  assert.equal(
    canSplitPane(layout, bottom.id, "vertical", { width: 1000, height: 600 }),
    true,
  );
});

test("minimum layout size includes nested dividers without limiting tab counts", () => {
  const first = newPane("/first");
  const second = newPane("/second");
  const layout = splitPane(
    splitPane(first, first.id, "horizontal", second),
    second.id,
    "vertical",
    newPane("/third"),
  );
  assert.deepEqual(minimumLayoutSize(layout), { width: 483, height: 243 });
  assert.equal(layoutFits(layout, { width: 483, height: 243 }), true);
  assert.equal(layoutFits(layout, { width: 482, height: 243 }), false);
  assert.equal(layoutFits(layout, { width: 483, height: 242 }), false);
});

test("divider geometry reserves enough space for every descendant", () => {
  const first = newPane("/first");
  const second = newPane("/second");
  let layout = splitPane(first, first.id, "horizontal", second) as Split;
  layout = splitPane(
    layout,
    second.id,
    "horizontal",
    newPane("/third"),
  ) as Split;
  layout = resizeSplit(layout, layout.id, 0.95) as Split;
  const geometry = splitGeometry(layout, { width: 1000, height: 300 });
  assert.equal(geometry.ratio, geometry.maxRatio);
  assert.equal(layoutFits(layout.first, geometry.first), true);
  assert.equal(layoutFits(layout.second, geometry.second), true);
  assert.equal(geometry.first.width + geometry.second.width + 3, 1000);
  assert.equal(layout.ratio, 0.95);
  assert.equal(resizeSplit(layout, layout.id, Number.NaN), layout);
});

test("a burst of split requests stops at the current panel's size and allows more space later", () => {
  let pane = newPane("/project");
  let layout: Layout = pane;
  const size = { width: 1000, height: 500 };
  let opened = 1;
  for (let index = 0; index < 1000; index++) {
    if (!canSplitPane(layout, pane.id, "horizontal", size)) continue;
    const added = newPane(pane.cwd);
    layout = splitPane(layout, pane.id, "horizontal", added);
    pane = added;
    opened++;
  }
  assert.equal(opened, 3);
  assert.equal(layoutFits(layout, size), true);
  assert.equal(
    canSplitPane(layout, pane.id, "horizontal", { width: 2000, height: 500 }),
    true,
  );
});

test("restoring deeply nested legacy splits preserves panels and the active directory for recovery", () => {
  const tab = newTab("/project", "local:bash");
  for (let index = 0; index < 100; index++) {
    const pane = newPane(`/project/panel-${index}`);
    tab.layout = splitPane(tab.layout, tab.activePaneId, "horizontal", pane);
    tab.activePaneId = pane.id;
  }
  const project = newProject("/project", "local:bash");
  project.workspaces[0].tabs = [tab];
  project.workspaces[0].activeTabId = tab.id;
  const saved = {
    ...newSession(),
    projects: [project],
    activeProjectId: project.id,
  };
  const restored = restoreSession(JSON.parse(JSON.stringify(saved)), {
    directory: "/project",
    home: "/home/test",
    platform: "linux",
    profiles: [],
  });
  assert.deepEqual(restored, saved);
  assert.equal(panes(tab.layout).length, 101);
  assert.equal(layoutFits(tab.layout, { width: 1440, height: 900 }), false);
});
