"""Integration tests use only the synthetic demo and temporary credentials."""
import base64
import importlib.util
import json
import shutil
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "lib"))
from archive_search import build_index, execute, read_js, kst, utc

spec = importlib.util.spec_from_file_location("archive_server", REPO / "bin/serve-archive.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SearchServer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name) / "archive"
        shutil.copytree(REPO / "demo", cls.root)
        build_index(cls.root)
        cls.server = module.Server(("127.0.0.1", 0), cls.root, module.make_auth("reader", "test-only-password", "https://archive.example.com"))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = "http://127.0.0.1:" + str(cls.server.server_port)
        cls.auth = "Basic " + base64.b64encode(b"reader:test-only-password").decode()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.temp.cleanup()

    def request(self, path, authorized=True, data=None, headers=None, method=None):
        headers = headers or {}
        if authorized:
            headers["Authorization"] = self.auth
        if data is not None:
            data = json.dumps(data).encode()
            headers["Content-Type"] = "application/json"
        req = Request(self.url + path, data=data, headers=headers, method=method)
        try:
            return urlopen(req, timeout=10)
        except HTTPError as error:
            return error

    def test_teams_seven_digit_timestamps_and_kst_filters(self):
        self.assertEqual(kst("2030-04-18T03:24:56.1234567Z"), "2030. 04. 18. 오후 12:24")
        self.assertEqual(utc("2030-04-18T03:24:56.1234567Z"), "2030-04-18T03:24:56.123456Z")
        self.assertEqual(utc("2030-04-18T12:24:56"), "2030-04-18T03:24:56.000000Z")

    def test_status_uses_verification_that_finished_after_indexing(self):
        report = self.root / "verification.json"
        previous = report.read_bytes()
        try:
            updated = json.loads(previous)
            updated["refreshFailures"] = 7
            report.write_text(json.dumps(updated), encoding="utf-8")
            result = execute(self.root, "archive_status", {})
            self.assertEqual(result["coverage"]["refreshFailures"], 7)
        finally:
            report.write_bytes(previous)

    def test_auth_protects_every_route(self):
        for path in ("/", "/app/data.js", "/files/demo/demo-lab.xlsx", "/api/tools", "/api/status", "/raw/server-inventory.json"):
            with self.request(path, authorized=False) as response:
                self.assertEqual(response.status, 401, path)
                self.assertIn("Basic", response.headers["WWW-Authenticate"])
        with self.request("/api/call", authorized=False, data={"name":"archive_status"}) as response:
            self.assertEqual(response.status, 401)
        with self.request("/", authorized=False, headers={"Authorization": "Basic invalid"}) as response:
            self.assertEqual(response.status, 401)

    def test_index_excludes_retired_sheet_previews_after_refresh(self):
        root = Path(self.temp.name) / "retired-preview-archive"
        shutil.copytree(REPO / "demo", root)
        original = build_index(root)["counts"]["sheet"]
        book = read_js(next((root / "app/sheets").glob("*.js")))
        book["key"] = "retired-preview"
        book["sheets"] = [{"name": "Retired worksheet", "cells": [[1, 1, "obsoletecellmarker", ""]]}]
        stale = root / "app/sheets/retired-preview.js"
        stale.write_text('window.__teamsBackupSheet("retired-preview",' + json.dumps(book) + ');', encoding="utf-8")
        self.assertEqual(build_index(root)["counts"]["sheet"], original)
        self.assertEqual(execute(root, "search_archive", {"query": "obsoletecellmarker", "kind": "sheet"})["total"], 0)
        self.assertTrue(stale.is_file())
        # Older archives without an export summary retain their previous behavior.
        (root / "sheet-summary.json").unlink()
        self.assertEqual(build_index(root)["counts"]["sheet"], original + 1)

    def test_search_context_sheets_and_injection(self):
        result = execute(self.root, "search_archive", {"query": "Demo", "kind": "message", "limit": 2})
        self.assertEqual(len(result["items"]), 2)
        found = result["items"][0]
        context = execute(self.root, "get_message_context", {"conversation": found["conversationKey"], "message": found["id"], "before": 2, "after": 2})
        self.assertIn(found["id"], [x["id"] for x in context["items"]])
        self.assertLessEqual(len(context["items"]), 5)
        self.assertTrue(found["timeKST"])
        file_hit = execute(self.root, "search_archive", {"query": "demo", "kind": "file", "limit": 1})["items"][0]
        self.assertIn("view=files&file=", file_hit["url"])
        info = execute(self.root, "get_file_info", {"key": file_hit["key"]})
        self.assertEqual(info["url"], file_hit["url"])
        with self.request("/file-manifest.json") as response:
            self.assertEqual(response.status, 200)
        self.assertEqual(execute(self.root, "search_archive", {"query": "' OR 1=1 --"})["total"], 0)
        book = read_js(next((self.root / "app/sheets").glob("*.js")))
        rows = execute(self.root, "get_sheet_rows", {"key": book["key"], "sheet": 0, "start": 1, "limit": 2})
        self.assertTrue(rows["items"])
        self.assertLessEqual(len(rows["items"]), 2)
        with self.request("/api/call", data={"name": "search_archive", "arguments": {"query": "Demo", "limit": 2}}) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(len(json.load(response)["items"]), 2)

    def test_scope_and_origin_guards(self):
        for path in ("/raw/server-inventory.json", "/agent/search.sqlite", "/../secret", "/app/%2e%2e/%2e%2e/secret", "/app/%5c..%5csecret", "/files/"):
            with self.request(path) as response:
                self.assertEqual(response.status, 404, path)
        secret = Path(self.temp.name) / "secret.txt"
        secret.write_text("outside archive")
        (self.root / "files/escape.txt").symlink_to(secret)
        with self.request("/files/escape.txt") as response:
            self.assertEqual(response.status, 404)
        with self.request("/api/call", data={"name": "archive_status"}, headers={"Origin": "https://another.example.com"}) as response:
            self.assertEqual(response.status, 403)

    def test_original_download_and_byte_range(self):
        path = "/files/demo/demo-lab.xlsx"
        expected = (self.root / path.lstrip("/")).read_bytes()
        with self.request(path, headers={"Range": "bytes=0-19"}) as response:
            self.assertEqual(response.status, 206)
            self.assertEqual(response.read(), expected[:20])
            self.assertIn("no-store", response.headers["Cache-Control"])
        with self.request(path, headers={"Range": "bytes=-10"}) as response:
            self.assertEqual(response.read(), expected[-10:])
        with self.request(path, headers={"Range": "bytes=999999999-"}) as response:
            self.assertEqual(response.status, 416)
        with self.request(path, method="HEAD") as response:
            self.assertEqual(int(response.headers["Content-Length"]), len(expected))
            self.assertEqual(response.read(), b"")


if __name__ == "__main__":
    unittest.main()
