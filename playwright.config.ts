import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: ".runtime/e2e-results.json" }]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 1050 },
    trace: "off",
    screenshot: "only-on-failure",
  },
});
