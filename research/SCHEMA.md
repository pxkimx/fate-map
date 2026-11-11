# Fate Map — research brief and data format

Fate Map is an offline desktop app for a working cell biologist. They pick a starting cell
(human iPSC/ESC, or mouse ESC/iPSC), see every cell type it can be differentiated into, pick one,
and get: the published protocols and commercial kits side by side, a day-by-day plan, what the
cells should look like at each stage, and the markers to test.

You are researching ONE slice of that catalogue. Your output is ONE JSON file (path given in your
task). The app loads it directly, so follow the format exactly.

## Accuracy rules (the point of the whole exercise)

1. **Everything comes from a source you looked up in this session**, not from memory: the paper
   (PubMed record, publisher page, PMC full text, protocol paper) or the vendor's own product page
   or manual. Use the PubMed tools and web search/fetch. Load deferred tools with ToolSearch
   (for example `select:WebSearch,WebFetch` and the pubmed search/metadata/full-text tools).
2. **Never invent** a concentration, day, catalogue number, efficiency, DOI or PMID. If you cannot
   confirm a value, set it to `null` and add a line to the protocol's `unverified` list saying what
   is missing. A protocol with honest gaps is useful; a confident wrong number wastes weeks of
   someone's bench time.
3. Confirm each citation's PMID and DOI against PubMed (authors, year, journal, title).
4. **Write in your own words.** Do not copy sentences from papers or manuals. Reagent names,
   concentrations and timings are facts and are fine to state.
5. Prefer the landmark protocol people actually use plus the best current refinement. Two to four
   published protocols per cell type is right; one is acceptable for niche cell types. Give the
   concentrations and timings as that paper states them, not a blend of several papers.
6. Where papers disagree, or a protocol is known to be line-dependent (for example the CHIR99021
   dose for cardiomyocytes), say so in `tips` or `pitfalls`.

## File format

```json
{
  "area": "your-slice-name",
  "cell_types": [ CellType, ... ],
  "kits": [ Protocol, ... ]        // only the commercial-kit researcher fills this; others use []
}
```

### CellType

```json
{
  "id": "cardiomyocyte",                 // use the id given in your task list
  "name": "Cardiomyocytes",
  "aka": ["hiPSC-CM", "ventricular-like cardiomyocytes"],
  "start": "human_psc",                  // "human_psc" or "mouse_psc"
  "lineage": "mesoderm",                 // ectoderm | mesoderm | endoderm | germline | extraembryonic
  "group": "Heart and vessels",          // use the group given in your task list
  "summary": "Two sentences: what the cell is and what people use the iPSC-derived version for.",
  "route": ["Pluripotent", "Mesendoderm", "Cardiac mesoderm", "Cardiac progenitor", "Cardiomyocyte"],
  "days_min": 10, "days_max": 15,        // days from day 0 to first usable target cells (typical)
  "maturation_note": "e.g. beating from day 8-10; metabolic selection and 30+ days for maturity",
  "difficulty": 2,                       // 1 routine, 2 moderate, 3 demanding (long, 3D, low yield or line-dependent)
  "culture_format": "2D monolayer",      // 2D monolayer | 3D suspension | embryoid bodies | organoid | co-culture | mixed
  "morphology": {
    "endpoint": "What the finished culture looks like down a phase-contrast microscope, 1-3 sentences.",
    "stages": [                          // 3 to 6 entries covering day 0 to endpoint
      {"day": 0,  "label": "Pluripotent colonies", "archetype": "psc_colony",
       "look": "One or two sentences on what you see at this point."},
      {"day": 12, "label": "Beating sheets", "archetype": "cardiomyocytes", "look": "..."}
    ]
  },
  "markers": [
    {"name": "TNNT2", "alias": "cardiac troponin T, cTnT", "kind": "protein",
     "localization": "cytoskeletal",     // nuclear | cytoplasmic | membrane | surface | cytoskeletal | secreted | functional
     "stage": "target",                  // pluripotent (should be lost) | intermediate | target | mature | off-target (should be absent)
     "stage_label": "Cardiomyocyte",     // which route step it marks
     "assays": ["flow", "ICC"],          // flow | ICC | qPCR | western | ELISA | functional
     "note": "Standard purity readout; expect >80% in a good run."}
  ],
  "functional_assays": ["Spontaneous contraction", "Calcium transients", "MEA field potentials"],
  "qc": ["Short, practical acceptance checks, e.g. 'TNNT2+ >= 80% by flow at day 15'. Only if a source supports it."],
  "protocols": [ Protocol, ... ],        // published methods only; kits go in the kits file
  "notes": "Anything a newcomer must know (line-to-line variability, need for sorting, etc.)."
}
```

Markers: give 6-14 per cell type, covering loss of pluripotency (OCT4/POU5F1, NANOG), the
intermediate stages, the target cell, maturity, and one or two off-target markers worth checking.
Use HGNC gene symbols in `name` (mouse symbols for mouse) and put the common protein name in `alias`.

### Protocol

```json
{
  "id": "lian-2013-giwi",                // firstauthor-year-shortname, lowercase, unique
  "cell_id": "cardiomyocyte",
  "name": "GiWi: Wnt on, then Wnt off (small molecules)",
  "type": "published",                   // published | kit
  "principle": "One or two sentences on the logic of the method.",
  "source": {
    "authors": "Lian X, Zhang J, Azarin SM, et al.",
    "year": 2013, "journal": "Nat Protoc",
    "title": "Exact article title",
    "doi": "10.1038/nprot.2012.150", "pmid": "23257984",
    "url": "https://doi.org/10.1038/nprot.2012.150"
  },
  "vendor": null, "product": null, "catalog": null, "product_url": null,   // kits only
  "culture_format": "2D monolayer",
  "duration_days": 15,
  "efficiency": "80-98% cTnT+ cells reported",     // as the source reports it, or null
  "start_requirements": "What the starting culture must be: matrix, medium, confluency, seeding density, ROCK inhibitor.",
  "stages": [
    {
      "name": "Mesoderm induction",
      "day_start": 0, "day_end": 1,      // numbers; day_end is the day this stage's medium is replaced by the next
      "base_medium": "RPMI 1640 + B-27 minus insulin",
      "factors": [
        {"name": "CHIR99021", "conc": "12 µM", "role": "GSK3 inhibitor; switches Wnt on"}
      ],
      "feeding": "Single dose for 24 h",
      "actions": ["Start when cells are fully confluent", "..."],   // short imperative steps, your own words
      "checkpoint": "What you should see or measure before moving on, or null"
    }
  ],
  "materials": ["Matrigel or Synthemax plates", "RPMI 1640", "B-27 supplement minus insulin", "CHIR99021", "IWP2"],
  "tips": ["..."],
  "pitfalls": ["..."],
  "unverified": []                       // each value you could not confirm from the source
}
```

For kits, `factors` holds the kit components used at that stage (for example
`{"name": "STEMdiff Cardiomyocyte Differentiation Medium A", "conc": null, "role": "day 0-2 medium (composition proprietary)"}`),
`source` may be null, and `vendor`, `product`, `catalog`, `product_url` are required. Take the
schedule from the vendor's product information sheet or manual.

### Morphology archetypes

The app draws each stage as a synthetic micrograph. Pick the closest archetype for every stage:

| archetype | what it draws |
|---|---|
| `psc_colony` | compact flat pluripotent colonies with sharp edges, tightly packed small cells |
| `monolayer_dense` | confluent sheet of small, uniform cells (early germ-layer stages) |
| `cobblestone` | polygonal epithelial/endothelial sheet |
| `hepatocyte` | polygonal cells, some binucleate, bright borders |
| `pigmented_epithelium` | hexagonal pigmented sheet (RPE) |
| `rosettes` | neural rosettes in a neuroepithelial sheet |
| `neurons` | cell bodies with long neurites forming a network |
| `astrocytes` | flat stellate cells |
| `oligodendrocytes` | small bodies with dense, highly branched processes |
| `microglia` | small ramified cells |
| `spindle` | elongated fibroblast-like / mesenchymal / smooth-muscle cells |
| `myotubes` | long aligned multinucleated fibres |
| `cardiomyocytes` | contracting sheets and networks |
| `round_suspension` | round, bright, floating or loosely attached cells (blood progenitors, lymphocytes) |
| `macrophage` | large adherent "fried-egg" cells with vacuoles |
| `megakaryocyte` | very large cells, some with proplatelet extensions |
| `erythroid` | small round haemoglobinised cells |
| `spheres` | smooth 3D aggregates: embryoid bodies, neurospheres, spheroids |
| `organoid_budding` | epithelial organoids with lumens and buds (gut, kidney, lung) |
| `organoid_neural` | brain organoid with neuroepithelial loops |
| `optic_cup` | retinal organoid with a laminated bright rim |
| `islet_clusters` | endocrine cell clusters |
| `adipocytes` | cells filled with lipid droplets |
| `mineralized` | osteogenic layer with dark mineral nodules |
| `cartilage_pellet` | dense chondrogenic nodules / pellets |
| `dendritic_pigmented` | dendritic pigmented cells (melanocytes) |
| `podocytes` | large arborised cells with interdigitating processes |

## Before you finish

- Write the file with Python's `json` module or validate it with `python3 -c "import json;json.load(open(PATH))"`.
- Every cell type in your list has at least one protocol with at least two stages, each stage with numeric `day_start`/`day_end`.
- Your final message: the file path, the cell types covered, and a plain list of anything you
  could not verify or any cell type you dropped and why. Keep it short; the data is in the file.
