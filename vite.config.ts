import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { include: ["react-slot-fill", "dockview", "@ai-sdk/react"] },
  // Keep Rust diagnostics visible when Vite reloads the frontend.
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    // Tauri's devUrl must point to this exact port.
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
