// This checks the public source/demo tree, never a real Teams account.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const { repo, read, within } = require("../lib/storage.cjs");
const allowedRoots = new Set([
  "bin",
  "lib",
  "viewer",
  "scripts",
  "tests",
  "docs",
  "assets",
  "demo",
  ".github",
]);
const allowedFiles = new Set([
  "README.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "package.json",
  "package-lock.json",
  "requirements.txt",
  ".gitignore",
  ".gitattributes",
]);
const ignored = new Set([".git", "node_modules", ".venv", "__pycache__"]);
const issues = [];
const textFiles = [];
let checked = 0;
let deny = [];
if (process.env.TEAMS_PRIVATE_DENYLIST) {
  const file = fs.realpathSync(process.env.TEAMS_PRIVATE_DENYLIST);
  if (within(repo, file))
    throw new Error("Private denylist must be outside the repository");
  deny = read(file);
  if (
    !Array.isArray(deny) ||
    deny.some((x) => typeof x !== "string" || x.length < 3)
  )
    throw new Error(
      "Denylist must be a JSON array of strings with at least three characters",
    );
}
function inspect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const file = path.join(dir, entry.name),
      rel = path.relative(repo, file).split(path.sep).join("/");
    if (entry.isSymbolicLink()) {
      issues.push({ file: rel, reason: "Symlinks are not public assets" });
      continue;
    }
    if (entry.isDirectory()) {
      inspect(file);
      continue;
    }
    checked++;
    const first = rel.split("/")[0];
    if (!allowedRoots.has(first) && !allowedFiles.has(rel))
      issues.push({ file: rel, reason: "Not in the public allowlist" });
    if (
      /(?:^|\/)(?:Login Data|Cookies|Local State|storage-state[^/]*\.json|[^/]*\.har|\.env(?:\..*)?)$/i.test(
        rel,
      )
    )
      issues.push({ file: rel, reason: "Browser/session/secret artifact" });
    const bytes = fs.readFileSync(file),
      ext = path.extname(rel).toLowerCase();
    if ([".ttf", ".woff", ".woff2", ".png", ".xlsx"].includes(ext)) {
      const valid =
        ext === ".png"
          ? /^docs\/screenshots\/(chat|sheet|files)\.png$/.test(rel)
          : ext === ".xlsx"
            ? rel === "demo/files/demo/demo-lab.xlsx"
            : /^demo\/app\/vendor\/katex\/fonts\//.test(rel) ||
              [
                "assets/emoji/NotoColorEmoji.ttf",
                "demo/app/vendor/noto-emoji/NotoColorEmoji.ttf",
              ].includes(rel);
      if (!valid)
        issues.push({ file: rel, reason: "Unrecognized binary provenance" });
      continue;
    }
    if (bytes.includes(0)) {
      issues.push({ file: rel, reason: "Unexpected binary file" });
      continue;
    }
    const text = bytes.toString("utf8");
    textFiles.push(rel);
    const guid =
      text.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ) || [];
    if (
      guid.some((id) => !/^00000000-0000-4000-8000-00000000000[123]$/.test(id))
    )
      issues.push({ file: rel, reason: "Non-demo UUID" });
    if (
      /(?:\/home\/[A-Za-z0-9_.-]+\/|\/Users\/[A-Za-z0-9_.-]+\/|[A-Za-z]:\\Users\\[A-Za-z0-9_.-]+\\)/.test(
        text,
      )
    )
      issues.push({ file: rel, reason: "Machine-specific user home path" });
    if (
      /\beyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\b|\b(?:ghp|github_pat)_[A-Za-z0-9_]{30,}\b/.test(
        text,
      )
    )
      issues.push({ file: rel, reason: "Credential-like string" });
    const matched = deny.reduce(
      (n, value) => n + (text.includes(value) ? 1 : 0),
      0,
    );
    if (matched)
      issues.push({
        file: rel,
        reason: "Private denylist match",
        matches: matched,
      });
  }
}
inspect(repo);
const demo = path.join(repo, "demo");
if (read(path.join(demo, "archive-settings.json"))?.synthetic !== true)
  issues.push({
    file: "demo/archive-settings.json",
    reason: "Not marked synthetic",
  });
const sandbox = { window: {} };
vm.runInNewContext(
  fs.readFileSync(path.join(demo, "app/data.js"), "utf8"),
  sandbox,
  { timeout: 2000 },
);
const data = sandbox.window.TEAMS_BACKUP;
const names = ["Alex Demo", "Blair Demo", "Casey Demo"];
if (
  data.synthetic !== true ||
  Object.keys(data.profiles).length !== 3 ||
  Object.values(data.profiles).some((p) => !names.includes(p.name))
)
  issues.push({ file: "demo/app/data.js", reason: "Unexpected demo profile" });
if (data.conversations.some((c) => !/^19:synthetic-/.test(c.id)))
  issues.push({
    file: "demo/app/data.js",
    reason: "Unexpected conversation identifier",
  });
for (const f of Object.values(data.files))
  if (
    f.sourceUrl &&
    !/^https:\/\/(demo\.example\.invalid|teams\.microsoft\.com)\//.test(
      f.sourceUrl,
    )
  )
    issues.push({
      file: "demo/app/data.js",
      reason: "Unexpected demo file origin",
    });
const source = read(path.join(repo, "assets/emoji/SOURCE.json"));
for (const rel of [
  "assets/emoji/NotoColorEmoji.ttf",
  "demo/app/vendor/noto-emoji/NotoColorEmoji.ttf",
]) {
  const hash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(repo, rel)))
    .digest("hex");
  if (hash !== source.sha256)
    issues.push({
      file: rel,
      reason: "Font differs from recorded upstream artifact",
    });
}
// ZIP member text and document properties need a check too, not just the .xlsx filename.
const python =
  process.env.TEAMS_PYTHON ||
  path.join(
    repo,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
const zipCheck = spawnSync(
  fs.existsSync(python)
    ? python
    : process.platform === "win32"
      ? "python"
      : "python3",
  [
    "-c",
    'import sys,zipfile,json,os\np=sys.argv[1]\nterms=json.loads(open(os.environ["TEAMS_PRIVATE_DENYLIST"]).read()) if os.environ.get("TEAMS_PRIVATE_DENYLIST") else []\nwith zipfile.ZipFile(p) as z:\n text="\\n".join(z.read(n).decode("utf-8") for n in z.namelist() if n.endswith(".xml"))\n assert "Teams Offline Backup synthetic demo" in text\n assert "Synthetic demo generator" in text\n assert not any(t in text for t in terms), "private denylist match inside workbook"\n',
    path.join(demo, "files/demo/demo-lab.xlsx"),
  ],
  { encoding: "utf8" },
);
if (zipCheck.error || zipCheck.status !== 0)
  issues.push({
    file: "demo/files/demo/demo-lab.xlsx",
    reason: "Workbook provenance/privacy check failed",
  });
if (issues.length) {
  console.error(JSON.stringify({ checked, issues }, null, 2));
  process.exitCode = 1;
} else
  console.log(
    JSON.stringify({
      checked,
      textFiles: textFiles.length,
      privatePatterns: deny.length,
      result:
        "PASS: public allowlist, synthetic fixtures, credential patterns, workbook metadata and font provenance",
    }),
  );
