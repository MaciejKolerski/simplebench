import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, errorMessage, native } from "./api";
import {
  defaultEditorPreferences,
  restoreEditorPreferences,
} from "./editor-preferences";
import type { EditorPreferences } from "./editor-preferences";
import { applyEditorPreferences } from "./editor-service";

interface Preferences {
  value: EditorPreferences;
  ready: boolean;
  error: string;
  reload: () => Promise<void>;
  save: (value: EditorPreferences) => Promise<void>;
}
const Context = createContext<Preferences | null>(null);

export function EditorPreferencesProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [value, setValue] = useState(defaultEditorPreferences);
  const [ready, setReady] = useState(!native);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const mounted = useRef(false);
  const apply = (next: EditorPreferences) => {
    applyEditorPreferences(next);
    setValue(next);
    setError("");
  };
  const reload = useCallback(async () => {
    if (!native) return;
    const request = ++revision.current;
    try {
      const next = restoreEditorPreferences(
        await api("load_editor_preferences"),
      );
      if (mounted.current && request === revision.current) apply(next);
    } catch (error) {
      if (mounted.current && request === revision.current)
        setError(errorMessage(error));
    } finally {
      if (mounted.current && request === revision.current) setReady(true);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    if (!native)
      return () => {
        mounted.current = false;
      };
    let current = true;
    const unlisten = listen("editor-preferences-changed", () => void reload());
    void unlisten
      .then(() => {
        if (current) void reload();
      })
      .catch((error) => {
        if (current) {
          setError(errorMessage(error));
          setReady(true);
        }
      });
    const focused = () => void reload();
    window.addEventListener("focus", focused);
    return () => {
      current = false;
      mounted.current = false;
      ++revision.current;
      window.removeEventListener("focus", focused);
      void unlisten.then((stop) => stop()).catch(() => {});
    };
  }, [reload]);
  const save = async (next: EditorPreferences) => {
    const data = { version: 1, ...next };
    const validated = restoreEditorPreferences(data);
    if (native) await api("save_editor_preferences", { data });
    if (mounted.current) {
      ++revision.current;
      apply(validated);
    }
  };
  return (
    <Context.Provider value={{ value, ready, error, reload, save }}>
      {children}
    </Context.Provider>
  );
}

export function useEditorPreferences() {
  const preferences = useContext(Context);
  if (!preferences) throw new Error("EditorPreferencesProvider is missing.");
  return preferences;
}
