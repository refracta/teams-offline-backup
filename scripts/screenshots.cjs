const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { repo, key, read } = require("../lib/storage.cjs");
const { mainId } = require("./make-demo.cjs");
(async () => {
  const root = path.join(repo, "demo");
  if (read(path.join(root, "archive-settings.json"))?.synthetic !== true)
    throw new Error("Only the synthetic demo can be photographed.");
  const dir = path.join(repo, "docs/screenshots");
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1560, height: 1040 },
      deviceScaleFactor: 1,
      timezoneId: "Asia/Seoul",
      offline: true,
    });
    const page = await context.newPage();
    const base = pathToFileURL(path.join(root, "index.html")).href;
    await page.goto(base + "#chat=" + key(mainId) + "&message=1900000000254");
    await page.locator(".katex").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page
      .locator("#m1900000000252")
      .evaluate((e) => e.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(dir, "chat.png") });
    await page.locator('[data-tab="synthetic-lab-sheet"]').click();
    await page.locator(".sheet-grid").waitFor();
    await page.screenshot({ path: path.join(dir, "sheet.png") });
    await page.goto(base + "#view=files");
    await page.locator(".file-card").first().waitFor();
    await page.screenshot({ path: path.join(dir, "files.png") });
    console.log("Saved three screenshots of the synthetic demo only.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
