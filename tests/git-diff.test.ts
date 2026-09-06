import assert from "node:assert/strict";
import { test } from "node:test";
import { diffLines } from "../src/git-diff.ts";

test("unified diffs keep old and new line numbers across hunks", () => {
  const lines = diffLines(
    "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -2,2 +2,3 @@\n same\n-old\n+new\n+++content\n\\ No newline at end of file\n@@ -9,0 +10,1 @@\n+end\n",
  );
  assert.deepEqual(
    lines.filter((line) =>
      ["context", "addition", "deletion"].includes(line.kind),
    ),
    [
      { kind: "context", text: " same", oldLine: 2, newLine: 2 },
      { kind: "deletion", text: "-old", oldLine: 3 },
      { kind: "addition", text: "+new", newLine: 3 },
      { kind: "addition", text: "+++content", newLine: 4 },
      { kind: "addition", text: "+end", newLine: 10 },
    ],
  );
  assert.equal(lines[2].kind, "header");
  assert.equal(lines[8].oldLine, undefined);
});

test("metadata, binary changes and each new file stay outside text hunks", () => {
  const lines = diffLines(
    "@@ -1 +1 @@\n-before\n+after\ndiff --git a/image b/image\nBinary files a/image and b/image differ\ndiff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -0,0 +1 @@\n+zażółć 🦀\n",
  );
  assert.equal(lines[4].kind, "header");
  assert.equal(lines[7].kind, "header");
  assert.deepEqual(lines.at(-1), {
    kind: "addition",
    text: "+zażółć 🦀",
    newLine: 1,
  });
});
