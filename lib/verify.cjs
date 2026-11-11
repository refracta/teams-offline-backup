const fs = require("node:fs");
const path = require("node:path");
const { read, save, inside, hashFile } = require("./storage.cjs");
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
async function verify(root) {
  const assets = read(path.join(root, "all-assets.json"), []);
  const states = [];
  for (const dir of ["file-states", "external-states"]) {
    const folder = path.join(root, "raw", dir);
    if (fs.existsSync(folder))
      for (const f of fs.readdirSync(folder))
        if (f.endsWith(".json")) states.push(read(path.join(folder, f)));
  }
  const byKey = new Map(states.map((s) => [s.key, s]));
  const uncollected = assets
    .filter((a) => !byKey.has(a.key))
    .map((a) => ({
      key: a.key,
      name: a.name,
      sourceUrl: a.url,
      status: "pending",
    }));
  const unresolved = [...byKey.values(), ...uncollected].filter(
    (s) => !["complete", "linked-existing"].includes(s.status),
  );
  const failures = [],
    checksums = new Map();
  let verified = 0;
  for (const s of [
    ...byKey.values(),
    ...read(path.join(root, "avatar-manifest.json"), []),
  ]) {
    if (!["complete", "linked-existing"].includes(s.status)) continue;
    try {
      const file = inside(root, s.localPath);
      if (!fs.existsSync(file)) throw new Error("missing");
      if (fs.statSync(file).size !== s.bytes) throw new Error("size mismatch");
      const hash = checksums.get(s.localPath) || (await hashFile(file));
      if (!s.sha256 || hash !== s.sha256) throw new Error("SHA-256 mismatch");
      checksums.set(s.localPath, hash);
      verified++;
    } catch (error) {
      failures.push({
        path: s.localPath || "",
        key: s.key || s.id,
        reason: error.message,
      });
    }
  }
  const conversations = read(path.join(root, "conversations.json"), []);
  for (const c of conversations)
    for (const rel of [
      "conversations/" + c.key + ".json",
      "app/chats/" + c.key + ".js",
    ])
      if (!fs.existsSync(inside(root, rel)))
        failures.push({ path: rel, reason: "missing conversation artifact" });
  const messageSummary = read(
    path.join(root, "message-export-summary.json"),
    {},
  );
  const libraries = read(path.join(root, "library-inventory.json"), []);
  const settings = read(path.join(root, "archive-settings.json"), {});
  const report = {
    snapshotTime: settings.snapshotTime,
    synthetic: settings.synthetic === true,
    verifiedReferences: verified,
    uniqueFiles: checksums.size,
    bytes: [...checksums.keys()].reduce(
      (n, p) => n + fs.statSync(inside(root, p)).size,
      0,
    ),
    integrityPassed: failures.length === 0,
    failures,
    unresolvedFiles: unresolved.length,
    refreshFailures: [...byKey.values()].filter(
      (s) => s.lastAttempt && s.lastAttempt.status !== "complete",
    ).length,
    importedFiles: [...byKey.values()].filter(
      (s) => s.contentRole === "user-import",
    ).length,
    inventoryComplete: messageSummary.inventoryComplete === true,
    incompleteConversations: conversations.filter(
      (c) => c.status !== "complete",
    ).length,
    cacheOnlyMessages: conversations.reduce(
      (n, c) => n + (c.cacheOnlyCount || 0),
      0,
    ),
    incompleteLibraries: libraries.filter((s) => s.status !== "complete")
      .length,
    sheetFailures: read(path.join(root, "sheet-summary.json"), []).filter(
      (s) => s.status !== "complete",
    ).length,
    scope: settings.scope || {},
  };
  report.needsReview =
    !report.integrityPassed ||
    !report.inventoryComplete ||
    report.unresolvedFiles > 0 ||
    report.incompleteConversations > 0 ||
    report.incompleteLibraries > 0 ||
    report.sheetFailures > 0 ||
    report.refreshFailures > 0 ||
    report.cacheOnlyMessages > 0;
  save(path.join(root, "verification.json"), report);
  fs.writeFileSync(
    path.join(root, "SHA256SUMS.txt"),
    [...checksums]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([p, h]) => h + "  " + p)
      .join("\n") + "\n",
  );
  const csvCell = (value) => {
    let text = String(value ?? "");
    if (/^[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  fs.writeFileSync(
    path.join(root, "unavailable-files.csv"),
    "\ufeff" +
      [
        ["key", "name", "status", "httpStatus", "reason", "sourceUrl"],
        ...unresolved.map((s) => [
          s.key,
          s.name,
          s.status,
          s.httpStatus,
          s.error || s.reason,
          s.sourceUrl,
        ]),
      ]
        .map((row) => row.map(csvCell).join(","))
        .join("\n") +
      "\n",
  );
  save(path.join(root, "file-manifest.json"), [...byKey.values()]);
  save(
    path.join(root, "external-manifest.json"),
    [...byKey.values()].filter(
      (s) =>
        !["library", "sharepoint", "media", "media-object"].includes(s.kind),
    ),
  );
  fs.writeFileSync(
    path.join(root, "verification.html"),
    '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'"><title>백업 검증</title><style>body{font:16px/1.7 system-ui;max-width:960px;margin:48px auto;padding:0 24px;color:#242424}pre{white-space:pre-wrap;background:#f5f5fb;padding:24px}a{color:#5b5fc7}</style><h1>백업 검증' +
      (report.synthetic ? " · 가상 데이터" : "") +
      "</h1><p>파일 무결성: " +
      (report.integrityPassed ? "통과" : "확인 필요") +
      " · 미확보 파일/주소 " +
      report.unresolvedFiles +
      "개</p><p>무결성 통과는 저장된 파일의 해시 일치를 뜻합니다. 서버 전체 데이터의 수집 완료를 보장하지 않습니다. 아래 인벤토리·대화·라이브러리·수집 범위를 함께 확인하세요.</p><pre>" +
      esc(JSON.stringify(report, null, 2)) +
      '</pre><p><a href="index.html#view=status">뷰어로 돌아가기</a> · <a href="unavailable-files.csv">미확보 원본 목록</a></p></html>',
  );
  console.log(JSON.stringify({ stage: "verification", ...report }));
  return report;
}
module.exports = { verify };
