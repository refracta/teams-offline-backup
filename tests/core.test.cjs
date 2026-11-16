const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {
  repo,
  privatePath,
  inside,
  scrub,
  key,
  safe,
  save,
  read,
  hashFile,
} = require("../lib/storage.cjs");
const { fetchRedirects, download } = require("../lib/download.cjs");
const { externalTarget } = require("../lib/files.cjs");
const { messages } = require("../lib/capture.cjs");
const { verify } = require("../lib/verify.cjs");

test("real archive paths cannot enter source trees, including through symlinks", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "teams-path-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => privatePath(path.join(repo, "not-a-demo")), /outside/);
  fs.mkdirSync(path.join(dir, "checkout/.git"), { recursive: true });
  assert.throws(
    () => privatePath(path.join(dir, "checkout/private")),
    /working tree/,
  );
  if (process.platform !== "win32") {
    fs.symlinkSync(repo, path.join(dir, "alias"));
    assert.throws(() => privatePath(path.join(dir, "alias/secret")), /outside/);
    fs.symlinkSync(repo, path.join(dir, "out"));
    assert.throws(() => inside(dir, "out/secret"), /escapes/);
  }
  assert.throws(() => inside(dir, "../escape"), /escapes/);
  assert.throws(() => inside(dir, "C:\\outside"), /Invalid/);
  assert.equal(inside(dir, "files/test.txt"), path.join(dir, "files/test.txt"));
});

test("transport credentials and preauthenticated download URLs are never serialized", () => {
  assert.deepEqual(
    scrub({
      content: "keep this text",
      a: {
        accessToken: "secret",
        refresh_token: "secret",
        cookie: "secret",
        "@microsoft.graph.downloadUrl": "secret",
        title: "keep",
      },
      authorization: "secret",
    }),
    { content: "keep this text", a: { title: "keep" } },
  );
  assert.equal(safe("CON.txt"), "_CON.txt");
  assert.equal(safe("../name?.txt"), ".._name_.txt");
});

test("redirects permanently drop every authentication header on origin change", async () => {
  const calls = [];
  const mock = async (url, options) => {
    calls.push({ url, headers: options.headers });
    if (calls.length === 1)
      return new Response(null, {
        status: 302,
        headers: { location: "https://cdn.example.invalid/file" },
      });
    if (calls.length === 2)
      return new Response(null, {
        status: 302,
        headers: { location: "https://origin.example.invalid/final" },
      });
    return new Response("done");
  };
  const response = await fetchRedirects(
    "https://origin.example.invalid/file",
    {
      authorization: "Bearer FAKE-TEST",
      authentication: "FAKE-TEST",
      cookie: "FedAuth=synthetic",
    },
    mock,
  );
  assert.equal(await response.text(), "done");
  assert.equal(calls[0].headers.authorization, "Bearer FAKE-TEST");
  assert.equal(calls[0].headers.cookie, "FedAuth=synthetic");
  assert.deepEqual(calls[1].headers, {});
  assert.deepEqual(calls[2].headers, {});
  await assert.rejects(
    () =>
      fetchRedirects("http://example.invalid/file", { authorization: "FAKE" }),
    /HTTP/,
  );
});

test("download verifies bytes and rejects HTML disguised as an original", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "teams-download-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = await download(
    root,
    "files/test.txt",
    "https://example.invalid/file",
    {},
    4,
    {
      reserveBytes: 0,
      fetcher: async () =>
        new Response("demo", {
          headers: { "content-type": "text/plain", "content-length": "4" },
        }),
    },
  );
  assert.equal(result.bytes, 4);
  assert.equal(
    result.sha256,
    await hashFile(path.join(root, "files/test.txt")),
  );
  await assert.rejects(
    () =>
      download(
        root,
        "files/html.pdf",
        "https://example.invalid/file",
        {},
        undefined,
        {
          reserveBytes: 0,
          fetcher: async () =>
            new Response("<html>Sign in</html>", {
              headers: { "content-type": "application/pdf" },
            }),
        },
      ),
    /HTML login page/,
  );
  assert.equal(fs.existsSync(path.join(root, "files/html.pdf")), false);
  assert.equal(fs.existsSync(path.join(root, "files/html.pdf.part")), false);
});

test("external exports retain document formats; folders and action links stay references", () => {
  assert.match(
    externalTarget({
      url: "https://docs.google.com/spreadsheets/d/synthetic-id/edit",
    }).url,
    /export\?format=xlsx$/,
  );
  assert.equal(
    externalTarget({
      url: "https://drive.google.com/drive/folders/synthetic-folder",
    }).skip,
    "folder-link",
  );
  assert.equal(
    externalTarget({ url: "https://example.invalid/logout" }).skip,
    "action-link",
  );
  assert.equal(
    externalTarget({ url: "https://example.invalid/data/report.pdf" }).direct,
    true,
  );
  assert.match(
    externalTarget({ url: "https://arxiv.org/abs/0000.00000" }).url,
    /\/pdf\//,
  );
});

test("message traversal checkpoints all pages and marks repeated pagination incomplete", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "teams-capture-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const id = "19:synthetic-pagination@thread.v2";
  let requested = 0;
  const session = {
    endpoint: (s) => "https://teams.example.invalid/api/" + s + "/region",
    get: async (url) => {
      if (url.includes("/teams/users/me"))
        return {
          status: 200,
          data: { chats: [{ id, title: "Synthetic traversal" }], teams: [] },
        };
      if (url.includes("/conversations?pageSize"))
        return { status: 200, data: { conversations: [] } };
      requested++;
      if (url.includes("loop"))
        return {
          status: 200,
          data: {
            messages: [{ id: "2" }],
            _metadata: { backwardLink: "https://teams.example.invalid/loop" },
          },
        };
      return {
        status: 200,
        data: {
          messages: [{ id: "1" }],
          _metadata: { backwardLink: "https://teams.example.invalid/loop" },
        },
      };
    },
  };
  await messages(session, root);
  const state = read(path.join(root, "raw/messages", key(id), "state.json"));
  assert.equal(requested, 2);
  assert.equal(state.status, "incomplete");
  assert.equal(state.reason, "repeated-pagination-url");
  assert.equal(
    read(path.join(root, "message-export-summary.json")).complete,
    0,
  );
  session.get = async (url) =>
    url.includes("/teams/users/me")
      ? { status: 200, data: { chats: [{ id }], teams: [] } }
      : url.includes("/conversations?pageSize")
        ? { status: 200, data: { conversations: [] } }
        : { status: 200, data: { messages: [] } };
  await messages(session, root);
  assert.equal(
    read(path.join(root, "raw/messages", key(id), "state.json")).status,
    "complete",
  );
  assert.equal(
    fs.existsSync(path.join(root, "raw/messages", key(id), "0000000.json")),
    true,
  );
});

test("verification distinguishes file integrity from collection coverage and detects tampering", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "teams-verify-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  save(path.join(root, "archive-settings.json"), {
    synthetic: true,
    snapshotTime: "2030-04-18T06:00:00Z",
  });
  fs.mkdirSync(path.join(root, "files"));
  fs.writeFileSync(path.join(root, "files/value.txt"), "demo");
  save(path.join(root, "raw/file-states", "demo.json"), {
    key: "demo",
    status: "complete",
    localPath: "files/value.txt",
    bytes: 4,
    sha256: await hashFile(path.join(root, "files/value.txt")),
  });
  const first = await verify(root);
  assert.equal(first.integrityPassed, true);
  assert.equal(first.inventoryComplete, false);
  assert.equal(first.needsReview, true);
  fs.writeFileSync(path.join(root, "files/value.txt"), "edit");
  const second = await verify(root);
  assert.equal(second.integrityPassed, false);
  assert.match(second.failures[0].reason, /SHA-256/);
});

test("incremental capture preserves legacy keys and finds edits beyond the first overlap", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "teams-incremental-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const id = "19:synthetic-incremental@thread.v2",
    legacy = "legacy-key";
  save(path.join(root, "inventory.json"), {
    items: [{ id, key: legacy, title: "Earlier title", kind: "chat" }],
  });
  const dir = path.join(root, "raw/messages", legacy);
  save(path.join(dir, "00009.json"), {
    messages: [
      { id: "1", content: "old" },
      { id: "2", content: "unchanged" },
    ],
  });
  save(path.join(dir, "state.json"), {
    id,
    key: legacy,
    status: "complete",
    pages: 1,
    messageCount: 2,
  });
  let pages = 0;
  const session = {
    endpoint: () => "https://teams.example.invalid",
    get: async (url) => {
      if (url.includes("/teams/users/me"))
        return {
          status: 200,
          data: { chats: [{ id, title: "Current title" }] },
        };
      if (url.includes("/conversations?pageSize"))
        return { status: 200, data: { conversations: [] } };
      pages++;
      if (url.endsWith("/older"))
        return {
          status: 200,
          data: { messages: [{ id: "1", content: "edited older message" }] },
        };
      return {
        status: 200,
        data: {
          messages: [
            { id: "3", content: "new" },
            { id: "2", content: "unchanged" },
          ],
          _metadata: { backwardLink: "https://teams.example.invalid/older" },
        },
      };
    },
  };
  await messages(session, root, { incremental: true });
  assert.equal(pages, 2);
  assert.equal(read(path.join(root, "inventory.json")).items[0].key, legacy);
  assert.equal(read(path.join(dir, "0000010.json")).messages[0].id, "3");
  assert.equal(
    read(path.join(dir, "0000011.json")).messages[0].content,
    "edited older message",
  );
  const summary = read(path.join(root, "message-refresh-summary.json"));
  assert.equal(summary.added, 1);
  assert.equal(summary.updated, 1);
  assert.equal(read(path.join(dir, "00009.json")).messages[0].content, "old");
  await messages(session, root, { incremental: true });
  assert.equal(read(path.join(root, "message-refresh-summary.json")).added, 0);
  assert.equal(
    read(path.join(root, "message-refresh-summary.json")).updated,
    0,
  );
  assert.equal(fs.existsSync(path.join(dir, "0000012.json")), false);
});

test("incremental file collection preserves recovered downloads and inaccessible external links", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "teams-file-incremental-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { files } = require("../lib/files.cjs");
  const asset = {
    key: "saved",
    kind: "attachment",
    name: "saved.txt",
    url: "https://demo.example.invalid/saved.txt",
  };
  const blocked = {
    key: "blocked",
    kind: "external-link",
    url: "https://demo.example.invalid/inaccessible",
  };
  save(path.join(root, "all-assets.json"), [asset]);
  save(path.join(root, "external-assets.json"), [blocked]);
  fs.mkdirSync(path.join(root, "files"));
  fs.writeFileSync(path.join(root, "files/saved.txt"), "saved");
  save(path.join(root, "raw/file-states/saved.json"), {
    key: "saved",
    status: "failed",
  });
  save(path.join(root, "raw/external-states/saved.json"), {
    key: "saved",
    status: "complete",
    localPath: "files/saved.txt",
    bytes: 5,
    sha256: await hashFile(path.join(root, "files/saved.txt")),
  });
  save(path.join(root, "raw/external-states/blocked.json"), {
    key: "blocked",
    status: "browser-required",
    error: "Sign-in unavailable",
  });
  await files(
    {
      get: () => {
        throw new Error("No network request expected");
      },
    },
    root,
    { incremental: true, libraries: "none", external: "files" },
  );
  const manifest = read(path.join(root, "file-manifest.json"));
  assert.equal(manifest.find((x) => x.key === "saved").status, "complete");
  assert.equal(
    manifest.find((x) => x.key === "blocked").status,
    "browser-required",
  );
  assert.equal(
    fs.readFileSync(path.join(root, "files/saved.txt"), "utf8"),
    "saved",
  );
});

test("incremental library discovery revisits prior drives within the requested scope", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "teams-drive-scope-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { libraryInventory } = require("../lib/files.cjs");
  const team = "https://synthetic.sharepoint.com/sites/Archive";
  const personal = "https://synthetic-my.sharepoint.com/personal/reader";
  save(path.join(root, "library-assets.json"), [
    { key: "team-file", baseUrl: team, driveId: "team-drive" },
    { key: "personal-file", baseUrl: personal, driveId: "my-drive" },
  ]);
  const requested = [];
  const session = {
    captured: new Map(),
    get: async (url) => {
      requested.push(url);
      return { status: 200, data: { value: [] } };
    },
  };
  await libraryInventory(session, root, {
    incremental: true,
    libraries: "teams",
  });
  assert.equal(requested.length, 1);
  assert.ok(requested[0].startsWith(team));
  requested.length = 0;
  await libraryInventory(session, root, {
    incremental: true,
    libraries: "none",
    onedrive: true,
  });
  assert.equal(requested.length, 1);
  assert.ok(requested[0].startsWith(personal));
  assert.equal(
    read(path.join(root, "library-inventory.json"))[0].status,
    "complete",
  );
  assert.equal(read(path.join(root, "library-assets.json")).length, 2);
});

test("modified files retry after a failed refresh and use origin-scoped browser cookies", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "teams-refresh-cookie-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { files } = require("../lib/files.cjs");
  const url = "https://synthetic.sharepoint.com/sites/Archive/_api/content";
  const asset = {
    key: "modified",
    kind: "library",
    url,
    downloadApi: url,
    name: "report.txt",
    relativePath: "files/report.txt",
    expectedSize: 3,
    remoteModifiedAt: "2021-01-01T00:00:00Z",
    remoteETag: "current",
  };
  save(path.join(root, "all-assets.json"), [asset]);
  fs.mkdirSync(path.join(root, "files"));
  fs.writeFileSync(path.join(root, "files/report.txt"), "old");
  const sha256 = await hashFile(path.join(root, "files/report.txt"));
  save(path.join(root, "raw/file-states/modified.json"), {
    key: asset.key,
    status: "complete",
    localPath: asset.relativePath,
    bytes: 3,
    sha256,
    completedAt: "2020-01-01T00:00:00Z",
  });
  let attempts = 0;
  const mock = t.mock.method(global, "fetch", async (target, options) => {
    assert.equal(target, url);
    assert.equal(options.headers.cookie, "FedAuth=synthetic-cookie");
    attempts++;
    return attempts === 1
      ? new Response(null, { status: 401 })
      : new Response("new", {
          headers: { "content-type": "text/plain", "content-length": "3" },
        });
  });
  const session = {
    headersFor: async () => ({}),
    context: {
      cookies: async (target) => {
        assert.equal(target, url);
        return [{ name: "FedAuth", value: "synthetic-cookie" }];
      },
    },
  };
  const options = { incremental: true, libraries: "none" };
  await files(session, root, options);
  let state = read(path.join(root, "raw/file-states/modified.json"));
  assert.equal(state.status, "complete");
  assert.equal(state.lastAttempt.httpStatus, 401);
  assert.equal(
    fs.readFileSync(path.join(root, asset.relativePath), "utf8"),
    "old",
  );
  await files(session, root, options);
  state = read(path.join(root, "raw/file-states/modified.json"));
  assert.equal(state.remoteETag, "current");
  assert.equal(state.lastAttempt, undefined);
  assert.equal(
    fs.readFileSync(path.join(root, asset.relativePath), "utf8"),
    "new",
  );
  assert.equal(
    await hashFile(path.join(root, state.previousVersion.localPath)),
    sha256,
  );
  assert.ok(
    !fs
      .readFileSync(path.join(root, "raw/file-states/modified.json"), "utf8")
      .includes("synthetic-cookie"),
  );
  await files(session, root, options);
  assert.equal(mock.mock.callCount(), 2);
});

test("legacy non-drive library scopes discover newly added files", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "teams-legacy-library-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { libraryInventory } = require("../lib/files.cjs");
  const base = "https://synthetic.sharepoint.com/sites/Archive";
  save(path.join(root, "library-inventory.json"), [
    {
      base,
      prefix: "files/channels/Archive/Site Assets",
      files: 0,
      status: "complete",
    },
  ]);
  const session = {
    get: async (url) => {
      if (url.includes("/RootFolder?")) return { status: 404, data: {} };
      if (url.includes("/lists?"))
        return {
          status: 200,
          data: {
            d: {
              results: [
                {
                  Title: "Localized assets",
                  EntityTypeName: "SiteAssets",
                  RootFolder: {
                    ServerRelativeUrl: "/sites/Archive/SiteAssets",
                  },
                },
              ],
            },
          },
        };
      if (url.includes("/Files?"))
        return {
          status: 200,
          data: {
            d: {
              results: [
                {
                  Name: "new.txt",
                  Length: "3",
                  UniqueId: "00000000-0000-4000-8000-000000000001",
                  ServerRelativeUrl: "/sites/Archive/SiteAssets/new.txt",
                  TimeLastModified: "2021-01-01T00:00:00Z",
                },
              ],
            },
          },
        };
      return { status: 200, data: { d: { results: [] } } };
    },
  };
  const assets = await libraryInventory(session, root, { incremental: true });
  assert.equal(assets.length, 1);
  assert.equal(assets[0].name, "new.txt");
  assert.equal(assets[0].expectedSize, 3);
  assert.equal(assets[0].remoteModifiedAt, "2021-01-01T00:00:00Z");
  assert.equal(
    read(path.join(root, "library-inventory.json"))[0].status,
    "complete",
  );
});
