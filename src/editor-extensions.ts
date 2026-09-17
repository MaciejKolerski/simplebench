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
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
} from "@codemirror/language";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
} from "@codemirror/search";

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
    search({ top: true }),
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
          highlightSelectionMatches({ minSelectionLength: 2 }),
          autocompletion(),
        ]),
    EditorView.theme({
      "&": { height: "100%" },
      ".cm-scroller": { overflow: "auto" },
    }),
  ];
}
