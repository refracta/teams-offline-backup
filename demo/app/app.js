"use strict";
const D = window.TEAMS_BACKUP;
const $ = (s) => document.querySelector(s);
const esc = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const pathUrl = (p) => String(p).split("/").map(encodeURIComponent).join("/");
function externalUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:", "mailto:"].includes(url.protocol)
      ? url.href
      : "#";
  } catch {
    return "#";
  }
}
function richTitle(value) {
  return esc(value).replace(
    /(?:\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*|\p{Regional_Indicator}{2})/gu,
    (x) => '<span class="native-emoji">' + x + "</span>",
  );
}
const icons = {
  chat: "M4 4h16v12H9l-5 4V4z M8 8h8 M8 12h5",
  people:
    "M8 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M17 11a2.5 2.5 0 1 0 0-5 M2 20v-3a6 6 0 0 1 12 0v3H2z M17 14a5 5 0 0 1 5 5v1h-5",
  file: "M5 2h9l5 5v15H5V2z M14 2v6h5 M8 12h8 M8 16h8",
  sheet: "M3 3h18v18H3V3z M3 8h18 M8 8v13 M14 8v13 M3 14h18",
  search: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M15 15l6 6",
  archive: "M3 3h18v5H3V3z M5 8v13h14V8 M9 12h6",
  download: "M12 3v12 M7 10l5 5 5-5 M4 17v4h16v-4",
  more: "M5 12h.01 M12 12h.01 M19 12h.01",
  calendar: "M4 5h16v16H4V5z M4 10h16 M8 3v4 M16 3v4",
  arrow: "M15 5l-7 7 7 7",
  lock: "M6 10h12v11H6V10z M8 10V6a4 4 0 0 1 8 0v4",
  link: "M10 14l4-4 M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0 M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0",
};
const icon = (n) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[n] || icons.file}"></path></svg>`;
document
  .querySelectorAll("[data-icon]")
  .forEach((e) => (e.innerHTML = icon(e.dataset.icon)));
const chats = new Map(),
  sheets = new Map(),
  pending = new Map();
let listLimit = 30;
let activeChat = null,
  activeKind = "all",
  listFilter = "",
  messageStart = 0,
  messageEnd = 0,
  currentView = "chat",
  routeVersion = 0;
const ordered = [...D.conversations].sort((a, b) =>
  (b.latest || "").localeCompare(a.latest || ""),
);
const convMap = new Map(D.conversations.map((c) => [c.key, c]));
window.__teamsBackupChat = (key, data) => {
  chats.set(key, data);
  pending.get("chat:" + key)?.resolve(data);
  pending.delete("chat:" + key);
};
window.__teamsBackupSheet = (key, data) => {
  sheets.set(key, data);
  pending.get("sheet:" + key)?.resolve(data);
  pending.delete("sheet:" + key);
};
function script(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error("보관 파일을 열 수 없습니다: " + src));
    document.body.append(el);
  });
}
function load(kind, key) {
  const cache = kind === "chat" ? chats : sheets;
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (pending.has(kind + ":" + key))
    return pending.get(kind + ":" + key).promise;
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  pending.set(kind + ":" + key, { resolve, reject, promise });
  script(
    "app/" +
      (kind === "chat" ? "chats" : "sheets") +
      "/" +
      encodeURIComponent(key) +
      ".js",
  ).catch(reject);
  return promise;
}
const partFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h23",
});
const weekdays = {
  Sun: "일요일",
  Mon: "월요일",
  Tue: "화요일",
  Wed: "수요일",
  Thu: "목요일",
  Fri: "금요일",
  Sat: "토요일",
};
function parts(value) {
  const dt = new Date(
    String(value || "").replace(/(\.\d{3})\d+(Z|[+-]\d\d:\d\d)$/, "$1$2"),
  );
  if (!Number.isFinite(+dt)) return null;
  const p = Object.fromEntries(
    partFormatter.formatToParts(dt).map((v) => [v.type, v.value]),
  );
  return {
    ...p,
    year: +p.year,
    month: +p.month,
    day: +p.day,
    hour: +p.hour,
    dayNumber: Date.UTC(+p.year, +p.month - 1, +p.day) / 86400000,
  };
}
const snapshot = parts(D.snapshotTime) || parts("2000-01-01T00:00:00Z");
$(".sidebar-foot").textContent = dayLabel(D.snapshotTime) + " 보관 · KST";
if (D.synthetic) {
  $(".offline-badge").lastChild.textContent = "가상 데이터 데모";
  document.title = "가상 데이터 데모 · Teams Offline Backup";
}
function kst(value, full = false) {
  const p = parts(value);
  if (!p) return "";
  const time = `${p.hour < 12 ? "오전" : "오후"} ${p.hour % 12 || 12}:${p.minute}`;
  if (full)
    return `${p.year}년 ${p.month}월 ${p.day}일 ${weekdays[p.weekday]} ${time}`;
  const diff = snapshot.dayNumber - p.dayNumber;
  if (diff === 0) return time;
  if (diff === 1) return "어제 " + time;
  if (diff > 1 && diff <= 7) return weekdays[p.weekday] + " " + time;
  return (
    (p.year === snapshot.year ? "" : p.year + "-") +
    p.month +
    "-" +
    p.day +
    " " +
    time
  );
}
function dayLabel(value) {
  const p = parts(value);
  return p ? `${p.year}년 ${p.month}월 ${p.day}일 ${weekdays[p.weekday]}` : "";
}
function shortDate(value) {
  const p = parts(value);
  return p
    ? (p.year === snapshot.year ? "" : p.year + ". ") +
        p.month +
        ". " +
        p.day +
        "."
    : "";
}
window.TeamsArchive = { kst, parts };
function bytes(n) {
  if (!Number.isFinite(n)) return "";
  if (n < 1024) return n + " B";
  const k = Math.min(4, Math.floor(Math.log(n) / Math.log(1024)));
  return (
    (n / 1024 ** k).toFixed(k === 1 ? 0 : 1) +
    " " +
    ["B", "KB", "MB", "GB", "TB"][k]
  );
}
function avatar(id, name, cls = "") {
  const p = D.profiles[id] || {};
  return `<span class="avatar ${cls}" title="${esc(name || p.name || "사용자")}">${p.avatar ? `<img src="${pathUrl(p.avatar)}" alt="${esc(name || p.name)}" loading="lazy">` : esc((name || p.name || "?").replace(/\s/g, "").slice(0, 2))}</span>`;
}
function convAvatar(c) {
  if (c.avatar)
    return `<span class="avatar group"><img src="${pathUrl(c.avatar)}" alt="${esc(c.title)}" loading="lazy"></span>`;
  if (c.kind === "channel")
    return `<span class="avatar group">${icon("people")}</span>`;
  const members = (c.members || []).filter((p) => (p.mri || p.id) !== D.selfId);
  if (members.length === 1)
    return avatar(
      members[0].mri || members[0].id,
      members[0].displayName || c.title,
    );
  if (members.length > 1)
    return (
      '<span class="avatar-group">' +
      members
        .slice(0, 2)
        .map((p) => avatar(p.mri || p.id, p.displayName))
        .join("") +
      "</span>"
    );
  return `<span class="avatar ${c.kind === "meeting" ? "group" : ""}">${c.kind === "meeting" ? icon("calendar") : esc(c.title.slice(0, 2))}</span>`;
}
$("#self-avatar").innerHTML = avatar(
  D.selfId,
  D.selfName || D.profiles[D.selfId]?.name || "나",
  "self",
);
function setRail(view) {
  document
    .querySelectorAll(".rail-item")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $("#sidebar-heading").textContent =
    view === "channel" ? "팀 및 채널" : "채팅";
}
function renderList() {
  const filtered = ordered.filter(
    (c) =>
      (activeKind === "all" ||
        c.kind === activeKind ||
        (activeKind === "meeting" && c.chatType === "meeting")) &&
      (!listFilter || c.title.toLowerCase().includes(listFilter)),
  );
  const shown = listFilter ? filtered : filtered.slice(0, listLimit);
  const selected = filtered.find((c) => c.key === activeChat);
  if (selected && !shown.includes(selected)) shown.push(selected);
  const previousTop = $("#chat-list").scrollTop;
  $("#chat-list").innerHTML =
    '<div class="list-label"><span>' +
    ({ all: "최근 대화", chat: "채팅", channel: "팀 및 채널", meeting: "모임" }[
      activeKind
    ] || "대화") +
    "</span><span>" +
    shown.length +
    " / " +
    filtered.length +
    "</span></div>" +
    shown
      .map(
        (c) =>
          `<button class="chat-row ${c.key === activeChat ? "selected" : ""}" data-chat="${c.key}" role="listitem" title="${esc(c.title)}">${convAvatar(c)}<span class="chat-row-text"><span class="chat-row-line"><span class="chat-name">${richTitle(c.title)}</span><span class="chat-time">${shortDate(c.latest)}</span></span><span class="chat-preview">${esc(c.lastPreview || "보관된 대화")}</span></span></button>`,
      )
      .join("") +
    (!listFilter && filtered.length > listLimit
      ? '<button class="list-more" data-action="more-chats">이전 대화 ' +
        Math.min(30, filtered.length - listLimit) +
        "개 더 보기</button>"
      : "");
  $("#chat-list").scrollTop = previousTop;
  document
    .querySelectorAll("[data-filter]")
    .forEach((b) =>
      b.classList.toggle("selected", b.dataset.filter === activeKind),
    );
}
function goMention(id, name) {
  const channel = D.conversations.find((c) => c.id === id);
  if (channel) {
    nav({ chat: channel.key });
    return;
  }
  const direct = ordered.find(
    (c) =>
      c.kind === "chat" &&
      c.chatType !== "meeting" &&
      (c.members || []).filter((m) => (m.mri || m.id) !== D.selfId).length ===
        1 &&
      (c.members || []).some((m) => (m.mri || m.id) === id),
  );
  if (direct) {
    nav({ chat: direct.key });
    return;
  }
  const person = D.profiles[id],
    label = person?.name || name || "사용자";
  const related = ordered.filter(
    (c) =>
      (c.participantIds || []).includes(id) ||
      (c.members || []).some((m) => (m.mri || m.id) === id),
  );
  openMedia(
    '<div class="person-heading">' +
      avatar(id, label) +
      "<h3>" +
      esc(label) +
      '</h3></div><p class="panel-note">이 사용자가 참여한 보관 대화입니다.</p>' +
      (related.length
        ? related
            .map(
              (c) =>
                '<button class="chat-row" data-chat="' +
                c.key +
                '">' +
                convAvatar(c) +
                '<span class="chat-name">' +
                richTitle(c.title) +
                "</span></button>",
            )
            .join("")
        : "<p>이 사용자의 대화가 백업에 없습니다.</p>"),
  );
}
let autoRunning = false,
  autoFrame = 0,
  autoLast = 0,
  historyLoading = false;
function updateAutoButton() {
  const b = $('[data-action="auto-up"]');
  if (b) {
    b.textContent = autoRunning ? "Ⅱ 중지" : "↑ 자동 스크롤";
    b.setAttribute("aria-pressed", String(autoRunning));
    b.classList.toggle("running", autoRunning);
  }
}
function stopAutoScroll() {
  autoRunning = false;
  cancelAnimationFrame(autoFrame);
  autoFrame = 0;
  updateAutoButton();
}
function loadOlder() {
  if (historyLoading || messageStart <= 0 || !$("#content .message-list"))
    return false;
  historyLoading = true;
  messageStart = Math.max(0, messageStart - 100);
  messageEnd = Math.min(messageEnd, messageStart + 500);
  renderMessages(null, true);
  requestAnimationFrame(() => {
    historyLoading = false;
  });
  return true;
}
function startAutoScroll() {
  if (!$("#content .message-list")) return;
  autoRunning = true;
  autoLast = performance.now();
  updateAutoButton();
  const step = (now) => {
    if (!autoRunning) return;
    const content = $("#content"),
      speed = Number($("#auto-scroll-speed")?.value || 80);
    const delta = Math.min(100, now - autoLast);
    autoLast = now;
    if (!historyLoading) {
      if (content.scrollTop <= 2) {
        if (!loadOlder()) {
          stopAutoScroll();
          toast("대화의 처음입니다.");
          return;
        }
      } else
        content.scrollTop = Math.max(
          0,
          content.scrollTop - (speed * delta) / 1000,
        );
    }
    if (autoRunning) autoFrame = requestAnimationFrame(step);
  };
  autoFrame = requestAnimationFrame(step);
}
$("#content").addEventListener(
  "scroll",
  () => {
    if (
      currentView === "chat" &&
      $("#content").scrollTop < 80 &&
      messageStart > 0
    )
      loadOlder();
  },
  { passive: true },
);
for (const event of ["wheel", "touchstart", "pointerdown"])
  $("#content").addEventListener(event, stopAutoScroll, { passive: true });
document.addEventListener("keydown", (e) => {
  if (
    [
      "ArrowUp",
      "ArrowDown",
      "PageUp",
      "PageDown",
      "Home",
      "End",
      "Escape",
    ].includes(e.key)
  )
    stopAutoScroll();
  if (
    (e.key === "Enter" || e.key === " ") &&
    e.target.matches(".mention,.reply-quote")
  ) {
    e.preventDefault();
    e.target.click();
  }
});
function header(title, subtitle, avatarHtml = "") {
  const name = typeof title === "object" ? title.title : title;
  $("#conversation-head").innerHTML =
    `<button class="mobile-chat-menu" data-action="mobile-list" aria-label="대화 목록">${icon("chat")}</button>${avatarHtml}<div><h2>${richTitle(name)}</h2><div class="subtitle">${esc(subtitle || "")}</div></div><div class="head-actions"><span class="read-badge">읽기 전용</span><button data-action="search-focus" aria-label="검색">${icon("search")}</button></div>`;
}
function chatHeader(c, tab = "chat") {
  header(
    c,
    `${c.kind === "channel" ? "팀 채널" : c.chatType === "meeting" ? "모임 대화" : "채팅"} · 메시지 ${c.messageCount.toLocaleString()}개`,
    convAvatar(c),
  );
  const tabs = D.tabs.filter((t) => t.channelId === c.id);
  $("#conversation-tabs").innerHTML = [
    ["chat", "채팅"],
    ["files", "공유됨"],
    ...tabs.map((t) => [t.id, t.name]),
  ]
    .map(
      ([key, name]) =>
        `<button class="${tab === key ? "active" : ""}" data-tab="${esc(key)}">${esc(name)}</button>`,
    )
    .join("");
  $("#conversation-foot").innerHTML =
    icon("lock") +
    "계정 없이 열람할 수 있는 백업입니다. 날짜와 시간은 한국 표준시(KST)로 표시됩니다.";
  if (tab === "chat")
    $(".head-actions").insertAdjacentHTML(
      "afterbegin",
      '<button class="auto-scroll-button" data-action="auto-up" aria-pressed="false" title="과거 메시지 방향으로 자동 스크롤">↑ 자동 스크롤</button><select id="auto-scroll-speed" aria-label="자동 스크롤 속도"><option value="35">느리게</option><option value="80" selected>보통</option><option value="200">빠르게</option><option value="600">아주 빠르게</option></select>',
    );
}
function nav(params) {
  location.hash = new URLSearchParams(params).toString();
}
function toast(message) {
  const t = $("#toast");
  t.textContent = message;
  t.classList.add("visible");
  setTimeout(() => t.classList.remove("visible"), 3500);
}
const reactionEmoji = {
  like: "👍",
  heart: "❤️",
  laugh: "😆",
  surprised: "😮",
  sad: "😢",
  angry: "😠",
  applause: "👏",
  checkmark: "✅",
  yes: "👍",
  smile: "🙂",
  party: "🥳",
  bow: "🙇",
  thankyou: "🙏",
  star: "⭐",
  celebrate: "🎉",
  eyes: "👀",
  rofl: "🤣",
  cool: "😎",
};
const emojiFiles = Object.fromEntries(
  Object.values(D.files)
    .filter((f) => f.kind === "emoji" && f.localPath && f.emojiId)
    .map((f) => [f.emojiId, f]),
);
function reactionHtml(reactions) {
  if (!Array.isArray(reactions)) return "";
  return (
    '<div class="reactions">' +
    reactions
      .map((r) => {
        const users = r.users || [];
        const pic = emojiFiles[r.key];
        const names = users.map((x) => D.profiles[x.mri]?.name || "사용자");
        return `<span class="reaction" title="${esc(names.join(", "))}">${pic ? `<img class="emoji" src="${pathUrl(pic.localPath)}" alt="${esc(r.key)}">` : '<span class="native-emoji">' + esc(reactionEmoji[r.key] || r.key) + "</span>"}<span>${users.length || r.count || 1}</span></span>`;
      })
      .join("") +
    "</div>"
  );
}
function fileCard(f) {
  if (!f) return "";
  const ext = (f.name || "").split(".").pop().toLowerCase();
  const local =
    f.localPath &&
    ["complete", "linked-existing", "webpage", "directory-index"].includes(
      f.status,
    );
  const type = `<span class="file-type ${/^[a-z0-9]{1,6}$/.test(ext) ? ext : ""}">${esc(ext.length < 7 ? ext.toUpperCase() : "FILE")}</span>`;
  const sub = local
    ? bytes(f.bytes) +
      (f.lastAttempt && f.lastAttempt.status !== "complete"
        ? " · 이전 저장본 (최근 갱신 실패)"
        : f.status === "directory-index"
          ? " · 폴더 목록만 보관"
          : f.status === "webpage"
            ? " · 웹페이지 저장본"
            : f.contentRole === "folder-archive-index"
              ? " · 폴더 원본 ZIP 보기"
              : f.contentRole === "user-import"
                ? " · 직접 가져온 사본 (원격 버전 미확인)"
                : f.contentRole === "recording-thumbnail"
                  ? " · 녹화 미리보기 이미지"
                  : f.sheetKey
                    ? " · 시트 열기"
                    : " · 저장된 원본")
    : f.status === "pending"
      ? "수집 대기"
      : ["link-only", "folder-link", "action-link"].includes(f.status)
        ? "주소만 보관"
        : f.httpStatus === 404
          ? "원본을 찾을 수 없음"
          : f.httpStatus === 403
            ? "원본 접근 권한 없음"
            : "원본을 가져오지 못함";
  const inner = `${type}<span class="file-card-info"><span class="file-card-name">${esc(f.name || "첨부 파일")}</span><span class="file-card-sub">${esc(sub)}</span></span>${local ? icon("download") : ""}`;
  return (
    (local
      ? `<a class="file-card" href="${pathUrl(f.localPath)}" data-file="${f.key}" target="_blank" rel="noreferrer">${inner}</a>`
      : `<div class="file-card file-missing">${inner}<button data-file-details="${f.key}">상세</button></div>`) +
    (f.localCopies?.length
      ? `<div class="local-copy">PC에서 찾은 같은 이름의 파일 · 원격 원본과 버전 일치 여부 미확인${f.localCopies.map((x, i) => `<a href="${pathUrl(x.path)}" target="_blank" rel="noreferrer">사본 ${i + 1} 열기 (${bytes(x.bytes)})</a>`).join("")}</div>`
      : "")
  );
}
function messageHtml(m, all) {
  if (m.system)
    return `<div class="system-message" id="m${esc(m.id)}"><div>${m.html}</div><time title="${kst(m.time, true)}">${kst(m.time)}</time>${m.original ? `<button class="raw-toggle" data-original="${esc(m.id)}">원본 기록</button>` : ""}</div>`;
  const original = m.replyTo && m.replyTo !== m.id ? all.get(m.replyTo) : null;
  const used = new Set(
    [...m.html.matchAll(/data-file="([^"]+)"/g)].map((x) => x[1]),
  );
  const attachments = [...new Set(m.files || [])].filter((k) => !used.has(k));
  return `<article class="message ${m.authorId === D.selfId ? "own" : ""}" id="m${esc(m.id)}">${avatar(m.authorId, m.author)}<div class="message-body"><div class="message-meta"><span class="author">${esc(m.author)}</span><time title="${kst(m.time, true)}">${kst(m.time)}</time>${m.edited ? '<span title="수정된 메시지">수정됨</span>' : ""}</div><div class="bubble">${original ? `<button class="reply-preview" data-jump="${esc(original.id)}"><b>${esc(original.author)}</b>${esc(original.text.slice(0, 130))}</button>` : ""}${m.subject ? `<div class="message-subject">${esc(m.subject)}</div>` : ""}<div class="message-content">${m.html || '<span class="panel-note">내용이 없는 메시지</span>'}</div>${attachments.map((k) => fileCard(D.files[k])).join("")}${reactionHtml(m.reactions)}${m.original ? `<button class="raw-toggle" data-original="${esc(m.id)}">원본 보기</button>` : ""}</div></div></article>`;
}
function renderMessages(jumpId, keepScroll = false) {
  const data = chats.get(activeChat);
  if (!data) return;
  const list = data.messages,
    byId = new Map(list.map((m) => [m.id, m]));
  const content = $("#content");
  let oldHeight = content.scrollHeight,
    oldTop = content.scrollTop;
  const top = content.getBoundingClientRect().top,
    anchor = keepScroll
      ? [...content.querySelectorAll(".message,.system-message")].find(
          (e) => e.getBoundingClientRect().bottom > top,
        )
      : null,
    anchorId = anchor?.id,
    anchorOffset = anchor ? anchor.getBoundingClientRect().top - top : 0;
  let lastDay = "";
  const out = [];
  if (messageStart > 0)
    out.push(
      `<button class="load-more" data-action="older">이전 메시지 ${Math.min(100, messageStart)}개 보기 · 앞에 ${messageStart.toLocaleString()}개</button>`,
    );
  else
    out.push(
      '<div class="panel-note" style="text-align:center">대화의 처음입니다</div>',
    );
  for (let i = messageStart; i < messageEnd; i++) {
    const m = list[i];
    const day = dayLabel(m.time);
    if (day !== lastDay) {
      out.push(`<div class="date-divider">${day}</div>`);
      lastDay = day;
    }
    out.push(messageHtml(m, byId));
  }
  if (messageEnd < list.length)
    out.push(
      `<button class="load-more" data-action="newer">다음 메시지 보기 · 뒤에 ${(list.length - messageEnd).toLocaleString()}개</button>`,
    );
  content.innerHTML =
    '<div class="message-list" data-conversation="' +
    activeChat +
    '">' +
    out.join("") +
    "</div>";
  renderMath(content);
  if (jumpId) {
    const target = document.getElementById("m" + jumpId);
    if (target) {
      target.classList.add("highlight");
      requestAnimationFrame(() => target.scrollIntoView({ block: "center" }));
    }
  } else if (keepScroll) {
    const target = anchorId && document.getElementById(anchorId);
    content.scrollTop = target
      ? content.scrollTop +
        target.getBoundingClientRect().top -
        content.getBoundingClientRect().top -
        anchorOffset
      : content.scrollHeight - oldHeight + oldTop;
  } else content.scrollTop = content.scrollHeight;
  content.querySelectorAll("img").forEach((img) =>
    img.addEventListener(
      "load",
      () => {
        if (
          !autoRunning &&
          !jumpId &&
          !keepScroll &&
          messageEnd === list.length &&
          content.scrollHeight - content.scrollTop - content.clientHeight < 500
        )
          content.scrollTop = content.scrollHeight;
      },
      { once: true },
    ),
  );
}
async function showChat(key, message, tab = "chat", version = routeVersion) {
  const c = convMap.get(key);
  if (!c) {
    showError("해당 대화를 찾을 수 없습니다.");
    return;
  }
  const previousChat = activeChat;
  activeChat = key;
  currentView = "chat";
  if (
    activeKind !== "all" &&
    activeKind !== c.kind &&
    !(activeKind === "meeting" && c.chatType === "meeting")
  )
    activeKind = c.kind;
  setRail(c.kind === "channel" ? "channel" : "chat");
  renderList();
  if (previousChat !== key)
    requestAnimationFrame(() =>
      $("#chat-list .selected")?.scrollIntoView({ block: "nearest" }),
    );
  chatHeader(c, tab);
  $("#content").innerHTML = '<div class="empty">대화를 여는 중…</div>';
  const data = await load("chat", key);
  if (version !== routeVersion) return;
  if (tab === "files") {
    showFiles(
      new Set([
        ...(c.fileKeys || []),
        ...data.messages.flatMap((m) => m.files || []),
      ]),
      true,
    );
    return;
  }
  if (tab !== "chat") {
    const t = D.tabs.find((t) => t.id === tab);
    if (t?.sheetKey) {
      await showSheet(t.sheetKey, c, t);
      return;
    }
    if (t?.snapshot?.status === "captured") {
      const snap = t.snapshot;
      $("#content").innerHTML =
        '<div class="panel"><h3>' +
        esc(t.name) +
        '</h3><p class="panel-note">보관 시점에 열린 채널 페이지의 화면입니다.</p><div class="status-links">' +
        (snap.pdfPath
          ? '<a href="' +
            pathUrl(snap.pdfPath) +
            '" target="_blank">PDF 보기</a>'
          : "") +
        '<a href="' +
        pathUrl(snap.textPath) +
        '" target="_blank">텍스트 보기</a></div><img class="inline-image" style="max-width:100%;max-height:none;margin-top:20px" src="' +
        pathUrl(snap.imagePath) +
        '" alt="보관된 채널 페이지">' +
        (t.fileKey ? fileCard(D.files[t.fileKey]) : "") +
        "</div>";
      return;
    }
    if (t?.localPath) {
      $("#content").innerHTML =
        '<div class="panel"><h3>' +
        esc(t.name) +
        '</h3><p class="panel-note">보관된 원본 파일을 열 수 있습니다.</p>' +
        fileCard(D.files[t.fileKey]) +
        "</div>";
      return;
    }
    $("#content").innerHTML =
      '<div class="empty"><h3>' +
      esc(t?.name || "채널 탭") +
      '</h3><p>이 탭의 표시 정보를 보관했습니다.</p><p class="panel-note">' +
      (t?.urls.length
        ? "이 탭의 내용을 오프라인으로 가져오지 못했습니다."
        : "원본 탭에 연결 주소가 없습니다.") +
      "</p>" +
      (t?.urls[0]
        ? '<a href="' +
          esc(externalUrl(t.urls[0])) +
          '" target="_blank" rel="noreferrer">원래 탭 열기</a>'
        : "") +
      "</div>";
    return;
  }
  let pos = message ? data.messages.findIndex((m) => m.id === message) : -1;
  if (pos >= 0) {
    messageStart = Math.max(0, pos - 30);
    messageEnd = Math.min(data.messages.length, pos + 50);
  } else {
    messageStart = Math.max(0, data.messages.length - 100);
    messageEnd = data.messages.length;
  }
  renderMessages(message);
  if (message && pos < 0) toast("원본 메시지가 백업에 없습니다.");
}
function showError(text) {
  $("#content").innerHTML =
    '<div class="empty"><h3>보관 파일을 열지 못했습니다</h3><p>' +
    esc(text) +
    "</p></div>";
}
function cleanHeader(title, subtitle, view) {
  currentView = view;
  setRail(view);
  header(
    title,
    subtitle,
    `<span class="avatar group">${icon(view === "status" ? "archive" : view === "sheets" ? "sheet" : "file")}</span>`,
  );
  $("#conversation-tabs").innerHTML = "";
  $("#conversation-foot").innerHTML = "";
}
function showFiles(keys = null, inChat = false) {
  if (!inChat)
    cleanHeader(
      "파일",
      "첨부 파일, 이미지, 외부 링크에서 저장한 원본",
      "files",
    );
  const base = Object.values(D.files).filter((f) => !keys || keys.has(f.key));
  const seen = new Set();
  const files = base.filter((f) => {
    const id = f.localPath || f.key;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  $("#content").innerHTML =
    '<div class="panel"><div class="panel-toolbar"><input id="file-filter" placeholder="파일 이름으로 검색" aria-label="파일 이름으로 검색"><select id="file-status" aria-label="파일 상태"><option value="all">전체 상태</option><option value="saved">저장 완료</option><option value="missing">가져오지 못한 원본</option><option value="sheets">스프레드시트</option></select><span class="panel-note" id="file-count"></span></div><div class="file-grid" id="file-list"></div><button class="load-more" id="more-files">더 보기</button></div>';
  let limit = 100;
  function draw() {
    const q = $("#file-filter").value.toLowerCase();
    const status = $("#file-status").value;
    const matches = files.filter(
      (f) =>
        (!q || f.name.toLowerCase().includes(q)) &&
        (status === "all" ||
          (status === "saved" &&
            f.localPath &&
            [
              "complete",
              "linked-existing",
              "webpage",
              "directory-index",
            ].includes(f.status)) ||
          (status === "missing" &&
            ![
              "complete",
              "linked-existing",
              "webpage",
              "directory-index",
            ].includes(f.status)) ||
          (status === "sheets" && f.sheetKey)),
    );
    $("#file-count").textContent = matches.length.toLocaleString() + "개";
    $("#file-list").innerHTML = matches.slice(0, limit).map(fileCard).join("");
    $("#more-files").hidden = matches.length <= limit;
  }
  $("#file-filter").oninput = () => {
    limit = 100;
    draw();
  };
  $("#file-status").onchange = () => {
    limit = 100;
    draw();
  };
  $("#more-files").onclick = () => {
    limit += 100;
    draw();
  };
  draw();
}
function showSheetCatalog() {
  cleanHeader("시트", "랩실 관리 시트와 보관된 스프레드시트", "sheets");
  const seen = new Set();
  let tiles = [];
  for (const tab of D.tabs.filter((t) => t.sheetKey)) {
    seen.add(tab.sheetKey);
    tiles.push(
      `<button class="sheet-tile" data-sheet="${tab.sheetKey}" data-sheet-chat="${convById(tab.channelId)?.key || ""}" data-sheet-tab="${esc(tab.id)}"><span class="file-type xlsx">XLSX</span><span><b>${esc(tab.name)}</b><small>${esc(tab.team)} · ${esc(tab.channel)}</small></span></button>`,
    );
  }
  for (const f of Object.values(D.files)) {
    if (!f.sheetKey || seen.has(f.sheetKey)) continue;
    seen.add(f.sheetKey);
    tiles.push(
      `<button class="sheet-tile" data-sheet="${f.sheetKey}"><span class="file-type xlsx">XLSX</span><span><b>${esc(f.name)}</b><small>저장된 스프레드시트 · ${bytes(f.bytes)}</small></span></button>`,
    );
  }
  $("#content").innerHTML =
    '<div class="panel"><p class="panel-note">워크시트의 저장된 값·수식·서식을 읽을 수 있습니다. 원본 Excel 파일도 함께 보관했습니다.</p><div class="sheet-catalog">' +
    tiles.join("") +
    "</div></div>";
}
function convById(id) {
  return D.conversations.find((c) => c.id === id);
}
function colName(n) {
  let out = "";
  while (n) {
    n--;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}
async function showSheet(key, c = null, tab = null) {
  if (c) {
    activeChat = c.key;
    renderList();
    chatHeader(c, tab?.id || "chat");
  } else cleanHeader("스프레드시트", "저장된 값과 수식 보기", "sheets");
  const version = routeVersion;
  const book = await load("sheet", key);
  if (version !== routeVersion) return;
  let sheetIndex = 0,
    startRow = 1,
    startCol = 1;
  const pageRows = 150,
    pageCols = 80;
  function draw() {
    const sheet = book.sheets[sheetIndex];
    if (!sheet) {
      showError("워크시트가 없습니다.");
      return;
    }
    const endRow = Math.min(sheet.rows, startRow + pageRows - 1),
      endCol = Math.min(sheet.cols, startCol + pageCols - 1);
    const map = new Map(sheet.cells.map((c) => [c[0] + "," + c[1], c]));
    const covered = new Set(),
      spans = new Map();
    for (const [c1, r1, c2, r2] of sheet.merges || []) {
      const top = Math.max(r1, startRow),
        left = Math.max(c1, startCol),
        bottom = Math.min(r2, endRow),
        right = Math.min(c2, endCol);
      if (top > bottom || left > right) continue;
      spans.set(top + "," + left, [
        bottom - top + 1,
        right - left + 1,
        map.get(r1 + "," + c1),
      ]);
      for (let r = top; r <= bottom; r++)
        for (let col = left; col <= right; col++)
          if (r !== top || col !== left) covered.add(r + "," + col);
    }
    let html = '<colgroup><col style="width:46px">';
    for (let col = startCol; col <= endCol; col++)
      html += `<col style="width:${sheet.widths?.[col] || 120}px">`;
    html += '</colgroup><thead><tr><th class="corner"></th>';
    for (let col = startCol; col <= endCol; col++)
      html += "<th>" + colName(col) + "</th>";
    html += "</tr></thead><tbody>";
    for (let r = startRow; r <= endRow; r++) {
      html += `<tr style="height:${Math.min(400, sheet.heights?.[r] || 25)}px"><th class="row-number">${r}</th>`;
      for (let col = startCol; col <= endCol; col++) {
        const id = r + "," + col;
        if (covered.has(id)) continue;
        const span = spans.get(id);
        const cell = span?.[2] || map.get(id) || [r, col, "", null, 0, null];
        const uncached = !!cell[3] && !cell[2];
        html += `<td data-cell="${id}" ${span ? `rowspan="${span[0]}" colspan="${span[1]}"` : ""} style="${esc(book.styles[cell[4]] || "")}" class="${uncached ? "formula-uncached" : ""}" title="${esc(cell[3] || cell[2])}">${esc(uncached ? cell[3] : cell[2])}</td>`;
      }
      html += "</tr>";
    }
    html += "</tbody>";
    $("#content").innerHTML =
      `<div class="sheet-view"><div class="sheet-toolbar"><b>${esc(book.name)}</b><a href="${pathUrl(book.original)}" download>${icon("download")} 원본 다운로드</a></div><div class="formula-bar"><span class="cell-address">${colName(startCol)}${startRow}</span><span class="formula-icon">fx</span><span class="formula-value">셀을 선택하면 값과 수식을 볼 수 있습니다.</span></div><div class="sheet-scroll"><table class="sheet-grid">${html}</table>${sheet.images?.length ? '<div class="sheet-images">' + sheet.images.map((i) => `<div><small class="panel-note">${colName(i.col)}${i.row}의 이미지</small><img src="${pathUrl(i.path)}" class="inline-image" alt="시트에 포함된 이미지"></div>`).join("") + "</div>" : ""}</div><div class="sheet-pagination"><button id="sheet-prev" ${startRow === 1 ? "disabled" : ""}>이전 행</button><span>${startRow}–${endRow} / ${sheet.rows.toLocaleString()}행</span><button id="sheet-next" ${endRow === sheet.rows ? "disabled" : ""}>다음 행</button><label>행 이동 <input id="sheet-row" type="number" min="1" max="${sheet.rows}" value="${startRow}"></label><button id="sheet-go">이동</button>${sheet.cols > pageCols ? `<button id="cols-prev" ${startCol === 1 ? "disabled" : ""}>이전 열</button><span>${colName(startCol)}–${colName(endCol)}</span><button id="cols-next" ${endCol === sheet.cols ? "disabled" : ""}>다음 열</button>` : ""}</div><div class="sheet-tabs">${book.sheets.map((s, i) => `<button data-worksheet="${i}" class="${i === sheetIndex ? "active" : ""}">${esc(s.name)}${s.state && s.state !== "visible" ? " (숨김)" : ""}</button>`).join("")}</div><div class="sheet-note">저장된 셀 값과 수식을 표시합니다. 캐시 값이 없는 수식은 연한 노란색으로 표시되며, 계산은 원본 Excel에서 할 수 있습니다.${sheet.charts ? " 차트는 원본 파일에 보관되어 있습니다." : ""}${book.localCandidate ? " · 로컬 사본: 원격 원본과 버전 일치 여부 미확인" : ""}</div></div>`;
    $("#sheet-prev").onclick = () => {
      startRow = Math.max(1, startRow - pageRows);
      draw();
    };
    $("#sheet-next").onclick = () => {
      startRow = Math.min(sheet.rows, startRow + pageRows);
      draw();
    };
    $("#sheet-go").onclick = () => {
      startRow = Math.max(1, Math.min(sheet.rows, +$("#sheet-row").value || 1));
      draw();
    };
    if ($("#cols-prev")) {
      $("#cols-prev").onclick = () => {
        startCol = Math.max(1, startCol - pageCols);
        draw();
      };
      $("#cols-next").onclick = () => {
        startCol = Math.min(sheet.cols, startCol + pageCols);
        draw();
      };
    }
    document.querySelectorAll("[data-worksheet]").forEach(
      (b) =>
        (b.onclick = () => {
          sheetIndex = +b.dataset.worksheet;
          startRow = startCol = 1;
          draw();
        }),
    );
    document.querySelectorAll("[data-cell]").forEach(
      (td) =>
        (td.onclick = () => {
          document
            .querySelectorAll(".sheet-grid .selected")
            .forEach((e) => e.classList.remove("selected"));
          td.classList.add("selected");
          const [r, col] = td.dataset.cell.split(",").map(Number);
          const cell = map.get(r + "," + col) || spans.get(r + "," + col)?.[2];
          $(".cell-address").textContent = colName(col) + r;
          $(".formula-value").textContent = cell ? cell[3] || cell[2] : "";
        }),
    );
  }
  draw();
}
let searchLoading = null;
async function showSearch(query) {
  cleanHeader("검색 결과", "전체 대화에서 “" + query + "” 검색", "chat");
  $("#content").innerHTML = '<div class="empty">검색 색인을 여는 중…</div>';
  const version = routeVersion;
  if (!window.TEAMS_SEARCH) {
    searchLoading ||= script("app/search.js");
    await searchLoading;
  }
  if (version !== routeVersion) return;
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const found = window.TEAMS_SEARCH.filter((r) =>
    terms.every((t) =>
      (r[0] + " " + r[1] + " " + r[3]).toLowerCase().includes(t),
    ),
  ).sort((a, b) => String(b[2] || "").localeCompare(String(a[2] || "")));
  let limit = 100;
  const pattern = new RegExp(
    "(" +
      terms.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") +
      ")",
    "ig",
  );
  function draw() {
    let results = found
      .slice(0, limit)
      .map((r) => {
        const low = r[3].toLowerCase();
        const pos = Math.max(0, low.indexOf(terms[0]) - 70);
        const snippet = (pos ? "…" : "") + r[3].slice(pos, pos + 420);
        const text = snippet
          .split(pattern)
          .map((v, i) => (i % 2 ? "<mark>" + esc(v) + "</mark>" : esc(v)))
          .join("");
        return `<button class="search-result" data-chat="${r[4]}" data-message="${r[5]}"><div class="search-result-top"><b>${esc(r[0])} · ${esc(r[1])}</b><span>${kst(r[2])}</span></div><p>${text}</p></button>`;
      })
      .join("");
    $("#content").innerHTML =
      '<div class="panel"><p class="panel-note">메시지 ' +
      found.length.toLocaleString() +
      "개</p>" +
      results +
      (found.length > limit
        ? '<button class="load-more" id="search-more">검색 결과 더 보기</button>'
        : "") +
      (found.length ? "" : '<div class="empty">검색 결과가 없습니다.</div>') +
      "</div>";
    if ($("#search-more"))
      $("#search-more").onclick = () => {
        limit += 100;
        draw();
      };
  }
  draw();
}
function showStatus() {
  cleanHeader(
    "백업 상태",
    dayLabel(D.snapshotTime) + "에 보관한 Teams",
    "status",
  );
  const m = D.metrics;
  const fileCounts = {};
  Object.values(D.files).forEach(
    (f) => (fileCounts[f.status] = (fileCounts[f.status] || 0) + 1),
  );
  const names = {
    complete: "원본 저장 완료",
    "linked-existing": "같은 원본에 연결",
    webpage: "웹페이지 저장본",
    "directory-index": "폴더 목록만 보관",
    "browser-required": "로그인 또는 추가 접근 필요",
    failed: "다운로드 실패",
    pending: "수집 대기",
    "action-link": "작업을 실행하는 링크 · 주소 보관",
    "link-only": "주소만 보관",
    "folder-link": "폴더 주소만 보관",
  };
  $("#content").innerHTML =
    '<div class="panel"><div class="metrics">' +
    [
      [m.conversations, "대화 및 채널"],
      [m.messages, "메시지"],
      [m.filesDownloaded, "저장된 파일 참조"],
      [m.avatars, "프로필 사진"],
    ]
      .map(
        ([n, label]) =>
          `<div class="metric"><b>${n.toLocaleString()}</b><span>${label}</span></div>`,
      )
      .join("") +
    '</div><h3>파일 보관 현황</h3><table class="status-table"><thead><tr><th>구분</th><th>참조 수</th></tr></thead><tbody>' +
    Object.entries(fileCounts)
      .map(
        ([name, n]) =>
          "<tr><td>" +
          esc(names[name] || name) +
          "</td><td>" +
          n.toLocaleString() +
          "</td></tr>",
      )
      .join("") +
    '</tbody></table><p class="panel-note">파일 참조 수에는 여러 메시지에서 공유된 같은 파일이 포함될 수 있습니다. 접근 권한이 없거나 삭제된 원본은 실패 기록을 남겼습니다. 직접 가져온 파일은 원격 버전 일치 여부가 확인되지 않은 사본으로 표시합니다.</p><div class="status-links"><a href="verification.html">검증 보고서</a><a href="verification.json">검증 결과 JSON</a><a href="SHA256SUMS.txt">SHA-256 목록</a><a href="unavailable-files.csv">미확보 원본 목록</a><a href="file-manifest.json">파일 목록</a><a href="external-manifest.json">외부 링크 목록</a></div></div>';
}
function replaceMatches(root, regex, make) {
  const nodes = [];
  let text = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement?.closest(".katex,pre,code,script,style,.math-rendered")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  let node;
  while ((node = walker.nextNode())) {
    nodes.push({
      node,
      start: text.length,
      end: text.length + node.data.length,
    });
    text += node.data;
  }
  const matches = [...text.matchAll(regex)];
  for (const match of matches.reverse()) {
    const start = match.index,
      end = start + match[0].length;
    const first = nodes.find((n) => n.start <= start && n.end > start),
      last = nodes.find((n) => n.start < end && n.end >= end);
    if (!first || !last) continue;
    try {
      const range = document.createRange();
      range.setStart(first.node, start - first.start);
      range.setEnd(last.node, end - last.start);
      const replacement = make(match);
      if (!replacement) continue;
      range.deleteContents();
      range.insertNode(replacement);
    } catch (e) {
      console.warn("Math range:", e.message);
    }
  }
}
function mathNode(tex, display = true) {
  const el = document.createElement(display ? "div" : "span");
  el.className = "math-rendered";
  const fixed = tex.replace(/\\\\\$(\d+)pt\]/g, "\\\\[$1pt]");
  try {
    katex.render(fixed, el, {
      displayMode: display,
      throwOnError: false,
      trust: false,
      strict: "ignore",
      output: "htmlAndMathml",
    });
  } catch {
    el.className = "math-error";
    el.textContent = tex;
  }
  return el;
}
function renderMath(container) {
  for (const body of container.querySelectorAll(".message-content")) {
    if (!/\\(?:begin|frac|tfrac|\(|\[)|\$|<math/.test(body.textContent))
      continue;
    replaceMatches(body, /<math\b[\s\S]*?<\/math>/g, (m) => {
      const a = m[0].match(
        /<annotation\b[^>]*encoding=["']application\/x-tex["'][^>]*>([\s\S]*?)<\/annotation>/,
      );
      if (!a) return null;
      const t = document.createElement("textarea");
      t.innerHTML = a[1];
      return mathNode(t.value, /display\s*=\s*["']block/.test(m[0]));
    });
    replaceMatches(
      body,
      /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g,
      (m) => {
        const value = m[1] || m[2] || m[3] || m[4];
        if (
          m[4] &&
          !/[\\^_={}+*/<>-]/.test(value) &&
          !/^\s*[A-Za-z]\s*$/.test(value)
        )
          return null;
        return mathNode(value, !!(m[1] || m[2]));
      },
    );
    replaceMatches(
      body,
      /\\begin\{(pmatrix|bmatrix|matrix|aligned|align\*?|equation\*?|cases)\}[\s\S]*?\\end\{\1\}/g,
      (m) => mathNode(m[0], true),
    );
    try {
      renderMathInElement(body, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\\[", right: "\\]", display: true },
          { left: "\\(", right: "\\)", display: false },
        ],
        throwOnError: false,
        trust: false,
        strict: "ignore",
        ignoredClasses: ["katex", "math-rendered"],
      });
    } catch (e) {
      console.warn("Math render:", e.message);
    }
  }
}
function openMedia(html) {
  stopAutoScroll();
  $("#media-content").innerHTML = html;
  $("#media-dialog").showModal();
}
$("#close-media").onclick = () => $("#media-dialog").close();
$("#media-dialog").onclick = (e) => {
  if (e.target === $("#media-dialog")) $("#media-dialog").close();
};
document.addEventListener("click", (e) => {
  const image = e.target.closest("img.inline-image,.sheet-images img");
  if (image) {
    e.preventDefault();
    openMedia(
      '<img src="' + esc(image.src) + '" alt="' + esc(image.alt) + '">',
    );
    return;
  }
  const b = e.target.closest(
    "[data-mention],[data-chat],[data-view],[data-filter],[data-tab],[data-sheet],[data-jump],[data-action],[data-original],[data-file],[data-file-details]",
  );
  if (!b) return;
  if (b.hasAttribute("data-mention")) {
    e.preventDefault();
    goMention(b.dataset.mention, b.textContent.trim());
    return;
  }
  if (b.dataset.chat) {
    e.preventDefault();
    if ($("#media-dialog").open) $("#media-dialog").close();
    nav({
      chat: b.dataset.chat,
      ...(b.dataset.message ? { message: b.dataset.message } : {}),
    });
    return;
  }
  if (b.dataset.view) {
    const view = b.dataset.view;
    if (["chat", "channel"].includes(view)) {
      activeKind = view === "channel" ? "channel" : "all";
      renderList();
      const first = ordered.find(
        (c) => view !== "channel" || c.kind === "channel",
      );
      nav({ chat: first?.key || "" });
    } else nav({ view });
    return;
  }
  if (b.dataset.filter) {
    activeKind = b.dataset.filter;
    listLimit = 30;
    renderList();
    $("#chat-list").scrollTop = 0;
    return;
  }
  if (b.dataset.tab) {
    nav({ chat: activeChat, tab: b.dataset.tab });
    return;
  }
  if (b.dataset.sheet) {
    nav({
      sheet: b.dataset.sheet,
      ...(b.dataset.sheetChat
        ? { chat: b.dataset.sheetChat, tab: b.dataset.sheetTab }
        : {}),
    });
    return;
  }
  if (b.dataset.jump) {
    e.preventDefault();
    nav({ chat: b.dataset.jumpChat || activeChat, message: b.dataset.jump });
    return;
  }
  if (b.dataset.original) {
    const m = chats
      .get(activeChat)
      ?.messages.find((m) => m.id === b.dataset.original);
    if (m)
      openMedia(
        '<h3>원본 메시지 기록</h3><p class="panel-note">' +
          esc(m.type) +
          " · " +
          kst(m.time, true) +
          "</p><pre>" +
          esc(m.original || m.text) +
          "</pre>",
      );
    return;
  }
  if (b.dataset.fileDetails) {
    const f = D.files[b.dataset.fileDetails];
    openMedia(
      "<h3>" +
        esc(f.name) +
        "</h3><p>" +
        esc(f.error || "원본을 다운로드하지 못했습니다.") +
        '</p><p class="panel-note">HTTP ' +
        esc(f.httpStatus || "상태 미확인") +
        "</p>" +
        (f.sourceUrl
          ? '<a href="' +
            esc(externalUrl(f.sourceUrl)) +
            '" target="_blank" rel="noreferrer">원래 공유 링크 열기</a>'
          : ""),
    );
    return;
  }
  if (b.dataset.file) {
    const f = D.files[b.dataset.file];
    if (f?.sheetKey) {
      e.preventDefault();
      nav({ sheet: f.sheetKey });
      return;
    }
    if (f?.localPath && f.contentType?.startsWith("video/")) {
      e.preventDefault();
      openMedia(
        "<h3>" +
          esc(f.name) +
          '</h3><video controls src="' +
          pathUrl(f.localPath) +
          '"></video>',
      );
      return;
    }
  }
  const act = b.dataset.action;
  if (act === "more-chats") {
    listLimit += 30;
    renderList();
  }
  if (act === "auto-up") {
    autoRunning ? stopAutoScroll() : startAutoScroll();
  }
  if (act === "older") {
    loadOlder();
  }
  if (act === "newer") {
    messageEnd = Math.min(
      chats.get(activeChat).messages.length,
      messageEnd + 100,
    );
    messageStart = Math.max(messageStart, messageEnd - 500);
    renderMessages(null, true);
  }
  if (act === "search-focus") $("#global-search").focus();
  if (act === "mobile-list") {
    openMedia(
      "<h3>대화 목록</h3>" +
        ordered
          .map(
            (c) =>
              '<button class="chat-row" data-chat="' +
              c.key +
              '">' +
              convAvatar(c) +
              '<span class="chat-name">' +
              esc(c.title) +
              "</span></button>",
          )
          .join(""),
    );
    $("#media-content").addEventListener(
      "click",
      () => $("#media-dialog").close(),
      { once: true },
    );
  }
});
$("#chat-filter").oninput = (e) => {
  listFilter = e.target.value.toLowerCase().trim();
  listLimit = 30;
  renderList();
  $("#chat-list").scrollTop = 0;
};
$("#search-form").onsubmit = (e) => {
  e.preventDefault();
  const q = $("#global-search").value.trim();
  if (q) nav({ search: q });
};
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    $("#global-search").focus();
  }
});
async function route() {
  stopAutoScroll();
  const version = ++routeVersion;
  const p = new URLSearchParams(location.hash.slice(1));
  try {
    if (p.has("search")) {
      await showSearch(p.get("search"));
      return;
    }
    if (p.has("sheet")) {
      const c = convMap.get(p.get("chat"));
      await showSheet(
        p.get("sheet"),
        c,
        D.tabs.find((t) => t.id === p.get("tab")),
      );
      return;
    }
    const view = p.get("view");
    if (view === "files") {
      showFiles();
      return;
    }
    if (view === "sheets") {
      showSheetCatalog();
      return;
    }
    if (view === "status") {
      showStatus();
      return;
    }
    await showChat(
      p.get("chat") || ordered[0]?.key,
      p.get("message"),
      p.get("tab") || "chat",
      version,
    );
  } catch (e) {
    console.error(e);
    showError(e.message);
  }
}
window.addEventListener("hashchange", route);
renderList();
route();
