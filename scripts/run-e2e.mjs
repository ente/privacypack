import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const arguments_ = process.argv.slice(2);
const devIndex = arguments_.indexOf("--dev");
const development = devIndex !== -1;
if (development) arguments_.splice(devIndex, 1);

const runner = spawn(
    process.execPath,
    [require.resolve("@playwright/test/cli"), "test", ...arguments_],
    {
        stdio: "inherit",
        env: {
            ...process.env,
            PLAYWRIGHT_TEST_EXPORT: development ? "0" : "1",
        },
    },
);

// Playwright only tears down its web server on SIGINT. Forward SIGTERM as
// SIGINT too, or the test server outlives the run and holds its port.
let received;
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
        received ??= signal;
        runner.kill("SIGINT");
    });
}
runner.on("error", (error) => {
    console.error(`Could not start Playwright: ${error.message}`);
    process.exitCode = 1;
});
runner.on("exit", (code) => {
    process.exitCode =
        received === "SIGTERM"
            ? 143
            : received === "SIGINT"
              ? 130
              : (code ?? 1);
});
