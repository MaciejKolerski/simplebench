import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { invertedEffects } from "@codemirror/commands";

export interface LineEndings {
  separator: string;
  endings: readonly string[] | null;
}

export function readEditorText(content: string) {
  const endings = content.match(/\r\n|\r|\n/g) ?? [];
  const separator = endings[0] ?? "\n";
  return {
    doc: content.replace(/\r\n|\r/g, "\n"),
    lineEndings: {
      separator,
      endings: endings.some((value) => value !== separator) ? endings : null,
    } satisfies LineEndings,
  };
}

const restoreEndings = StateEffect.define<LineEndings>();
export const lineEndings = StateField.define<LineEndings>({
  create: () => ({ separator: "\n", endings: null }),
  update(value, transaction) {
    for (const effect of transaction.effects)
      if (effect.is(restoreEndings)) return effect.value;
    if (!transaction.docChanged || !value.endings) return value;
    const original = value.endings;
    let result: string[] | undefined;
    let cursor = 0;
    transaction.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
      const start = transaction.startState.doc.lineAt(from).number - 1;
      const end = transaction.startState.doc.lineAt(to).number - 1;
      if (start === end && inserted.lines === 1) return;
      result ??= [];
      for (; cursor < start; cursor++) result.push(original[cursor]);
      for (let line = 1; line < inserted.lines; line++)
        result.push(value.separator);
      cursor = end;
    });
    if (!result) return value;
    for (; cursor < original.length; cursor++) result.push(original[cursor]);
    return { ...value, endings: result };
  },
});

export const lineEndingHistory = invertedEffects.of((transaction) => {
  const previous = transaction.startState.field(lineEndings);
  return previous === transaction.state.field(lineEndings)
    ? []
    : [restoreEndings.of(previous)];
});

export function writeEditorText(state: EditorState): string {
  const { separator, endings } = state.field(lineEndings);
  if (!endings) return state.doc.sliceString(0, state.doc.length, separator);
  const parts: string[] = [];
  const lines = state.doc.iterLines();
  let index = 0;
  while (!lines.next().done) {
    parts.push(lines.value);
    if (index < endings.length) parts.push(endings[index++]);
  }
  return parts.join("");
}

export function lineEndingLabel(state: EditorState): string {
  const value = state.field(lineEndings);
  return value.endings
    ? "Mixed EOL"
    : value.separator === "\r\n"
      ? "CRLF"
      : value.separator === "\r"
        ? "CR"
        : "LF";
}
