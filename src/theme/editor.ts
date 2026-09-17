import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { effectiveTheme } from "./runtime";
const syntaxTags = {
  keyword: [tags.keyword, tags.modifier, tags.operatorKeyword],
  string: [
    tags.string,
    tags.special(tags.string),
    tags.regexp,
    tags.attributeValue,
    tags.monospace,
  ],
  number: [tags.number, tags.bool, tags.null, tags.atom],
  comment: [tags.comment, tags.meta],
  type: [tags.typeName, tags.className, tags.namespace, tags.tagName],
  function: [
    tags.function(tags.variableName),
    tags.function(tags.propertyName),
  ],
  variable: tags.variableName,
  property: [tags.propertyName, tags.attributeName],
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
        ".cm-content": { caretColor: "var(--editor-cursor)" },
        ".cm-activeLine": {
          backgroundColor:
            "color-mix(in srgb, var(--editor-active-line) 60%, transparent)",
        },
        ".cm-activeLineGutter": {
          backgroundColor: "var(--editor-active-line)",
          color: "var(--editor-foreground)",
        },
        ".cm-selectionBackground": {
          backgroundColor:
            "color-mix(in srgb, var(--editor-selection) 72%, var(--editor-background))",
        },
        "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
          {
            backgroundColor: "var(--editor-selection)",
          },
        // Let drawSelection hide the native background and retain syntax colors.
        ".cm-content ::selection, .cm-content::selection": {
          backgroundColor: "var(--editor-selection)",
          color: "currentColor",
        },
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
