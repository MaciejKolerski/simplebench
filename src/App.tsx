import { lazy, Suspense, useState } from "react";
import { WindowControls } from "./ui";

const Workbench = lazy(() => import("./Workbench"));

export default function App() {
  return new URLSearchParams(window.location.search).get("window") ===
    "settings" ? (
    <SettingsWindow />
  ) : (
    <Suspense
      fallback={<main className="empty-message">Opening workspace…</main>}
    >
      <Workbench />
    </Suspense>
  );
}

function SettingsWindow() {
  const [error, setError] = useState("");
  return (
    <div className="app-shell settings-window">
      <header className="titlebar" data-tauri-drag-region>
        <span className="settings-title" data-tauri-drag-region>
          Settings
        </span>
        <div className="titlebar-space" data-tauri-drag-region />
        <WindowControls onError={setError} />
      </header>
      <main className="settings-content">
        <div className="settings-box">settings</div>
      </main>
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
