/* Fate Map reagent calculator: pure functions, no page access.
   Concentrations and stocks are parsed from the protocol text ("12 µM", "20 ng/mL", "1X", "2%", "1:1000"); anything that
   cannot be read with confidence is returned as null so the page can say "see the source" rather than guess.
   The medium volumes per vessel are common working volumes, not from the papers; the page says so. */
(function () {
  "use strict";

  // working medium volume per well / dish / flask (mL)
  const VESSELS = [
    { id: "96", label: "96-well plate (per well)", ml: 0.1 },
    { id: "48", label: "48-well plate (per well)", ml: 0.25 },
    { id: "24", label: "24-well plate (per well)", ml: 0.5 },
    { id: "12", label: "12-well plate (per well)", ml: 1 },
    { id: "6", label: "6-well plate (per well)", ml: 2 },
    { id: "35", label: "35 mm dish", ml: 2 },
    { id: "60", label: "60 mm dish", ml: 4 },
    { id: "100", label: "100 mm dish", ml: 10 },
    { id: "t25", label: "T25 flask", ml: 5 },
    { id: "t75", label: "T75 flask", ml: 12 },
    { id: "t175", label: "T175 flask", ml: 30 },
  ];

  const PREFIX = { p: 1e-12, n: 1e-9, "µ": 1e-6, "μ": 1e-6, u: 1e-6, m: 1e-3, "": 1 };
  const num = (s) => parseFloat(String(s).replace(/,/g, ""));

  /* -> {family, base, text} | null.  family: molar (base mol/L), mass (g/L), frac (fraction), x (fold). */
  function parseConc(text) {
    if (text == null) return null;
    // a bracketed note ("12 µM (test 6-14 µM per line)") or a word like "final" or "each" does not change the dose itself
    const t = String(text).trim().replace(/\u00a0/g, " ").replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+(final|each)$/i, "").trim();
    let m;
    if ((m = /^([\d.,]+)\s*(?:I?U|u)\s*\/\s*(m?)[lL]$/.exec(t)) && /U\s*\//.test(t)) return { family: "units", base: num(m[1]) * (m[2] ? 1000 : 1), text: t };
    if ((m = /^([\d.,]+)\s*([pnµμum]?)M$/.exec(t))) return { family: "molar", base: num(m[1]) * PREFIX[m[2]], text: t };
    if ((m = /^([\d.,]+)\s*([pnµμum]?)g\s*\/\s*(m?)[lL]$/.exec(t))) {
      const g = num(m[1]) * PREFIX[m[2]];
      return { family: "mass", base: m[3] ? g * 1000 : g, text: t };
    }
    if ((m = /^([\d.,]+)\s*%(\s*\((?:v\/v|w\/v|v:v)\))?$/.exec(t))) return { family: "frac", base: num(m[1]) / 100, text: t };
    if ((m = /^([\d.,]+)\s*[xX]$/.exec(t))) return { family: "x", base: num(m[1]), text: t };
    if ((m = /^1\s*:\s*([\d,]+)$/.exec(t))) return { family: "frac", base: 1 / num(m[1]), text: t };
    return null;
  }

  /* microlitres of stock for a final concentration in volumeMl; null if the two are not comparable */
  function stockMicrolitres(conc, stock, volumeMl) {
    if (!conc || !stock || conc.family !== stock.family || !(stock.base > 0) || !isFinite(conc.base)) return null;
    return (conc.base / stock.base) * volumeMl * 1000;
  }

  /* how often is medium changed in a stage? -> {interval (days), assumed (bool), once (bool)} */
  function parseFeeding(text) {
    const t = (text || "").toLowerCase();
    if (/every other day|alternate day/.test(t)) return { interval: 2, assumed: false };
    let m = /every\s+(\d+(?:\.\d+)?)\s*(?:[-–to]+\s*(\d+(?:\.\d+)?))?\s*(?:hours?|h)\b/.exec(t);
    if (m && !m[2]) return { interval: num(m[1]) / 24, assumed: false };
    m = /every\s+(\d+(?:\.\d+)?)\s*(?:[-–to]+\s*(\d+(?:\.\d+)?))?\s*(?:days?|d)\b/.exec(t);
    if (m) return { interval: num(m[1]), assumed: !!m[2] };
    if (/\bdaily\b|every day|each day|every 24\s*h|once a day|per day/.test(t)) return { interval: 1, assumed: false };
    if (/\bsingle\b|\bonce\b|one dose|one-time|no (?:medium )?change|without (?:a )?(?:medium )?change|24\s*h only|for 24\s*h/.test(t)) return { interval: 0, assumed: false, once: true };
    return { interval: 2, assumed: true };
  }

  /* the day numbers on which a stage's medium is made up (start day, then every `interval` days until the stage ends) */
  function feedDays(stage, interval, isLast) {
    const s = stage.day_start, e = stage.day_end == null ? s : stage.day_end;
    const out = [s];
    if (interval > 0) for (let d = s + interval; d < e; d += interval) out.push(Math.round(d * 100) / 100);
    return out;
  }

  const fmtMl = (ml) => (ml >= 10 ? ml.toFixed(0) : ml >= 1 ? ml.toFixed(1) : ml.toFixed(2).replace(/0$/, "")) + " mL";
  const fmtUl = (ul) => (ul >= 1000 ? (ul / 1000).toFixed(2).replace(/\.?0+$/, "") + " mL" : ul >= 10 ? ul.toFixed(0) + " µL" : ul.toFixed(1).replace(/\.0$/, "") + " µL");

  /* Build the plan for a run.
     run: {vessel, count, overage (percent), intervals: {stageIndex: days}}   stocks: {lower-case factor name: "10 mM"}
     Returns {stages: [...], feeds: [...], totals: {media: {...}, factors: {...}}} */
  function plan(protocol, run, stocks) {
    const vessel = VESSELS.find((v) => v.id === run.vessel) || VESSELS[4];
    const count = Math.max(1, +run.count || 1);
    const over = 1 + Math.max(0, +run.overage || 0) / 100;
    const perFeedMl = vessel.ml * count * over;
    const stages = (protocol.stages || []).map((st, i) => {
      const parsed = parseFeeding(st.feeding);
      const ov = run.intervals && run.intervals[i] != null && run.intervals[i] !== "" ? +run.intervals[i] : null;
      const interval = ov != null && !isNaN(ov) ? ov : parsed.interval;
      const days = feedDays(st, interval, i === (protocol.stages.length - 1));
      return { i, st, interval, assumed: ov != null ? false : parsed.assumed, once: ov != null ? ov === 0 : !!parsed.once, edited: ov != null, days, perFeedMl };
    });
    const totals = { media: {}, factors: {} };
    const feeds = [];
    stages.forEach((sg) => {
      const facs = (sg.st.factors || []).map((f) => {
        const conc = parseConc(f.conc);
        const stock = parseConc((stocks || {})[String(f.name).toLowerCase()]);
        const ul = conc && stock ? stockMicrolitres(conc, stock, perFeedMl) : null;
        return { name: f.name, concText: f.conc, conc, stock, ulPerFeed: ul, role: f.role };
      });
      sg.factors = facs;
      const medium = sg.st.base_medium || "Medium (see protocol)";
      sg.mediumTotalMl = perFeedMl * sg.days.length;
      totals.media[medium] = (totals.media[medium] || 0) + sg.mediumTotalMl;
      facs.forEach((f) => {
        const key = f.name;
        const t = totals.factors[key] || (totals.factors[key] = { name: f.name, ul: 0, known: true, concText: f.concText, anyConc: false, stockText: f.stock ? f.stock.text : null });
        if (f.conc) t.anyConc = true;
        if (f.ulPerFeed == null) t.known = false;
        else t.ul += f.ulPerFeed * sg.days.length;
      });
      sg.days.forEach((d) => feeds.push({ day: d, stage: sg.st.name, stageIndex: sg.i, medium, factors: facs, mlTotal: perFeedMl }));
    });
    feeds.sort((a, b) => a.day - b.day || a.stageIndex - b.stageIndex);
    return { vessel, count, perFeedMl, stages, feeds, totals };
  }

  window.Calc = { VESSELS, parseConc, stockMicrolitres, parseFeeding, feedDays, plan, fmtMl, fmtUl };
})();
