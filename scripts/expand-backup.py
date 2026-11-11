import json, re, html, hashlib, base64, collections
from pathlib import Path
from urllib.parse import urlsplit, parse_qs, unquote, urlunsplit
from lxml import etree
from archive import ROOT, SETTINGS


def read(p):
    return json.loads(p.read_text(encoding="utf-8"))


def save(p, d):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")


def key(s):
    return hashlib.sha256(s.encode()).hexdigest()[:24]


def parse(s):
    if isinstance(s, str):
        try:
            return json.loads(s)
        except:
            return None
    return s


names = {}
people = {}
links = {}
static = {}
cards = {}
tabs = []


def person(mri, name=None, **props):
    if not mri or not isinstance(mri, str):
        return
    mri = mri.split("/contacts/")[-1]
    if mri.startswith("https://"):
        return
    if mri.startswith("orgid:"):
        mri = "8:" + mri
    if not re.match(r"^(8:|28:|29:|[0-9a-f]{8}-)", mri):
        return
    if re.match(r"^[0-9a-f]{8}-", mri):
        mri = "8:orgid:" + mri
    item = people.setdefault(mri, {"id": mri})
    if name and not str(name).startswith(("http", "8:", "28:")):
        names[mri] = name
        item["name"] = name
    item.update({k: v for k, v in props.items() if v is not None})


def add(url, kind, ref=None, **props):
    if not isinstance(url, str):
        return
    url = html.unescape(url).strip().rstrip(".,;")
    if not url.startswith(("http://", "https://")):
        return
    try:
        u = urlsplit(url)
    except:
        return
    if (
        u.hostname in ["teams.microsoft.com", "teams.cloud.microsoft"]
        and "/l/message/" in u.path
    ):
        return
    if not u.hostname or any(
        x in url.lower()
        for x in [
            "cards.unsupported",
            "emoticons",
            "support.skype.com/en/faq",
            "w3.org/1998/math/",
        ]
    ):
        if kind != "emoji":
            return
    if u.hostname.endswith("safelinks.protection.outlook.com") and "url" in parse_qs(
        u.query
    ):
        url = parse_qs(u.query)["url"][0]
        u = urlsplit(url)
    table = (
        static
        if kind in ["emoji", "inline-image", "group-avatar", "card-image"]
        else links
    )
    ident = key(url)
    item = table.setdefault(
        ident, {"key": ident, "url": url, "kind": kind, "references": []}
    )
    if ref and ref not in item["references"]:
        item["references"].append(ref)
    item.update({k: v for k, v in props.items() if v is not None})
    return ident


cache = (
    read(ROOT / "raw/cache/profiles.json")
    if (ROOT / "raw/cache/profiles.json").exists()
    else {"stores": []}
)
for s in cache["stores"]:
    if s["name"] == "profiles":
        for p in s["values"]:
            person(
                p.get("mri"),
                p.get("displayName"),
                email=p.get("userPrincipalName"),
                imageUri=p.get("imageUri"),
                type=p.get("type"),
            )
conv_cache = (
    read(ROOT / "raw/cache/conversation-manager.json")
    if (ROOT / "raw/cache/conversation-manager.json").exists()
    else {"stores": []}
)
for c in next(
    (s["values"] for s in conv_cache["stores"] if s["name"] == "conversations"), []
):
    for p in (c.get("chatTitle") or {}).get("avatarUsersInfo", []):
        person(p.get("mri"), p.get("displayName"), email=p.get("email"))
source = read(ROOT / "raw/server-inventory.json")
for c in source.get("chats", []):
    for m in c.get("members", []):
        if isinstance(m, dict):
            person(m.get("mri") or m.get("id"), m.get("displayName") or m.get("name"))
for team in source.get("teams", []):
    for channel in team.get("channels", []):
        for tab in channel.get("tabs", []):
            settings = tab.get("settings") or {}
            name = unquote(tab.get("name") or "")
            record = {
                "team": team["displayName"],
                "channelId": channel["id"],
                "channel": channel["displayName"],
                "name": name,
                "id": tab["id"],
                "urls": [],
            }
            for k in ["url", "websiteUrl", "componentUrl"]:
                if settings.get(k):
                    record["urls"].append(settings[k])
                    if k == "componentUrl" or ".sharepoint.com/" in settings[k]:
                        add(
                            settings[k],
                            "channel-file",
                            {"channelId": channel["id"], "tabId": tab["id"]},
                            name=name,
                        )
            file = parse(settings.get("file"))
            if file and file.get("objectUrl"):
                record["file"] = file
                record["urls"].append(file["objectUrl"])
                add(
                    file["objectUrl"],
                    "channel-file",
                    {"channelId": channel["id"], "tabId": tab["id"]},
                    name=name,
                    baseUrl=file.get("baseUrl"),
                    itemId=file.get("objectId"),
                )
            for u in record["urls"][:]:
                q = parse_qs(urlsplit(u).query)
                if "subEntityId" in q:
                    obj = parse(q["subEntityId"][0])
                    if obj and obj.get("objectUrl"):
                        record["file"] = obj
                        record["urls"].append(obj["objectUrl"])
                        add(
                            obj["objectUrl"],
                            "channel-file",
                            {"channelId": channel["id"], "tabId": tab["id"]},
                            name=name,
                            driveId=obj.get("driveId"),
                            itemId=obj.get("docId"),
                        )
            tabs.append(record)


def walkcard(obj, ref):
    if isinstance(obj, dict):
        if obj.get("type") == "Image" and obj.get("url"):
            add(obj["url"], "card-image", ref)
        if obj.get("type") in ["Action.OpenUrl", "OpenUrl"] and obj.get("url"):
            add(obj["url"], "external-link", ref)
        for v in obj.values():
            walkcard(v, ref)
    elif isinstance(obj, list):
        for x in obj:
            walkcard(x, ref)


for folder in (ROOT / "raw/messages").glob("*"):
    if not folder.is_dir():
        continue
    for f in folder.glob("[0-9]*.json"):
        for m in read(f).get("messages", []):
            mid = str(m["id"])
            ref = {"conversationKey": folder.name, "messageId": mid}
            content = m.get("content") or ""
            person(
                m.get("from"), m.get("imdisplayname") or m.get("fromDisplayNameInToken")
            )
            for p in (parse(m.get("properties", {}).get("mentions")) or []) + (
                parse(m.get("properties", {}).get("onbehalfof")) or []
            ):
                if isinstance(p, dict):
                    person(
                        p.get("mri") or p.get("id"),
                        p.get("displayName") or p.get("name"),
                    )
            if not isinstance(content, str):
                continue
            for ident in set(re.findall(r"8:orgid:[0-9a-f-]{36}", content)):
                person(ident)
            try:
                el = etree.fromstring(
                    ("<root>" + content + "</root>").encode(),
                    etree.XMLParser(
                        recover=True, resolve_entities=False, no_network=True
                    ),
                )
                if el is not None:
                    for node in el.iter():
                        tag = str(node.tag).lower()
                        if tag in [
                            "detailedtargetinfo",
                            "detailedinitiatorinfo",
                            "part",
                            "members",
                            "member",
                        ]:
                            ident = (
                                node.get("identity")
                                or node.findtext("id")
                                or node.findtext("Id")
                            )
                            name = (
                                node.findtext("displayName")
                                or node.findtext("name")
                                or node.findtext("friendlyName")
                            )
                            person(ident, name)
            except:
                pass
            for tag in re.findall(r"<img\b[^>]*>", content, re.I):
                attrs = {
                    k.lower(): html.unescape(v)
                    for k, _, v in re.findall(
                        r'([\w:-]+)\s*=\s*(["\'])(.*?)\2', tag, re.S
                    )
                }
                if attrs.get("src"):
                    typ = (
                        "emoji"
                        if "Emoji" in attrs.get("itemtype", "")
                        else "inline-image"
                    )
                    if "/v1/objects/" not in attrs["src"]:
                        add(
                            attrs["src"],
                            typ,
                            ref,
                            alt=attrs.get("alt"),
                            emojiId=attrs.get("itemid"),
                        )
            for u in re.findall(r'(?:href|uri)\s*=\s*["\']([^"\']+)', content, re.I):
                add(u, "external-link", ref)
            if m.get("messagetype") == "ThreadActivity/PictureUpdate":
                mm = re.search(r"URL@(https?://[^<]+)", content)
                if mm:
                    add(mm[1], "group-avatar", ref)
            for u in re.findall(r"<uri>(https?://[^<]+)</uri>", content, re.I):
                add(u, "external-file", ref)
            mm = re.search(r'<Swift\s+b64="([^"]+)"', content)
            if mm:
                try:
                    data = json.loads(base64.b64decode(mm[1]))
                    cards[folder.name + "/" + mid] = data
                    walkcard(data, ref)
                except:
                    pass
for ident, p in people.items():
    p.setdefault("name", "알 수 없는 사용자")
save(ROOT / "profiles.json", list(people.values()))
save(ROOT / "channel-tabs.json", tabs)
save(ROOT / "external-assets.json", list(links.values()))
save(ROOT / "static-assets.json", list(static.values()))
save(ROOT / "adaptive-cards.json", cards)
print(
    json.dumps(
        {
            "people": len(people),
            "unknownNames": sum(
                p["name"] == "알 수 없는 사용자" for p in people.values()
            ),
            "externalLinks": len(links),
            "staticMedia": len(static),
            "cards": len(cards),
            "tabs": len(tabs),
        },
        ensure_ascii=False,
    )
)
