"""Bounded printed-invoice OCR. No catalog, database or network access.

Geometry comes from pixels/word boxes, never invoice-specific coordinates.
Cells preserve OCR evidence; low-confidence numbers are blank for manual input.
"""
from __future__ import annotations

import csv
import io
import json
import math
import os
import re
import resource
import statistics
import subprocess
import sys
import tempfile
import time
import warnings
from decimal import Decimal, InvalidOperation
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

cv2.setNumThreads(1)
Image.MAX_IMAGE_PIXELS = 20_000_000
MAX_BYTES = 10 * 1024 * 1024
MAX_PIXELS = 20_000_000
MAX_EDGE = 3000
MAX_CELLS = 2048
MAX_WORDS = 12000
NUMERIC_CONFIDENCE = 80.0
PAGE_SECONDS = 21.0


class OcrError(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def normalize(text: str) -> str:
    return re.sub(r"[^\w]+", " ", text.lower().replace("ё", "е")).strip()


def header_kind(text: str) -> str | None:
    value = normalize(text)
    for kind, pattern in (
        ("name", r"наимен|номенклат|название|товар|description"),
        ("qty", r"колич|кол во|quantity|qty"),
        ("price", r"^(?:цена|цен[аы] за|price|стоимость единиц|закупочная)"),
        ("sku", r"артикул|sku|^код$"),
        ("unit", r"^(?:ед|единиц|unit)"),
        ("total", r"сумма|итого|total|стоимость"),
    ):
        if re.search(pattern, value):
            return kind
    return None


def decimal_cell(text: str) -> Decimal | None:
    value = re.sub(r"\s+", "", text).replace(",", ".")
    if not re.fullmatch(r"\d+(?:\.\d{1,3})?", value):
        return None
    try:
        number = Decimal(value)
        return number if number <= 999999999 else None
    except InvalidOperation:
        return None


def decode_image(data: bytes) -> np.ndarray:
    if not data or len(data) > MAX_BYTES:
        raise OcrError("IMAGE_SIZE_LIMIT")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as original:
                if original.format not in {"JPEG", "PNG", "WEBP"} or getattr(original, "n_frames", 1) != 1:
                    raise OcrError("IMAGE_FORMAT_UNSUPPORTED")
                width, height = original.size
                if width < 32 or height < 32 or width * height > MAX_PIXELS:
                    raise OcrError("IMAGE_PIXEL_LIMIT")
                image = ImageOps.exif_transpose(original)
                image.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
                # Composite transparency on white; do not turn transparent ink/background black.
                if image.mode in {"RGBA", "LA"} or "transparency" in image.info:
                    rgba = image.convert("RGBA")
                    background = Image.new("RGBA", rgba.size, "white")
                    image = Image.alpha_composite(background, rgba)
                return np.array(image.convert("L"))
    except OcrError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise OcrError("INVALID_IMAGE") from None


def binary(gray: np.ndarray) -> np.ndarray:
    return cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]


def rotate_quarter(gray: np.ndarray, angle: int) -> np.ndarray:
    return np.ascontiguousarray(np.rot90(gray, -(angle // 90)))


def deskew(gray: np.ndarray) -> tuple[np.ndarray, float]:
    scale = min(1.0, 1600 / max(gray.shape))
    small = cv2.resize(gray, None, fx=scale, fy=scale) if scale < 1 else gray
    mask = binary(small)
    lines = cv2.HoughLinesP(mask, 1, np.pi / 1800, threshold=90,
                            minLineLength=max(60, small.shape[1] // 6), maxLineGap=12)
    angles = []
    if lines is not None:
        for x1, y1, x2, y2 in lines[:, 0]:
            angle = math.degrees(math.atan2(int(y2) - int(y1), int(x2) - int(x1)))
            if abs(angle) <= 9:
                angles.append(angle)
    angle = statistics.median(angles) if angles else 0.0
    if abs(angle) < 0.25:
        return gray, 0.0
    h, w = gray.shape
    transform = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1)
    out_w = int(abs(transform[0, 0]) * w + abs(transform[0, 1]) * h)
    out_h = int(abs(transform[0, 1]) * w + abs(transform[0, 0]) * h)
    transform[0, 2] += (out_w - w) / 2
    transform[1, 2] += (out_h - h) / 2
    return cv2.warpAffine(gray, transform, (out_w, out_h), borderValue=255), angle


def positions(projection: np.ndarray, threshold: float, offset: int = 0) -> list[int]:
    indices = np.flatnonzero(projection >= threshold)
    if not len(indices):
        return []
    chunks = np.split(indices, np.where(np.diff(indices) > 3)[0] + 1)
    return [int(round(float(chunk.mean()))) + offset for chunk in chunks if len(chunk)]


def remove_grid(gray: np.ndarray) -> tuple[np.ndarray, list[tuple[list[int], list[int]]]]:
    h, w = gray.shape
    mask = binary(gray)
    horizontal = cv2.morphologyEx(mask, cv2.MORPH_OPEN,
                                  cv2.getStructuringElement(cv2.MORPH_RECT, (max(40, w // 20), 1)))
    vertical = cv2.morphologyEx(mask, cv2.MORPH_OPEN,
                                cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(30, h // 30))))
    lines = cv2.bitwise_or(horizontal, vertical)
    contours, _ = cv2.findContours(cv2.dilate(lines, np.ones((3, 3), np.uint8)),
                                   cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    grids = []
    for contour in contours:
        x, y, width, height = cv2.boundingRect(contour)
        if width < w * 0.25 or height < 50:
            continue
        xs = positions(np.count_nonzero(vertical[y:y+height, x:x+width], axis=0), max(25, height * 0.35), x)
        ys = positions(np.count_nonzero(horizontal[y:y+height, x:x+width], axis=1), max(40, width * 0.5), y)
        if len(xs) >= 3 and len(ys) >= 3 and (len(xs)-1) * (len(ys)-1) <= MAX_CELLS:
            grids.append((xs, ys))
    clean = gray.copy()
    clean[cv2.dilate(lines, np.ones((3, 3), np.uint8)) > 0] = 255
    return clean, sorted(grids, key=lambda grid: grid[1][0])[:8]


def run_tesseract(image: np.ndarray, directory: Path, name: str, deadline: float, psm: int = 6) -> list[dict]:
    if deadline - time.monotonic() < 0.2:
        raise OcrError("OCR_TIMEOUT")
    path = directory / (name + ".png")
    if not cv2.imwrite(str(path), image):
        raise OcrError("IMAGE_PREPROCESS_FAILED")
    output = directory / (name + ".tsv")
    with output.open("wb") as stdout, (directory / (name + ".stderr")).open("wb") as stderr:
        try:
            process = subprocess.run(["tesseract", str(path), "stdout", "-l", "rus+eng", "--psm", str(psm),
                                      "--dpi", "300", "tsv"], stdout=stdout, stderr=stderr,
                                     timeout=max(0.1, deadline-time.monotonic()), check=False, shell=False)
        except subprocess.TimeoutExpired:
            raise OcrError("OCR_TIMEOUT") from None
    if process.returncode != 0:
        raise OcrError("OCR_ENGINE_FAILED")
    if output.stat().st_size > 2 * 1024 * 1024:
        raise OcrError("OCR_OUTPUT_LIMIT")
    words = []
    with output.open(encoding="utf-8") as stream:
        for row in csv.DictReader(stream, delimiter="\t", quoting=csv.QUOTE_NONE):
            text = (row.get("text") or "").strip()
            if row.get("level") != "5" or not text:
                continue
            try:
                word = {"text": text, "conf": float(row["conf"]),
                        **{k: int(row[k]) for k in ("left", "top", "width", "height")}}
            except (ValueError, KeyError):
                continue
            if word["conf"] >= 0:
                words.append(word)
            if len(words) > MAX_WORDS:
                raise OcrError("OCR_OUTPUT_LIMIT")
    return words


def grouped_lines(words: list[dict]) -> list[list[dict]]:
    lines: list[list[dict]] = []
    for word in sorted(words, key=lambda v: (v["top"]+v["height"]/2, v["left"])):
        cy = word["top"] + word["height"] / 2
        if lines:
            previous = lines[-1]
            centre = statistics.median(w["top"]+w["height"]/2 for w in previous)
            height = statistics.median(w["height"] for w in previous)
            if abs(cy-centre) <= max(5, height*0.65):
                previous.append(word)
                continue
        lines.append([word])
    return [sorted(line, key=lambda w: w["left"]) for line in lines]


def make_cell(row: int, col: int, words: list[dict]) -> dict:
    lines = grouped_lines(words)
    text = " ".join(" ".join(w["text"] for w in line) for line in lines)
    return {"rowIndex": str(row), "columnIndex": str(col), "text": text,
            "confidence": round(min((w["conf"] for w in words), default=0), 2)}


def grid_tables(words: list[dict], grids: list[tuple[list[int], list[int]]]) -> list[dict]:
    tables = []
    for xs, ys in grids:
        buckets: dict[tuple[int, int], list[dict]] = {}
        for word in words:
            cx, cy = word["left"]+word["width"]/2, word["top"]+word["height"]/2
            col = int(np.searchsorted(xs, cx, side="right"))-1
            row = int(np.searchsorted(ys, cy, side="right"))-1
            if 0 <= row < len(ys)-1 and 0 <= col < len(xs)-1:
                buckets.setdefault((row, col), []).append(word)
        cells = [make_cell(row, col, buckets.get((row, col), []))
                 for row in range(len(ys)-1) for col in range(len(xs)-1)]
        tables.append({"cells": cells, "method": "detected-grid"})
    return tables


def unruled_tables(words: list[dict], width: int) -> list[dict]:
    lines = grouped_lines(words)
    for index, line in enumerate(lines):
        # Header anchors are observed words, not generated labels or fixed x positions.
        anchors = [(word["left"], word) for word in line if header_kind(word["text"])]
        kinds = {header_kind(word["text"]) for _, word in anchors}
        if not {"name", "qty", "price"}.issubset(kinds):
            continue
        anchors.sort(key=lambda item: item[0])
        margin = statistics.median(word["height"] for word in line) * 0.5
        boundaries = [0] + [max(0, int(x-margin)) for x, _ in anchors[1:]] + [width+1]
        cells = []
        for row, data in enumerate(lines[index:]):
            if row > 0 and any(re.match(r"^(итого|всего|total)\b", normalize(w["text"])) for w in data):
                break
            if row > 500:
                break
            for col in range(len(anchors)):
                members = [w for w in data if boundaries[col] <= w["left"]+w["width"]/2 < boundaries[col+1]]
                cells.append(make_cell(row, col, members))
        if len(cells) <= MAX_CELLS:
            return [{"cells": cells, "method": "header-word-alignment", "warnings": ["UNRULED_TABLE_INFERRED"]}]
    return []


def header_columns(table: dict) -> tuple[int, dict[str, int]] | None:
    rows: dict[int, list[dict]] = {}
    for cell in table["cells"]:
        rows.setdefault(int(cell["rowIndex"]), []).append(cell)
    for row, cells in sorted(rows.items()):
        columns = {}
        for cell in cells:
            kind = header_kind(cell["text"])
            if kind and kind not in columns:
                columns[kind] = int(cell["columnIndex"])
        if {"name", "qty", "price"}.issubset(columns):
            return row, columns
    return None


def protect_numeric_cells(table: dict) -> None:
    header = header_columns(table)
    if not header:
        return
    header_row, columns = header
    rows: dict[int, dict[int, dict]] = {}
    for cell in table["cells"]:
        rows.setdefault(int(cell["rowIndex"]), {})[int(cell["columnIndex"])] = cell
    for row, cells in rows.items():
        if row <= header_row:
            continue
        for kind in ("qty", "price", "total"):
            if kind not in columns:
                continue
            cell = cells.get(columns[kind])
            if cell is None:
                continue
            value = decimal_cell(cell["text"])
            if (value is None or cell["confidence"] < NUMERIC_CONFIDENCE or (kind == "qty" and value <= 0)
                    or (kind != "qty" and value is not None and value.as_tuple().exponent < -2)):
                cell["rawText"] = cell["text"]
                cell["text"] = ""
                cell["warnings"] = ["NUMERIC_CELL_REQUIRES_REVIEW"]
        if all(kind in columns and cells.get(columns[kind], {}).get("text") for kind in ("qty", "price", "total")):
            qty, price, total = [decimal_cell(cells[columns[kind]]["text"]) for kind in ("qty", "price", "total")]
            if qty is not None and price is not None and total is not None and abs(qty*price-total) > Decimal("0.02"):
                for kind in ("qty", "price"):
                    cell = cells[columns[kind]]
                    cell["rawText"], cell["text"] = cell["text"], ""
                    cell["warnings"] = ["ROW_TOTAL_MISMATCH"]


def orientation_hint(gray: np.ndarray, directory: Path, deadline: float) -> int:
    path = directory / "osd.png"
    cv2.imwrite(str(path), gray)
    try:
        result = subprocess.run(["tesseract", str(path), "stdout", "--psm", "0", "-l", "osd"],
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, shell=False,
                                timeout=max(0.1, min(2.5, deadline-time.monotonic())), check=False)
        text = result.stdout.decode("utf-8", "replace")
        rotate = re.search(r"Rotate:\s*(0|90|180|270)\b", text)
        confidence = re.search(r"Orientation confidence:\s*([\d.]+)", text)
        if rotate and confidence and float(confidence[1]) >= 1.0:
            return int(rotate[1])
    except subprocess.TimeoutExpired:
        pass
    return 0


def recognize(data: bytes, seconds: float = PAGE_SECONDS) -> dict:
    started = time.monotonic()
    deadline = started + min(seconds, PAGE_SECONDS)
    gray = decode_image(data)
    if np.std(gray) < 2:
        return {"fullText": "", "tables": [], "warnings": ["NO_READABLE_TEXT"], "engine": "tesseract-5-grid"}
    best = None
    best_score = -1
    with tempfile.TemporaryDirectory(prefix="invoice-ocr-") as temporary:
        directory = Path(temporary)
        hint = orientation_hint(gray, directory, deadline)
        for angle in dict.fromkeys((hint, 0, 90, 180, 270)):
            if deadline-time.monotonic() < 1.0:
                break
            upright, skew = deskew(rotate_quarter(gray, angle))
            clean, grids = remove_grid(upright)
            words = run_tesseract(clean, directory, f"page-{angle}", deadline)
            tables = grid_tables(words, grids)
            valid = [table for table in tables if header_columns(table)]
            if not valid:
                valid = unruled_tables(words, clean.shape[1])
            text = "\n".join(" ".join(w["text"] for w in line) for line in grouped_lines(words))
            score = len(valid)*10000 + sum(w["conf"] for w in words)/max(1, len(words))
            annotation = {"fullText": text[:100000], "rotate": str(angle), "deskewDegrees": round(skew, 2),
                          "tables": valid, "warnings": [], "engine": "tesseract-5-grid"}
            if score > best_score:
                best, best_score = annotation, score
            if valid:
                break
    if best is None:
        raise OcrError("OCR_TIMEOUT")
    if not best["tables"]:
        best["warnings"].append("TABLE_HEADER_NOT_RECOGNIZED")
    for table in best["tables"]:
        protect_numeric_cells(table)
        if table.get("warnings"):
            best["warnings"].extend(table["warnings"])
    best["elapsedMs"] = round((time.monotonic()-started)*1000)
    return best


if __name__ == "__main__":
    os.umask(0o077)
    # Set limits in the child itself, never preexec_fn in the threaded HTTP parent.
    resource.setrlimit(resource.RLIMIT_CPU, (22, 23))
    resource.setrlimit(resource.RLIMIT_FSIZE, (32 * 1024 * 1024, 32 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    try:
        data = sys.stdin.buffer.read(MAX_BYTES+1) if len(sys.argv) == 1 else Path(sys.argv[1]).read_bytes()
        print(json.dumps(recognize(data), ensure_ascii=False))
    except OcrError as error:
        print(json.dumps({"error": error.code}))
        sys.exit(2)
