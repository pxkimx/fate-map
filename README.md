# Fate Map

An offline guide to differentiating pluripotent stem cells. Pick a starting cell (human iPSC, human ESC or mouse ESC/iPSC),
see every cell type it can become, pick one, and get:

- the **published protocols and commercial kits** for it, side by side;
- a **day-by-day plan** (medium, factors and amounts, feeding, checkpoints), with real dates from your day 0,
  a calendar export (.ics), a shopping list and a print view;
- **what the culture should look like** at each stage (simulated phase-contrast and immunofluorescence views);
- the **markers** to test, grouped by pluripotency loss, intermediate stages, target cell, maturity and off-target,
  with the assays that suit each, plus functional tests and acceptance checks;
- **My runs**: start a run from any protocol (cell line, passage, day 0, vessel). The app then shows what to do **today**
  (stage, medium change due, factors and amounts, checklist, checkpoint, what the culture should look like, markers worth
  checking), keeps a dated **notebook** for the run (observations, results, problems, changes; export as Markdown), and has a
  **reagent calculator**: medium volume per change from your vessel and count, factor amounts from your own stock
  concentrations, totals for the run and a prep calendar you can print or add to your calendar. Runs, notes and stocks are
  saved only on this computer, in `~/Library/Application Support/Fate Map/notebook.json`.
- a **lineage map**, a **reagent index** (which factors each protocol needs) and search across cells, markers, kits and reagents.

Everything runs on your own computer; nothing is uploaded.

The calculator uses common working volumes per vessel (for example 2 mL per well of a 6-well plate), which are not from the papers, and works out a factor amount only where the protocol states a concentration it can read and you have entered your stock. Ranges and odd source units are left for you to read in the paper.

## Run it

```bash
python3 -m fatemap.server          # http://localhost:8793, needs Python 3.9+ and nothing else
```

On macOS, `macos/build_app.sh` builds a double-clickable **Fate Map.app**. The app quits completely when you close its window.

## Where the data comes from

`research/*.json` holds the researched protocols (one file per area, format in `research/SCHEMA.md`);
`python3 scripts/build_catalog.py` checks them and writes `fatemap/data/catalog.json`.
Each published protocol was summarised from the paper (or its protocol-journal version) with the citation checked against PubMed;
each kit from the vendor's product page or manual. A value that could not be confirmed is left blank and listed in the protocol's
"check in the source" box rather than guessed. Protocols whose schedule could not be read are marked *Schedule not confirmed*
and show no timeline.

These are planning summaries. They leave out details that matter at the bench, so read the original paper or the current
kit manual before starting, and expect to tune any protocol to your own line.

The micrographs are simulations drawn from published descriptions, not photographs or measured data.

## Tests

```bash
python3 -m pytest tests
```

MIT licence. Copyright (c) 2026 Paul H. Kim.
