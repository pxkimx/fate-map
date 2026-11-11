/* Fate Map micrograph renderer.
   Draws a simulated micrograph for a morphology archetype: phase contrast, or immunofluorescence with
   up to two marker channels and a nuclear counterstain. These are illustrations built from the published
   descriptions of each culture, not photographs. Geometry is seeded, so a given cell type always looks the same.

   Micro.draw(canvas, {archetype, seed, mode: "phase"|"fluor", stains: [{color, loc, frac, side}], beat})
*/
(function () {
  "use strict";
  const TAU = Math.PI * 2;

  // ---------------------------------------------------------------- random
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    const f = function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.range = (lo, hi) => lo + (hi - lo) * f();
    f.int = (lo, hi) => Math.floor(f.range(lo, hi + 1));
    f.pick = (arr) => arr[Math.floor(f() * arr.length)];
    f.gauss = () => (f() + f() + f() + f() - 2) / 0.58;
    return f;
  }
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // ---------------------------------------------------------------- geometry helpers
  function smoothPath(pts, closed) {
    const p = new Path2D();
    const n = pts.length;
    if (n < 2) return p;
    if (closed) {
      const m0 = [(pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2];
      p.moveTo(m0[0], m0[1]);
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        p.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      }
      p.closePath();
    } else {
      p.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < n - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        p.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      }
      p.lineTo(pts[n - 1][0], pts[n - 1][1]);
    }
    return p;
  }
  // radial outline: r(theta) = r * (1 + sum of harmonics) with optional sharp lobes
  function blob(cx, cy, r, rnd, o) {
    o = o || {};
    const n = o.n || 40, amp = o.amp == null ? 0.12 : o.amp, k = o.k || 4;
    const hs = [];
    for (let i = 2; i < 2 + k; i++) hs.push([i, rnd.range(0, TAU), amp * rnd.range(0.4, 1) / Math.sqrt(i - 1)]);
    const lobes = o.lobes || [];
    const sx = o.sx || 1, sy = o.sy || 1, rot = o.rot || 0;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * TAU;
      let m = 1;
      for (const h of hs) m += h[2] * Math.sin(h[0] * t + h[1]);
      for (const l of lobes) {
        let d = Math.abs(((t - l[0] + Math.PI * 3) % TAU) - Math.PI);
        m += l[1] * Math.exp(-(d * d) / (2 * l[2] * l[2]));
      }
      const x = Math.cos(t) * r * m * sx, y = Math.sin(t) * r * m * sy;
      pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
    }
    return pts;
  }
  function inPoly(pts, x, y) {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }
  function clip(poly, px, py, nx, ny) { // keep the side where (p - P) . n <= 0
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const da = (a[0] - px) * nx + (a[1] - py) * ny, db = (b[0] - px) * nx + (b[1] - py) * ny;
      if (da <= 0) out.push(a);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const t = da / (da - db);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return out;
  }
  // Voronoi cells by clipping against neighbours' bisectors. Fine for a few hundred points.
  function voronoi(points, reach) {
    const cell = reach, grid = new Map();
    points.forEach((p, i) => {
      const k = Math.floor(p[0] / cell) + "," + Math.floor(p[1] / cell);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    });
    return points.map((p, i) => {
      let poly = [[p[0] - reach, p[1] - reach], [p[0] + reach, p[1] - reach], [p[0] + reach, p[1] + reach], [p[0] - reach, p[1] + reach]];
      const gx = Math.floor(p[0] / cell), gy = Math.floor(p[1] / cell);
      for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
        const arr = grid.get((gx + dx) + "," + (gy + dy));
        if (!arr) continue;
        for (const j of arr) {
          if (j === i) continue;
          const q = points[j];
          const nx = q[0] - p[0], ny = q[1] - p[1];
          if (nx * nx + ny * ny > 4 * reach * reach) continue;
          poly = clip(poly, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2, nx, ny);
          if (poly.length < 3) break;
        }
      }
      return poly;
    });
  }
  function centroid(poly) {
    let x = 0, y = 0;
    for (const p of poly) { x += p[0]; y += p[1]; }
    return [x / poly.length, y / poly.length];
  }
  function shrink(poly, f) {
    const c = centroid(poly);
    return poly.map((p) => [c[0] + (p[0] - c[0]) * f, c[1] + (p[1] - c[1]) * f]);
  }
  function polyRadius(poly) {
    const c = centroid(poly);
    let r = 0;
    for (const p of poly) r += Math.hypot(p[0] - c[0], p[1] - c[1]);
    return r / poly.length;
  }
  // jittered points on a staggered grid
  function scatter(w, h, sp, jit, rnd, keep) {
    const pts = [];
    let row = 0;
    for (let y = -sp; y < h + sp; y += sp * 0.87, row++) {
      for (let x = -sp + (row % 2 ? sp / 2 : 0); x < w + sp; x += sp) {
        const px = x + rnd.range(-jit, jit) * sp, py = y + rnd.range(-jit, jit) * sp;
        if (!keep || keep(px, py)) pts.push([px, py]);
      }
    }
    return pts;
  }
  // a wandering line (neurite, process)
  function walk(x, y, ang, len, rnd, o) {
    o = o || {};
    const step = o.step || 7, wob = o.wob == null ? 0.28 : o.wob;
    const pts = [[x, y]];
    let a = ang;
    for (let d = 0; d < len; d += step) {
      a += rnd.gauss() * wob + (o.curl || 0);
      x += Math.cos(a) * step; y += Math.sin(a) * step;
      pts.push([x, y]);
    }
    pts.ang = a;
    return pts;
  }
  // branching arbor made of walks; returns [{pts, w}]
  function arbor(x, y, ang, len, depth, w, rnd, o) {
    o = o || {};
    const out = [];
    const pts = walk(x, y, ang, len, rnd, o);
    out.push({ pts, w });
    if (depth > 0) {
      const nb = o.nb == null ? 2 : o.nb;
      for (let b = 0; b < nb; b++) {
        if (rnd() < (o.pb == null ? 0.8 : o.pb)) {
          const i = Math.floor(rnd.range(0.3, 1) * (pts.length - 1));
          const p = pts[i];
          const a2 = (b === 0 && nb > 1 ? pts.ang : ang) + rnd.range(0.4, 1.1) * (rnd() < 0.5 ? -1 : 1);
          for (const s of arbor(p[0], p[1], a2, len * rnd.range(0.45, 0.7), depth - 1, w * 0.65, rnd, o)) out.push(s);
        }
      }
    }
    return out;
  }
  function ellipsePts(cx, cy, rx, ry, rot, n) {
    const pts = [];
    n = n || 18;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * TAU, x = Math.cos(t) * rx, y = Math.sin(t) * ry;
      pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
    }
    return pts;
  }
  // lens-shaped (spindle) outline along an axis
  function lens(cx, cy, len, wid, ang, bend) {
    const pts = [], n = 9;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const side = (sgn) => {
      for (let i = 0; i <= n; i++) {
        const t = sgn > 0 ? i / n : 1 - i / n;
        const u = (t - 0.5) * len;
        const v = sgn * wid * Math.pow(Math.sin(Math.PI * t), 0.75) / 2 + (bend || 0) * Math.sin(Math.PI * t);
        pts.push([cx + u * ca - v * sa, cy + u * sa + v * ca]);
      }
    };
    side(1); side(-1);
    return pts;
  }
  // smooth angle field so that elongated cells swirl together
  function flow(rnd) {
    const a = rnd.range(0, TAU), fx = rnd.range(0.004, 0.009), fy = rnd.range(0.004, 0.009), p = rnd.range(0, TAU);
    return (x, y) => a + 0.9 * Math.sin(x * fx + p) + 0.7 * Math.cos(y * fy + p * 1.7);
  }

  function nucleus(x, y, rx, ry, rot, extra) {
    return Object.assign({ x, y, rx, ry, rot: rot || 0 }, extra || {});
  }
  // a cell record. style: sheet | flat | soma | round | fibre
  function cell(o) {
    return Object.assign({ nuclei: [], procs: [], style: "flat", u: 0, pts: null, path: null }, o);
  }
  function sheetCells(w, h, sp, jit, rnd, o) {
    o = o || {};
    // every point shapes the tessellation; only the ones inside the mask become cells, so edge cells stay cell-sized
    const pts = scatter(w, h, sp, jit, rnd);
    const polys = voronoi(pts, sp * 1.6);
    const cells = [];
    polys.forEach((poly, i) => {
      if (poly.length < 3) return;
      if (o.keep && !o.keep(pts[i][0], pts[i][1])) return;
      const c = centroid(poly);
      if (c[0] < -sp || c[0] > w + sp || c[1] < -sp || c[1] > h + sp) return;
      const body = shrink(poly, o.inset == null ? 0.94 : o.inset);
      const r = polyRadius(body);
      if (r > sp * 1.15) return; // edge cells of a masked sheet would balloon outward
      const nr = r * (o.nuc == null ? 0.42 : o.nuc);
      const cl = cell({ pts: body, path: smoothPath(body, true), cx: c[0], cy: c[1], r, style: "sheet", u: rnd(), ang: rnd.range(0, TAU) });
      const bi = o.bi && rnd() < o.bi;
      if (bi) {
        const a = rnd.range(0, TAU);
        cl.nuclei.push(nucleus(c[0] + Math.cos(a) * nr * 0.8, c[1] + Math.sin(a) * nr * 0.8, nr * 0.8, nr * 0.72, a));
        cl.nuclei.push(nucleus(c[0] - Math.cos(a) * nr * 0.8, c[1] - Math.sin(a) * nr * 0.8, nr * 0.8, nr * 0.72, a));
      } else {
        cl.nuclei.push(nucleus(c[0] + rnd.range(-1, 1) * r * 0.12, c[1] + rnd.range(-1, 1) * r * 0.12, nr * rnd.range(0.9, 1.15), nr * rnd.range(0.8, 1), rnd.range(0, TAU)));
      }
      cells.push(cl);
    });
    return cells;
  }
  function roundCell(x, y, r, rnd, o) {
    const pts = blob(x, y, r, rnd, { amp: 0.04, n: 16 });
    return cell(Object.assign({ pts, path: smoothPath(pts, true), cx: x, cy: y, r, style: "round", u: rnd(),
      nuclei: [nucleus(x + rnd.range(-1, 1) * r * 0.15, y + rnd.range(-1, 1) * r * 0.15, r * 0.6, r * 0.55, rnd.range(0, TAU))] }, o || {}));
  }
  // nuclei scattered inside an outline (used for 3D aggregates in fluorescence)
  function fillNuclei(pts, cx, cy, r, sp, rnd, o) {
    const out = [];
    o = o || {};
    for (const p of scatter(cx + r * 1.4, cy + r * 1.4, sp, 0.35, rnd)) {
      const x = p[0] - 0, y = p[1] - 0;
      if (x < cx - r * 1.4 || y < cy - r * 1.4) continue;
      if (!inPoly(pts, x, y)) continue;
      if (o.skip && o.skip(x, y)) continue;
      const c = roundCell(x, y, sp * 0.52, rnd, { inBlob: true });
      c.nuclei[0].rx = sp * 0.36; c.nuclei[0].ry = sp * 0.32;
      out.push(c);
    }
    return out;
  }

  // ---------------------------------------------------------------- archetypes
  // each returns {cells, blobs, extras, ph} ; ph = phase-contrast paint settings
  const A = {};

  A.psc_colony = function (w, h, s, rnd) {
    const cols = [];
    const n = rnd.int(2, 3);
    const spots = [[0.3, 0.42, 0.3], [0.72, 0.6, 0.27], [0.62, 0.16, 0.16]];
    for (let i = 0; i < n; i++) {
      const c = spots[i];
      cols.push(blob(w * (c[0] + rnd.range(-0.04, 0.04)), h * (c[1] + rnd.range(-0.05, 0.05)), Math.min(w, h) * c[2] * 1.25, rnd, { amp: 0.16, k: 5, n: 48, sx: 1.15 }));
    }
    const inAny = (x, y) => cols.some((c) => inPoly(c, x, y));
    const cells = sheetCells(w, h, 12.5 * s, 0.3, rnd, { keep: inAny, nuc: 0.62, inset: 0.96 });
    cells.forEach((c) => { c.nuclei[0].nucleoli = 2; });
    return { cells, blobs: cols.map((pts) => ({ kind: "colony", pts })), extras: [], ph: { body: 0.14, border: 0.5, halo: 0, nuc: 0.34 } };
  };

  A.monolayer_dense = function (w, h, s, rnd) {
    const cells = sheetCells(w, h, 15 * s, 0.34, rnd, { nuc: 0.52, inset: 0.95 });
    return { cells, blobs: [], extras: [], ph: { body: 0.16, border: 0.5, halo: 0.2, nuc: 0.34 } };
  };

  A.cobblestone = function (w, h, s, rnd) {
    const cells = sheetCells(w, h, 30 * s, 0.3, rnd, { nuc: 0.36, inset: 0.93 });
    return { cells, blobs: [], extras: [], ph: { body: 0.12, border: 0.55, halo: 0.4, nuc: 0.36, gran: 0.25 } };
  };

  A.hepatocyte = function (w, h, s, rnd) {
    const cells = sheetCells(w, h, 37 * s, 0.26, rnd, { nuc: 0.3, inset: 0.92, bi: 0.24 });
    cells.forEach((c) => c.nuclei.forEach((n) => { n.nucleoli = 1; }));
    return { cells, blobs: [], extras: [], ph: { body: 0.2, border: 0.2, halo: 0.75, nuc: 0.34, gran: 0.9 } };
  };

  A.pigmented_epithelium = function (w, h, s, rnd) {
    const cells = sheetCells(w, h, 24 * s, 0.12, rnd, { nuc: 0.34, inset: 0.9 });
    const extras = [];
    cells.forEach((c) => {
      c.pig = rnd.range(0.35, 1) * (rnd() < 0.12 ? 0.3 : 1);
      const k = Math.round(26 * c.pig);
      for (let i = 0; i < k; i++) {
        const a = rnd.range(0, TAU), d = Math.sqrt(rnd()) * c.r * 0.86;
        extras.push({ kind: "pigment", x: c.cx + Math.cos(a) * d, y: c.cy + Math.sin(a) * d, r: rnd.range(0.5, 1.3) * s });
      }
    });
    return { cells, blobs: [], extras, tint: [86, 60, 38], ph: { body: 0.34, border: 0.1, halo: 0.5, nuc: 0.0 } };
  };

  A.rosettes = function (w, h, s, rnd) {
    const cells = [], blobs = [];
    const centres = [];
    const n = rnd.int(3, 4);
    let guard = 0;
    while (centres.length < n && guard++ < 200) {
      const c = [rnd.range(0.14, 0.86) * w, rnd.range(0.16, 0.84) * h, rnd.range(46, 66) * s];
      if (centres.every((d) => Math.hypot(d[0] - c[0], d[1] - c[1]) > d[2] + c[2] + 6 * s)) centres.push(c);
    }
    centres.forEach((c) => {
      const r0 = c[2] * 0.14, r1 = c[2];
      const k = Math.round(TAU * r1 / (10.5 * s) * 0.62);
      for (let i = 0; i < k; i++) {
        const a0 = (i / k) * TAU + rnd.range(-0.03, 0.03), a1 = ((i + 1) / k) * TAU;
        const rr = r1 * rnd.range(0.86, 1.06);
        const pts = [
          [c[0] + Math.cos(a0) * r0, c[1] + Math.sin(a0) * r0], [c[0] + Math.cos(a0) * rr, c[1] + Math.sin(a0) * rr],
          [c[0] + Math.cos((a0 + a1) / 2) * rr * 1.03, c[1] + Math.sin((a0 + a1) / 2) * rr * 1.03],
          [c[0] + Math.cos(a1) * rr, c[1] + Math.sin(a1) * rr], [c[0] + Math.cos(a1) * r0, c[1] + Math.sin(a1) * r0]];
        const am = (a0 + a1) / 2, nd = rnd.range(0.38, 0.86) * rr;
        cells.push(cell({ pts, path: smoothPath(pts, true), cx: c[0] + Math.cos(am) * rr * 0.6, cy: c[1] + Math.sin(am) * rr * 0.6, r: 9 * s, ang: am, style: "sheet", u: rnd(),
          thick: true, nuclei: [nucleus(c[0] + Math.cos(am) * nd, c[1] + Math.sin(am) * nd, 6.4 * s, 3.5 * s, am)] }));
      }
      blobs.push({ kind: "lumen", pts: blob(c[0], c[1], r0 * 1.25, rnd, { amp: 0.1, n: 14 }), cx: c[0], cy: c[1], r: r0 });
    });
    const out = (x, y) => centres.every((c) => Math.hypot(x - c[0], y - c[1]) > c[2] * 1.02);
    sheetCells(w, h, 14 * s, 0.34, rnd, { keep: out, nuc: 0.5, inset: 0.95 }).forEach((c) => cells.push(c));
    return { cells, blobs, extras: [], ph: { body: 0.16, border: 0.44, halo: 0.14, nuc: 0.34, thick: 0.2 } };
  };

  function neuronSoma(x, y, r, rnd) {
    const pts = blob(x, y, r, rnd, { amp: 0.14, n: 14, sx: rnd.range(1, 1.35), rot: rnd.range(0, TAU) });
    return cell({ pts, path: smoothPath(pts, true), cx: x, cy: y, r, style: "soma", u: rnd(), nuclei: [nucleus(x, y, r * 0.56, r * 0.5, 0, { nucleoli: 1 })] });
  }
  A.neurons = function (w, h, s, rnd) {
    const cells = [];
    const n = rnd.int(15, 19);
    const hubs = [[rnd.range(0.2, 0.4) * w, rnd.range(0.25, 0.75) * h], [rnd.range(0.6, 0.85) * w, rnd.range(0.25, 0.75) * h]];
    for (let i = 0; i < n; i++) {
      let x, y;
      if (rnd() < 0.5) { const hb = rnd.pick(hubs); x = hb[0] + rnd.gauss() * 30 * s; y = hb[1] + rnd.gauss() * 26 * s; }
      else { x = rnd.range(0.04, 0.96) * w; y = rnd.range(0.06, 0.94) * h; }
      const c = neuronSoma(x, y, rnd.range(6.5, 9.5) * s, rnd);
      const a0 = rnd.range(0, TAU);
      c.procs.push({ pts: walk(x, y, a0, rnd.range(260, 520) * s, rnd, { step: 9 * s, wob: 0.16 }), w: 1.25 * s, axon: true });
      const nd = rnd.int(2, 4);
      for (let d = 0; d < nd; d++) {
        const a = a0 + Math.PI + rnd.range(-1.3, 1.3);
        arbor(x, y, a, rnd.range(40, 95) * s, 2, 1.7 * s, rnd, { step: 6 * s, wob: 0.3 }).forEach((p) => c.procs.push(p));
      }
      cells.push(c);
    }
    return { cells, blobs: [], extras: [], ph: { body: 0.5, border: 0.5, halo: 0.95, nuc: 0.2, proc: 0.62 } };
  };

  A.astrocytes = function (w, h, s, rnd) {
    const cells = [];
    const pts0 = scatter(w, h, 118 * s, 0.34, rnd);
    pts0.forEach((p) => {
      const k = rnd.int(3, 6), lobes = [];
      let a0 = rnd.range(0, TAU);
      for (let i = 0; i < k; i++) { a0 += rnd.range(0.7, 1.9); lobes.push([a0, rnd.range(0.5, 2.3), rnd.range(0.11, 0.3)]); }
      const r = rnd.range(15, 25) * s;
      const pts = blob(p[0], p[1], r, rnd, { amp: 0.3, k: 5, n: 84, lobes, sx: rnd.range(1, 1.5), rot: rnd.range(0, TAU) });
      const c = cell({ pts, path: smoothPath(pts, true), cx: p[0], cy: p[1], r, style: "flat", u: rnd(), nuclei: [nucleus(p[0], p[1], 8 * s, 6.4 * s, rnd.range(0, TAU), { nucleoli: 2 })] });
      lobes.forEach((l) => {
        const d = r * (1 + l[1]) * 0.92;
        arbor(p[0] + Math.cos(l[0]) * d, p[1] + Math.sin(l[0]) * d, l[0], rnd.range(18, 44) * s, 1, 1.5 * s, rnd, { step: 6 * s, wob: 0.3, pb: 0.6 }).forEach((q) => c.procs.push(q));
      });
      cells.push(c);
    });
    return { cells, blobs: [], extras: [], ph: { body: 0.12, border: 0.28, halo: 0.3, nuc: 0.36, proc: 0.4, gran: 0.3 } };
  };

  A.oligodendrocytes = function (w, h, s, rnd) {
    const cells = [];
    scatter(w, h, 128 * s, 0.36, rnd).forEach((p) => {
      const c = neuronSoma(p[0], p[1], rnd.range(6, 7.6) * s, rnd);
      const k = rnd.int(7, 11);
      for (let i = 0; i < k; i++) {
        const a = (i / k) * TAU + rnd.range(-0.25, 0.25);
        arbor(p[0], p[1], a, rnd.range(26, 46) * s, 3, 1.5 * s, rnd, { step: 5 * s, wob: 0.34, nb: 2, pb: 0.86 }).forEach((q) => c.procs.push(q));
      }
      cells.push(c);
    });
    return { cells, blobs: [], extras: [], ph: { body: 0.5, border: 0.5, halo: 0.9, nuc: 0.2, proc: 0.55 } };
  };

  A.microglia = function (w, h, s, rnd) {
    const cells = [];
    scatter(w, h, 84 * s, 0.4, rnd).forEach((p) => {
      const r = rnd.range(5, 6.6) * s, rot = rnd.range(0, TAU);
      const pts = blob(p[0], p[1], r, rnd, { amp: 0.12, n: 14, sx: 1.5, rot });
      const c = cell({ pts, path: smoothPath(pts, true), cx: p[0], cy: p[1], r, style: "soma", u: rnd(), nuclei: [nucleus(p[0], p[1], r * 0.8, r * 0.5, rot)] });
      const k = rnd.int(3, 5);
      for (let i = 0; i < k; i++) {
        const a = rot + (i % 2 ? Math.PI : 0) + rnd.range(-0.9, 0.9);
        arbor(p[0], p[1], a, rnd.range(18, 34) * s, 2, 1.3 * s, rnd, { step: 5 * s, wob: 0.36, pb: 0.7 }).forEach((q) => c.procs.push(q));
      }
      cells.push(c);
    });
    return { cells, blobs: [], extras: [], ph: { body: 0.46, border: 0.5, halo: 0.7, nuc: 0.2, proc: 0.5 } };
  };

  function spindleCells(w, h, s, rnd, sp, len, wid) {
    const f = flow(rnd), cells = [];
    scatter(w, h, sp * s, 0.42, rnd).forEach((p) => {
      const a = f(p[0], p[1]) + rnd.range(-0.2, 0.2);
      const L = len * rnd.range(0.78, 1.25) * s, W = wid * rnd.range(0.8, 1.25) * s;
      const pts = lens(p[0], p[1], L, W, a, rnd.range(-3, 3) * s);
      const c = cell({ pts, path: smoothPath(pts, true), cx: p[0], cy: p[1], r: W, ang: a, style: "flat", u: rnd(), len: L,
        nuclei: [nucleus(p[0], p[1], W * 0.62, W * 0.34, a, { nucleoli: 2 })] });
      for (const sg of [1, -1]) {
        const ex = p[0] + Math.cos(a) * L / 2 * sg, ey = p[1] + Math.sin(a) * L / 2 * sg;
        c.procs.push({ pts: walk(ex, ey, a + (sg < 0 ? Math.PI : 0), rnd.range(8, 26) * s, rnd, { step: 5 * s, wob: 0.2 }), w: 1.1 * s });
      }
      cells.push(c);
    });
    return cells;
  }
  A.spindle = function (w, h, s, rnd) {
    return { cells: spindleCells(w, h, s, rnd, 46, 92, 15), blobs: [], extras: [], ph: { body: 0.14, border: 0.3, halo: 0.34, nuc: 0.34, proc: 0.4, gran: 0.25 } };
  };

  A.myotubes = function (w, h, s, rnd) {
    const cells = [];
    const base = rnd.range(-0.35, 0.1);
    const n = rnd.int(9, 12);
    for (let i = 0; i < n; i++) {
      const y0 = ((i + 0.5) / n) * h * 1.25 - h * 0.12 + rnd.range(-8, 8) * s;
      const a = base + rnd.range(-0.09, 0.09), W = rnd.range(11, 19) * s;
      const spine = walk(-30 * s, y0 - Math.tan(a) * 0, a, w * 1.25, rnd, { step: 26 * s, wob: 0.035 });
      const up = [], dn = [];
      spine.forEach((p, j) => {
        const q = spine[Math.min(j + 1, spine.length - 1)], o = spine[Math.max(j - 1, 0)];
        const t = Math.atan2(q[1] - o[1], q[0] - o[0]) + Math.PI / 2;
        const ww = W * (0.85 + 0.2 * Math.sin(j * 0.9 + i));
        up.push([p[0] + Math.cos(t) * ww / 2, p[1] + Math.sin(t) * ww / 2]);
        dn.push([p[0] - Math.cos(t) * ww / 2, p[1] - Math.sin(t) * ww / 2]);
      });
      const pts = up.concat(dn.reverse());
      const c = cell({ pts, path: smoothPath(pts, true), cx: w / 2, cy: y0, r: W, ang: a, style: "fibre", u: rnd(), spine, wid: W });
      let j = rnd.range(0, 1.5);
      while (j < spine.length - 1) {
        const k = Math.floor(j), fr = j - k, p = spine[k], q = spine[k + 1];
        c.nuclei.push(nucleus(p[0] + (q[0] - p[0]) * fr, p[1] + (q[1] - p[1]) * fr + rnd.range(-0.15, 0.15) * W, W * 0.42, W * 0.27, a));
        j += rnd() < 0.5 ? rnd.range(0.35, 0.6) : rnd.range(0.9, 2.2);
      }
      cells.push(c);
    }
    spindleCells(w, h, s, rnd, 120, 60, 11).filter(() => rnd() < 0.45).forEach((c) => { c.minor = true; cells.unshift(c); });
    return { cells, blobs: [], extras: [], ph: { body: 0.26, border: 0.34, halo: 0.6, nuc: 0.34, proc: 0.4, gran: 0.2 } };
  };

  A.cardiomyocytes = function (w, h, s, rnd) {
    const p1 = rnd.range(0, TAU), p2 = rnd.range(0, TAU), fx = rnd.range(0.012, 0.017) / s, fy = rnd.range(0.013, 0.019) / s;
    const band = (x, y) => Math.sin(x * fx + p1 + 1.3 * Math.sin(y * fy * 0.7)) + Math.cos(y * fy + p2 + 1.1 * Math.sin(x * fx * 0.8));
    const f = flow(rnd);
    const cells = sheetCells(w, h, 25 * s, 0.34, rnd, { keep: (x, y) => band(x, y) > -0.35, nuc: 0.34, inset: 0.95, bi: 0.15 });
    cells.forEach((c) => { c.ang = f(c.cx, c.cy); c.thick = band(c.cx, c.cy) > 0.7; });
    return { cells, blobs: [], extras: [], beat: true, ph: { body: 0.3, border: 0.26, halo: 0.42, nuc: 0.26, gran: 0.4, thick: 0.26 } };
  };

  A.round_suspension = function (w, h, s, rnd) {
    const cells = [];
    const hubs = [];
    for (let i = 0; i < 5; i++) hubs.push([rnd.range(0.08, 0.92) * w, rnd.range(0.1, 0.9) * h]);
    for (let i = 0; i < 120; i++) {
      let x, y;
      if (rnd() < 0.55) { const hb = rnd.pick(hubs); x = hb[0] + rnd.gauss() * 26 * s; y = hb[1] + rnd.gauss() * 22 * s; }
      else { x = rnd.range(0, w); y = rnd.range(0, h); }
      const r = rnd.range(5, 8) * s;
      if (cells.some((c) => Math.hypot(c.cx - x, c.cy - y) < (c.r + r) * 0.82)) continue;
      cells.push(roundCell(x, y, r, rnd));
    }
    return { cells, blobs: [], extras: [], ph: { body: 0.3, border: 0.5, halo: 1, nuc: 0.1 } };
  };

  A.erythroid = function (w, h, s, rnd) {
    const g = A.round_suspension(w, h, s * 0.72, rnd);
    for (let i = 0; i < 90; i++) {
      const x = rnd.range(0, w), y = rnd.range(0, h), r = rnd.range(3.6, 5.2) * s;
      if (g.cells.some((c) => Math.hypot(c.cx - x, c.cy - y) < (c.r + r) * 0.85)) continue;
      g.cells.push(roundCell(x, y, r, rnd));
    }
    g.cells.forEach((c) => { c.red = rnd() < 0.8; if (c.red && rnd() < 0.45) c.nuclei = []; });
    g.tint = [176, 62, 50];
    return g;
  };

  A.macrophage = function (w, h, s, rnd) {
    const cells = [], extras = [];
    scatter(w, h, 76 * s, 0.4, rnd).forEach((p) => {
      const r = rnd.range(15, 25) * s;
      const long = rnd() < 0.25;
      const pts = blob(p[0], p[1], r, rnd, { amp: 0.16, k: 6, n: 44, sx: long ? 1.7 : 1.1, rot: rnd.range(0, TAU) });
      const a = rnd.range(0, TAU), d = r * 0.28;
      const c = cell({ pts, path: smoothPath(pts, true), cx: p[0], cy: p[1], r, style: "flat", u: rnd(),
        nuclei: [nucleus(p[0] + Math.cos(a) * d, p[1] + Math.sin(a) * d, r * 0.36, r * 0.27, a + 1.2)] });
      const k = rnd.int(3, 9);
      for (let i = 0; i < k; i++) {
        const va = a + Math.PI + rnd.range(-1.6, 1.6), vd = rnd.range(0.15, 0.6) * r;
        extras.push({ kind: "vacuole", x: p[0] + Math.cos(va) * vd, y: p[1] + Math.sin(va) * vd, r: rnd.range(1.6, 4.2) * s });
      }
      const fl = rnd.int(3, 8);
      for (let i = 0; i < fl; i++) {
        const fa = rnd.range(0, TAU);
        c.procs.push({ pts: walk(p[0] + Math.cos(fa) * r * 0.95, p[1] + Math.sin(fa) * r * 0.95, fa, rnd.range(5, 13) * s, rnd, { step: 4 * s, wob: 0.15 }), w: 0.9 * s });
      }
      cells.push(c);
    });
    return { cells, blobs: [], extras, ph: { body: 0.2, border: 0.36, halo: 0.55, nuc: 0.36, proc: 0.4, gran: 0.7 } };
  };

  A.megakaryocyte = function (w, h, s, rnd) {
    const cells = [], extras = [];
    const spots = scatter(w, h, 170 * s, 0.3, rnd).filter((p) => p[0] > 20 * s && p[0] < w - 20 * s && p[1] > 20 * s && p[1] < h - 20 * s);
    spots.forEach((p) => {
      const r = rnd.range(26, 38) * s;
      const pts = blob(p[0], p[1], r, rnd, { amp: 0.07, n: 36 });
      const c = cell({ pts, path: smoothPath(pts, true), cx: p[0], cy: p[1], r, style: "round", big: true, u: rnd() });
      const k = rnd.int(4, 7);
      for (let i = 0; i < k; i++) {
        const a = rnd.range(0, TAU), d = rnd.range(0, 0.3) * r;
        c.nuclei.push(nucleus(p[0] + Math.cos(a) * d, p[1] + Math.sin(a) * d, r * 0.26, r * 0.2, rnd.range(0, TAU)));
      }
      if (rnd() < 0.55) {
        const np = rnd.int(2, 4);
        for (let i = 0; i < np; i++) {
          const a = rnd.range(0, TAU);
          const pr = { pts: walk(p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r, a, rnd.range(60, 130) * s, rnd, { step: 7 * s, wob: 0.3 }), w: 1.1 * s, beads: true };
          c.procs.push(pr);
          pr.pts.forEach((q, j) => { if (j > 1 && j % 2 === 0) extras.push({ kind: "bead", x: q[0], y: q[1], r: rnd.range(1.5, 2.6) * s }); });
        }
      }
      cells.push(c);
    });
    for (let i = 0; i < 46; i++) {
      const x = rnd.range(0, w), y = rnd.range(0, h), r = rnd.range(5, 9) * s;
      if (cells.some((c) => Math.hypot(c.cx - x, c.cy - y) < c.r + r + 2)) continue;
      cells.push(roundCell(x, y, r, rnd));
    }
    for (let i = 0; i < 90; i++) extras.push({ kind: "bead", x: rnd.range(0, w), y: rnd.range(0, h), r: rnd.range(0.9, 1.7) * s });
    return { cells, blobs: [], extras, ph: { body: 0.3, border: 0.5, halo: 1, nuc: 0.26, proc: 0.5 } };
  };

  function aggregates(w, h, s, rnd, o) {
    const blobs = [], cells = [];
    const spots = [];
    let guard = 0;
    while (spots.length < o.n && guard++ < 400) {
      const r = rnd.range(o.r0, o.r1) * s;
      const c = [rnd.range(r * 0.9, w - r * 0.9), rnd.range(r * 0.9, h - r * 0.9), r];
      if (spots.every((d) => Math.hypot(d[0] - c[0], d[1] - c[1]) > (d[2] + c[2]) * 1.08)) spots.push(c);
    }
    spots.forEach((c) => {
      const pts = blob(c[0], c[1], c[2], rnd, { amp: o.amp, k: o.k || 4, n: 56, sx: rnd.range(1, 1 + (o.oval || 0.12)), rot: rnd.range(0, TAU) });
      blobs.push({ kind: o.kind || "sphere", pts, cx: c[0], cy: c[1], r: c[2] });
      fillNuclei(pts, c[0], c[1], c[2], (o.nsp || 9) * s, rnd).forEach((q) => cells.push(q));
    });
    return { blobs, cells, spots };
  }
  A.spheres = function (w, h, s, rnd) {
    const g = aggregates(w, h, s, rnd, { n: 6, r0: 34, r1: 62, amp: 0.05 });
    return { cells: g.cells, blobs: g.blobs, extras: debris(w, h, s, rnd, 30), ph: { body: 0.2, border: 0.4, halo: 0.8, nuc: 0.2 } };
  };
  A.islet_clusters = function (w, h, s, rnd) {
    const g = aggregates(w, h, s, rnd, { n: 10, r0: 22, r1: 40, amp: 0.1, k: 7, kind: "cluster", oval: 0.3 });
    return { cells: g.cells, blobs: g.blobs, extras: debris(w, h, s, rnd, 24), ph: { body: 0.2, border: 0.4, halo: 0.8, nuc: 0.2 } };
  };
  A.cartilage_pellet = function (w, h, s, rnd) {
    const under = spindleCells(w, h, s, rnd, 58, 80, 13);
    const g = aggregates(w, h, s, rnd, { n: 4, r0: 46, r1: 78, amp: 0.08, kind: "nodule", nsp: 12 });
    return { cells: under.concat(g.cells), blobs: g.blobs, extras: [], ph: { body: 0.12, border: 0.3, halo: 0.34, nuc: 0.34, proc: 0.4 } };
  };
  A.mineralized = function (w, h, s, rnd) {
    const cells = sheetCells(w, h, 26 * s, 0.34, rnd, { nuc: 0.36, inset: 0.94 });
    const g = aggregates(w, h, s, rnd, { n: 9, r0: 12, r1: 30, amp: 0.12, k: 6, kind: "mineral", oval: 0.6 });
    const extras = [];
    g.spots.forEach((c) => {
      for (let i = 0; i < 70; i++) {
        const a = rnd.range(0, TAU), d = c[2] * rnd.range(0.5, 1.6);
        extras.push({ kind: "grain", x: c[0] + Math.cos(a) * d, y: c[1] + Math.sin(a) * d, r: rnd.range(0.8, 4.2) * s * (1.7 - d / c[2]) });
      }
    });
    return { cells, blobs: g.blobs, extras, ph: { body: 0.12, border: 0.36, halo: 0.2, nuc: 0.3, gran: 0.3 } };
  };

  function debris(w, h, s, rnd, n) {
    const ex = [];
    for (let i = 0; i < n; i++) ex.push({ kind: "debris", x: rnd.range(0, w), y: rnd.range(0, h), r: rnd.range(0.6, 2) * s });
    return ex;
  }

  A.organoid_budding = function (w, h, s, rnd) {
    const blobs = [], cells = [];
    const spots = [[0.3 * w, 0.46 * h, 92 * s], [0.74 * w, 0.58 * h, 70 * s]];
    if (rnd() < 0.6) spots.push([0.66 * w, 0.17 * h, 34 * s]);
    spots.forEach((c) => {
      // a round body with round buds: the outline of a union of circles, seen from the centre
      const k = rnd.int(5, 8), R0 = c[2] * 0.6, circles = [[0, 0, R0]];
      for (let i = 0; i < k; i++) {
        const a = (i / k) * TAU + rnd.range(-0.25, 0.25), br = R0 * rnd.range(0.3, 0.5), d = R0 * rnd.range(0.85, 1.1);
        circles.push([Math.cos(a) * d, Math.sin(a) * d, br]);
      }
      const pts = [];
      for (let i = 0; i < 160; i++) {
        const t = (i / 160) * TAU, ux = Math.cos(t), uy = Math.sin(t);
        let far = 0;
        for (const q of circles) {
          const b = ux * q[0] + uy * q[1], disc = b * b - (q[0] * q[0] + q[1] * q[1] - q[2] * q[2]);
          if (disc >= 0) far = Math.max(far, b + Math.sqrt(disc));
        }
        pts.push([c[0] + ux * far, c[1] + uy * far]);
      }
      const inner = pts.map((p) => {
        const d = Math.hypot(p[0] - c[0], p[1] - c[1]), wall = 10 * s;
        return [c[0] + (p[0] - c[0]) * (d - wall) / d, c[1] + (p[1] - c[1]) * (d - wall) / d];
      });
      blobs.push({ kind: "cyst", pts, inner, cx: c[0], cy: c[1], r: c[2] });
      fillNuclei(pts, c[0], c[1], c[2] * 1.2, 9 * s, rnd, { skip: (x, y) => inPoly(shrink(inner, 0.94), x, y) }).forEach((q) => cells.push(q));
    });
    return { cells, blobs, extras: debris(w, h, s, rnd, 26), ph: { body: 0.2, border: 0.4, halo: 0.8, nuc: 0.2 } };
  };

  A.organoid_neural = function (w, h, s, rnd) {
    const blobs = [], cells = [];
    const cx = w * 0.5, cy = h * 0.52, R = Math.min(w, h) * 0.4;
    const lobes = [];
    const k = rnd.int(5, 7);
    for (let i = 0; i < k; i++) lobes.push([(i / k) * TAU + rnd.range(-0.25, 0.25), rnd.range(0.12, 0.3), rnd.range(0.22, 0.34)]);
    const pts = blob(cx, cy, R, rnd, { amp: 0.04, n: 96, lobes, sx: 1.28 });
    blobs.push({ kind: "brain", pts, cx, cy, r: R });
    const loops = [];
    lobes.forEach((l) => {
      const d = R * (1 + l[1]) * 0.8, lr = rnd.range(19, 29) * s;
      const lx = cx + Math.cos(l[0]) * d * 1.28, ly = cy + Math.sin(l[0]) * d;
      loops.push([lx, ly, lr]);
      blobs.push({ kind: "loop", pts: blob(lx, ly, lr, rnd, { amp: 0.14, n: 26, sx: rnd.range(1, 1.5), rot: l[0] }), cx: lx, cy: ly, r: lr });
    });
    fillNuclei(pts, cx, cy, R * 1.5, 9 * s, rnd, { skip: (x, y) => loops.some((l) => Math.hypot(x - l[0], y - l[1]) < l[2] * 0.55) }).forEach((q) => {
      q.rim = loops.some((l) => Math.hypot(q.cx - l[0], q.cy - l[1]) < l[2] * 1.9);
      cells.push(q);
    });
    return { cells, blobs, extras: debris(w, h, s, rnd, 20), ph: { body: 0.2, border: 0.4, halo: 0.8, nuc: 0.2 } };
  };

  A.optic_cup = function (w, h, s, rnd) {
    const blobs = [], cells = [];
    const spots = [[0.36 * w, 0.5 * h, Math.min(w, h) * 0.33], [0.8 * w, 0.42 * h, Math.min(w, h) * 0.17]];
    spots.forEach((c) => {
      const a0 = rnd.range(0, TAU);
      const pts = blob(c[0], c[1], c[2], rnd, { amp: 0.04, n: 80, lobes: [[a0, 0.16, 0.9]] });
      blobs.push({ kind: "retina", pts, cx: c[0], cy: c[1], r: c[2], a0, span: rnd.range(1.5, 2.3) });
      fillNuclei(pts, c[0], c[1], c[2] * 1.2, 8.5 * s, rnd).forEach((q) => {
        const d = Math.hypot(q.cx - c[0], q.cy - c[1]) / c[2];
        const da = Math.abs(((Math.atan2(q.cy - c[1], q.cx - c[0]) - a0 + Math.PI * 3) % TAU) - Math.PI);
        q.rim = d > 0.72 && da < 1.9;
        cells.push(q);
      });
    });
    return { cells, blobs, extras: debris(w, h, s, rnd, 20), ph: { body: 0.2, border: 0.4, halo: 0.8, nuc: 0.2 } };
  };

  A.adipocytes = function (w, h, s, rnd) {
    const cells = sheetCells(w, h, 36 * s, 0.3, rnd, { nuc: 0.26, inset: 0.92 });
    const extras = [];
    cells.forEach((c) => {
      if (rnd() < 0.68) {
        c.lipid = true;
        if (rnd() < 0.35) {
          extras.push({ kind: "lipid", x: c.cx, y: c.cy, r: c.r * 0.62 });
          c.nuclei[0].x = c.cx + c.r * 0.66; c.nuclei[0].rx *= 0.8; c.nuclei[0].ry *= 0.5;
        } else {
          const k = rnd.int(5, 12);
          for (let i = 0; i < k; i++) {
            const a = rnd.range(0, TAU), d = rnd.range(0.3, 0.74) * c.r;
            extras.push({ kind: "lipid", x: c.cx + Math.cos(a) * d, y: c.cy + Math.sin(a) * d, r: rnd.range(2.2, 6) * s });
          }
        }
      }
    });
    return { cells, blobs: [], extras, ph: { body: 0.1, border: 0.36, halo: 0.2, nuc: 0.3 } };
  };

  A.dendritic_pigmented = function (w, h, s, rnd) {
    const cells = [], extras = [];
    scatter(w, h, 104 * s, 0.4, rnd).forEach((p) => {
      const rot = rnd.range(0, TAU), r = rnd.range(7, 9.5) * s;
      const pts = blob(p[0], p[1], r, rnd, { amp: 0.1, n: 16, sx: 1.7, rot });
      const c = cell({ pts, path: smoothPath(pts, true), cx: p[0], cy: p[1], r, style: "soma", dark: true, u: rnd(), nuclei: [nucleus(p[0], p[1], r * 0.7, r * 0.5, rot)] });
      const k = rnd.int(2, 4);
      for (let i = 0; i < k; i++) {
        const a = rot + (i % 2 ? Math.PI : 0) + (i > 1 ? rnd.range(-1.2, 1.2) : rnd.range(-0.2, 0.2));
        arbor(p[0], p[1], a, rnd.range(46, 84) * s, 1, 2.2 * s, rnd, { step: 7 * s, wob: 0.16, pb: 0.5 }).forEach((q) => c.procs.push(q));
      }
      for (let i = 0; i < 16; i++) {
        const a = rnd.range(0, TAU), d = Math.sqrt(rnd()) * r * 1.2;
        extras.push({ kind: "pigment", x: p[0] + Math.cos(a) * d, y: p[1] + Math.sin(a) * d * 0.7, r: rnd.range(0.6, 1.4) * s });
      }
      cells.push(c);
    });
    return { cells, blobs: [], extras, tint: [70, 50, 34], ph: { body: 0.62, border: 0.5, halo: 0.6, nuc: 0.1, proc: 0.75 } };
  };

  A.podocytes = function (w, h, s, rnd) {
    const cells = [];
    scatter(w, h, 150 * s, 0.3, rnd).forEach((p) => {
      const k = rnd.int(4, 6), lobes = [];
      for (let i = 0; i < k; i++) lobes.push([(i / k) * TAU + rnd.range(-0.3, 0.3), rnd.range(0.5, 1.1), rnd.range(0.16, 0.26)]);
      const r = rnd.range(24, 32) * s;
      const pts = blob(p[0], p[1], r, rnd, { amp: 0.08, n: 72, lobes });
      const c = cell({ pts, path: smoothPath(pts, true), cx: p[0], cy: p[1], r, style: "flat", u: rnd(), nuclei: [nucleus(p[0], p[1], 9.5 * s, 7.6 * s, rnd.range(0, TAU), { nucleoli: 2 })] });
      if (rnd() < 0.2) c.nuclei.push(nucleus(p[0] + 13 * s, p[1] + 4 * s, 8.6 * s, 7 * s, 0, { nucleoli: 1 }));
      lobes.forEach((l) => {
        const d = r * (1 + l[1]) * 0.9;
        arbor(p[0] + Math.cos(l[0]) * d, p[1] + Math.sin(l[0]) * d, l[0], rnd.range(22, 40) * s, 3, 2.6 * s, rnd, { step: 5 * s, wob: 0.3, nb: 3, pb: 0.85 }).forEach((q) => c.procs.push(q));
      });
      cells.push(c);
    });
    return { cells, blobs: [], extras: [], ph: { body: 0.14, border: 0.3, halo: 0.34, nuc: 0.36, proc: 0.46, gran: 0.4 } };
  };

  // ---------------------------------------------------------------- painting
  let NOISE = null;
  function noiseTile() {
    if (NOISE) return NOISE;
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const x = c.getContext("2d"), d = x.createImageData(256, 256), r = rng(77);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = 128 + r.gauss() * 46;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255;
    }
    x.putImageData(d, 0, 0);
    NOISE = c;
    return c;
  }
  function addNoise(ctx, w, h, alpha, mode) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = mode || "overlay";
    ctx.fillStyle = ctx.createPattern(noiseTile(), "repeat");
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  function ell(ctx, n) {
    ctx.beginPath();
    ctx.ellipse(n.x, n.y, Math.max(0.3, n.rx), Math.max(0.3, n.ry), n.rot || 0, 0, TAU);
  }
  function strokeProc(ctx, pr, w0, taper) {
    const pts = pr.pts;
    if (taper === false || pts.length < 4) { ctx.lineWidth = w0; ctx.stroke(smoothPath(pts, false)); return; }
    const third = Math.ceil(pts.length / 3);
    for (let k = 0; k < 3; k++) {
      const seg = pts.slice(Math.max(0, k * third - 1), Math.min(pts.length, (k + 1) * third + 1));
      if (seg.length < 2) continue;
      ctx.lineWidth = Math.max(0.5, w0 * (1 - k * 0.27));
      ctx.stroke(smoothPath(seg, false));
    }
  }

  function paintPhase(ctx, g, w, h, s, rnd) {
    const tint = g.tint;
    // field: even grey with a slow illumination gradient
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, "#a9aca6"); bg.addColorStop(1, "#959993");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    const P = g.ph;
    ctx.lineJoin = "round"; ctx.lineCap = "round";

    // colony underlay: a pluripotent colony reads as one slightly darker, sharply bounded patch
    g.blobs.forEach((b) => {
      if (b.kind !== "colony") return;
      const p = smoothPath(b.pts, true);
      ctx.save();
      ctx.shadowColor = "rgba(250,250,238,0.95)"; ctx.shadowBlur = 9 * s;
      ctx.strokeStyle = "rgba(245,245,232,0.8)"; ctx.lineWidth = 2.6 * s; ctx.stroke(p);
      ctx.restore();
      ctx.fillStyle = "rgba(98,102,98,0.34)"; ctx.fill(p);
    });

    // processes first, so bodies sit on top
    g.cells.forEach((c) => {
      if (c.inBlob || !c.procs.length) return;
      ctx.save();
      ctx.strokeStyle = "rgba(240,240,228,0.34)";
      c.procs.forEach((pr) => strokeProc(ctx, pr, pr.w * 2.6));
      ctx.strokeStyle = c.dark && tint ? `rgba(${tint[0]},${tint[1]},${tint[2]},0.9)` : `rgba(40,43,41,${P.proc || 0.5})`;
      c.procs.forEach((pr) => strokeProc(ctx, pr, pr.w));
      ctx.restore();
    });

    g.cells.forEach((c) => {
      if (c.inBlob) return;
      const path = c.path;
      if (c.style === "round") {
        const ro = c.big ? c.r + 5 * s : c.r * 1.5, f0 = c.big ? (c.r - 1.5 * s) / ro : 0.62, f1 = c.big ? (c.r + 1 * s) / ro : 0.76;
        const gr = ctx.createRadialGradient(c.cx, c.cy, c.r * 0.15, c.cx, c.cy, ro);
        if (c.red && tint) {
          gr.addColorStop(0, `rgba(${tint[0]},${tint[1]},${tint[2]},0.82)`); gr.addColorStop(f0, `rgba(${tint[0] - 30},${tint[1] - 10},${tint[2] - 10},0.8)`);
        } else {
          gr.addColorStop(0, c.big ? "rgba(84,88,86,0.6)" : "rgba(96,100,98,0.75)"); gr.addColorStop(f0, c.big ? "rgba(70,74,72,0.6)" : "rgba(66,70,68,0.72)");
        }
        gr.addColorStop(f1, "rgba(252,252,240,0.95)"); gr.addColorStop(1, "rgba(252,252,240,0)");
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(c.cx, c.cy, ro, 0, TAU); ctx.fill();
        if (c.big) {
          ctx.fillStyle = "rgba(70,74,72,0.3)"; ctx.fill(path);
          c.nuclei.forEach((n) => { ell(ctx, n); ctx.fillStyle = "rgba(50,54,54,0.4)"; ctx.fill(); });
        }
        return;
      }
      const halo = (P.halo || 0) * (c.minor ? 0.6 : 1);
      if (halo > 0) {
        ctx.save();
        ctx.shadowColor = "rgba(252,252,240,0.9)"; ctx.shadowBlur = (c.style === "soma" ? 7 : 4.5) * s;
        ctx.strokeStyle = `rgba(248,248,236,${0.75 * halo})`; ctx.lineWidth = (c.style === "soma" ? 2.4 : 1.5) * s; ctx.stroke(path);
        ctx.restore();
      }
      let body = P.body + (c.thick ? P.thick || 0 : 0);
      if (c.dark && tint) ctx.fillStyle = `rgba(${tint[0]},${tint[1]},${tint[2]},0.92)`;
      else if (c.pig != null && tint) ctx.fillStyle = `rgba(${tint[0]},${tint[1]},${tint[2]},${0.25 + 0.6 * c.pig})`;
      else ctx.fillStyle = `rgba(62,66,64,${body})`;
      ctx.fill(path);
      if (P.gran && c.r > 9 * s && !c.dark) {
        ctx.save(); ctx.clip(path);
        ctx.fillStyle = `rgba(40,44,42,${0.18 * P.gran})`;
        const k = Math.round(c.r * c.r / (9 * s * s) * P.gran * 0.5);
        for (let i = 0; i < k; i++) {
          const a = rnd.range(0, TAU), d = Math.sqrt(rnd()) * c.r * (c.len ? c.len / c.r / 2.4 : 1);
          ctx.beginPath(); ctx.arc(c.cx + Math.cos(c.len ? c.ang : a) * d * (c.len ? rnd.range(-1, 1) : 1), c.cy + Math.sin(c.len ? c.ang : a) * d * (c.len ? rnd.range(-1, 1) : 1), rnd.range(0.5, 1.2) * s, 0, TAU); ctx.fill();
        }
        ctx.restore();
      }
      ctx.strokeStyle = `rgba(34,37,35,${P.border})`; ctx.lineWidth = 0.9 * s; ctx.stroke(path);
      if (P.nuc > 0) c.nuclei.forEach((n) => {
        ell(ctx, n);
        ctx.fillStyle = c.style === "soma" ? "rgba(150,154,150,0.5)" : `rgba(120,124,120,${P.nuc})`; ctx.fill();
        ctx.strokeStyle = "rgba(40,43,41,0.42)"; ctx.lineWidth = 0.7 * s; ctx.stroke();
        const k = n.nucleoli || 0;
        ctx.fillStyle = "rgba(30,33,31,0.62)";
        for (let i = 0; i < k; i++) {
          ctx.beginPath();
          ctx.arc(n.x + (i - (k - 1) / 2) * n.rx * 0.62 * Math.cos(n.rot), n.y + (i - (k - 1) / 2) * n.rx * 0.62 * Math.sin(n.rot), Math.max(0.7, Math.min(n.rx, n.ry) * 0.2), 0, TAU);
          ctx.fill();
        }
      });
    });

    // 3D structures
    g.blobs.forEach((b) => {
      if (b.kind === "colony") return;
      const p = smoothPath(b.pts, true);
      if (b.kind === "lumen") {
        ctx.fillStyle = "rgba(226,228,216,0.5)"; ctx.fill(p);
        ctx.strokeStyle = "rgba(30,33,31,0.7)"; ctx.lineWidth = 1.4 * s; ctx.stroke(p);
        return;
      }
      if (b.kind === "mineral") {
        ctx.fillStyle = "rgba(28,25,22,0.8)"; ctx.fill(p);
        return;
      }
      if (b.kind === "loop") {
        ctx.save();
        ctx.shadowColor = "rgba(226,228,214,0.7)"; ctx.shadowBlur = 8 * s;
        ctx.fillStyle = "rgba(214,217,204,0.36)"; ctx.fill(p);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(60,64,62,0.26)"; ctx.lineWidth = 0.8 * s; // radial cells of the neuroepithelium
        for (let a = 0; a < TAU; a += 0.22) { ctx.beginPath(); ctx.moveTo(b.cx + Math.cos(a) * b.r * 0.3, b.cy + Math.sin(a) * b.r * 0.3); ctx.lineTo(b.cx + Math.cos(a) * b.r * 0.95, b.cy + Math.sin(a) * b.r * 0.95); ctx.stroke(); }
        ctx.fillStyle = "rgba(40,43,41,0.6)"; ctx.fill(smoothPath(shrink(b.pts, 0.24), true));
        ctx.restore();
        return;
      }
      ctx.save();
      ctx.shadowColor = "rgba(252,252,240,0.95)"; ctx.shadowBlur = 12 * s;
      ctx.strokeStyle = "rgba(250,250,238,0.85)"; ctx.lineWidth = 3 * s; ctx.stroke(p);
      ctx.restore();
      const dens = { sphere: [0.82, 0.5], cluster: [0.62, 0.34], nodule: [0.72, 0.46], brain: [0.9, 0.62], retina: [0.84, 0.56], cyst: [0.3, 0.26] }[b.kind] || [0.8, 0.5];
      const gr = ctx.createRadialGradient(b.cx, b.cy, b.r * 0.1, b.cx, b.cy, b.r * 1.25);
      gr.addColorStop(0, `rgba(34,37,36,${dens[0]})`); gr.addColorStop(1, `rgba(60,64,62,${dens[1]})`);
      ctx.fillStyle = gr; ctx.fill(p);
      if (b.kind === "cyst") {
        ctx.save(); ctx.clip(p);
        ctx.strokeStyle = "rgba(48,52,50,0.5)"; ctx.lineWidth = 20 * s; ctx.stroke(p); // epithelial wall
        ctx.strokeStyle = "rgba(34,37,35,0.5)"; ctx.lineWidth = 1 * s; ctx.stroke(smoothPath(b.inner, true));
        ctx.restore();
        ctx.save(); ctx.clip(smoothPath(b.inner, true));
        ctx.fillStyle = "rgba(40,43,41,0.34)";
        for (let i = 0; i < 46; i++) { ctx.beginPath(); ctx.arc(b.cx + rnd.gauss() * b.r * 0.22, b.cy + rnd.gauss() * b.r * 0.2, rnd.range(0.8, 2.6) * s, 0, TAU); ctx.fill(); }
        ctx.restore();
      }
      if (b.kind === "retina") {
        ctx.save(); ctx.clip(p);
        ctx.beginPath(); ctx.arc(b.cx, b.cy, b.r * 0.98, b.a0 - b.span, b.a0 + b.span);
        ctx.strokeStyle = "rgba(236,238,226,0.62)"; ctx.lineWidth = b.r * 0.34; ctx.stroke();
        ctx.strokeStyle = "rgba(60,64,62,0.3)"; ctx.lineWidth = 0.8 * s;
        for (let a = b.a0 - b.span; a < b.a0 + b.span; a += 0.045) {
          ctx.beginPath(); ctx.moveTo(b.cx + Math.cos(a) * b.r * 0.8, b.cy + Math.sin(a) * b.r * 0.8); ctx.lineTo(b.cx + Math.cos(a) * b.r * 1.3, b.cy + Math.sin(a) * b.r * 1.3); ctx.stroke();
        }
        ctx.restore();
      }
      if (b.kind === "cluster" || b.kind === "nodule" || b.kind === "sphere") { // bumpy cell outlines at the rim
        ctx.save(); ctx.clip(p);
        ctx.strokeStyle = "rgba(230,232,220,0.2)"; ctx.lineWidth = 0.8 * s;
        b.pts.forEach((q, i) => { if (i % 2 === 0) { ctx.beginPath(); ctx.arc(q[0] + (b.cx - q[0]) * 0.1, q[1] + (b.cy - q[1]) * 0.1, 5 * s, 0, TAU); ctx.stroke(); } });
        ctx.restore();
      }
      ctx.strokeStyle = "rgba(26,29,27,0.7)"; ctx.lineWidth = 1.1 * s; ctx.stroke(p);
    });

    g.extras.forEach((e) => {
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, TAU);
      if (e.kind === "pigment" || e.kind === "grain") { ctx.fillStyle = e.kind === "grain" ? "rgba(26,24,22,0.8)" : "rgba(36,24,14,0.82)"; ctx.fill(); }
      else if (e.kind === "vacuole") { ctx.fillStyle = "rgba(238,240,228,0.6)"; ctx.fill(); ctx.strokeStyle = "rgba(40,43,41,0.4)"; ctx.lineWidth = 0.6 * s; ctx.stroke(); }
      else if (e.kind === "lipid") {
        const gr = ctx.createRadialGradient(e.x - e.r * 0.25, e.y - e.r * 0.25, e.r * 0.1, e.x, e.y, e.r);
        gr.addColorStop(0, "rgba(255,255,246,0.95)"); gr.addColorStop(0.8, "rgba(226,228,212,0.85)"); gr.addColorStop(1, "rgba(40,43,41,0.75)");
        ctx.fillStyle = gr; ctx.fill();
      }
      else if (e.kind === "bead") { ctx.fillStyle = "rgba(248,248,236,0.85)"; ctx.fill(); ctx.strokeStyle = "rgba(40,43,41,0.5)"; ctx.lineWidth = 0.6 * s; ctx.stroke(); }
      else { ctx.fillStyle = "rgba(40,43,41,0.36)"; ctx.fill(); }
    });

    // optics: uneven illumination, vignette, camera noise
    const vg = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.35, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.3)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
    addNoise(ctx, w, h, 0.1, "overlay");
  }

  function rgba(c, a) { return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
  // is this cell positive for a stain? side "low" marks the cells that have differentiated, "high" the ones that have not
  function positive(c, st) { return st.side === "high" ? c.u > 1 - st.frac : c.u < st.frac; }

  function paintFluor(ctx, g, w, h, s, rnd, stains) {
    ctx.fillStyle = "#020304"; ctx.fillRect(0, 0, w, h);
    const hz = ctx.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.7);
    hz.addColorStop(0, "rgba(20,30,46,0.5)"); hz.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = hz; ctx.fillRect(0, 0, w, h);
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.globalCompositeOperation = "lighter";
    const DAPI = [70, 110, 255];

    // aggregates: a faint body so the structure reads, then walls / rims in the marker colour
    g.blobs.forEach((b) => {
      if (b.kind === "colony" || b.kind === "lumen" || b.kind === "mineral") return;
      const p = smoothPath(b.pts, true);
      ctx.fillStyle = "rgba(30,44,90,0.3)"; ctx.fill(p);
    });

    for (const st of stains) {
      const col = st.color, loc = st.loc;
      g.cells.forEach((c) => {
        if (!positive(c, st)) return;
        const lvl = 0.55 + 0.45 * ((c.u * 7.3) % 1);
        if (loc === "nuclear") return; // drawn with the nuclei below
        if (c.inBlob) {
          ctx.fillStyle = rgba(col, 0.34 * lvl);
          ctx.beginPath(); ctx.arc(c.cx, c.cy, c.r * (loc === "membrane" || loc === "surface" ? 1.25 : 1.5), 0, TAU); ctx.fill();
          return;
        }
        ctx.save();
        if (loc === "membrane" || loc === "surface") {
          ctx.shadowColor = rgba(col, 0.9); ctx.shadowBlur = 4 * s;
          ctx.strokeStyle = rgba(col, 0.85 * lvl); ctx.lineWidth = 1.5 * s; ctx.stroke(c.path);
          ctx.fillStyle = rgba(col, 0.07 * lvl); ctx.fill(c.path);
          ctx.strokeStyle = rgba(col, 0.6 * lvl);
          c.procs.forEach((pr) => strokeProc(ctx, pr, pr.w * 1.1));
        } else if (loc === "cytoskeletal") {
          ctx.shadowColor = rgba(col, 0.8); ctx.shadowBlur = 3 * s;
          ctx.strokeStyle = rgba(col, 0.9 * lvl);
          c.procs.forEach((pr) => strokeProc(ctx, pr, pr.w * 1.5));
          ctx.shadowBlur = 0;
          ctx.fillStyle = rgba(col, 0.16 * lvl); ctx.fill(c.path);
          ctx.clip(c.path);
          const a = c.ang || 0, L = (c.len || c.r * 2.4), ca = Math.cos(a), sa = Math.sin(a);
          if (c.spine) { // striated fibre: cross-bands along the spine
            ctx.strokeStyle = rgba(col, 0.75 * lvl); ctx.lineWidth = 1.5 * s;
            for (let j = 0; j < c.spine.length - 1; j++) {
              const p0 = c.spine[j], p1 = c.spine[j + 1], t = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) + Math.PI / 2;
              for (let f = 0; f < 1; f += 0.14) {
                const x = p0[0] + (p1[0] - p0[0]) * f, y = p0[1] + (p1[1] - p0[1]) * f;
                ctx.beginPath(); ctx.moveTo(x + Math.cos(t) * c.wid, y + Math.sin(t) * c.wid); ctx.lineTo(x - Math.cos(t) * c.wid, y - Math.sin(t) * c.wid); ctx.stroke();
              }
            }
          } else {
            ctx.strokeStyle = rgba(col, 0.6 * lvl); ctx.lineWidth = 0.9 * s;
            if (g.beat) ctx.setLineDash([2.2 * s, 1.8 * s]); // sarcomeres
            const k = Math.max(3, Math.round(c.r / (2.2 * s)));
            for (let i = 0; i < k; i++) {
              const off = ((i + 0.5) / k - 0.5) * c.r * 2.2;
              ctx.beginPath();
              ctx.moveTo(c.cx - ca * L - sa * off, c.cy - sa * L + ca * off);
              ctx.lineTo(c.cx + ca * L - sa * off, c.cy + sa * L + ca * off);
              ctx.stroke();
            }
          }
        } else { // cytoplasmic or secreted: diffuse, brighter near the nucleus; secreted proteins look granular
          const gr = ctx.createRadialGradient(c.cx, c.cy, 0, c.cx, c.cy, Math.max(c.r, (c.len || 0) / 2) * 1.15);
          gr.addColorStop(0, rgba(col, 0.62 * lvl)); gr.addColorStop(1, rgba(col, 0.2 * lvl));
          ctx.fillStyle = gr; ctx.fill(c.path);
          ctx.strokeStyle = rgba(col, 0.55 * lvl);
          c.procs.forEach((pr) => strokeProc(ctx, pr, pr.w * 1.2));
          if (loc === "secreted") {
            ctx.clip(c.path); ctx.fillStyle = rgba(col, 0.85 * lvl);
            const k = Math.round(c.r * 1.4 / s);
            for (let i = 0; i < k; i++) { const a = rnd.range(0, TAU), d = Math.sqrt(rnd()) * c.r * 0.9; ctx.beginPath(); ctx.arc(c.cx + Math.cos(a) * d, c.cy + Math.sin(a) * d, rnd.range(0.5, 1.1) * s, 0, TAU); ctx.fill(); }
          }
        }
        ctx.restore();
      });
    }

    // nuclei: counterstain, plus any nuclear marker
    g.cells.forEach((c) => {
      c.nuclei.forEach((n) => {
        ctx.save();
        ctx.shadowColor = rgba(DAPI, 0.8); ctx.shadowBlur = 3 * s;
        ell(ctx, n); ctx.fillStyle = rgba(DAPI, 0.62); ctx.fill();
        ctx.shadowBlur = 0;
        for (const st of stains) {
          if (st.loc !== "nuclear" || !positive(c, st)) continue;
          const lvl = 0.6 + 0.4 * ((c.u * 5.1) % 1);
          ctx.shadowColor = rgba(st.color, 0.9); ctx.shadowBlur = 4 * s;
          ell(ctx, n); ctx.fillStyle = rgba(st.color, 0.9 * lvl); ctx.fill();
        }
        ctx.restore();
      });
    });
    ctx.globalCompositeOperation = "source-over";
    addNoise(ctx, w, h, 0.1, "screen");
    const vg = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.4, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
  }

  // ---------------------------------------------------------------- public
  const GEOM = new Map();
  function geometry(arch, seed, w, h) {
    const key = arch + "|" + seed + "|" + w + "|" + h;
    if (GEOM.has(key)) return GEOM.get(key);
    const s = w / 640;
    const g = (A[arch] || A.monolayer_dense)(w, h, s, rng(seed));
    if (GEOM.size > 60) GEOM.delete(GEOM.keys().next().value);
    GEOM.set(key, g);
    return g;
  }

  /* Draw into a canvas at its own pixel size. */
  function draw(canvas, o) {
    const w = canvas.width, h = canvas.height, s = w / 640;
    const arch = A[o.archetype] ? o.archetype : "monolayer_dense";
    const seed = typeof o.seed === "number" ? o.seed : hash(String(o.seed || arch));
    const g = geometry(arch, seed, w, h);
    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    if (o.mode === "fluor") paintFluor(ctx, g, w, h, s, rng(seed ^ 0x9e3779b9), o.stains || []);
    else paintPhase(ctx, g, w, h, s, rng(seed ^ 0x9e3779b9));
    ctx.restore();
    return { beats: !!g.beat };
  }

  window.Micro = { draw, archetypes: Object.keys(A), hash };
})();
