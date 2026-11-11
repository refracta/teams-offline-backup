"""An invented lab schedule. No real spreadsheet is read by this generator."""

import datetime
import io
import zipfile
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from archive import ROOT, SETTINGS

if SETTINGS.get("synthetic") is not True:
    raise SystemExit("Synthetic demo only")
book = openpyxl.Workbook()
book.properties.creator = "Teams Offline Backup synthetic demo"
book.properties.lastModifiedBy = "Synthetic demo generator"
book.properties.title = "Fictional lab schedule"
book.properties.created = datetime.datetime(2030, 4, 18)
book.properties.modified = datetime.datetime(2030, 4, 18)
sheet = book.active
sheet.title = "가상 랩실 일정"
sheet.append(["DEMO LAB · 가상 랩실 시트"])
sheet.merge_cells("A1:F1")
sheet.append(["이 문서의 인물, 일정, 수치는 모두 새로 만든 가상 데이터입니다."])
sheet.merge_cells("A2:F2")
sheet.append([])
sheet.append(["날짜", "담당자", "실험 / 작업", "장비", "상태", "메모"])
rows = [
    [
        "2030-04-18",
        "Alex Demo",
        "측정 기준 정리",
        "Demo sensor A",
        "완료",
        "첫 번째 기준값",
    ],
    ["2030-04-19", "Blair Demo", "샘플 비교", "Demo sensor B", "예정", "세 번 반복"],
    [
        "2030-04-20",
        "Casey Demo",
        "데이터 검토",
        "Demo station",
        "예정",
        "표와 이미지 정리",
    ],
    ["2030-04-22", "Alex Demo", "주간 미팅", "Demo room", "예정", "오전 10:00 KST"],
    [
        "2030-04-23",
        "Blair Demo",
        "보고서 작성",
        "Demo desk",
        "예정",
        "가상 결과만 포함",
    ],
    [
        "2030-04-24",
        "Casey Demo",
        "최종 확인",
        "Demo station",
        "예정",
        "체크리스트 검토",
    ],
]
for row in rows:
    sheet.append(row)
for col, width in zip("ABCDEF", [18, 22, 27, 24, 14, 35]):
    sheet.column_dimensions[col].width = width
sheet.freeze_panes = "C5"
sheet.auto_filter.ref = "A4:F10"
sheet.row_dimensions[1].height = 42
sheet.row_dimensions[2].height = 30
sheet.row_dimensions[4].height = 32
for row in sheet:
    for cell in row:
        cell.font = Font(name="Arial", size=11, color="25283D")
        cell.alignment = Alignment(vertical="center", wrap_text=True)
        cell.border = Border(bottom=Side(style="hair", color="DFE1ED"))
        if cell.row >= 5:
            cell.fill = PatternFill(
                "solid", fgColor="F3F4FA" if cell.row % 2 else "FFFFFF"
            )
            sheet.row_dimensions[cell.row].height = 38
        if cell.row in (1, 4):
            cell.fill = PatternFill("solid", fgColor="5B5FC7")
            cell.font = Font(
                name="Arial",
                size=18 if cell.row == 1 else 11,
                bold=True,
                color="FFFFFF",
            )
for cell in sheet["E"][4:]:
    cell.fill = PatternFill("solid", fgColor="E3F2E9")
    cell.font = Font(name="Arial", color="226740", bold=True)
values = book.create_sheet("가상 측정값")
for row in [
    ["샘플", "A (ms)", "B (ms)", "평균 (수식)"],
    ["Demo-01", 12.4, 12.8, "=AVERAGE(B2:C2)"],
    ["Demo-02", 11.6, 11.9, "=AVERAGE(B3:C3)"],
    ["Demo-03", 10.2, 10.5, "=AVERAGE(B4:C4)"],
]:
    values.append(row)
for col in "ABCD":
    values.column_dimensions[col].width = 24
values.freeze_panes = "A2"
raw = io.BytesIO()
book.save(raw)
# Fixed ZIP timestamps keep this generated binary reproducible and metadata clean.
target = ROOT / "files/demo/demo-lab.xlsx"
target.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(raw) as source, zipfile.ZipFile(
    target, "w", zipfile.ZIP_DEFLATED
) as dest:
    for name in sorted(source.namelist()):
        payload = source.read(name)
        if name == "docProps/core.xml":
            import re

            payload = re.sub(
                rb"<dcterms:modified[^>]*>.*?</dcterms:modified>",
                b'<dcterms:modified xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="dcterms:W3CDTF">2030-04-18T00:00:00Z</dcterms:modified>',
                payload,
            )
        info = zipfile.ZipInfo(name, date_time=(2030, 4, 18, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        dest.writestr(info, payload)
