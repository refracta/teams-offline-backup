"""Exercise the actual renderer with invented hostile input, without an account."""

import os
import runpy
import sys
from pathlib import Path

repo = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(repo / "scripts"))
ns = runpy.run_path(str(repo / "scripts/build-teams-ui.py"))
clean = ns["clean"]
output = clean(
    '<script>window.bad=1</script><iframe src="https://example.invalid"></iframe><p onclick="bad()">kept</p><a href="javascript:bad()">link</a><img src="https://example.invalid/private.png" onerror="bad()">'
)
assert (
    "window.bad" not in output
    and "onclick" not in output
    and "javascript:" not in output
)
assert "onerror" not in output and "<iframe" not in output and "<script" not in output
assert "kept" in output and "<img" not in output
card = ns["adaptive"](
    {"type": "Action.OpenUrl", "title": "synthetic action", "url": "javascript:bad()"}
)
assert "javascript:" not in card and 'href="#"' in card
math = clean(
    '<math display="block"><semantics><mi>x</mi><annotation encoding="application/x-tex">x^2+1</annotation></semantics></math>'
)
assert "$$x^2+1$$" in math
root = Path(os.environ["TEAMS_ARCHIVE"])
probe = root / "xml-entity-test.txt"
probe.write_text("SYNTHETIC_ENTITY_MUST_NOT_BE_EXPANDED")
event = ns["system"](
    {
        "type": "ThreadActivity/TopicUpdate",
        "content": '<!DOCTYPE a [<!ENTITY secret SYSTEM "'
        + probe.as_uri()
        + '">]><a><value>&secret;</value></a>',
    }
)
assert "SYNTHETIC_ENTITY_MUST_NOT_BE_EXPANDED" not in event
print("RENDERER PASS")
