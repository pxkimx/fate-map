/* Fate Map front end. One page, hash routes:
   #/start · #/fates · #/cell/<id>[/<protocol id>] · #/kits · #/reagents · #/about */
(function () {
  "use strict";
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const app = $("#app");

  // The server quits when this connection drops (window closed); a reload reconnects within the grace period.
  try { new EventSource("/api/window"); } catch (e) { /* not fatal */ }

  // ------------------------------------------------------------ small helpers
  function h(tag, attrs) {
    const el = tag === "svg" || (attrs && attrs.ns) ? document.createElementNS("http://www.w3.org/2000/svg", tag) : document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v == null || v === false || k === "ns") continue;
      if (k === "class") el.setAttribute("class", v);
      else if (k === "style" && typeof v === "object") for (const s in v) el.style.setProperty(s, v[s]);
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else if (k === "data") for (const d in v) el.dataset[d] = v[d];
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (let i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) kid.forEach((k) => add(el, k));
    else el.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  const s = (tag, attrs, ...kids) => h(tag, Object.assign({ ns: 1 }, attrs), ...kids);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  const plural = (n, w, ws) => n + " " + (n === 1 ? w : ws || w + "s");
  const LIN = [
    { id: "ectoderm", name: "Ectoderm", v: "--ecto" }, { id: "mesoderm", name: "Mesoderm", v: "--meso" },
    { id: "endoderm", name: "Endoderm", v: "--endo" }, { id: "germline", name: "Germline", v: "--germ" },
    { id: "extraembryonic", name: "Extraembryonic", v: "--extra" }];
  const LIN_NAME = Object.fromEntries(LIN.map((l) => [l.id, l.name]));
  const DIFF = { 1: "Routine", 2: "Moderate", 3: "Demanding" };
  const STAINABLE = ["nuclear", "cytoplasmic", "membrane", "surface", "cytoskeletal", "secreted"];
  const GREEN = [70, 235, 130], RED = [255, 80, 105];

  let DB = null;
  let START = store.get("fm-start", "");

  // ------------------------------------------------------------ theme
  window.setTheme = function (t) {
    document.documentElement.setAttribute("data-theme", t);
    store.set("fm-theme", t);
    $$("#themePill button").forEach((b) => { b.classList.toggle("on", b.dataset.t === t); b.setAttribute("aria-pressed", b.dataset.t === t); });
    if (window.FateBg) window.FateBg.redraw();
  };
  $$("#themePill button").forEach((b) => b.addEventListener("click", () => window.setTheme(b.dataset.t)));
  window.setTheme(document.documentElement.getAttribute("data-theme") || "dark");

  // ------------------------------------------------------------ micrograph component
  const io = "IntersectionObserver" in window ? new IntersectionObserver((ents) => {
    ents.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); e.target._draw(); } });
  }, { rootMargin: "300px" }) : null;

  function scope(o) {
    const cv = h("canvas", { width: o.w || 480, height: o.h || 300, role: "img", "aria-label": o.alt || "Simulated micrograph" });
    const box = h("div", { class: "scope" }, cv,
      o.corners === false ? null : [h("i", { class: "corner tl" }), h("i", { class: "corner tr" })],
      o.tagL ? h("span", { class: "tag" }, o.tagL) : null, o.tagR ? h("span", { class: "tag r" }, o.tagR) : null);
    cv._draw = function () {
      const r = window.Micro.draw(cv, { archetype: o.archetype, seed: o.seed, mode: o.mode || "phase", stains: o.stains || [] });
      box.classList.toggle("beat", !!(r && r.beats) && o.beat !== false);
    };
    if (io && o.lazy !== false) io.observe(cv); else cv._draw();
    box._canvas = cv;
    return box;
  }
  const endStage = (c) => c.morphology.stages[c.morphology.stages.length - 1] || { archetype: "monolayer_dense" };

  // ------------------------------------------------------------ data access
  const pool = () => { const st = DB.starts.find((x) => x.id === START); return st ? st.pool : null; };
  const startObj = () => DB.starts.find((x) => x.id === START);
  const cellsFor = (p) => DB.cell_types.filter((c) => c.start === p);
  const cellById = (id) => DB.cell_types.find((c) => c.id === id);
  const daysText = (c) => (c.days_min == null ? "—" : c.days_min === c.days_max || c.days_max == null ? c.days_min + " days" : c.days_min + "–" + c.days_max + " days");
  function srcShort(p) {
    if (p.type === "kit") return p.vendor || "Commercial kit";
    const so = p.source || {};
    const first = (so.authors || "").split(/[ ,]/)[0];
    return [first, so.year, so.journal].filter(Boolean).join(" · ");
  }
  function diffDots(n) {
    return h("span", { class: "diff", title: "Difficulty: " + (DIFF[n] || "not rated") }, [1, 2, 3].map((i) => h("i", { class: i <= n ? "f" : "" })));
  }

  // ------------------------------------------------------------ router
  function route() {
    const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
    let view = parts[0] || "start";
    if (!DB) return;
    if (view === "fates" && !pool()) view = "start";
    $$("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.nav === (view === "cell" ? "fates" : view === "run" ? "runs" : view)));
    $$("dialog").forEach((d) => { if (d.open) d.close(); d.remove(); });   // a dialog must not outlive the page it was opened on
    app.innerHTML = "";
    const v = h("div", { class: "view" });
    app.appendChild(v);
    ({ start: viewStart, fates: viewFates, cell: viewCell, runs: viewRuns, run: viewRun, kits: viewKits, reagents: viewReagents, about: viewAbout }[view] || viewStart)(v, parts.slice(1));
    window.scrollTo(0, 0);
    document.title = (v.dataset.title ? v.dataset.title + " · " : "") + "Fate Map";
  }
  window.addEventListener("hashchange", route);

  // ------------------------------------------------------------ start
  function viewStart(v) {
    const nProt = DB.cell_types.reduce((n, c) => n + c.protocols.filter((p) => p.type !== "kit").length, 0);
    const nKit = DB.cell_types.reduce((n, c) => n + c.protocols.filter((p) => p.type === "kit").length, 0) + (DB.other_kits || []).length;
    add(v, h("section", { class: "hero" },
      h("div", { class: "kicker" }, "Pluripotent stem cell differentiation"),
      h("h1", {}, "Choose your starting cells. See every fate they can reach."),
      h("p", { class: "lead" }, "Published methods and commercial kits side by side, with a day-by-day plan, what the culture should look like at each stage, and the markers to check.")));
    add(v, h("div", { class: "starts" }, DB.starts.map((st) => {
      const n = cellsFor(st.pool).length;
      return h("a", { class: "panel start-card", href: "#/fates", onclick: () => { START = st.id; store.set("fm-start", st.id); } },
        scope({ archetype: st.archetype || "psc_colony", seed: st.id, w: 640, h: 360, tagL: "Phase contrast", tagR: "Day 0", alt: st.name + " colonies, simulated phase-contrast image" }),
        h("div", { class: "body" },
          h("div", { class: "kicker" }, st.kicker), h("h2", {}, st.name), h("p", { class: "muted", style: { margin: 0 } }, st.blurb),
          h("span", { class: "go" }, plural(n, "cell type") + " →")));
    })));
    add(v, h("div", { class: "stat-row" },
      stat(DB.cell_types.length, "Cell types"), stat(nProt, "Published protocols"), stat(nKit, "Commercial kits"), stat(refList().length, "Papers cited")));
    add(v, h("div", { class: "how" }, [
      ["01", "Pick a starting cell", "Human iPSC, human ESC or mouse ESC/iPSC."],
      ["02", "Pick a fate", "Browse by germ layer and organ, or follow the lineage map."],
      ["03", "Pick a method", "Compare published protocols and kits: time, format, efficiency."],
      ["04", "Follow the plan", "Media and factors by day, dated from your start, with checkpoints, markers and a shopping list."],
    ].map((x) => h("div", { class: "panel" }, h("div", { class: "num" }, x[0]), h("h3", { style: { margin: "6px 0 4px" } }, x[1]), h("p", { class: "muted", style: { margin: 0, "font-size": "14px" } }, x[2])))));
  }
  const stat = (n, l) => h("div", { class: "stat" }, h("span", { class: "n" }, n), h("span", { class: "l" }, l));

  // ------------------------------------------------------------ fates
  const F = { lin: "all", kit: false, max: 0, fmt: "all", sort: "lineage", view: store.get("fm-view", "gallery") };
  function viewFates(v) {
    const st = startObj(), all = cellsFor(st.pool);
    v.dataset.title = st.name;
    add(v, h("div", { class: "crumbs" }, h("a", { href: "#/start" }, "Start"), h("span", {}, "›"), h("span", {}, st.name)));
    add(v, h("div", { class: "fates-head" },
      h("div", {}, h("div", { class: "kicker" }, "Starting from " + st.name), h("h1", { style: { "font-size": "clamp(26px,3.4vw,40px)", "margin-top": "6px" } }, "What do you want to make?")),
      h("div", { class: "pill", role: "group", "aria-label": "View" },
        ["gallery", "map"].map((k) => h("button", { type: "button", class: F.view === k ? "on" : "", onclick: () => { F.view = k; store.set("fm-view", k); route(); } }, k === "gallery" ? "Gallery" : "Lineage map")))));
    if (st.note) add(v, h("p", { class: "callout", style: { "margin-bottom": "18px" } }, st.note));

    const bar = h("div", { class: "toolbar" });
    const body = h("div");
    add(v, bar); add(v, body);
    const counts = { all: all.length };
    LIN.forEach((l) => { counts[l.id] = all.filter((c) => c.lineage === l.id).length; });
    add(bar, h("button", { class: "fchip" + (F.lin === "all" ? " on" : ""), onclick: () => { F.lin = "all"; route(); } }, "All", h("span", { class: "c" }, counts.all)));
    LIN.filter((l) => counts[l.id]).forEach((l) => add(bar, h("button", { class: "fchip" + (F.lin === l.id ? " on" : ""), data: { lin: l.id }, onclick: () => { F.lin = l.id; route(); } },
      h("i", { class: "lin-dot" }), l.name, h("span", { class: "c" }, counts[l.id]))));
    add(bar, h("span", { class: "grow" }));
    if (F.view === "gallery") {
      add(bar, h("button", { class: "fchip" + (F.kit ? " on" : ""), onclick: () => { F.kit = !F.kit; route(); }, "aria-pressed": F.kit }, "Kit available"));
      add(bar, select("Time", [[0, "Any length"], [14, "Up to 2 weeks"], [30, "Up to 1 month"], [60, "Up to 2 months"]], F.max, (x) => { F.max = +x; route(); }));
      add(bar, select("Sort", [["lineage", "By lineage"], ["fast", "Fastest first"], ["easy", "Easiest first"], ["az", "A to Z"]], F.sort, (x) => { F.sort = x; route(); }));
    }
    let list = all.filter((c) => (F.lin === "all" || c.lineage === F.lin));
    if (F.view === "map") return fateMap(body, st, list);
    list = list.filter((c) => (!F.kit || c.protocols.some((p) => p.type === "kit")) && (!F.max || (c.days_min != null && c.days_min <= F.max)));
    if (!list.length) return add(body, h("div", { class: "empty panel" }, "No cell type matches these filters."));
    if (F.sort === "lineage") {
      const groups = [];
      list.forEach((c) => { let g = groups.find((x) => x.name === c.group); if (!g) groups.push(g = { name: c.group, lin: c.lineage, items: [] }); g.items.push(c); });
      groups.sort((a, b) => LIN.findIndex((l) => l.id === a.lin) - LIN.findIndex((l) => l.id === b.lin));
      groups.forEach((g) => {
        add(body, h("div", { class: "group-head" }, h("h2", {}, g.name), h("span", { class: "count" }, plural(g.items.length, "cell type"))));
        add(body, h("div", { class: "grid" }, g.items.map(card)));
      });
    } else {
      const key = { fast: (c) => c.days_min == null ? 999 : c.days_min, easy: (c) => (c.difficulty || 2) * 1000 + (c.days_min || 0), az: (c) => c.name.toLowerCase() }[F.sort];
      list = list.slice().sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
      add(body, h("div", { class: "grid", style: { "margin-top": "8px" } }, list.map(card)));
    }
  }
  function select(label, opts, val, on) {
    return h("select", { class: "sel", "aria-label": label, onchange: (e) => on(e.target.value) }, opts.map((o) => h("option", { value: o[0], selected: String(o[0]) === String(val) }, o[1])));
  }
  function card(c, i) {
    const es = endStage(c);
    const nk = c.protocols.filter((p) => p.type === "kit").length, np = c.protocols.length - nk;
    return h("a", { class: "panel card", href: "#/cell/" + c.id, data: { lin: c.lineage }, style: { "animation-delay": Math.min(i, 12) * 28 + "ms" } },
      scope({ archetype: es.archetype, seed: c.id, w: 480, h: 300, corners: false, alt: c.name + ", simulated phase-contrast image" }),
      h("div", { class: "body" },
        h("div", { class: "name" }, h("i", { class: "lin-dot" }), c.name),
        h("div", { class: "aka" }, (c.aka || []).slice(0, 2).join(" · ") || LIN_NAME[c.lineage]),
        h("div", { class: "meta" },
          h("span", { class: "chip" }, h("b", {}, daysText(c))),
          h("span", { class: "chip" }, diffDots(c.difficulty), DIFF[c.difficulty] || ""),
          np ? h("span", { class: "chip pub" }, plural(np, "protocol")) : null,
          nk ? h("span", { class: "chip kit" }, plural(nk, "kit")) : null)));
  }

  // radial lineage map
  function fateMap(body, st, list) {
    const order = list.slice().sort((a, b) => (LIN.findIndex((l) => l.id === a.lineage) - LIN.findIndex((l) => l.id === b.lineage)) || a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
    const N = order.length, C = 580, R1 = 86, R2 = 190, R3 = 292, SIZE = 1160;
    const short = (n) => { n = n.replace(/\s*\(.*$/, ""); return n.length > 28 ? n.slice(0, 27) + "…" : n; };
    const gap = 0.5; // leaf slots left empty between lineages
    const lins = [];
    order.forEach((c) => { let l = lins.find((x) => x.id === c.lineage); if (!l) lins.push(l = { id: c.lineage, groups: [] }); let g = l.groups.find((x) => x.name === c.group); if (!g) l.groups.push(g = { name: c.group, cells: [] }); g.cells.push(c); });
    const slots = N + lins.length * gap;
    let k = 0;
    const pol = (a, r) => [C + Math.cos(a) * r, C + Math.sin(a) * r];
    const link = (a0, r0, a1, r1) => { const p0 = pol(a0, r0), c0 = pol(a0, (r0 + r1) / 2), c1 = pol(a1, (r0 + r1) / 2), p1 = pol(a1, r1); return `M${p0[0].toFixed(1)},${p0[1].toFixed(1)}C${c0[0].toFixed(1)},${c0[1].toFixed(1)} ${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${p1[0].toFixed(1)},${p1[1].toFixed(1)}`; };
    const svg = s("svg", { viewBox: `0 0 ${SIZE} ${SIZE}`, role: "img", "aria-label": "Lineage map from " + st.name });
    const gl = s("g"), gn = s("g"), gm = s("g");
    add(svg, [gl, gm, gn]);
    const paths = [];
    lins.forEach((l) => {
      l.groups.forEach((g) => { g.cells.forEach((c) => { c._a = ((k + 0.5) / slots) * Math.PI * 2 - Math.PI / 2; k++; }); g.a = g.cells.reduce((t, c) => t + c._a, 0) / g.cells.length; });
      k += gap;
      l.a = l.groups.reduce((t, g) => t + g.a * g.cells.length, 0) / l.groups.reduce((t, g) => t + g.cells.length, 0);
      const lp = s("path", { class: "link", d: link(l.a, 16, l.a, R1), data: { lin: l.id } });
      add(gl, lp);
      l.groups.forEach((g) => {
        const gp = s("path", { class: "link", d: link(l.a, R1, g.a, R2), data: { lin: l.id } });
        add(gl, gp);
        g.cells.forEach((c) => {
          const cp = s("path", { class: "link", d: link(g.a, R2, c._a, R3), data: { lin: l.id } });
          add(gl, cp);
          c._links = [lp, gp, cp];
          paths.push({ d: [lp, gp, cp].map((p) => p.getAttribute("d")).join(" ").replace(/ M[^C]*C/g, " C"), lin: l.id });
          const deg = (c._a * 180) / Math.PI, flip = Math.cos(c._a) < 0;
          const p = pol(c._a, R3);
          const leaf = s("g", { class: "leaf node", data: { lin: l.id }, tabindex: 0, role: "link", "aria-label": c.name,
            transform: `translate(${p[0].toFixed(1)},${p[1].toFixed(1)}) rotate(${(flip ? deg + 180 : deg).toFixed(1)})`,
            onclick: () => { location.hash = "#/cell/" + c.id; }, onkeydown: (e) => { if (e.key === "Enter") location.hash = "#/cell/" + c.id; },
            onmouseenter: () => hot(c), onfocus: () => hot(c) },
            s("circle", { r: 4.2 }), s("title", {}, c.name), s("text", { x: flip ? -11 : 11, dy: "0.34em", "text-anchor": flip ? "end" : "start" }, short(c.name)));
          c._leaf = leaf;
          add(gn, leaf);
        });
        const q = pol(g.a, R2);
        add(gn, s("g", { class: "node", data: { lin: l.id } }, s("circle", { cx: q[0], cy: q[1], r: 3.4 }), s("title", {}, g.name)));
      });
      const q = pol(l.a, R1), deg = (l.a * 180) / Math.PI, flip = Math.cos(l.a) < 0;
      add(gn, s("g", { class: "node ring", data: { lin: l.id } }, s("circle", { cx: q[0], cy: q[1], r: 5.5 }),
        s("text", { transform: `translate(${pol(l.a, R1 + 12)[0]},${pol(l.a, R1 + 12)[1]}) rotate(${flip ? deg + 180 : deg})`, "text-anchor": flip ? "end" : "start", dy: "-0.7em" }, LIN_NAME[l.id])));
    });
    add(gn, s("g", { class: "root" }, s("circle", { cx: C, cy: C, r: 17 }), s("text", { x: C, y: C + 40 }, st.short || st.name)));
    // marbles rolling out to a random fate
    if (!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) {
      for (let i = 0; i < Math.min(9, paths.length); i++) {
        const p = paths[Math.floor(Math.random() * paths.length)], dur = 5 + Math.random() * 5, begin = (Math.random() * 6).toFixed(2) + "s";
        const m = s("circle", { class: "marble", r: 3.2, data: { lin: p.lin }, opacity: 0 },
          s("animateMotion", { dur: dur + "s", begin, repeatCount: "indefinite", path: p.d, calcMode: "spline", keyTimes: "0;1", keySplines: "0.4 0 0.6 1" }),
          s("animate", { attributeName: "opacity", values: "0;1;1;0", keyTimes: "0;0.1;0.85;1", dur: dur + "s", begin, repeatCount: "indefinite" }),
          s("animate", { attributeName: "fill", values: "var(--text);var(--lin)", dur: dur + "s", begin, repeatCount: "indefinite" }));
        add(gm, m);
      }
    }
    const info = h("div", { class: "panel mapinfo" });
    function hot(c) {
      $$(".link.hot", svg).forEach((x) => x.classList.remove("hot"));
      $$(".leaf.hot", svg).forEach((x) => x.classList.remove("hot"));
      c._links.forEach((x) => x.classList.add("hot"));
      c._leaf.classList.add("hot");
      info.innerHTML = ""; info.dataset.lin = c.lineage;
      const es = endStage(c);
      add(info, [scope({ archetype: es.archetype, seed: c.id, w: 480, h: 300, lazy: false, corners: false }),
        h("div", { class: "kicker", style: { color: "var(--lin)" } }, LIN_NAME[c.lineage] + " · " + c.group), h("h3", {}, c.name),
        h("p", { class: "muted", style: { margin: 0, "font-size": "13.5px" } }, c.summary),
        h("div", { class: "meta", style: { display: "flex", gap: "6px", "flex-wrap": "wrap" } }, h("span", { class: "chip" }, h("b", {}, daysText(c))), h("span", { class: "chip" }, plural(c.protocols.length, "method"))),
        h("a", { class: "btn primary", href: "#/cell/" + c.id, style: { "justify-self": "start" } }, "Open protocols →")]);
    }
    add(body, h("div", { class: "mapwrap" }, h("div", { class: "panel mapbox" }, svg), info));
    if (order[0]) hot(order[0]);
  }

  // ------------------------------------------------------------ cell page
  function viewCell(v, parts) {
    const c = cellById(parts[0]);
    if (!c) { add(v, h("div", { class: "empty panel" }, "That cell type is not in the catalogue. ", h("a", { href: "#/fates" }, "Back to cell types"))); return; }
    const st = DB.starts.find((x) => x.id === START && x.pool === c.start) || DB.starts.find((x) => x.pool === c.start);
    if (st && st.id !== START) { START = st.id; store.set("fm-start", START); }
    v.dataset.title = c.name; v.dataset.lin = c.lineage;
    add(v, h("div", { class: "crumbs" }, h("a", { href: "#/start" }, "Start"), h("span", {}, "›"), h("a", { href: "#/fates" }, st ? st.name : "Cell types"), h("span", {}, "›"), h("span", {}, c.group), h("span", {}, "›"), h("span", {}, c.name)));

    // viewer state
    const stages = c.morphology.stages;
    const V = { i: stages.length - 1, mode: "phase", g: null, r: null };
    const stainable = c.markers.filter((m) => STAINABLE.includes(m.localization) && (m.assays || []).some((a) => /icc|flow|if/i.test(a)));
    // green: a target marker that outlines the cell's shape if there is one (a nuclear stain alone hides the morphology)
    const shapes = (m) => ["cytoskeletal", "cytoplasmic", "membrane", "surface"].includes(m.localization);
    V.g = (stainable.find((m) => m.stage === "target" && shapes(m)) || stainable.find((m) => m.stage === "target") || stainable.find((m) => m.stage === "mature") || stainable[0] || {}).name || "";
    V.r = (stainable.find((m) => m.stage === "pluripotent") || {}).name || "";
    const view = h("div", { class: "panel viewer" });
    function frac(m, t) {
      const ss = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
      switch (m.stage) {
        case "pluripotent": return { frac: 0.02 + 0.94 * Math.pow(1 - t, 1.6), side: "high" };
        case "intermediate": return { frac: 0.85 * Math.exp(-Math.pow((t - 0.45) / 0.3, 2)), side: "low" };
        case "mature": return { frac: 0.72 * ss((t - 0.6) / 0.4), side: "low" };
        case "off-target": return { frac: 0.05, side: "high" };
        default: return { frac: 0.9 * ss((t - 0.25) / 0.75), side: "low" };
      }
    }
    function drawViewer() {
      const sg = stages[V.i], t = stages.length > 1 ? V.i / (stages.length - 1) : 1;
      const stains = [];
      [[V.g, GREEN], [V.r, RED]].forEach(([nm, col]) => {
        const m = c.markers.find((x) => x.name === nm);
        if (m) stains.push(Object.assign({ color: col, loc: m.localization }, frac(m, t)));
      });
      view.innerHTML = "";
      add(view, scope({ archetype: sg.archetype, seed: c.id + "|" + V.i, w: 960, h: 630, lazy: false, mode: V.mode, stains,
        tagL: V.mode === "phase" ? "Phase contrast" : "Immunofluorescence", tagR: "Day " + sg.day, alt: c.name + " at day " + sg.day + ", simulated image" }));
      add(view, h("div", { class: "bar" },
        h("div", { class: "pill", role: "group", "aria-label": "Imaging mode" }, [["phase", "Phase"], ["fluor", "Fluorescence"]].map((m) =>
          h("button", { type: "button", class: V.mode === m[0] ? "on" : "", onclick: () => { V.mode = m[0]; drawViewer(); } }, m[1]))),
        V.mode === "fluor" && stainable.length ? h("div", { class: "stainrow" },
          h("i", { class: "sw", style: { background: "rgb(" + GREEN + ")" } }), select("Green channel", [["", "None"]].concat(stainable.map((m) => [m.name, m.name])), V.g, (x) => { V.g = x; drawViewer(); }),
          h("i", { class: "sw", style: { background: "rgb(" + RED + ")" } }), select("Red channel", [["", "None"]].concat(stainable.map((m) => [m.name, m.name])), V.r, (x) => { V.r = x; drawViewer(); }),
          h("i", { class: "sw", style: { background: "rgb(70,110,255)" } }), "Nuclei") : null));
      add(view, h("div", { class: "stages" }, stages.map((x, i) => h("button", { type: "button", class: "stagebtn" + (i === V.i ? " on" : ""), onclick: () => { V.i = i; drawViewer(); } }, h("b", {}, "Day " + x.day), x.label))));
      add(view, h("p", { class: "look" }, sg.look));
      add(view, h("p", { class: "note-ill" }, V.mode === "phase"
        ? "Illustration drawn from the published description, not a photograph. Real images are in the source papers."
        : "Illustration of where each marker sits and how staining is expected to change over time. Not measured data."));
    }
    drawViewer();

    const nk = c.protocols.filter((p) => p.type === "kit").length, np = c.protocols.length - nk;
    const info = h("div", { class: "cell-info" },
      h("div", {}, h("div", { class: "kicker", style: { color: "var(--lin)" } }, LIN_NAME[c.lineage] + " · " + c.group), h("h1", { style: { "margin-top": "8px" } }, c.name),
        (c.aka || []).length ? h("p", { class: "faint", style: { margin: "6px 0 0" } }, "Also called: " + c.aka.join(", ")) : null),
      h("p", { class: "summary" }, c.summary),
      h("div", {}, h("div", { class: "sec-title" }, "Developmental route"),
        h("div", { class: "route" }, (c.route || []).map((r, i, a) => [h("span", { class: "rstep", style: { "--p": a.length > 1 ? i / (a.length - 1) : 1 } }, r), i < a.length - 1 ? h("span", { class: "arrow" }, "→") : null]))),
      h("div", { class: "facts" },
        fact("Time", daysText(c), "to first target cells"), fact("Difficulty", DIFF[c.difficulty] || "—", null, diffDots(c.difficulty)),
        fact("Format", c.culture_format || "—"), fact("Methods", String(c.protocols.length), [np ? np + " published" : "", nk ? plural(nk, "kit") : ""].filter(Boolean).join(" · "))),
      c.maturation_note ? h("div", { class: "callout" }, h("span", { class: "t" }, "Maturation"), c.maturation_note) : null);
    add(v, h("div", { class: "cell-top" }, view, info));

    // tabs
    const tabs = [["protocol", "Protocols", c.protocols.length], ["markers", "Markers and QC", c.markers.length], ["expect", "What to expect", stages.length]];
    if (c.protocols.length > 1) tabs.push(["compare", "Compare methods", null]);
    let tab = store.get("fm-tab", "protocol");
    if (!tabs.some((t) => t[0] === tab)) tab = "protocol";
    if (parts[1]) tab = "protocol";
    const tb = h("div", { class: "tabs", role: "tablist" }), pane = h("div");
    add(v, tb); add(v, pane);
    function showTab(k) {
      tab = k; store.set("fm-tab", k);
      tb.innerHTML = "";
      tabs.forEach((t) => add(tb, h("button", { type: "button", role: "tab", "aria-selected": t[0] === k, class: t[0] === k ? "on" : "", onclick: () => showTab(t[0]) }, t[1], t[2] != null ? h("span", { class: "n" }, t[2]) : null)));
      pane.innerHTML = "";
      ({ protocol: tabProtocol, markers: tabMarkers, expect: tabExpect, compare: tabCompare }[k])(pane, c, parts[1]);
    }
    showTab(tab);
  }
  function fact(l, val, sub, extra) {
    return h("div", { class: "fact" }, h("div", { class: "l" }, l), h("div", { class: "v" }, val), sub ? h("div", { class: "s" }, sub) : null, extra || null);
  }

  // ---- protocols tab
  function tabProtocol(pane, c, wanted) {
    if (!c.protocols.length) return add(pane, h("div", { class: "empty panel" }, "No protocol has been catalogued for this cell type yet."));
    let cur = c.protocols.find((p) => p.id === wanted) || c.protocols.find((p) => p.id === store.get("fm-proto-" + c.id, "")) || c.protocols[0];
    const cards = h("div", { class: "protos" }), detail = h("div");
    add(pane, cards); add(pane, detail);
    function pick(p) {
      cur = p; store.set("fm-proto-" + c.id, p.id);
      history.replaceState(null, "", "#/cell/" + c.id + "/" + encodeURIComponent(p.id));
      cards.innerHTML = "";
      c.protocols.forEach((q) => add(cards, h("button", { type: "button", class: "proto-card" + (q === cur ? " on" : ""), onclick: () => pick(q), "aria-pressed": q === cur },
        h("div", { class: "row" }, h("span", { class: "chip " + (q.type === "kit" ? "kit" : "pub") }, q.type === "kit" ? "Commercial kit" : "Published method"),
          q.duration_days != null && !q.schedule_unverified ? h("span", { class: "chip" }, h("b", {}, q.duration_days + " d")) : null),
        h("div", { class: "nm" }, q.name), h("div", { class: "src" }, srcShort(q)))));
      detail.innerHTML = "";
      add(detail, protocolDetail(c, cur, () => pick(cur)));
    }
    pick(cur);
  }
  function fmtDate(d) { return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); }
  function dayRange(a, b) { return a === b || b == null ? "Day " + a : "Day " + a + " to " + b; }
  function protocolDetail(c, p, rerender) {
    const box = h("div", { class: "panel proto" });
    const so = p.source || {};
    const d0s = store.get("fm-date-" + p.id, "");
    const d0 = d0s ? new Date(d0s + "T12:00:00") : null;
    const dateOf = (day) => (d0 ? new Date(d0.getTime() + day * 864e5) : null);
    const stages = p.stages || [];
    const SU = !!p.schedule_unverified;   // day numbers are placeholders: show no timeline, dates or calendar
    const checks = JSON.parse(store.get("fm-check-" + p.id, "{}") || "{}");
    const check = (key, text) => h("li", {}, h("label", {}, h("input", { type: "checkbox", checked: !!checks[key], onchange: (e) => { checks[key] = e.target.checked; store.set("fm-check-" + p.id, JSON.stringify(checks)); } }), h("span", {}, text)));

    add(box, h("div", { class: "proto-head" },
      h("div", { style: { display: "grid", gap: "6px", "max-width": "720px" } },
        h("h2", {}, p.name),
        p.type === "kit"
          ? h("div", { class: "cite" }, [p.vendor, p.product, p.catalog ? "Cat. no. " + p.catalog : null].filter(Boolean).join(" · "), " ", p.product_url ? h("a", { href: p.product_url, target: "_blank", rel: "noopener" }, "Product page ↗") : null)
          : h("div", { class: "cite" }, [so.authors, so.year ? "(" + so.year + ")" : null, so.title ? so.title.replace(/\.$/, "") + "." : null, so.journal].filter(Boolean).join(" "), " ",
            so.doi ? h("a", { href: "https://doi.org/" + so.doi, target: "_blank", rel: "noopener" }, "doi:" + so.doi + " ↗") : so.url ? h("a", { href: so.url, target: "_blank", rel: "noopener" }, "Source ↗") : null,
            so.pmid ? [" · ", h("a", { href: "https://pubmed.ncbi.nlm.nih.gov/" + so.pmid + "/", target: "_blank", rel: "noopener" }, "PMID " + so.pmid)] : null),
        p.principle ? h("p", { class: "muted", style: { margin: "4px 0 0" } }, p.principle) : null),
      h("div", { class: "actions" },
        SU ? null : h("label", { class: "muted", style: { "font-size": "13px", display: "flex", gap: "8px", "align-items": "center" } }, "Day 0 is",
          h("input", { type: "date", value: d0s, onchange: (e) => { store.set("fm-date-" + p.id, e.target.value); rerender(); } })),
        h("button", { class: "btn primary", type: "button", onclick: () => runDialog(c, p) }, "Start a run"),
        d0 && !SU ? h("button", { class: "btn", type: "button", onclick: () => downloadIcs(c, p, d0) }, "Add to calendar") : null,
        h("button", { class: "btn", type: "button", onclick: () => window.print() }, "Print"))));

    add(box, h("div", { class: "facts" },
      fact("Length", p.duration_days != null ? p.duration_days + " days" : "—", d0 && p.duration_days != null ? "ends " + fmtDate(dateOf(p.duration_days)) : null),
      fact("Format", p.culture_format || c.culture_format || "—"), fact("Stages", String(stages.length)),
      h("div", { class: "fact" }, h("div", { class: "l" }, "Reported efficiency"), h("div", { class: "s", style: { "font-size": "14px", color: "var(--text)", "margin-top": "5px" } }, p.efficiency || "Not stated"))));

    if (SU) add(box, h("div", { class: "callout warn" }, h("span", { class: "t" }, "Schedule not confirmed"), "The day-by-day schedule of this method could not be read, so no timeline or dates are shown and the stage order below is only a sketch. Take timings and doses from the paper."));
    if (p.start_requirements) add(box, h("div", { class: "callout" }, h("span", { class: "t" }, "Before day 0"), p.start_requirements));

    // timeline
    if (stages.length && !SU) {
      const lo = Math.min.apply(null, stages.map((x) => x.day_start)), hi = Math.max.apply(null, stages.map((x) => (x.day_end == null ? x.day_start + 1 : x.day_end)));
      const span = Math.max(1, hi - lo);
      const step = [1, 2, 5, 7, 10, 14, 20, 30, 50, 60].find((x) => span / x <= 12) || 100;
      const ticks = [];
      for (let d = Math.ceil(lo / step) * step; d <= hi; d += step) ticks.push(d);
      const g = h("div", { class: "gantt", style: { "--ticks": span / step } });
      add(g, h("div", { class: "axis" }, h("div", { class: "lbl faint", style: { "font-size": "11px" } }, d0 ? "Date" : "Day"),
        h("div", { class: "track" }, ticks.map((d) => h("span", { class: "tick", style: { left: ((d - lo) / span) * 100 + "%" } }, d0 ? dateOf(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : d)))));
      stages.forEach((x, i) => {
        const e = x.day_end == null ? x.day_start + 1 : x.day_end;
        add(g, h("div", { class: "row" }, h("div", { class: "lbl", title: x.name }, x.name),
          h("div", { class: "track" }, h("div", { class: "bar", title: dayRange(x.day_start, x.day_end), style: { left: ((x.day_start - lo) / span) * 100 + "%", width: Math.max(1.2, ((e - x.day_start) / span) * 100) + "%", "--p": stages.length > 1 ? i / (stages.length - 1) : 1, "animation-delay": i * 60 + "ms" } },
            (x.factors || []).map((f) => f.name).slice(0, 4).join(" · ")))));
      });
      add(box, h("div", {}, h("div", { class: "sec-title" }, "Timeline"), g));
    }

    // steps
    const ms = c.morphology.stages;
    add(box, h("div", {}, h("div", { class: "sec-title" }, "Stage by stage"),
      h("div", { class: "steps" }, stages.map((x, i) => {
        let mi = 0;
        ms.forEach((m, j) => { if (m.day <= x.day_start) mi = j; });
        const m = ms[mi] || {};
        const da = dateOf(x.day_start), db = x.day_end != null ? dateOf(x.day_end) : null;
        return h("div", { class: "step" },
          h("div", { class: "side" },
            SU ? h("div", { class: "days" }, "Stage " + (i + 1)) : h("div", { class: "days" }, dayRange(x.day_start, x.day_end)),
            da && !SU ? h("div", { class: "dates" }, fmtDate(da) + (db && x.day_end !== x.day_start ? " to " + fmtDate(db) : "")) : null,
            scope({ archetype: m.archetype, seed: c.id + "|" + mi, w: 400, h: 275, corners: false, tagL: m.label, alt: "Expected appearance: " + (m.label || "") })),
          h("div", {},
            h("h3", {}, (i + 1) + ". " + x.name),
            x.base_medium ? h("div", { class: "medium" }, h("b", {}, "Medium: "), x.base_medium, x.feeding ? [" · ", h("b", {}, "Feeding: "), x.feeding] : null) : x.feeding ? h("div", { class: "medium" }, h("b", {}, "Feeding: "), x.feeding) : null,
            (x.factors || []).length ? h("table", { class: "tbl" }, h("thead", {}, h("tr", {}, h("th", {}, p.type === "kit" ? "Component" : "Factor"), h("th", {}, "Amount"), h("th", {}, "What it does"))),
              h("tbody", {}, x.factors.map((f) => h("tr", {}, h("td", {}, h("b", {}, f.name)), h("td", { class: "c" }, f.conc || "—"), h("td", { class: "muted" }, f.role || ""))))) : null,
            (x.actions || []).length ? h("ul", { class: "checks" }, x.actions.map((a, j) => check("s" + i + "a" + j, a))) : null,
            x.checkpoint ? h("div", { class: "callout", style: { "margin-top": "12px" } }, h("span", { class: "t" }, "Checkpoint"), x.checkpoint) : null));
      }))));

    const lists = h("div", { class: "two" });
    if ((p.materials || []).length) add(lists, h("div", {}, h("div", { class: "sec-title", style: { display: "flex", "justify-content": "space-between", "align-items": "center" } }, "Shopping list",
      h("button", { class: "btn no-print", type: "button", style: { "font-family": "var(--sans)", "letter-spacing": 0, "text-transform": "none" }, onclick: (e) => copy(p.materials.join("\n"), e.target) }, "Copy")),
      h("ul", { class: "checks shop" }, p.materials.map((m, j) => check("m" + j, m)))));
    const tp = h("div", { style: { display: "grid", gap: "16px", "align-content": "start" } });
    if ((p.tips || []).length) add(tp, h("div", {}, h("div", { class: "sec-title" }, "Tips"), h("ul", { class: "plain" }, p.tips.map((t) => h("li", {}, t)))));
    if ((p.pitfalls || []).length) add(tp, h("div", {}, h("div", { class: "sec-title" }, "Common pitfalls"), h("ul", { class: "plain" }, p.pitfalls.map((t) => h("li", {}, t)))));
    if (tp.children.length) add(lists, tp);
    if (lists.children.length) add(box, lists);
    if ((p.unverified || []).length) add(box, h("div", { class: "callout warn" }, h("span", { class: "t" }, "Check these in the source before you start"), h("ul", { class: "plain" }, p.unverified.map((t) => h("li", {}, t)))));
    return box;
  }
  function copy(text, btn) {
    const done = () => { const o = btn.textContent; btn.textContent = "Copied"; setTimeout(() => { btn.textContent = o; }, 1400); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => {});
    else { const t = h("textarea", {}, text); document.body.appendChild(t); t.select(); try { document.execCommand("copy"); done(); } catch (e) { /* ignore */ } t.remove(); }
  }
  function downloadIcs(c, p, d0) {
    const z = (n) => String(n).padStart(2, "0"), ymd = (d) => d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate());
    const esc = (t) => String(t).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Fate Map//EN"];
    (p.stages || []).forEach((x, i) => {
      const a = new Date(d0.getTime() + x.day_start * 864e5), b = new Date(a.getTime() + 864e5);
      const desc = [x.base_medium ? "Medium: " + x.base_medium : "", (x.factors || []).map((f) => f.name + (f.conc ? " " + f.conc : "")).join(", "), x.feeding || ""].filter(Boolean).join("\n");
      lines.push("BEGIN:VEVENT", "UID:fatemap-" + p.id + "-" + i + "-" + ymd(a) + "@fatemap.local", "DTSTAMP:" + ymd(new Date()) + "T000000Z", "DTSTART;VALUE=DATE:" + ymd(a), "DTEND;VALUE=DATE:" + ymd(b),
        "SUMMARY:" + esc(c.name + ": " + x.name + " (day " + x.day_start + ")"), "DESCRIPTION:" + esc(desc), "END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    const a = h("a", { href: URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/calendar" })), download: c.id + "-" + p.id + ".ics" });
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---- markers tab
  const MSTAGE = [["pluripotent", "Pluripotency (should fall)"], ["intermediate", "Intermediate stages"], ["target", "Target cell"], ["mature", "Maturity"], ["off-target", "Off-target (should stay low)"]];
  function tabMarkers(pane, c) {
    const by = (a) => c.markers.filter((m) => (m.assays || []).some((x) => x.toLowerCase() === a) && (m.stage === "target" || m.stage === "mature")).map((m) => m.name);
    const panels = [["Flow cytometry", by("flow")], ["Immunostaining", by("icc")], ["qPCR", by("qpcr")]].filter((x) => x[1].length);
    if (panels.length) add(pane, h("div", { class: "panels" }, panels.map((x) => h("div", { class: "panel" }, h("div", { class: "sec-title" }, x[0] + " panel"), h("div", { class: "list" }, x[1].join(" · ")),
      h("div", { class: "faint", style: { "font-size": "12.5px", "margin-top": "6px" } }, "Add " + (c.markers.find((m) => m.stage === "pluripotent") || { name: "a pluripotency marker" }).name + " as the negative.")))));
    const wrap = h("div", { class: "mstages" });
    MSTAGE.forEach(([k, label]) => {
      const ms = c.markers.filter((m) => m.stage === k);
      if (!ms.length) return;
      add(wrap, h("div", { class: "mstage" }, h("h3", {}, h("i", { class: "lin-dot", style: k === "pluripotent" || k === "off-target" ? { "--lin": "var(--faint)" } : {} }), label),
        h("div", { class: "mgrid" }, ms.map((m) => h("div", { class: "marker" },
          h("div", { style: { display: "flex", "justify-content": "space-between", gap: "8px", "align-items": "baseline" } }, h("span", { class: "nm" }, m.name), h("span", { class: "faint", style: { "font-size": "12px" } }, m.localization || "")),
          m.alias ? h("div", { class: "al" }, m.alias) : null,
          m.stage_label && k === "intermediate" ? h("div", { class: "al" }, "Marks: " + m.stage_label) : null,
          h("div", { style: { display: "flex", gap: "5px", "flex-wrap": "wrap" } }, (m.assays || []).map((a) => h("span", { class: "assay" }, a))),
          m.note ? h("div", { class: "nt" }, m.note) : null)))));
    });
    add(pane, wrap);
    const extra = h("div", { class: "two", style: { "margin-top": "26px" } });
    if ((c.functional_assays || []).length) add(extra, h("div", {}, h("div", { class: "sec-title" }, "Functional tests"), h("ul", { class: "plain" }, c.functional_assays.map((t) => h("li", {}, t)))));
    if ((c.qc || []).length) add(extra, h("div", {}, h("div", { class: "sec-title" }, "Acceptance checks"), h("ul", { class: "plain" }, c.qc.map((t) => h("li", {}, t)))));
    if (extra.children.length) add(pane, extra);
  }

  // ---- what to expect
  function tabExpect(pane, c) {
    add(pane, h("p", { class: "muted", style: { "max-width": "70ch" } }, c.morphology.endpoint));
    add(pane, h("div", { class: "gal", style: { margin: "16px 0 24px" } }, c.morphology.stages.map((m, i) => h("figure", {},
      scope({ archetype: m.archetype, seed: c.id + "|" + i, w: 520, h: 358, tagL: "Phase contrast", tagR: "Day " + m.day, alt: m.label + ", simulated image" }),
      h("figcaption", {}, h("b", {}, m.label), m.look)))));
    add(pane, h("p", { class: "note-ill" }, "These images are illustrations drawn from the published descriptions, not photographs. Compare your cultures with the figures in the source papers."));
    if (c.notes) add(pane, h("div", { class: "callout", style: { "margin-top": "18px", "max-width": "80ch" } }, h("span", { class: "t" }, "Good to know"), c.notes));
  }

  // ---- compare
  function tabCompare(pane, c) {
    const rows = [
      ["Type", (p) => (p.type === "kit" ? "Commercial kit" : "Published method")], ["Source", srcShort],
      ["Length", (p) => (p.duration_days != null && !p.schedule_unverified ? p.duration_days + " days" : "—")], ["Format", (p) => p.culture_format || "—"],
      ["Efficiency", (p) => p.efficiency || "Not stated"], ["Stages", (p) => String((p.stages || []).length)],
      ["Key factors", (p) => (p.type === "kit" ? "Proprietary media" : Array.from(new Set((p.stages || []).flatMap((x) => (x.factors || []).map((f) => f.name)))).slice(0, 10).join(", ") || "—")],
      ["Principle", (p) => p.principle || "—"]];
    add(pane, h("div", { class: "panel tablewrap cmp" }, h("table", { class: "tbl" },
      h("thead", {}, h("tr", {}, h("th", {}, ""), c.protocols.map((p) => h("th", {}, h("a", { href: "#/cell/" + c.id + "/" + encodeURIComponent(p.id), style: { "font-family": "var(--serif)", "font-size": "15px", "letter-spacing": 0, "text-transform": "none", color: "var(--text)" } }, p.name))))),
      h("tbody", {}, rows.map((r) => h("tr", {}, h("td", {}, r[0]), c.protocols.map((p) => h("td", {}, r[1](p)))))))));
  }

  // ------------------------------------------------------------ kits
  let KV = "all";
  function allKits() {
    const out = [];
    DB.cell_types.forEach((c) => c.protocols.forEach((p) => { if (p.type === "kit") out.push({ p, c }); }));
    (DB.other_kits || []).forEach((p) => out.push({ p, c: null }));
    return out;
  }
  function viewKits(v) {
    v.dataset.title = "Kits";
    const kits = allKits();
    const vendors = Array.from(new Set(kits.map((k) => k.p.vendor || "Other"))).sort();
    add(v, h("div", { class: "page-head" }, h("div", { class: "kicker" }, "Commercial kits"), h("h1", { style: { "font-size": "clamp(26px,3.4vw,40px)" } }, "Differentiation kits and media"),
      h("p", { class: "muted" }, "Kits trade flexibility for convenience: the media are proprietary, the schedule is fixed, and the vendor has tested it across several lines. Catalogue numbers and schedules were read from each vendor's product page; check the current manual before ordering.")));
    const bar = h("div", { class: "toolbar" });
    add(v, bar);
    add(bar, h("button", { class: "fchip" + (KV === "all" ? " on" : ""), onclick: () => { KV = "all"; route(); } }, "All vendors", h("span", { class: "c" }, kits.length)));
    vendors.forEach((x) => add(bar, h("button", { class: "fchip" + (KV === x ? " on" : ""), onclick: () => { KV = x; route(); } }, x, h("span", { class: "c" }, kits.filter((k) => (k.p.vendor || "Other") === x).length))));
    const list = kits.filter((k) => KV === "all" || (k.p.vendor || "Other") === KV).sort((a, b) => (a.p.vendor || "").localeCompare(b.p.vendor || "") || (a.p.product || a.p.name).localeCompare(b.p.product || b.p.name));
    if (!list.length) return add(v, h("div", { class: "empty panel" }, "No kits catalogued yet."));
    add(v, h("div", { class: "panel tablewrap" }, h("table", { class: "tbl" },
      h("thead", {}, h("tr", {}, ["Product", "Vendor", "Cat. no.", "Makes", "Length", "Format"].map((t) => h("th", {}, t)))),
      h("tbody", {}, list.map(({ p, c }) => h("tr", {},
        h("td", {}, c ? h("a", { href: "#/cell/" + c.id + "/" + encodeURIComponent(p.id) }, h("b", {}, p.product || p.name)) : h("b", {}, p.product || p.name), p.product_url ? [" ", h("a", { href: p.product_url, target: "_blank", rel: "noopener", title: "Vendor page", class: "faint" }, "↗")] : null),
        h("td", {}, p.vendor || "—"), h("td", { class: "c" }, p.catalog || "—"),
        h("td", {}, c ? h("a", { href: "#/cell/" + c.id, data: { lin: c.lineage }, style: { display: "inline-flex", gap: "7px", "align-items": "center" } }, h("i", { class: "lin-dot" }), c.name) : (p.makes || "—")),
        h("td", { class: "c" }, p.duration_days != null ? p.duration_days + " d" : "—"), h("td", {}, p.culture_format || "—")))))));
  }

  // ------------------------------------------------------------ reagents
  function reagentIndex() {
    const map = new Map();
    DB.cell_types.forEach((c) => c.protocols.forEach((p) => {
      if (p.type === "kit") return;
      (p.stages || []).forEach((x) => (x.factors || []).forEach((f) => {
        const key = f.name.toLowerCase().replace(/[\s\-]+/g, "");
        if (!map.has(key)) map.set(key, { name: f.name, roles: [], cells: new Map(), protos: new Set() });
        const r = map.get(key);
        if (f.role && r.roles.length < 2 && !r.roles.some((y) => y.toLowerCase() === f.role.toLowerCase())) r.roles.push(f.role);
        r.cells.set(c.id, c); r.protos.add(p.id);
      }));
    }));
    return Array.from(map.values()).sort((a, b) => b.protos.size - a.protos.size || a.name.localeCompare(b.name));
  }
  let RQ = "";
  function viewReagents(v, parts) {
    v.dataset.title = "Reagents";
    if (parts[0]) RQ = parts[0];
    const all = reagentIndex();
    add(v, h("div", { class: "page-head" }, h("div", { class: "kicker" }, "Reagent index"), h("h1", { style: { "font-size": "clamp(26px,3.4vw,40px)" } }, "Growth factors and small molecules"),
      h("p", { class: "muted" }, plural(all.length, "factor") + " used across the published protocols, most used first. Each links to the cell types that need it, which helps when deciding what to keep in the freezer.")));
    const inp = h("input", { class: "filter", type: "search", placeholder: "Filter, e.g. CHIR or BMP4", value: RQ, "aria-label": "Filter reagents" });
    const box = h("div", { class: "panel", style: { "margin-top": "14px" } });
    add(v, inp); add(v, box);
    function render() {
      const q = inp.value.trim().toLowerCase();
      RQ = inp.value;
      box.innerHTML = "";
      const list = all.filter((r) => !q || r.name.toLowerCase().includes(q) || r.roles.join(" ").toLowerCase().includes(q));
      if (!list.length) return add(box, h("div", { class: "empty" }, "No factor matches."));
      list.slice(0, 400).forEach((r) => add(box, h("div", { class: "reagent" },
        h("div", {}, h("div", { class: "nm" }, r.name), h("div", { class: "faint", style: { "font-size": "12.5px" } }, plural(r.protos.size, "protocol"))),
        h("div", {}, h("div", { style: { "font-size": "14px" } }, r.roles.join("; ") || "—"),
          h("div", { class: "uses" }, Array.from(r.cells.values()).slice(0, 14).map((c) => h("a", { href: "#/cell/" + c.id }, c.name)), r.cells.size > 14 ? "and " + (r.cells.size - 14) + " more" : null)))));
    }
    inp.addEventListener("input", render);
    render();
  }

  // ------------------------------------------------------------ sources
  function refList() {
    const seen = new Map();
    DB.cell_types.forEach((c) => c.protocols.forEach((p) => { const so = p.source; if (p.type !== "kit" && so && (so.doi || so.pmid || so.title)) seen.set(so.doi || so.pmid || so.title, so); }));
    return Array.from(seen.values()).sort((a, b) => (a.authors || "").localeCompare(b.authors || "") || (a.year || 0) - (b.year || 0));
  }
  function viewAbout(v) {
    v.dataset.title = "Sources";
    const refs = refList();
    add(v, h("div", { class: "prose" },
      h("div", { class: "kicker" }, "Sources and limits"), h("h1", { style: { "font-size": "clamp(26px,3.4vw,40px)" } }, "Where this comes from"),
      h("p", { class: "muted" }, "Catalogue version " + (DB.built || "") + ". Each published protocol was summarised from the paper or its protocol-journal version, with the citation checked against PubMed. Each kit schedule was read from the vendor's product page or manual. Concentrations and timings are given as that source states them."),
      h("h2", {}, "How to use it safely"),
      h("p", {}, "These are summaries for planning and comparison. They leave out details that matter at the bench: plate coating, cell densities for your line, exact volumes. Read the original paper or the current kit manual before starting, and expect to tune a protocol to your own line."),
      h("p", {}, "Where a value could not be confirmed, the protocol says so in a yellow box rather than guessing."),
      h("h2", {}, "About the images"),
      h("p", {}, "The micrographs are simulations drawn by the app from the published descriptions of each culture. They show the kind of morphology to look for and where a marker sits in the cell. They are not photographs or measured data, and they carry no scale. The staining view shows the expected trend over time, not a result."),
      h("h2", {}, "Papers cited (" + refs.length + ")")));
    add(v, h("div", { class: "panel", style: { padding: "18px 22px", "margin-top": "10px" } }, h("div", { class: "refs" }, refs.map((so) => h("div", {},
      [so.authors, so.year ? "(" + so.year + ")." : null, so.title ? so.title.replace(/\.$/, "") + "." : null].filter(Boolean).join(" "), " ", h("i", {}, so.journal || ""), " ",
      so.doi ? h("a", { href: "https://doi.org/" + so.doi, target: "_blank", rel: "noopener" }, "doi:" + so.doi) : null,
      so.pmid ? [" · ", h("a", { href: "https://pubmed.ncbi.nlm.nih.gov/" + so.pmid + "/", target: "_blank", rel: "noopener" }, "PMID " + so.pmid)] : null)))));
  }

  // ============================================================ notebook: runs, notes, reagent calculator
  let NB = { version: 1, runs: [], stocks: {} };
  let saveTimer = 0;
  const toast = h("div", { id: "toast", role: "status", "aria-live": "polite" });
  document.body.appendChild(toast);
  function flash(msg, bad) {
    toast.textContent = msg; toast.className = "show" + (bad ? " bad" : "");
    clearTimeout(flash.t); flash.t = setTimeout(() => { toast.className = ""; }, bad ? 5000 : 1300);
  }
  function saveNB() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      fetch("/api/store", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(NB) })
        .then((r) => r.json()).then((d) => { if (d.error) throw new Error(d.error); flash("Saved"); })
        .catch((e) => flash("Could not save your notebook: " + e.message, true));
    }, 250);
  }
  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  const parseDate = (s) => new Date(s + "T12:00:00");
  const addDaysTo = (s, n) => new Date(parseDate(s).getTime() + n * 864e5);
  function dayOf(run) { const a = parseDate(run.start), b = new Date(); b.setHours(12, 0, 0, 0); return Math.round((b - a) / 864e5); }
  const shortDate = (d) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const runCell = (run) => cellById(run.cell_id);
  const runProto = (run) => { const c = runCell(run); return c ? c.protocols.find((x) => x.id === run.protocol_id) : null; };
  const newId = () => "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function field(label, input, hint) {
    return h("label", { class: "fld" }, h("span", { class: "fl" }, label), input, hint ? h("span", { class: "fh" }, hint) : null);
  }
  function runDialog(c, p, existing) {
    const dlg = h("dialog", { class: "dlg" });
    const closeDlg = () => { if (dlg.open) dlg.close(); dlg.remove(); };
    const run = existing || {};
    const name = h("input", { type: "text", required: true, value: run.name || c.name + " · " + new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" }) });
    const line = h("input", { type: "text", placeholder: "e.g. WTC-11, H9", value: run.line || "" });
    const passage = h("input", { type: "text", placeholder: "e.g. P32", value: run.passage || "" });
    const start = h("input", { type: "date", required: true, value: run.start || isoDate(new Date()) });
    const vessel = h("select", { class: "sel" }, window.Calc.VESSELS.map((v) => h("option", { value: v.id, selected: (run.vessel || "6") === v.id }, v.label)));
    const count = h("input", { type: "number", min: 1, step: 1, value: run.count || 6 });
    const su = p.schedule_unverified;
    const form = h("form", { method: "dialog", onsubmit: (e) => {
      e.preventDefault();
      if (existing) { Object.assign(run, { name: name.value.trim() || run.name, line: line.value.trim(), passage: passage.value.trim(), start: start.value, vessel: vessel.value, count: Math.max(1, +count.value || 1) }); saveNB(); closeDlg(); route(); return; }
      const r = { id: newId(), cell_id: c.id, protocol_id: p.id, name: name.value.trim() || c.name, line: line.value.trim(), passage: passage.value.trim(), start: start.value,
        vessel: vessel.value, count: Math.max(1, +count.value || 1), overage: 10, intervals: {}, notes: [], checks: {}, status: "active", created: new Date().toISOString() };
      NB.runs.unshift(r); saveNB(); closeDlg(); location.hash = "#/run/" + r.id;
    } },
      h("h2", {}, existing ? "Run details" : "Start a run"),
      h("p", { class: "muted", style: { margin: "0 0 12px" } }, c.name + " · " + p.name),
      su ? h("div", { class: "callout warn", style: { "margin-bottom": "12px" } }, "This method's schedule is not confirmed, so the app can't work out what to do each day. You can still keep notes against it.") : null,
      field("Name of this run", name), h("div", { class: "fld2" }, field("Cell line", line), field("Passage", passage)),
      field("Day 0 is", start, "The first day of the protocol, when you add the first induction medium or plate for it."),
      h("div", { class: "fld2" }, field("Culture vessel", vessel), field("How many", count)),
      h("div", { class: "dlg-actions" }, h("button", { type: "button", class: "btn", onclick: closeDlg }, "Cancel"), h("button", { type: "submit", class: "btn primary" }, existing ? "Save" : "Start run")));
    dlg.appendChild(form);
    dlg.addEventListener("close", () => dlg.remove());
    document.body.appendChild(dlg);
    dlg.showModal();
    name.focus(); name.select();
  }

  // ---- my runs
  function runStatus(run) {
    const p = runProto(run), d = dayOf(run);
    if (run.status === "finished") return "Finished";
    if (!p) return "Protocol no longer in the catalogue";
    const T = p.schedule_unverified ? null : p.duration_days;
    if (d < 0) return "Starts " + shortDate(parseDate(run.start)) + " (in " + plural(-d, "day") + ")";
    if (T != null && d > T) return "Past the end of the protocol (day " + d + ")";
    return "Day " + d + (T != null ? " of " + T : "");
  }
  function viewRuns(v) {
    v.dataset.title = "My runs";
    add(v, h("div", { class: "page-head" }, h("div", { class: "kicker" }, "Notebook"), h("h1", { style: { "font-size": "clamp(26px,3.4vw,40px)" } }, "My runs"),
      h("p", { class: "muted" }, "Start a run from any protocol. The app then tells you what to do each day, keeps your notes and works out how much medium and factor to prepare. Everything is saved on this computer only.")));
    if (!NB.runs.length) return add(v, h("div", { class: "panel empty" }, h("p", {}, "No runs yet."), h("p", { class: "muted" }, "Open a cell type, choose a protocol and press ", h("b", {}, "Start a run"), "."), h("a", { class: "btn primary", href: "#/fates" }, "Choose a cell type")));
    const list = NB.runs.slice().sort((a, b) => (a.status === "finished") - (b.status === "finished") || (a.start < b.start ? 1 : -1));
    add(v, h("div", { class: "grid runs" }, list.map((run) => {
      const c = runCell(run), p = runProto(run), es = c ? endStage(c) : { archetype: "monolayer_dense" };
      return h("a", { class: "panel card", href: "#/run/" + run.id, data: { lin: c ? c.lineage : "" } },
        scope({ archetype: es.archetype, seed: run.cell_id, w: 480, h: 200, corners: false, beat: false, alt: "" }),
        h("div", { class: "body" }, h("div", { class: "name" }, h("i", { class: "lin-dot" }), run.name),
          h("div", { class: "aka" }, [c ? c.name : run.cell_id, p ? srcShort(p) : "", run.line, run.passage].filter(Boolean).join(" · ")),
          h("div", { class: "meta" }, h("span", { class: "chip" + (run.status === "finished" ? "" : " pub") }, h("b", {}, runStatus(run))), h("span", { class: "chip" }, plural(run.notes.length, "note")))));
    })));
  }

  // ---- one run
  let RT = store.get("fm-runtab", "today");
  function viewRun(v, parts) {
    const run = NB.runs.find((r) => r.id === parts[0]);
    add(v, h("div", { class: "crumbs" }, h("a", { href: "#/runs" }, "My runs"), h("span", {}, "›"), h("span", {}, run ? run.name : "Not found")));
    if (!run) return add(v, h("div", { class: "panel empty" }, "That run is not in this notebook. ", h("a", { href: "#/runs" }, "Back to my runs")));
    v.dataset.title = run.name;
    const c = runCell(run), p = runProto(run);
    if (!c || !p) {
      add(v, h("div", { class: "panel empty" }, h("p", {}, "The protocol this run used is no longer in the catalogue, so only your notes can be shown."), h("button", { class: "btn", onclick: () => deleteRun(run) }, "Delete run")));
      return;
    }
    v.dataset.lin = c.lineage;
    const SU = !!p.schedule_unverified;
    const day = dayOf(run);
    const head = h("div", { class: "run-head" },
      h("div", {}, h("div", { class: "kicker", style: { color: "var(--lin)" } }, LIN_NAME[c.lineage] + " · " + c.group), h("h1", { style: { "font-size": "clamp(26px,3.4vw,40px)", "margin-top": "6px" } }, run.name),
        h("p", { class: "muted", style: { margin: "6px 0 0" } }, h("a", { href: "#/cell/" + c.id }, c.name), " · ", h("a", { href: "#/cell/" + c.id + "/" + encodeURIComponent(p.id) }, p.name),
          run.line || run.passage ? " · " + [run.line, run.passage].filter(Boolean).join(" ") : "", " · day 0 = " + shortDate(parseDate(run.start)))),
      h("div", { class: "run-side" }, h("span", { class: "chip " + (run.status === "finished" ? "" : "pub"), style: { "font-size": "14px", padding: "6px 14px" } }, h("b", {}, runStatus(run))),
        h("div", { class: "actions" },
          h("button", { class: "btn", type: "button", onclick: () => runDialog(c, p, run) }, "Details"),
          h("button", { class: "btn", type: "button", onclick: () => { run.status = run.status === "finished" ? "active" : "finished"; saveNB(); route(); } }, run.status === "finished" ? "Reopen" : "Mark finished"),
          h("button", { class: "btn", type: "button", onclick: () => deleteRun(run) }, "Delete"))));
    add(v, head);
    const tabs = [["today", "Today"], ["notes", "Notebook (" + run.notes.length + ")"], ["calc", "Reagent calculator"]];
    if (!tabs.some((t) => t[0] === RT)) RT = "today";
    const tb = h("div", { class: "tabs", role: "tablist" }), pane = h("div");
    add(v, tb); add(v, pane);
    const show = (k) => {
      RT = k; store.set("fm-runtab", k); tb.innerHTML = ""; pane.innerHTML = "";
      tabs.forEach((t) => add(tb, h("button", { type: "button", role: "tab", "aria-selected": t[0] === k, class: t[0] === k ? "on" : "", onclick: () => show(t[0]) }, t[1])));
      ({ today: runToday, notes: runNotes, calc: runCalc }[k])(pane, run, c, p, day, SU, show);
    };
    show(RT);
  }
  function deleteRun(run) {
    if (!window.confirm("Delete “" + run.name + "” and its " + plural(run.notes.length, "note") + "? This cannot be undone.")) return;
    NB.runs = NB.runs.filter((r) => r !== run); saveNB(); location.hash = "#/runs";
  }
  const planOf = (run, p) => window.Calc.plan(p, run, NB.stocks);

  function runToday(pane, run, c, p, day, SU, show) {
    const check = (key, text) => h("li", {}, h("label", {}, h("input", { type: "checkbox", checked: !!run.checks[key], onchange: (e) => { run.checks[key] = e.target.checked; saveNB(); } }), h("span", {}, text)));
    if (SU) {
      return add(pane, h("div", { class: "callout warn" }, h("span", { class: "t" }, "Schedule not confirmed"), "This method's day-by-day schedule could not be read, so the app can't say what to do today. Use the notebook to log your run, and take timings from ", p.source && p.source.doi ? h("a", { href: "https://doi.org/" + p.source.doi, target: "_blank", rel: "noopener" }, "the paper") : "the source", "."));
    }
    const pl = planOf(run, p), st = p.stages, T = p.duration_days;
    const next = pl.feeds.filter((f) => f.day > day).slice(0, 4);
    if (day < (st[0] ? st[0].day_start : 0)) {
      add(pane, h("div", { class: "callout" }, h("span", { class: "t" }, "Not started yet"), "Day 0 is " + shortDate(parseDate(run.start)) + ", " + plural(-day, "day") + " from now." + (st[0] && st[0].day_start < 0 ? " The first step is on day " + st[0].day_start + " (" + shortDate(addDaysTo(run.start, st[0].day_start)) + ")." : "")));
      if (p.start_requirements) add(pane, h("div", { class: "callout", style: { "margin-top": "12px" } }, h("span", { class: "t" }, "Before day 0"), p.start_requirements));
      if ((p.materials || []).length) add(pane, h("div", { style: { "margin-top": "20px" } }, h("div", { class: "sec-title" }, "Get ready"), h("ul", { class: "checks shop" }, p.materials.map((m, j) => check("m" + j, m)))));
      add(pane, h("p", { style: { "margin-top": "14px" } }, h("button", { class: "btn", type: "button", onclick: () => show("calc") }, "Work out what to prepare →")));
      return;
    }
    let idx = -1;
    st.forEach((s, i) => { if (s.day_start <= day) idx = i; });
    const done = T != null && day > T;
    if (done && run.status !== "finished") add(pane, h("div", { class: "callout", style: { "margin-bottom": "14px" } }, h("span", { class: "t" }, "Past the planned end"), "The protocol is " + T + " days long and this is day " + day + ". If the cells are ready, mark the run finished and record your results in the notebook."));
    const s = st[Math.max(0, idx)], sg = pl.stages[Math.max(0, idx)];
    const feedToday = pl.feeds.find((f) => Math.abs(f.day - day) < 0.5);
    const ms = c.morphology.stages; let mi = 0; ms.forEach((m, j) => { if (m.day <= day) mi = j; });
    const m = ms[mi] || {};
    const left = h("div", { class: "today-main" });
    add(left, h("div", { class: "today-day" }, h("span", { class: "big" }, "Day " + day), h("span", { class: "muted" }, shortDate(new Date()))));
    add(left, h("h2", { style: { margin: "8px 0 4px" } }, (idx + 1) + ". " + s.name), h("div", { class: "faint", style: { "font-size": "13px", "margin-bottom": "10px" } }, "Stage runs day " + s.day_start + (s.day_end != null && s.day_end !== s.day_start ? " to " + s.day_end : "")));
    add(left, feedToday
      ? h("div", { class: "callout" }, h("span", { class: "t" }, "Medium change today"), "Make up ", h("b", {}, window.Calc.fmtMl(feedToday.mlTotal)), " of " + (feedToday.medium || "medium") + (factorLine(feedToday) ? ", adding " + factorLine(feedToday) : "") + ".")
      : h("div", { class: "callout" }, h("span", { class: "t" }, "No medium change today"), next[0] ? "Next change: day " + next[0].day + ", " + shortDate(addDaysTo(run.start, next[0].day)) + "." : "This is the last step."));
    if (s.base_medium) add(left, h("p", { style: { margin: "12px 0 6px" } }, h("b", {}, "Medium: "), s.base_medium, s.feeding ? [" · ", h("b", {}, "Feeding: "), s.feeding] : null));
    if (sg.factors.length) add(left, h("table", { class: "tbl" }, h("thead", {}, h("tr", {}, h("th", {}, p.type === "kit" ? "Component" : "Factor"), h("th", {}, "Final"), h("th", {}, "Add per change"))),
      h("tbody", {}, sg.factors.map((f) => h("tr", {}, h("td", {}, h("b", {}, f.name)), h("td", { class: "c" }, f.concText || "—"),
        h("td", { class: "c" }, f.ulPerFeed != null ? window.Calc.fmtUl(f.ulPerFeed) + " of " + f.stock.text : f.conc ? h("a", { href: "#", onclick: (e) => { e.preventDefault(); show("calc"); } }, "enter stock") : "see manual"))))));
    if ((s.actions || []).length) add(left, h("ul", { class: "checks", style: { "margin-top": "12px" } }, s.actions.map((a, j) => check("s" + idx + "a" + j, a))));
    if (s.checkpoint) add(left, h("div", { class: "callout", style: { "margin-top": "12px" } }, h("span", { class: "t" }, "Checkpoint"), s.checkpoint));
    const right = h("div", { class: "today-side panel" });
    add(right, scope({ archetype: m.archetype, seed: c.id + "|" + mi, w: 640, h: 420, lazy: false, tagL: m.label, tagR: "Expected", alt: "Expected appearance today" }));
    add(right, h("p", { class: "look" }, m.look));
    const t = T ? day / T : 0;
    const want = t < 0.55 ? ["pluripotent", "intermediate"] : ["target", "mature"];
    const mk = c.markers.filter((x) => want.includes(x.stage)).slice(0, 8);
    if (mk.length) add(right, h("div", {}, h("div", { class: "sec-title" }, t < 0.55 ? "Worth checking now: pluripotency should be falling" : "Worth checking now: target cell markers"),
      h("div", { class: "chips" }, mk.map((x) => h("span", { class: "chip", title: (x.alias || "") + (x.note ? " — " + x.note : "") }, h("b", {}, x.name), x.localization ? " " + x.localization : "")))));
    add(right, h("a", { class: "btn", href: "#/cell/" + c.id + "/" + encodeURIComponent(p.id) }, "Open the full protocol →"));
    add(pane, h("div", { class: "today-grid" }, left, right));
    if (next.length) add(pane, h("div", { style: { "margin-top": "26px" } }, h("div", { class: "sec-title" }, "Coming up"),
      h("div", { class: "upcoming" }, next.map((f) => h("div", { class: "panel up" }, h("div", { class: "days" }, "Day " + f.day), h("div", { class: "dates" }, shortDate(addDaysTo(run.start, f.day))), h("div", {}, f.stage), h("div", { class: "faint", style: { "font-size": "12.5px" } }, window.Calc.fmtMl(f.mlTotal) + " of " + (f.medium || "medium")))))));
    // timeline with a marker for today
    const lo = Math.min.apply(null, st.map((x) => x.day_start)), hi = Math.max.apply(null, st.map((x) => (x.day_end == null ? x.day_start + 1 : x.day_end))), span = Math.max(1, hi - lo);
    const g = h("div", { class: "gantt", style: { "--ticks": 10 } });
    st.forEach((x, i) => {
      const e = x.day_end == null ? x.day_start + 1 : x.day_end;
      add(g, h("div", { class: "row" }, h("div", { class: "lbl" + (i === idx ? " now" : ""), title: x.name }, x.name),
        h("div", { class: "track" }, h("div", { class: "bar", style: { left: ((x.day_start - lo) / span) * 100 + "%", width: Math.max(1.2, ((e - x.day_start) / span) * 100) + "%", "--p": st.length > 1 ? i / (st.length - 1) : 1, opacity: i === idx ? 1 : 0.55 } }),
          day >= lo && day <= hi ? h("i", { class: "todayline", style: { left: ((day - lo) / span) * 100 + "%" } }) : null)));
    });
    add(pane, h("div", { style: { "margin-top": "26px" } }, h("div", { class: "sec-title" }, "Where you are"), g));
  }

  function runNotes(pane, run, c, p, day) {
    const kinds = ["Observation", "Result", "Problem", "Change", "Reminder"];
    const dayIn = h("input", { type: "number", step: "0.5", value: Math.max(-14, Math.min(day, 400)), style: { width: "90px" }, "aria-label": "Day" });
    const kind = h("select", { class: "sel", "aria-label": "Kind" }, kinds.map((k) => h("option", { value: k }, k)));
    const text = h("textarea", { rows: 3, placeholder: "What did you see or do? For example: day 6 cells ~90% confluent, edges lifting; TNNT2 flow 84%; changed CHIR to 8 µM", "aria-label": "Note" });
    const addNote = () => {
      const t = text.value.trim(); if (!t) { text.focus(); return; }
      run.notes.push({ id: newId(), day: +dayIn.value || 0, kind: kind.value, text: t, at: new Date().toISOString() });
      saveNB(); route();
    };
    add(pane, h("div", { class: "panel noteform" }, h("div", { class: "nf-row" }, h("label", { class: "fl" }, "Day"), dayIn, kind, h("span", { class: "faint" }, shortDate(addDaysTo(run.start, +dayIn.value || 0))), h("span", { class: "grow" }),
      h("button", { class: "btn primary", type: "button", onclick: addNote }, "Add note")), text));
    text.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") addNote(); });
    const notes = run.notes.slice().sort((a, b) => b.day - a.day || (a.at < b.at ? 1 : -1));
    if (!notes.length) add(pane, h("p", { class: "muted", style: { margin: "16px 4px" } }, "No notes yet. Record what you see each day, your flow or staining results, and anything you changed. They are saved on this computer."));
    add(pane, h("div", { class: "notes" }, notes.map((n) => h("div", { class: "note", data: { kind: n.kind } },
      h("div", { class: "nd" }, h("b", {}, "Day " + n.day), h("span", { class: "faint" }, shortDate(addDaysTo(run.start, n.day)))),
      h("div", { class: "nb" }, h("span", { class: "chip k-" + n.kind.toLowerCase() }, n.kind), h("p", {}, n.text)),
      h("button", { class: "x", type: "button", title: "Delete note", "aria-label": "Delete note", onclick: () => { run.notes = run.notes.filter((x) => x !== n); saveNB(); route(); } }, "×")))));
    if (notes.length) add(pane, h("p", { style: { "margin-top": "18px" } }, h("button", { class: "btn", type: "button", onclick: () => exportNotes(run, c, p) }, "Export notes (Markdown)")));
  }
  function download(name, type, body) {
    const a = h("a", { href: URL.createObjectURL(new Blob([body], { type })), download: name });
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function exportNotes(run, c, p) {
    const L = ["# " + run.name, "", c.name + " · " + p.name + (run.line ? " · " + run.line : "") + (run.passage ? " " + run.passage : ""), "Day 0: " + run.start, ""];
    run.notes.slice().sort((a, b) => a.day - b.day || (a.at < b.at ? -1 : 1)).forEach((n) => L.push("- **Day " + n.day + "** (" + isoDate(addDaysTo(run.start, n.day)) + ") — " + n.kind + ": " + n.text.replace(/\n/g, "\n  ")));
    download(run.name.replace(/[^\w.-]+/g, "_") + ".md", "text/markdown", L.join("\n") + "\n");
  }

  function runCalc(pane, run, c, p, day, SU) {
    if (SU) return add(pane, h("div", { class: "callout warn" }, h("span", { class: "t" }, "Schedule not confirmed"), "Without a confirmed schedule there is nothing reliable to calculate."));
    const C = window.Calc, pl = planOf(run, p), redo = () => { pane.innerHTML = ""; runCalc(pane, run, c, p, day, SU); };
    add(pane, h("div", { class: "callout", style: { "margin-bottom": "16px" } }, h("span", { class: "t" }, "How this is worked out"),
      "Medium per change = the working volume for your vessel × how many × (1 + spare). The volumes per vessel are common working volumes, not taken from the papers, so check them against your coating and feeding practice. A factor amount appears only where the protocol states a concentration and you have entered your stock; it is a plain dilution (final ÷ stock × volume)."));
    const vessel = h("select", { class: "sel", "aria-label": "Vessel", onchange: (e) => { run.vessel = e.target.value; saveNB(); redo(); } }, C.VESSELS.map((v) => h("option", { value: v.id, selected: v.id === pl.vessel.id }, v.label + " · " + v.ml + " mL")));
    const count = h("input", { type: "number", min: 1, step: 1, value: pl.count, style: { width: "80px" }, "aria-label": "Number of vessels", onchange: (e) => { run.count = Math.max(1, +e.target.value || 1); saveNB(); redo(); } });
    const over = h("input", { type: "number", min: 0, max: 100, step: 5, value: run.overage == null ? 10 : run.overage, style: { width: "70px" }, "aria-label": "Spare percent", onchange: (e) => { run.overage = Math.max(0, Math.min(100, +e.target.value || 0)); saveNB(); redo(); } });
    add(pane, h("div", { class: "panel calc-controls" }, field("Vessel", vessel), field("How many", count), field("Spare (%)", over), h("div", { class: "perfeed" }, h("span", { class: "l" }, "Medium per change"), h("b", {}, C.fmtMl(pl.perFeedMl)))));

    // stage by stage
    pl.stages.forEach((sg) => {
      const interval = h("input", { type: "number", min: 0, step: "0.5", value: sg.interval, style: { width: "70px" }, "aria-label": "Days between medium changes",
        onchange: (e) => { run.intervals[sg.i] = e.target.value === "" ? "" : +e.target.value; saveNB(); redo(); } });
      add(pane, h("div", { class: "panel calc-stage" },
        h("div", { class: "cs-head" }, h("h3", {}, (sg.i + 1) + ". " + sg.st.name), h("span", { class: "faint" }, "day " + sg.st.day_start + (sg.st.day_end != null && sg.st.day_end !== sg.st.day_start ? " to " + sg.st.day_end : "")),
          h("span", { class: "grow" }), h("label", { class: "faint", style: { display: "flex", gap: "8px", "align-items": "center", "font-size": "13px" } }, "Change medium every", interval, "days (0 = once)",
            sg.assumed ? h("span", { class: "chip kit", title: "The protocol text did not say how often. Edit if you know." }, "assumed") : null)),
        h("div", { class: "faint", style: { "font-size": "13px", margin: "2px 0 8px" } }, (sg.st.base_medium || "Medium as in the protocol") + " · " + plural(sg.days.length, "change") + " · " + C.fmtMl(sg.mediumTotalMl) + " in total"),
        sg.factors.length ? h("table", { class: "tbl" }, h("thead", {}, h("tr", {}, ["Factor", "Final", "Your stock", "Per change", "This stage"].map((t) => h("th", {}, t)))),
          h("tbody", {}, sg.factors.map((f) => {
            const key = String(f.name).toLowerCase();
            const inp = h("input", { type: "text", class: "stockin", placeholder: f.conc ? (f.conc.family === "molar" ? "e.g. 10 mM" : f.conc.family === "mass" ? "e.g. 100 µg/mL" : "e.g. 100X") : "—", value: NB.stocks[key] || "", disabled: !f.conc, "aria-label": "Stock of " + f.name,
              onchange: (e) => { const v = e.target.value.trim(); if (v) NB.stocks[key] = v; else delete NB.stocks[key]; saveNB(); redo(); } });
            const bad = f.conc && NB.stocks[key] && !f.stock ? "unreadable" : f.conc && f.stock && f.ulPerFeed == null ? "units differ" : null;
            return h("tr", {}, h("td", {}, h("b", {}, f.name), f.role ? h("div", { class: "faint", style: { "font-size": "12px" } }, f.role) : null), h("td", { class: "c" }, f.concText || "—"), h("td", {}, inp, bad ? h("div", { class: "faint", style: { color: "var(--warn)", "font-size": "12px" } }, bad) : null),
              h("td", { class: "c" }, f.ulPerFeed != null ? C.fmtUl(f.ulPerFeed) : "—"), h("td", { class: "c" }, f.ulPerFeed != null ? C.fmtUl(f.ulPerFeed * sg.days.length) : "—"));
          }))) : h("p", { class: "faint", style: { margin: 0 } }, "No factors listed for this stage.")));
    });

    // totals and prep calendar
    const med = Object.entries(pl.totals.media), facs = Object.values(pl.totals.factors);
    add(pane, h("div", { class: "two", style: { "margin-top": "26px" } },
      h("div", {}, h("div", { class: "sec-title" }, "Totals for the whole run"),
        h("table", { class: "tbl" }, h("thead", {}, h("tr", {}, h("th", {}, "Medium"), h("th", {}, "Volume"))), h("tbody", {}, med.map(([n, ml]) => h("tr", {}, h("td", {}, n), h("td", { class: "c" }, C.fmtMl(ml)))))),
        facs.length ? h("table", { class: "tbl", style: { "margin-top": "14px" } }, h("thead", {}, h("tr", {}, h("th", {}, "Factor"), h("th", {}, "Stock needed"))),
          h("tbody", {}, facs.map((f) => h("tr", {}, h("td", {}, f.name), h("td", { class: "c" }, !f.anyConc ? "see manual" : f.known && f.ul > 0 ? C.fmtUl(f.ul) + " of " + f.stockText : "enter stock above"))))) : null),
      h("div", {}, h("div", { class: "sec-title", style: { display: "flex", "justify-content": "space-between", "align-items": "center" } }, "Prep calendar",
        h("span", { class: "no-print", style: { display: "flex", gap: "6px" } },
          h("button", { class: "btn", type: "button", onclick: (e) => copy(prepText(run, c, p, pl), e.target) }, "Copy"), h("button", { class: "btn", type: "button", onclick: () => icsPrep(run, c, p, pl) }, "Calendar"), h("button", { class: "btn", type: "button", onclick: () => window.print() }, "Print"))),
        h("div", { class: "prep" }, pl.feeds.map((f) => h("div", { class: "prep-row" + (f.day === day ? " today" : "") },
          h("div", { class: "pd" }, h("b", {}, "Day " + f.day), h("span", { class: "faint" }, shortDate(addDaysTo(run.start, f.day)))),
          h("div", {}, h("div", {}, C.fmtMl(f.mlTotal) + " " + (f.medium || "")), h("div", { class: "faint", style: { "font-size": "12.5px" } }, f.stage + (factorLine(f) ? " · " + factorLine(f) : "")))))))));
  }
  function factorLine(f) {
    return f.factors.map((x) => x.name + (x.ulPerFeed != null ? " " + window.Calc.fmtUl(x.ulPerFeed) : x.concText ? " " + x.concText : "")).join(", ");
  }
  function prepText(run, c, p, pl) {
    const L = [run.name + " — " + c.name + " (" + p.name + ")", pl.count + " × " + pl.vessel.label + ", " + window.Calc.fmtMl(pl.perFeedMl) + " per change", ""];
    pl.feeds.forEach((f) => L.push("Day " + f.day + " (" + shortDate(addDaysTo(run.start, f.day)) + "): " + window.Calc.fmtMl(f.mlTotal) + " " + (f.medium || "") + " — " + f.stage + (factorLine(f) ? " — " + factorLine(f) : "")));
    return L.join("\n");
  }
  function icsPrep(run, c, p, pl) {
    const z = pad2, ymd = (d) => d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate());
    const esc = (t) => String(t).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
    const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Fate Map//EN"];
    pl.feeds.forEach((f, i) => {
      const a = addDaysTo(run.start, Math.floor(f.day)), b = new Date(a.getTime() + 864e5);
      L.push("BEGIN:VEVENT", "UID:fatemap-" + run.id + "-" + i + "@fatemap.local", "DTSTAMP:" + ymd(new Date()) + "T000000Z", "DTSTART;VALUE=DATE:" + ymd(a), "DTEND;VALUE=DATE:" + ymd(b),
        "SUMMARY:" + esc(run.name + ": medium change (day " + f.day + ")"), "DESCRIPTION:" + esc(window.Calc.fmtMl(f.mlTotal) + " " + (f.medium || "") + "\n" + f.stage + "\n" + factorLine(f)), "END:VEVENT");
    });
    L.push("END:VCALENDAR");
    download(run.name.replace(/[^\w.-]+/g, "_") + "-prep.ics", "text/calendar", L.join("\r\n"));
  }

  // ------------------------------------------------------------ search
  let INDEX = null;
  function buildIndex() {
    INDEX = [];
    const startName = (c) => (DB.starts.find((x) => x.pool === c.start) || {}).short || "";
    DB.cell_types.forEach((c) => {
      INDEX.push({ tag: "Cell", text: c.name, sub: startName(c) + " · " + LIN_NAME[c.lineage], keys: [c.name].concat(c.aka || []).join(" ").toLowerCase(), href: "#/cell/" + c.id, w: 3 });
      c.markers.forEach((m) => INDEX.push({ tag: "Marker", text: m.name, sub: c.name + (m.alias ? " · " + m.alias : ""), keys: (m.name + " " + (m.alias || "")).toLowerCase(), href: "#/cell/" + c.id, w: 2, tab: "markers" }));
      c.protocols.forEach((p) => INDEX.push({ tag: p.type === "kit" ? "Kit" : "Method", text: p.type === "kit" ? p.product || p.name : p.name, sub: c.name + " · " + srcShort(p), keys: [p.name, p.product, p.vendor, p.catalog, (p.source || {}).authors].filter(Boolean).join(" ").toLowerCase(), href: "#/cell/" + c.id + "/" + encodeURIComponent(p.id), w: 1 }));
    });
    reagentIndex().forEach((r) => INDEX.push({ tag: "Reagent", text: r.name, sub: plural(r.protos.size, "protocol"), keys: r.name.toLowerCase(), href: "#/reagents/" + encodeURIComponent(r.name), w: 1.5 }));
  }
  const q = $("#q"), qres = $("#qres");
  let qsel = -1;
  function runSearch() {
    const t = q.value.trim().toLowerCase();
    if (!t || !DB) { qres.hidden = true; return; }
    if (!INDEX) buildIndex();
    const hits = INDEX.map((x) => { const i = x.keys.indexOf(t); return i < 0 ? null : { x, score: x.w * 10 - (i === 0 ? 0 : 3) - (x.text.toLowerCase() === t ? -8 : 0) - x.keys.length / 200 }; }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 9);
    qres.innerHTML = ""; qsel = -1;
    if (!hits.length) add(qres, h("div", { class: "none" }, "Nothing found for “" + q.value.trim() + "”."));
    hits.forEach(({ x }) => add(qres, h("a", { href: x.href, onclick: () => { if (x.tab) store.set("fm-tab", x.tab); qres.hidden = true; q.value = ""; if (location.hash === x.href) route(); } }, h("span", { class: "tag" }, x.tag), h("span", {}, h("b", {}, x.text), " ", h("span", { class: "sub" }, x.sub)))));
    qres.hidden = false;
  }
  q.addEventListener("input", runSearch);
  q.addEventListener("focus", runSearch);
  q.addEventListener("keydown", (e) => {
    const items = $$("a", qres);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); qsel = (qsel + (e.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(1, items.length); items.forEach((a, i) => a.classList.toggle("sel", i === qsel)); }
    else if (e.key === "Enter" && items.length) { (items[Math.max(0, qsel)]).click(); q.blur(); }
    else if (e.key === "Escape") { qres.hidden = true; q.blur(); }
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".search")) qres.hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); q.focus(); } });

  // ------------------------------------------------------------ boot
  fetch("/api/store").then((r) => r.json()).then((d) => { if (d && Array.isArray(d.runs)) NB = d; }).catch(() => flash("Could not read your notebook", true))
    .then(() => fetch("/api/catalog")).then((r) => r.json()).then((d) => {
    if (d.error) throw new Error(d.error);
    d.cell_types.forEach((c) => {
      c.protocols = c.protocols || []; c.markers = c.markers || []; c.morphology = c.morphology || {}; c.morphology.stages = c.morphology.stages || [];
      if (!c.morphology.stages.length) c.morphology.stages.push({ day: 0, label: c.name, archetype: "monolayer_dense", look: "" });
    });
    DB = d;
    if (!DB.starts.some((x) => x.id === START)) START = "";
    $("#ver").textContent = d.app_version || "";
    route();
  }).catch((e) => {
    app.innerHTML = "";
    add(app, h("div", { class: "empty panel" }, "The protocol catalogue could not be loaded. ", String(e.message || e)));
  });
})();
