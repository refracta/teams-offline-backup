const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { repo, key } = require("../lib/storage.cjs");
const { mainId, dmId, people } = require("../scripts/make-demo.cjs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1500, height: 1000 },
      timezoneId: "America/Los_Angeles",
      offline: true,
    });
    const page = await context.newPage(),
      errors = [],
      requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (req) => {
      if (/^https?:/.test(req.url())) requests.push(req.url());
    });
    const base = pathToFileURL(path.join(repo, "demo/index.html")).href;
    async function chat(id, message) {
      await page.goto(
        base + "#chat=" + key(id) + (message ? "&message=" + message : ""),
      );
      await page.locator(".message").first().waitFor();
    }
    await chat(mainId, "1900000000255");
    await page.locator(".katex").first().waitFor();
    assert.equal(await page.locator(".katex-error").count(), 0);
    assert.equal(
      await page.evaluate(() =>
        window.TeamsArchive.kst("2030-04-18T03:24:56.1234567Z"),
      ),
      "오후 12:24",
    );
    assert.equal(await page.locator("#chat-list .chat-row").count(), 30);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight + 1,
      ),
      true,
    );
    await page.locator('[data-action="more-chats"]').click();
    assert.equal(await page.locator("#chat-list .chat-row").count(), 36);
    await page.locator("#chat-filter").fill("가상 프로젝트 34");
    assert.equal(await page.locator("#chat-list .chat-row").count(), 1);
    await page.locator("#chat-filter").fill("");
    assert.equal(await page.locator("#chat-list .chat-row").count(), 30);
    await page.locator('[data-mention="' + people[1].id + '"]').click();
    await page.waitForFunction((k) => location.hash.includes(k), key(dmId));
    await page
      .locator("#conversation-head h2")
      .filter({ hasText: "Blair Demo" })
      .waitFor();
    await chat(mainId, "1900000000256");
    await page.locator(".reply-quote").click();
    await page.waitForFunction(() =>
      location.hash.includes("message=1900000000254"),
    );
    await page.locator("#m1900000000254.highlight").waitFor();
    await page.locator("#global-search").fill("다음 단계");
    await page.locator("#global-search").press("Enter");
    await page.locator(".search-result").first().waitFor();
    assert.ok((await page.locator(".search-result").count()) >= 1);
    await chat(mainId);
    await page.locator("#auto-scroll-speed").selectOption("600");
    const before = await page.locator("#content").evaluate((e) => e.scrollTop);
    await page.locator('[data-action="auto-up"]').click();
    await page.waitForTimeout(650);
    assert.ok(
      (await page.locator("#content").evaluate((e) => e.scrollTop)) <
        before - 150,
    );
    await page.locator("#content").dispatchEvent("wheel");
    assert.equal(
      await page
        .locator('[data-action="auto-up"]')
        .getAttribute("aria-pressed"),
      "false",
    );
    await page.locator('[data-tab="synthetic-lab-sheet"]').click();
    await page.locator(".sheet-grid").waitFor();
    assert.match(
      await page.locator(".sheet-grid").innerText(),
      /가상 랩실 시트/,
    );
    await page.locator('[data-worksheet="1"]').click();
    await page.locator('[data-cell="2,4"]').click();
    assert.equal(
      await page.locator(".formula-value").textContent(),
      "=AVERAGE(B2:C2)",
    );
    await page.goto(base + "#view=status");
    await page.locator(".metrics").waitFor();
    assert.match(await page.locator("#content").innerText(), /다운로드 실패/);
    await chat(mainId, "1900000000250");
    assert.match(
      await page.locator("#m1900000000250").innerText(),
      /Alex Demo 님이 Casey Demo 님을 추가했습니다/,
    );
    assert.equal(
      await page.evaluate(
        () =>
          [...document.images].filter((i) => i.complete && !i.naturalWidth)
            .length,
      ),
      0,
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    console.log(
      "PASS: offline file://, KST under US timezone, mentions, quotes, search, sidebar, auto scroll, sheets/formulas, system events, local images; no HTTP requests.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
