import assert from "node:assert/strict";
import { test } from "node:test";
import {
  layoutFits,
  layoutPanes,
  layoutPositions,
  movePane,
  newPane,
  splitPane,
} from "../src/model.ts";
import type { FileTab, Split } from "../src/model.ts";

test("moving a terminal collapses its old split, preserves panels and checks the resulting size", () => {
  const source = { ...newPane("/source"), profileId: "local:fish" };
  const target = newPane("/target");
  const editor: FileTab = {
    type: "file",
    id: "editor",
    title: "note.md",
    root: "/project",
    relative: "note.md",
    position: { anchor: 3, head: 4, scrollTop: 50, scrollLeft: 0 },
  };
  const layout = splitPane(
    splitPane(source, source.id, "horizontal", target),
    target.id,
    "vertical",
    editor,
  ) as Split;
  const original = structuredClone(layout);
  const size = { width: 483, height: 500 };
  for (const side of ["left", "right", "top", "bottom"] as const) {
    const moved = movePane(layout, source.id, target.id, side, size) as Split;
    assert.notEqual(moved, layout);
    assert.equal(moved.id, (layout.second as Split).id);
    assert.equal(moved.second, editor);
    const split = moved.first as Split;
    assert.equal(
      split.axis,
      side === "left" || side === "right" ? "horizontal" : "vertical",
    );
    assert.equal(
      split.first,
      side === "left" || side === "top" ? source : target,
    );
    assert.equal(
      split.second,
      side === "left" || side === "top" ? target : source,
    );
    assert.equal(layoutFits(moved, size), true);
    assert.equal(new Set(layoutPanes(moved).map((pane) => pane.id)).size, 3);
    for (const panel of [source, target, editor])
      assert.equal(
        layoutPanes(moved).find((pane) => pane.id === panel.id),
        panel,
      );
    const positions = layoutPositions(moved, size).filter(
      ({ layout }) => layout.type !== "split",
    );
    for (const { bounds } of positions) {
      assert.ok(bounds.width >= 240 && bounds.height >= 120);
      assert.ok(bounds.left >= 0 && bounds.left + bounds.width <= size.width);
      assert.ok(bounds.top >= 0 && bounds.top + bounds.height <= size.height);
    }
  }
  assert.deepEqual(layout, original);
  assert.notEqual(
    movePane(layout, source.id, editor.id, "bottom", size),
    layout,
  );
  for (const [id, targetId] of [
    [source.id, source.id],
    ["missing", target.id],
    [source.id, "missing"],
    [editor.id, target.id],
  ])
    assert.equal(movePane(layout, id, targetId, "left", size), layout);
  assert.equal(movePane(source, source.id, target.id, "left", size), source);
  for (const tooSmall of [
    { width: 482, height: 300 },
    { width: 483, height: 242 },
    { width: Number.NaN, height: 500 },
  ])
    assert.equal(
      movePane(layout, source.id, target.id, "left", tooSmall),
      layout,
    );
});
