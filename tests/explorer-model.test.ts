import assert from "node:assert/strict";
import test from "node:test";
import { applyFileChange, containsPath } from "../src/explorer-model.ts";
import {
  fileTabs,
  filesInTab,
  newProject,
  newSession,
  newWorkspace,
  openFileTab,
  panes,
  splitPane,
} from "../src/model.ts";

test("folder renames preserve file IDs and positions in every workspace and split", () => {
  const project = newProject("/project", "bash");
  const second = newWorkspace("Other", "/project", "bash");
  project.workspaces.push(second);
  let session = {
    ...newSession(),
    projects: [project],
    activeProjectId: project.id,
  };
  const first = project.workspaces[0];
  session = openFileTab(session, first.id, "/project", "src/main.ts");
  session = openFileTab(session, second.id, "/project", "src/main.ts");
  const workspace = session.projects[0].workspaces[0];
  const file = filesInTab(workspace.tabs[1])[0];
  file.position = { head: 8, anchor: 3, scrollTop: 44, scrollLeft: 0 };
  const terminal = workspace.tabs[0];
  assert.equal(terminal.type, "terminal");
  if (terminal.type !== "terminal") return;
  const terminalId = panes(terminal.layout)[0].id;
  terminal.layout = splitPane(terminal.layout, terminalId, "horizontal", file);
  terminal.activePaneId = file.id;
  workspace.tabs.pop();
  const next = applyFileChange(
    session,
    { oldPath: "/project/src", newPath: "/project/code" },
    "bash",
  );
  assert.deepEqual(
    fileTabs(next).map((file) => [file.id, file.relative]),
    fileTabs(session).map((file) => [file.id, "code/main.ts"]),
  );
  assert.deepEqual(fileTabs(next)[0].position, file.position);
  assert.equal(next.projects[0].workspaces[0].tabs[0].type, "terminal");
  const after = next.projects[0].workspaces[0].tabs[0];
  if (after.type === "terminal")
    assert.equal(panes(after.layout)[0].id, terminalId);
  const deleted = applyFileChange(
    next,
    { oldPath: "/project/code", newPath: null },
    "bash",
  );
  assert.equal(fileTabs(deleted).length, 0);
  const kept = deleted.projects[0].workspaces[0].tabs[0];
  if (kept.type === "terminal") assert.equal(kept.activePaneId, terminalId);
});

test("project renames and cross-project moves retarget open files, while root deletion removes its project", () => {
  const a = newProject("/a", "bash");
  const b = newProject("/b", "bash");
  let session = { ...newSession(), projects: [a, b], activeProjectId: a.id };
  session = openFileTab(session, a.workspaces[0].id, "/a", "file.txt");
  const renamed = applyFileChange(
    session,
    { oldPath: "/a", newPath: "/renamed" },
    "bash",
  );
  assert.equal(renamed.projects[0].path, "/renamed");
  assert.equal(fileTabs(renamed)[0].root, "/renamed");
  const moved = applyFileChange(
    renamed,
    { oldPath: "/renamed/file.txt", newPath: "/b/moved.txt" },
    "bash",
  );
  assert.equal(fileTabs(moved)[0].root, "/b");
  assert.equal(fileTabs(moved)[0].relative, "moved.txt");
  const removed = applyFileChange(
    moved,
    { oldPath: "/renamed", newPath: null },
    "bash",
  );
  assert.equal(removed.projects.length, 1);
  assert.equal(removed.activeProjectId, b.id);
  assert.equal(containsPath("/src", "/src-other/file"), false);
  assert.equal(
    containsPath("C:\\project\\src", "C:\\project\\src\\file"),
    true,
  );
});
