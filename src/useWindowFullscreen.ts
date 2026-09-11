import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { macOS, native } from "./api";

export function useWindowFullscreen() {
  useEffect(() => {
    if (!native || !macOS) return;
    const root = document.documentElement;
    const appWindow = getCurrentWindow();
    let active = true;
    let revision = 0;
    const update = async () => {
      const request = ++revision;
      try {
        const fullscreen = await appWindow.isFullscreen();
        if (active && request === revision)
          root.dataset.fullscreen = String(fullscreen);
      } catch (error) {
        if (active) console.error("Could not read fullscreen state:", error);
      }
    };
    // macOS emits a resize after each native fullscreen transition.
    const unlisten = appWindow.onResized(() => void update());
    void unlisten
      .then(() => {
        if (active) void update();
      })
      .catch(console.error);
    return () => {
      active = false;
      delete root.dataset.fullscreen;
      void unlisten.then((stop) => stop()).catch(() => {});
    };
  }, []);
}
