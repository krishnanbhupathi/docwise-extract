import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a production build with the fake model and local
 * storage: no API key, no cloud, no cost. They use their own database
 * (E2E_DATABASE_URL), which global setup migrates, empties and seeds with the
 * samples, and their own port and build folder, so `next dev` can keep running.
 */
const PORT = 3100;
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL || "postgres://localhost/docwise_e2e";

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  // One server and one database: tests run in order.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next build && npx next start --port ${PORT}`,
    // A static file: the server starts before global setup has migrated the database.
    url: `http://localhost:${PORT}/icon.svg`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: { NEXT_DIST_DIR: ".next-e2e", DATABASE_URL: E2E_DATABASE_URL, DOCWISE_FAKE_MODEL: "1", STORAGE_DRIVER: "local" },
  },
});
