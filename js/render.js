/* ============================================================================
   RENDERER  - draws a scheduled model as a self-contained SVG.
   ----------------------------------------------------------------------------
   All styling is written as attributes (not CSS classes) so the SVG can be
   serialized and exported to PNG/SVG without losing its look.
   The renderer never reads application state; everything arrives in `opts`.
   ========================================================================== */
VSM.render = (function () {
  const NS = "http://www.w3.org/2000/svg";
  const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';
  const MONO = '"SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
  const THEMES = {
    dark: {
      bg: "#0B1220", band: "rgba(255,255,255,0.035)", grid: "#1E293B", gridStrong: "#334155",
      text: "#E2E8F0", text2: "#94A3B8", muted: "#64748B", dimText: "#4B5563",
      link: "rgba(148,163,184,0.28)", critical: "#F8FAFC",
      panel: "#111A2E", panelLine: "#1E293B", chip: "#1E293B", chipLine: "#334155", accent: "#FCD34D",
      badgeBg: "#0B1220", badgeText: "#F8FAFC", excessFill: 0.28, excessFillStrong: 0.5, hatchOnOptimal: false
    },
    light: {
      bg: "#FFFFFF", band: "rgba(15,23,42,0.04)", grid: "#E2E8F0", gridStrong: "#CBD5E1",
      text: "#0F172A", text2: "#475569", muted: "#64748B", dimText: "#94A3B8",
      link: "rgba(71,85,105,0.32)", critical: "#0F172A",
      panel: "#F1F5F9", panelLine: "#E2E8F0", chip: "#F1F5F9", chipLine: "#CBD5E1", accent: "#B45309",
      badgeBg: "#0F172A", badgeText: "#FFFFFF", excessFill: 0.35, excessFillStrong: 0.55, hatchOnOptimal: true
    }
  };
  const THEME = THEMES.dark;

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) { if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]); }
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(parent, x, y, str, attrs) {
    const t = el("text", Object.assign({ x, y }, attrs), parent);
    t.textContent = clip(str);
    return t;
  }
  let renderSeq = 0;
  let ctx = null;
  /* Labels come out of an imported file and have no length limit there. Nothing
     wider than the chart can be read anyway, so clip once, here, rather than
     measuring megabytes of text for every row on every render. */
  const MAX_LABEL = 512;
  const clip = s => { s = String(s === null || s === undefined ? "" : s); return s.length > MAX_LABEL ? s.slice(0, MAX_LABEL) : s; };
  function measure(str, size, weight) {
    if (!ctx) ctx = document.createElement("canvas").getContext("2d");
    ctx.font = (weight || 400) + " " + size + "px " + FONT;
    return ctx.measureText(clip(str)).width;
  }
  /* Binary search rather than one character at a time: the old loop measured
     the string once per character dropped, which is quadratic in the label. */
  function truncate(str, size, maxW, weight) {
    str = clip(str);
    if (measure(str, size, weight) <= maxW) return str;
    let lo = 0, hi = str.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (measure(str.slice(0, mid) + "…", size, weight) <= maxW) lo = mid; else hi = mid - 1;
    }
    return lo > 1 ? str.slice(0, lo) + "…" : "";
  }
  const fmt = v => { const r = Math.round(v * 10) / 10; return Number.isInteger(r) ? String(r) : r.toFixed(1); };
  const pct = v => Math.round(v * 100) + "%";

  /* ---------------------------------------------------------------- filters */
  function rowMatches(n, filters) {
    if (!filters) return true;
    if (filters.wasteTypes && filters.wasteTypes.size) {
      const key = n.waste || "none";
      /* A derived type (handoff) is a structural fact rather than a tag, so an
         activity can match it as well as its own waste type. Isolating
         handoffs therefore shows every row that receives one, whatever else
         it is classified as. */
      const derivedHit = n.derivedWaste && n.derivedWaste.some(id => filters.wasteTypes.has(id));
      if (!filters.wasteTypes.has(key) && !derivedHit) return false;
    }
    if (filters.owners && filters.owners.size && !filters.owners.has(n.owner)) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const hay = (n.name + " " + (n.act.description || "") + " " + n.team.label + " " + (n.waste || "") + " " + n.id).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  /* ---------------------------------------------------------------- main */
  function draw(model, opts) {
    const L = opts.layout, view = opts.view || "current", disp = opts.display || {};
    const T = Object.assign({}, THEMES[opts.theme] || THEMES.dark);
    const isOptimalView = view === "optimal";
    const filterActive = !!(opts.filters && ((opts.filters.wasteTypes && opts.filters.wasteTypes.size) || (opts.filters.owners && opts.filters.owners.size) || opts.filters.search));

    let rows = model.nodes.slice();
    rows.forEach(n => { n.match = rowMatches(n, opts.filters); });
    if (disp.hideNonMatching && filterActive) rows = rows.filter(n => n.match);
    /* A fixed-height slide can only hold so many readable rows. Rather than
       shrink the type until it is unreadable, or let rows run off the bottom
       over the legend, cut the list and say so on the slide itself - a
       truncated chart that does not admit it is a chart that lies. */
    let hiddenRows = 0;
    if (L.maxRows && rows.length > L.maxRows) {
      // give the notice its own space rather than letting it land on the legend
      const reserve = Math.max(1, Math.ceil(18 / Math.max(L.rowH, 1)));
      const cap = Math.max(1, L.maxRows - reserve);
      hiddenRows = rows.length - cap;
      rows = rows.slice(0, cap);
    }
    rows.forEach(n => {
      n.dim = (filterActive && !n.match) || (view === "waste" && !n.waste && !n.isGate);
    });
    const rowIndex = new Map(rows.map((n, i) => [n.id, i]));

    const totalDays = Math.max(isOptimalView ? model.metrics.optimalElapsed : model.metrics.currentElapsed, 1);
    const phaseGutter = disp.phases !== false ? 18 : 0;
    /* fullLeft/fullRight = the whole row band. chartLeft/chartRight = the plot area,
       inset by the owner column on the left and the duration column on the right. */
    const fullLeft = L.chartLeft, fullRight = L.chartRight;
    const numX = fullLeft + phaseGutter;
    const ownerX = numX + L.numW;
    const chartLeft = ownerX + L.ownerW;
    const chartRight = fullRight - L.durW;
    const pxPerDay = (chartRight - chartLeft) / totalDays;
    const X = d => chartLeft + d * pxPerDay;
    const yc = i => L.chartTop + i * L.rowH + L.rowH / 2;

    const svg = el("svg", {
      xmlns: NS, viewBox: "0 0 " + L.width + " " + L.height, width: L.width, height: L.height,
      "font-family": FONT, "data-mode": L.mode
    });
    svg.style.fontFamily = FONT;
    svg.style.display = "block";

    /* defs: hatch patterns per family.
       Several SVGs live in the page at once (interactive + presentation + export), so ids are
       namespaced per render. Otherwise a url(#...) reference can resolve into a hidden sibling. */
    const uid = "vsm" + (++renderSeq);
    const hatch = f => "url(#" + uid + "-h-" + f + ")";
    const defs = el("defs", null, svg);
    Object.keys(model.taxonomy.families || {}).forEach(f => {
      const fam = model.taxonomy.families[f];
      const p = el("pattern", { id: uid + "-h-" + f, width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
      el("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: T.hatchOnOptimal ? fam.optimal : fam.excess, "stroke-width": T.hatchOnOptimal ? 1.2 : 1.6, "stroke-opacity": T.hatchOnOptimal ? 0.75 : 1 }, p);
    });
    const pGrey = el("pattern", { id: uid + "-h-neutral", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
    el("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: T.hatchOnOptimal ? "#475569" : "#94A3B8", "stroke-width": 1.6 }, pGrey);

    el("rect", { x: 0, y: 0, width: L.width, height: L.height, fill: T.bg }, svg);

    const g = el("g", { class: "vsm-chart" }, svg);

    /* ---- phase bands ---- */
    if (disp.phases !== false && rows.length) {
      const phases = model.process.phases || [];
      let runStart = 0;
      for (let i = 1; i <= rows.length; i++) {
        if (i === rows.length || rows[i].act.phase !== rows[runStart].act.phase) {
          const top = L.chartTop + runStart * L.rowH, h = (i - runStart) * L.rowH;
          const runIdx = (phases.findIndex(p => p.id === rows[runStart].act.phase) + phases.length) % Math.max(phases.length, 1);
          if (runIdx % 2 === 1) el("rect", { x: fullLeft, y: top, width: fullRight - fullLeft, height: h, fill: T.band }, g);
          el("line", { x1: fullLeft, y1: top, x2: fullRight, y2: top, stroke: T.gridStrong, "stroke-width": 0.8 }, g);
          const ph = phases.find(x => x.id === rows[runStart].act.phase) || {};
          let label = (ph.label || rows[runStart].act.phase || "").toUpperCase();
          let tw = measure(label, L.phaseFont, 600) + 2;
          if (tw > h - 4 && ph.short) { label = ph.short.toUpperCase(); tw = measure(label, L.phaseFont, 600) + 2; }
          if (tw <= h - 4) {
            const cx = fullLeft + 9, cy = top + h / 2;
            text(g, cx, cy, label, { fill: T.muted, "font-size": L.phaseFont, "font-weight": 600, "letter-spacing": 1.2, "text-anchor": "middle", "dominant-baseline": "middle", transform: "rotate(-90 " + cx + " " + cy + ")" });
          }
          runStart = i;
        }
      }
      el("line", { x1: fullLeft, y1: L.chartTop + rows.length * L.rowH, x2: fullRight, y2: L.chartTop + rows.length * L.rowH, stroke: T.gridStrong, "stroke-width": 0.8 }, g);
    }

    /* ---- time axis ---- */
    const chartBottom = L.chartTop + rows.length * L.rowH;
    /* The axis is drawn in whatever unit the data is in. See js/units.js - the
       shipped data is in business days, the source workbook is in hours, and
       labelling one as the other would be wrong by a factor of eight. */
    const U = (VSM.units && VSM.units.resolve(model.process, { fmt })) ||
      { tickSize: 5, tickLabel: i => "Wk " + i, originLabel: "Day 0", endLabel: t => "Day " + fmt(t), abbr: "d", many: "days", secondary: null };
    const tickPx = U.tickSize * pxPerDay;
    /* thin the labels out until they stop colliding, then thin the gridlines
       themselves once even those would be closer than three pixels */
    const labelEvery = tickPx >= 60 ? 1 : tickPx >= 32 ? 2 : tickPx >= 16 ? 4 : tickPx >= 8 ? 8 : tickPx >= 4 ? 20 : 50;
    const ticks = Math.max(0, Math.ceil(totalDays / U.tickSize));
    /* The thinning factor is taken from the PIXEL budget, not from tickPx:
       at extreme totals tickPx underflows and a factor derived from it stops
       keeping up, which is how 1e18 still hung after the first attempt at
       this. At three pixels a gridline, a 1200px plot never needs more than
       ~400 of them however long the timeline claims to be. */
    const gridBudget = Math.max(1, (chartRight - chartLeft) / 3);
    const lineEvery = tickPx >= 3 ? 1 : Math.max(1, Math.ceil(ticks / gridBudget));
    /* STEP BY lineEvery, never by 1. Nothing validates an upper bound on a
       duration, so a single cell reading 1e12 used to make this loop run once
       per tick across the whole timeline - hundreds of billions of iterations
       to draw the same few hundred gridlines, on every rebuild. Stepping by the
       thinning factor bounds the work by the width of the plot in pixels
       instead of by the number on the clock. Labels move onto a multiple of
       that step so every label still sits on a gridline. */
    const labelStep = Math.ceil(Math.max(labelEvery, 1) / lineEvery) * lineEvery;
    const axisBase = L.chartTop - 6;
    const originW = measure(U.originLabel, L.axisFont);
    for (let w = 0; w <= ticks; w += lineEvery) {
      const x = X(w * U.tickSize);
      if (x > chartRight + 0.5) break;
      const major = w % labelStep === 0;
      el("line", { x1: x, y1: L.chartTop, x2: x, y2: chartBottom, stroke: major ? T.gridStrong : T.grid, "stroke-width": major ? 0.8 : 0.5, "stroke-dasharray": major ? null : "2 3" }, g);
      /* the first tick label must clear the origin label, whose width depends
         on the unit ("Hour 0" is wider than "Day 0") - so measure it */
      const tickW = measure(U.tickLabel(w), L.axisFont) / 2;
      if (major && w > 0 && x - tickW > chartLeft + originW + 10 && chartRight - x > 30) {
        text(g, x, axisBase, U.tickLabel(w), { fill: T.text2, "font-size": L.axisFont, "text-anchor": "middle" });
      }
    }
    text(g, chartLeft, axisBase, U.originLabel, { fill: T.text2, "font-size": L.axisFont, "text-anchor": "start" });
    if (L.showColumns) {
      // headers sit on the upper line so they never collide with the week ticks
      const headY = axisBase - L.axisFont - 2;
      text(g, numX, headY, "# OWNER", { fill: T.muted, "font-size": L.colHeadFont, "font-weight": 600, "letter-spacing": 1 });
      text(g, fullRight, headY, "CUR / OPT / REM", { fill: T.muted, "font-size": L.colHeadFont, "font-weight": 600, "letter-spacing": 0.6, "text-anchor": "end" });
      el("line", { x1: chartLeft - 8, y1: L.chartTop - 2, x2: chartLeft - 8, y2: chartBottom, stroke: T.grid, "stroke-width": 0.7 }, g);
      el("line", { x1: chartRight + 8, y1: L.chartTop - 2, x2: chartRight + 8, y2: chartBottom, stroke: T.grid, "stroke-width": 0.7 }, g);
    }
    const endLabel = U.endLabel(totalDays) + (U.secondary && !L.showColumns ? "  ·  " + U.secondary(totalDays) : "");
    text(g, chartRight, axisBase - L.axisFont - 2, endLabel, { fill: T.text, "font-size": L.axisFont, "font-weight": 600, "text-anchor": "end" });
    el("line", { x1: chartRight, y1: L.chartTop, x2: chartRight, y2: chartBottom, stroke: T.text2, "stroke-width": 1, "stroke-dasharray": "4 3" }, g);
    el("line", { x1: fullLeft, y1: L.chartTop - 2, x2: fullRight, y2: L.chartTop - 2, stroke: T.gridStrong, "stroke-width": 1 }, g);

    /* ---- geometry per row ---- */
    rows.forEach((n, i) => {
      const s = isOptimalView ? n.opt : n.cur;
      const wOpt = n.duration.optimal * pxPerDay;
      const wExc = isOptimalView ? 0 : n.duration.excess * pxPerDay;
      n.geo = { x: X(s.start), wOpt, wExc, x2: X(s.start) + wOpt + wExc, y: yc(i), row: i };
    });

    /* ---- dependency links ---- */
    const linkMode = disp.links || "all";
    if (linkMode !== "none") {
      const handoffColor = ((model.taxonomy.families || {}).handoff || {}).optimal || "#A855F7";
      model.links.forEach(lk => {
        if (linkMode === "handoffs" && !lk.handoff) return;
        const a = model.nodeById.get(lk.from), b = model.nodeById.get(lk.to);
        if (!rowIndex.has(a.id) || !rowIndex.has(b.id)) return;
        const x1 = a.geo.x2, y1 = a.geo.y, x2 = b.geo.x, y2 = b.geo.y;
        const dx = x2 - x1;
        const mid = x1 + Math.max(4, Math.min(10, dx / 2));
        const d = "M" + x1 + " " + y1 + " H" + mid + " V" + y2 + " H" + x2;
        const dim = a.dim && b.dim;
        el("path", {
          d, fill: "none",
          stroke: lk.handoff ? handoffColor : T.link,
          "stroke-opacity": lk.handoff ? (dim ? 0.25 : 0.7) : (dim ? 0.4 : 1),
          "stroke-width": lk.handoff ? L.linkW + 0.3 : L.linkW
        }, g);
      });
    }

    /* ---- rows: bars, markers, badges, labels ---- */
    const handoffFam = (model.taxonomy.families || {}).handoff || { optimal: "#A855F7" };
    const markerLayer = el("g", { class: "vsm-markers" });   // rings stay fully visible in the waste view
    /* Project tracking, once anyone has recorded a status: a colored tick at
       the left of the plot and finished work stepped back, so the timeline
       shows where the project IS without a separate view. Tracking never
       moves a bar - the glyphs are the only change. */
    const trackingOn = !!(VSM.progress && model.nodes.some(x => x.act && x.act.status !== undefined));
    const STATUS_TICK = { done: "#22C55E", doing: "#3B82F6", blocked: "#EF4444", skipped: "#64748B" };
    rows.forEach(n => {
      const G = n.geo, fam = n.familyDef, barH = L.barH, top = G.y - barH / 2;
      const st = trackingOn ? VSM.progress.statusOf(n.act) : null;
      const statusDim = st && st.explicit ? (st.id === "done" ? 0.55 : st.id === "skipped" ? 0.35 : 1) : 1;
      const kindLabel = n.wasteDef ? n.wasteDef.label : (n.categoryDef.label || n.category);
      const rowG = el("g", {
        class: "vsm-row", "data-id": n.id, opacity: n.dim ? 0.3 : statusDim,
        tabindex: L.mode === "interactive" ? 0 : null,
        role: L.mode === "interactive" ? "button" : null,
        "aria-label": n.name + ". " + n.team.label + ". " + kindLabel + ". "
          + fmt(n.duration.current) + " " + U.many + " current, " + fmt(n.duration.optimal) + " necessary, "
          + fmt(n.duration.excess) + " removable."
          + (n.hasHandoff ? " Receives " + n.handoffsIn.length + " handoff" + (n.handoffsIn.length === 1 ? "" : "s") + "." : "")
      }, g);
      // native tooltip: survives into the exported SVG, and covers labels shortened with an ellipsis
      const tipLines = [n.name, n.team.label + " · " + kindLabel,
        "Current " + fmt(n.duration.current) + " · necessary " + fmt(n.duration.optimal) + " · removable " + fmt(n.duration.excess),
        n.act.description || ""].filter(Boolean);
      el("title", null, rowG).textContent = tipLines.join("\n");
      // hit area (removed on export)
      el("rect", { class: "vsm-hit", x: fullLeft, y: G.y - L.rowH / 2, width: fullRight - fullLeft, height: L.rowH, fill: "transparent" }, rowG);

      const gap = L.gap, rx = Math.min(3, barH / 3);
      const neutralOpt = view === "opportunity";
      const excessFillOpacity = view === "current" ? T.excessFill : T.excessFillStrong;
      const excessStroke = T.hatchOnOptimal ? fam.optimal : fam.excess;
      const isPureMilestone = n.isMilestone || (n.isGate && n.duration.current === 0);

      if (isOptimalView && n.duration.optimal === 0 && !isPureMilestone) {
        // activity fully removed in the optimal process
        el("circle", { cx: G.x, cy: G.y, r: Math.max(2.5, L.marker * 0.8), fill: "none", stroke: T.muted, "stroke-width": 1, "stroke-dasharray": "2 2" }, rowG);
      }

      // optimal / necessary segment
      let optW = G.wOpt;
      if (optW > 0 && G.wExc > 0) optW = Math.max(optW - gap, 1);
      if (G.wOpt > 0 && !isPureMilestone) {
        const w = Math.max(optW, 2);
        el("rect", { x: G.x, y: top, width: w, height: barH, rx, fill: neutralOpt ? (T.hatchOnOptimal ? "#94A3B8" : "#475569") : fam.optimal, "fill-opacity": neutralOpt ? 0.8 : 1 }, rowG);
      }
      // excess / removable segment
      if (G.wExc > 0) {
        const ex = G.x + G.wOpt + (G.wOpt > 0 ? gap : 0), ew = Math.max(G.wExc - (G.wOpt > 0 ? gap : 0), 2);
        el("rect", { x: ex, y: top, width: ew, height: barH, rx, fill: fam.excess, "fill-opacity": excessFillOpacity }, rowG);
        el("rect", { x: ex, y: top, width: ew, height: barH, rx, fill: hatch(n.family), "fill-opacity": 0.9 }, rowG);
        el("rect", { x: ex + 0.5, y: top + 0.5, width: ew - 1, height: barH - 1, rx, fill: "none", stroke: excessStroke, "stroke-width": view === "current" ? 0.8 : 1.2, "stroke-opacity": T.hatchOnOptimal ? 0.7 : 0.9 }, rowG);
      }
      if (G.wOpt === 0 && G.wExc === 0 && !isPureMilestone && !isOptimalView) {
        el("rect", { x: G.x, y: top, width: 2, height: barH, fill: fam.optimal }, rowG);
      }

      // gate diamond at the decision point (end of the gate bar), or milestone
      if (n.isGate) {
        const d = L.diamond, cx = isPureMilestone ? G.x : G.x2, cy = G.y;
        const pts = cx + "," + (cy - d) + " " + (cx + d) + "," + cy + " " + cx + "," + (cy + d) + " " + (cx - d) + "," + cy;
        el("polygon", { points: pts, fill: T.bg, stroke: T.bg, "stroke-width": 3 }, rowG);
        el("polygon", { points: pts, fill: isPureMilestone ? T.bg : fam.optimal, stroke: fam.optimal, "stroke-width": 1.5 }, rowG);
      }

      // handoff ring at the receiving edge
      if (n.hasHandoff) {
        const r = L.marker, host = (view === "waste" && n.dim && n.match) ? markerLayer : rowG;
        const cx = isPureMilestone ? G.x - L.diamond - r - 1 : G.x;   // keep the milestone diamond visible
        el("circle", { cx, cy: G.y, r: r + 1.5, fill: T.bg }, host);
        el("circle", { cx, cy: G.y, r, fill: T.bg, stroke: handoffFam.optimal, "stroke-width": 1.6 }, host);
        if (n.crossOrg) el("circle", { cx, cy: G.y, r: Math.max(1.2, r * 0.45), fill: handoffFam.optimal }, host);
        // several handoffs converging on one row: show the count rather than stacking rings
        if (n.handoffsIn.length > 1 && r >= 3.2) {
          const cf = Math.max(6, r * 1.5);
          text(host, cx - r - 2, G.y + cf * 0.35, String(n.handoffsIn.length),
            { fill: handoffFam.optimal, "font-size": cf, "font-weight": 700, "text-anchor": "end", "paint-order": "stroke", stroke: T.bg, "stroke-width": 2.5, "stroke-linejoin": "round" });
        }
      }

      // badge with the taxonomy code (never rely on color alone)
      const barW = G.x2 - G.x;
      if (n.code && barH >= 8 && !isPureMilestone) {
        const bf = L.badgeFont, bw = measure(n.code, bf, 700) + 5;
        const off = (n.hasHandoff ? L.marker + 3 : 3);
        if (barW >= off + bw + (n.isGate ? L.diamond + 2 : 2)) {
          const bx = G.x + off, bh = Math.min(barH - 2, bf + 3);
          el("rect", { x: bx, y: G.y - bh / 2, width: bw, height: bh, rx: 2, fill: T.badgeBg, "fill-opacity": 0.6 }, rowG);
          text(rowG, bx + bw / 2, G.y + 0.5, n.code, { fill: T.badgeText, "font-size": bf, "font-weight": 700, "text-anchor": "middle", "dominant-baseline": "middle", "letter-spacing": 0.3 });
        }
      }

      // critical path tick
      if (disp.critical && n.critical && !isOptimalView) {
        el("line", { x1: G.x, y1: top + barH + 1.5, x2: G.x2, y2: top + barH + 1.5, stroke: T.critical, "stroke-width": 1, "stroke-opacity": 0.8 }, rowG);
      }

      // status tick in the gutter between the owner column and the plot
      if (st && st.explicit) {
        el("rect", { x: chartLeft - 6, y: top, width: 3, height: barH, rx: 1.5, fill: STATUS_TICK[st.id] || "#64748B" }, rowG);
        if (st.id === "doing" && st.fraction > 0) {
          // the finished share of a doing bar, drawn as a thin underline
          el("line", { x1: G.x, y1: top + barH + 1.5, x2: G.x + (G.x2 - G.x) * st.fraction, y2: top + barH + 1.5, stroke: STATUS_TICK.doing, "stroke-width": 2, "stroke-linecap": "round" }, rowG);
        }
      }

      // label with intelligent placement
      const size = L.font, weight = n.dim ? 400 : 500;
      const lw = measure(n.name, size, weight);
      const countW = n.hasHandoff && n.handoffsIn.length > 1 && L.marker >= 3.2
        ? measure(String(n.handoffsIn.length), Math.max(6, L.marker * 1.5), 700) + 4 : 0;
      const leftPad = 7 + (n.hasHandoff ? 2 * L.marker + 1 + countW : 0) + (isPureMilestone ? L.diamond : 0);
      const rightPad = 7 + (n.isGate && !isPureMilestone ? L.diamond + 1 : 0) + (isPureMilestone ? L.diamond : 0);
      const fill = n.dim ? T.dimText : T.text;
      let lx, anchor, str = n.name, inside = false;
      if (G.x - leftPad - lw >= chartLeft - 4) { lx = G.x - leftPad; anchor = "end"; }
      else if (G.x2 + rightPad + lw <= chartRight + 4) { lx = G.x2 + rightPad; anchor = "start"; }
      else if (barW >= lw + 14 && barH >= size + 2) { lx = G.x + (n.hasHandoff ? L.marker + 4 : 7); anchor = "start"; inside = true; }
      else {
        const spaceR = chartRight + 4 - (G.x2 + rightPad), spaceL = (G.x - leftPad) - (chartLeft - 4);
        if (spaceR >= spaceL) { lx = G.x2 + rightPad; anchor = "start"; str = truncate(n.name, size, spaceR, weight); }
        else { lx = G.x - leftPad; anchor = "end"; str = truncate(n.name, size, spaceL, weight); }
      }
      if (str) text(rowG, lx, G.y + 0.5, str, {
        fill: inside ? "#FFFFFF" : fill, "font-size": size, "font-weight": weight,
        "text-anchor": anchor, "dominant-baseline": "middle",
        "paint-order": "stroke", stroke: T.bg, "stroke-width": inside ? 0 : 2.5, "stroke-linejoin": "round"
      });

      /* ---- side columns: row number + owner on the left, durations on the right ---- */
      if (L.showColumns) {
        const cf = L.colFont, colFill = n.dim ? T.dimText : T.text2;
        if (L.numW) {
          text(rowG, numX, G.y + 0.5, String(G.row + 1).padStart(2, "0"),
            { fill: n.dim ? T.dimText : T.muted, "font-size": Math.min(cf, 9.5), "font-family": MONO, "dominant-baseline": "middle" });
        }
        // the full label if it fits, otherwise the team's short name, otherwise an ellipsis
        let ownerName = n.team.label;
        if (measure(ownerName, cf) > L.ownerW - 6 && n.team.short) ownerName = n.team.short;
        const ownerText = truncate(ownerName, cf, L.ownerW - 6);
        if (ownerText) text(rowG, ownerX, G.y + 0.5, ownerText, { fill: colFill, "font-size": cf, "dominant-baseline": "middle" });
        // exact values, so a bar too small to read still reports its numbers
        const dur = fmt(n.duration.current) + " / " + fmt(n.duration.optimal) + " / " + fmt(n.duration.excess);
        text(rowG, fullRight, G.y + 0.5, dur, {
          fill: n.duration.excess > 0 && !n.dim ? T.text : colFill, "font-size": cf, "font-family": MONO,
          "text-anchor": "end", "dominant-baseline": "middle"
        });
      }
    });

    g.appendChild(markerLayer);

    if (hiddenRows) {
      const note = hiddenRows + " more row" + (hiddenRows === 1 ? "" : "s") + " not shown — "
        + (model.nodes.length) + " in total. Roll up by phase or team for a slide-sized view.";
      text(g, chartLeft, chartBottom + 14, note,
        { fill: T.accent, "font-size": Math.max(L.axisFont, 11), "font-weight": 600 });
    }

    /* ---- presentation chrome: header, metrics, legend ---- */
    if (L.showHeader) drawHeader(svg, model, opts, L, T);
    if (L.showMetrics) drawMetrics(svg, model, opts, L, T);
    if (L.showLegend) drawLegend(svg, model, rows, opts, L, T, hatch);

    return svg;
  }

  function viewLabel(v) {
    return { current: "Current process", optimal: "Optimized process", opportunity: "Opportunity view", waste: "Waste / friction view" }[v] || v;
  }

  function drawHeader(svg, model, opts, L, T) {
    const y = L.margin;
    text(svg, L.margin, y + 28, opts.title || model.process.title || "Value Stream", { fill: T.text, "font-size": L.titleFont, "font-weight": 600 });
    const meta = [model.process.units ? "Durations in " + model.process.units : null, model.process.version ? "Data " + model.process.version : null].filter(Boolean).join("  ·  ");
    const metaW = meta ? measure(meta, 12) + 40 : 0;
    const subW = L.width - 2 * L.margin - metaW;
    let sub = [model.process.subtitle, opts.scenarioSummary].filter(Boolean).join("   ·   ");
    if (measure(sub, L.subtitleFont) > subW && opts.scenarioSummary) sub = opts.scenarioSummary;
    sub = truncate(sub, L.subtitleFont, subW);
    text(svg, L.margin, y + 56, sub, { fill: T.text2, "font-size": L.subtitleFont });
    const chip = viewLabel(opts.view);
    const cw = measure(chip, 13, 600) + 22;
    el("rect", { x: L.width - L.margin - cw, y: y + 6, width: cw, height: 28, rx: 14, fill: T.chip, stroke: T.chipLine }, svg);
    text(svg, L.width - L.margin - cw / 2, y + 20.5, chip, { fill: T.text, "font-size": 13, "font-weight": 600, "text-anchor": "middle", "dominant-baseline": "middle" });
    if (meta) text(svg, L.width - L.margin, y + 56, meta, { fill: T.muted, "font-size": 12, "text-anchor": "end" });
  }

  function drawMetrics(svg, model, opts, L, T) {
    const m = model.metrics;
    const U = (VSM.units && VSM.units.resolve(model.process, { fmt })) || { abbr: "d", many: "days", secondary: null };
    const u = " " + U.abbr;
    const also = v => U.secondary ? " (" + U.secondary(v) + ")" : "";
    const tiles = [
      { label: "Current elapsed", value: fmt(m.currentElapsed) + u, sub: "end-to-end today" + also(m.currentElapsed) },
      { label: "Optimal elapsed", value: fmt(m.optimalElapsed) + u, sub: "if every step ran at its minimum" + also(m.optimalElapsed) },
      { label: "Removable elapsed", value: fmt(m.removableElapsed) + u, sub: pct(m.removablePct) + " of the current path", accent: true },
      { label: "Excess inside activities", value: fmt(m.sumExcess) + u, sub: "of " + fmt(m.sumCurrent) + " activity-" + U.many + " (" + pct(m.sumCurrent ? m.sumExcess / m.sumCurrent : 0) + ")" },
      { label: "Handoffs", value: String(m.handoffs), sub: m.crossOrgHandoffs + " cross-org · " + m.orgBoundaries + " org boundaries" },
      { label: "Approval gates", value: String(m.gates), sub: m.milestones + " milestone" + (m.milestones === 1 ? "" : "s") },
      { label: "Waiting time", value: fmt(m.waitingCurrent) + u, sub: fmt(m.waitingExcess) + u + " removable" }
    ];
    const top = L.margin + L.headerH, h = L.metricsH - 10, w = (L.width - 2 * L.margin) / tiles.length;
    el("rect", { x: L.margin, y: top, width: L.width - 2 * L.margin, height: h, rx: 8, fill: T.panel, stroke: T.panelLine }, svg);
    tiles.forEach((t, i) => {
      const x = L.margin + i * w + 18;
      if (i > 0) el("line", { x1: L.margin + i * w, y1: top + 10, x2: L.margin + i * w, y2: top + h - 10, stroke: T.panelLine }, svg);
      text(svg, x, top + 17, t.label.toUpperCase(), { fill: T.muted, "font-size": L.metricLabelFont, "font-weight": 600, "letter-spacing": 0.8 });
      text(svg, x, top + 43, t.value, { fill: t.accent ? T.accent : T.text, "font-size": L.metricFont, "font-weight": 600 });
      text(svg, x, top + 58, t.sub, { fill: T.text2, "font-size": 11 });
    });
  }

  function drawLegend(svg, model, rows, opts, L, T, hatch) {
    const fams = model.taxonomy.families || {};
    const used = [];
    rows.forEach(n => { if (!used.includes(n.family)) used.push(n.family); });
    const items = [];
    items.push({ kind: "key" });
    /* A node's family can be the "value" fallback that js/schedule.js assigns
       when an activity has no category, and the taxonomy need not define it.
       schedule.js guards familyDef; this used to read fams[f].optimal straight
       through, so presentation mode and every image export threw. */
    const FALLBACK_FAM = { optimal: "#64748b", excess: "#94a3b8" };
    used.forEach(f => items.push({ kind: "family", id: f, label: (fams[f] || {}).label || f, fam: fams[f] || FALLBACK_FAM }));
    const markers = model.taxonomy.markers || {};
    items.push({ kind: "ring", label: (markers.handoff || {}).label || "Handoff" });
    items.push({ kind: "ring-dot", label: (markers.handoffCrossOrg || {}).label || "Handoff across organizations" });
    items.push({ kind: "diamond", label: (markers.gate || {}).label || "Approval / decision point" });
    items.push({ kind: "diamond-outline", label: (markers.milestone || {}).label || "Milestone" });

    let font = L.legendFont;
    const itemW = (it, f) => it.kind === "key" ? 27 + measure("necessary", f) + 10 + 27 + measure("removable", f) + 30
      : it.kind === "family" ? 31 + measure(it.label, f) + 20 : 18 + measure(it.label, f) + 20;
    const widthOf = f => items.reduce((s, it) => s + itemW(it, f), 0);
    const maxW = L.width - 2 * L.margin;
    while (widthOf(font) > maxW && font > 10.5) font -= 0.5;
    const twoLines = widthOf(font) > maxW;
    if (twoLines) font = Math.min(L.legendFont, 12);
    let x = L.margin, y = L.legendTop + (twoLines ? 2 : 10);
    const lineH = 18;
    const handoffColor = (fams.handoff || {}).optimal || "#A855F7";
    items.forEach(it => {
      if (twoLines && x > L.margin && x + itemW(it, font) > L.width - L.margin) { x = L.margin; y += lineH; }
      if (it.kind === "key") {
        el("rect", { x, y: y - 6, width: 22, height: 12, rx: 2, fill: "#94A3B8" }, svg);
        text(svg, x + 27, y + 0.5, "necessary", { fill: T.text2, "font-size": font, "dominant-baseline": "middle" });
        const x2 = x + 27 + measure("necessary", font) + 10;
        el("rect", { x: x2, y: y - 6, width: 22, height: 12, rx: 2, fill: "#94A3B8", "fill-opacity": 0.28 }, svg);
        el("rect", { x: x2, y: y - 6, width: 22, height: 12, rx: 2, fill: hatch("neutral") }, svg);
        el("rect", { x: x2 + 0.5, y: y - 5.5, width: 21, height: 11, rx: 2, fill: "none", stroke: "#94A3B8" }, svg);
        text(svg, x2 + 27, y + 0.5, "removable", { fill: T.text2, "font-size": font, "dominant-baseline": "middle" });
        x = x2 + 27 + measure("removable", font) + 30;
        el("line", { x1: x - 14, y1: y - 9, x2: x - 14, y2: y + 9, stroke: T.gridStrong }, svg);
      } else if (it.kind === "family") {
        el("rect", { x, y: y - 6, width: 12, height: 12, rx: 2, fill: it.fam.optimal }, svg);
        el("rect", { x: x + 14, y: y - 6, width: 12, height: 12, rx: 2, fill: it.fam.excess, "fill-opacity": 0.28 }, svg);
        el("rect", { x: x + 14, y: y - 6, width: 12, height: 12, rx: 2, fill: hatch(it.id) }, svg);
        text(svg, x + 31, y + 0.5, it.label, { fill: T.text2, "font-size": font, "dominant-baseline": "middle" });
        x += 31 + measure(it.label, font) + 20;
      } else {
        if (it.kind === "ring" || it.kind === "ring-dot") {
          el("circle", { cx: x + 6, cy: y, r: 5, fill: T.bg, stroke: handoffColor, "stroke-width": 1.6 }, svg);
          if (it.kind === "ring-dot") el("circle", { cx: x + 6, cy: y, r: 2.2, fill: handoffColor }, svg);
        } else {
          const d = 6, cx = x + 6, pts = cx + "," + (y - d) + " " + (cx + d) + "," + y + " " + cx + "," + (y + d) + " " + (cx - d) + "," + y;
          const c = (fams.approval || {}).optimal || "#22C55E";
          el("polygon", { points: pts, fill: it.kind === "diamond" ? c : T.bg, stroke: c, "stroke-width": 1.5 }, svg);
        }
        text(svg, x + 18, y + 0.5, it.label, { fill: T.text2, "font-size": font, "dominant-baseline": "middle" });
        x += 18 + measure(it.label, font) + 20;
      }
    });
  }

  return { draw, measure, fmt, pct, viewLabel, FONT, THEME, THEMES };
})();
