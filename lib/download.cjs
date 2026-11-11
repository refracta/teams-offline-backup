const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { inside, sleep } = require("./storage.cjs");

async function fetchRedirects(url, headers = {}, fetcher = fetch) {
  let target = new URL(url);
  let auth = { ...headers };
  for (let i = 0; i < 10; i++) {
    if (
      !["http:", "https:"].includes(target.protocol) ||
      target.username ||
      target.password
    )
      throw new Error("Unsupported download URL");
    if (Object.keys(auth).length && target.protocol !== "https:")
      throw new Error("Refusing authentication over HTTP");
    const response = await fetcher(target.href, {
      headers: auth,
      redirect: "manual",
      signal: AbortSignal.timeout(1800000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new Error("Redirect has no location");
    const next = new URL(location, target);
    // Once dropped, credentials stay dropped even if a later hop returns.
    if (next.origin !== target.origin) auth = {};
    target = next;
  }
  throw new Error("Too many redirects");
}

async function download(
  root,
  relative,
  url,
  headers = {},
  expectedSize,
  options = {},
) {
  const dest = inside(root, relative);
  for (let attempt = 0; attempt < 4; attempt++) {
    let response;
    try {
      response = await fetchRedirects(url, headers, options.fetcher);
    } catch {
      if (attempt === 3) throw new Error("Download network failure");
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      const delay = Number(response.headers.get("retry-after") || 0) * 1000;
      await response.body?.cancel();
      await sleep(Math.min(60000, Math.max(delay, 1000 * 2 ** attempt)));
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw Object.assign(new Error("Download HTTP " + response.status), {
        httpStatus: response.status,
      });
    }
    const contentType =
      response.headers.get("content-type") || "application/octet-stream";
    if (/text\/html|application\/xhtml/i.test(contentType)) {
      await response.body?.cancel();
      throw Object.assign(
        new Error(
          "HTML page returned instead of original file; export it in the browser and import-file.",
        ),
        { browserRequired: true },
      );
    }
    const disk = fs.statfsSync(root);
    const length = Number(response.headers.get("content-length") || 0);
    if (
      disk.bavail * disk.bsize <
      Math.max(length, expectedSize || 0) +
        (options.reserveBytes ?? 5 * 1024 ** 3)
    ) {
      await response.body?.cancel();
      throw new Error("Insufficient free disk space (5 GiB reserve)");
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
    const hash = crypto.createHash("sha256");
    let bytes = 0;
    let first = Buffer.alloc(0);
    try {
      await pipeline(
        Readable.fromWeb(response.body),
        new Transform({
          transform(chunk, enc, cb) {
            bytes += chunk.length;
            hash.update(chunk);
            if (first.length < 1024)
              first = Buffer.concat([first, chunk]).subarray(0, 1024);
            cb(null, chunk);
          },
        }),
        fs.createWriteStream(dest + ".part", { mode: 0o600 }),
      );
      if (/^\s*(?:<!doctype\s+html|<html)/i.test(first.toString()))
        throw Object.assign(
          new Error("HTML login page returned instead of a file"),
          { browserRequired: true },
        );
      if (expectedSize != null && bytes !== Number(expectedSize))
        throw new Error("Downloaded size does not match metadata");
      if (
        expectedSize == null &&
        length &&
        !response.headers.get("content-encoding") &&
        bytes !== length
      )
        throw new Error("Truncated download");
      if (bytes === 0 && expectedSize !== 0) throw new Error("Empty download");
      fs.renameSync(dest + ".part", dest);
      return {
        localPath: relative,
        bytes,
        sha256: hash.digest("hex"),
        contentType,
      };
    } catch (error) {
      fs.rmSync(dest + ".part", { force: true });
      if (error.browserRequired || attempt === 3) throw error;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw new Error("Download retry limit reached");
}
module.exports = { fetchRedirects, download };
