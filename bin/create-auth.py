#!/usr/bin/env python3
"""Create a private hashed HTTP Basic configuration without command-line passwords."""
import argparse
import getpass
import importlib.util
import json
import os
from pathlib import Path

spec = importlib.util.spec_from_file_location("archive_server", Path(__file__).with_name("serve-archive.py"))
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--username", required=True)
parser.add_argument("--origin", required=True, help="The public HTTPS origin")
parser.add_argument("--output", required=True, help="Private configuration outside the repository and archive")
args = parser.parse_args()
target = Path(args.output).expanduser().resolve()
if any((directory / ".git").exists() for directory in (target.parent, *target.parents)):
    parser.error("Keep credentials outside Git working trees")
password = getpass.getpass("Archive password: ")
if len(password) < 12 or password != getpass.getpass("Confirm password: "):
    parser.error("Passwords must match and contain at least 12 characters")
target.parent.mkdir(parents=True, exist_ok=True)
with os.fdopen(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as stream:
    json.dump(server.make_auth(args.username, password, args.origin), stream)
print("Private hashed authentication configuration created.")
