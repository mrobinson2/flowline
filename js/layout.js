/* ============================================================================
   LAYOUT  - computes sizes from the number of rows and the target canvas.
   ----------------------------------------------------------------------------
   Presentation mode is a fixed 1920 x 1080 composition. Row height, bar height,
   fonts, marker sizes and margins are derived from the row count so 30 rows get
   generous bars and 80 rows still fit on one slide, without CSS scaling.
   ========================================================================== */
VSM.layout = (function () {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function derive(rowH) {
    const large = rowH >= 20;
    return {
      rowH,
      barH: Math.round(rowH * (large ? 0.58 : 0.66) * 10) / 10,
      font: Math.round(clamp(rowH * 0.56, 7.5, 14) * 10) / 10,
      badgeFont: Math.round(clamp(rowH * 0.42, 6, 10) * 10) / 10,
      marker: Math.round(clamp(rowH * 0.28, 3, 7.5) * 10) / 10,   // handoff ring radius
      diamond: Math.round(clamp(rowH * 0.34, 4, 9) * 10) / 10,    // gate diamond half-size
      linkW: rowH >= 16 ? 1.2 : 0.9,
      gap: 2                                                       // surface gap between segments
    };
  }

  /* Side columns: a fixed owner gutter on the left and a duration column on the right.
     Both are optional; when off, the plot area reclaims the space. */
  function columns(rowH, opts, scale) {
    const show = opts.columns !== false;
    const colFont = Math.round(clamp(rowH * 0.46, 6.5, 11) * 10) / 10;
    const numW = show && opts.rowNumbers !== false ? Math.round(clamp(rowH * 1.0, 14, 24)) : 0;
    return {
      showColumns: show,
      colFont,
      numW,
      ownerW: show ? Math.round(112 * scale) : 0,     // team name
      durW: show ? Math.round(104 * scale) : 0        // "12 / 3 / 9 d"
    };
  }

  /* Interactive mode: rows have a fixed height chosen by the density setting; the SVG grows. */
  function interactive(rowCount, opts) {
    const density = { comfortable: 34, normal: 28, compact: 20 }[opts.density || "normal"] || 28;
    const d = derive(density);
    const axisH = 40;
    const padTop = 8, padBottom = 12, padL = 20, padR = 22;
    const width = Math.max(900, opts.width || 1200) * (opts.zoom || 1);
    const c = columns(density, opts, 1);
    return Object.assign(d, c, {
      mode: "interactive",
      width, height: axisH + padTop + rowCount * density + padBottom,
      chartTop: axisH + padTop, chartLeft: padL, chartRight: width - padR,
      axisTop: 0, axisH,
      phaseFont: 9.5, axisFont: 11, colHeadFont: 9,
      showHeader: false, showMetrics: false, showLegend: false
    });
  }

  /* Presentation mode: everything derived so the composition fits 1920x1080. */
  function presentation(rowCount, opts) {
    const W = 1920, H = 1080;
    const margin = 44;
    const headerH = 78;                       // title + scenario summary
    const metricsH = opts.showMetrics === false ? 0 : 74;
    const legendH = 44;
    const axisH = 30;
    const chartTop = margin + headerH + metricsH + axisH;
    const chartBottom = H - margin - legendH - 6;
    const avail = chartBottom - chartTop;
    /* MIN_ROW is the point below which a row stops being readable on a
       projected 1920-wide slide: the label font is derived at 0.56 x rowH, so
       8px rows give a 7.5px label, which is already the floor. Rather than
       shrink past it and spill 146 rows over the legend, the layout reports
       how many rows actually fit and lets the caller decide - which is the
       honest answer, because a 146-row slide was never going to be readable
       and the real fix is a rolled-up view, not a smaller font. */
    const MIN_ROW = 8, MAX_ROW = 26;
    const maxRows = Math.max(1, Math.floor(avail / MIN_ROW));
    const rowH = Math.floor(clamp(avail / Math.max(rowCount, 1), MIN_ROW, MAX_ROW) * 10) / 10;
    const d = derive(rowH);
    const c = columns(rowH, opts, 1.15);
    return Object.assign(d, c, {
      mode: "presentation",
      width: W, height: H,
      rowCount, maxRows, fits: rowCount <= maxRows,
      margin, headerH, metricsH, legendH, axisH,
      chartTop, chartLeft: margin + 8, chartRight: W - margin - 8,
      axisTop: chartTop - axisH,
      legendTop: H - margin - legendH + 8,
      titleFont: 30, subtitleFont: 15, metricFont: 26, metricLabelFont: 11.5,
      phaseFont: clamp(rowH * 0.5, 8, 11), axisFont: 12, legendFont: 12.5, colHeadFont: 10,
      showHeader: true, showMetrics: opts.showMetrics !== false, showLegend: true
    });
  }

  return { interactive, presentation, columns, clamp };
})();
if (typeof module !== "undefined" && module.exports) module.exports = VSM.layout;
