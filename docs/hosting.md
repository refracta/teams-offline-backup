# Private hosting and WebMCP

Host the complete private archive separately from this source repository. Visitors on other computers need only the HTTPS address and HTTP Basic credentials; they do not need a Microsoft account or a local copy of the archive. Search covers messages, file metadata, and spreadsheet rows. Original files remain available for download.

The server uses Python's standard library, SQLite FTS5, and the trigram tokenizer. Python 3.12 from the official Docker image is a suitable runtime; some NAS-provided Python builds omit FTS5. Build the viewer and index before serving it:

```bash
node bin/teams-backup.cjs build --output /private/teams-archive
python3 bin/create-auth.py --username archive-reader \
  --origin https://archive.example.com --output /private/config/archive-auth.json
python3 bin/serve-archive.py --archive /private/teams-archive \
  --auth-file /private/config/archive-auth.json --host 127.0.0.1 --port 8765
```

The password prompt produces a salted PBKDF2 hash. Keep the configuration outside the archive and source tree. Never add real archives, credentials, browser profiles, private hostnames, or deployment configuration to this public repository. `build` may exit with code 2 when inaccessible source material is recorded; review `verification.html` separately from hosting availability.

## HTTPS reverse proxy

Put a dedicated HTTPS virtual host in front of the server. Example nginx location, inside a server block with your domain and certificate:

```nginx
client_max_body_size 64k;
access_log off;
location / {
    proxy_pass http://127.0.0.1:8765;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 300s;
}
```

Redirect HTTP to HTTPS. Route **every** viewer, attachment, and API request through the authenticated application. Do not add an unprotected static `alias` or `root` for the archive. The application requires authentication even when its backend port is reached directly. Bind the port to loopback when the proxy shares the host, or to a private interface restricted to the proxy otherwise.

For a container, mount the source, archive, and authentication directory read-only, use an unprivileged user matching their owner, and configure a restart policy. Example (replace every path and UID/GID):

```bash
docker run -d --name teams-archive --restart unless-stopped \
  --user 1000:1000 --read-only --cap-drop ALL --security-opt no-new-privileges \
  -p 127.0.0.1:8765:8765 \
  -v /path/to/source:/service:ro -v /private/teams-archive:/archive:ro \
  -v /private/config:/config:ro -w /service python:3.12-bookworm \
  python bin/serve-archive.py --archive /archive --auth-file /config/archive-auth.json \
  --host 0.0.0.0 --port 8765
```

Original-file responses support byte ranges for large downloads. Raw collection evidence, the database, logs, and credentials are not served as static files. Uploaded HTML/SVG is downloaded with a sandbox policy. The viewer can still be opened locally through `file://` without a server.

## Browser tools and other computers

The page registers six read-only tools through `document.modelContext` when available, with a compatibility fallback for older `navigator.modelContext` previews. WebMCP is experimental and browser/agent support varies; see the [WebMCP draft](https://webmachinelearning.github.io/webmcp/) and [Chrome documentation](https://developer.chrome.com/docs/ai/webmcp). A missing WebMCP implementation does not prevent normal website search or use of the authenticated JSON API.

The registered tools and JSON API share the same implementation. There is no cross-origin access, write tool, credential-bearing URL, or live Teams action. Archived text is labeled as untrusted content. This is not a remote MCP JSON-RPC transport server.

See the [agent guide](agent-guide.md) for tool names, API calls, source citations, local Python search, and a portable private connection file for another computer. Results contain links into the viewer and original downloads; worksheet links select the worksheet and row.

## Updating and verifying

Run an incremental backup, rebuild the viewer/index, and synchronize changes to the private server. Preserve previous files and reports. Transfer via SSH with a resumable tool; do not publish a partly transferred archive as a completed backup. SQLite indexes are built in a temporary file and renamed after completion.

Check the public HTTPS URL from a second machine or browser session. Unauthenticated `/`, `/app/data.js`, `/files/...`, `/api/tools`, and `/api/call` must return 401. With authentication, verify a message search, neighboring-message context, a sheet result, and a ranged original download. Check `archive_status` against the latest backup date and review the integrity report. A successful website response alone does not prove all attachments arrived.
