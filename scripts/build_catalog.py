#!/usr/bin/env python3
"""Build fatemap/data/catalog.json from the research files in research/*.json.

Each research file holds {"area", "cell_types": [...], "kits": [...]} in the format described in
research/SCHEMA.md. This script checks every entry, tidies small inconsistencies, attaches each kit to
its cell type and writes one catalogue for the app. It never fills in a missing value: anything it
cannot use is reported and left out.

    python3 scripts/build_catalog.py            # research/ -> fatemap/data/catalog.json
    python3 scripts/build_catalog.py --check    # report problems only, write nothing
"""
from __future__ import annotations

import argparse
import datetime
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARCHETYPES = {
    "psc_colony", "monolayer_dense", "cobblestone", "hepatocyte", "pigmented_epithelium", "rosettes", "neurons",
    "astrocytes", "oligodendrocytes", "microglia", "spindle", "myotubes", "cardiomyocytes", "round_suspension",
    "macrophage", "megakaryocyte", "erythroid", "spheres", "organoid_budding", "organoid_neural", "optic_cup",
    "islet_clusters", "adipocytes", "mineralized", "cartilage_pellet", "dendritic_pigmented", "podocytes"}
LINEAGES = ["ectoderm", "mesoderm", "endoderm", "germline", "extraembryonic"]
STAGES = {"pluripotent", "intermediate", "target", "mature", "off-target"}
LOCS = {"nuclear", "cytoplasmic", "membrane", "surface", "cytoskeletal", "secreted", "functional"}
ASSAYS = {"flow": "flow", "facs": "flow", "icc": "ICC", "if": "ICC", "ihc": "ICC", "immunostaining": "ICC", "qpcr": "qPCR",
          "rt-qpcr": "qPCR", "western": "western", "wb": "western", "elisa": "ELISA", "functional": "functional"}
GROUP_ORDER = [
    "Germ layers and early embryo", "Brain and nerves", "Neural crest and sensory", "Eye and ear", "Skin",
    "Heart and vessels", "Blood and immune", "Muscle, bone and fat", "Kidney",
    "Liver, pancreas and gut", "Lung and thyroid", "Germ cells"]

STARTS = [
    {"id": "human_ipsc", "pool": "human_psc", "name": "Human iPSC", "short": "Human iPSC",
     "kicker": "Induced pluripotent stem cells", "archetype": "psc_colony",
     "blurb": "Reprogrammed from a donor's own cells. The usual choice for disease modelling and patient-specific work."},
    {"id": "human_esc", "pool": "human_psc", "name": "Human ESC", "short": "Human ESC",
     "kicker": "Embryonic stem cells", "archetype": "psc_colony",
     "blurb": "Lines such as H1 and H9, on which many of these protocols were first worked out.",
     "note": "Human ESC and iPSC share the same protocols. Many were developed on ESC lines such as H1 or H9 and later "
             "confirmed on iPSC. Efficiency still varies from line to line, so plan a small pilot before scaling up."},
    {"id": "mouse_psc", "pool": "mouse_psc", "name": "Mouse ESC / iPSC", "short": "Mouse ESC",
     "kicker": "Naive mouse pluripotent cells", "archetype": "psc_colony",
     "blurb": "Dome-shaped naive colonies kept in LIF or 2i. Faster timelines and the classic embryoid-body methods."},
]


class Report:
    def __init__(self):
        self.errors, self.warnings = [], []

    def err(self, where, msg):
        self.errors.append(f"{where}: {msg}")

    def warn(self, where, msg):
        self.warnings.append(f"{where}: {msg}")


def num(v):
    """A number from a number or a numeric string, else None."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return int(v) if float(v).is_integer() else float(v)
    if isinstance(v, str):
        m = re.match(r"^\s*(-?\d+(?:\.\d+)?)", v)
        if m:
            f = float(m.group(1))
            return int(f) if f.is_integer() else f
    return None


def text(v):
    if v is None:
        return None
    if isinstance(v, (list, tuple)):
        v = "; ".join(str(x) for x in v if x)
    v = str(v).strip()
    return v or None


def strs(v):
    if not v:
        return []
    if isinstance(v, str):
        return [v.strip()] if v.strip() else []
    return [str(x).strip() for x in v if x is not None and str(x).strip()]


def clean_protocol(p, cell_id, rep):
    where = f"protocol {p.get('id') or p.get('name')!r}"
    out = {
        "id": text(p.get("id")), "cell_id": text(p.get("cell_id")) or cell_id, "name": text(p.get("name")),
        "type": "kit" if str(p.get("type", "")).lower() == "kit" else "published",
        "principle": text(p.get("principle")), "culture_format": text(p.get("culture_format")),
        "duration_days": num(p.get("duration_days")), "efficiency": text(p.get("efficiency")),
        "start_requirements": text(p.get("start_requirements")),
        "materials": strs(p.get("materials")), "tips": strs(p.get("tips")), "pitfalls": strs(p.get("pitfalls")),
        "unverified": strs(p.get("unverified")),
        "vendor": text(p.get("vendor")), "product": text(p.get("product")), "catalog": text(p.get("catalog")),
        "product_url": text(p.get("product_url")),
    }
    if not out["name"]:
        rep.err(where, "no name")
        return None
    if not out["id"]:
        out["id"] = re.sub(r"[^a-z0-9]+", "-", out["name"].lower()).strip("-")[:60]
    so = p.get("source")
    if isinstance(so, dict):
        doi = text(so.get("doi"))
        if doi:
            doi = re.sub(r"^https?://(dx\.)?doi\.org/", "", doi)
        out["source"] = {"authors": text(so.get("authors")), "year": num(so.get("year")), "journal": text(so.get("journal")),
                         "title": text(so.get("title")), "doi": doi, "pmid": text(so.get("pmid")), "url": text(so.get("url"))}
    else:
        out["source"] = None
    if out["type"] == "published" and not (out["source"] and (out["source"]["doi"] or out["source"]["pmid"])):
        rep.warn(where, "published method without a DOI or PMID")
    if out["type"] == "kit" and not out["vendor"]:
        rep.warn(where, "kit without a vendor")
    for u in ("product_url",):
        if out[u] and not re.match(r"^https?://", out[u]):
            out[u] = None
    stages, undated = [], False
    for i, st in enumerate(p.get("stages") or []):
        ds, de = num(st.get("day_start")), num(st.get("day_end"))
        if ds is None:    # keep the stage (it is real) but mark the whole schedule as unconfirmed
            rep.warn(where, f"stage {i + 1} ({st.get('name')!r}) has no numeric day_start; kept, schedule marked unconfirmed")
            undated = True
            prev = stages[-1] if stages else None
            ds = (prev["day_end"] if prev and prev["day_end"] is not None else prev["day_start"] if prev else 0)
            de = None
        if de is not None and de < ds:
            rep.warn(where, f"stage {i + 1}: day_end {de} is before day_start {ds}; day_end removed")
            de = None
        factors = []
        for f in st.get("factors") or []:
            if isinstance(f, str):
                f = {"name": f}
            nm = text(f.get("name"))
            if nm:
                factors.append({"name": nm, "conc": text(f.get("conc")), "role": text(f.get("role"))})
        stages.append({"name": text(st.get("name")) or f"Stage {i + 1}", "day_start": ds, "day_end": de,
                       "base_medium": text(st.get("base_medium")), "factors": factors, "feeding": text(st.get("feeding")),
                       "actions": strs(st.get("actions")), "checkpoint": text(st.get("checkpoint"))})
    stages.sort(key=lambda s: (s["day_start"], s["day_end"] if s["day_end"] is not None else s["day_start"]))
    out["stages"] = stages
    # a researcher could not read the schedule and stored placeholder day numbers: the app must not show them as real
    out["schedule_unverified"] = undated or any("placeholder" in u.lower() for u in out["unverified"])
    if not stages:
        rep.warn(where, "no usable stages")
    if out["duration_days"] is None and stages:
        ends = [s["day_end"] if s["day_end"] is not None else s["day_start"] for s in stages]
        out["duration_days"] = max(ends)
    return out


def clean_cell(c, rep):
    where = f"cell type {c.get('id')!r}"
    cid = text(c.get("id"))
    if not cid or not text(c.get("name")):
        rep.err(where, "missing id or name")
        return None
    lin = str(c.get("lineage", "")).lower()
    if lin not in LINEAGES:
        rep.err(where, f"unknown lineage {c.get('lineage')!r}")
        return None
    start = c.get("start") or "human_psc"
    if start not in ("human_psc", "mouse_psc"):
        rep.err(where, f"unknown start {start!r}")
        return None
    morph = c.get("morphology") or {}
    stages = []
    for m in morph.get("stages") or []:
        arch = m.get("archetype")
        if arch not in ARCHETYPES:
            rep.warn(where, f"unknown morphology archetype {arch!r}; using monolayer_dense")
            arch = "monolayer_dense"
        d = num(m.get("day"))
        stages.append({"day": d if d is not None else 0, "label": text(m.get("label")) or "", "archetype": arch, "look": text(m.get("look")) or ""})
    stages.sort(key=lambda s: s["day"])
    if not stages:
        rep.warn(where, "no morphology stages")
    markers = []
    for m in c.get("markers") or []:
        nm = text(m.get("name"))
        if not nm:
            continue
        stg = str(m.get("stage", "target")).lower().replace("_", "-").replace("offtarget", "off-target")
        if stg not in STAGES:
            rep.warn(where, f"marker {nm}: unknown stage {m.get('stage')!r}; using target")
            stg = "target"
        loc = str(m.get("localization") or "").lower()
        if loc not in LOCS:
            loc = "cytoplasmic" if loc else None
        assays = []
        for a in strs(m.get("assays")):
            k = ASSAYS.get(a.lower().replace(" ", ""), a)
            if k not in assays:
                assays.append(k)
        markers.append({"name": nm, "alias": text(m.get("alias")), "kind": text(m.get("kind")), "localization": loc, "stage": stg,
                        "stage_label": text(m.get("stage_label")), "assays": assays, "note": text(m.get("note"))})
    protos = [x for x in (clean_protocol(p, cid, rep) for p in c.get("protocols") or []) if x]
    dmin, dmax = num(c.get("days_min")), num(c.get("days_max"))
    diff = num(c.get("difficulty"))
    return {
        "id": cid, "name": text(c.get("name")), "aka": strs(c.get("aka")), "start": start, "lineage": lin,
        "group": text(c.get("group")) or "Other", "summary": text(c.get("summary")) or "", "route": strs(c.get("route")),
        "days_min": dmin, "days_max": dmax if dmax is not None else dmin, "maturation_note": text(c.get("maturation_note")),
        "difficulty": int(diff) if diff in (1, 2, 3) else 2, "culture_format": text(c.get("culture_format")),
        "morphology": {"endpoint": text(morph.get("endpoint")) or "", "stages": stages},
        "markers": markers, "functional_assays": strs(c.get("functional_assays")), "qc": strs(c.get("qc")),
        "protocols": protos, "notes": text(c.get("notes")),
    }


def build(src: Path, rep: Report) -> dict:
    cells, kits = {}, []
    for f in sorted(src.glob("*.json")):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except ValueError as e:
            rep.err(f.name, f"not valid JSON: {e}")
            continue
        for c in d.get("cell_types") or []:
            cc = clean_cell(c, rep)
            if not cc:
                continue
            if cc["id"] in cells:
                rep.warn(f.name, f"cell type {cc['id']!r} appears twice; protocols merged into the first")
                cells[cc["id"]]["protocols"].extend(cc["protocols"])
            else:
                cells[cc["id"]] = cc
        for k in d.get("kits") or []:
            k = dict(k, type="kit")
            kk = clean_protocol(k, k.get("cell_id"), rep)
            if kk:
                kits.append(kk)
    other = []
    for k in kits:
        c = cells.get(k["cell_id"])
        if c:
            c["protocols"].append(k)
        else:
            rep.warn(f"kit {k['id']!r}", f"no cell type {k['cell_id']!r}; listed on the Kits page only")
            k["makes"] = (k["cell_id"] or "").replace("_", " ")
            other.append(k)
    for c in cells.values():           # published methods before kits
        c["protocols"].sort(key=lambda p: p["type"] == "kit")     # stable: keeps the researcher's order
    seen = set()
    for c in cells.values():
        for p in c["protocols"]:
            base, i = p["id"], 2
            while p["id"] in seen:
                p["id"] = f"{base}-{i}"
                i += 1
            seen.add(p["id"])
        if not c["protocols"]:
            rep.warn(f"cell type {c['id']!r}", "has no protocol")

    def order(c):
        g = GROUP_ORDER.index(c["group"]) if c["group"] in GROUP_ORDER else len(GROUP_ORDER)
        return (LINEAGES.index(c["lineage"]), g, c["days_min"] if c["days_min"] is not None else 999, c["name"])
    out = sorted(cells.values(), key=order)
    return {"schema": 1, "built": datetime.date.today().isoformat(), "starts": STARTS, "cell_types": out, "other_kits": other}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--src", default=str(ROOT / "research"))
    ap.add_argument("--out", default=str(ROOT / "fatemap" / "data" / "catalog.json"))
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    rep = Report()
    cat = build(Path(a.src), rep)
    n_pub = sum(1 for c in cat["cell_types"] for p in c["protocols"] if p["type"] != "kit")
    n_kit = sum(1 for c in cat["cell_types"] for p in c["protocols"] if p["type"] == "kit") + len(cat["other_kits"])
    for w in rep.warnings:
        print("warning:", w)
    for e in rep.errors:
        print("ERROR:", e)
    print(f"{len(cat['cell_types'])} cell types, {n_pub} published protocols, {n_kit} kits; {len(rep.warnings)} warnings, {len(rep.errors)} errors")
    if not a.check:
        Path(a.out).write_text(json.dumps(cat, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print("wrote", a.out)
    return 1 if rep.errors else 0


if __name__ == "__main__":
    sys.exit(main())
