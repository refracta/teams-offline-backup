const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { read, save, key, safe, inside, hashFile } = require("./storage.cjs");
const { isSharePoint, isMedia, teamsHosts } = require("./session.cjs");
const { download } = require("./download.cjs");

async function libraryInventory(session, root, options) {
  const inventory = read(path.join(root, "raw/server-inventory.json"), {});
  const assets = new Map();
  const summaries = [];
  const bases = new Map();
  const addSite = (url, title) => {
    try {
      const u = new URL(url);
      if (!isSharePoint(u.hostname)) return;
      const site = u.pathname.match(/^\/(sites|teams|personal)\/[^/]+/)?.[0];
      if (site) bases.set(u.origin + site, title || site.split("/").pop());
    } catch {}
  };
  for (const team of inventory.teams || []) {
    addSite(team.teamSiteInformation?.sharepointSiteUrl, team.displayName);
    for (const channel of team.channels || []) {
      for (const match of JSON.stringify(
        channel.defaultFileSettings || {},
      ).matchAll(
        /https:\/\/[^/"\s]+\.sharepoint\.com\/(?:sites|teams)\/[^/"?\s]+/g,
      ))
        addSite(match[0]);
    }
  }
  for (const tab of read(path.join(root, "channel-tabs.json"), []))
    for (const url of tab.urls || []) {
      // Include private/shared channel sites; personal sites are only traversed
      // by --onedrive, not merely because somebody shared one attachment.
      if (/\.sharepoint\.com\/(?:sites|teams)\//i.test(url))
        addSite(url, tab.team);
    }
  async function scan(base, drive, title) {
    const prefix =
      "files/libraries/" +
      safe(title) +
      "__" +
      key(base + drive.id).slice(0, 8);
    const queue = [{ id: "root", rel: prefix }];
    const seen = new Set();
    const failures = [];
    let count = 0;
    while (queue.length) {
      const folder = queue.shift();
      if (seen.has(folder.id)) continue;
      seen.add(folder.id);
      let url =
        base +
        "/_api/v2.0/drives/" +
        encodeURIComponent(drive.id) +
        (folder.id === "root"
          ? "/root"
          : "/items/" + encodeURIComponent(folder.id)) +
        "/children?$top=200";
      const pages = new Set();
      while (url) {
        if (pages.has(url)) {
          failures.push({ folder: folder.rel, error: "Repeated nextLink" });
          break;
        }
        pages.add(url);
        const result = await session.get(url);
        save(path.join(root, "raw/libraries", key(url) + ".json"), result);
        if (result.status !== 200) {
          failures.push({ folder: folder.rel, httpStatus: result.status });
          break;
        }
        for (const item of result.data.value || []) {
          if (item.folder) {
            queue.push({
              id: item.id,
              rel:
                folder.rel +
                "/" +
                safe(item.name) +
                "__" +
                key(item.id).slice(0, 6),
            });
            continue;
          }
          if (item.remoteItem) {
            failures.push({
              name: item.name,
              error:
                "Remote shortcut: follow the original shared link separately",
            });
            continue;
          }
          if (!item.file && !item.package) continue;
          const api =
            base +
            "/_api/v2.0/drives/" +
            encodeURIComponent(drive.id) +
            "/items/" +
            encodeURIComponent(item.id) +
            "/content";
          const asset = {
            key: key(api),
            kind: "library",
            url: item.webUrl || api,
            downloadApi: api,
            name: item.name,
            expectedSize: item.size,
            relativePath:
              folder.rel +
              "/" +
              key(item.id).slice(0, 8) +
              "__" +
              safe(item.name),
            baseUrl: base,
            driveId: drive.id,
            itemId: item.id,
            references: [],
          };
          assets.set(asset.key, asset);
          count++;
        }
        url = result.data["@odata.nextLink"];
      }
    }
    summaries.push({
      base,
      driveId: drive.id,
      files: count,
      folders: seen.size,
      status: failures.length ? "incomplete" : "complete",
      failed: failures,
    });
    console.log(
      JSON.stringify({
        stage: "library",
        files: count,
        failures: failures.length,
      }),
    );
  }
  if (options.libraries !== "none")
    for (const [base, title] of bases) {
      try {
        let url = base + "/_api/v2.0/drives";
        const seen = new Set();
        while (url) {
          if (seen.has(url)) throw new Error("Repeated drive nextLink");
          seen.add(url);
          const result = await session.get(url);
          if (result.status !== 200) {
            summaries.push({
              base,
              status: "failed",
              httpStatus: result.status,
            });
            break;
          }
          for (const drive of result.data.value || [])
            await scan(base, drive, title + "/" + drive.name);
          url = result.data["@odata.nextLink"];
        }
      } catch {
        summaries.push({
          base,
          status: "failed",
          error: "Library discovery failed",
        });
      }
    }
  if (options.onedrive) {
    const my = [...session.captured.keys()].filter((u) =>
      /^https:\/\/[^/]+-my\.sharepoint\.com$/.test(u),
    );
    if (!my.length)
      summaries.push({
        status: "incomplete",
        error:
          "Open OneDrive in Teams to expose its origin, then retry with --onedrive.",
      });
    for (const origin of my) {
      try {
        const result = await session.get(origin + "/_api/v2.0/me/drive");
        if (result.status !== 200) {
          summaries.push({
            base: origin,
            status: "failed",
            httpStatus: result.status,
          });
          continue;
        }
        const u = new URL(result.data.webUrl),
          site = u.pathname.match(/^\/personal\/[^/]+/)?.[0];
        if (!site) {
          summaries.push({
            base: origin,
            status: "incomplete",
            error: "Personal site URL not discovered",
          });
          continue;
        }
        await scan(u.origin + site, result.data, "OneDrive");
      } catch {
        summaries.push({
          base: origin,
          status: "failed",
          error: "OneDrive discovery failed",
        });
      }
    }
  }
  save(path.join(root, "library-inventory.json"), summaries);
  // Preserve old files when refreshing. A removed remote file must not erase a backup.
  for (const old of read(path.join(root, "library-assets.json"), []))
    if (!assets.has(old.key)) assets.set(old.key, old);
  save(path.join(root, "library-assets.json"), [...assets.values()]);
  return [...assets.values()];
}

async function sharePointMetadata(session, asset) {
  if (asset.downloadApi)
    return {
      url: asset.downloadApi,
      name: asset.name,
      size: asset.expectedSize,
    };
  const u = new URL(asset.url);
  const base = (
    asset.baseUrl ||
    u.origin + (u.pathname.match(/\/(personal|sites|teams)\/[^/]+/)?.[0] || "")
  ).replace(/\/$/, "");
  if (!isSharePoint(new URL(base).hostname))
    throw new Error("Invalid SharePoint base");
  const id = String(asset.itemId || "").replace(/[{}]/g, "");
  let metaUrl;
  if (/^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(id))
    metaUrl =
      base +
      "/_api/web/GetFileById(guid'" +
      id +
      "')?$select=Name,Length,UniqueId";
  else if (
    !/^\/:/.test(u.pathname) &&
    /\/(Documents|Shared%20Documents|Shared Documents)\//i.test(u.pathname)
  )
    metaUrl =
      base +
      "/_api/web/GetFileByServerRelativePath(decodedurl=@p)?@p=" +
      encodeURIComponent(
        "'" + decodeURIComponent(u.pathname).replace(/'/g, "''") + "'",
      ) +
      "&$select=Name,Length,UniqueId";
  if (metaUrl) {
    const response = await session.get(metaUrl);
    if (response.status === 200) {
      const d = response.data.d || response.data;
      return {
        url: base + "/_api/web/GetFileById(guid'" + d.UniqueId + "')/$value",
        name: d.Name,
        size: Number(d.Length),
      };
    }
  }
  const share =
    "u!" + Buffer.from(asset.shareUrl || asset.url).toString("base64url");
  const response = await session.get(
    base + "/_api/v2.0/shares/" + share + "/driveItem",
  );
  if (response.status !== 200)
    throw Object.assign(new Error("Shared file metadata unavailable"), {
      httpStatus: response.status,
    });
  const d = response.data;
  if (d.folder) return { folder: true, name: d.name };
  return {
    url:
      base +
      "/_api/v2.0/drives/" +
      encodeURIComponent(d.parentReference?.driveId) +
      "/items/" +
      encodeURIComponent(d.id) +
      "/content",
    name: d.name,
    size: d.size,
  };
}

const directExtensions =
  /\.(pdf|zip|7z|tar|gz|bz2|xz|rar|xlsx?|xlsm|csv|tsv|docx?|pptx?|hwp[x]?|png|jpe?g|gif|webp|svg|mp4|mov|webm|mp3|wav|json|txt|md|py|ipynb|mat|npy|npz|onnx|pt|pth|bin|loop)(?:$|[?#])/i;
function externalTarget(asset) {
  const u = new URL(asset.url);
  if (
    /\/(?:logout|signout|delete|remove|unsubscribe)(?:\/|$)|[?&](?:action|do)=(?:delete|remove|logout)/i.test(
      u.pathname + u.search,
    )
  )
    return { skip: "action-link" };
  let m;
  if (
    u.hostname === "docs.google.com" &&
    (m = u.pathname.match(
      /^\/(spreadsheets|document|presentation)\/d\/([^/]+)/,
    ))
  ) {
    const format = {
      spreadsheets: "xlsx",
      document: "docx",
      presentation: "pptx",
    }[m[1]];
    return {
      url: u.origin + "/" + m[1] + "/d/" + m[2] + "/export?format=" + format,
      name: (asset.name || "document") + "." + format,
      direct: true,
    };
  }
  if (u.hostname === "drive.google.com" && /\/folders\//.test(u.pathname))
    return { skip: "folder-link" };
  if (
    u.hostname === "drive.google.com" &&
    (m = u.pathname.match(/\/file\/d\/([^/]+)/))
  )
    return {
      url:
        "https://drive.google.com/uc?export=download&id=" +
        encodeURIComponent(m[1]),
      name: asset.name || "drive-file",
      direct: true,
    };
  if (u.hostname === "arxiv.org" && /^\/abs\//.test(u.pathname))
    return {
      url: u.origin + u.pathname.replace("/abs/", "/pdf/"),
      name: u.pathname.split("/").pop() + ".pdf",
      direct: true,
    };
  if (u.hostname === "github.com" && /\/blob\//.test(u.pathname))
    return {
      url:
        "https://raw.githubusercontent.com" + u.pathname.replace("/blob/", "/"),
      name: decodeURIComponent(u.pathname.split("/").pop()),
      direct: true,
    };
  if (
    u.hostname === "openreview.net" &&
    u.pathname === "/forum" &&
    u.searchParams.has("id")
  )
    return {
      url:
        "https://openreview.net/pdf?id=" +
        encodeURIComponent(u.searchParams.get("id")),
      name: u.searchParams.get("id") + ".pdf",
      direct: true,
    };
  return {
    url: asset.url,
    name:
      asset.name || decodeURIComponent(u.pathname.split("/").pop()) || "file",
    direct:
      directExtensions.test(asset.url) ||
      [
        "emoji",
        "inline-image",
        "card-image",
        "group-avatar",
        "attachment",
        "external-file",
      ].includes(asset.kind),
  };
}

async function files(session, root, options = {}) {
  const libraries = await libraryInventory(session, root, options);
  const assets = new Map();
  for (const list of [
    read(path.join(root, "assets.json"), []),
    libraries,
    read(path.join(root, "external-assets.json"), []),
    read(path.join(root, "static-assets.json"), []),
  ])
    for (const a of list) assets.set(a.key, a);
  save(path.join(root, "all-assets.json"), [...assets.values()]);
  let index = 0;
  for (const asset of assets.values()) {
    const stateFile = path.join(root, "raw/file-states", asset.key + ".json");
    const existing = read(stateFile);
    let verifiedExisting = false;
    if (existing?.status === "complete" && existing.localPath) {
      const local = inside(root, existing.localPath);
      if (
        fs.existsSync(local) &&
        fs.statSync(local).size === existing.bytes &&
        (await hashFile(local)) === existing.sha256
      ) {
        verifiedExisting = true;
        if (
          !options.refresh ||
          existing.provenance?.startsWith("user-import")
        ) {
          index++;
          continue;
        }
      }
    }
    let state = {
      key: asset.key,
      name: asset.name,
      sourceUrl: asset.url,
      kind: asset.kind,
    };
    try {
      const u = new URL(asset.url);
      let meta,
        headers = {};
      if (isSharePoint(u.hostname)) {
        meta = await sharePointMetadata(session, asset);
        if (meta.folder) {
          state.status = "folder-link";
          state.name = meta.name;
          state.error =
            "Shared folder address retained; document libraries use the separate inventory.";
        } else headers = await session.headersFor(meta.url);
      } else if (isMedia(u.hostname)) {
        meta = { url: asset.url, name: asset.name || asset.key + ".bin" };
        if (!/\/views\//.test(u.pathname)) {
          const response = await session.get(asset.url);
          if (response.status !== 200)
            throw Object.assign(new Error("Media metadata unavailable"), {
              httpStatus: response.status,
            });
          const d = response.data,
            view = [
              "original",
              "imgpsh_fullsize_anim",
              "imgo",
              "video",
              "audio",
              "thumbnail",
              "thumbnail_small",
            ].find((v) => d.contents?.[v]);
          if (!view) throw new Error("No downloadable media view");
          meta = {
            url: asset.url + "/views/" + view,
            name: d.filename || asset.key + ".bin",
            size: d.contents[view].length,
          };
          state.contentRole = /thumbnail/.test(view)
            ? "recording-thumbnail"
            : "original-media";
        }
        headers = await session.headersFor(meta.url);
      } else {
        meta = externalTarget(asset);
        if (meta.skip) state.status = meta.skip;
        else if (
          teamsHosts.has(u.hostname) ||
          /(?:^|\.)login\.microsoftonline\.com$/.test(u.hostname)
        )
          state.status = "link-only";
        else if (
          options.external === "none" ||
          (options.external !== "all" && !meta.direct)
        )
          state.status = "link-only";
      }
      if (!state.status) {
        const relative =
          asset.relativePath ||
          "files/downloads/" + asset.key.slice(0, 12) + "__" + safe(meta.name);
        const result = await download(
          root,
          relative,
          meta.url,
          headers,
          meta.size,
        );
        state = {
          ...state,
          ...result,
          name: meta.name,
          status: "complete",
          completedAt: new Date().toISOString(),
        };
      }
    } catch (error) {
      state = {
        ...state,
        status: error.browserRequired ? "browser-required" : "failed",
        httpStatus: error.httpStatus,
        error: error.message,
      };
    }
    // Preserve a verified earlier download if a later retrieval becomes inaccessible.
    if (verifiedExisting && state.status !== "complete") {
      state = {
        ...existing,
        lastAttempt: {
          status: state.status,
          httpStatus: state.httpStatus,
          error: state.error,
          at: new Date().toISOString(),
        },
      };
    }
    save(stateFile, state);
    console.log(
      JSON.stringify({
        stage: "files",
        finished: ++index,
        total: assets.size,
        status: state.status,
      }),
    );
  }
  const states = [...assets.keys()].map((k) =>
    read(path.join(root, "raw/file-states", k + ".json")),
  );
  save(path.join(root, "file-manifest.json"), states);
  save(
    path.join(root, "external-manifest.json"),
    states.filter(
      (s) =>
        !["sharepoint", "library", "media", "media-object"].includes(s.kind),
    ),
  );
  save(path.join(root, "file-export-summary.json"), {
    assets: states.length,
    downloaded: states.filter((s) => s.status === "complete").length,
    unresolved: states.filter((s) => s.status !== "complete").length,
    completedAt: new Date().toISOString(),
  });
}

async function avatars(session, root) {
  const people = read(path.join(root, "profiles.json"), []),
    result = [];
  const previous = new Map(
    read(path.join(root, "avatar-manifest.json"), []).map((x) => [x.id, x]),
  );
  for (const person of people) {
    let response;
    try {
      const prefix =
        session.endpoint("mt") +
        "/beta/users/" +
        session.selfId.replace(/^8:orgid:/, "") +
        "/profilepicturev2/";
      const url =
        person.imageUri ||
        prefix +
          encodeURIComponent(person.id) +
          "?displayname=" +
          encodeURIComponent(person.name) +
          "&size=HR256x256";
      if (!teamsHosts.has(new URL(url).hostname))
        throw new Error("Profile photo origin not supported");
      response = await session.get(url, true);
      const data =
        response.status() === 200 ? await response.body() : Buffer.alloc(0);
      let ext = data
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? "png"
        : data[0] === 255 && data[1] === 216
          ? "jpg"
          : data.subarray(0, 3).toString() === "GIF"
            ? "gif"
            : data.subarray(0, 4).toString() === "RIFF"
              ? "webp"
              : "";
      if (!ext)
        throw Object.assign(new Error("Photo unavailable"), {
          httpStatus: response.status(),
        });
      const relative = "files/avatars/" + key(person.id) + "." + ext;
      fs.mkdirSync(path.dirname(inside(root, relative)), { recursive: true });
      fs.writeFileSync(inside(root, relative), data);
      result.push({
        id: person.id,
        status: "complete",
        localPath: relative,
        bytes: data.length,
        sha256: crypto.createHash("sha256").update(data).digest("hex"),
      });
    } catch (error) {
      result.push(
        previous.get(person.id)?.status === "complete"
          ? previous.get(person.id)
          : {
              id: person.id,
              status: "unavailable",
              httpStatus: error.httpStatus,
            },
      );
    } finally {
      await response?.dispose();
    }
  }
  save(path.join(root, "avatar-manifest.json"), result);
}
module.exports = {
  libraryInventory,
  sharePointMetadata,
  externalTarget,
  files,
  avatars,
};
