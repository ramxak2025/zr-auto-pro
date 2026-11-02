"""Run inside the dedicated worker container; only loopback and synthetic data."""
import base64
import glob
import http.client
import io
import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from benchmark import fixture, parsed_rows

TOKEN = os.environ["OCR_WORKER_TOKEN"]


def post(payload, token=TOKEN, content_type="application/json"):
    connection = http.client.HTTPConnection("127.0.0.1", 8080, timeout=28)
    connection.request("POST", "/ocr", payload, {"Authorization": "Bearer "+token, "Content-Type": content_type})
    response = connection.getresponse()
    result = response.status, json.loads(response.read())
    connection.close()
    return result


image, _ = fixture(2, True)
buffer = io.BytesIO()
image.save(buffer, "PNG")
payload = json.dumps({"imageBase64": base64.b64encode(buffer.getvalue()).decode()}).encode()
assert post(payload, token="incorrect")[0] == 401
assert post(b'{"url":"https://example.com/not-fetched"}')[0] == 400
assert post(b'{broken')[0] == 400
assert post(b"not-an-image", content_type="image/png")[0] == 400

status, annotation = post(payload)
assert status == 200, (status, annotation)
rows = parsed_rows(annotation)
assert len(rows) == 2 and rows[0]["quantity"] == "2" and rows[0]["price"] == "450,00", rows
assert rows[1]["quantity"] == "1" and rows[1]["price"] == "1250,00", rows

connection = http.client.HTTPConnection("127.0.0.1", 8080, timeout=5)
connection.putrequest("POST", "/ocr")
connection.putheader("Authorization", "Bearer "+TOKEN)
connection.putheader("Content-Length", "15000000")
connection.endheaders()
response = connection.getresponse()
assert response.status == 413
response.read()
connection.close()

barrier = threading.Barrier(2)
def concurrent(_):
    barrier.wait()
    return post(payload)[0]
with ThreadPoolExecutor(max_workers=2) as pool:
    statuses = sorted(pool.map(concurrent, range(2)))
assert statuses == [200, 429], statuses
assert not glob.glob("/tmp/ocr-request-*"), "Request scratch was not reaped"
assert not glob.glob("/tmp/invoice-ocr-*"), "Child scratch escaped request directory"
print(json.dumps({"status": "PASS", "liveHttp": True, "synthetic": True,
                  "checks": ["auth", "reject-url-envelope", "malformed-json", "invalid-image", "actual-numeric-ocr", "size-limit", "concurrency-one", "scratch-cleanup"]}))
