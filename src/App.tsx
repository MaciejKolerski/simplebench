import { PluginsProvider } from "./plugins/PluginsProvider";
import { lazy, Suspense } from "react";
import { KeybindingsProvider } from "./KeybindingsProvider";
import { ThemeProvider } from "./ThemeProvider";
import { EditorPreferencesProvider } from "./EditorPreferencesProvider";
import ReadyWindow from "./ReadyWindow";
import { useWindowFullscreen } from "./useWindowFullscreen";

import { TerminalPreferencesProvider } from "./TerminalPreferencesProvider";

const Workbench = lazy(() => import("./Workbench"));
const SettingsWindow = lazy(() => import("./SettingsWindow"));

export default function App() {
  useWindowFullscreen();
  const settings =
    new URLSearchParams(window.location.search).get("window") === "settings";
  return (
    <ThemeProvider>
      <PluginsProvider>
        <KeybindingsProvider>
          <EditorPreferencesProvider>
            <TerminalPreferencesProvider>
              <Suspense
                fallback={
                  <main className="empty-message">
                    {settings ? "Opening settings…" : "Opening workspace…"}
                  </main>
                }
              >
                {settings ? (
                  <SettingsWindow />
                ) : (
                  <>
                    <Workbench />
                    <ReadyWindow />
                  </>
                )}
              </Suspense>
            </TerminalPreferencesProvider>
          </EditorPreferencesProvider>
        </KeybindingsProvider>
      </PluginsProvider>
    </ThemeProvider>
  );
}
