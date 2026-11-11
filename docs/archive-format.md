# 백업 형식

개인 백업은 이 저장소 밖의 출력 디렉터리에 생성됩니다. 아래 항목에는 원래 대화와 문서가 들어 있으므로 프로그램 소스와 구분해 보관합니다.

```text
archive/
  archive-settings.json       # 보관 시점, 본인 MRI, 수집 범위
  index.html                  # 오프라인 진입점
  app/
    app.js, app.css           # 뷰어
    data.js                  # 대화·사람·파일·탭 메타데이터
    search.js                # 로컬 검색 색인
    chats/<key>.js           # 대화별 렌더링 데이터
    sheets/<key>.js          # 시트별 렌더링 데이터
    vendor/                  # 로컬 KaTeX와 이모지 폰트
  raw/
    server-inventory.json    # 서버 목록
    cache/                   # 대화 관련 IndexedDB 저장소
    cache-only/              # 서버 재수집 결과에 없는 캐시 메시지
    messages/<key>/          # 원시 페이지와 재개 상태
    libraries/               # 문서 드라이브 목록 응답
    file-states/             # 파일별 상태·해시·출처
  conversations/             # 정규화된 메시지 JSON
  files/                     # 받은 파일, 프로필 사진, 시트 포함 이미지
  inventory.json
  conversations.json
  profiles.json
  channel-tabs.json
  all-assets.json
  file-manifest.json
  external-manifest.json
  sheet-map.json
  sheet-summary.json
  verification.html
  verification.json
  SHA256SUMS.txt
  unavailable-files.csv
```

원시 메시지를 `prepare-archive.py`가 정규화하고, `expand-backup.py`가 프로필·탭·외부 링크·카드를 추출합니다. `build-sheets.py`가 워크북을 셀 데이터로 만들고, `build-teams-ui.py`가 HTML을 정리해 뷰어 데이터를 생성합니다. Python 파일은 CLI가 지정한 출력 경로를 사용합니다.

각 메시지는 `id`, `createdAt`, `author`, `authorId`, `type`, `content`, `mentions`, `reactions`, `files`, `parentMessageId` 등을 가집니다. UTC 원본 시간은 JSON에 남기고 뷰어가 `Asia/Seoul`로 표시합니다. 상대 날짜의 기준은 열람 당일이 아니라 `snapshotTime`입니다.

`files`의 값은 자산 키입니다. 파일 상태의 `localPath`는 출력 폴더 기준 상대 경로입니다. `status: complete` 항목에는 `bytes`와 `sha256`이 들어갑니다. 수동으로 가져온 파일에는 `provenance`와 `contentRole: user-import`가 붙습니다. 갱신 시 원본을 다시 받지 못한 경우 기존 파일을 유지하면서 `lastAttempt`를 추가합니다.

메시지 파일은 `window.__teamsBackupChat(key, data)`, 시트 파일은 `window.__teamsBackupSheet(key, data)` 콜백으로 로드됩니다. 별도 서버나 `fetch()`가 없어도 `file://`에서 작동하기 위한 형식입니다. 메타데이터·검색 색인도 JavaScript 데이터 파일이므로 개인 백업의 `app/` 전체에 실제 내용이 들어 있습니다.

이 형식은 아직 버전 고정 API가 아닙니다. 원시 JSON과 원본 파일을 함께 보관하면 뷰어를 다시 만들거나 다른 형식으로 변환하기 쉽습니다.
