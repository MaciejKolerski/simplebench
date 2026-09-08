import { lazy, Suspense, useEffect } from "react";
import { KeybindingsProvider } from "./KeybindingsProvider";
import { ThemeProvider } from "./ThemeProvider";
import { EditorPreferencesProvider } from "./EditorPreferencesProvider";
import { api, native } from "./api";

import { TerminalPreferencesProvider } from "./TerminalPreferencesProvider";

const Workbench = lazy(() => import("./Workbench"));
const SettingsWindow = lazy(() => import("./SettingsWindow"));

export default function App() {
  const settings =
    new URLSearchParams(window.location.search).get("window") === "settings";
  return (
    <ThemeProvider>
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
              {settings ? <SettingsWindow /> : <Workbench />}
              <ReadyWindow />
            </Suspense>
          </TerminalPreferencesProvider>
        </EditorPreferencesProvider>
      </KeybindingsProvider>
    </ThemeProvider>
  );
}

function ReadyWindow() {
  useEffect(() => {
    if (!native) return;
    // A hidden webview can commit React before it paints. Cover its first
    // native frame with the resolved theme color, then restore transparency.
    const timer = setTimeout(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      context.fillStyle = getComputedStyle(
        document.querySelector(".app-shell")!,
      ).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      const background = Array.from(
        context.getImageData(0, 0, 1, 1).data.slice(0, 3),
      );
      void api("show_ready_window", { background })
        .then(
          () =>
            new Promise<void>((resolve) => {
              // Start frames after showing: hidden WebKit views can suspend them.
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              );
            }),
        )
        .then(() => api("finish_window_startup"))
        .catch(console.error);
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  return null;
}
