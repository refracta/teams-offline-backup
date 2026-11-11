import json, re, hashlib, html, collections
from pathlib import Path
from urllib.parse import urlsplit, unquote
from archive import ROOT, SETTINGS


def read(p):
    return json.loads(p.read_text(encoding="utf-8"))


def save(p, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def parse(v, default):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except:
            return default
    return v if v is not None else default


def key(v):
    return hashlib.sha256(v.encode()).hexdigest()[:24]


inventory = read(ROOT / "inventory.json")
assets = {}
counts = []


def asset(url, kind, ref, **more):
    if not isinstance(url, str) or not url.startswith(("https://", "http://")):
        return
    url = html.unescape(url)
    canonical = unquote(url.split("#")[0])
    ident = key(canonical)
    if ident not in assets:
        assets[ident] = {
            "key": ident,
            "url": url,
            "kind": kind,
            "references": [],
            **more,
        }
    if ref not in assets[ident]["references"]:
        assets[ident]["references"].append(ref)
    for k, v in more.items():
        if v and not assets[ident].get(k):
            assets[ident][k] = v
    return ident


cache = (
    read(ROOT / "raw/cache/replychain-manager.json")
    if (ROOT / "raw/cache/replychain-manager.json").exists()
    else {"stores": []}
)
cached = collections.defaultdict(dict)
for s in cache["stores"]:
    for rc in s["values"]:
        for m in rc.get("messageMap", {}).values():
            cached[m["conversationId"]][m["id"]] = m
for item in inventory["items"]:
    raw = {}
    cache_only = []
    for f in sorted((ROOT / "raw/messages" / item["key"]).glob("[0-9]*.json")):
        for m in read(f).get("messages", []):
            raw[str(m["id"])] = m
    messages = []
    for mid, m in raw.items():
        p = m.get("properties") or {}
        content = m.get("content") or ""
        if not isinstance(content, str):
            content = json.dumps(content, ensure_ascii=False)
        ref = {"conversationKey": item["key"], "messageId": mid}
        filekeys = []
        files = parse(p.get("files"), [])
        for f in files if isinstance(files, list) else []:
            info = f.get("fileInfo") or {}
            u = (
                info.get("fileUrl")
                or f.get("objectUrl")
                or info.get("shareUrl")
                or f.get("fileUrl")
            )
            if not u:
                continue
            host = urlsplit(u).hostname or ""
            kind = (
                "sharepoint"
                if host.endswith(".sharepoint.com")
                else (
                    "media"
                    if "asyncgw.teams.microsoft.com" in host or "asm.skype.com" in host
                    else "attachment"
                )
            )
            ak = asset(
                u,
                kind,
                ref,
                name=f.get("fileName") or f.get("title"),
                baseUrl=f.get("baseUrl") or info.get("siteUrl"),
                itemId=f.get("itemid") or f.get("id"),
                shareUrl=info.get("shareUrl"),
            )
            if ak:
                filekeys.append(ak)
        for tag, u in re.findall(r'\b(src|href)\s*=\s*["\']([^"\']+)', content, re.I):
            u = html.unescape(u)
            host = urlsplit(u).hostname or ""
            if (
                "asyncgw.teams.microsoft.com" in host or host.endswith(".asm.skype.com")
            ) and "/objects/" in u:
                ak = asset(u, "media", ref)
                if ak:
                    filekeys.append(ak)
            elif host.endswith(".sharepoint.com"):
                if not any(
                    u in [assets[k]["url"], assets[k].get("shareUrl")] for k in filekeys
                ):
                    ak = asset(u, "sharepoint-link", ref)
                    if ak:
                        filekeys.append(ak)
        messages.append(
            {
                "id": mid,
                "createdAt": m.get("originalarrivaltime") or m.get("composetime"),
                "modifiedAt": p.get("edittime"),
                "author": m.get("imdisplayname")
                or m.get("fromDisplayNameInToken")
                or m.get("from"),
                "authorId": m.get("from"),
                "type": m.get("messagetype"),
                "content": content,
                "parentMessageId": (
                    m.get("rootMessageId") if m.get("rootMessageId") != mid else None
                ),
                "subject": p.get("subject"),
                "mentions": parse(p.get("mentions"), []),
                "reactions": parse(p.get("emotions"), [])
                or m.get("annotationsSummary"),
                "files": list(dict.fromkeys(filekeys)),
            }
        )
    for mid, m in cached.get(item["id"], {}).items():
        if mid not in raw:
            cache_only.append(m)
    if cache_only:
        save(ROOT / "raw/cache-only" / f"{item['key']}.json", cache_only)
    messages.sort(key=lambda m: (m.get("createdAt") or "", m["id"]))
    save(
        ROOT / "conversations" / f"{item['key']}.json",
        {**item, "messages": messages, "cacheOnlyCount": len(cache_only)},
    )
    state = read(ROOT / "raw/messages" / item["key"] / "state.json")
    counts.append(
        {
            **item,
            "messageCount": len(messages),
            "cacheOnlyCount": len(cache_only),
            "status": state["status"],
            "earliest": messages[0]["createdAt"] if messages else None,
            "latest": messages[-1]["createdAt"] if messages else None,
        }
    )
save(ROOT / "assets.json", list(assets.values()))
save(ROOT / "conversations.json", counts)
print(
    json.dumps(
        {
            "conversations": len(counts),
            "messages": sum(c["messageCount"] for c in counts),
            "cacheOnlyMessages": sum(c["cacheOnlyCount"] for c in counts),
            "assets": len(assets),
            "assetKinds": dict(collections.Counter(a["kind"] for a in assets.values())),
        },
        ensure_ascii=False,
    )
)
