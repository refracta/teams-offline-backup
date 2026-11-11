# Backing up before your account expires

Collect your data while you still have access to the account, then check the results with the internet disconnected. This public repository distributes the software; keep your personal archives separately.

## 1. Choose a location and collection scope

Store the archive outside the source repository. The default output directory is `~/TeamsBackups/archive`. The archive and browser profile must use separate directories that do not overlap. Paths inside any Git working tree are rejected. On Windows, a short output path helps when your archive contains deeply nested folders and long filenames.

Before downloading a file, the exporter checks that the drive has room for its expected size plus a 5 GiB reserve. Allow space for original files, raw message JSON, and spreadsheet previews.

| Option                         | Scope                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `--libraries teams`            | Default. Explore document drives in SharePoint sites discovered through Teams and its channels                |
| `--libraries none`             | Skip full library discovery; continue processing directly attached files                                      |
| `--onedrive`                   | Also explore your OneDrive drive when its origin has been discovered in the browser                           |
| `--external files`             | Default. Download direct files, images, and documents with recognized public export URLs                      |
| `--external all`               | Attempt GET downloads from general external URLs too; HTML and login pages are not accepted as original files |
| `--external none`              | Retain external link addresses only; continue collecting Teams and SharePoint files                           |
| `--refresh`                    | Traverse message history from the beginning and collect files again, retaining earlier raw message pages      |
| `--headless`                   | Run without a visible window after signing in; rerun with a visible browser if authentication is required     |
| `--channel chrome` or `msedge` | Use an installed Chrome or Edge browser; use the same option for login and backup                             |
| `--profile PATH`               | Specify a dedicated login profile; avoid using your everyday browser profile                                  |
| `--self-id MRI`                | Supply your user MRI if automatic discovery fails; stored only in the private archive settings                |

External NAS and folder links are retained as addresses by default. The exporter does not recursively copy entire NAS roots or large research datasets. If you also need a directory listing, export it from the NAS interface and keep it separately. Direct attachments and linked files are collected according to the selected scope.

## 2. Sign in and collect data

```bash
node bin/teams-backup.cjs login
node bin/teams-backup.cjs backup --output ../my-private-teams-archive --external all --onedrive
```

Complete Microsoft sign-in and MFA directly in the browser window. There is no need to copy passwords or verification codes into source code or chat. Continue until the Teams chat screen loads. If Teams offers to open the desktop application, continue in the web browser.

When using `--onedrive`, also open the Files/OneDrive screen in the backup browser so the exporter can observe its authenticated origin. If discovery fails, the exporter records the issue in `library-inventory.json`. SharePoint authentication is bound to each site's origin; bearer tokens from another origin are not forwarded.

Default locations for the dedicated browser profile:

- Windows: `%LOCALAPPDATA%/teams-offline-backup/browser`
- macOS: `~/Library/Application Support/teams-offline-backup/browser`
- Linux: `~/.local/share/teams-offline-backup/browser`

This profile contains login cookies, so keep it outside both the archive folder and the public repository. Authentication headers are used only in memory during execution. Fields containing preauthenticated download URLs and common tokens are filtered when API responses are saved. Sensitive information written into message bodies is not automatically anonymized.

## 3. Resume an interrupted run and refresh the archive

Rerun with the same `--output` path to skip completed message collection and resume interrupted conversations from their checkpoints. Completed files are reused after their size and SHA-256 are checked. Failed files are retried. If a download stops partway through a file, that file is downloaded again from the beginning; byte-range resume is not supported.

```bash
node bin/teams-backup.cjs backup --output ../my-private-teams-archive
```

To collect new messages and changed files, run:

```bash
node bin/teams-backup.cjs backup --output ../my-private-teams-archive --refresh --external all --onedrive
```

A refresh traverses all message pages and can take time. Previously saved messages remain in the archive even if they disappear from the server inventory. If a file refresh fails, the exporter preserves the verified earlier copy and records `lastAttempt`. A successful download updates the current file; the exporter does not retain every historical file version.

If an interrupted process leaves `.backup.lock` behind, first confirm that no other collection process is running, then remove that file from the output directory. Do not run multiple processes against the same browser profile or output directory at the same time.

## 4. Preserve lab spreadsheets and external documents

Excel files from SharePoint/Teams and discovered spreadsheet tabs are linked to their saved originals in the viewer. XLSX/XLSM previews include cell values, formulas, merged ranges, basic styles, and embedded images. XLS/CSV previews show basic cell data. Hidden worksheets are also displayed, and downloaded originals are retained.

The exporter attempts direct downloads from public export URLs such as Google Sheets. It does not copy or bypass login sessions for Google, Hancom Docs, NAS services, or other external applications. Export the following items directly through their service interfaces when needed:

- Spreadsheets: save the original XLSX, plus CSV/PDF copies if useful.
- Tables inside applications such as Microsoft Lists: export CSV/XLSX.
- Loop, OneNote, and dynamic pages: save an available original and a readable PDF.
- Links requiring authentication or permission: download the original using an account with access.

Find the item's `key` in `unavailable-files.csv`, then associate your exported file with that item:

```bash
node bin/teams-backup.cjs import-file --output ../my-private-teams-archive --key ASSET_KEY --file ../exports/lab-sheet.xlsx
```

Manual imports are recorded as copies associated by the user. Their correspondence to the remote version is not independently verified. Items you cannot access can remain recorded as failures. A folder listing or PDF preserves a different view of the material and does not replace all underlying data files.

## 5. Verify while the account is still accessible

```bash
node bin/teams-backup.cjs verify --output ../my-private-teams-archive
```

Open `verification.html` in the output directory and review:

1. **File integrity:** do the actual sizes and SHA-256 hashes match files marked complete?
2. **Inventory coverage:** did the server return a partial inventory, or did pagination stop early?
3. **Conversations and libraries:** are any collections failed or incomplete?
4. **Spreadsheets:** did any preview conversions fail, and can you open the originals separately?
5. **Unavailable files:** review permission errors, deleted files, login requirements, and address-only entries in `unavailable-files.csv`.
6. **Cache-only messages:** are there browser-cached records that could not be retrieved from the server again?

`SHA256SUMS.txt` lists checksums for verified original files and profile images. The verifier also checks that message artifacts exist, but it cannot independently prove that every server-side item has been collected. Compare important channels and spreadsheets with their original interfaces, accounting for retention policies, private-channel permissions, deletions, and API changes.

Disconnect from the internet and open `index.html` to inspect older conversations, images, files, and important spreadsheets. Copy **the entire output folder** to another disk as well. Copying `index.html` alone leaves the other archive files behind.

## Troubleshooting

| Symptom                                         | What to check                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Service or API discovery fails                  | Rerun `login`, reach the web chat screen, and check for organization restrictions or API changes                    |
| 401                                             | The session may have expired; sign in again with the browser visible                                                |
| 403/404                                         | Check permissions and whether the original still exists; both metadata requests and shared-link resolution can fail |
| HTML returned instead of a file                 | It may be a login or preview page; use the service's download button, then import the exported file                 |
| OneDrive is not discovered                      | Open Files/OneDrive in the backup browser and retry collection                                                      |
| A spreadsheet shows formulas instead of results | Cached calculation results are missing; calculate and save the original in Excel, or inspect the original directly  |
| A recording appears only as an image            | Check for `recording-thumbnail`; obtain the original video separately                                               |
| Exit code 2                                     | The run completed with items requiring review; open the verification report                                         |
| Insufficient disk space                         | Free space on the output drive and review the scope of large libraries                                              |

The collector relies on internal Teams web APIs. For an official organization-wide export route, see the [Microsoft Teams Export API documentation](https://learn.microsoft.com/en-us/microsoftteams/export-teams-content).
