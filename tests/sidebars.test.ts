import assert from "node:assert/strict";
import { test } from "node:test";
import {
  moveSidebar,
  newSession,
  restoreSession,
  showSidebar,
  toggleSidebar,
} from "../src/model.ts";

const info = {
  directory: "/project",
  home: "/home",
  platform: "linux",
  profiles: [],
};

test("opposite sidebar positions can open and toggle independently", () => {
  const initial = newSession();
  const both = moveSidebar(initial, "git", "right");
  assert.equal(both.sidebar, "files");
  assert.equal(both.rightSidebar, "git");
  assert.deepEqual(both.sidebarSides, {
    files: "left",
    git: "right",
    workspaces: "left",
  });
  const hidden = toggleSidebar(both, "files");
  assert.equal(hidden.sidebar, null);
  assert.equal(hidden.rightSidebar, "git");
  assert.deepEqual(toggleSidebar(hidden, "files"), both);
  const gitHidden = toggleSidebar(both, "git");
  assert.equal(gitHidden.sidebar, "files");
  assert.equal(gitHidden.rightSidebar, null);
  assert.deepEqual(showSidebar(gitHidden, "git"), both);
  assert.deepEqual(initial, newSession());
});

test("panels on the same side replace one another without duplicate views", () => {
  const initial = newSession();
  assert.equal(toggleSidebar(initial, "git").sidebar, "git");
  const both = moveSidebar(initial, "git", "right");
  const moved = moveSidebar(both, "files", "right");
  assert.equal(moved.sidebar, null);
  assert.equal(moved.rightSidebar, "files");
  assert.deepEqual(moved.sidebarSides, {
    files: "right",
    git: "right",
    workspaces: "left",
  });
  const switched = toggleSidebar(moved, "git");
  assert.equal(switched.sidebar, null);
  assert.equal(switched.rightSidebar, "git");
  const separated = moveSidebar(switched, "files", "left");
  assert.deepEqual(separated, both);
});

test("sidebar placement, visibility and independent widths survive restoration", () => {
  const state = {
    ...moveSidebar(newSession(), "git", "right"),
    sidebarWidth: 320,
    rightSidebarWidth: 280,
  };
  assert.deepEqual(
    restoreSession(JSON.parse(JSON.stringify(state)), info),
    state,
  );
  const hidden = toggleSidebar(toggleSidebar(state, "files"), "git");
  assert.deepEqual(
    restoreSession(JSON.parse(JSON.stringify(hidden)), info),
    hidden,
  );
});

test("older sessions keep their selected left panel, hidden state and width", () => {
  for (const sidebar of ["files", "git", null] as const) {
    const restored = restoreSession(
      {
        version: 1,
        projects: [],
        activeProjectId: null,
        sidebar,
        sidebarWidth: 310,
      },
      info,
    );
    assert.equal(restored.sidebar, sidebar);
    assert.equal(restored.sidebarWidth, 310);
    assert.equal(restored.rightSidebar, null);
    assert.deepEqual(restored.sidebarSides, {
      files: "left",
      git: "left",
      workspaces: "left",
    });
  }
});

test("terminal overview placement restores independently with a legacy left default", () => {
  for (const side of ["left", "right", undefined, "invalid", null]) {
    const state = { ...newSession(), terminalOverviewSide: side };
    const restored = restoreSession(JSON.parse(JSON.stringify(state)), info);
    assert.deepEqual(restored, {
      ...newSession(),
      terminalOverviewSide: side === "right" ? "right" : "left",
    });
  }
});

test("invalid sidebar settings cannot show a panel on both sides", () => {
  const restored = restoreSession(
    {
      ...newSession(),
      sidebar: "git",
      rightSidebar: "git",
      sidebarSides: { files: "invalid", git: "right" },
      sidebarWidth: -10,
      rightSidebarWidth: Number.NaN,
    },
    info,
  );
  assert.equal(restored.sidebar, null);
  assert.equal(restored.rightSidebar, "git");
  assert.equal(restored.sidebarSides.files, "left");
  assert.equal(restored.sidebarWidth, 180);
  assert.equal(restored.rightSidebarWidth, 250);
});

test("theme-sized sidebars retain widths outside the built-in drag limits", () => {
  const restored = restoreSession(
    { ...newSession(), sidebarWidth: 140, rightSidebarWidth: 720 },
    info,
  );
  assert.equal(restored.sidebarWidth, 140);
  assert.equal(restored.rightSidebarWidth, 720);
});

test("workspace sidebar replaces same-side panels and restores on either side", () => {
  for (const side of ["left", "right"] as const) {
    const state = moveSidebar(newSession(), "workspaces", side);
    assert.equal(
      state[side === "left" ? "sidebar" : "rightSidebar"],
      "workspaces",
    );
    assert.equal(state.sidebarSides.workspaces, side);
    assert.deepEqual(
      restoreSession(JSON.parse(JSON.stringify(state)), info),
      state,
    );
    const hidden = toggleSidebar(state, "workspaces");
    assert.deepEqual(restoreSession(hidden, info), hidden);
    assert.deepEqual(showSidebar(hidden, "workspaces"), state);
  }
  const both = moveSidebar(newSession(), "workspaces", "right");
  const replaced = showSidebar(both, "git");
  assert.equal(replaced.sidebar, "git");
  assert.equal(replaced.rightSidebar, "workspaces");
});
