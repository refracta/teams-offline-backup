const path = require("node:path");
const { read, save, key, scrub, sleep } = require("./storage.cjs");

async function cacheInventory(session, root) {
  const databases = await session.page.evaluate(async () => {
    const output = [];
    for (const item of await indexedDB.databases()) {
      if (
        !/Teams:(chat|conversation|messaging|replychain|streams-replychain|collab|channel|team-|profiles)/.test(
          item.name,
        )
      )
        continue;
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(item.name);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const stores = [];
      try {
        for (const name of db.objectStoreNames) {
          if (/auth|token|cookie|credential|secret/i.test(name)) continue;
          const values = await new Promise((resolve, reject) => {
            const req = db.transaction(name).objectStore(name).getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          stores.push({ name, values });
        }
      } finally {
        db.close();
      }
      output.push({ name: item.name.split(":")[1], stores });
    }
    return output;
  });
  for (const db of databases) {
    if (!/^[a-z0-9_-]+$/i.test(db.name)) continue;
    save(
      path.join(root, "raw/cache", db.name + ".json"),
      scrub({ stores: db.stores }),
    );
  }
  return databases.length;
}

async function messages(session, root, options = {}) {
  const csa = await session.get(
    session.endpoint("csa") +
      "/api/v3/teams/users/me?isPrefetch=false&enableMembershipSummary=true&supportsAdditionalSystemGeneratedFolders=true&supportsSliceItems=true",
  );
  if (csa.status !== 200) throw new Error("Teams inventory HTTP " + csa.status);
  save(path.join(root, "raw/server-inventory.json"), csa.data);
  const cached =
    read(path.join(root, "raw/cache/conversation-manager.json"), {
      stores: [],
    }).stores.find((x) => x.name === "conversations")?.values || [];
  const items = new Map();
  const add = (id, data) => {
    if (id) items.set(id, { ...items.get(id), id, key: key(id), ...data });
  };
  for (const c of cached)
    if (["Chat", "Meeting", "Topic", "Space", "StreamOfNotes"].includes(c.type))
      add(c.id, {
        kind: ["Topic", "Space"].includes(c.type)
          ? "channel"
          : c.type === "StreamOfNotes"
            ? "notes"
            : "chat",
        chatType: c.type === "Meeting" ? "meeting" : undefined,
        title: c.chatTitle?.shortTitle || c.threadProperties?.topic || c.id,
        teamId: c.teamId,
        source: "cache",
      });
  for (const c of csa.data.chats || [])
    add(c.id, {
      kind: "chat",
      title: c.title || items.get(c.id)?.title || c.id,
      source: "server",
      chatType: c.chatType,
    });
  for (const t of csa.data.teams || [])
    for (const c of t.channels || [])
      add(c.id, {
        kind: "channel",
        title: t.displayName + " / " + c.displayName,
        teamId: t.id,
        source: "server",
        isDeleted: c.isDeleted,
        channelType: c.channelType,
      });
  for (const c of csa.data.privateFeeds || [])
    if (/notes/i.test(c.id))
      add(c.id, { kind: "notes", title: "내 메모", source: "server" });
  const listSeen = new Set();
  let listPage = 0,
    listComplete = false;
  let url =
    session.endpoint("chatsvc") + "/v1/users/ME/conversations?pageSize=200";
  while (url && !listSeen.has(url)) {
    listSeen.add(url);
    const res = await session.get(url);
    save(
      path.join(
        root,
        "raw/conversation-list",
        String(listPage++).padStart(4, "0") + ".json",
      ),
      res,
    );
    if (res.status !== 200) break;
    const batch = res.data.conversations || [];
    for (const c of batch)
      if (c.id?.startsWith("19:") || c.id === "48:notes")
        add(c.id, {
          title: items.get(c.id)?.title || c.threadProperties?.topic || c.id,
          kind: items.get(c.id)?.kind || "chat",
        });
    url = res.data._metadata?.backwardLink;
    if (!url) {
      listComplete = true;
      break;
    }
    await sleep(100);
  }
  // Keep previously exported conversations even if they disappeared from the latest inventory.
  for (const previous of read(path.join(root, "inventory.json"), { items: [] })
    .items)
    if (!items.has(previous.id))
      items.set(previous.id, { ...previous, missingFromLatestInventory: true });
  const inventory = {
    collectedAt: new Date().toISOString(),
    csaComplete:
      !csa.data.metadata?.isPartialData && !csa.data.metadata?.hasMoreChats,
    conversationPaginationComplete: listComplete,
    items: [...items.values()],
  };
  save(path.join(root, "inventory.json"), inventory);
  let finished = 0;
  for (const item of inventory.items) {
    const dir = path.join(root, "raw/messages", item.key);
    const stateFile = path.join(dir, "state.json");
    let state = read(stateFile, {
      ...item,
      status: "pending",
      pages: 0,
      messageCount: 0,
    });
    if (state.status === "complete" && !options.refresh) {
      finished++;
      continue;
    }
    // Refresh appends a new complete traversal; older snapshots are retained.
    // The normalizer resolves duplicate message IDs in favor of later pages.
    if (options.refresh || !state.nextUrl)
      state.nextUrl =
        session.endpoint("chatsvc") +
        "/v1/users/ME/conversations/" +
        encodeURIComponent(item.id) +
        "/messages?pageSize=200";
    state.status = "in-progress";
    delete state.reason;
    delete state.error;
    delete state.httpStatus;
    const seen = new Set();
    try {
      while (state.nextUrl) {
        if (seen.has(state.nextUrl)) {
          state.status = "incomplete";
          state.reason = "repeated-pagination-url";
          break;
        }
        seen.add(state.nextUrl);
        const response = await session.get(state.nextUrl);
        if (response.status !== 200) {
          state.status = "failed";
          state.httpStatus = response.status;
          break;
        }
        const batch = response.data.messages || [];
        save(
          path.join(dir, String(state.pages).padStart(7, "0") + ".json"),
          response.data,
        );
        state.pages++;
        state.messageCount += batch.length;
        state.nextUrl = response.data._metadata?.backwardLink || null;
        state.updatedAt = new Date().toISOString();
        if (!state.nextUrl) {
          state.status = "complete";
          state.nextUrl = null;
        }
        save(stateFile, state);
        if (state.pages % 10 === 0)
          console.log(
            JSON.stringify({
              stage: "messages",
              key: item.key,
              pages: state.pages,
            }),
          );
        await sleep(100);
      }
    } catch {
      state.status = "failed";
      state.error = "Request failed; run backup again to resume.";
    }
    save(stateFile, state);
    console.log(
      JSON.stringify({
        stage: "conversation",
        finished: ++finished,
        total: items.size,
        status: state.status,
      }),
    );
  }
  const states = inventory.items.map((i) =>
    read(path.join(root, "raw/messages", i.key, "state.json")),
  );
  save(path.join(root, "message-export-summary.json"), {
    completedAt: new Date().toISOString(),
    inventoryComplete: inventory.csaComplete && listComplete,
    conversations: states.length,
    complete: states.filter((x) => x.status === "complete").length,
    failed: states
      .filter((x) => x.status !== "complete")
      .map((x) => ({
        key: x.key,
        httpStatus: x.httpStatus,
        reason: x.reason || x.error,
      })),
  });
}
module.exports = { cacheInventory, messages };
