"""Tests: catalogue integrity, server routes and quit-on-close. Run: python3 -m pytest tests"""
import json, os, re, socket, subprocess, sys, time, urllib.request
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parent.parent
CAT = json.loads((ROOT / "fatemap/data/catalog.json").read_text(encoding="utf-8"))
ARCH = set(re.findall(r"^  A\.(\w+) = function", (ROOT / "fatemap/web/render.js").read_text(), re.M))


def free_port():
    with socket.socket() as k:
        k.bind(("127.0.0.1", 0))
        return k.getsockname()[1]


def protocols():
    for c in CAT["cell_types"]:
        for p in c["protocols"]:
            yield c, p


def test_every_cell_has_a_protocol_and_markers():
    for c in CAT["cell_types"]:
        assert c["protocols"], c["id"]
        assert len(c["markers"]) >= 5, c["id"]
        assert c["morphology"]["stages"], c["id"]


def test_ids_unique():
    ids = [p["id"] for _, p in protocols()]
    assert len(ids) == len(set(ids))
    cids = [c["id"] for c in CAT["cell_types"]]
    assert len(cids) == len(set(cids))


def test_archetypes_exist_in_renderer():
    for c in CAT["cell_types"]:
        for m in c["morphology"]["stages"]:
            assert m["archetype"] in ARCH, (c["id"], m["archetype"])


def test_published_protocols_cite_a_paper():
    for c, p in protocols():
        if p["type"] == "published":
            assert p["source"] and (p["source"]["doi"] or p["source"]["pmid"]), p["id"]
            assert re.fullmatch(r"\d{5,9}", p["source"]["pmid"] or "00000"), p["id"]


def test_kits_have_vendor_and_url():
    for c, p in protocols():
        if p["type"] == "kit":
            assert p["vendor"] and p["product"], p["id"]
            assert not p["product_url"] or p["product_url"].startswith("http"), p["id"]


def test_stage_days_sane():
    for c, p in protocols():
        for s in p["stages"]:
            assert isinstance(s["day_start"], (int, float))
            assert s["day_end"] is None or s["day_end"] >= s["day_start"], p["id"]


def test_unconfirmed_schedules_are_flagged():
    for c, p in protocols():
        has = any("placeholder" in u.lower() for u in p["unverified"])
        assert not has or p["schedule_unverified"], p["id"]


def test_marker_vocabulary():
    for c in CAT["cell_types"]:
        for m in c["markers"]:
            assert m["stage"] in {"pluripotent", "intermediate", "target", "mature", "off-target"}
            assert all(isinstance(a, str) and a for a in m["assays"]), (c["id"], m["name"])   # others such as "RNA ISH" are shown as written


@pytest.fixture(scope="module")
def server():
    port = free_port()
    env = dict(os.environ, FM_PARENT_PID="")
    pr = subprocess.Popen([sys.executable, "-m", "fatemap.server", "--port", str(port), "--no-browser", "--keep-alive"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            urllib.request.urlopen(f"http://localhost:{port}/api/health", timeout=1); break
        except OSError:
            time.sleep(0.1)
    yield port
    pr.kill()


def get(port, path):
    return urllib.request.urlopen(f"http://localhost:{port}{path}", timeout=5)


def test_routes(server):
    assert json.load(get(server, "/api/health"))["app"] == "fate-map"
    assert len(json.load(get(server, "/api/catalog"))["cell_types"]) == len(CAT["cell_types"])
    for f in ("/", "/app.js", "/render.js", "/style.css", "/bg.js", "/icon.svg"):
        assert get(server, f).status == 200
    with pytest.raises(urllib.error.HTTPError):
        get(server, "/../server.py")


def test_rejects_foreign_host(server):
    req = urllib.request.Request(f"http://127.0.0.1:{server}/api/health", headers={"Host": "evil.example.com"})
    with pytest.raises(urllib.error.HTTPError) as e:
        urllib.request.urlopen(req, timeout=5)
    assert e.value.code == 403


def test_quits_when_window_closes():
    port = free_port()
    pr = subprocess.Popen([sys.executable, "-m", "fatemap.server", "--port", str(port), "--no-browser"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                          env=dict(os.environ, FM_PARENT_PID=""))
    for _ in range(50):
        try:
            urllib.request.urlopen(f"http://localhost:{port}/api/health", timeout=1); break
        except OSError:
            time.sleep(0.1)
    win = urllib.request.urlopen(f"http://localhost:{port}/api/window", timeout=5)
    win.read(8)
    time.sleep(1)
    assert pr.poll() is None
    win.close()
    deadline = time.time() + 14
    while pr.poll() is None and time.time() < deadline:
        time.sleep(0.5)
    assert pr.poll() is not None, "server did not quit after the window closed"


# ---------------------------------------------------------------- notebook store
def test_store_roundtrip_and_backup(tmp_path, monkeypatch):
    monkeypatch.setenv("FM_HOME", str(tmp_path))
    from fatemap.store import Store
    s = Store()
    assert s.read()["runs"] == []
    s.write({"runs": [{"id": "a", "notes": []}], "stocks": {"chir99021": "10 mM"}})
    s.write({"runs": [{"id": "a", "notes": [{"text": "µ ✓"}]}], "stocks": {}})
    d = s.read()
    assert d["runs"][0]["notes"][0]["text"] == "µ ✓"
    assert (tmp_path / "notebook.json.bak").exists()
    (tmp_path / "notebook.json").write_text("{broken")        # a damaged file falls back to the backup
    assert s.read()["runs"][0]["id"] == "a"


def test_store_rejects_bad_payload(tmp_path, monkeypatch):
    monkeypatch.setenv("FM_HOME", str(tmp_path))
    from fatemap.store import Store
    s = Store()
    for bad in ([], {"runs": "x"}, {"runs": [], "stocks": []}, "text"):
        with pytest.raises(ValueError):
            s.write(bad)


def test_store_api_roundtrip(tmp_path):
    port = free_port()
    pr = subprocess.Popen([sys.executable, "-m", "fatemap.server", "--port", str(port), "--no-browser", "--keep-alive"], cwd=ROOT,
                          env=dict(os.environ, FM_HOME=str(tmp_path), FM_PARENT_PID=""), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(f"http://localhost:{port}/api/health", timeout=1); break
            except OSError:
                time.sleep(0.1)
        body = json.dumps({"runs": [{"id": "r1", "notes": []}], "stocks": {}}).encode()
        req = urllib.request.Request(f"http://localhost:{port}/api/store", data=body, method="POST", headers={"Content-Type": "application/json"})
        assert json.load(urllib.request.urlopen(req, timeout=5))["ok"]
        assert json.load(urllib.request.urlopen(f"http://localhost:{port}/api/store", timeout=5))["runs"][0]["id"] == "r1"
        bad = urllib.request.Request(f"http://localhost:{port}/api/store", data=b"[1,2]", method="POST")
        with pytest.raises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(bad, timeout=5)
        assert e.value.code == 400
    finally:
        pr.kill()


# ---------------------------------------------------------------- calculator (JavaScript, run with macOS's own engine when present)
JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc")


@pytest.mark.skipif(not JSC.exists(), reason="needs macOS JavaScriptCore")
def test_calculator_js(tmp_path):
    script = tmp_path / "t.js"
    script.write_text('''var window = {}; load("%s");
var C = window.Calc, fail = [];
function eq(a, b, tol, what) { if (!(Math.abs(a - b) <= (tol || 1e-9))) fail.push(what + ": " + a + " vs " + b); }
eq(C.stockMicrolitres(C.parseConc("12 µM"), C.parseConc("10 mM"), 13.2), 15.84, 1e-6, "molar");
eq(C.stockMicrolitres(C.parseConc("20 ng/mL"), C.parseConc("100 µg/mL"), 10), 2, 1e-6, "mass");
eq(C.stockMicrolitres(C.parseConc("1X"), C.parseConc("100X"), 10), 100, 1e-6, "fold");
eq(C.stockMicrolitres(C.parseConc("2%%"), C.parseConc("50%%"), 10), 400, 1e-6, "percent");
if (C.stockMicrolitres(C.parseConc("12 µM"), C.parseConc("100 µg/mL"), 10) !== null) fail.push("molar vs mass must not convert");
if (C.parseConc("10-20 ng/mL") !== null) fail.push("range must not parse");
if (C.parseConc("2 g/L as stated in the paper (i.e. 2 ug/mL)") !== null) fail.push("odd source unit must not parse");
eq(C.parseConc("12 µM (test 6-14 µM per line)").base, 12e-6, 1e-12, "bracket note");
eq(C.parseFeeding("Every 2 days").interval, 2, 0, "every 2 days");
eq(C.parseFeeding("Daily").interval, 1, 0, "daily");
eq(C.parseFeeding("medium change every 48 h").interval, 2, 0, "48 h");
if (!C.parseFeeding("Single dose for 24 h").once) fail.push("single dose");
if (!C.parseFeeding("whenever").assumed) fail.push("unknown feeding must be flagged assumed");
var p = {stages: [{name: "a", day_start: 0, day_end: 4, feeding: "Every 2 days", base_medium: "M", factors: [{name: "F", conc: "10 µM"}]}, {name: "b", day_start: 4, day_end: 5, feeding: "Once", factors: []}]};
var pl = C.plan(p, {vessel: "6", count: 3, overage: 0}, {f: "10 mM"});
eq(pl.perFeedMl, 6, 1e-9, "per feed"); eq(pl.feeds.length, 3, 0, "feeds: day 0, 2, 4");
eq(pl.stages[0].factors[0].ulPerFeed, 6, 1e-9, "factor per feed");
print(fail.length ? "FAIL " + fail.join(" | ") : "OK");
''' % (ROOT / "fatemap/web/calc.js"))
    out = subprocess.run([str(JSC), str(script)], capture_output=True, text=True).stdout
    assert "OK" in out, out
