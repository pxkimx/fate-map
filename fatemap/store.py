"""The user's runs, notes and reagent stocks, kept in one JSON file on this computer.

Location: ~/Library/Application Support/Fate Map/notebook.json (FM_HOME overrides the folder; tests use a temp one).
Writes go to a temporary file first and replace the old one, so a crash cannot leave half a notebook, and the
previous version is kept as notebook.json.bak.
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path

EMPTY = {"version": 1, "runs": [], "stocks": {}}


def home() -> Path:
    return Path(os.environ.get("FM_HOME") or Path.home() / "Library" / "Application Support" / "Fate Map")


class Store:
    MAX_BYTES = 8 * 1024 * 1024

    def __init__(self):
        self.lock = threading.Lock()

    @property
    def path(self) -> Path:
        return home() / "notebook.json"

    def read(self) -> dict:
        with self.lock:
            for f in (self.path, self.path.with_suffix(".json.bak")):
                try:
                    d = json.loads(f.read_text(encoding="utf-8"))
                    if isinstance(d, dict) and isinstance(d.get("runs"), list):
                        d.setdefault("stocks", {})
                        return d
                except (OSError, ValueError):
                    continue
            return json.loads(json.dumps(EMPTY))

    def write(self, data) -> None:
        if not isinstance(data, dict) or not isinstance(data.get("runs"), list) or not isinstance(data.get("stocks", {}), dict):
            raise ValueError("not a notebook")
        data = {"version": 1, "runs": data["runs"], "stocks": data.get("stocks", {})}
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
        if len(raw) > self.MAX_BYTES:
            raise ValueError("too large")
        with self.lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".json.tmp")
            tmp.write_bytes(raw)
            if self.path.exists():
                os.replace(self.path, self.path.with_suffix(".json.bak"))
            os.replace(tmp, self.path)
