export interface DiffLine {
  kind: "header" | "hunk" | "context" | "addition" | "deletion";
  text: string;
  oldLine?: number;
  newLine?: number;
}

export function diffLines(patch: string): DiffLine[] {
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  const lines = patch.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.map((text) => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      return { kind: "hunk", text };
    }
    if (text.startsWith("diff --git ")) inHunk = false;
    if (inHunk) {
      if (text.startsWith("+"))
        return { kind: "addition", text, newLine: newLine++ };
      if (text.startsWith("-"))
        return { kind: "deletion", text, oldLine: oldLine++ };
      if (text.startsWith(" "))
        return {
          kind: "context",
          text,
          oldLine: oldLine++,
          newLine: newLine++,
        };
    }
    return { kind: "header", text };
  });
}
