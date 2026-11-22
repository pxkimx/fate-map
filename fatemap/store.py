"""The user's runs, notes and reagent stocks, kept in one JSON file on this computer.

Location: ~/Library/Application Support/Fate Map/notebook.json (FM_HOME overrides the folder; tests use a temp one).

Losing a notebook would cost the user real bench records, so three things guard it:

* a write goes to a temporary file and then replaces the old one, so a crash cannot leave half a notebook;
* every notebook carries a revision number, and a write must say which revision it is replacing. A page that
  never loaded, or that loaded before another window saved, is refused instead of overwriting newer work;
* the previous version is kept as notebook.json.bak, and dated copies are kept in backups/ (the newest
  KEEP_BACKUPS, and only one per minute) so an overwrite can still be undone by hand.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path

EMPTY = {"version": 1, "rev": 0, "runs": [], "stocks": {}}
KEEP_BACKUPS = 20
BACKUP_EVERY_S = 60.0


class Conflict(Exception):
    """A write arrived for a revision that is no longer the current one."""

    def __init__(self, current: int):
        super().__init__(f"the notebook has changed (revision {current})")
        self.current = current


def home() -> Path:
    return Path(os.environ.get("FM_HOME") or Path.home() / "Library" / "Application Support" / "Fate Map")


class Store:
    MAX_BYTES = 8 * 1024 * 1024

    def __init__(self):
        self.lock = threading.Lock()

    @property
    def path(self) -> Path:
        return home() / "notebook.json"

    @property
    def backups(self) -> Path:
        return home() / "backups"

    # ------------------------------------------------------------------ read
    @staticmethod
    def _parse(f: Path) -> dict | None:
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        if not isinstance(d, dict) or not isinstance(d.get("runs"), list):
            return None
        if not isinstance(d.get("stocks"), dict):
            d["stocks"] = {}
        d["rev"] = d["rev"] if isinstance(d.get("rev"), int) and d["rev"] >= 0 else 0
        d["version"] = 1
        return d

    def _read_locked(self) -> dict:
        for f in (self.path, self.path.with_suffix(".json.bak")):
            d = self._parse(f)
            if d is not None:
                return d
        return json.loads(json.dumps(EMPTY))

    def read(self) -> dict:
        with self.lock:
            return self._read_locked()

    # ----------------------------------------------------------------- write
    def _list_backups(self) -> list[Path]:
        """Oldest first. The name carries the time to the millisecond, so sorting by name is chronological."""
        return sorted(p for p in self.backups.glob("notebook-*.json") if re.fullmatch(r"notebook-\d{8}-\d{6}-\d{3}\.json", p.name))

    def _keep_backup(self, raw: bytes) -> None:
        """A dated copy, at most one a minute, newest KEEP_BACKUPS kept."""
        try:
            self.backups.mkdir(parents=True, exist_ok=True)
            old = self._list_backups()
            if old and time.time() - old[-1].stat().st_mtime < BACKUP_EVERY_S:
                return
            now = time.time()
            while True:              # several saves in one millisecond must not land on one file
                dst = self.backups / (time.strftime("notebook-%Y%m%d-%H%M%S", time.localtime(now)) + "-%03d.json" % (int(now * 1000) % 1000))
                if not dst.exists():
                    break
                now += 0.001
            dst.write_bytes(raw)
            kept = self._list_backups()
            for p in kept[:max(0, len(kept) - KEEP_BACKUPS)]:
                p.unlink(missing_ok=True)
        except OSError:
            pass          # a backup that cannot be written must not stop the save itself

    def write(self, data, expect_rev=None) -> dict:
        """Replace the notebook. `expect_rev` is the revision the caller last read; None is accepted only
        when there is nothing to lose (no notebook yet, or it is still empty). Returns the saved notebook."""
        if not isinstance(data, dict) or not isinstance(data.get("runs"), list) or not isinstance(data.get("stocks", {}), dict):
            raise ValueError("not a notebook")
        with self.lock:
            current = self._read_locked()
            cur_rev = current["rev"]
            if expect_rev is None:
                if current["runs"] or current["stocks"]:
                    raise Conflict(cur_rev)
            elif not isinstance(expect_rev, int) or expect_rev != cur_rev:
                raise Conflict(cur_rev)
            out = {"version": 1, "rev": cur_rev + 1, "runs": data["runs"], "stocks": data.get("stocks", {})}
            raw = json.dumps(out, ensure_ascii=False).encode("utf-8")
            if len(raw) > self.MAX_BYTES:
                raise ValueError("too large")
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".json.tmp")
            tmp.write_bytes(raw)
            if self.path.exists():
                self._keep_backup(self.path.read_bytes())
                os.replace(self.path, self.path.with_suffix(".json.bak"))
            os.replace(tmp, self.path)
            return out
