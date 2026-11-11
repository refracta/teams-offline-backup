#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { parseArgs } = require("node:util");
const {
  repo,
  privatePath,
  read,
  save,
  inside,
  key,
  safe,
  hashFile,
  sleep,
  within,
} = require("../lib/storage.cjs");
const { python, build } = require("../lib/build.cjs");
const { verify } = require("../lib/verify.cjs");

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: "string" },
      profile: { type: "string" },
      channel: { type: "string" },
      headless: { type: "boolean" },
      external: { type: "string", default: "files" },
      libraries: { type: "string", default: "teams" },
      onedrive: { type: "boolean" },
      refresh: { type: "boolean" },
      "self-id": { type: "string" },
      key: { type: "string" },
      file: { type: "string" },
      help: { type: "boolean" },
    },
  });
  const command = positionals[0];
  if (values.help || !command) {
    console.log(`Teams Offline Backup

node bin/teams-backup.cjs login [--profile PATH] [--channel chrome|msedge]
node bin/teams-backup.cjs backup --output PRIVATE_PATH [--refresh] [--headless]
    [--external none|files|all] [--libraries teams|none] [--onedrive]
node bin/teams-backup.cjs build --output PRIVATE_PATH
node bin/teams-backup.cjs verify --output PRIVATE_PATH
node bin/teams-backup.cjs import-file --output PRIVATE_PATH --key ASSET_KEY --file LOCAL_FILE
node bin/teams-backup.cjs demo

Defaults: ~/TeamsBackups/archive; browser profile outside the source checkout.
Real output/profile paths inside any Git working tree are rejected.
backup retries/resumes a previous run; --refresh traverses message history again.
Exit 2 means the archive exists but verification needs review. See docs/backup-guide.md.`);
    return;
  }
  if (command === "demo") {
    const root = path.join(repo, "demo");
    // The generator never reads an account, browser profile, or external archive.
    require("../scripts/make-demo.cjs").generate(root);
    python("prepare-archive.py", root, true);
    python("expand-backup.py", root, true);
    build(root, true);
    await verify(root);
    console.log("Open demo/index.html. All demo content is synthetic.");
    return;
  }
  if (!["login", "backup", "build", "verify", "import-file"].includes(command))
    throw new Error("Unknown command; use --help.");
  if (
    !["none", "files", "all"].includes(values.external) ||
    !["teams", "none"].includes(values.libraries)
  )
    throw new Error("Invalid external/libraries mode");
  const output = privatePath(
    values.output || path.join(os.homedir(), "TeamsBackups/archive"),
  );
  const dataHome =
    process.platform === "win32"
      ? process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData/Local")
      : process.platform === "darwin"
        ? path.join(os.homedir(), "Library/Application Support")
        : path.join(os.homedir(), ".local/share");
  const profile = privatePath(
    values.profile || path.join(dataHome, "teams-offline-backup/browser"),
    "Browser profile",
  );
  if (within(output, profile) || within(profile, output)) {
    throw new Error(
      "Archive and browser profile must be in separate directories.",
    );
  }
  const options = { ...values, output, profile, selfId: values["self-id"] };
  if (command === "login") {
    const s = await require("../lib/session.cjs").connect({
      ...options,
      output: null,
      headless: false,
    });
    await sleep(2000);
    await s.close();
    console.log("Sign-in saved in the dedicated private profile.");
    return;
  }
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  if (command === "backup") {
    const lock = path.join(output, ".backup.lock");
    let handle;
    try {
      handle = fs.openSync(lock, "wx", 0o600);
      fs.writeSync(handle, String(process.pid));
    } catch {
      throw new Error(
        "Archive is locked. Check for another backup process; remove .backup.lock only after it has stopped.",
      );
    }
    let session;
    try {
      const existing = read(path.join(output, "archive-settings.json"), {});
      save(path.join(output, "archive-settings.json"), {
        ...existing,
        snapshotTime: new Date().toISOString(),
        synthetic: false,
        scope: {
          external: values.external,
          libraries: values.libraries,
          onedrive: !!values.onedrive,
          externalFolders: "addresses-only",
        },
      });
      session = await require("../lib/session.cjs").connect(options);
      await sleep(4000);
      const capture = require("../lib/capture.cjs");
      await capture.cacheInventory(session, output);
      await capture.messages(session, output, options);
      python("prepare-archive.py", output);
      python("expand-backup.py", output);
      const collect = require("../lib/files.cjs");
      await collect.files(session, output, options);
      await collect.avatars(session, output);
    } finally {
      await session?.close();
      fs.closeSync(handle);
      fs.rmSync(lock, { force: true });
    }
    build(output);
    const result = await verify(output);
    if (result.needsReview) process.exitCode = 2;
    console.log(
      "Open the archive index.html. Read verification.html before treating the backup as complete.",
    );
    return;
  }
  if (!fs.existsSync(path.join(output, "archive-settings.json")))
    throw new Error("No archive found at --output.");
  if (command === "build") {
    build(output);
    const result = await verify(output);
    if (result.needsReview) process.exitCode = 2;
    return;
  }
  if (command === "verify") {
    const result = await verify(output);
    if (result.needsReview) process.exitCode = 2;
    return;
  }
  if (command === "import-file") {
    if (!values.key || !values.file)
      throw new Error("import-file requires --key and --file.");
    const assets = read(path.join(output, "all-assets.json"), []);
    const asset = assets.find((a) => a.key === values.key);
    if (!asset)
      throw new Error("Unknown asset key; use unavailable-files.csv.");
    const file = path.resolve(values.file),
      relative =
        "files/imports/" +
        key(asset.key).slice(0, 12) +
        "__" +
        safe(path.basename(file));
    if (!fs.statSync(file).isFile()) throw new Error("Expected a local file.");
    fs.mkdirSync(path.dirname(inside(output, relative)), { recursive: true });
    fs.copyFileSync(file, inside(output, relative));
    save(path.join(output, "raw/file-states", asset.key + ".json"), {
      key: asset.key,
      sourceUrl: asset.url,
      kind: asset.kind,
      name: path.basename(file),
      status: "complete",
      localPath: relative,
      bytes: fs.statSync(file).size,
      sha256: await hashFile(file),
      provenance: "user-import; remote version not independently verified",
      contentRole: "user-import",
    });
    build(output);
    const result = await verify(output);
    if (result.needsReview) process.exitCode = 2;
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
