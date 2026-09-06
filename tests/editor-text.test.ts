import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState } from "@codemirror/state";
import { history, isolateHistory, redo, undo } from "@codemirror/commands";
import {
  lineEndingHistory,
  lineEndingLabel,
  lineEndings,
  readEditorText,
  writeEditorText,
} from "../src/editor-text.ts";

function editor(content: string) {
  const parsed = readEditorText(content);
  return EditorState.create({
    doc: parsed.doc,
    extensions: [
      lineEndings.init(() => parsed.lineEndings),
      lineEndingHistory,
      history(),
    ],
  });
}

test("opening and saving preserves Unicode, empty files and exact line endings", () => {
  for (const text of [
    "",
    "🦀 zażółć",
    "a\nb\n",
    "a\r\nb\r\n",
    "a\rb\r",
    "a\r\nb\nc\rd\r\n",
    "\r\n\n\r",
  ]) {
    const state = editor(text);
    assert.equal(writeEditorText(state), text);
    const edited = state.update({
      changes: { from: 0, insert: "// 🦀 " },
    }).state;
    assert.equal(writeEditorText(edited), `// 🦀 ${text}`);
  }
});

test("new lines inherit the file separator without changing untouched mixed endings", () => {
  const uniform = editor("a\r\nb\r\n");
  assert.equal(
    writeEditorText(
      uniform.update({ changes: { from: 1, insert: "\nnext" } }).state,
    ),
    "a\r\nnext\r\nb\r\n",
  );
  const mixed = editor("a\r\nb\nc\rd\r\n");
  assert.equal(lineEndingLabel(mixed), "Mixed EOL");
  const changed = mixed.update({
    changes: [
      { from: 1, to: 3, insert: "\nx" },
      { from: 6, insert: "new\n" },
    ],
  }).state;
  assert.equal(writeEditorText(changed), "a\r\nx\nc\rnew\r\nd\r\n");
  const deleted = mixed.update({ changes: { from: 0, to: 4 } }).state;
  assert.equal(writeEditorText(deleted), "c\rd\r\n");
});

test("undo and redo restore mixed line endings as well as document text", () => {
  const original = "a\r\nb\nc\rd\r\n";
  let state = editor(original);
  const target = {
    get state() {
      return state;
    },
    dispatch(transaction: { state: EditorState }) {
      state = transaction.state;
    },
  };
  state = state.update({
    changes: { from: 1, to: 6, insert: "\nreplaced\n" },
    annotations: isolateHistory.of("full"),
  }).state;
  const replaced = writeEditorText(state);
  assert.equal(replaced, "a\r\nreplaced\r\nd\r\n");
  state = state.update({
    changes: { from: state.doc.length, insert: "last\n" },
    annotations: isolateHistory.of("full"),
  }).state;
  const final = writeEditorText(state);
  assert.equal(undo(target), true);
  assert.equal(writeEditorText(state), replaced);
  assert.equal(undo(target), true);
  assert.equal(writeEditorText(state), original);
  assert.equal(redo(target), true);
  assert.equal(writeEditorText(state), replaced);
  assert.equal(redo(target), true);
  assert.equal(writeEditorText(state), final);
});

test("grouped history restores the earliest line ending map", () => {
  const original = "a\r\nb\nc\rd";
  let state = editor(original);
  const target = {
    get state() {
      return state;
    },
    dispatch(transaction: { state: EditorState }) {
      state = transaction.state;
    },
  };
  state = state.update({
    changes: { from: 1, to: 3, insert: "\nx" },
    userEvent: "input.type",
  }).state;
  state = state.update({
    changes: { from: 3, to: 5, insert: "\ny" },
    userEvent: "input.type",
  }).state;
  const changed = writeEditorText(state);
  undo(target);
  assert.equal(writeEditorText(state), original);
  redo(target);
  assert.equal(writeEditorText(state), changed);
});
