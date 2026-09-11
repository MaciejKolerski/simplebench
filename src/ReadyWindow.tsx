import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, native } from "./api";

export default function ReadyWindow() {
  useEffect(() => {
    if (!native) return;
    let active = true;
    let prepared = false;
    let focused = false;
    let finished = false;
    let frame = 0;
    const finish = () => {
      if (!active || !prepared || finished) return;
      cancelAnimationFrame(frame);
      // Hidden WebKit views can suspend frames. Keep the startup background
      // until the requested window is visible and has painted its contents.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          finished = true;
          void api("finish_window_startup").catch(console.error);
        });
      });
    };
    const unlisten = getCurrentWindow().listen("tauri://focus", () => {
      focused = true;
      finish();
    });
    void unlisten.catch(console.error);
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
      void api<boolean>("show_ready_window", { background })
        .then((shown) => {
          prepared = true;
          if (shown || focused) finish();
        })
        .catch(console.error);
    }, 0);
    return () => {
      active = false;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      void unlisten.then((stop) => stop()).catch(() => {});
    };
  }, []);
  return null;
}
