import {
  Compartment,
  EditorSelection,
  EditorState,
  Transaction,
} from "@codemirror/state";
import type { Extension, Text, TransactionSpec } from "@codemirror/state";
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
  redo,
  undo,
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
import {
  gotoLine,
  openSearchPanel,
  search,
  searchKeymap,
} from "@codemirror/search";
import { tags } from "@lezer/highlight";
import { listen } from "@tauri-apps/api/event";
import { api, errorMessage } from "./api";
import type { EditorPosition, FileTab } from "./model";
import { editorFileKey, editorPreferences } from "./editor-service";
import {
  editorLanguage,
  editorLanguages,
  loadEditorLanguage,
} from "./editor-languages";
import type { Language } from "./editor-languages";
import {
  lineEndingHistory,
  lineEndingLabel,
  lineEndings,
  readEditorText,
  writeEditorText,
} from "./editor-text";
import type { LineEndings } from "./editor-text";
import { themeAppliedEvent } from "./theme-runtime";

interface DiskFile {
  path: string;
  relative: string;
  content: string | null;
  revision: string;
  encoding: string;
  readOnly: boolean;
}
export interface EditorSnapshot {
  dirty: boolean;
  saving: boolean;
  error: string;
  conflict: boolean;
  readOnly: boolean;
  language: string;
  languageMode: string;
  tabSize: number;
  indentSize: number;
  insertSpaces: boolean;
  customIndentation: boolean;
  encoding: string;
  lineEnding: string;
  large: boolean;
  wrapped: boolean;
  line: number;
  column: number;
}

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

const buffers = new Map<string, EditorDocument>();
const aliases = new Map<string, EditorDocument>();
const opening = new Map<string, Promise<EditorDocument>>();
let retained = new Set<string>();
let activeView: { id: string; document: EditorDocument } | undefined;
let notifyAll = () => {};
let watchQueue = Promise.resolve();
let listening: Promise<unknown> | undefined;

function needsLargeFileMode(content: string) {
  if (content.length > 1_048_576) return true;
  let lineLength = 0;
  for (let index = 0; index < content.length; index++) {
    if (content[index] === "\n" || content[index] === "\r") lineLength = 0;
    else if (++lineLength > 20_000) return true;
  }
  return false;
}

interface Indentation {
  tabSize: number;
  indentSize: number;
  insertSpaces: boolean;
}

function indentation({
  tabSize,
  indentSize,
  insertSpaces,
}: Indentation): Extension {
  return [
    EditorState.tabSize.of(tabSize),
    indentUnit.of(insertSpaces ? " ".repeat(indentSize) : "\t"),
  ];
}

export function configureEditors(notify: () => void) {
  notifyAll = notify;
  listening ??= listen<string[]>("editor-files-changed", ({ payload }) => {
    for (const path of payload) buffers.get(path)?.scheduleRefresh();
  }).catch((error) => {
    for (const document of buffers.values())
      document.reportError(`File monitoring: ${errorMessage(error)}`);
  });
  window.addEventListener("focus", () => {
    for (const document of buffers.values()) document.scheduleRefresh();
  });
}

function updateWatches() {
  watchQueue = watchQueue
    .catch(() => {})
    .then(async () => {
      await listening;
      const files = [...buffers.values()].map((document) => document.location);
      try {
        await api("watch_editor_files", { files });
      } catch (error) {
        for (const document of buffers.values())
          document.reportError(
            `File monitoring: ${errorMessage(error)}. Changes are also checked when the window gains focus.`,
          );
      }
    });
}

export function retainDocuments(tabs: FileTab[]) {
  retained = new Set(tabs.map(editorFileKey));
  for (const key of aliases.keys()) if (!retained.has(key)) aliases.delete(key);
  const kept = new Set(aliases.values());
  let changed = false;
  for (const [path, document] of buffers) {
    if (kept.has(document)) continue;
    document.dispose();
    buffers.delete(path);
    changed = true;
  }
  if (changed) {
    updateWatches();
    notifyAll();
  }
}

export const documents = () => [...buffers.values()];
export const findDocument = (tab: FileTab) => aliases.get(editorFileKey(tab));
export const activeEditorPosition = () =>
  activeView && {
    id: activeView.id,
    position: activeView.document.position(),
  };

export function openDocument(tab: FileTab): Promise<EditorDocument> {
  const key = editorFileKey(tab);
  const existing = aliases.get(key);
  if (existing) {
    existing.scheduleRefresh();
    return Promise.resolve(existing);
  }
  let pending = opening.get(key);
  if (!pending) {
    pending = api<DiskFile>("read_editor_file", {
      root: tab.root,
      relative: tab.relative,
    })
      .then((data) => {
        if (!retained.has(key))
          throw new Error("This file tab has been closed.");
        let document = buffers.get(data.path);
        if (!document) {
          document = new EditorDocument(tab, data);
          buffers.set(data.path, document);
        }
        aliases.set(key, document);
        updateWatches();
        // Close the gap between the initial read and registering directory watches.
        void watchQueue.then(() => document.scheduleRefresh());
        notifyAll();
        return document;
      })
      .finally(() => opening.delete(key));
    opening.set(key, pending);
  }
  return pending;
}

export class EditorDocument {
  readonly location: { root: string; relative: string };
  readonly path: string;
  state: EditorState;
  private view?: EditorView;
  private savedDoc: Text;
  private savedEndings: LineEndings;
  private revision: string;
  private language = new Compartment();
  private editable = new Compartment();
  private wrapping = new Compartment();
  private appearance = new Compartment();
  private indentation = new Compartment();
  private indentationOverride: Partial<Indentation> = {};
  private languageExtension: Extension = [];
  private languageDefinition?: Language;
  private syntaxDefinition?: Language;
  private languageVersion = 0;
  private syntaxError = "";
  private external?: DiskFile;
  private savePromise?: Promise<void>;
  private checking = false;
  private recheck = false;
  private disposed = false;
  private diskError = "";
  private reloadVersion = 0;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private dirtyTimer?: ReturnType<typeof setTimeout>;
  private restoreFrame?: number;
  private listeners = new Set<() => void>();
  private snapshot: EditorSnapshot;

  constructor(tab: FileTab, data: DiskFile) {
    this.location = { root: tab.root, relative: tab.relative };
    this.path = data.path;
    this.revision = data.revision;
    const content = data.content ?? "";
    const large = needsLargeFileMode(content);
    const definition = editorLanguage(tab.relative);
    this.languageDefinition = definition;
    this.snapshot = {
      dirty: false,
      saving: false,
      error: "",
      conflict: false,
      readOnly: data.readOnly,
      language: definition?.name ?? "Plain text",
      languageMode: "auto",
      ...this.currentIndentation(),
      customIndentation: false,
      encoding: data.encoding.toUpperCase(),
      lineEnding: "LF",
      large,
      wrapped: false,
      line: 1,
      column: 1,
    };
    this.state = this.createState(content);
    this.savedDoc = this.state.doc;
    this.savedEndings = this.state.field(lineEndings);
    this.snapshot.lineEnding = lineEndingLabel(this.state);
    this.loadSyntax();
    window.addEventListener(themeAppliedEvent, this.applyAppearance);
  }

  private applyAppearance = () => {
    const dark = document.documentElement.dataset.appearance !== "light";
    if (!this.disposed && this.state.facet(EditorView.darkTheme) !== dark)
      this.dispatch({
        effects: this.appearance.reconfigure(EditorView.darkTheme.of(dark)),
      });
  };

  private loadSyntax() {
    const definition = this.languageDefinition;
    if (
      !definition ||
      this.snapshot.large ||
      this.syntaxDefinition === definition
    )
      return;
    const version = ++this.languageVersion;
    this.syntaxDefinition = definition;
    void loadEditorLanguage(definition)
      .then((extension) => {
        if (this.disposed || version !== this.languageVersion) return;
        this.languageExtension = extension;
        if (!this.snapshot.large) this.applyLanguage(extension);
        if (this.snapshot.error === this.syntaxError)
          this.publish({ error: "" });
        this.syntaxError = "";
      })
      .catch((error) => {
        if (this.disposed || version !== this.languageVersion) return;
        this.syntaxDefinition = undefined;
        this.syntaxError = `Syntax highlighting: ${errorMessage(error)}`;
        this.reportError(this.syntaxError);
      });
  }

  private applyLanguage(extension: Extension) {
    this.dispatch({
      effects: this.language.reconfigure(extension),
      // Recompute selection-based decorations after changing the parser.
      selection: this.state.selection,
      annotations: Transaction.addToHistory.of(false),
    });
  }

  setLanguage(mode: string) {
    const definition =
      mode === "auto"
        ? editorLanguage(this.location.relative)
        : editorLanguages.find((language) => language.name === mode);
    if (
      this.disposed ||
      (!definition && mode !== "auto" && mode !== "Plain text")
    )
      return;
    if (mode !== this.snapshot.languageMode) {
      ++this.languageVersion;
      this.languageDefinition = definition;
      this.syntaxDefinition = undefined;
      this.languageExtension = [];
      this.applyLanguage([]);
      this.publish(
        { languageMode: mode, language: definition?.name ?? "Plain text" },
        false,
      );
      if (this.snapshot.error === this.syntaxError) this.publish({ error: "" });
      this.syntaxError = "";
    }
    this.loadSyntax();
  }

  private createState(
    content: string,
    large = this.snapshot.large,
    readOnly = this.snapshot.readOnly,
  ): EditorState {
    const parsed = readEditorText(content);
    return EditorState.create({
      doc: parsed.doc,
      extensions: [
        lineNumbers(),
        highlightSpecialChars(),
        history({ minDepth: large ? 30 : 100 }),
        drawSelection(),
        rectangularSelection(),
        EditorState.allowMultipleSelections.of(true),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        lineEndings.init(() => parsed.lineEndings),
        lineEndingHistory,
        this.indentation.of(indentation(this.currentIndentation())),
        this.language.of(large ? [] : this.languageExtension),
        this.wrapping.of([]),
        this.editable.of([
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
        ]),
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
        EditorView.contentAttributes.of({
          "aria-label": "File contents",
          spellcheck: "false",
          autocapitalize: "off",
          autocorrect: "off",
        }),
        EditorView.theme({
          "&": { height: "100%" },
          ".cm-scroller": { overflow: "auto" },
        }),
        this.appearance.of(
          EditorView.darkTheme.of(
            document.documentElement.dataset.appearance !== "light",
          ),
        ),
      ],
    });
  }

  get dirty() {
    return this.snapshot.dirty;
  }
  private currentIndentation(): Indentation {
    const defaults = editorPreferences();
    return {
      ...defaults,
      indentSize: defaults.tabSize,
      ...this.indentationOverride,
    };
  }
  setIndentation(value: Partial<Indentation> | null) {
    if (
      value &&
      ((value.tabSize !== undefined &&
        (!Number.isInteger(value.tabSize) ||
          value.tabSize < 1 ||
          value.tabSize > 16)) ||
        (value.indentSize !== undefined &&
          (!Number.isInteger(value.indentSize) ||
            value.indentSize < 1 ||
            value.indentSize > 16)) ||
        (value.insertSpaces !== undefined &&
          typeof value.insertSpaces !== "boolean"))
    )
      return;
    this.indentationOverride = value
      ? { ...this.indentationOverride, ...value }
      : {};
    this.applyIndentation();
  }
  applyIndentation() {
    if (this.disposed) return;
    const value = this.currentIndentation();
    this.dispatch({
      effects: this.indentation.reconfigure(indentation(value)),
    });
    this.publish(
      {
        ...value,
        customIndentation: Object.keys(this.indentationOverride).length > 0,
      },
      false,
    );
  }
  focus() {
    this.view?.focus();
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(changes: Partial<EditorSnapshot>, global = true) {
    if (
      this.disposed ||
      Object.entries(changes).every(
        ([key, value]) => this.snapshot[key as keyof EditorSnapshot] === value,
      )
    )
      return;
    this.snapshot = { ...this.snapshot, ...changes };
    for (const listener of this.listeners) listener();
    if (global) notifyAll();
  }
  reportError(message: string) {
    this.publish({ error: message });
  }

  attach(parent: HTMLElement, tab: FileTab): EditorView {
    this.detach();
    const position = tab.position;
    if (position)
      this.state = this.state.update({
        selection: EditorSelection.single(
          Math.min(position.anchor, this.state.doc.length),
          Math.min(position.head, this.state.doc.length),
        ),
        annotations: Transaction.addToHistory.of(false),
      }).state;
    this.view = new EditorView({
      parent,
      state: this.state,
      scrollTo: position
        ? EditorView.scrollIntoView(this.state.selection.main.head)
        : undefined,
      dispatchTransactions: (transactions, view) => {
        view.update(transactions);
        this.state = view.state;
        this.afterTransactions(transactions);
      },
    });
    activeView = { id: tab.id, document: this };
    if (position) {
      this.view.requestMeasure({
        read: () => null,
        write: () => {
          // Restore pixels after CodeMirror replaces its estimated line heights.
          this.restoreFrame = requestAnimationFrame(() => {
            if (!this.view) return;
            this.view.scrollDOM.scrollTop = position.scrollTop;
            this.view.scrollDOM.scrollLeft = position.scrollLeft;
          });
        },
      });
    }
    this.updateCursor();
    this.view.focus();
    return this.view;
  }

  detach() {
    if (this.restoreFrame !== undefined)
      cancelAnimationFrame(this.restoreFrame);
    if (activeView?.document === this) activeView = undefined;
    this.view?.destroy();
    this.view = undefined;
  }
  position(): EditorPosition {
    return {
      anchor: this.state.selection.main.anchor,
      head: this.state.selection.main.head,
      scrollTop: this.view?.scrollDOM.scrollTop ?? 0,
      scrollLeft: this.view?.scrollDOM.scrollLeft ?? 0,
    };
  }
  private updateCursor() {
    const head = this.state.selection.main.head;
    const line = this.state.doc.lineAt(head);
    this.publish(
      {
        line: line.number,
        column: head - line.from + 1,
        lineEnding: lineEndingLabel(this.state),
      },
      false,
    );
  }
  private afterTransactions(transactions: readonly Transaction[]) {
    if (transactions.some((transaction) => transaction.docChanged)) {
      this.publish({ dirty: true });
      clearTimeout(this.dirtyTimer);
      this.dirtyTimer = setTimeout(
        () => this.publish({ dirty: !this.matchesSaved() }),
        200,
      );
    }
    this.updateCursor();
  }
  private dispatch(spec: TransactionSpec) {
    if (this.view) this.view.dispatch(spec);
    else {
      const transaction = this.state.update(spec);
      this.state = transaction.state;
      this.afterTransactions([transaction]);
    }
  }
  private matchesSaved() {
    const endings = this.state.field(lineEndings);
    return (
      this.state.doc.eq(this.savedDoc) &&
      endings.separator === this.savedEndings.separator &&
      (endings.endings === this.savedEndings.endings ||
        (endings.endings !== null &&
          this.savedEndings.endings !== null &&
          endings.endings.length === this.savedEndings.endings.length &&
          endings.endings.every(
            (ending, index) => ending === this.savedEndings.endings![index],
          )))
    );
  }
  command(
    action: "findFile" | "goToLine" | "toggleWordWrap" | "undo" | "redo",
  ) {
    if (!this.view) return;
    if (action === "findFile") openSearchPanel(this.view);
    else if (action === "goToLine") gotoLine(this.view);
    else if (action === "undo") {
      undo(this.view);
      this.view.focus();
    } else if (action === "redo") {
      redo(this.view);
      this.view.focus();
    } else if (!this.snapshot.large) {
      const wrapped = !this.snapshot.wrapped;
      this.dispatch({
        effects: this.wrapping.reconfigure(
          wrapped ? EditorView.lineWrapping : [],
        ),
      });
      this.publish({ wrapped }, false);
    }
  }

  save(overwrite = false): Promise<void> {
    if (this.savePromise)
      return this.savePromise.then(() =>
        this.dirty ? this.save(overwrite) : undefined,
      );
    if (this.snapshot.readOnly)
      return Promise.reject(new Error("This file is read-only."));
    if (this.snapshot.conflict && !overwrite)
      return Promise.reject(
        new Error("Resolve the file's disk changes before saving."),
      );
    const savedState = this.state;
    this.publish({ saving: true, error: "" });
    const expected =
      overwrite && this.external ? this.external.revision : this.revision;
    const encoding =
      overwrite && this.external
        ? this.external.encoding.toUpperCase()
        : this.snapshot.encoding;
    this.savePromise = api<string>("save_editor_file", {
      request: {
        ...this.location,
        content: writeEditorText(savedState),
        revision: expected,
      },
    })
      .then((revision) => {
        this.revision = revision;
        this.savedDoc = savedState.doc;
        this.savedEndings = savedState.field(lineEndings);
        this.external = undefined;
        this.publish({
          dirty: !this.matchesSaved(),
          conflict: false,
          error: "",
          encoding,
        });
      })
      .catch((error: unknown) => {
        const conflict =
          !!error &&
          typeof error === "object" &&
          "kind" in error &&
          error.kind === "conflict";
        this.publish({
          error: errorMessage(error),
          ...(conflict ? { conflict: true } : {}),
        });
        this.recheck = true;
        throw error;
      })
      .finally(() => {
        this.savePromise = undefined;
        this.publish({ saving: false });
        if (this.recheck) this.scheduleRefresh();
      });
    return this.savePromise;
  }

  scheduleRefresh() {
    if (this.disposed) return;
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), 150);
  }
  private async refresh() {
    if (this.disposed) return;
    if (this.checking || this.savePromise) {
      this.recheck = true;
      return;
    }
    this.checking = true;
    this.recheck = false;
    const knownRevision = this.revision;
    const reloadVersion = this.reloadVersion;
    try {
      const data = await api<DiskFile>("read_editor_file", {
        ...this.location,
        knownRevision,
      });
      if (this.disposed) return;
      if (
        knownRevision !== this.revision ||
        reloadVersion !== this.reloadVersion
      ) {
        this.recheck = true;
        return;
      }
      if (this.diskError === this.snapshot.error) this.publish({ error: "" });
      this.diskError = "";
      this.setReadOnly(data.readOnly);
      if (data.revision === this.revision) {
        this.external = undefined;
        this.publish({ conflict: false });
      } else if (this.dirty) {
        this.external = data;
        this.publish({ conflict: true, error: "" });
      } else this.replaceFromDisk(data);
    } catch (error) {
      this.diskError = `Cannot check the file on disk: ${errorMessage(error)}`;
      this.reportError(this.diskError);
    } finally {
      this.checking = false;
      if (this.recheck && !this.savePromise) this.scheduleRefresh();
    }
  }
  private setReadOnly(value: boolean) {
    if (this.snapshot.readOnly === value) return;
    this.dispatch({
      effects: this.editable.reconfigure([
        EditorState.readOnly.of(value),
        EditorView.editable.of(!value),
      ]),
    });
    this.publish({ readOnly: value });
  }
  private replaceFromDisk(data: DiskFile) {
    const position = this.position();
    this.revision = data.revision;
    const content = data.content ?? "";
    const large = needsLargeFileMode(content);
    this.state = this.createState(content, large, data.readOnly);
    this.state = this.state.update({
      selection: EditorSelection.single(
        Math.min(position.anchor, this.state.doc.length),
        Math.min(position.head, this.state.doc.length),
      ),
    }).state;
    this.savedDoc = this.state.doc;
    this.savedEndings = this.state.field(lineEndings);
    this.external = undefined;
    this.view?.setState(this.state);
    if (this.view) {
      this.view.scrollDOM.scrollTop = position.scrollTop;
      this.view.scrollDOM.scrollLeft = position.scrollLeft;
    }
    this.publish({
      dirty: false,
      conflict: false,
      error: "",
      readOnly: data.readOnly,
      large,
      encoding: data.encoding.toUpperCase(),
      lineEnding: lineEndingLabel(this.state),
      wrapped: false,
    });
    this.loadSyntax();
    this.updateCursor();
  }
  async reload() {
    if (this.savePromise) await this.savePromise;
    const version = ++this.reloadVersion;
    const data = await api<DiskFile>("read_editor_file", this.location);
    if (!this.disposed && version === this.reloadVersion) {
      ++this.reloadVersion;
      this.replaceFromDisk(data);
      this.scheduleRefresh();
    }
  }
  dispose() {
    this.disposed = true;
    window.removeEventListener(themeAppliedEvent, this.applyAppearance);
    clearTimeout(this.refreshTimer);
    clearTimeout(this.dirtyTimer);
    this.detach();
    this.listeners.clear();
  }
}
