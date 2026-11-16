"""Build the portable SQLite search database after the viewer has been built."""
import json
import sys
from pathlib import Path
from archive import ROOT
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
from archive_search import build_index

print(json.dumps(build_index(ROOT)))
