#!/usr/bin/env python3
"""Search a local archive or its authenticated HTTPS endpoint without scanning the file tree."""
import argparse
import base64
import json
import sys
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
from archive_search import execute


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", help="Local archive directory (defaults to the parent of agent/search.py)")
    parser.add_argument("--connection", help="Private JSON file with url, username, password; never commit it")
    parser.add_argument("--tool", default="search_archive")
    parser.add_argument("--args", default="{}", help="JSON arguments for the selected tool")
    parser.add_argument("query", nargs="?")
    options = parser.parse_args()
    arguments = json.loads(options.args)
    if options.query:
        arguments["query"] = options.query
    if options.connection:
        config = json.loads(Path(options.connection).read_text(encoding="utf-8"))
        url = config["url"].rstrip("/")
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.username or parsed.password:
            parser.error("Remote connections require an HTTPS URL without embedded credentials")
        auth = base64.b64encode((config["username"] + ":" + config["password"]).encode()).decode()
        request = Request(url + "/api/call", data=json.dumps({"name": options.tool, "arguments": arguments}).encode(),
                          headers={"Authorization": "Basic " + auth, "Content-Type": "application/json"})
        # Redirects are not followed: Basic credentials belong only to this origin.
        from urllib.request import build_opener, HTTPRedirectHandler
        class NoRedirect(HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None
        with build_opener(NoRedirect).open(request, timeout=60) as response:
            result = json.load(response)
    else:
        root = options.archive or Path(__file__).resolve().parent.parent
        result = execute(root, options.tool, arguments)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Archive search failed: " + str(error), file=sys.stderr)
        sys.exit(1)
