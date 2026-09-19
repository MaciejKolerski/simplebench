import { test } from "node:test";
import assert from "node:assert/strict";
import {
  androidTabs,
  newAndroidTab,
  newProject,
  newSession,
  mergeTabs,
  restoreSession,
  panes,
  updateAndroid,
  tabsToClose,
} from "../src/model.ts";
import { applyFileChange } from "../src/explorer-model.ts";

test("Android descriptors survive docking, file changes and all supported session versions without a PTY", () => {
  const device = "12345678-1234-4567-8123-123456789abc";
  const android = newAndroidTab(device, "Phone");
  const project = newProject("/project", "shell");
  const workspace = project.workspaces[0];
  const terminal = workspace.tabs[0];
  assert.equal(terminal.type, "terminal");
  workspace.tabs.push(android);
  const docked = mergeTabs(workspace, android.id, terminal.id, "right", {
    width: 1200,
    height: 800,
  });
  project.workspaces = [docked];
  const session = {
    ...newSession(),
    projects: [project],
    activeProjectId: project.id,
  };
  assert.deepEqual(androidTabs(session), [android]);
  assert.equal(docked.tabs.length, 1);
  assert.equal(
    panes(
      docked.tabs[0].type === "terminal"
        ? docked.tabs[0].layout
        : terminal.layout,
    ).length,
    1,
  );
  assert.equal(
    androidTabs(updateAndroid(session, android.id, { title: "Renamed" }))[0]
      .deviceId,
    device,
  );
  assert.deepEqual(
    tabsToClose(docked.tabs, terminal.id, "all", new Set()).map(
      (tab) => tab.id,
    ),
    [terminal.id],
  );
  const info = {
    directory: "/",
    home: "/home",
    platform: "linux",
    profiles: [
      {
        id: "shell",
        name: "Shell",
        kind: "local",
        program: "/bin/sh",
        distro: null,
        home: "/home",
      },
    ],
  };
  for (const version of [1, 2, 3]) {
    const restored = restoreSession({ ...session, version }, info);
    assert.deepEqual(androidTabs(restored), [android]);
    assert.equal(restored.version, 3);
  }
  assert.throws(
    () =>
      restoreSession(
        {
          ...session,
          projects: [
            {
              ...project,
              workspaces: [
                {
                  ...workspace,
                  tabs: [{ ...android, type: "future-android" }],
                },
              ],
            },
          ],
        },
        info,
      ),
    /Unknown/,
  );
  assert.throws(
    () =>
      restoreSession(
        {
          ...session,
          projects: [
            {
              ...project,
              workspaces: [
                {
                  ...workspace,
                  tabs: [{ ...android, deviceId: "/arbitrary/avd" }],
                },
              ],
            },
          ],
        },
        info,
      ),
    /Android/,
  );
  const changed = applyFileChange(
    session,
    { oldPath: "/project/a", newPath: "/project/b" },
    "shell",
  );
  assert.deepEqual(androidTabs(changed), [android]);
});
