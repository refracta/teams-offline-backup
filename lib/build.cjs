const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { repo, inside } = require("./storage.cjs");

function python(script, root, synthetic = false) {
  const venv = path.join(
    repo,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  const executable =
    process.env.TEAMS_PYTHON ||
    (fs.existsSync(venv)
      ? venv
      : process.platform === "win32"
        ? "python"
        : "python3");
  const result = spawnSync(executable, [path.join(repo, "scripts", script)], {
    stdio: "inherit",
    env: {
      ...process.env,
      TEAMS_ARCHIVE: root,
      TEAMS_SYNTHETIC: synthetic ? "1" : "0",
    },
  });
  if (result.error || result.status !== 0)
    throw new Error(
      "Python step failed: " +
        script +
        ". Install requirements.txt in .venv or set TEAMS_PYTHON.",
    );
}
function build(root, synthetic = false) {
  python("build-sheets.py", root, synthetic);
  python("build-teams-ui.py", root, synthetic);
  const vendor = inside(root, "app/vendor");
  fs.mkdirSync(vendor, { recursive: true });
  const katex = path.dirname(require.resolve("katex/package.json"));
  const destination = inside(root, "app/vendor/katex");
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.join(destination, "contrib"), { recursive: true });
  for (const file of [
    "katex.min.js",
    "katex.min.css",
    "contrib/auto-render.min.js",
    "contrib/mhchem.min.js",
  ]) {
    fs.copyFileSync(
      path.join(katex, "dist", file),
      path.join(destination, file),
    );
  }
  fs.cpSync(path.join(katex, "dist/fonts"), path.join(destination, "fonts"), {
    recursive: true,
  });
  fs.copyFileSync(
    path.join(katex, "LICENSE"),
    path.join(destination, "LICENSE"),
  );
  fs.cpSync(path.join(repo, "assets/emoji"), path.join(vendor, "noto-emoji"), {
    recursive: true,
  });
}
module.exports = { python, build };
