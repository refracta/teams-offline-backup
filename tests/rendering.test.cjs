const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { repo, save } = require("../lib/storage.cjs");

test("HTML/card sanitization, MathML annotation and XML entity isolation", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "teams-render-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  save(path.join(root, "archive-settings.json"), {
    synthetic: true,
    snapshotTime: "2030-04-18T06:00:00Z",
  });
  for (const name of ["profiles", "conversations", "channel-tabs"])
    save(path.join(root, name + ".json"), []);
  save(path.join(root, "adaptive-cards.json"), {});
  const python =
    process.env.TEAMS_PYTHON ||
    path.join(
      repo,
      ".venv",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    );
  const result = spawnSync(python, [path.join(repo, "tests/rendering.py")], {
    encoding: "utf8",
    env: { ...process.env, TEAMS_ARCHIVE: root, TEAMS_SYNTHETIC: "0" },
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /RENDERER PASS/);
});
