"""Real HTTP/pixel negative cases against our own loopback-only worker."""
import base64
import glob
import http.client
import io
import json
import os
import time
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from benchmark import fixture, parsed_rows


def request(image):
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    body = json.dumps({"imageBase64": base64.b64encode(buffer.getvalue()).decode()})
    connection = http.client.HTTPConnection("127.0.0.1", 8080, timeout=30)
    started = time.monotonic()
    connection.request("POST", "/ocr", body, {"Content-Type": "application/json", "Authorization": "Bearer "+os.environ["OCR_WORKER_TOKEN"]})
    response = connection.getresponse()
    result = json.loads(response.read())
    status = response.status
    connection.close()
    return status, result, round((time.monotonic()-started)*1000)


image, _ = fixture(2, True)
ImageDraw.Draw(image).rectangle((1012, 224, 1161, 273), fill="white")
status, result, elapsed = request(image)
rows = parsed_rows(result)
assert status == 200 and len(rows) == 2 and rows[0]["quantity"] == "", (status, result)
assert rows[0]["price"] == "450,00" and rows[1]["quantity"] == "1", rows
print(json.dumps({"case": "occluded-quantity", "status": status, "elapsedMs": elapsed, "result": "unknown-not-derived", "rows": rows}), flush=True)

for name, image in [
    ("blank", Image.new("L", (1000, 1000), 255)),
    ("noise-9MP", Image.fromarray(np.random.default_rng(20261101).integers(0, 256, (3000, 3000), dtype=np.uint8))),
]:
    status, result, elapsed = request(image)
    assert status in (200, 422, 504), (status, result)
    if status == 200:
        assert result.get("tables") == [], result
    assert elapsed < 26000, elapsed
    assert not glob.glob("/tmp/ocr-request-*"), "Scratch not reaped after noisy/failed job"
    print(json.dumps({"case": name, "status": status, "elapsedMs": elapsed, "warnings": result.get("warnings"), "error": result.get("error")}), flush=True)

connection = http.client.HTTPConnection("127.0.0.1", 8080, timeout=5)
connection.putrequest("POST", "/ocr")
connection.putheader("Authorization", "Bearer "+os.environ["OCR_WORKER_TOKEN"])
connection.putheader("Content-Length", "3")
connection.putheader("Content-Length", "4")
connection.endheaders(b"abcd")
response = connection.getresponse()
assert response.status == 411
response.read()
connection.close()
print(json.dumps({"case": "duplicate-content-length", "status": 411}), flush=True)
