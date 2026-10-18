// @ts-check
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173",
    headless: true,
    viewport: { width: 1300, height: 900 },
    colorScheme: "dark",  // the app follows the device theme; tests default to dark and opt into light where needed
  },
  // Everything runs in the installed Chrome (no browser download needed), except tests tagged @webkit: Safari-only bugs,
  // in Playwright's WebKit (npx playwright install webkit).
  projects: [
    { name: "chrome", use: { channel: "chrome" }, grepInvert: /@webkit/ },
    { name: "webkit", use: { browserName: "webkit" }, grep: /@webkit/ },
  ],
  webServer: {
    command: "python3 -m http.server 4173",
    url: "http://localhost:4173/index.html",
    reuseExistingServer: true,
    stdout: "ignore",
    stderr: "ignore",
  },
});
