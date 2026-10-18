import { defineConfig } from "@playwright/test";

const production = process.env.PLAYWRIGHT_TEST_EXPORT === "1";
// The test server inherits PORT, so tests can avoid a port that is in use.
const port = process.env.PORT ?? "3000";
const baseURL =
    process.env.PLAYWRIGHT_BASE_URL ??
    (production ? `https://127.0.0.1:${port}` : `http://localhost:${port}`);

export default defineConfig({
    testDir: "./tests",
    timeout: 60_000,
    expect: {
        timeout: 10_000,
    },
    fullyParallel: true,
    // A stray test.only must fail CI rather than skip the rest of the suite.
    forbidOnly: !!process.env.CI,
    workers: process.env.CI ? 2 : undefined,
    reporter: process.env.CI ? "github" : "list",
    use: {
        baseURL,
        ignoreHTTPSErrors: production,
        viewport: { width: 1280, height: 900 },
        trace: "retain-on-failure",
    },
    projects: [
        { name: "chromium", use: { browserName: "chromium" } },
        {
            name: "webkit",
            use: {
                browserName: "webkit",
                // Playwright's WebKit on Linux can crash its web process
                // when a menu item is clicked while the menu is still
                // animating open (seen on CI). Reduced motion turns the
                // menu animations off there. Chromium and macOS WebKit
                // still run them, and tests that rely on them opt back in.
                ...(process.platform === "linux" && {
                    reducedMotion: "reduce",
                }),
            },
        },
    ],
    webServer: process.env.PLAYWRIGHT_BASE_URL
        ? undefined
        : {
              command: production
                  ? "node scripts/serve-export.mjs"
                  : "npm run dev",
              url: baseURL,
              reuseExistingServer: false,
              ignoreHTTPSErrors: production,
              timeout: 120_000,
              gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
          },
});
