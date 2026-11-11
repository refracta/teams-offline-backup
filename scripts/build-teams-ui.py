import json, re, html, hashlib, base64, collections, shutil
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit, parse_qs
from html.parser import HTMLParser
from lxml import etree
from archive import ROOT, SETTINGS

APP = ROOT / "app"
APP.mkdir(exist_ok=True)


def read(p):
    return json.loads(p.read_text(encoding="utf-8"))


def write(p, s):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(s, encoding="utf-8")


def js(o):
    return json.dumps(o, ensure_ascii=False, separators=(",", ":")).replace(
        "</", "<\\/"
    )


def esc(x):
    return html.escape(str(x or ""), quote=True)


def key(x):
    return hashlib.sha256(x.encode()).hexdigest()[:24]


def fileurl(x):
    return quote(str(x), safe="/")


def identity(x):
    x = str(x or "").split("/contacts/")[-1]
    if re.fullmatch(r"[a-f0-9-]{36}", x):
        x = "8:orgid:" + x
    return x


people = {p["id"]: p for p in read(ROOT / "profiles.json")}
avatars = (
    read(ROOT / "avatar-manifest.json")
    if (ROOT / "avatar-manifest.json").exists()
    else []
)
for a in avatars:
    if a["id"] in people and a["status"] == "complete":
        people[a["id"]]["avatar"] = a["localPath"]


def person(x):
    x = identity(x)
    if not x:
        return "알 수 없는 사용자"
    return people.get(x, {}).get("name") or (
        "시스템"
        if str(x).startswith("http")
        else "알 수 없는 사용자" if re.search(r"8:|[a-f0-9]{8}-", str(x)) else str(x)
    )


states = {}
for dirname in ["file-states", "external-states"]:
    for f in (ROOT / "raw" / dirname).glob("*.json"):
        try:
            candidate = read(f)
            priority = {
                "complete": 5,
                "linked-existing": 4,
                "webpage": 3,
                "directory-index": 3,
                "browser-required": 1,
                "failed": 0,
            }
            if f.stem not in states or priority.get(
                candidate.get("status"), -1
            ) > priority.get(states[f.stem].get("status"), -1):
                states[f.stem] = candidate
        except (OSError, ValueError):
            pass
allassets = {
    a["key"]: a
    for f in [
        "all-assets.json",
        "external-assets.json",
        "static-assets.json",
        "derived-assets.json",
    ]
    if (ROOT / f).exists()
    for a in read(ROOT / f)
}
urlmap = {}
objectmap = {}
for k, s in states.items():
    if s.get("status") not in [
        "complete",
        "linked-existing",
        "directory-index",
    ] or not s.get("localPath"):
        continue
    a = allassets.get(k, {})
    for u in [s.get("sourceUrl"), a.get("url"), a.get("shareUrl")]:
        if u:
            urlmap[html.unescape(u)] = s
            if "/objects/" in u:
                objectmap[u.split("/objects/")[1].split("/")[0]] = s
local = (
    {r["key"]: r.get("candidates", []) for r in read(ROOT / "local-recovery.json")}
    if (ROOT / "local-recovery.json").exists()
    else {}
)


def lookup(u):
    u = html.unescape(u or "")
    if u in urlmap:
        return urlmap[u]
    if "/objects/" in u:
        return objectmap.get(u.split("/objects/")[1].split("/")[0])
    return None


def markdown(text):
    out = esc(text)
    out = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", out)
    out = re.sub(
        r"\[([^\]]+)\]\((https?://[^)]+)\)",
        lambda m: '<a href="'
        + esc(m[2])
        + '" target="_blank" rel="noreferrer">'
        + m[1]
        + "</a>",
        out,
    )
    return out.replace("\n", "<br>")


def internal_link(url):
    try:
        parsed = urlsplit(html.unescape(url))
        match = re.search(r"/l/message/([^/]+)/(\d+)", unquote(parsed.path))
        if (
            parsed.hostname not in ["teams.microsoft.com", "teams.cloud.microsoft"]
            or not match
        ):
            return None
        target = convkeys.get(match[1])
        return (target, match[2]) if target else None
    except ValueError:
        return None


class Clean(HTMLParser):
    allowed = {
        "p",
        "div",
        "span",
        "br",
        "b",
        "strong",
        "i",
        "em",
        "u",
        "s",
        "del",
        "blockquote",
        "code",
        "pre",
        "ul",
        "ol",
        "li",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
        "a",
        "h1",
        "h2",
        "h3",
        "h4",
        "hr",
        "img",
        "video",
        "source",
        "sup",
        "sub",
        "wbr",
        "colgroup",
        "col",
    }
    void = {"br", "hr", "img", "source", "wbr", "col"}

    def __init__(self, mentions=None, chat=None):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.suppressed = 0
        self.mentions = {
            str(x.get("itemid", i)): x for i, x in enumerate(mentions or [])
        }
        self.chat = chat

    def handle_starttag(self, t, attrs):
        if t in ["script", "style", "iframe", "object"]:
            self.suppressed += 1
            return
        if self.suppressed or t not in self.allowed:
            return
        a = dict(attrs)
        out = {}
        style = []
        if t == "a":
            href = a.get("href", "")
            st = lookup(href)
            target = internal_link(href)
            if target:
                out.update(
                    href="#chat=" + target[0] + "&message=" + target[1],
                    **{"data-chat": target[0], "data-message": target[1]},
                )
            elif st:
                out.update(href=fileurl(st["localPath"]), **{"data-file": st["key"]})
            elif urlsplit(href).scheme in ["http", "https", "mailto"]:
                out.update(href=href, target="_blank", rel="noreferrer noopener")
        if t in ["img", "video", "source"]:
            src = a.get("src", "")
            st = lookup(src)
            emoji = "Emoji" in a.get("itemtype", "")
            if not st:
                if emoji:
                    self.parts.append(
                        '<span class="emoji unicode-emoji" role="img" title="'
                        + esc(a.get("title") or a.get("alt"))
                        + '">'
                        + esc(a.get("alt") or "🙂")
                        + "</span>"
                    )
                elif t == "img":
                    self.parts.append(
                        '<span class="unavailable-media">이미지 원본을 가져오지 못했습니다</span>'
                    )
                return
            out["src"] = fileurl(st["localPath"])
            if t == "img":
                out.update(
                    alt=a.get("alt") or "",
                    loading="lazy",
                    **{
                        "class": (
                            "emoji" + (" jumbo" if "58px" in a.get("style", "") else "")
                            if emoji
                            else "inline-image"
                        ),
                        "data-file": st["key"],
                    },
                )
            if t == "video":
                out.update(controls="", preload="metadata")
        for k in ["colspan", "rowspan"]:
            if a.get(k, "").isdigit():
                out[k] = a[k]
        for match in re.finditer(
            r"(text-align|color|background-color)\s*:\s*([^;]+)",
            a.get("style", ""),
            re.I,
        ):
            if re.fullmatch(r"[\w#(),.% -]+", match[2]):
                style.append(match[1] + ":" + match[2])
        if style:
            out["style"] = ";".join(style)
        if a.get("itemtype", "").endswith("Mention"):
            mention = self.mentions.get(str(a.get("itemid", "")), {})
            target = identity(mention.get("mri") or mention.get("id"))
            out.update(
                {
                    "class": "mention",
                    "data-mention": target,
                    "role": "button",
                    "tabindex": "0",
                    "title": "관련 대화로 이동",
                }
            )
        if (
            t == "blockquote"
            and a.get("itemtype", "").endswith(("Reply", "Quote"))
            and a.get("itemid", "").isdigit()
        ):
            out.update(
                {
                    "class": "reply-quote",
                    "data-jump": a["itemid"],
                    "data-jump-chat": self.chat or "",
                    "role": "button",
                    "tabindex": "0",
                    "title": "원본 메시지로 이동",
                }
            )
        if a.get("title"):
            out["title"] = a["title"]
        self.parts.append(
            "<"
            + t
            + "".join(" " + k + '="' + esc(v) + '"' for k, v in out.items())
            + ">"
        )

    def handle_endtag(self, t):
        if t in ["script", "style", "iframe", "object"]:
            self.suppressed = max(0, self.suppressed - 1)
            return
        if not self.suppressed and t in self.allowed and t not in self.void:
            self.parts.append("</" + t + ">")

    def handle_data(self, s):
        if not self.suppressed:
            self.parts.append(esc(s))


def clean(s, mentions=None, chat=None):
    def math_annotation(match):
        annotation = re.search(
            r'<annotation\b[^>]*encoding=["\x27]application/x-tex["\x27][^>]*>([\s\S]*?)</annotation>',
            match[0],
            re.I,
        )
        if not annotation:
            return match[0]
        delimiter = (
            "$$" if re.search(r'display\s*=\s*["\x27]block', match[0], re.I) else "$"
        )
        return esc(delimiter + html.unescape(annotation[1]) + delimiter)

    s = re.sub(r"<math\b[\s\S]*?</math>", math_annotation, s, flags=re.I)
    c = Clean(mentions, chat)
    try:
        c.feed(s)
        return "".join(c.parts)
    except:
        return esc(s)


def adaptive(obj):
    if isinstance(obj, list):
        return "".join(adaptive(x) for x in obj)
    if not isinstance(obj, dict):
        return ""
    typ = obj.get("type", "")
    if typ == "TextBlock":
        return (
            '<div class="card-text '
            + ("bold" if obj.get("weight") == "bolder" else "")
            + '">'
            + markdown(obj.get("text", ""))
            + "</div>"
        )
    if typ == "RichTextBlock":
        return (
            "<div>"
            + "".join(
                markdown(x.get("text", ""))
                for x in obj.get("inlines", [])
                if isinstance(x, dict)
            )
            + "</div>"
        )
    if typ == "Image":
        st = lookup(obj.get("url"))
        return (
            '<img class="card-image" loading="lazy" src="'
            + fileurl(st["localPath"])
            + '" alt="'
            + esc(obj.get("altText", ""))
            + '">'
            if st
            else ""
        )
    if typ == "FactSet":
        return (
            '<dl class="facts">'
            + "".join(
                "<dt>"
                + esc(f.get("title"))
                + "</dt><dd>"
                + markdown(f.get("value", ""))
                + "</dd>"
                for f in obj.get("facts", [])
            )
            + "</dl>"
        )
    if typ == "Action.OpenUrl":
        st = lookup(obj.get("url"))
        u = fileurl(st["localPath"]) if st else obj.get("url", "")
        u = u if st or urlsplit(u).scheme in ["http", "https", "mailto"] else "#"
        return (
            '<a class="card-action" href="'
            + esc(u)
            + '" '
            + (
                'data-file="' + st["key"] + '"'
                if st
                else 'target="_blank" rel="noreferrer"'
            )
            + ">"
            + esc(obj.get("title") or "열기")
            + "</a>"
        )
    if typ.startswith("Action."):
        return (
            '<span class="card-action archived-action">'
            + esc(obj.get("title") or "보관된 카드")
            + "</span>"
        )
    if typ.startswith("Input."):
        return (
            '<div class="archived-input">'
            + esc(
                obj.get("label")
                or obj.get("title")
                or obj.get("value")
                or obj.get("placeholder")
                or "입력 항목"
            )
            + "</div>"
        )
    body = "".join(
        adaptive(obj[k])
        for k in [
            "attachments",
            "content",
            "body",
            "items",
            "columns",
            "actions",
            "card",
        ]
        if k in obj
    )
    if typ == "ColumnSet":
        return '<div class="card-columns">' + body + "</div>"
    if typ == "Column":
        return '<div class="card-column">' + body + "</div>"
    if typ == "AdaptiveCard":
        return '<div class="adaptive-card">' + body + "</div>"
    return body


def system(m):
    typ = m.get("type", "")
    s = m["content"]
    info = {}
    root = None
    try:
        info = json.loads(s)
    except:
        try:
            root = etree.fromstring(
                s.encode(),
                etree.XMLParser(recover=True, resolve_entities=False, no_network=True),
            )
        except:
            pass

    def val(tag):
        if root is not None:
            e = root.find(".//" + tag)
            if e is not None:
                return "".join(e.itertext())
        return str(info.get(tag, "") or "")

    actor = person(val("initiator") or info.get("user") or info.get("userId"))
    targets = []
    if root is not None:
        for e in root.findall(".//target"):
            ids = re.findall(r"(?:8:orgid:|28:)[0-9a-f-]{36}", "".join(e.itertext()))
            targets.extend(ids)
    targets = list(dict.fromkeys(targets))
    targettext = ", ".join(dict.fromkeys(person(x) for x in targets)) or "사용자"
    subtype = typ.split("/")[-1]
    templates = {
        "AddMember": f"{actor} 님이 {targettext} 님을 추가했습니다.",
        "DeleteMember": (
            f"{targettext} 님이 대화에서 나갔습니다."
            if targets and val("initiator") in targets
            else f"{actor} 님이 {targettext} 님을 대화에서 제거했습니다."
        ),
        "TopicUpdate": f'{actor} 님이 대화 이름을 “{val("value")}”(으)로 변경했습니다.',
        "PictureUpdate": f"{actor} 님이 대화 사진을 변경했습니다.",
        "RoleUpdate": f"{actor} 님이 {targettext} 님의 역할을 변경했습니다.",
        "AddCustomApp": f'{actor} 님이 {val("targetName") or "앱"}을 추가했습니다.',
        "DeleteCustomApp": f'{actor} 님이 {val("targetName") or "앱"}을 제거했습니다.',
        "UpgradeCustomApp": f'{actor} 님이 {val("targetName") or "앱"}을 업데이트했습니다.',
        "FileAdd": f"{actor} 님이 파일을 추가했습니다.",
        "TopicDescriptionUpdated": f"{actor} 님이 채널 설명을 변경했습니다.",
        "TopicDeleted": f'{actor} 님이 “{info.get("topic", "채널")}”을 삭제했습니다.',
        "JoiningEnabledUpdate": f"{actor} 님이 대화 참가 설정을 변경했습니다.",
        "UpdateFavDefault": "채널 표시 설정이 변경되었습니다.",
        "SharedInSpacesUpdated": "채널 공유 설정이 변경되었습니다.",
        "ModalityUpdate": "채널의 게시물 표시 방식이 변경되었습니다.",
    }
    if subtype == "PinnedItemsUpdate":
        return f"{actor} 님이 메시지를 " + (
            "고정했습니다."
            if info.get("operation") == "pinned"
            else "고정 해제했습니다."
        )
    if subtype == "MemberJoined":
        return (
            ", ".join(
                x.get("friendlyname") or person(x.get("id"))
                for x in info.get("members", [])
            )
            + " 님이 참가했습니다."
        )
    if subtype in ["SpaceThreadChannelAdded", "SpaceThreadChannelDeleted"]:
        try:
            before = json.loads(info.get("oldValue") or "[]")
            after = json.loads(info.get("newValue") or "[]")
            changed = (
                [x["name"] for x in after if x["id"] not in {a["id"] for a in before}]
                if subtype.endswith("Added")
                else [
                    x["name"] for x in before if x["id"] not in {a["id"] for a in after}
                ]
            )
        except:
            changed = []
        return ("“" + ", ".join(changed) + "” " if changed else "") + (
            "채널이 추가되었습니다."
            if subtype.endswith("Added")
            else "채널이 삭제되었습니다."
        )
    if typ == "Event/Call":
        duration = val("duration")
        label = (
            "통화가 종료되었습니다."
            if "<ended" in s or "ended" in s.lower() or duration
            else "통화 기록"
        )
        try:
            n = int(duration)
            label += (
                " · "
                + (str(n // 3600) + "시간 " if n >= 3600 else "")
                + (str(n // 60 % 60) + "분 " if n >= 60 else "")
                + str(n % 60)
                + "초"
            )
        except:
            pass
        return label
    return templates.get(subtype, "대화 설정이 변경되었습니다.")


cards = read(ROOT / "adaptive-cards.json")
convs = read(ROOT / "conversations.json")
convkeys = {c["id"]: c["key"] for c in convs}
cache = (
    read(ROOT / "raw/cache/conversation-manager.json")
    if (ROOT / "raw/cache/conversation-manager.json").exists()
    else {"stores": []}
)
cached = {
    x["id"]: x
    for x in next(
        (s["values"] for s in cache["stores"] if s["name"] == "conversations"), []
    )
}
search = []
systemcount = 0
richcount = 0
for c in convs:
    raw = read(ROOT / "conversations" / (c["key"] + ".json"))
    messages = []
    for m in raw["messages"]:
        typ = m.get("type") or ""
        event = typ.startswith("ThreadActivity/") or typ == "Event/Call"
        body = ""
        author = m.get("author") or person(m.get("authorId"))
        authorId = identity(m.get("authorId"))
        if event:
            body = esc(system(m))
            systemcount += 1
            author = "시스템"
        elif c["key"] + "/" + m["id"] in cards:
            body = adaptive(cards[c["key"] + "/" + m["id"]])
            richcount += 1
        elif typ in ["RichText/Media_CallRecording", "RichText/Media_CallTranscript"]:
            title = re.search(r"<Title>(.*?)</Title>", m["content"], re.S)
            body = (
                '<div class="recording-card"><b>'
                + ("모임 녹화" if typ.endswith("Recording") else "모임 대화 내용")
                + "</b><p>"
                + esc(html.unescape(title[1]) if title else "")
                + "</p></div>"
            )
        else:
            body = (
                "<p>" + esc(m["content"]).replace("\n", "<br>") + "</p>"
                if typ == "Text"
                else clean(m["content"], m.get("mentions"), c["key"])
            )
        if author.startswith("http") or re.match(r"^8:orgid:", author):
            author = person(m.get("authorId"))
        if (
            not event
            and authorId in people
            and people[authorId]["name"] != "알 수 없는 사용자"
        ):
            author = people[authorId]["name"]
        text = html.unescape(re.sub("<[^>]*>", " ", body))
        record = {
            "id": m["id"],
            "time": m["createdAt"],
            "author": author,
            "authorId": authorId,
            "html": body,
            "text": text,
            "system": event,
            "files": m.get("files", []),
            "replyTo": m.get("parentMessageId"),
            "subject": m.get("subject"),
            "edited": bool(m.get("modifiedAt")),
            "reactions": m.get("reactions"),
            "type": typ,
        }
        if event or re.search(r"\\(?:begin|frac)|annotation|\$[^$]+\$", m["content"]):
            record["original"] = m["content"]
        messages.append(record)
        if not event:
            search.append([c["title"], author, m["createdAt"], text, c["key"], m["id"]])
    c["participantIds"] = sorted({m["authorId"] for m in messages if m["authorId"]})
    c["lastPreview"] = next(
        (m["text"][:110] for m in reversed(messages) if not m["system"]),
        messages[-1]["text"][:110] if messages else "",
    )
    item = cached.get(c["id"], {})
    c["members"] = (item.get("chatTitle") or {}).get("avatarUsersInfo", [])
    for picture in reversed(raw["messages"]):
        if picture.get("type") != "ThreadActivity/PictureUpdate":
            continue
        match = re.search(r"URL@(https?://[^<]+)", picture["content"])
        if match:
            st = lookup(match[1])
            if st:
                c["avatar"] = st["localPath"]
                break
    write(
        APP / "chats" / (c["key"] + ".js"),
        "window.__teamsBackupChat("
        + js(c["key"])
        + ","
        + js({"meta": c, "messages": messages})
        + ");",
    )
files = {}
for k, a in allassets.items():
    s = states.get(k, {})
    status = s.get("status", "pending")
    entry = {
        "key": k,
        "name": s.get("name")
        or a.get("name")
        or a.get("alt")
        or unquote(urlsplit(a["url"]).path.split("/")[-1]),
        "kind": a["kind"],
        "status": status,
        "sourceUrl": a["url"],
    }
    for prop in [
        "localPath",
        "bytes",
        "contentType",
        "httpStatus",
        "error",
        "contentRole",
        "lastAttempt",
    ]:
        if prop in s:
            entry[prop] = s[prop]
    if a.get("emojiId"):
        entry["emojiId"] = a["emojiId"]
    if k in local:
        entry["localCopies"] = [
            {"path": x["localPath"], "bytes": x["bytes"]}
            for x in local[k]
            if x.get("localPath")
        ]
    files[k] = entry
tabs = read(ROOT / "channel-tabs.json")
sheetmap = read(ROOT / "sheet-map.json") if (ROOT / "sheet-map.json").exists() else {}
pages = (
    {x["tabId"]: x for x in read(ROOT / "channel-page-snapshots.json")}
    if (ROOT / "channel-page-snapshots.json").exists()
    else {}
)
for tab in tabs:
    if tab["id"] in pages:
        tab["snapshot"] = pages[tab["id"]]
    info = tab.get("file") or {}
    wanted = [
        str(info.get(k) or "").strip("{}").lower()
        for k in ["docId", "objectId", "fileId"]
    ]
    for k, a in allassets.items():
        ids = [str(a.get("itemId") or "").strip("{}").lower()] + [
            v.strip("{}").lower()
            for v in parse_qs(urlsplit(a["url"]).query).get("sourcedoc", [])
        ]
        if any(x and x in ids for x in wanted) and states.get(k, {}).get("status") in [
            "complete",
            "linked-existing",
        ]:
            st = states[k]
            tab["fileKey"] = k
            tab["localPath"] = st["localPath"]
            tab["sheetKey"] = sheetmap.get(st["localPath"])
            break
    for u in tab["urls"]:
        if tab.get("fileKey"):
            break
        st = lookup(u)
        if st:
            tab["fileKey"] = st["key"]
            tab["localPath"] = st["localPath"]
            tab["sheetKey"] = sheetmap.get(st["localPath"])
            break
    for u in tab["urls"]:
        if tab.get("fileKey"):
            break
        normalized = re.sub(r"^/:fl:/r", "", unquote(urlsplit(u).path).lower())
        for k, f in files.items():
            if (
                f.get("status") == "complete"
                and re.sub(
                    r"^/:fl:/r", "", unquote(urlsplit(f["sourceUrl"]).path).lower()
                )
                == normalized
            ):
                tab["fileKey"] = k
                tab["localPath"] = f["localPath"]
                tab["sheetKey"] = sheetmap.get(f["localPath"])
                break
for f in files.values():
    if f.get("localPath") in sheetmap:
        f["sheetKey"] = sheetmap[f["localPath"]]
for c in convs:
    c["fileKeys"] = [
        k
        for k, a in allassets.items()
        if any(
            r.get("conversationKey") == c["key"] or r.get("channelId") == c["id"]
            for r in a.get("references", [])
        )
    ]
metrics = {
    "conversations": len(convs),
    "messages": sum(c["messageCount"] for c in convs),
    "systemMessages": systemcount,
    "adaptiveCards": richcount,
    "fileReferences": len(files),
    "filesDownloaded": sum(
        f["status"] in ["complete", "linked-existing"] for f in files.values()
    ),
    "filesUnavailable": sum(
        f["status"] in ["failed", "browser-required"] for f in files.values()
    ),
    "avatars": sum("avatar" in p for p in people.values()),
}
data = {
    "selfId": SETTINGS.get("selfId", ""),
    "selfName": SETTINGS.get("selfName", ""),
    "synthetic": SETTINGS.get("synthetic", False),
    "snapshotTime": SETTINGS["snapshotTime"],
    "conversations": convs,
    "profiles": people,
    "files": files,
    "tabs": tabs,
    "metrics": metrics,
}
write(APP / "data.js", "window.TEAMS_BACKUP=" + js(data) + ";")
write(APP / "search.js", "window.TEAMS_SEARCH=" + js(search) + ";")
write(ROOT / "ui-build-summary.json", json.dumps(metrics, ensure_ascii=False, indent=2))
print(json.dumps(metrics, ensure_ascii=False))
for src, dest in [
    ("index.html", ROOT / "index.html"),
    ("app.js", APP / "app.js"),
    ("app.css", APP / "app.css"),
]:
    shutil.copy2(Path(__file__).parent.parent / "viewer" / src, dest)
