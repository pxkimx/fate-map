"""Local web server for Fate Map. Standard library only; nothing leaves the computer."""
from __future__ import annotations

import json
import os
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from . import __version__
from .lifecycle import Lifecycle
from .store import Store

HERE = Path(__file__).resolve().parent
WEB = HERE / "web"
CATALOG = HERE / "data" / "catalog.json"
DEFAULT_PORT = 8793
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json"}
LIFE: Lifecycle | None = None
STORE = Store()


def load_catalog() -> bytes:
    """The catalogue as JSON bytes, with the app version added."""
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    data["app_version"] = __version__
    return json.dumps(data, ensure_ascii=False).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "FateMap"

    def log_message(self, fmt, *args):
        pass

    def _send(self, code: int, body: bytes, ctype: str = "application/json", extra: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj).encode())

    def _local_only(self) -> bool:
        origin = self.headers.get("Origin") or ""
        host = (self.headers.get("Host") or "").split(":")[0]
        if host not in ("localhost", "127.0.0.1"):
            return False
        return not origin or re.match(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$", origin) is not None

    def do_GET(self):
        u = urlparse(self.path)
        if not self._local_only():
            return self._send(403, b"forbidden", "text/plain")
        if u.path == "/api/window":
            return self._window()
        if u.path == "/api/health":
            return self._json({"app": "fate-map", "version": __version__})
        if u.path == "/api/catalog":
            try:
                return self._send(200, load_catalog(), "application/json; charset=utf-8")
            except (OSError, ValueError) as e:
                return self._json({"error": f"The protocol catalogue could not be read: {e}"}, 500)
        if u.path == "/api/store":
            return self._json(STORE.read())
        rel = "index.html" if u.path in ("/", "") else u.path.lstrip("/")
        f = (WEB / rel).resolve()
        if WEB.resolve() not in f.parents or not f.is_file():
            return self._send(404, b"not found", "text/plain")
        self._send(200, f.read_bytes(), TYPES.get(f.suffix, "application/octet-stream"))

    def do_POST(self):
        u = urlparse(self.path)
        if not self._local_only():
            return self._send(403, b"forbidden", "text/plain")
        n = int(self.headers.get("Content-Length") or 0)
        if u.path == "/api/store":
            if n > STORE.MAX_BYTES:
                return self._json({"error": "Your notebook is too large to save."}, 413)
            try:
                STORE.write(json.loads(self.rfile.read(n) or b"{}"))
            except (ValueError, OSError) as e:
                return self._json({"error": f"Could not save: {e}"}, 400)
            return self._json({"ok": True})
        if n:
            self.rfile.read(min(n, 1 << 20))
        if u.path == "/api/quit":
            self._json({"ok": True})
            if LIFE:
                LIFE.quit_now()
            return
        self._send(404, b"not found", "text/plain")

    def _window(self):
        """Held open by the page; when it drops, the window is closed (see lifecycle.py)."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        if LIFE:
            LIFE.window_opened()
        try:
            while True:
                self.wfile.write(b": hold\n\n")
                self.wfile.flush()
                threading.Event().wait(2.0)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            if LIFE:
                LIFE.window_closed()
        self.close_connection = True


def serve(port: int = DEFAULT_PORT, open_browser: bool = True, keep_alive: bool = False) -> None:
    global LIFE
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    httpd.daemon_threads = True

    def quit_():
        sys.stdout.flush()
        os._exit(0)

    LIFE = Lifecycle(on_quit=quit_)
    if not keep_alive:          # development previews stay up without a window
        LIFE.watch()
    url = f"http://localhost:{port}"
    print(f"Fate Map {__version__} at {url}", flush=True)
    if open_browser:
        import webbrowser
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        quit_()


def main() -> None:
    import argparse
    ap = argparse.ArgumentParser(prog="fate-map", description="Fate Map local app")
    ap.add_argument("--port", type=int, default=int(os.environ.get("FM_PORT", DEFAULT_PORT)))
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--keep-alive", action="store_true", help="do not quit when the window closes (development)")
    a = ap.parse_args()
    serve(a.port, not a.no_browser, a.keep_alive)


if __name__ == "__main__":
    main()
