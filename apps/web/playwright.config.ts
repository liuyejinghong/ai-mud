import { defineConfig, devices } from "@playwright/test";

const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL;
const webPort = Number(process.env.PLAYWRIGHT_WEB_PORT ?? 5180);
const baseURL = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL,
    trace: "on-first-retry"
  },
  webServer: {
    command: `pnpm exec vite --host 127.0.0.1 --port ${webPort} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium-mock",
      testMatch: /(?:auth-smoke|playable-loop)\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        ...(browserChannel ? { channel: browserChannel } : {})
      }
    },
    {
      name: "real-postgres",
      testMatch: /real-player-loop\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        ...(browserChannel ? { channel: browserChannel } : {})
      }
    },
    {
      name: "tutorial-postgres",
      testMatch: /tutorial-real\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        ...(browserChannel ? { channel: browserChannel } : {})
      }
    }
  ]
});
