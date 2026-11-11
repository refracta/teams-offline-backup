# Development and privacy separation

You can generate the demo and run regression tests without a real account. The public demo is created from scratch; it does not use anonymized conversations or excerpts from real chats.

## Provenance of public files

| Files                                                                  | Source                                                                       |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `viewer/`, `lib/`, `bin/`, `scripts/`                                  | Reusable application code                                                    |
| `demo/raw`, `demo/conversations`, `demo/app/data.js`, and related data | Synthetic fixtures created from scratch by `scripts/make-demo.cjs`           |
| Demo avatars and experiment image                                      | SVG shapes written directly in the generator                                 |
| Demo workbook                                                          | Fictional schedules and measurements created by `scripts/make-demo-sheet.py` |
| `docs/screenshots/*.png`                                               | Screenshots of the synthetic demo captured in offline Chromium               |
| KaTeX                                                                  | The npm distribution pinned by the lockfile, with its MIT license            |
| Noto Color Emoji                                                       | An official upstream artifact with a pinned revision, hash, and OFL license  |

The demo characters are Alex Demo, Blair Demo, and Casey Demo. Their fictional account GUIDs run from `00000000-0000-4000-8000-000000000001` through `...003`, and file URLs use `demo.example.invalid`. These do not identify real user accounts, tenants, or organizations.

## Paths and authentication

The CLI normalizes archive and browser-profile paths, resolves symlinks, and rejects paths inside any Git working tree. It also rejects overlapping profile and output directories. The dedicated synthetic generator is the only exception for creating the `demo` directory inside this repository.

Authentication for Teams, SharePoint, and media requests is attached only to recognized Microsoft service origins. Headers captured for one SharePoint hostname are not reused for another. If a download redirect changes origin, all authentication headers are removed and remain removed for subsequent redirects. External file downloads receive no authentication headers.

Recognized token, cookie, and preauthenticated download URL fields are removed before raw responses are saved. Keep login profiles, HAR files, browser traces, and personal archives out of version control. Sensitive content inside chat bodies and ordinary links is not automatically removed, so **never reuse a real output directory as the public demo.**

## Checks and screenshots

```bash
npm ci
npx playwright install chromium
npm run demo
npm test
npm run test:viewer
npm run screenshots
npm run check:privacy
```

Install the Python dependencies first by following the README. `screenshots` accepts no path options and checks the synthetic-data marker in `demo/archive-settings.json`. It does not connect to a browser signed in to a user's account.

The public-file checker examines allowed directories, synthetic-data markers, GUIDs, credential-like strings, user home paths, demo profiles, and the bundled font's hash. For additional checks, keep a private JSON denylist outside the repository and pass its path through the `TEAMS_PRIVATE_DENYLIST` environment variable. Matches are reported by filename and count without printing the private values. These checks supplement manual review; they are not a comprehensive personal-data detector.

Before committing, review `git diff --cached --stat` and the actual file list. Also inspect screenshots for address bars or account UI, workbook document properties, and the provenance of new binary files. CI runs entirely on synthetic data without a real account or Microsoft credentials.

## Test coverage

- Archive path validation, symlink handling, and rejection of Git working-tree paths
- Removal of authentication across redirects and from serialized fields, download hashing, and rejection of HTML masquerading as a file
- Mock API pagination, detection of repeated pages, and resuming interrupted collection
- Separate reporting of file integrity and collection coverage, including detection of modified files
- Navigation, search, spreadsheets, and math in an offline browser over `file://`
- KST timestamps while the browser is configured with a US time zone

Synthetic tests do not establish compatibility with every Teams tenant. When changing the internal API collector, validate it separately in an authorized private environment and keep the resulting account data outside the public repository.
