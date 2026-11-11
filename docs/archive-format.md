# Archive format

Personal archives are generated in an output directory outside this repository. The files below contain original conversations and documents, so keep them separate from the software source.

```text
archive/
  archive-settings.json       # Snapshot time, your MRI, and collection scope
  index.html                  # Offline entry point
  app/
    app.js, app.css           # Viewer
    data.js                   # Conversation, person, file, and tab metadata
    search.js                 # Local search index
    chats/<key>.js            # Rendered data for each conversation
    sheets/<key>.js           # Rendered data for each workbook
    vendor/                   # Local KaTeX and emoji font
  raw/
    server-inventory.json     # Server inventory
    cache/                    # Conversation-related IndexedDB stores
    cache-only/               # Cached messages absent from server retrieval
    messages/<key>/           # Raw message pages and resume state
    libraries/                # Document drive inventory responses
    file-states/              # Per-file status, hashes, and provenance
  conversations/              # Normalized message JSON
  files/                      # Downloads, avatars, and embedded sheet images
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

`prepare-archive.py` normalizes raw messages, and `expand-backup.py` extracts profiles, tabs, external links, and cards. `build-sheets.py` converts workbooks to cell data, and `build-teams-ui.py` sanitizes message HTML and generates viewer data. These Python scripts use the output path provided by the CLI.

Each message includes fields such as `id`, `createdAt`, `author`, `authorId`, `type`, `content`, `mentions`, `reactions`, `files`, and `parentMessageId`. Original UTC timestamps remain in the JSON; the viewer displays them in `Asia/Seoul`. Relative dates use `snapshotTime` as their reference date.

The `files` field contains asset keys. A file state's `localPath` is relative to the output directory. Entries with `status: complete` include `bytes` and `sha256`. Manually imported files also include `provenance` and `contentRole: user-import`. When a refresh cannot retrieve an original again, the exporter preserves the earlier file and adds `lastAttempt`.

Conversation files load through `window.__teamsBackupChat(key, data)`, and workbook files through `window.__teamsBackupSheet(key, data)`. These callbacks let the viewer work over `file://` without a server or `fetch()`. Metadata and search indexes are also JavaScript data files, so a personal archive's `app/` directory contains real conversation content.

The archive format is not yet a stable, versioned API. Keeping raw JSON and original files alongside the viewer makes it easier to rebuild the interface or convert the archive into another format.
