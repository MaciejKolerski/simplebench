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
import { builtinPreferences } from "./themes";
import type {
  Appearance,
  AppearancePreference,
  ThemeBundle,
  ThemeCurrent,
  ThemePreferences,
} from "./themes";
import { applyAppearance, prepareTheme } from "./theme-runtime";

interface Themes {
  preferences: ThemePreferences;
  ready: boolean;
  error: string;
  safeMode: boolean;
  fixedAppearance: Appearance | null;
  reload: () => Promise<void>;
  select: (
    active: string | null,
    appearance?: AppearancePreference,
  ) => Promise<void>;
}
const Context = createContext<Themes | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(builtinPreferences);
  const [ready, setReady] = useState(!native);
  const [error, setError] = useState("");
  const [safeMode, setSafeMode] = useState(false);
  const [fixedAppearance, setFixedAppearance] = useState<Appearance | null>(
    null,
  );
  const appliedAppearance = useRef<AppearancePreference>("system");
  const mounted = useRef(false);
  const revision = useRef(0);
  const saving = useRef(false);
  const synchronizing = useRef(0);
  const syncWindow = useCallback(async (appearance: AppearancePreference) => {
    ++synchronizing.current;
    try {
      await api("sync_theme_window", { appearance });
    } finally {
      --synchronizing.current;
    }
  }, []);
  const reload = useCallback(async () => {
    if (!native || saving.current) return;
    const request = ++revision.current;
    try {
      const current = await api<ThemeCurrent>("load_theme_preferences");
      const prepared = await prepareTheme(current.theme, current.preferences);
      if (!mounted.current || request !== revision.current || saving.current) {
        prepared.dispose();
        return;
      }
      try {
        await syncWindow(prepared.appearance);
      } catch (error) {
        prepared.dispose();
        throw error;
      }
      if (!mounted.current || request !== revision.current || saving.current) {
        prepared.dispose();
        return;
      }
      prepared.commit();
      appliedAppearance.current = prepared.appearance;
      setFixedAppearance(prepared.manifest.appearance ?? null);
      setPreferences(current.preferences);
      setSafeMode(current.safeMode);
      setError("");
    } catch (error) {
      if (mounted.current && request === revision.current)
        setError(
          `${errorMessage(error)} The last working appearance is still in use.`,
        );
    } finally {
      if (mounted.current && request === revision.current) setReady(true);
    }
  }, [syncWindow]);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    const unlisten = native
      ? listen("theme-changed", () => void reload())
      : Promise.resolve(() => {});
    void unlisten
      .then(() => {
        if (active) void reload();
      })
      .catch((error) => {
        if (active) {
          setError(errorMessage(error));
          setReady(true);
        }
      });
    const focused = () => void reload();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const appearanceChanged = () => {
      const appearance = appliedAppearance.current;
      if (appearance === "system") applyAppearance("system");
      else if (
        native &&
        !synchronizing.current &&
        !saving.current &&
        media.matches !== (appearance === "dark")
      ) {
        // Linux portal notifications can change GTK's preference despite a manual mode.
        void syncWindow(appearance).catch((error) => {
          if (mounted.current) setError(errorMessage(error));
        });
      }
    };
    media.addEventListener("change", appearanceChanged);
    window.addEventListener("focus", focused);
    return () => {
      active = false;
      mounted.current = false;
      ++revision.current;
      window.removeEventListener("focus", focused);
      media.removeEventListener("change", appearanceChanged);
      void unlisten.then((stop) => stop()).catch(() => {});
    };
  }, [reload, syncWindow]);
  const select = async (
    active: string | null,
    appearance = preferences.appearance,
  ) => {
    if (saving.current) return;
    saving.current = true;
    ++revision.current;
    try {
      const next: ThemePreferences = {
        version: 1,
        active,
        appearance,
      };
      const bundle = active
        ? await api<ThemeBundle>("load_theme", { id: active })
        : null;
      const prepared = await prepareTheme(bundle, next);
      try {
        if (native) {
          await api("save_theme_preferences", { data: next });
          await syncWindow(prepared.appearance);
        }
        if (!mounted.current) {
          prepared.dispose();
          return;
        }
        prepared.commit();
        appliedAppearance.current = prepared.appearance;
        setFixedAppearance(prepared.manifest.appearance ?? null);
        setPreferences(next);
        setError("");
      } catch (error) {
        prepared.dispose();
        throw error;
      }
    } finally {
      saving.current = false;
    }
  };
  return (
    <Context.Provider
      value={{
        preferences,
        ready,
        error,
        safeMode,
        fixedAppearance,
        reload,
        select,
      }}
    >
      {ready ? children : null}
    </Context.Provider>
  );
}

export function useThemes() {
  const value = useContext(Context);
  if (!value) throw new Error("ThemeProvider is missing.");
  return value;
}
