import { fileTabs, updateTab } from "./model";
import type { FileTab, Session } from "./model";
import type { EditorDocument } from "./editor-runtime";
import { defaultEditorPreferences } from "./editor-preferences";
import type { EditorPreferences } from "./editor-preferences";

let preferences = defaultEditorPreferences;
export const editorPreferences = () => preferences;
export function applyEditorPreferences(next: EditorPreferences) {
  if (
    next.tabSize === preferences.tabSize &&
    next.insertSpaces === preferences.insertSpaces
  )
    return;
  preferences = next;
  runtime?.documents().forEach((document) => document.applyIndentation());
}

let runtime: typeof import("./editor-runtime") | undefined;
let loading: Promise<typeof import("./editor-runtime")> | undefined;
let tabs: FileTab[] = [];
let revision = 0;
const listeners = new Set<() => void>();
export const editorFileKey = (file: Pick<FileTab, "root" | "relative">) =>
  `${file.root}\0${file.relative}`;
export const editorRevision = () => revision;
export const subscribeEditors = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function notify() {
  ++revision;
  for (const listener of listeners) listener();
}

export function retainEditorTabs(session: Session | undefined) {
  tabs = session ? fileTabs(session) : [];
  runtime?.retainDocuments(tabs);
}

export async function openEditorDocument(
  tab: FileTab,
): Promise<EditorDocument> {
  if (!loading)
    loading = import("./editor-runtime")
      .then((module) => {
        runtime = module;
        module.configureEditors(notify);
        module.retainDocuments(tabs);
        return module;
      })
      .catch((error) => {
        loading = undefined;
        throw error;
      });
  return (await loading).openDocument(tab);
}

export function loadedEditor(tab: FileTab): EditorDocument | undefined {
  return runtime?.findDocument(tab);
}

export function closingEditorDocuments(
  ids?: ReadonlySet<string>,
): EditorDocument[] {
  if (!runtime) return [];
  const kept = new Set(
    tabs
      .filter((tab) => ids && !ids.has(tab.id))
      .map((tab) => runtime!.findDocument(tab)),
  );
  return runtime
    .documents()
    .filter((document) => document.dirty && !kept.has(document));
}

export function captureEditorPositions(session: Session): Session {
  const current = runtime?.activeEditorPosition();
  return current
    ? updateTab(session, current.id, (tab) =>
        tab.type === "file" ? { ...tab, position: current.position } : tab,
      )
    : session;
}
