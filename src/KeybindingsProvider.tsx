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
import { api, errorMessage, macOS, native } from "./api";
import { defaultKeybindings, restoreKeybindings } from "./keybindings";
import type { Keybindings, KeybindingSettings } from "./keybindings";

interface Preferences {
  bindings: Keybindings;
  defaults: Keybindings;
  focusFollowsPointer: boolean;
  ready: boolean;
  error: string;
  reload: () => Promise<void>;
  save: (bindings: Keybindings, focusFollowsPointer?: boolean) => Promise<void>;
}
const Context = createContext<Preferences | null>(null);
const defaults = defaultKeybindings(macOS);

export function KeybindingsProvider({ children }: { children: ReactNode }) {
  const [bindings, setBindings] = useState(defaults);
  const [focusFollowsPointer, setFocusFollowsPointer] = useState(false);
  const [ready, setReady] = useState(!native);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const mounted = useRef(false);
  const reload = useCallback(async () => {
    if (!native) return;
    const request = ++revision.current;
    try {
      const data = await api<KeybindingSettings | null>("load_keybindings");
      const value = restoreKeybindings(data, macOS);
      if (mounted.current && request === revision.current) {
        setBindings(value);
        setFocusFollowsPointer(data?.focusFollowsPointer ?? false);
        setError("");
      }
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
    const unlisten = listen("keybindings-changed", () => void reload());
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
  const save = async (
    next: Keybindings,
    pointerFocus = focusFollowsPointer,
  ) => {
    const data = {
      version: 1,
      bindings: next,
      focusFollowsPointer: pointerFocus,
    };
    restoreKeybindings(data, macOS);
    if (native) await api("save_keybindings", { data });
    if (mounted.current) {
      ++revision.current;
      setBindings(next);
      setFocusFollowsPointer(pointerFocus);
      setError("");
    }
  };
  return (
    <Context.Provider
      value={{
        bindings,
        defaults,
        focusFollowsPointer,
        ready,
        error,
        reload,
        save,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useKeybindings() {
  const preferences = useContext(Context);
  if (!preferences) throw new Error("KeybindingsProvider is missing.");
  return preferences;
}
