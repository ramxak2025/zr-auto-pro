"""Private single-job HTTP OCR boundary. No URL fetching or business writes."""
from __future__ import annotations

import base64
import binascii
import json
import os
import secrets
import signal
import socket
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_BODY_BYTES = 14 * 1024 * 1024  # base64 envelope; decoded limit remains 10 MiB
MAX_OUTPUT_BYTES = 2 * 1024 * 1024
PROCESS_TIMEOUT = 23
JOB_SLOT = threading.BoundedSemaphore(1)


class RequestError(Exception):
    def __init__(self, status: int, code: str):
        self.status, self.code = status, code


def parse_body(data: bytes, content_type: str) -> bytes:
    if len(data) > MAX_BODY_BYTES:
        raise RequestError(413, "REQUEST_SIZE_LIMIT")
    if content_type == "application/json":
        try:
            value = json.loads(data)
            if not isinstance(value, dict) or set(value) != {"imageBase64"} or not isinstance(value["imageBase64"], str):
                raise ValueError()
            image = base64.b64decode(value["imageBase64"], validate=True)
        except (ValueError, UnicodeError, binascii.Error):
            raise RequestError(400, "INVALID_IMAGE_ENVELOPE") from None
    elif content_type in {"image/jpeg", "image/png", "image/webp", "application/octet-stream"}:
        image = data
    else:
        raise RequestError(415, "CONTENT_TYPE_UNSUPPORTED")
    if not image or len(image) > MAX_IMAGE_BYTES:
        raise RequestError(413, "IMAGE_SIZE_LIMIT")
    return image


def recognize_process(image: bytes) -> dict:
    with tempfile.TemporaryDirectory(prefix="ocr-request-") as temporary:
        root = Path(temporary)
        (root / "input.image").write_bytes(image)
        env = {**os.environ, "TMPDIR": temporary}
        # Never pass the HTTP authentication token to the OCR subprocess.
        env.pop("OCR_WORKER_TOKEN", None)
        with (root / "output.json").open("wb") as output, (root / "stderr").open("wb") as error:
            process = subprocess.Popen(
                ["python3", "/app/ocr_core.py", str(root / "input.image")],
                stdin=subprocess.DEVNULL, stdout=output, stderr=error,
                shell=False, cwd=temporary, env=env, start_new_session=True,
            )
            try:
                process.wait(timeout=PROCESS_TIMEOUT)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=2)
                raise RequestError(504, "OCR_TIMEOUT") from None
        path = root / "output.json"
        if path.stat().st_size > MAX_OUTPUT_BYTES:
            raise RequestError(503, "OCR_OUTPUT_LIMIT")
        try:
            result = json.loads(path.read_bytes())
        except (ValueError, UnicodeError):
            raise RequestError(503, "OCR_ENGINE_FAILED") from None
        if not isinstance(result, dict):
            raise RequestError(503, "OCR_ENGINE_FAILED")
        if result.get("error"):
            code = result["error"]
            status = 504 if code == "OCR_TIMEOUT" else 400 if code in {
                "INVALID_IMAGE", "IMAGE_SIZE_LIMIT", "IMAGE_PIXEL_LIMIT", "IMAGE_FORMAT_UNSUPPORTED"
            } else 422
            raise RequestError(status, code)
        if process.returncode != 0:
            raise RequestError(503, "OCR_ENGINE_FAILED")
        return result


class BoundedServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 4

    def __init__(self, address: tuple[str, int], token: str):
        self.token = token
        self.connections = threading.BoundedSemaphore(6)
        super().__init__(address, Handler)

    def process_request(self, request: socket.socket, client_address: tuple) -> None:
        if not self.connections.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.connections.release()
            raise

    def process_request_thread(self, request: socket.socket, client_address: tuple) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.connections.release()


class Handler(BaseHTTPRequestHandler):
    server_version = "PrivateOCR/1"
    sys_version = ""

    def setup(self) -> None:
        self.request.settimeout(3)
        super().setup()

    def log_message(self, *_args) -> None:
        # Never log invoice contents, paths, Authorization or request bodies.
        pass

    def reply(self, status: int, data: dict) -> None:
        body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        self.wfile.write(body)

    def do_GET(self) -> None:
        self.reply(200, {"status": "ok", "provider": "local"}) if self.path == "/health" else self.reply(404, {"error": "NOT_FOUND"})

    def do_POST(self) -> None:
        started = time.monotonic()
        acquired = False
        status = 500
        try:
            if self.path != "/ocr":
                raise RequestError(404, "NOT_FOUND")
            supplied = self.headers.get("Authorization", "")
            expected = "Bearer " + self.server.token
            if not secrets.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8")):
                raise RequestError(401, "UNAUTHORIZED")
            if self.headers.get("Transfer-Encoding") or len(self.headers.get_all("Content-Length", [])) != 1:
                raise RequestError(411, "CONTENT_LENGTH_REQUIRED")
            length_text = self.headers.get("Content-Length", "")
            if not length_text.isascii() or not length_text.isdigit():
                raise RequestError(400, "INVALID_CONTENT_LENGTH")
            length = int(length_text)
            if length < 1 or length > MAX_BODY_BYTES:
                raise RequestError(413, "REQUEST_SIZE_LIMIT")
            acquired = JOB_SLOT.acquire(blocking=False)
            if not acquired:
                raise RequestError(429, "OCR_BUSY")
            data = self.rfile.read(length)
            if len(data) != length:
                raise RequestError(400, "INCOMPLETE_BODY")
            image = parse_body(data, self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower())
            result = recognize_process(image)
            status = 200
            self.reply(status, result)
        except RequestError as error:
            status = error.status
            self.reply(status, {"error": error.code})
        except (TimeoutError, socket.timeout):
            status = 408
            self.reply(status, {"error": "READ_TIMEOUT"})
        except (BrokenPipeError, ConnectionResetError):
            status = 499
        except Exception:
            status = 503
            self.reply(status, {"error": "OCR_UNAVAILABLE"})
        finally:
            if acquired:
                JOB_SLOT.release()
            print(json.dumps({"event": "ocr_request", "status": status, "elapsedMs": round((time.monotonic()-started)*1000)}), flush=True)


if __name__ == "__main__":
    os.umask(0o077)
    token = os.environ.get("OCR_WORKER_TOKEN", "")
    if len(token) < 32 or len(token) > 256 or any(ord(char) < 33 or ord(char) > 126 for char in token):
        raise SystemExit("OCR_WORKER_TOKEN must contain 32..256 printable non-space ASCII characters")
    BoundedServer(("0.0.0.0", 8080), token).serve_forever(poll_interval=0.5)
