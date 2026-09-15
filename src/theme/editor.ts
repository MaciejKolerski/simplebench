import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { effectiveTheme } from "./runtime";
const syntaxTags = {
  keyword: [tags.keyword, tags.modifier, tags.operatorKeyword],
  string: [tags.string, tags.special(tags.string), tags.regexp],
  number: [tags.number, tags.bool, tags.null, tags.atom],
  comment: [tags.comment, tags.meta],
  type: [tags.typeName, tags.className, tags.namespace],
  function: [
    tags.function(tags.variableName),
    tags.function(tags.propertyName),
  ],
  variable: tags.variableName,
  property: tags.propertyName,
  operator: tags.operator,
  punctuation: tags.punctuation,
  heading: tags.heading,
  strong: tags.strong,
  emphasis: tags.emphasis,
  link: tags.link,
  invalid: tags.invalid,
};
export function editorAppearance(large = false) {
  const theme = effectiveTheme();
  return [
    EditorView.theme(
      {
        "&": {
          height: "100%",
          color: "var(--editor-foreground)",
          backgroundColor: "var(--editor-background)",
        },
        ".cm-scroller": {
          overflow: "auto",
          fontFamily: "var(--editor-font-family)",
          fontSize: "var(--editor-font-size)",
        },
        ".cm-gutters": {
          color: "var(--editor-gutter-foreground)",
          backgroundColor: "var(--editor-gutter-background)",
        },
        ".cm-activeLine, .cm-activeLineGutter": {
          backgroundColor: "var(--editor-active-line)",
        },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
          { backgroundColor: "var(--editor-selection) !important" },
        ".cm-cursor, .cm-dropCursor": {
          borderLeftColor: "var(--editor-cursor)",
        },
      },
      { dark: theme.appearance === "dark" },
    ),
    ...(large
      ? []
      : [
          syntaxHighlighting(
            HighlightStyle.define(
              Object.entries(syntaxTags).map(([name, tag]) => ({
                tag,
                ...theme.syntax[name as keyof typeof syntaxTags],
              })),
            ),
          ),
        ]),
  ];
}
