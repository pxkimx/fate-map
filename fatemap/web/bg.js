/* Fate Map background: a Waddington landscape seen from above. Valleys branch as they run down the page and
   marbles (cells) roll along them, taking on the colour of the lineage they commit to. Drawn faintly behind
   the page; follows the Light | Dark choice; pauses when the tab is hidden; still when motion is reduced. */
(function () {
  "use strict";
  const cv = document.getElementById("bg");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W = 0, H = 0, valleys = [], marbles = [], raf = 0, last = 0;

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function rgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return [128, 200, 190];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

  // a binary tree of valleys: each node is a segment from (x0,y0) to (x1,y1) with a gentle S-curve
  function build() {
    valleys = [];
    const levels = 4, top = H * 0.06, bottom = H * 1.02;
    const lin = ["--ecto", "--ecto", "--extra", "--meso", "--meso", "--germ", "--endo", "--endo"];
    function grow(x, y, depth, lo, hi, parent) {
      const y1 = top + (bottom - top) * ((depth + 1) / levels);
      const x1 = (lo + hi) / 2;
      const v = { x0: x, y0: y, x1, y1, kids: [], depth, parent, lo, hi };
      valleys.push(v);
      if (depth + 1 < levels) {
        const mid = (lo + hi) / 2;
        v.kids.push(grow(x1, y1, depth + 1, lo, mid, v));
        v.kids.push(grow(x1, y1, depth + 1, mid, hi, v));
      } else {
        v.leaf = Math.min(7, Math.floor(((lo + hi) / 2 / W) * 8));
        v.color = lin[v.leaf];
      }
      return v;
    }
    grow(W / 2, top - H * 0.1, 0, W * 0.02, W * 0.98, null);
    valleys.forEach((v) => { if (!v.color) { let k = v; while (k.kids.length) k = k.kids[0]; v.colorA = k.color; k = v; while (k.kids.length) k = k.kids[1]; v.colorB = k.color; } });
  }
  function at(v, t) { // point on the valley floor
    const e = t * t * (3 - 2 * t);
    return [v.x0 + (v.x1 - v.x0) * e, v.y0 + (v.y1 - v.y0) * t];
  }

  function spawn(first) {
    return { v: valleys[0], t: first ? Math.random() : 0, speed: 0.045 + Math.random() * 0.05, hue: 0, r: 2.2 + Math.random() * 2.2, trail: [] };
  }
  function leafColor(m) { let k = m.v; while (k.kids.length) k = k.kids[m.path ? m.path[k.depth] : 0]; return k.color; }

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
    marbles = [];
    const n = Math.max(8, Math.min(22, Math.round(W / 80)));
    for (let i = 0; i < n; i++) {
      const m = spawn(true);
      m.path = [0, 1, 2, 3].map(() => (Math.random() < 0.5 ? 0 : 1));
      // start part-way down
      let hops = Math.floor(Math.random() * 4);
      while (hops-- > 0 && m.v.kids.length) m.v = m.v.kids[m.path[m.v.depth]];
      marbles.push(m);
    }
    frame(performance.now(), true);
  }

  function frame(now, once) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    const light = document.documentElement.getAttribute("data-theme") === "light";
    ctx.clearRect(0, 0, W, H);

    // valley walls: a few offset contour lines either side of each floor
    const lineCol = light ? "rgba(40,70,80," : "rgba(150,225,215,";
    ctx.lineCap = "round";
    valleys.forEach((v) => {
      const spread = (v.hi - v.lo) * 0.22;
      for (let k = -3; k <= 3; k++) {
        if (k === 0) continue;
        ctx.beginPath();
        for (let i = 0; i <= 24; i++) {
          const t = i / 24, p = at(v, t);
          const off = k * spread * (0.16 + 0.1 * Math.abs(k)) * (0.55 + 0.45 * t);
          if (i === 0) ctx.moveTo(p[0] + off, p[1]); else ctx.lineTo(p[0] + off, p[1]);
        }
        ctx.strokeStyle = lineCol + (light ? 0.05 : 0.06) / Math.abs(k) * 1.6 + ")";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) { const p = at(v, i / 24); if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); }
      ctx.strokeStyle = lineCol + (light ? 0.1 : 0.13) + ")";
      ctx.lineWidth = 1.4;
      ctx.stroke();
    });

    const white = light ? [70, 90, 100] : [234, 255, 251];
    marbles.forEach((m) => {
      if (!still && !once) {
        m.t += m.speed * dt * (1 + m.v.depth * 0.25);
        if (m.t >= 1) {
          if (m.v.kids.length) { m.v = m.v.kids[m.path[m.v.depth]]; m.t = 0; }
          else { Object.assign(m, spawn(false)); m.path = [0, 1, 2, 3].map(() => (Math.random() < 0.5 ? 0 : 1)); }
        }
      }
      const p = at(m.v, m.t);
      const commit = Math.min(1, (m.v.depth + m.t) / 3.2);
      const c = mix(white, rgb(css(leafColor(m))), commit);
      m.trail.push(p);
      if (m.trail.length > 16) m.trail.shift();
      for (let i = 1; i < m.trail.length; i++) {
        const a = m.trail[i - 1], b = m.trail[i];
        if (Math.abs(b[1] - a[1]) > 40) continue;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
        ctx.strokeStyle = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${(i / m.trail.length) * (light ? 0.3 : 0.34)})`;
        ctx.lineWidth = m.r * 0.9; ctx.stroke();
      }
      const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], m.r * 4);
      g.addColorStop(0, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${light ? 0.55 : 0.75})`);
      g.addColorStop(0.3, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${light ? 0.2 : 0.28})`);
      g.addColorStop(1, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p[0], p[1], m.r * 4, 0, Math.PI * 2); ctx.fill();
    });
    if (!still && !once && !document.hidden) raf = requestAnimationFrame(frame);
  }

  function start() { cancelAnimationFrame(raf); last = performance.now(); if (!still) raf = requestAnimationFrame(frame); else frame(last, true); }
  window.addEventListener("resize", () => { resize(); start(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) start(); });
  window.FateBg = { redraw: () => frame(performance.now(), true) };
  resize();
  start();
})();
