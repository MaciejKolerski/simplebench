import { EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
} from "@codemirror/commands";
import {
  HighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { search, searchKeymap } from "@codemirror/search";
import { tags } from "@lezer/highlight";

const syntax = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.modifier, tags.operatorKeyword],
    color: "var(--color-accent-text)",
    fontWeight: "600",
  },
  {
    tag: [tags.string, tags.special(tags.string), tags.regexp],
    color: "var(--color-info)",
  },
  {
    tag: [tags.number, tags.bool, tags.null, tags.atom],
    color: "var(--color-warning)",
  },
  {
    tag: [tags.comment, tags.meta],
    color: "var(--color-surface-variant-text)",
    fontStyle: "italic",
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace],
    color: "var(--color-muted-text)",
  },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: "var(--color-background-text)",
  },
  { tag: [tags.heading, tags.strong], fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.link, textDecoration: "underline" },
  { tag: tags.invalid, color: "var(--color-error)" },
]);

export function codeEditorExtensions(large = false): Extension {
  return [
    lineNumbers(),
    highlightSpecialChars(),
    history({ minDepth: large ? 30 : 100 }),
    drawSelection(),
    rectangularSelection(),
    EditorState.allowMultipleSelections.of(true),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    search(),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap.filter(
        (binding) => !["Mod-f", "Alt-g"].includes(binding.key ?? ""),
      ),
      ...foldKeymap,
      ...completionKeymap,
      {
        key: "Tab",
        run: ({ state, dispatch }) => {
          if (state.readOnly) return false;
          if (state.selection.ranges.some((range) => !range.empty))
            return indentMore({ state, dispatch });
          dispatch(
            state.update(state.replaceSelection(state.facet(indentUnit)), {
              scrollIntoView: true,
              userEvent: "input.indent",
            }),
          );
          return true;
        },
        shift: indentLess,
      },
    ]),
    ...(large
      ? []
      : [
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          foldGutter(),
          autocompletion(),
          syntaxHighlighting(syntax),
        ]),
    EditorView.theme({
      "&": { height: "100%" },
      ".cm-scroller": { overflow: "auto" },
    }),
  ];
}
