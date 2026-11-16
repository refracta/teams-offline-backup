const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

test("authenticated search service, source context, range downloads, and isolation", () => {
  const result = spawnSync(
    process.env.TEAMS_PYTHON ||
      (process.platform === "win32" ? "python" : "python3"),
    [path.join(__dirname, "search_server.py")],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
