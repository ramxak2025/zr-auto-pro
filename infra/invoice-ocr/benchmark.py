"""Synthetic images only. Runs real pixel OCR, reports exact numeric cells."""
import io
import json
import time
from decimal import Decimal
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from ocr_core import recognize, header_columns, decimal_cell, OcrError

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def fixture(rows=2, grid=True):
    font = ImageFont.truetype(FONT, 27)
    width = 1800
    height = max(700, 270+rows*59)
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    draw.text((55, 35), "Учебная накладная — синтетический тест", fill="black", font=font)
    draw.text((55, 85), "Дата: 01.11.2026", fill="black", font=font)
    xs = [45, 715, 1005, 1170, 1310, 1545, 1765]
    headers = ["Наименование", "Артикул", "Кол-во", "Ед.", "Цена", "Сумма"]
    ground = []
    names = ["Фильтр масляный", "Рампа OMVL", "Колодки тормозные", "Масло моторное", "Ремень генератора"]
    values = [(Decimal("2"), Decimal("450.00")), (Decimal("1"), Decimal("1250.00")),
              (Decimal("3"), Decimal("134.50")), (Decimal("1.5"), Decimal("680.00")),
              (Decimal("4"), Decimal("231.75"))]
    for row in range(rows+1):
        y = 160+row*59
        if row == 0:
            labels = headers
        else:
            qty, price = values[(row-1) % len(values)]
            total = qty*price
            labels = [names[(row-1) % len(names)], f"AUTO-{100+row}", str(qty).replace(".", ","),
                      "шт", f"{price:.2f}".replace(".", ","), f"{total:.2f}".replace(".", ",")]
            ground.append({"quantity": str(qty), "price": str(price), "name": labels[0]})
        for col, label in enumerate(labels):
            draw.text((xs[col]+12, y+15), label, fill="black", font=font)
    if grid:
        for x in xs:
            draw.line((x, 160, x, 160+(rows+1)*59), fill="black", width=2)
        for row in range(rows+2):
            y = 160+row*59
            draw.line((xs[0], y, xs[-1], y), fill="black", width=2)
    draw.text((1315, 185+(rows+1)*59), "Итого: "+str(sum(Decimal(r["quantity"])*Decimal(r["price"]) for r in ground)).replace(".", ","), fill="black", font=font)
    return image, ground


def parsed_rows(result):
    rows = []
    for table in result.get("tables", []):
        header = header_columns(table)
        if not header:
            continue
        header_row, columns = header
        buckets = {}
        for cell in table["cells"]:
            buckets.setdefault(int(cell["rowIndex"]), {})[int(cell["columnIndex"])] = cell
        for row, cells in sorted(buckets.items()):
            if row <= header_row:
                continue
            rows.append({"quantity": cells.get(columns["qty"], {}).get("text", ""),
                         "price": cells.get(columns["price"], {}).get("text", ""),
                         "name": cells.get(columns["name"], {}).get("text", ""),
                         "warnings": [warning for cell in cells.values() for warning in cell.get("warnings", [])]})
    return rows


def evaluate(name, image, expected):
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    start = time.monotonic()
    try:
        result = recognize(buffer.getvalue())
        rows = parsed_rows(result)
        correct = sum(decimal_cell(row[field]) == Decimal(expected[index][field])
                      for index, row in enumerate(rows[:len(expected)]) for field in ("quantity", "price"))
        unknown = sum(not row[field] for row in rows for field in ("quantity", "price"))
        return {"fixture": name, "synthetic": True, "expectedRows": len(expected), "actualRows": len(rows),
                "numericCorrect": correct, "numericExpected": 2*len(expected), "numericUnknown": unknown,
                "elapsedMs": round((time.monotonic()-start)*1000), "rotate": result.get("rotate"),
                "warnings": result.get("warnings", []), "rows": rows,
                "fullText": result.get("fullText")}
    except OcrError as error:
        return {"fixture": name, "synthetic": True, "error": error.code,
                "elapsedMs": round((time.monotonic()-start)*1000)}


if __name__ == "__main__":
    cases = []
    for rows, grid, name in [(2, True, "clear-grid"), (2, False, "unruled"), (12, True, "dense-12"), (20, False, "dense-20-unruled")]:
        image, truth = fixture(rows, grid)
        cases.append((name, image, truth))
    image, truth = fixture(12, True)
    for angle in (90, 180, 270, 4):
        cases.append((f"rotate-{angle}", image.rotate(angle, expand=True, fillcolor="white"), truth))
    cases.append(("moderate-blur", image.filter(ImageFilter.GaussianBlur(1.4)), truth))
    for name, image, expected in cases:
        print(json.dumps(evaluate(name, image, expected), ensure_ascii=False), flush=True)
