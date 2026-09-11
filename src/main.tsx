import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initializeAppearance } from "./theme-runtime";
import "./styles.css";

window.addEventListener("contextmenu", (event) => event.preventDefault(), {
  capture: true,
});

initializeAppearance();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
