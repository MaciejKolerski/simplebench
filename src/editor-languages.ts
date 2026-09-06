import { StreamLanguage } from "@codemirror/language";
import type { Extension } from "@codemirror/state";

export interface Language {
  name: string;
  load: () => Promise<Extension>;
}
const language = (name: string, load: Language["load"]): Language => ({
  name,
  load,
});
const javascript = language("JavaScript", () =>
  import("@codemirror/lang-javascript").then((m) =>
    m.javascript({ jsx: true }),
  ),
);
const typescript = language("TypeScript", () =>
  import("@codemirror/lang-javascript").then((m) =>
    m.javascript({ typescript: true, jsx: true }),
  ),
);
const cpp = language("C / C++", () =>
  import("@codemirror/lang-cpp").then((m) => m.cpp()),
);
const shell = language("Shell", () =>
  import("@codemirror/legacy-modes/mode/shell").then((m) =>
    StreamLanguage.define(m.shell),
  ),
);
const definitions: Record<string, Language> = {
  js: javascript,
  jsx: javascript,
  mjs: javascript,
  cjs: javascript,
  ts: typescript,
  tsx: typescript,
  mts: typescript,
  cts: typescript,
  rs: language("Rust", () =>
    import("@codemirror/lang-rust").then((m) => m.rust()),
  ),
  py: language("Python", () =>
    import("@codemirror/lang-python").then((m) => m.python()),
  ),
  go: language("Go", () => import("@codemirror/lang-go").then((m) => m.go())),
  c: cpp,
  h: cpp,
  cc: cpp,
  cpp,
  cxx: cpp,
  hpp: cpp,
  hxx: cpp,
  java: language("Java", () =>
    import("@codemirror/lang-java").then((m) => m.java()),
  ),
  html: language("HTML", () =>
    import("@codemirror/lang-html").then((m) => m.html()),
  ),
  css: language("CSS", () =>
    import("@codemirror/lang-css").then((m) => m.css()),
  ),
  json: language("JSON", () =>
    import("@codemirror/lang-json").then((m) => m.json()),
  ),
  md: language("Markdown", () =>
    import("@codemirror/lang-markdown").then((m) => m.markdown()),
  ),
  yaml: language("YAML", () =>
    import("@codemirror/lang-yaml").then((m) => m.yaml()),
  ),
  sql: language("SQL", () =>
    import("@codemirror/lang-sql").then((m) => m.sql()),
  ),
  xml: language("XML", () =>
    import("@codemirror/lang-xml").then((m) => m.xml()),
  ),
  toml: language("TOML", () =>
    import("@codemirror/legacy-modes/mode/toml").then((m) =>
      StreamLanguage.define(m.toml),
    ),
  ),
  sh: shell,
  bash: shell,
  zsh: shell,
  dockerfile: language("Dockerfile", () =>
    import("@codemirror/legacy-modes/mode/dockerfile").then((m) =>
      StreamLanguage.define(m.dockerFile),
    ),
  ),
};
definitions.htm = definitions.html;
definitions.markdown = definitions.md;
definitions.yml = definitions.yaml;
definitions.svg = definitions.xml;
definitions.pyw = definitions.py;
definitions.jsonc = javascript;
definitions.json5 = javascript;
export const editorLanguages = [...new Set(Object.values(definitions))].sort(
  (a, b) => a.name.localeCompare(b.name),
);
const loaded = new Map<Language, Promise<Extension>>();

export function editorLanguage(filename: string): Language | undefined {
  const name = filename.split(/[\\/]/).pop()!.toLowerCase();
  const extension = name.includes(".")
    ? name.slice(name.lastIndexOf(".") + 1)
    : name;
  return (
    definitions[extension] ??
    (name.startsWith("dockerfile.") ? definitions.dockerfile : undefined)
  );
}

export function loadEditorLanguage(definition: Language): Promise<Extension> {
  let pending = loaded.get(definition);
  if (!pending) {
    pending = definition.load().catch((error) => {
      loaded.delete(definition);
      throw error;
    });
    loaded.set(definition, pending);
  }
  return pending;
}
