"""Shared archive location; real archives never belong in the source checkout."""

import json
import os
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
if not os.environ.get("TEAMS_ARCHIVE"):
    raise SystemExit("Use the CLI with --output pointing outside the repository.")
ROOT = Path(os.environ["TEAMS_ARCHIVE"]).expanduser().resolve()
if ROOT == REPO or REPO in ROOT.parents:
    if not (os.environ.get("TEAMS_SYNTHETIC") == "1" and ROOT == REPO / "demo"):
        raise SystemExit("Private archives must be outside the repository.")
SETTINGS = json.loads((ROOT / "archive-settings.json").read_text(encoding="utf-8"))
if ROOT == REPO / "demo" and SETTINGS.get("synthetic") is not True:
    raise SystemExit("Only synthetic fixtures may be built inside the repository.")
