#!/usr/bin/env python3
"""Authenticated static viewer and read-only search API. Put TLS in front of this server."""
import argparse
import base64
import hashlib
import hmac
import json
import mimetypes
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
from archive_search import execute, tool_descriptions


def make_auth(username, password, origin):
    salt = os.urandom(24).hex()
    iterations = 310000
    return {"username": username, "salt": salt, "iterations": iterations,
            "passwordHash": hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), iterations).hex(),
            "origin": origin.rstrip("/")}


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, root, auth):
        self.root = Path(root).resolve()
        self.auth = auth
        self.authorized_hash = None
        super().__init__(address, Handler)


class Handler(BaseHTTPRequestHandler):
    server_version = "TeamsArchive"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        # Do not log URLs, queries, archive content, or Authorization headers.
        pass

    def setup(self):
        super().setup()
        self.connection.settimeout(30)

    def response_headers(self, code, size, content_type="application/json; charset=utf-8", extra=None):
        self.send_response(code)
        self.send_header("Content-Length", str(size))
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "private, no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()

    def json(self, code, obj, extra=None):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.response_headers(code, len(data), extra=extra)
        if self.command != "HEAD":
            self.wfile.write(data)

    def authorize(self):
        value = self.headers_in.get("Authorization", "")
        digest = hashlib.sha256(value.encode()).digest()
        if self.server.authorized_hash and hmac.compare_digest(digest, self.server.authorized_hash):
            valid = True
        else:
            valid = False
            try:
                scheme, encoded = value.split(" ", 1)
                if scheme.lower() != "basic":
                    raise ValueError()
                username, password = base64.b64decode(encoded, validate=True).decode().split(":", 1)
                config = self.server.auth
                hashed = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(config["salt"]), config["iterations"]).hex()
                valid = hmac.compare_digest(username.encode(), config["username"].encode()) and hmac.compare_digest(hashed, config["passwordHash"])
            except (ValueError, UnicodeError):
                pass
        if not valid:
            self.close_connection = True
            self.json(401, {"error": "Authentication required"}, {"WWW-Authenticate": 'Basic realm="Teams archive", charset="UTF-8"', "Connection": "close"})
            return False
        self.server.authorized_hash = digest
        origin = self.headers_in.get("Origin")
        if origin and origin != self.server.auth["origin"]:
            self.close_connection = True
            self.json(403, {"error": "Cross-origin requests are not allowed"})
            return False
        return True

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        self.headers_in = self.headers
        if not self.authorize():
            return
        path = urlsplit(self.path).path
        if path == "/api/tools":
            return self.json(200, {"tools": tool_descriptions()})
        if path == "/api/status":
            return self.call("archive_status", {})
        if path.startswith("/api/"):
            return self.json(404, {"error": "Unknown endpoint"})
        try:
            relative = unquote(path).lstrip("/") or "index.html"
            parts = Path(relative).parts
            if ".." in parts or any(p.startswith(".") for p in parts) or "\\" in relative or "\x00" in relative:
                raise ValueError()
            if parts[0] not in ("app", "files", "index.html", "verification.html", "verification.json", "unavailable-files.csv", "AGENT_GUIDE.md", "AGENTS.md"):
                raise ValueError()
            file = (self.server.root / relative).resolve()
            if not file.is_relative_to(self.server.root) or not file.is_file():
                raise ValueError()
        except (ValueError, OSError):
            return self.json(404, {"error": "File not found"})
        size = file.stat().st_size
        start, end, code = 0, size - 1, 200
        extra = {"Accept-Ranges": "bytes"}
        request_range = self.headers_in.get("Range")
        if request_range:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", request_range)
            if not match or not any(match.groups()) or size == 0:
                return self.json(416, {"error": "Invalid range"}, {"Content-Range": f"bytes */{size}"})
            if match[1]:
                start = int(match[1])
                end = min(size - 1, int(match[2])) if match[2] else size - 1
            else:
                start = max(0, size - int(match[2]))
            if start > end or start >= size:
                return self.json(416, {"error": "Invalid range"}, {"Content-Range": f"bytes */{size}"})
            code = 206
            extra["Content-Range"] = f"bytes {start}-{end}/{size}"
        content_type = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        if parts[0] == "files":
            extra["Content-Security-Policy"] = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:;"
            if file.suffix.lower() in (".html", ".htm", ".svg", ".js", ".xml"):
                extra["Content-Disposition"] = "attachment"
        self.response_headers(code, end - start + 1, content_type, extra)
        if self.command != "HEAD":
            with file.open("rb") as stream:
                stream.seek(start)
                remaining = end - start + 1
                while remaining > 0:
                    chunk = stream.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)

    def call(self, name, arguments):
        try:
            return self.json(200, execute(self.server.root, name, arguments))
        except (ValueError, TypeError, KeyError) as error:
            return self.json(400, {"error": str(error)})
        except Exception:
            return self.json(503, {"error": "Search index unavailable; build the archive index first"})

    def do_POST(self):
        self.headers_in = self.headers
        if not self.authorize():
            return
        if urlsplit(self.path).path != "/api/call":
            self.close_connection = True
            return self.json(404, {"error": "Unknown endpoint"})
        try:
            size = int(self.headers_in.get("Content-Length", "0"))
            if not 0 < size <= 65536 or self.headers_in.get("Transfer-Encoding"):
                raise ValueError()
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict) or not isinstance(data.get("name"), str):
                raise ValueError()
        except (ValueError, UnicodeError):
            self.close_connection = True
            return self.json(400, {"error": "Invalid JSON request"})
        self.call(data["name"], data.get("arguments", {}))

    def do_OPTIONS(self):
        self.headers_in = self.headers
        if self.authorize():
            self.json(405, {"error": "Cross-origin access is disabled"})



def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--auth-file", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    options = parser.parse_args()
    auth_path = Path(options.auth_file).resolve()
    root = Path(options.archive).resolve()
    if auth_path.is_relative_to(root):
        parser.error("Keep the auth file outside the archive")
    auth = json.loads(auth_path.read_text())
    if not auth.get("username") or not auth.get("passwordHash") or not auth.get("origin", "").startswith(("https://", "http://localhost", "http://127.0.0.1")):
        parser.error("Invalid auth configuration")
    server = Server((options.host, options.port), root, auth)
    print("Authenticated archive server ready", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
