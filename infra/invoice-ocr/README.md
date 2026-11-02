# Private printed-invoice OCR worker

Self-hosted Tesseract + OpenCV, isolated from all inventory, financial and catalog
state. This is an internal-test candidate, not a claim of accuracy on physical
invoice photographs. No Yandex access, external OCR account or paid API is used.

## HTTP contract

`POST /ocr`, mandatory `Authorization: Bearer <separate private worker token>`.
The worker reads `OCR_WORKER_TOKEN` at startup (32–256 printable non-space ASCII
characters). Do not reuse a production JWT, Yandex key or user credential.

Preferred input: `Content-Type: application/json`, exactly
`{"imageBase64":"<base64 JPEG/PNG/WebP>"}`. Raw image bytes with image MIME or
application/octet-stream also work. No URLs, filenames, OCR flags or extra JSON
properties are accepted. Use a backend-configured trusted private origin only;
never derive the worker URL from document content. Process pages sequentially.

Success returns a direct annotation, not a Yandex result wrapper:

```json
{
  "fullText": "observed OCR text including the printed date",
  "rotate": "0",
  "deskewDegrees": 0,
  "tables": [
    {
      "method": "detected-grid",
      "cells": [
        {
          "rowIndex": "1",
          "columnIndex": "2",
          "text": "",
          "rawText": "observed uncertain OCR token",
          "confidence": 63.2,
          "warnings": ["NUMERIC_CELL_REQUIRES_REVIEW"]
        }
      ]
    }
  ],
  "warnings": [],
  "engine": "tesseract-5-grid",
  "elapsedMs": 1500
}
```

Rows/columns are zero-based strings. Cell text is observed OCR, never expected
fixture content. Confidence is Tesseract's heuristic score, not a calibrated
probability. A numeric cell below 80, invalid decimal, non-positive quantity or
excess precision has `text=""`; raw evidence remains in `rawText`. If an observed
line total disagrees with observed qty × unit price, BOTH qty and price become
blank with `ROW_TOTAL_MISMATCH`. No number is inferred from totals. Zero unit
price is permitted. The backend must preserve warnings, parse blank numbers as
null, show the image/editable preview and require confirmation. It owns the date,
catalog aliases, supplier/tenant permissions and final receipt transaction.

Unruled tables carry `UNRULED_TABLE_INFERRED`. No reliable header yields
`tables=[]` and `TABLE_HEADER_NOT_RECOGNIZED`; a blank page yields
`NO_READABLE_TEXT`. These mean manual entry/retry, not successful extraction.
SKU homoglyphs are not rewritten (e.g. TEST can be read as ТЕЗТ); require confirmed
supplier aliases rather than interpreting that as a catalog identity.

Errors are JSON `{ "error": "CODE" }`: 400 malformed image/envelope, 401 bearer,
411 missing/duplicate Content-Length or transfer-encoding, 413 byte limits,
415 unsupported MIME, 422 bounded OCR/output failure, 429 `OCR_BUSY`,
504 `OCR_TIMEOUT`, 503 unexpected/unavailable engine. Do not retry automatically.
`GET /health` returns only `{status:"ok",provider:"local"}`. No user data is logged.

## Resource and execution boundary

- Decoded image ≤10 MiB; JSON/base64 body ≤14 MiB; ≤20 MP before full decode.
- Single-frame JPEG/PNG/WebP only. EXIF transposed, transparency composited white,
  longest edge capped at 3000 pixels.
- Six bounded HTTP connection threads; one OCR job, others receive 429.
- Three-second socket input timeout, 21-second OCR budget, 23-second subprocess
  timeout; configure the backend request timeout to 30 seconds.
- Fixed argument list and `shell=False`; no arbitrary command, URL, file path or
  options from the request. Child process group is killed on timeout.
- Request scratch is private mode 0700 with umask 077. Child TMPDIR is inside the
  request directory, so timeout cleanup removes nested OCR files too.
- Child CPU/file-descriptor/file-size limits; container limits remain mandatory.

Runtime example for the coordinator (do not publish a host port):

```sh
docker run --name autexa-inventory-ocr \
  --network <dedicated-internal-ocr-network> \
  --read-only --cpus 1 --memory 768m --pids-limit 64 \
  --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,noexec,nosuid,size=128m \
  --env-file <new-private-stage-worker-environment-file> \
  autexa-inventory-ocr-worker:20261101
```

Attach only the authorized staging backend to that internal network. There is no
`-p` binding, database connection, production mount, Docker socket or external
egress requirement. The prototype and tests used `--network none`; HTTP smoke
used only that container's loopback. Root owns the later staging network/token
configuration. No production container/network/configuration was changed here.

## Processing and known limits

The worker detects horizontal/vertical line masks from the actual pixels, removes
them, runs OCR and maps word boxes into detected grid cells. Without grid lines,
recognized header anchors define columns. OSD proposes right-angle orientation;
the worker checks header evidence and tries alternative rotations within the same
deadline. Long-line angle estimates correct moderate skew.

This addresses the observed failure where Tesseract alone discarded a clear
table's headers and quantity column. It is not a general document understanding
model: complex merged/multi-row headers, perspective distortion, very faint text,
handwriting, unusual tax/discount layouts and wrapped unruled rows may need manual
entry. Arithmetic validation can conservatively reject legitimate discounted or
tax-inclusive rows; it never silently changes the printed number. The worker
does not extract trusted stock quantities from total amounts.

Primary implementation references:
[Tesseract image quality/table limitations](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html),
[Tesseract CLI/TSV](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html),
[OpenCV morphological line extraction](https://docs.opencv.org/4.x/dd/dd7/tutorial_morph_lines_detection.html).

## Reproduction and evidence

Build only the dedicated image from this directory. `test_core.py` uses stdlib
unittest. `benchmark.py` runs real OCR on generated pixels; it does not inject
expected values into the OCR implementation. `export_fixtures.py` exports exactly
those pixels plus SHA-256/ground truth, so an independent reviewer can inspect
the images. `smoke.py` exercises the actual private HTTP worker; it reads only its
own synthetic-test token. `adversarial_http.py` exercises occluded quantity, blank,
noise and duplicate framing. All tests run in bounded, network-none containers.

2026-11-01 initial observations, CPU limit 1 and memory limit 768 MiB:

| Synthetic fixture                           | Rows | Correct qty + unit-price cells | Unknown | OCR time |
| ------------------------------------------- | ---: | -----------------------------: | ------: | -------: |
| Original reported blocker, separate fixture |    2 |                            4/4 |       0 |  1.572 s |
| Clear grid                                  |    2 |                            4/4 |       0 |  1.432 s |
| No grid                                     |    2 |                            4/4 |       0 |  1.157 s |
| Dense grid                                  |   12 |                          24/24 |       0 |  2.884 s |
| Dense no-grid                               |   20 |                          40/40 |       0 |  3.050 s |
| 90° rotation                                |   12 |                          24/24 |       0 |  2.870 s |
| 180° rotation                               |   12 |                          24/24 |       0 |  2.962 s |
| 270° rotation                               |   12 |                          24/24 |       0 |  3.159 s |
| 4° skew                                     |   12 |                          24/24 |       0 |  3.042 s |
| Moderate Gaussian blur                      |   12 |                          22/24 |       2 |  3.540 s |

The nine generated variants contain 190/192 exact numeric cells, two explicit
unknown quantities and zero accepted wrong numeric cells in this limited set.
This excludes the separate original 4/4 fixture. Times are OCR/container time,
not user-perceived mobile upload latency. All images are synthetic, not physical
camera photographs. Full outputs: `original.result.json`,
`benchmark.initial.jsonl`, `unit.private.log`, `http-smoke.initial.json`.

Actual negative HTTP runs (`adversarial.initial.jsonl`): occluded quantity stayed
blank despite a readable row total; blank image returned no table; random 9 MP
noise was killed with 504 after 23.178 s, scratch was reaped and the server remained
responsive. Duplicate Content-Length returned 411. Peak cgroup memory observed
was 368,664,576 bytes (~352 MiB), including the synthetic test client in that same
container. Runtime was Tesseract 5.3.0. Docker limits were inspected, not merely
specified; see `runtime-evidence.private.log` and `final-image.private.log`.

The final Dockerfile copies only an explicit source-file allowlist, not private
images, benchmark result JSON, logs or fixture archives. Runtime source digests
in the final image are recorded for comparison with `source-evidence.sha256`.

Acceptance still requires independent code review, backend parser/preview
integration, actual staging-network smoke and a representative physical-photo
sample. No live supplier receipt or financial mutation has been performed.
