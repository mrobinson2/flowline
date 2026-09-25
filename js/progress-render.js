/* ============================================================================
   TRACKER RENDERER  - the "where is this project" view, as one SVG.
   ----------------------------------------------------------------------------
   The timeline answers an analyst's questions. This composition answers the
   one a CTO asks: how far along are we, what is moving, what is stuck, and
   how much is left - readable in under thirty seconds, from the back of the
   room.

   Same contract as js/render.js: all styling is attributes so the SVG
   serializes to PNG/SVG export unchanged, no application state is read, and
   the presentation layout is a fixed 1920x1080 that drops into a deck.

   The tracker bar is one segment per STAGE when the process declares stages
   (the two-level rollup), else per phase. Five or six segments is what an
   executive reads at a glance; nineteen is what the Gantt is for.
   ========================================================================== */
VSM.progressRender = (function () {
  const NS = "http://www.w3.org/2000/svg";

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) { if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]); }
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(parent, x, y, str, attrs) {
    const t = el("text", Object.assign({ x, y }, attrs), parent);
    t.textContent = String(str === null || str === undefined ? "" : str);
    return t;
  }
  const R = () => VSM.render;                     // fonts, themes, measure, truncate
  const fmt = v => R().fmt(v);
  const pctText = v => Math.round(v * 100) + "%";

  const HEALTH = {
    "complete":    { label: "COMPLETE",    color: "#22C55E" },
    "on-track":    { label: "IN PROGRESS", color: "#3B82F6" },
    "blocked":     { label: "BLOCKED",     color: "#EF4444" },
    "not-started": { label: "NOT STARTED", color: "#64748B" }
  };
  /* ------------------------------------------------------------ layouts */
  function interactive(width) {
    const w = Math.max(720, width || 1100);
    const s = Math.min(1.15, Math.max(0.62, w / 1500));   // everything scales off the width
    return layout(w, "interactive", s);
  }
  /* 1.5 makes the section heights sum to ~1074 of the 1080, so the slide is
     filled rather than floating in dead space */
  function presentation() { return layout(1920, "presentation", 1.5); }
  function layout(width, mode, s) {
    const margin = Math.round(40 * s);
    const headerH = Math.round(74 * s);
    const heroH = Math.round(150 * s);
    const barH = Math.round(78 * s);
    const barCaptionH = Math.round(40 * s);
    const panelH = Math.round(196 * s);
    const footH = Math.round(34 * s);
    const gap = Math.round(16 * s);
    const height = mode === "presentation" ? 1080
      : margin * 2 + headerH + heroH + barH + barCaptionH + panelH + footH + gap * 4;
    return {
      mode, s, width, height, margin, gap,
      headerH, heroH, barH, barCaptionH, panelH, footH,
      titleFont: Math.round(26 * s), subFont: Math.round(13 * s),
      heroFont: Math.round(96 * s), heroCapFont: Math.round(14 * s), pillFont: Math.round(14 * s),
      segFont: Math.round(14.5 * s), segSubFont: Math.round(11.5 * s),
      panelHeadFont: Math.round(11.5 * s), panelFont: Math.round(13.5 * s), panelValueFont: Math.round(30 * s),
      footFont: Math.round(11.5 * s)
    };
  }

  /* ------------------------------------------------------------ main */
  function draw(model, P, opts) {
    opts = opts || {};
    const L = opts.layout || interactive(opts.width);
    const T = R().THEMES[opts.theme] || R().THEMES.dark;
    const FONT = R().FONT;
    const measure = R().measure;
    /* render.js does not export its truncate; a simple version is enough here */
    function doTrunc(s, size, w, wt) {
      s = String(s || "");
      if (measure(s, size, wt) <= w) return s;
      while (s.length > 1 && measure(s + "…", size, wt) > w) s = s.slice(0, -1);
      return s + "…";
    }

    const U = (VSM.units && VSM.units.resolve(model.process, { fmt })) || { abbr: "d", many: "days", secondary: null };
    const health = HEALTH[P.health] || HEALTH["not-started"];
    const c = P.counts;

    const svg = el("svg", {
      xmlns: NS, viewBox: "0 0 " + L.width + " " + L.height, width: L.width, height: L.height,
      "font-family": FONT, "data-mode": L.mode, role: "img",
      "aria-label": "Project tracker. " + pctText(P.pct) + " complete by duration. "
        + c.done + " of " + c.total + " activities done, " + c.doing + " in progress, " + c.blocked + " blocked."
        + (P.remaining !== null ? " Remaining critical path " + fmt(P.remaining) + " " + U.many + "." : "")
    });
    svg.style.fontFamily = FONT;
    svg.style.display = "block";
    el("rect", { x: 0, y: 0, width: L.width, height: L.height, fill: T.bg }, svg);

    const M = L.margin;
    let y = M;

    /* ---- header ---- */
    text(svg, M, y + L.titleFont, opts.title || model.process.title || "Value Stream",
      { fill: T.text, "font-size": L.titleFont, "font-weight": 600 });
    const chip = "PROJECT TRACKER";
    const cw = measure(chip, L.subFont, 700) + 26;
    el("rect", { x: L.width - M - cw, y: y + 2, width: cw, height: Math.round(L.subFont * 2), rx: Math.round(L.subFont), fill: T.chip, stroke: T.chipLine }, svg);
    text(svg, L.width - M - cw / 2, y + 2 + L.subFont, chip, { fill: T.text, "font-size": L.subFont - 1, "font-weight": 700, "letter-spacing": 1.2, "text-anchor": "middle", "dominant-baseline": "middle" });
    const sub = [model.process.subtitle, opts.scenarioSummary].filter(Boolean).join("   ·   ");
    text(svg, M, y + L.titleFont + L.subFont + 10, doTrunc(sub, L.subFont, L.width - 2 * M - cw - 20), { fill: T.text2, "font-size": L.subFont });
    y += L.headerH + L.gap;

    /* ---- hero: the number the room came for ---- */
    const heroTop = y;
    const pctStr = Math.round(P.pct * 100) + "%";
    text(svg, M, heroTop + L.heroFont * 0.86, pctStr, { fill: T.text, "font-size": L.heroFont, "font-weight": 700, "letter-spacing": -2 });
    const heroX = M + measure(pctStr, L.heroFont, 700) + Math.round(26 * L.s);
    /* health pill */
    const pw = measure(health.label, L.pillFont, 700) + 34;
    const pillY = heroTop + Math.round(14 * L.s), pillH = Math.round(L.pillFont * 2.1);
    el("rect", { x: heroX, y: pillY, width: pw, height: pillH, rx: pillH / 2, fill: health.color, "fill-opacity": 0.16, stroke: health.color, "stroke-width": 1.4 }, svg);
    el("circle", { cx: heroX + 15, cy: pillY + pillH / 2, r: 4.5, fill: health.color }, svg);
    text(svg, heroX + 26, pillY + pillH / 2 + 0.5, health.label, { fill: health.color, "font-size": L.pillFont, "font-weight": 700, "letter-spacing": 1, "dominant-baseline": "middle" });
    /* caption lines */
    const capY = pillY + pillH + Math.round(20 * L.s);
    text(svg, heroX, capY, "complete, weighted by current duration", { fill: T.text2, "font-size": L.heroCapFont });
    text(svg, heroX, capY + L.heroCapFont + 7,
      c.done + " of " + c.total + " activities done · " + c.doing + " in progress · " + c.blocked + " blocked"
      + (c.skipped ? " · " + c.skipped + " skipped" : ""),
      { fill: T.text, "font-size": L.heroCapFont, "font-weight": 600 });
    /* right side: as-of + basis */
    const asOf = "as of " + new Date().toISOString().slice(0, 10);
    text(svg, L.width - M, heroTop + Math.round(20 * L.s), asOf, { fill: T.muted, "font-size": L.subFont, "text-anchor": "end" });
    if (!P.tracked) {
      text(svg, L.width - M, heroTop + Math.round(20 * L.s) + L.subFont + 6,
        "No status recorded yet — open any activity and set one", { fill: T.accent, "font-size": L.subFont, "text-anchor": "end", "font-weight": 600 });
    }
    y += L.heroH + L.gap;

    /* ---- the tracker bar ---- */
    const segs = P.segments.filter(s => s.state !== "empty");
    const segGap = Math.round(10 * L.s);
    const barTop = y, barH = L.barH;
    const availW = L.width - 2 * M - segGap * Math.max(segs.length - 1, 0);
    const rx = Math.round(12 * L.s);
    const uid = "vsmtrk" + Math.floor(Math.random() * 1e9);
    const defs = el("defs", null, svg);
    let x = M;
    /* a data set with many phases and no stage rollup gets many narrow
       segments; below ~110px each, the per-segment counts stop fitting and
       the label drops to the short name, so the bar degrades to labels-only
       rather than to overlapping text */
    const segW = Math.max(46, availW / Math.max(segs.length, 1));
    const roomy = segW >= 110 * L.s;
    segs.forEach((seg, i) => {
      const w = segW;
      const isDone = seg.state === "done", isActive = seg.state === "active", isBlocked = seg.state === "blocked";
      const color = isDone ? "#22C55E" : isBlocked ? "#EF4444" : "#3B82F6";
      /* base */
      el("rect", { x, y: barTop, width: w, height: barH, rx, fill: T.panel, stroke: isBlocked ? "#EF4444" : T.panelLine, "stroke-width": isBlocked ? 1.8 : 1 }, svg);
      /* progress fill, clipped to the rounded segment */
      if (seg.pct > 0) {
        const clip = el("clipPath", { id: uid + "-s" + i }, defs);
        el("rect", { x, y: barTop, width: w, height: barH, rx }, clip);
        el("rect", { x, y: barTop, width: Math.max(w * Math.min(seg.pct, 1), 6), height: barH, fill: color, "fill-opacity": isDone ? 0.92 : 0.38, "clip-path": "url(#" + uid + "-s" + i + ")" }, svg);
      }
      /* the label; on narrow segments the counts go and the short name rules */
      const segFont = roomy ? L.segFont : Math.max(9, Math.round(L.segFont * 0.8));
      const label = doTrunc((roomy && measure(seg.label, segFont, 600) <= w - 40 ? seg.label : seg.short).toUpperCase(), segFont, w - (roomy ? 40 : 12), 700);
      text(svg, x + w / 2, barTop + barH / 2 - (roomy ? L.segSubFont * 0.85 : 0), label,
        { fill: isDone ? "#FFFFFF" : T.text, "font-size": segFont, "font-weight": 700, "letter-spacing": 0.6, "text-anchor": "middle", "dominant-baseline": "middle" });
      if (roomy) text(svg, x + w / 2, barTop + barH / 2 + L.segFont * 0.85,
        seg.done + "/" + seg.total + " · " + pctText(seg.pct),
        { fill: isDone ? "rgba(255,255,255,0.85)" : T.text2, "font-size": L.segSubFont, "font-weight": 600, "text-anchor": "middle", "dominant-baseline": "middle" });
      /* state glyphs, never color alone */
      const gx = x + w - Math.round(16 * L.s), gy = barTop + Math.round(15 * L.s), r = Math.round(8.5 * L.s);
      if (isDone) {
        el("circle", { cx: gx, cy: gy, r, fill: "#FFFFFF" }, svg);
        el("path", { d: "M" + (gx - r * 0.45) + " " + gy + " l" + (r * 0.32) + " " + (r * 0.36) + " l" + (r * 0.62) + " " + (-r * 0.68), fill: "none", stroke: "#16A34A", "stroke-width": Math.max(1.8, 2.2 * L.s), "stroke-linecap": "round", "stroke-linejoin": "round" }, svg);
      } else if (isBlocked) {
        el("circle", { cx: gx, cy: gy, r, fill: "#EF4444" }, svg);
        text(svg, gx, gy + 0.5, "!", { fill: "#FFFFFF", "font-size": Math.round(12 * L.s), "font-weight": 800, "text-anchor": "middle", "dominant-baseline": "middle" });
      } else if (isActive) {
        const dot = el("circle", { cx: gx, cy: gy, r: r * 0.6, fill: "#3B82F6" }, svg);
        if (L.mode === "interactive") {
          const an = el("animate", { attributeName: "opacity", values: "1;0.25;1", dur: "1.6s", repeatCount: "indefinite" });
          dot.appendChild(an);
        }
      }
      /* connector chevron */
      if (i < segs.length - 1) {
        const cxm = x + w + segGap / 2, cym = barTop + barH / 2, a = Math.round(5 * L.s);
        el("path", { d: "M" + (cxm - a * 0.6) + " " + (cym - a) + " L" + (cxm + a * 0.6) + " " + cym + " L" + (cxm - a * 0.6) + " " + (cym + a), fill: "none", stroke: T.muted, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }, svg);
      }
      x += w + segGap;
    });
    if (!segs.length) {
      text(svg, M, barTop + barH / 2, "No phases in the current scenario.", { fill: T.text2, "font-size": L.segFont, "dominant-baseline": "middle" });
    }
    /* caption under the bar */
    text(svg, M, barTop + barH + Math.round(22 * L.s),
      (P.level === "stage" ? "Stages" : "Phases") + " across the flow — fill is duration-weighted completion",
      { fill: T.muted, "font-size": L.segSubFont });
    y += L.barH + L.barCaptionH + L.gap;

    /* ---- fact panels: NOW / BLOCKED / UP NEXT / REMAINING ---- */
    const panels = [
      {
        head: "IN PROGRESS NOW", color: "#3B82F6",
        items: P.now.map(n => ({ id: n.id, main: n.name, sub: n.owner })),
        empty: c.total === 0 ? "Nothing in scope" : "Nothing marked in progress"
      },
      {
        head: "BLOCKED", color: "#EF4444",
        items: P.blocked.map(n => ({ id: n.id, main: n.name, sub: n.note || n.owner })),
        empty: "Nothing blocked"
      },
      {
        head: "UP NEXT (READY TO START)", color: "#F59E0B",
        items: P.next.map(n => ({ id: n.id, main: n.name, sub: n.owner })),
        empty: P.health === "complete" ? "All done" : "Nothing ready yet"
      },
      { head: "REMAINING", color: "#A855F7", remaining: true }
    ];
    const pw2 = (L.width - 2 * M - 3 * L.gap) / 4;
    panels.forEach((p, i) => {
      const px = M + i * (pw2 + L.gap);
      el("rect", { x: px, y, width: pw2, height: L.panelH, rx: 10, fill: T.panel, stroke: T.panelLine }, svg);
      el("rect", { x: px, y, width: 4, height: L.panelH, rx: 2, fill: p.color }, svg);
      text(svg, px + 16, y + Math.round(24 * L.s), p.head, { fill: T.muted, "font-size": L.panelHeadFont, "font-weight": 700, "letter-spacing": 1 });
      if (p.remaining) {
        const remY = y + Math.round(24 * L.s);
        if (P.remaining !== null) {
          text(svg, px + 16, remY + L.panelValueFont + 8, fmt(P.remaining) + " " + U.abbr, { fill: T.text, "font-size": L.panelValueFont, "font-weight": 700 });
          const human = U.secondary ? U.secondary(P.remaining) : null;
          if (human) text(svg, px + 16, remY + L.panelValueFont + L.panelFont + 16, "≈ " + human, { fill: T.text2, "font-size": L.panelFont });
          text(svg, px + 16, remY + L.panelValueFont + L.panelFont * 2 + 24, "critical path of unfinished work", { fill: T.muted, "font-size": L.panelHeadFont });
        } else {
          text(svg, px + 16, remY + L.panelFont + 10, "—", { fill: T.text2, "font-size": L.panelValueFont });
        }
        text(svg, px + 16, y + L.panelH - Math.round(16 * L.s),
          "Gates passed: " + P.gates.passed + " / " + P.gates.total,
          { fill: T.text, "font-size": L.panelFont, "font-weight": 600 });
        return;
      }
      const maxItems = 3;
      let iy = y + Math.round(24 * L.s) + L.panelFont + 6;
      p.items.slice(0, maxItems).forEach(it => {
        /* class + data-id make each item behave like a timeline row: the app's
           existing click / tooltip handlers open the same details panel */
        const row = el("g", { class: "vsm-row", "data-id": it.id, tabindex: L.mode === "interactive" ? 0 : null, role: L.mode === "interactive" ? "button" : null, "aria-label": it.main + (it.sub ? ". " + it.sub : "") }, svg);
        const rowH = L.panelFont + L.panelHeadFont + Math.round(14 * L.s);
        el("rect", { class: "vsm-hit", x: px + 8, y: iy - L.panelFont, width: pw2 - 16, height: rowH, fill: "transparent" }, row);
        text(row, px + 16, iy, "· " + doTrunc(it.main, L.panelFont, pw2 - 34, 600), { fill: T.text, "font-size": L.panelFont, "font-weight": 600 });
        if (it.sub) text(row, px + 26, iy + L.panelHeadFont + 3, doTrunc(it.sub, L.panelHeadFont, pw2 - 44), { fill: T.text2, "font-size": L.panelHeadFont });
        iy += rowH;
      });
      if (!p.items.length) text(svg, px + 16, iy, p.empty, { fill: T.muted, "font-size": L.panelFont });
      if (p.items.length > maxItems) text(svg, px + 16, y + L.panelH - Math.round(14 * L.s), "+ " + (p.items.length - maxItems) + " more", { fill: T.text2, "font-size": L.panelHeadFont, "font-weight": 600 });
    });
    y += L.panelH + L.gap;

    /* ---- footnote ---- */
    const foot = [
      "% complete weighs each activity by its current duration; in-progress activities count at their recorded percent (default 50%).",
      (model.process.caveat || "Durations are estimates.")
    ].join("  ·  ");
    text(svg, M, L.height - Math.round(18 * L.s), doTrunc(foot, L.footFont, L.width - 2 * M), { fill: T.muted, "font-size": L.footFont });

    return svg;
  }

  return { draw, interactive, presentation };
})();
if (typeof module !== "undefined" && module.exports) module.exports = VSM.progressRender;
