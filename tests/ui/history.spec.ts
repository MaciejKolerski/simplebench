import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { buffer, mockDesktop } from "./desktop";
import type { MockGitHistory } from "./desktop";

const commits = Array.from({ length: 53 }, (_, index) => ({
  id: (53 - index).toString(16).padStart(40, "a"),
  shortId: `a${(53 - index).toString(16).padStart(6, "0")}`,
  subject: index
    ? `refactor(app): refine workspace ${53 - index}`
    : "feat(ui): add the project overview",
  authorName: "Alex Morgan",
  authoredAt: "2026-09-06T12:30:00+02:00",
}));
const history: MockGitHistory = {
  commits,
  details: Object.fromEntries(
    commits.map((commit, index) => [
      commit.id,
      {
        commit,
        authorEmail: "alex@example.test",
        committerName: "Sam Lee",
        committerEmail: "sam@example.test",
        committedAt: "2026-09-06T13:10:00+02:00",
        parents: index === 52 ? [] : [commits[index + 1].id],
        message: `${commit.subject}\n\nAdd an overview with keyboard navigation.\nPreserve Unicode: zażółć 🦀\n\nValidation:\n- Interface reviewed\n`,
        files:
          index === 52
            ? []
            : [
                {
                  path: "src/Overview.tsx",
                  originalPath: null,
                  status: "M",
                  additions: 3,
                  deletions: 1,
                },
                {
                  path: "src/ProjectList.tsx",
                  originalPath: "src/Projects.tsx",
                  status: "R",
                  additions: 0,
                  deletions: 0,
                },
                {
                  path: "public/icon.png",
                  originalPath: null,
                  status: "A",
                  additions: null,
                  deletions: null,
                },
              ],
      },
    ]),
  ),
  diffs: {
    "src/Overview.tsx": {
      patch:
        "diff --git a/src/Overview.tsx b/src/Overview.tsx\n--- a/src/Overview.tsx\n+++ b/src/Overview.tsx\n@@ -1,3 +1,5 @@\n export function Overview() {\n-  return null;\n+  return (\n+    <main>Project overview — zażółć 🦀</main>\n+  );\n }\n",
      truncated: false,
    },
    "src/ProjectList.tsx": {
      patch:
        "diff --git a/src/Projects.tsx b/src/ProjectList.tsx\nsimilarity index 100%\nrename from src/Projects.tsx\nrename to src/ProjectList.tsx\n",
      truncated: false,
    },
    "public/icon.png": {
      patch: "Binary files /dev/null and b/public/icon.png differ\n",
      truncated: false,
    },
  },
};

async function openHistory(page: Page, fixture = history) {
  await mockDesktop(page, true, undefined, fixture);
  await page.goto("/");
  await expect(page.locator(".xterm-screen")).toBeVisible();
  await page
    .getByRole("button", {
      name: "Toggle source control (Ctrl+Shift+G)",
      exact: true,
    })
    .click();
  await page.getByRole("tab", { name: "History", exact: true }).click();
}

test("history pages through commits and opens reusable tabs while terminals keep streaming", async ({
  page,
}, testInfo) => {
  await openHistory(page);
  const workspaceTabs = page.getByRole("tablist", {
    name: "Workspace tabs",
    exact: true,
  });
  const entries = page
    .getByRole("list", { name: "Commit history", exact: true })
    .getByRole("listitem");
  await expect(entries).toHaveCount(50);
  await page
    .getByRole("button", { name: "Load more commits", exact: true })
    .click();
  await expect(entries).toHaveCount(53);
  await expect(
    page.getByRole("button", { name: "Load more commits", exact: true }),
  ).toHaveCount(0);
  const historyCalls = await page.evaluate(() =>
    (window as any).__nativeTest.calls.filter(
      (call: any) => call.command === "git_history",
    ),
  );
  expect(historyCalls.some((call: any) => call.args.skip === 0)).toBe(true);
  expect(historyCalls.at(-1).args).toEqual({
    root: "/project",
    skip: 50,
    tips: [commits[0].id],
  });

  const pane = await page
    .locator("[data-pane-id]")
    .getAttribute("data-pane-id");
  await entries.first().getByRole("button").click();
  await expect(workspaceTabs.getByRole("tab")).toHaveCount(2);
  await expect(
    workspaceTabs.getByRole("tab", { selected: true }),
  ).toContainText(commits[0].subject);
  await expect(page.getByRole("article")).toContainText(
    "Alex Morgan <alex@example.test>",
  );
  await expect(page.getByRole("article")).toContainText(commits[0].id);
  await page.getByText("Full commit message", { exact: true }).click();
  await expect(page.getByRole("article")).toContainText(
    "Preserve Unicode: zażółć 🦀",
  );
  await expect(
    page.getByRole("region", {
      name: "Diff for src/Overview.tsx",
      exact: true,
    }),
  ).toContainText("Project overview — zażółć 🦀");
  await page.screenshot({
    path: testInfo.outputPath("history-commit-details.png"),
  });
  await page
    .getByRole("navigation", { name: "Changed files" })
    .getByRole("button", { name: /src\/ProjectList.tsx/ })
    .click();
  await expect(
    page.getByRole("region", {
      name: "Diff for src/ProjectList.tsx",
      exact: true,
    }),
  ).toContainText("rename from src/Projects.tsx");
  await page
    .getByRole("navigation", { name: "Changed files" })
    .getByRole("button", { name: /public\/icon.png/ })
    .click();
  await expect(
    page.getByRole("region", { name: "Diff for public/icon.png", exact: true }),
  ).toContainText("Binary files");
  const diffCalls = await page.evaluate(() =>
    (window as any).__nativeTest.calls.filter(
      (call: any) => call.command === "git_commit_diff",
    ),
  );
  expect(diffCalls[1].args).toEqual({
    root: "/project",
    id: commits[0].id,
    path: "src/ProjectList.tsx",
    originalPath: "src/Projects.tsx",
  });

  await page.evaluate(() => {
    const native = (window as any).__nativeTest;
    native.emit(
      [...native.sessions.keys()][0],
      "\r\nHISTORY BACKGROUND STREAM 🦀\r\n",
    );
  });
  await expect
    .poll(() => buffer(page, pane!))
    .toContain("HISTORY BACKGROUND STREAM 🦀");
  await entries.first().getByRole("button").click();
  await expect(workspaceTabs.getByRole("tab")).toHaveCount(2);
  await entries.nth(1).getByRole("button").click();
  await expect(workspaceTabs.getByRole("tab")).toHaveCount(3);
  await workspaceTabs
    .getByRole("tab", { name: "Terminal", exact: true })
    .click();
  await expect
    .poll(() => buffer(page, pane!))
    .toContain("HISTORY BACKGROUND STREAM 🦀");
  expect(
    await page.evaluate(
      () =>
        (window as any).__nativeTest.calls.filter(
          (call: any) => call.command === "start_terminal",
        ).length,
    ),
  ).toBe(1);
  await workspaceTabs
    .getByRole("tab", {
      name: `${commits[0].shortId} · ${commits[0].subject}`,
      exact: true,
    })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("test-session") ?? "null",
          )?.projects[0]?.workspaces[0]?.tabs.filter(
            (tab: any) => tab.type === "commit",
          ).length,
      ),
    )
    .toBe(2);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const workspace = JSON.parse(
          localStorage.getItem("test-session") ?? "null",
        )?.projects[0]?.workspaces[0];
        return workspace?.tabs.find(
          (tab: any) => tab.id === workspace.activeTabId,
        )?.commit;
      }),
    )
    .toBe(commits[0].id);
  await page.reload();
  await expect(page.getByRole("article")).toContainText(commits[0].subject);
  expect(
    await page.evaluate(
      () =>
        (window as any).__nativeTest.calls.filter(
          (call: any) => call.command === "start_terminal",
        ).length,
    ),
  ).toBe(0);
  await page
    .getByRole("tablist", { name: "Workspace tabs" })
    .getByRole("tab", { selected: true })
    .press("Control+w");
  await expect(workspaceTabs.getByRole("tab")).toHaveCount(2);
  expect(
    await page.evaluate(() =>
      (window as any).__nativeTest.calls.filter((call: any) =>
        ["git_stage", "git_commit", "close_terminal"].includes(call.command),
      ),
    ),
  ).toEqual([]);
});

test("history preserves the Changes draft, handles retries and empty repositories", async ({
  page,
}) => {
  await openHistory(page, { commits: [], details: {}, diffs: {} });
  await expect(
    page.getByText("No commits yet.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /^Changes/ }).click();
  const draft = "feat(app): preserve the draft\n\nStill editing.";
  await page
    .getByRole("textbox", { name: "Commit message", exact: true })
    .fill(draft);
  await page.evaluate(() => {
    (window as any).__nativeTest.failHistory = true;
  });
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("History is unavailable");
  await page.evaluate((fixture) => {
    (window as any).__nativeTest.failHistory = false;
    (window as any).__nativeTest.gitHistory = fixture;
  }, history);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByRole("list", { name: "Commit history" }).getByRole("listitem"),
  ).toHaveCount(50);
  await page
    .getByRole("tab", { name: "History", exact: true })
    .press("ArrowLeft");
  await expect(
    page.getByRole("textbox", { name: "Commit message", exact: true }),
  ).toHaveValue(draft);
  await page.getByRole("tab", { name: /^Changes/ }).press("End");
  await page.evaluate(() => {
    (window as any).__nativeTest.failCommitDetails = true;
  });
  await page
    .getByRole("list", { name: "Commit history" })
    .getByRole("button")
    .first()
    .click();
  await expect(page.getByRole("alert")).toContainText("Commit is unavailable");
  await page.evaluate(() => {
    (window as any).__nativeTest.failCommitDetails = false;
  });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("article")).toContainText(commits[0].subject);
});

test("commit diffs ignore late responses and remain usable in the minimum window", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 800, height: 420 });
  await openHistory(page);
  await page.evaluate(() => {
    (window as any).__nativeTest.diffDelays["src/Overview.tsx"] = 600;
  });
  await page
    .getByRole("list", { name: "Commit history" })
    .getByRole("button")
    .first()
    .click();
  const files = page.getByRole("navigation", { name: "Changed files" });
  await files.getByRole("button", { name: /public\/icon.png/ }).click();
  await expect(
    page.getByRole("region", { name: "Diff for public/icon.png", exact: true }),
  ).toContainText("Binary files");
  await expect
    .poll(() => page.evaluate(() => (window as any).__nativeTest.resolvedDiffs))
    .toContain("src/Overview.tsx");
  await expect(
    page.getByRole("region", { name: "Diff for public/icon.png", exact: true }),
  ).toContainText("Binary files");
  await page.evaluate(() => {
    (window as any).__nativeTest.failCommitDiff = true;
  });
  await files.getByRole("button", { name: /src\/ProjectList.tsx/ }).click();
  await expect(page.getByRole("alert")).toContainText("Diff is unavailable");
  await page.evaluate(() => {
    (window as any).__nativeTest.failCommitDiff = false;
    (window as any).__nativeTest.gitHistory.diffs[
      "src/ProjectList.tsx"
    ].truncated = true;
  });
  await page.getByRole("button", { name: "Retry diff", exact: true }).click();
  await expect(page.getByText(/This diff is too large/)).toBeVisible();
  await expect(
    page.getByRole("region", {
      name: "Diff for src/ProjectList.tsx",
      exact: true,
    }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("history-minimum.png") });
  await page
    .getByRole("button", { name: "Load more commits", exact: true })
    .click();
  await page
    .getByRole("list", { name: "Commit history" })
    .getByRole("button")
    .last()
    .click();
  await expect(
    page.getByText("This commit has no file changes.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Initial commit", { exact: true })).toBeVisible();
});
