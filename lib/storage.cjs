const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const repo = fs.realpathSync(path.join(__dirname, ".."));
const read = (file, fallback) =>
  fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
function save(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file + ".tmp", JSON.stringify(data, null, 2) + "\n", {
    mode: 0o600,
  });
  fs.renameSync(file + ".tmp", file);
}
function realDestination(value) {
  const target = path.resolve(value.replace(/^~(?=[/\\]|$)/, os.homedir()));
  if (fs.existsSync(target)) return fs.realpathSync(target);
  const parent = path.dirname(target);
  return parent === target
    ? target
    : path.join(realDestination(parent), path.basename(target));
}
function within(parent, target) {
  const rel = path.relative(parent, target);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel))
  );
}
function privatePath(value, label = "Output") {
  const target = realDestination(value);
  if (within(repo, target))
    throw new Error(label + " must be outside the source repository.");
  // Avoid accidentally adding a backup to another source checkout, too.
  for (let p = target; ; p = path.dirname(p)) {
    if (fs.existsSync(path.join(p, ".git")))
      throw new Error(label + " must be outside any Git working tree.");
    if (p === path.dirname(p)) break;
  }
  return target;
}
function inside(root, relative) {
  if (
    !relative ||
    path.isAbsolute(relative) ||
    /^[a-z]:|^[/\\]|[\x00-\x1f]/i.test(relative)
  )
    throw new Error("Invalid archive path");
  const target = realDestination(path.join(root, relative));
  if (!within(realDestination(root), target))
    throw new Error("Archive path escapes its root");
  return target;
}
const key = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24);
function safe(value) {
  let s = String(value || "file")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[. ]+$/, "");
  const ext = path.extname(s).length < 20 ? path.extname(s) : "";
  let stem = ext ? s.slice(0, -ext.length) : s;
  while (Buffer.byteLength(stem + ext) > 150) stem = stem.slice(0, -1);
  s = (stem + ext).replace(/[. ]+$/, "") || "file";
  return /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(s) ? "_" + s : s;
}
function scrub(value) {
  return JSON.parse(
    JSON.stringify(value, (k, v) =>
      /^(authorization|authentication|cookie|set-cookie|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|password|x-ms-skypetoken)$|downloadUrl/i.test(
        k,
      )
        ? undefined
        : v,
    ),
  );
}
async function hashFile(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
module.exports = {
  repo,
  read,
  save,
  realDestination,
  within,
  privatePath,
  inside,
  key,
  safe,
  scrub,
  hashFile,
  sleep,
};
