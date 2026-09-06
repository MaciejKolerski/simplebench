import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { GitChange } from "../../src/api";
import { mockDesktop } from "./desktop";

async function openSourceControl(page: Page, changes: GitChange[]) {
  await mockDesktop(page);
  await page.goto("/");
  await expect(page.locator(".xterm-screen")).toBeVisible();
  await page.evaluate((initialChanges) => {
    const desktop = window as any;
    const invoke = desktop.__TAURI_INTERNALS__.invoke;
    const state = {
      changes: initialChanges,
      calls: [] as { command: string; args: Record<string, any> }[],
      failStage: false,
      failCommit: false,
    };
    desktop.__sourceControlTest = state;
    desktop.__TAURI_INTERNALS__.invoke = async (
      command: string,
      args: Record<string, any> = {},
    ) => {
      if (!command.startsWith("git_")) return invoke(command, args);
      state.calls.push({ command, args });
      if (command === "git_status")
        return { root: args.root, branch: "main", changes: state.changes };
      if (command === "git_diff") return `diff for ${args.path}\n-old\n+new`;
      if (command === "git_stage") {
        if (state.failStage) throw new Error("Cannot update the index");
        state.changes = state.changes.map((change) => {
          if (!args.paths.includes(change.path)) return change;
          if (args.stage)
            return {
              ...change,
              index: change.worktree === "?" ? "A" : change.worktree,
              worktree: " ",
            };
          return {
            ...change,
            index: change.index === "A" ? "?" : " ",
            worktree: change.index === "A" ? "?" : "M",
          };
        });
        return;
      }
      if (command === "git_commit") {
        if (state.failCommit)
          throw new Error("Commit hook rejected the message");
        state.changes = state.changes
          .filter((change) => change.worktree !== " ")
          .map((change) => ({
            ...change,
            index: change.worktree === "?" ? "?" : " ",
          }));
      }
    };
    window.dispatchEvent(new Event("focus"));
  }, changes);
  await page
    .getByRole("button", {
      name: "Toggle source control (Ctrl+Shift+G)",
      exact: true,
    })
    .click();
  await expect(page.getByRole("tab", { name: /^Changes/ })).toHaveText(
    `Changes (${changes.length})`,
  );
}

const changed = (
  path: string,
  index = " ",
  worktree = "M",
  originalPath: string | null = null,
): GitChange => ({
  path,
  index,
  worktree,
  originalPath,
});

test("source control groups changes and keeps staged and working diffs separate", async ({
  page,
}) => {
  await openSourceControl(page, [
    changed("src/App.tsx", "M", "M"),
    changed("README.md"),
    changed("src/new file.ts", "?", "?"),
    changed("src/renamed.ts", "R", " ", "src/original.ts"),
  ]);
  const tracked = page.getByRole("region", {
    name: "Tracked changes",
    exact: true,
  });
  const untracked = page.getByRole("region", {
    name: "Untracked changes",
    exact: true,
  });
  const staged = page.getByRole("region", {
    name: "Staged changes",
    exact: true,
  });
  await expect(tracked.getByRole("listitem")).toHaveCount(2);
  await expect(untracked.getByRole("listitem")).toHaveCount(1);
  await expect(staged.getByRole("listitem")).toHaveCount(2);

  await tracked.getByRole("button", { name: "Tracked 2", exact: true }).click();
  await expect(tracked.getByRole("list")).toBeHidden();
  await tracked
    .getByRole("button", { name: "Tracked 2", exact: true })
    .press("Enter");
  await tracked
    .getByRole("button", { name: "View diff for src/App.tsx", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("diff for src/App.tsx");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await staged
    .getByRole("button", {
      name: "View staged diff for src/App.tsx",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  expect(
    await page.evaluate(() =>
      (window as any).__sourceControlTest.calls
        .filter((call: any) => call.command === "git_diff")
        .map((call: any) => call.args),
    ),
  ).toEqual([
    { root: "/project", path: "src/App.tsx", staged: false },
    { root: "/project", path: "src/App.tsx", staged: true },
  ]);
  expect(
    await page.evaluate(() =>
      (window as any).__sourceControlTest.calls.filter((call: any) =>
        ["git_stage", "git_commit"].includes(call.command),
      ),
    ),
  ).toEqual([]);

  await page
    .getByRole("checkbox", { name: "Stage README.md", exact: true })
    .press("Space");
  await expect(
    page.getByRole("checkbox", { name: "Unstage README.md", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("checkbox", { name: "Stage untracked changes", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", {
      name: "Unstage src/new file.ts",
      exact: true,
    }),
  ).toBeChecked();
  await expect(untracked).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: "Unstage src/renamed.ts", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Stage src/renamed.ts", exact: true }),
  ).not.toBeChecked();
  await page
    .getByRole("button", { name: "Stage all changes", exact: true })
    .click();
  await expect(tracked).toHaveCount(0);
  await page
    .getByRole("button", { name: "Unstage all changes", exact: true })
    .click();
  await expect(staged).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (window as any).__sourceControlTest.calls
        .filter((call: any) => call.command === "git_stage")
        .map((call: any) => call.args),
    ),
  ).toEqual([
    { root: "/project", paths: ["README.md"], stage: true },
    { root: "/project", paths: ["src/new file.ts"], stage: true },
    {
      root: "/project",
      paths: ["src/renamed.ts", "src/original.ts"],
      stage: false,
    },
    { root: "/project", paths: ["src/App.tsx", "src/renamed.ts"], stage: true },
    {
      root: "/project",
      paths: [
        "src/App.tsx",
        "README.md",
        "src/new file.ts",
        "src/renamed.ts",
        "src/original.ts",
      ],
      stage: false,
    },
  ]);
});

test("source control preserves an exact commit draft after failed Git actions", async ({
  page,
}) => {
  await openSourceControl(page, [changed("README.md")]);
  const input = page.getByRole("textbox", {
    name: "Commit message",
    exact: true,
  });
  const commit = page.getByRole("button", {
    name: "Commit staged changes",
    exact: true,
  });
  const draft =
    "docs(readme): describe usage\n\nKeep spacing, Unicode: zażółć 🦀\n\nValidation:\n- Manual review\n";
  await input.fill(draft);
  await expect(commit).toBeDisabled();
  await page.evaluate(() => {
    (window as any).__sourceControlTest.failStage = true;
  });
  await page
    .getByRole("checkbox", { name: "Stage README.md", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Cannot update the index",
  );
  await expect(
    page.getByRole("checkbox", { name: "Stage README.md", exact: true }),
  ).not.toBeChecked();
  await expect(input).toHaveValue(draft);
  await page.evaluate(() => {
    (window as any).__sourceControlTest.failStage = false;
    (window as any).__sourceControlTest.failCommit = true;
  });
  await page
    .getByRole("checkbox", { name: "Stage README.md", exact: true })
    .click();
  await commit.click();
  await expect(page.getByRole("alert")).toContainText(
    "Commit hook rejected the message",
  );
  await expect(input).toHaveValue(draft);
  await expect(commit).toBeEnabled();
  await page.evaluate(() => {
    (window as any).__sourceControlTest.failCommit = false;
  });
  await page
    .getByRole("button", { name: "Dismiss message", exact: true })
    .click();
  await commit.click();
  await expect(
    page.getByText("Working tree clean.", { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue("");
  await expect(commit).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Stage all changes", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() =>
      (window as any).__sourceControlTest.calls
        .filter((call: any) => call.command === "git_commit")
        .map((call: any) => call.args.message),
    ),
  ).toEqual([draft, draft]);
});

test("source control keeps its commit form visible while a long list scrolls at minimum size", async ({
  page,
}, testInfo) => {
  await openSourceControl(page, [
    ...[
      "src/App.tsx",
      "src/SplitView.tsx",
      "src/TerminalPane.tsx",
      "src/terminal-runtime.ts",
      "src-tauri/capabilities/settings.json",
      "src-tauri/src/files.rs",
      "src-tauri/src/lib.rs",
    ].map((path) => changed(path)),
    ...[
      "src/KeybindingsProvider.tsx",
      "src/SettingsWindow.tsx",
      "src/TabBar.tsx",
      "src/keybindings.ts",
      "src-tauri/src/keybindings.rs",
    ].map((path) => changed(path, "?", "?")),
  ]);
  await page
    .locator(".source-panel")
    .screenshot({ path: testInfo.outputPath("source-control-default.png") });
  const divider = page.getByRole("separator", {
    name: "Resize sidebar",
    exact: true,
  });
  await divider.focus();
  for (let count = 0; count < 4; count++) await divider.press("ArrowRight");
  await page
    .locator(".source-panel")
    .screenshot({ path: testInfo.outputPath("source-control-wide.png") });

  await page.evaluate(() => {
    const state = (window as any).__sourceControlTest;
    state.changes.push(
      ...Array.from({ length: 40 }, (_, index) => ({
        path: `src/deeply/nested/directory/component-${index}.tsx`,
        originalPath: null,
        index: " ",
        worktree: "M",
      })),
    );
    window.dispatchEvent(new Event("focus"));
  });
  await expect(page.getByRole("tab", { name: /^Changes/ })).toHaveText(
    "Changes (52)",
  );
  await page.setViewportSize({ width: 800, height: 420 });
  await divider.focus();
  for (let count = 0; count < 8; count++) await divider.press("ArrowLeft");
  await expect(divider).toHaveAttribute("aria-valuenow", "180");
  const form = page.locator(".commit-form");
  const before = (await form.boundingBox())!;
  const list = page.locator(".git-groups");
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    page.getByRole("checkbox", {
      name: "Stage src-tauri/src/keybindings.rs",
      exact: true,
    }),
  ).toBeInViewport();
  const after = (await form.boundingBox())!;
  expect(after.y).toBe(before.y);
  await expect(
    page.getByRole("textbox", { name: "Commit message", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Commit staged changes", exact: true }),
  ).toBeInViewport();
  expect(
    await page
      .locator(".source-panel")
      .evaluate(
        (panel) =>
          panel.scrollWidth <= panel.clientWidth &&
          panel.scrollHeight <= panel.clientHeight,
      ),
  ).toBe(true);
  await page
    .getByRole("textbox", { name: "Commit message", exact: true })
    .fill("fix(ui): keep controls reachable");
  await page
    .getByRole("checkbox", {
      name: "Stage src-tauri/src/keybindings.rs",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Commit staged changes", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("source-control-minimum.png"),
  });
});
