import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  use: {
    ...base.use,
    baseURL: "http://127.0.0.1:1421",
    browserName: "webkit",
    launchOptions: {},
  },
  webServer: {
    ...base.webServer,
    command: "pnpm dev --port 1421",
    url: "http://127.0.0.1:1421",
  },
});
