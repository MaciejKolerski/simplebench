import assert from "node:assert/strict";
import { test } from "node:test";
import { browserAddress, restoreBrowserUrl } from "../src/browser-url.ts";
import {
  activePanel,
  browserTabs,
  filesInTab,
  layoutPanes,
  mergeTabs,
  newBrowserTab,
  newPane,
  newProject,
  newSession,
  panes,
  restoreSession,
  splitPane,
  updateBrowser,
} from "../src/model.ts";
import { applyFileChange } from "../src/explorer-model.ts";

test("browser addresses accept local development, HTTPS and search, and reject privileged schemes", () => {
  assert.equal(
    browserAddress(" localhost:3000/path?q=x "),
    "http://localhost:3000/path?q=x",
  );
  assert.equal(browserAddress("[::1]:8080"), "http://[::1]:8080/");
  assert.equal(
    browserAddress("devserver:8080/path"),
    "http://devserver:8080/path",
  );
  assert.equal(browserAddress("example.com"), "https://example.com/");
  assert.equal(
    browserAddress("hello world"),
    "https://duckduckgo.com/?q=hello%20world",
  );
  for (const value of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,hello",
    "tauri://localhost",
    "http://ipc.localhost",
    "http://theme.localhost",
    "https://user:pass@example.com",
  ]) {
    assert.throws(() => browserAddress(value), undefined, value);
    assert.equal(restoreBrowserUrl(value), "about:blank");
  }
});

test("a browser docks beside two live pane IDs, updates and restores without becoming a shell or file", () => {
  const project = newProject("/project", "bash");
  const workspace = project.workspaces[0];
  const terminal = workspace.tabs[0];
  assert.equal(terminal.type, "terminal");
  if (terminal.type !== "terminal") return;
  terminal.layout = splitPane(
    terminal.layout,
    terminal.activePaneId,
    "vertical",
    newPane("/project"),
  );
  const ids = panes(terminal.layout).map((pane) => pane.id);
  const browser = newBrowserTab("http://localhost:3000");
  workspace.tabs.push(browser);
  const merged = mergeTabs(workspace, browser.id, terminal.id, "right", {
    width: 1200,
    height: 800,
  });
  project.workspaces = [merged];
  const session = {
    ...newSession(),
    projects: [project],
    activeProjectId: project.id,
  };
  const changed = updateBrowser(session, browser.id, {
    url: "https://example.com/new",
    title: "Example",
  });
  const restored = restoreSession(JSON.parse(JSON.stringify(changed)), {
    directory: "/project",
    home: "/home/test",
    platform: "linux",
    profiles: [],
  });
  const tab = restored.projects[0].workspaces[0].tabs[0];
  assert.equal(tab.type, "terminal");
  if (tab.type !== "terminal") return;
  assert.deepEqual(
    panes(tab.layout).map((pane) => pane.id),
    ids,
  );
  assert.equal(layoutPanes(tab.layout).length, 3);
  assert.equal(activePanel(tab)?.id, browser.id);
  assert.deepEqual(filesInTab(tab), []);
  assert.deepEqual(browserTabs(restored), [
    { ...browser, url: "https://example.com/new", title: "Example" },
  ]);
  assert.deepEqual(
    browserTabs(
      applyFileChange(
        restored,
        { oldPath: "/project/file", newPath: null },
        "bash",
      ),
    ),
    browserTabs(restored),
  );
  assert.equal(
    mergeTabs(workspace, browser.id, terminal.id, "right", {
      width: 400,
      height: 200,
    }),
    workspace,
  );
});
