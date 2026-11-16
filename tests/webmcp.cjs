const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { chromium } = require("playwright");
const { repo } = require("../lib/storage.cjs");

(async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "teams-webmcp-"));
  fs.cpSync(path.join(repo, "demo"), path.join(temporary, "archive"), {
    recursive: true,
  });
  const python =
    process.env.TEAMS_PYTHON ||
    (process.platform === "win32" ? "python" : "python3");
  const code = `import sys,importlib.util
from pathlib import Path
repo=Path(sys.argv[1]);sys.path.insert(0,str(repo/'lib'))
from archive_search import build_index
root=Path(sys.argv[2]);build_index(root)
s=importlib.util.spec_from_file_location('server',repo/'bin/serve-archive.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
server=m.Server(('127.0.0.1',0),root,m.make_auth('reader','synthetic-only-password','http://127.0.0.1'))
server.auth['origin']='http://127.0.0.1:'+str(server.server_port)
print(server.auth['origin'],flush=True)
server.serve_forever()`;
  const server = spawn(python, [
    "-u",
    "-c",
    code,
    repo,
    path.join(temporary, "archive"),
  ]);
  let browser;
  try {
    const base = await new Promise((resolve, reject) => {
      let data = "",
        errors = "";
      const timer = setTimeout(
        () => reject(new Error("Test server timeout: " + errors)),
        30000,
      );
      server.stderr.on("data", (chunk) => (errors += chunk));
      server.on("error", reject);
      server.on("exit", (code) => {
        if (code) reject(new Error(errors));
      });
      server.stdout.on("data", (chunk) => {
        data += chunk;
        if (data.includes("\n")) {
          clearTimeout(timer);
          resolve(data.trim());
        }
      });
    });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      httpCredentials: {
        username: "reader",
        password: "synthetic-only-password",
      },
    });
    await context.addInitScript(() => {
      window.registeredArchiveTools = [];
      Object.defineProperty(document, "modelContext", {
        value: {
          registerTool: async (tool, options) => {
            window.registeredArchiveTools.push(tool);
            if (!options.signal) throw new Error("Missing lifecycle signal");
          },
        },
      });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base + "/#search=Demo");
    await page.waitForFunction(() => window.TeamsArchive?.webmcpRegistered);
    assert.equal(
      await page.evaluate(() => window.registeredArchiveTools.length),
      6,
    );
    const result = await page.evaluate(() =>
      window.registeredArchiveTools
        .find((t) => t.name === "search_archive")
        .execute({ query: "Demo", limit: 3 }),
    );
    assert.equal(result.items.length, 3);
    assert.equal(result.untrustedContent, true);
    await page.locator("#result-next").waitFor();
    const status = await page.evaluate(() =>
      window.TeamsArchive.call("archive_status"),
    );
    assert.equal(status.counts.message, 297);
    assert.equal(errors.length, 0, errors.join("\n"));
    const unavailable = await page.evaluate(() =>
      Object.values(TEAMS_BACKUP.files).find((f) => !f.localPath),
    );
    assert.ok(unavailable);
    await page.goto(
      base + "/#view=files&file=" + encodeURIComponent(unavailable.key),
    );
    await page.locator("#file-count").waitFor();
    assert.equal(await page.locator("#file-count").innerText(), "1개");
    await context.close();
    const fallback = await browser.newContext({
      httpCredentials: {
        username: "reader",
        password: "synthetic-only-password",
      },
    });
    await fallback.addInitScript(() => {
      Object.defineProperty(document, "modelContext", {
        value: {
          registerTool() {
            throw new Error("WebMCP disabled");
          },
        },
      });
      Object.defineProperty(navigator, "modelContext", { value: undefined });
    });
    const ordinary = await fallback.newPage();
    await ordinary.goto(base + "/#search=Demo");
    await ordinary.locator("#result-next").waitFor();
    assert.equal(
      await ordinary.evaluate(() => window.TeamsArchive.ready),
      true,
    );
    console.log(
      "PASS: WebMCP registration/execution, authenticated browser search, and ordinary-browser fallback.",
    );
  } finally {
    await browser?.close();
    server.kill();
    await once(server, "exit").catch(() => {});
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
