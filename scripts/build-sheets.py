"""Export workbook values, formulas, styles and embedded pictures for offline reading."""

import json, hashlib, re, datetime, csv, io, collections
from pathlib import Path
import openpyxl
from openpyxl.utils import get_column_letter
from openpyxl.styles.colors import COLOR_INDEX as COLOR_INDEXED
from archive import ROOT, SETTINGS

APP = ROOT / "app/sheets"
APP.mkdir(parents=True, exist_ok=True)


def read(p):
    return json.loads(p.read_text(encoding="utf-8"))


def save(p, o):
    p.write_text(json.dumps(o, ensure_ascii=False, indent=2), encoding="utf-8")


def color(c):
    if not c:
        return None
    if c.type == "rgb" and isinstance(c.rgb, str):
        return "#" + c.rgb[-6:]
    if (
        c.type == "indexed"
        and isinstance(c.indexed, int)
        and c.indexed < len(COLOR_INDEXED)
    ):
        return "#" + COLOR_INDEXED[c.indexed][-6:]
    return None


def display(v, fmt="General"):
    if v is None:
        return ""
    if isinstance(v, datetime.datetime):
        return (
            v.isoformat(sep=" ", timespec="minutes")
            if v.time() != datetime.time()
            else v.date().isoformat()
        )
    if isinstance(v, (datetime.date, datetime.time)):
        return v.isoformat()
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        try:
            decimal = re.search(r"0\.(0+)", fmt)
            places = len(decimal[1]) if decimal else 0
            if "%" in fmt:
                return f"{v*100:.{places}f}%"
            if "," in fmt and not any(x in fmt.lower() for x in ["yy", "dd", "h:"]):
                return f"{v:,.{places}f}"
        except:
            pass
        return format(v, ".15g")
    return str(v)


states = []
for dr in ["file-states", "external-states"]:
    for p in (ROOT / "raw" / dr).glob("*.json"):
        try:
            s = read(p)
        except:
            continue
        if s.get("status") in ["complete", "linked-existing"] and s.get(
            "localPath", ""
        ).lower().endswith((".xlsx", ".xlsm", ".xls", ".csv")):
            states.append(s)
for item in (
    read(ROOT / "local-recovery.json")
    if (ROOT / "local-recovery.json").exists()
    else []
):
    for c in item.get("candidates", []):
        if c.get("localPath", "").lower().endswith((".xlsx", ".xlsm", ".xls", ".csv")):
            states.append({**c, "localCandidate": True})
previous = (
    {
        x["key"]: x
        for x in read(ROOT / "sheet-summary.json")
        if x.get("key") and x.get("status") == "complete"
    }
    if (ROOT / "sheet-summary.json").exists()
    else {}
)
mapping = {}
summaries = []
done = {}
for s in states:
    rel = s["localPath"]
    p = ROOT / rel
    if not p.exists():
        continue
    if (s.get("name") or p.name.split("__", 1)[-1]).startswith("~$"):
        continue
    sha = s.get("sha256") or hashlib.sha256(p.read_bytes()).hexdigest()
    key = sha[:20]
    if key in done:
        mapping[rel] = key
        continue
    if key in previous and (APP / (key + ".js")).exists():
        try:
            payload = (APP / (key + ".js")).read_text()
            cached = json.loads(payload[payload.index(",") + 1 : -2])
            old = previous[key]
            if cached["original"] != rel:
                cached["original"] = rel
                cached["name"] = s.get("name") or p.name
                cached["localCandidate"] = bool(s.get("localCandidate"))
                (APP / (key + ".js")).write_text(
                    "window.__teamsBackupSheet("
                    + json.dumps(key)
                    + ","
                    + json.dumps(
                        cached, ensure_ascii=False, separators=(",", ":")
                    ).replace("</", "<\\/")
                    + ");",
                    encoding="utf-8",
                )
            mapping[rel] = key
            done[key] = True
            summaries.append({**old, "localPath": rel, "name": cached["name"]})
            continue
        except (ValueError, KeyError, OSError):
            pass
    try:
        sheets = []
        styles = []
        stylemap = {}
        images = []

        def style(c):
            if c.style_id in stylemap:
                return stylemap[c.style_id]
            d = {}
            font = c.font
            alignment = c.alignment
            fill = c.fill
            if font.b:
                d["font-weight"] = "600"
            if font.i:
                d["font-style"] = "italic"
            if font.sz:
                d["font-size"] = str(min(40, max(8, font.sz))) + "pt"
            if color(font.color):
                d["color"] = color(font.color)
            if fill.patternType == "solid" and color(fill.fgColor):
                d["background-color"] = color(fill.fgColor)
            if alignment.horizontal in ["left", "center", "right", "justify"]:
                d["text-align"] = alignment.horizontal
            if alignment.vertical in ["top", "center", "bottom"]:
                d["vertical-align"] = (
                    "middle" if alignment.vertical == "center" else alignment.vertical
                )
            if alignment.wrap_text:
                d["white-space"] = "pre-wrap"
            if font.u:
                d["text-decoration"] = "underline"
            for side in ["top", "bottom", "left", "right"]:
                b = getattr(c.border, side)
                if b and b.style:
                    d["border-" + side] = "1px solid " + (color(b.color) or "#b6bbc4")
            stylemap[c.style_id] = len(styles)
            styles.append(";".join(k + ":" + v for k, v in d.items()))
            return stylemap[c.style_id]

        if p.suffix.lower() in [".xlsx", ".xlsm"]:
            wb = openpyxl.load_workbook(p, data_only=False)
            cached = openpyxl.load_workbook(p, data_only=True)
            for ws in wb.worksheets:
                cells = []
                maxrow = 1
                maxcol = 1
                for c in ws._cells.values():
                    if c.value is None:
                        continue
                    formula = c.value if c.data_type == "f" else None
                    if formula is not None and not isinstance(formula, str):
                        formula = getattr(formula, "text", str(formula))
                    value = (
                        cached[ws.title].cell(c.row, c.column).value
                        if formula
                        else c.value
                    )
                    cells.append(
                        [
                            c.row,
                            c.column,
                            display(value, c.number_format),
                            formula,
                            style(c),
                            c.hyperlink.target if c.hyperlink else None,
                        ]
                    )
                    maxrow = max(maxrow, c.row)
                    maxcol = max(maxcol, c.column)
                merges = [
                    list(x.bounds)
                    for x in ws.merged_cells.ranges
                    if x.min_row <= maxrow and x.min_col <= maxcol
                ]
                for a, b, c, d in merges:
                    maxrow = max(maxrow, d)
                    maxcol = max(maxcol, c)
                pic = []
                for i, img in enumerate(ws._images):
                    try:
                        data = img._data()
                        name = f'files/sheet-images/{key}-{len(sheets)}-{i}.{img.format or "png"}'
                        dest = ROOT / name
                        dest.parent.mkdir(exist_ok=True, parents=True)
                        dest.write_bytes(data)
                        anchor = img.anchor
                        pos = getattr(anchor, "_from", None)
                        pic.append(
                            {
                                "path": name,
                                "row": pos.row + 1 if pos else 1,
                                "col": pos.col + 1 if pos else 1,
                                "width": img.width,
                                "height": img.height,
                            }
                        )
                    except Exception:
                        pass
                # Include styles on blank cells only within the actual used data rectangle.
                for c in ws._cells.values():
                    if (
                        c.value is None
                        and c.has_style
                        and c.row <= maxrow
                        and c.column <= maxcol
                    ):
                        cells.append([c.row, c.column, "", None, style(c), None])
                sheets.append(
                    {
                        "name": ws.title,
                        "state": ws.sheet_state,
                        "rows": maxrow,
                        "cols": maxcol,
                        "cells": cells,
                        "merges": merges,
                        "images": pic,
                        "widths": {
                            str(i): min(
                                600,
                                max(
                                    36,
                                    (
                                        ws.column_dimensions[get_column_letter(i)].width
                                        or 13
                                    )
                                    * 7
                                    + 5,
                                ),
                            )
                            for i in range(1, maxcol + 1)
                        },
                        "heights": {
                            str(k): v.height * 1.333
                            for k, v in ws.row_dimensions.items()
                            if v.height
                        },
                        "freeze": str(ws.freeze_panes or ""),
                        "charts": len(ws._charts),
                    }
                )
            wb.close()
            cached.close()
        elif p.suffix.lower() == ".csv":
            data = p.read_bytes()
            for enc in ["utf-8-sig", "cp949", "utf-16"]:
                try:
                    txt = data.decode(enc)
                    break
                except UnicodeError:
                    pass
            else:
                txt = data.decode("utf-8", errors="replace")
            rows = list(csv.reader(io.StringIO(txt)))
            sheets = [
                {
                    "name": p.stem,
                    "rows": len(rows),
                    "cols": max(map(len, rows), default=1),
                    "cells": [
                        [r + 1, c + 1, v, None, 0, None]
                        for r, row in enumerate(rows)
                        for c, v in enumerate(row)
                        if v
                    ],
                    "merges": [],
                    "images": [],
                    "widths": {},
                    "heights": {},
                }
            ]
            styles = [""]
        else:
            import xlrd

            wb = xlrd.open_workbook(p)
            styles = [""]
            for ws in wb.sheets():
                sheets.append(
                    {
                        "name": ws.name,
                        "rows": ws.nrows,
                        "cols": ws.ncols,
                        "cells": [
                            [r + 1, c + 1, display(ws.cell_value(r, c)), None, 0, None]
                            for r in range(ws.nrows)
                            for c in range(ws.ncols)
                            if ws.cell_value(r, c) != ""
                        ],
                        "merges": [],
                        "images": [],
                        "widths": {},
                        "heights": {},
                    }
                )
        obj = {
            "key": key,
            "name": s.get("name") or p.name,
            "original": rel,
            "localCandidate": bool(s.get("localCandidate")),
            "styles": styles,
            "sheets": sheets,
        }
        payload = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace(
            "</", "<\\/"
        )
        (APP / (key + ".js")).write_text(
            "window.__teamsBackupSheet(" + json.dumps(key) + "," + payload + ");",
            encoding="utf-8",
        )
        mapping[rel] = key
        done[key] = True
        summaries.append(
            {
                "key": key,
                "name": obj["name"],
                "localPath": rel,
                "sheets": len(sheets),
                "cells": sum(len(x["cells"]) for x in sheets),
                "status": "complete",
            }
        )
    except Exception as e:
        summaries.append({"localPath": rel, "status": "failed", "error": str(e)})
save(ROOT / "sheet-map.json", mapping)
save(ROOT / "sheet-summary.json", summaries)
print(
    json.dumps(
        {
            "workbooks": len(done),
            "paths": len(mapping),
            "sheets": sum(x.get("sheets", 0) for x in summaries),
            "errors": [x for x in summaries if x["status"] == "failed"],
        },
        ensure_ascii=False,
    )
)
