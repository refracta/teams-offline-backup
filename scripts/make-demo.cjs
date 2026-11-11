// All words, identifiers, illustrations, and files below are invented fixtures.
// This module intentionally has no browser, account, or archive import path.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { repo, save, key } = require("../lib/storage.cjs");
const { python } = require("../lib/build.cjs");
const people = [
  {
    id: "8:orgid:00000000-0000-4000-8000-000000000001",
    name: "Alex Demo",
    color: "#6264a7",
    initials: "AD",
  },
  {
    id: "8:orgid:00000000-0000-4000-8000-000000000002",
    name: "Blair Demo",
    color: "#147d78",
    initials: "BD",
  },
  {
    id: "8:orgid:00000000-0000-4000-8000-000000000003",
    name: "Casey Demo",
    color: "#b96129",
    initials: "CD",
  },
];
const mainId = "19:synthetic-studio@thread.v2",
  dmId = "19:synthetic-blair@thread.v2";
const imageUrl = "https://demo.example.invalid/files/experiment.svg";
const sheetUrl = "https://demo.example.invalid/files/demo-lab.xlsx";
const csvUrl = "https://demo.example.invalid/files/demo-measurements.csv";
const missingUrl = "https://demo.example.invalid/files/unavailable-example.pdf";
const snapshotTime = "2030-04-18T06:00:00.000Z";
const fixture = (relative) => path.join(repo, "demo", relative);
function svgAvatar(person) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192"><rect width="192" height="192" rx="96" fill="${person.color}"/><circle cx="96" cy="73" r="33" fill="#ffffff" opacity=".88"/><path d="M29 174c2-51 132-51 134 0" fill="#ffffff" opacity=".88"/><circle cx="85" cy="72" r="3" fill="${person.color}"/><circle cx="107" cy="72" r="3" fill="${person.color}"/><path d="M84 86q12 10 24 0" fill="none" stroke="${person.color}" stroke-width="3" stroke-linecap="round"/></svg>`;
}
function generate(root) {
  if (path.resolve(root) !== path.join(repo, "demo"))
    throw new Error("Synthetic generator only writes demo/");
  // Refuse to overwrite any folder lacking our explicit synthetic marker.
  const marker = path.join(root, "archive-settings.json");
  if (
    fs.existsSync(marker) &&
    JSON.parse(fs.readFileSync(marker)).synthetic !== true
  )
    throw new Error("Demo folder is not marked synthetic.");
  fs.mkdirSync(root, { recursive: true });
  save(marker, {
    synthetic: true,
    selfId: people[0].id,
    selfName: people[0].name,
    snapshotTime,
    timeZone: "Asia/Seoul",
    scope: {
      source: "generated synthetic fixtures",
      externalFolders: "addresses-only",
    },
  });
  const write = (rel, body) => {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  };
  const avatars = [];
  for (const [i, p] of people.entries()) {
    const rel = "files/avatars/demo-" + (i + 1) + ".svg",
      data = Buffer.from(svgAvatar(p));
    write(rel, data);
    avatars.push({
      id: p.id,
      status: "complete",
      localPath: rel,
      bytes: data.length,
      sha256: crypto.createHash("sha256").update(data).digest("hex"),
    });
  }
  save(path.join(root, "avatar-manifest.json"), avatars);
  save(path.join(root, "raw/cache/profiles.json"), {
    stores: [
      {
        name: "profiles",
        values: people.map((p) => ({ mri: p.id, displayName: p.name })),
      },
    ],
  });
  write(
    "files/demo/experiment.svg",
    `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="360" viewBox="0 0 960 360"><rect width="960" height="360" rx="20" fill="#eef0fb"/><text x="44" y="60" font-family="sans-serif" font-size="18" letter-spacing="3" fill="#6264a7">SYNTHETIC EXPERIMENT / DEMO ONLY</text><text x="44" y="108" font-family="sans-serif" font-size="32" font-weight="bold" fill="#242647">A small step, a clearer picture.</text><path d="M60 276H900M60 160V276" stroke="#c8cce3" stroke-width="2"/><path d="M60 252L200 234L340 243L480 210L620 186L760 162L900 147L900 276L60 276" fill="#6264a7" opacity=".12"/><path d="M60 252L200 234L340 243L480 210L620 186L760 162L900 147" fill="none" stroke="#6264a7" stroke-width="5" stroke-linecap="round"/><g fill="#147d78"><circle cx="60" cy="252" r="7"/><circle cx="200" cy="234" r="7"/><circle cx="340" cy="243" r="7"/><circle cx="480" cy="210" r="7"/><circle cx="620" cy="186" r="7"/><circle cx="760" cy="162" r="7"/><circle cx="900" cy="147" r="7"/></g><text x="60" y="321" font-family="sans-serif" font-size="15" fill="#666b85">01 / Start</text><text x="793" y="321" font-family="sans-serif" font-size="15" fill="#666b85">07 / Review</text></svg>`,
  );
  write(
    "files/demo/demo-measurements.csv",
    "sample,trial_a,trial_b,unit\nDemo-01,12.4,12.8,ms\nDemo-02,11.6,11.9,ms\nDemo-03,10.2,10.5,ms\n",
  );
  python("make-demo-sheet.py", root, true);
  const assets = [];
  for (const [url, rel, kind, name] of [
    [
      imageUrl,
      "files/demo/experiment.svg",
      "inline-image",
      "실험 흐름 · 가상 이미지",
    ],
    [sheetUrl, "files/demo/demo-lab.xlsx", "attachment", "가상 랩실 시트.xlsx"],
    [
      csvUrl,
      "files/demo/demo-measurements.csv",
      "attachment",
      "가상 측정값.csv",
    ],
  ]) {
    const data = fs.readFileSync(path.join(root, rel)),
      id = key(url);
    assets.push({
      key: id,
      url,
      kind,
      name,
      references: [
        { conversationKey: key(mainId), messageId: "1900000000254" },
      ],
    });
    save(path.join(root, "raw/file-states", id + ".json"), {
      key: id,
      sourceUrl: url,
      kind,
      name,
      localPath: rel,
      status: "complete",
      bytes: data.length,
      sha256: crypto.createHash("sha256").update(data).digest("hex"),
      contentType: rel.endsWith(".svg")
        ? "image/svg+xml"
        : rel.endsWith(".csv")
          ? "text/csv"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }
  assets.push({
    key: key(missingUrl),
    url: missingUrl,
    kind: "attachment",
    name: "접근 불가 예시.pdf",
    references: [{ conversationKey: key(mainId), messageId: "1900000000259" }],
  });
  save(path.join(root, "raw/file-states", key(missingUrl) + ".json"), {
    key: key(missingUrl),
    sourceUrl: missingUrl,
    kind: "attachment",
    name: "접근 불가 예시.pdf",
    status: "failed",
    httpStatus: 403,
    error: "가상 데모: 미확보 파일의 표시 예시입니다.",
  });
  save(path.join(root, "all-assets.json"), assets);
  const items = [],
    cached = [];
  function conversation(id, title, members, messages, kind = "chat") {
    const item = {
      id,
      key: key(id),
      title,
      kind,
      source: "synthetic",
      chatType: "group",
    };
    items.push(item);
    cached.push({
      id,
      type: kind === "channel" ? "Topic" : "Chat",
      chatTitle: {
        shortTitle: title,
        avatarUsersInfo: members.map((i) => ({
          mri: people[i].id,
          displayName: people[i].name,
        })),
      },
    });
    save(path.join(root, "raw/messages", item.key, "0000000.json"), {
      messages,
    });
    save(path.join(root, "raw/messages", item.key, "state.json"), {
      status: "complete",
      pages: 1,
      messageCount: messages.length,
    });
  }
  function message(
    n,
    author,
    content,
    properties = {},
    type = "RichText/Html",
  ) {
    return {
      id: String(1900000000000 + n),
      originalarrivaltime: new Date(
        Date.parse("2030-04-18T00:00:00Z") + n * 60000,
      ).toISOString(),
      from: people[author].id,
      imdisplayname: people[author].name,
      messagetype: type,
      content,
      properties,
    };
  }
  const history = [];
  for (let i = 0; i < 250; i++)
    history.push(
      message(
        i,
        i % 3,
        `<p>가상 프로젝트 기록 ${String(i + 1).padStart(3, "0")} — ${["새로운 아이디어를 시트에 정리했습니다.", "오늘의 데모 측정값을 확인했습니다.", "다음 실험에서 비교할 항목을 남깁니다.", "이미지와 결과는 오프라인 보관함에서 볼 수 있습니다."][i % 4]}</p>`,
      ),
    );
  history.push(
    message(
      250,
      0,
      `<addmember><initiator>${people[0].id}</initiator><target>${people[2].id}</target></addmember>`,
      {},
      "ThreadActivity/AddMember",
    ),
  );
  history.push(
    message(
      251,
      1,
      "<p>데모 스튜디오에 오신 것을 환영합니다. 이 대화와 프로필은 모두 가상 데이터입니다. 👋</p>",
    ),
  );
  history.push(
    message(
      252,
      2,
      `<p>오늘의 실험 흐름을 정리했어요. 이미지도 백업 폴더 안에 저장됩니다.</p><p><img src="${imageUrl}" alt="가상 실험 흐름 이미지"></p>`,
    ),
  );
  history.push(
    message(
      253,
      0,
      '<p><span itemtype="http://schema.skype.com/Mention" itemid="0">Blair Demo</span> 시트에서 다음 실험 일정을 확인해 주세요. 📊</p>',
      {
        mentions: JSON.stringify([
          { itemid: 0, mri: people[1].id, displayName: people[1].name },
        ]),
        emotions: JSON.stringify([
          {
            key: "like",
            users: [{ mri: people[1].id }, { mri: people[2].id }],
          },
        ]),
      },
    ),
  );
  history.push(
    message(
      254,
      1,
      "<p>랩실 시트와 측정값을 함께 올렸습니다. 파일 카드를 누르면 저장된 셀과 수식을 바로 볼 수 있어요.</p>",
      {
        files: JSON.stringify([
          { fileName: "가상 랩실 시트.xlsx", fileInfo: { fileUrl: sheetUrl } },
          { fileName: "가상 측정값.csv", fileInfo: { fileUrl: csvUrl } },
        ]),
      },
    ),
  );
  history.push(
    message(
      255,
      2,
      "<p>비교에 쓴 수식입니다. 수식 렌더링도 인터넷 연결 없이 동작해요.</p><p>$$\\mathcal{L}(\\theta)=\\frac{1}{N}\\sum_{i=1}^{N}(y_i-\\hat{y}_i)^2$$</p>",
    ),
  );
  history.push(
    message(
      256,
      0,
      `<blockquote itemtype="http://schema.skype.com/Reply" itemid="1900000000254">Blair Demo: 랩실 시트와 측정값을 함께 올렸습니다.</blockquote><p>확인했어요! 인용문은 원래 메시지로, 멘션은 관련 대화로 이동합니다. ✅</p>`,
    ),
  );
  history.push(
    message(
      257,
      1,
      "<p>왼쪽 목록에서 대화를 검색할 수 있어요. “자동 스크롤”을 켜면 이전 기록을 천천히 읽을 수 있습니다. ☕</p>",
    ),
  );
  const card = {
    type: "AdaptiveCard",
    version: "1.5",
    body: [
      { type: "TextBlock", text: "가상 실험 · 다음 단계", weight: "bolder" },
      {
        type: "FactSet",
        facts: [
          { title: "기록 상태", value: "로컬 보관 완료" },
          { title: "다음 일정", value: "2030년 4월 19일" },
        ],
      },
    ],
  };
  history.push(
    message(
      258,
      2,
      '<Swift b64="' +
        Buffer.from(JSON.stringify(card)).toString("base64") +
        '"/>',
    ),
  );
  history.push(
    message(
      259,
      0,
      "<p>아래는 접근 실패를 보여 주기 위해 만든 가상 파일입니다. 실제 파일이나 계정과 관계없습니다.</p>",
      {
        files: JSON.stringify([
          { fileName: "접근 불가 예시.pdf", fileInfo: { fileUrl: missingUrl } },
        ]),
      },
    ),
  );
  history.push(
    message(
      260,
      1,
      `<p>전체 검토 완료! 🎉 <a href="https://teams.microsoft.com/l/message/${encodeURIComponent(mainId)}/1900000000253">멘션이 있는 메시지로 이동</a></p>`,
    ),
  );
  conversation(mainId, "데모 스튜디오 ✨", [0, 1, 2], history, "channel");
  conversation(
    dmId,
    "Blair Demo",
    [0, 1],
    [
      message(200, 1, "<p>멘션을 누르면 이 가상 1:1 대화로 이동합니다.</p>"),
      message(
        201,
        0,
        "<p>이 대화도 데모 생성기가 새로 만든 예시입니다. 🙂</p>",
      ),
    ],
  );
  for (let i = 1; i <= 34; i++)
    conversation(
      "19:synthetic-project-" + i + "@thread.v2",
      "가상 프로젝트 " + String(i).padStart(2, "0"),
      [0, (i % 2) + 1],
      [
        message(
          i,
          (i % 2) + 1,
          "<p>대화 목록 탐색을 위한 가상 기록 " + i + "입니다.</p>",
        ),
      ],
    );
  save(path.join(root, "inventory.json"), {
    collectedAt: snapshotTime,
    csaComplete: true,
    conversationPaginationComplete: true,
    items,
  });
  save(path.join(root, "raw/cache/conversation-manager.json"), {
    stores: [{ name: "conversations", values: cached }],
  });
  save(path.join(root, "raw/cache/replychain-manager.json"), { stores: [] });
  save(path.join(root, "raw/server-inventory.json"), {
    chats: [],
    teams: [
      {
        id: "synthetic-team",
        displayName: "가상 연구팀",
        channels: [
          {
            id: mainId,
            displayName: "데모 스튜디오",
            tabs: [
              {
                id: "synthetic-lab-sheet",
                name: "랩실 시트",
                settings: {
                  url: sheetUrl,
                  file: JSON.stringify({ objectUrl: sheetUrl }),
                },
              },
            ],
          },
        ],
      },
    ],
  });
  save(path.join(root, "message-export-summary.json"), {
    completedAt: snapshotTime,
    inventoryComplete: true,
    conversations: items.length,
    complete: items.length,
    failed: [],
  });
  save(path.join(root, "library-inventory.json"), []);
}
module.exports = { generate, mainId, dmId, people, snapshotTime };
