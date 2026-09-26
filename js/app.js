/* ============================================================================
   APP  - wires data, rules, scheduler, layout, renderer and exports to the UI.
   ----------------------------------------------------------------------------
   Owns application state (scenario values, view, filters, display options),
   builds the sidebar controls from scenario configuration, and re-renders
   whenever anything changes. This is the only file that touches the DOM
   outside the SVG.
   ========================================================================== */
(function () {
  const STATE_KEY = "vsm.state.v1", DATA_KEY = "vsm.data.v1";
  const $ = s => document.querySelector(s);
  const h = (tag, attrs, ...children) => {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === "class") e.className = attrs[k];
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), attrs[k]);
      else if (k === "html") e.innerHTML = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    children.flat().forEach(c => { if (c === null || c === undefined) return; e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  };
  const fmt = VSM.render.fmt, pct = VSM.render.pct;
  /* Time is written in whatever unit the loaded data uses: the sample data is
     in business days, the source workbook is in hours. See js/units.js. */
  const units = () => VSM.units.resolve(data && data.process, { fmt });

  let data = null;       // { process, taxonomy, scenario }
  let state = null;      // persisted UI state
  let model = null;      // scheduled model
  let track = null;      // progress rollup for the tracker view (VSM.progress.compute)
  let svg = null;        // interactive svg
  let presentSvg = null; // presentation svg
  let selectedId = null;
  let lastIssues = { errors: [], warnings: [] };
  /* the report from the most recent source-workbook import, kept so the panel
     can keep saying what was assumed rather than saying it once in a toast */
  let lastImportReport = null;

  /* ------------------------------------------------------------ data */
  function loadData() {
    let override = null;
    try { override = JSON.parse(localStorage.getItem(DATA_KEY) || "null"); } catch (e) { override = null; }
    const candidate = {
      process: (override && override.process) || VSM.data.process,
      taxonomy: (override && override.taxonomy) || VSM.data.taxonomy,
      scenario: (override && override.scenario) || VSM.data.scenario
    };
    /* validate.run can throw rather than return on pathological input (deep
       rule nesting used to overflow the stack). At startup there is nobody to
       catch it, and an abort here leaves a blank page with no way to clear the
       saved data, so treat a throw as one more validation error. */
    let issues;
    try { issues = VSM.validate.run(candidate.process, candidate.taxonomy, candidate.scenario); }
    catch (e) { issues = { errors: ["the saved data could not be checked: " + e.message], warnings: [] }; }
    lastIssues = issues;
    if (issues.errors.length) {
      // keep the working data on screen and say why the new set was refused
      renderIssues(issues);
      toast(issues.errors.length + " error" + (issues.errors.length === 1 ? "" : "s") + " in the data; the previous version is still shown", true);
      /* Same objects the happy path uses, not a clone: pinLiveData() decides
         what to persist by comparing against VSM.data by identity. */
      if (!data) data = { process: VSM.data.process, taxonomy: VSM.data.taxonomy, scenario: VSM.data.scenario };
      /* Always re-describe the source. An import sets this line to "loaded
         from a file" before init() runs, so skipping it here left the panel
         claiming the new file was in use while the old chart was on screen.
         It also unhides the discard button whenever an override exists, which
         is the only way back out of a saved set that will not load. */
      describeSource(override);
      return false;
    }
    data = candidate;
    describeSource(override);
    return true;
  }

  /* One line under the sidebar saying where the data came from and what to do next. */
  function describeSource(override) {
    let o = override;
    if (o === undefined) { try { o = JSON.parse(localStorage.getItem(DATA_KEY) || "null"); } catch (e) { o = null; } }
    const st = VSM.files.state;
    const el = $("#data-source");
    if (st.mode === "linked") el.textContent = "Linked to folder \u201c" + st.label + "\u201d. Reload re-reads the files; Save writes back to them.";
    else if (st.mode === "needs-permission") el.textContent = "A linked folder is remembered but the browser needs permission again. Click Reload.";
    else if (o) el.textContent = "Data " + (o.processSource === "edited" ? "edited in this browser" : "loaded from a file") + ", not the shipped files. Link a folder or download process.data.js to keep it.";
    else el.textContent = "Using the shipped data files. Link the data folder to edit them and reload in place.";
    $("#btn-reset-data").hidden = !o;
    $("#btn-save-folder").hidden = st.mode !== "linked";
    $("#btn-reload-folder").hidden = st.mode === "shipped";
    $("#btn-unlink-folder").hidden = st.mode === "shipped";
    $("#btn-link-folder").textContent = st.mode === "linked" ? "Relink folder" : "Link data folder";
  }

  function defaultState() {
    return {
      scenario: VSM.rules.defaults(data.scenario.attributes),
      /* sticky overrides of DERIVED attributes: { id: { value, reason } }.
         They live outside state.scenario so a profile change never clears
         a decision somebody wrote a reason for. */
      overrides: {},
      profile: null,
      view: "current",
      filters: { wasteTypes: [], owners: [], search: "" },
      display: { links: "all", phases: true, columns: true, presentColumns: false, critical: false, density: "normal", zoom: 1, hideNonMatching: false, presentMetrics: true },
      theme: "dark",
      sidebar: true,
      metricsPanel: true
    };
  }
  /* Merge a saved answer set over the CURRENT vocabulary: keep every choice
     that still applies, default the rest, drop the orphans. Startup and the
     linked-folder path both go through here, because a saved state can
     predate a vocabulary change just as easily as a loaded file can declare
     one - and a retired enum value merged blindly evaluates as a ghost:
     every rule reading it goes false and rows vanish with no error. */
  function mergeScenario(attrDefs, saved) {
    const fresh = VSM.rules.defaults(attrDefs);
    (attrDefs || []).forEach(a => {
      const v = saved ? saved[a.id] : undefined;
      if (v === undefined) return;
      if (a.type === "boolean") { if (typeof v === "boolean") fresh[a.id] = v; }
      else if (a.type === "multi") { if (Array.isArray(v)) fresh[a.id] = v.filter(x => (a.options || []).some(o => o.value === x)); }
      else if ((a.options || []).some(o => o.value === v)) fresh[a.id] = v;
    });
    return fresh;
  }

  function loadState() {
    state = defaultState();
    try {
      const saved = JSON.parse(localStorage.getItem(STATE_KEY) || "null");
      if (!saved && window.innerWidth < 900) state.sidebar = false;
      if (saved) {
        state.scenario = mergeScenario(data.scenario.attributes, saved.scenario || {});
        if (saved.overrides && typeof saved.overrides === "object" && !Array.isArray(saved.overrides)) {
          state.overrides = Object.assign({}, saved.overrides);
        }
        state.profile = saved.profile || null;
        state.view = saved.view || state.view;
        state.filters = Object.assign(state.filters, saved.filters || {});
        state.display = Object.assign(state.display, saved.display || {});
        if (typeof saved.sidebar === "boolean") state.sidebar = saved.sidebar;
        if (typeof saved.metricsPanel === "boolean") state.metricsPanel = saved.metricsPanel;
        if (saved.theme === "light" || saved.theme === "dark") state.theme = saved.theme;
      }
    } catch (e) { /* ignore */ }
  }
  function closeMenu(m) {
    m.classList.remove("open");
    const b = m.querySelector("button");
    if (b) b.setAttribute("aria-expanded", "false");
  }
  function closeMenus() { document.querySelectorAll(".menu").forEach(closeMenu); }

  /* One place that reflects the two panel toggles into the DOM, so the button
     handler and the startup path can never disagree about what is showing. */
  function applyPanels() {
    document.body.classList.toggle("sidebar-hidden", !state.sidebar);
    document.body.classList.toggle("metrics-hidden", !state.metricsPanel);
    const sb = $("#btn-sidebar"), mb = $("#btn-metrics");
    if (sb) sb.classList.toggle("on", !!state.sidebar);
    if (mb) mb.classList.toggle("on", !!state.metricsPanel);
  }

  function saveState() { try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } }

  /* Disabled controls (enabledWhen false) contribute a neutral value so rules never see stale input. */
  function effectiveScenario() {
    const s = Object.assign({}, state.scenario);
    data.scenario.attributes.forEach(a => {
      if (!VSM.rules.isEnabled(a, state.scenario, namedRules())) {
        s[a.id] = a.disabledValue !== undefined ? a.disabledValue : (a.type === "boolean" ? false : a.type === "multi" ? [] : s[a.id]);
      }
    });
    return s;
  }
  function scenarioSummary() {
    const s = effectiveScenario(), parts = [];
    data.scenario.attributes.forEach(a => {
      if (a.derived) return;                 // the engine's answers live on the chips
      if (!VSM.rules.isEnabled(a, state.scenario, namedRules())) return;
      const v = s[a.id];
      if (a.type === "boolean") { if (v) parts.push(a.label); }
      else if (a.type === "multi") { if (v && v.length) parts.push(a.label + ": " + v.map(x => optLabel(a, x)).join(", ")); }
      else parts.push(optLabel(a, v));
    });
    return parts.join("  ·  ");
  }
  function optLabel(a, v) { const o = (a.options || []).find(x => x.value === v); return o ? o.label : String(v); }
  function namedRules() { return (data.scenario && data.scenario.rules) || {}; }
  function filtersForRender() {
    return { wasteTypes: new Set(state.filters.wasteTypes), owners: new Set(state.filters.owners), search: state.filters.search.trim() };
  }

  /* ------------------------------------------------------------ validation gate
     Errors stop the render and are listed in full. The last good chart stays on
     screen, so a typo during a workshop never blanks the projector. */
  function checkData(d) {
    const r = VSM.validate.run(d.process, d.taxonomy, d.scenario);
    renderIssues(r);
    return r;
  }
  function renderIssues(r) {
    const box = $("#warnings");
    box.innerHTML = "";
    const items = r.errors.map(m => ({ m, bad: true })).concat((r.warnings || []).map(m => ({ m, bad: false })));
    /* An import's assumptions belong on screen for as long as the imported data
       is loaded, not in a toast that disappears in four seconds. */
    const rep = lastImportReport;
    if (rep) {
      (rep.unmappedList || []).forEach(u => items.push({ m: u.list + ": \"" + u.value + "\" is not a known value (" + u.count + " row" + (u.count === 1 ? "" : "s") + ", e.g. " + u.examples.join(", ") + "). Kept as-is.", bad: false }));
      (rep.notes || []).forEach(n => items.push({ m: n, bad: false }));
    }
    box.hidden = !items.length;
    box.classList.toggle("has-errors", r.errors.length > 0);
    if (!items.length) return;
    box.appendChild(h("div", { class: "warn-head" },
      r.errors.length ? r.errors.length + " error" + (r.errors.length === 1 ? "" : "s") + " in the data" : "",
      r.errors.length && r.warnings.length ? " · " : "",
      r.warnings.length ? r.warnings.length + " warning" + (r.warnings.length === 1 ? "" : "s") : ""));
    items.slice(0, 40).forEach(it => box.appendChild(h("div", { class: it.bad ? "bad" : "" }, it.m)));
    if (items.length > 40) box.appendChild(h("div", null, "… and " + (items.length - 40) + " more"));
    if (r.errors.length) box.appendChild(h("div", { class: "warn-foot" }, "The chart still shows the last data that loaded cleanly."));
  }

  /* ------------------------------------------------------------ rendering */
  function rebuild() {
    const issues = checkData(data);
    if (issues.errors.length) return;
    /* The scheduler sees things validation does not check for (a cycle only
       visible once a scenario has excluded part of the graph, say). An
       exception here used to escape into the DOMContentLoaded handler and
       leave a blank page with no way back, so report it like any other data
       error and keep the last good chart on screen. */
    try {
      model = VSM.schedule.build(data.process, data.taxonomy, effectiveScenario(), namedRules(), data.scenario.attributes, state.overrides);
    } catch (e) {
      lastIssues = { errors: issues.errors.concat("the schedule could not be built: " + e.message), warnings: issues.warnings };
      renderIssues(lastIssues);
      toast("The schedule could not be built: " + e.message, true);
      return;
    }
    /* The tracking rollup rides on the scheduled model and never changes it.
       Computed once per rebuild so the tracker view, the row glyphs and the
       status panel all agree. */
    track = VSM.progress.compute(model);
    model.warnings = model.warnings.concat(track.warnings);
    renderWarnings();
    renderMetrics();
    renderWasteChips();
    renderDerived();
    renderChart();
    if (document.body.classList.contains("presenting")) renderPresentation();
    if (selectedId) showDetails(selectedId);
    saveState();
  }

  function renderChart() {
    const wrap = $("#chart-wrap");
    const width = Math.max(wrap.clientWidth - 8, 600);
    if (state.view === "tracker") {
      svg = VSM.progressRender.draw(model, track, { layout: VSM.progressRender.interactive(width), theme: state.theme, scenarioSummary: scenarioSummary() });
    } else {
      const L = VSM.layout.interactive(model.nodes.length, { width, zoom: state.display.zoom, density: state.display.density, columns: state.display.columns });
      svg = VSM.render.draw(model, { layout: L, view: state.view, display: state.display, filters: filtersForRender(), scenarioSummary: scenarioSummary(), theme: state.theme });
    }
    const chart = $("#chart");
    chart.innerHTML = "";
    chart.appendChild(svg);
    if (selectedId) highlightSelected();
  }

  function renderPresentation() {
    if (state.view === "tracker") {
      presentSvg = VSM.progressRender.draw(model, track, { layout: VSM.progressRender.presentation(), theme: state.theme, scenarioSummary: scenarioSummary() });
      const stage = $("#present-stage");
      stage.innerHTML = "";
      stage.appendChild(presentSvg);
      $("#present-rows").textContent = "Project tracker · " + Math.round(track.pct * 100) + "% complete · " + track.counts.done + "/" + track.counts.total + " done";
      $("#present-rows").classList.toggle("warn", false);
      return;
    }
    const L = VSM.layout.presentation(model.nodes.length, { showMetrics: state.display.presentMetrics, columns: state.display.presentColumns });
    presentSvg = VSM.render.draw(model, { layout: L, view: state.view, display: state.display, filters: filtersForRender(), scenarioSummary: scenarioSummary(), theme: state.theme });
    const stage = $("#present-stage");
    stage.innerHTML = "";
    stage.appendChild(presentSvg);
    const over = model.nodes.length > 80;
    $("#present-rows").textContent = model.nodes.length + " rows · row height " + L.rowH + "px · font " + L.font + "px"
      + (over ? " · above 80 rows a slide stops being readable; filter or split the scenario" : "");
    $("#present-rows").classList.toggle("warn", over);
  }

  function renderMetrics() {
    const m = model.metrics;
    const U = units(), u = " " + U.abbr;
    const also = v => U.secondary ? " · " + U.secondary(v) : "";
    const tiles = [
      ["Current elapsed", fmt(m.currentElapsed) + u, "end-to-end today" + also(m.currentElapsed)],
      ["Optimal elapsed", fmt(m.optimalElapsed) + u, "every step at its minimum" + also(m.optimalElapsed)],
      ["Removable elapsed", fmt(m.removableElapsed) + u, pct(m.removablePct) + " of the current path", "accent"],
      ["Excess in activities", fmt(m.sumExcess) + u, "of " + fmt(m.sumCurrent) + " activity-" + U.many],
      ["Handoffs", String(m.handoffs), m.crossOrgHandoffs + " cross-org · " + m.orgBoundaries + " org boundaries"],
      ["Approval gates", String(m.gates), m.milestones + " milestone" + (m.milestones === 1 ? "" : "s")],
      ["Waiting time", fmt(m.waitingCurrent) + u, fmt(m.waitingExcess) + u + " removable"],
      ["Activities", String(m.activities), m.wasteActivities + " carry a waste type"]
    ];
    const box = $("#metrics");
    box.innerHTML = "";
    tiles.forEach(t => box.appendChild(h("div", { class: "tile" + (t[3] ? " " + t[3] : "") },
      h("div", { class: "tile-label" }, t[0]), h("div", { class: "tile-value" }, t[1]), h("div", { class: "tile-sub" }, t[2]))));
    // excess breakdown bar by family
    const fams = data.taxonomy.families || {};
    const total = m.sumExcess || 1;
    const bar = h("div", { class: "breakdown" });
    const entries = Object.entries(m.byFamily).filter(([, v]) => v.excess > 0).sort((a, b) => b[1].excess - a[1].excess);
    entries.forEach(([f, v]) => bar.appendChild(h("div", { class: "seg", style: "width:" + (v.excess / total * 100) + "%;background:" + safeColor(fams[f] && fams[f].optimal), title: (fams[f] ? fams[f].label : f) + ": " + fmt(v.excess) + " " + units().abbr + " removable" })));
    const legend = h("div", { class: "breakdown-legend" }, entries.map(([f, v]) => h("span", null, h("i", { style: "background:" + safeColor(fams[f] && fams[f].optimal) }), (fams[f] ? fams[f].label : f) + " " + fmt(v.excess) + units().abbr)));
    box.appendChild(h("div", { class: "breakdown-wrap" }, h("div", { class: "tile-label" }, "Where the removable time sits"), bar, legend));
  }

  function renderWasteChips() {
    const box = $("#waste-chips");
    box.innerHTML = "";
    /* validate.js only checks categories and wasteTypes when they are present,
       so a taxonomy carrying families alone is valid data. Default them here
       rather than throwing out of the render. */
    const m = model.metrics, wt = data.taxonomy.wasteTypes || {}, fams = data.taxonomy.families || {};
    const items = Object.keys(wt).map(id => ({ id, label: wt[id].label, code: wt[id].code, color: fams[wt[id].family] }));
    items.push({ id: "none", label: "No waste type (value / enabling)", code: "V/E", color: fams.value });
    items.forEach(it => {
      const stat = m.byWaste[it.id];
      const on = state.filters.wasteTypes.includes(it.id);
      const chip = h("button", {
        class: "chip" + (on ? " on" : ""), type: "button", title: "Click to isolate this category (dims the others). Click again to clear.",
        onclick: () => { toggleInList(state.filters.wasteTypes, it.id); rebuild(); }
      },
        h("i", { style: "background:" + safeColor(it.color && it.color.optimal) }),
        h("b", null, it.code), h("span", null, it.label),
        h("em", null, stat ? stat.count + " · " + fmt(stat.excess) + units().abbr : "0"));
      box.appendChild(chip);
    });
  }

  /* ------------------------------------------------------------ derived chips
     The engine's answers (spec §4.4): each derived attribute renders as a
     muted chip with its value and the SPECIFIC answers that produced it -
     never generic text - plus an override affordance. An override is sticky,
     badged, and carries its reason. */
  function renderDerived() {
    const box = $("#derived-chips");
    if (!box) return;
    box.innerHTML = "";
    const dv = model && model.derived;
    if (!dv || !dv.derived.length) { box.hidden = true; return; }
    box.hidden = false;
    box.appendChild(h("div", { class: "control-group" }, "Derived by the engine"));
    dv.derived.forEach(id => {
      const attr = data.scenario.attributes.find(a => a.id === id);
      if (!attr) return;
      const p = dv.provenance[id] || { value: undefined, because: [] };
      const ov = dv.overridden && Object.prototype.hasOwnProperty.call(dv.overridden, id) && !dv.overridden[id].ignored ? dv.overridden[id] : null;
      const valueLabel = v => {
        const o = attr.options ? attr.options.find(x => x.value === v) : null;
        return o ? o.label : v === true ? "Yes" : v === false ? "No" : String(v);
      };
      const chip = h("div", { class: "derived-chip" + (ov ? " overridden" : "") });
      chip.appendChild(h("div", { class: "dc-head" },
        h("span", { class: "dc-label" }, attr.label),
        h("b", { class: "dc-value" }, valueLabel(p.value)),
        ov ? h("em", { class: "dc-badge", title: ov.reason || "" }, "overridden") : null));
      if (ov) {
        chip.appendChild(h("div", { class: "dc-why" }, "Overridden" + (ov.reason ? ": " + ov.reason : " (no reason recorded)")));
      } else {
        const because = (p.because || []).slice(0, 4);
        if (because.length) chip.appendChild(h("div", { class: "dc-why" },
          "Because: " + because.map(b => (b.satisfied === false ? "not: " : "") + b.label + " = " + b.valueLabel).join("  ·  ")));
      }
      const actions = h("div", { class: "dc-actions" });
      actions.appendChild(h("button", { type: "button", class: "ghost dc-btn", onclick: () => overrideDialog(attr, p.value, ov) }, ov ? "Change" : "Override"));
      if (ov) actions.appendChild(h("button", { type: "button", class: "ghost dc-btn", onclick: () => {
        delete state.overrides[id]; rebuild(); toast(attr.label + " derives again");
      } }, "Clear override"));
      chip.appendChild(actions);
      box.appendChild(chip);
    });
  }

  function overrideDialog(attr, current, existing) {
    if (!document.body) return;
    const needReason = !!attr.overrideRequiresReason;
    const overlay = h("div", { class: "overlay", role: "dialog", "aria-modal": "true" });
    const done = () => { overlay.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = e => { if (e.key === "Escape") done(); };
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", e => { if (e.target === overlay) done(); });
    let chosen = existing ? existing.value : current;
    const choices = attr.type === "boolean" ? [[true, "Yes"], [false, "No"]] : (attr.options || []).map(o => [o.value, o.label]);
    const seg = h("div", { class: "segmented" });
    const paint = () => { [...seg.children].forEach((b, i) => b.classList.toggle("on", choices[i][0] === chosen)); };
    choices.forEach(([v, lab]) => seg.appendChild(h("button", { type: "button", onclick: () => { chosen = v; paint(); } }, lab)));
    const reason = h("textarea", { class: "input", rows: 2,
      placeholder: needReason ? "Why does the derivation not apply here? (required)" : "Reason (recommended)" });
    if (existing && existing.reason) reason.value = existing.reason;
    const hint = h("div", { class: "hint", hidden: true }, "A reason is required for this override.");
    overlay.appendChild(h("div", { class: "overlay-box" },
      h("div", { class: "overlay-head" },
        h("h2", null, "Override: " + attr.label),
        h("button", { class: "icon", type: "button", title: "Cancel", onclick: done }, "×")),
      h("div", { class: "overlay-body" },
        h("p", null, "The engine derived “" + (choices.find(c => c[0] === current) || [null, String(current)])[1] +
          "”. An override is sticky - it wins over the derivation on every recompute until it is cleared - and it is recorded with the scenario."),
        seg,
        h("label", { class: "field" }, h("span", null, "Reason" + (needReason ? " (required)" : "")), reason), hint),
      h("div", { class: "overlay-foot" },
        h("button", { class: "ghost", type: "button", onclick: done }, "Cancel"),
        h("button", { class: "primary", type: "button", onclick: () => {
          const why = reason.value.trim();
          if (needReason && !why) { hint.hidden = false; reason.focus(); return; }
          state.overrides[attr.id] = why ? { value: chosen, reason: why } : { value: chosen };
          done(); rebuild(); toast(attr.label + " overridden");
        } }, "Apply override"))));
    document.body.appendChild(overlay);
    paint();
  }

  /* Scheduler notes are merged with whatever validation reported for this data. */
  function renderWarnings() {
    renderIssues({ errors: lastIssues.errors, warnings: lastIssues.warnings.concat(model.warnings) });
  }

  function toggleInList(list, v) { const i = list.indexOf(v); if (i >= 0) list.splice(i, 1); else list.push(v); }

  /* ------------------------------------------------------------ sidebar controls */
  function buildScenarioControls() {
    const box = $("#scenario-controls");
    box.innerHTML = "";
    const presets = $("#preset");
    presets.innerHTML = "";
    presets.appendChild(h("option", { value: "" }, "Custom / choose a preset…"));
    const sameValue = (a, b) => (Array.isArray(a) && Array.isArray(b))
      ? a.length === b.length && a.every(x => b.indexOf(x) >= 0) : a === b;
    (data.scenario.presets || []).forEach(p => {
      const set = p.set || p.values || {};
      const modified = p.id === state.profile &&
        Object.keys(set).some(k => !sameValue(state.scenario[k], set[k]));
      presets.appendChild(h("option", { value: p.id }, p.label + (modified ? "  (modified)" : "")));
    });
    presets.value = state.profile || "";
    presets.onchange = () => {
      const p = (data.scenario.presets || []).find(x => x.id === presets.value);
      state.profile = presets.value || null;
      if (!p) { buildScenarioControls(); rebuild(); return; }
      const declared = VSM.deepClone(p.set || p.values || {});
      /* A profile that DECLARES a subset only overwrites what it names, so a
         modifier it stays silent about survives the change. A profile from the
         old-style data files declares everything, so it resets. */
      state.scenario = (p.set && p.partial !== false)
        ? Object.assign({}, state.scenario, declared)
        : Object.assign(VSM.rules.defaults(data.scenario.attributes), declared);
      buildScenarioControls(); rebuild();
    };

    /* Toggles a profile does NOT name are modifiers: changing one keeps the
       profile selected, because "standard app, and it involves AI" is still
       the standard profile with a modifier on it. Changing something the
       profile does name means it is no longer that profile. */
    const activeProfile = (data.scenario.presets || []).find(x => x.id === state.profile);
    /* Only a hidden attribute (work type) identifies the profile. Changing a
       visible modifier the profile happened to declare marks it modified
       rather than dropping it, because "Adopt SaaS with hardware on" is still
       Adopt SaaS. Work type can only change through the dropdown itself. */
    const identityKeys = new Set(data.scenario.attributes.filter(a => a.hidden).map(a => a.id));
    const touched = id => { if (identityKeys.has(id)) { state.profile = null; presets.value = ""; } };

    /* What the toggles resolve to once implications are followed, so the UI can
       show a lever that is on because another lever demanded it. */
    const resolved = VSM.rules.applyImplications(data.scenario.attributes, state.scenario);
    /* Null-prototype: keyed by attribute ids out of the scenario data, and
       validate.js's id rule allows "constructor". Against a plain object the
       get-or-create below resolves that to Object.prototype.constructor, which
       is truthy and has no push(), so the sidebar threw and never rebuilt. */
    const impliedBy = Object.create(null);
    data.scenario.attributes.forEach(a => {
      if (!a.implies || !a.implies.length) return;
      const on = a.type === "boolean" ? state.scenario[a.id] === true : !!state.scenario[a.id];
      if (!on) return;
      a.implies.forEach(spec => {
        const id = String(spec).split("=")[0].trim();
        (impliedBy[id] = impliedBy[id] || []).push(a.label);
      });
    });

    let lastGroup = null;
    data.scenario.attributes.forEach(a => {
      if (a.hidden) return;                 // set elsewhere (work type is the Scenario dropdown)
      if (a.derived) return;                // the engine computes these; they render as chips
      if (a.group && a.group !== lastGroup) {
        box.appendChild(h("div", { class: "control-group" }, a.group));
        lastGroup = a.group;
      }
      const enabled = VSM.rules.isEnabled(a, state.scenario, namedRules());
      const forced = impliedBy[a.id] && resolved[a.id] && !state.scenario[a.id];
      const row = h("div", { class: "control" + (enabled ? "" : " disabled") + (forced ? " forced" : "") });
      if (a.type === "boolean") {
        const input = h("input", { type: "checkbox" });
        input.checked = !!state.scenario[a.id] || !!forced;
        input.disabled = !enabled || !!forced;
        input.onchange = () => { state.scenario[a.id] = input.checked; touched(a.id); buildScenarioControls(); rebuild(); };
        row.appendChild(h("label", { class: "switch" }, input, h("span", { class: "track" }), h("span", { class: "lbl" }, a.label)));
      } else if (a.type === "enum") {
        if (a.label !== a.group) row.appendChild(h("div", { class: "lbl" }, a.label));
        const seg = h("div", { class: "segmented" });
        (a.options || []).forEach(o => {
          const b = h("button", { type: "button", class: state.scenario[a.id] === o.value ? "on" : "" }, o.label);
          b.disabled = !enabled;
          b.onclick = () => { state.scenario[a.id] = o.value; touched(a.id); buildScenarioControls(); rebuild(); };
          seg.appendChild(b);
        });
        row.appendChild(seg);
      } else if (a.type === "multi") {
        /* no need to repeat the label when the group heading already says it */
        if (a.label !== a.group) row.appendChild(h("div", { class: "lbl" }, a.label));
        const list = h("div", { class: "multi" });
        (a.options || []).forEach(o => {
          const cur = state.scenario[a.id] || [];
          const b = h("button", { type: "button", class: cur.includes(o.value) ? "on" : "" }, o.label);
          b.disabled = !enabled;
          b.onclick = () => { state.scenario[a.id] = cur.slice(); toggleInList(state.scenario[a.id], o.value); touched(a.id); buildScenarioControls(); rebuild(); };
          list.appendChild(b);
        });
        row.appendChild(list);
      }
      if (forced) row.appendChild(h("div", { class: "hint" }, "Required by " + impliedBy[a.id].join(", ")));
      else if (a.help) row.appendChild(h("div", { class: "hint" }, a.help));
      if (a.enabledWhen && !enabled) row.appendChild(h("div", { class: "hint" }, "Applies when " + VSM.rules.describe(a.enabledWhen, data.scenario.attributes, namedRules())));
      box.appendChild(row);
    });
  }

  function buildOwnerFilter() {
    const box = $("#owner-filter");
    box.innerHTML = "";
    const teams = data.process.teams || {};
    Object.keys(teams).forEach(id => {
      const input = h("input", { type: "checkbox" });
      input.checked = state.filters.owners.includes(id);
      input.onchange = () => { toggleInList(state.filters.owners, id); rebuild(); };
      box.appendChild(h("label", { class: "check" }, input, h("span", null, teams[id].label), h("em", null, teams[id].org || "")));
    });
  }

  function bindDisplayControls() {
    const d = state.display;
    $("#opt-links").value = d.links;
    $("#opt-links").onchange = e => { d.links = e.target.value; rebuild(); };
    $("#opt-density").value = d.density;
    $("#opt-density").onchange = e => { d.density = e.target.value; rebuild(); };
    $("#opt-zoom").value = d.zoom;
    $("#opt-zoom").oninput = e => { d.zoom = parseFloat(e.target.value); $("#zoom-val").textContent = d.zoom.toFixed(1) + "x"; renderChart(); saveState(); };
    $("#zoom-val").textContent = d.zoom.toFixed(1) + "x";
    ["phases", "columns", "presentColumns", "critical", "hideNonMatching", "presentMetrics"].forEach(k => {
      const el = $("#opt-" + k);
      el.checked = !!d[k];
      el.onchange = () => { d[k] = el.checked; rebuild(); };
    });
    $("#search").value = state.filters.search;
    $("#search").oninput = e => { state.filters.search = e.target.value; rebuild(); };
    $("#btn-clear-filters").onclick = () => { state.filters = { wasteTypes: [], owners: [], search: "" }; buildOwnerFilter(); $("#search").value = ""; rebuild(); };
  }

  /* ------------------------------------------------------------ views / modes */
  function setView(v) {
    state.view = v;
    document.querySelectorAll("[data-view]").forEach(b => b.classList.toggle("on", b.dataset.view === v));
    rebuild();
  }

  function applyTheme() {
    document.documentElement.setAttribute("data-theme", state.theme);
    const label = state.theme === "dark" ? "Light mode" : "Dark mode";
    $("#btn-theme").textContent = label;
    $("#btn-theme-present").textContent = label;
  }
  function toggleTheme() {
    state.theme = state.theme === "dark" ? "light" : "dark";
    applyTheme();
    rebuild();
  }

  function enterPresentation() {
    document.body.classList.add("presenting");
    $("#present").hidden = false;
    renderPresentation();
  }
  function exitPresentation() {
    document.body.classList.remove("presenting");
    $("#present").hidden = true;
  }

  /* ------------------------------------------------------------ tooltip + details */
  function nodeFromEvent(e) {
    const row = e.target.closest && e.target.closest(".vsm-row");
    return row ? model.nodeById.get(row.getAttribute("data-id")) : null;
  }
  /* Colours reach the DOM from imported data. validate.js already requires a
     six-digit hex value, but this string is concatenated into markup, so it
     gets its own check rather than trusting a regex in another file. */
  const SAFE_HEX = /^#[0-9a-f]{6}$/i;
  function safeColor(c) { return SAFE_HEX.test(String(c || "")) ? String(c) : "#64748b"; }
  function tooltipHTML(n) {
    const d = n.duration, esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const kind = n.wasteDef ? n.wasteDef.label : (n.categoryDef.label || n.category);
    const rows = [
      ["Owner", esc(n.team.label) + (n.team.org ? " (" + esc(n.team.org) + ")" : "")],
      ["Type", esc(kind) + (n.isGate ? " · gate" : "")],
      ["Current", fmt(d.current) + " " + units().abbr + "  (" + fmt(n.cur.start) + " → " + fmt(n.cur.end) + ")"],
      ["Optimal", fmt(d.optimal) + " " + units().abbr],
      ["Removable", fmt(d.excess) + " " + units().abbr + (d.current ? " (" + pct(d.excess / d.current) + ")" : "")],
      ["Float", n.critical ? "0 (critical path)" : fmt(n.cur.float) + " " + units().abbr]
    ];
    /* Why this row is in the current scenario - the lowest-friction path to
       explainability. Prefers the workbook's own TriggerExplanation when a
       future import carries one; falls back to describing the rule. */
    if (n.act.when !== undefined) {
      rows.push(["Included when", esc(n.act.triggerExplanation
        || VSM.rules.describe(n.act.when, data.scenario.attributes, namedRules()))]);
    }
    if (n.hasHandoff) rows.push(["Handoff", n.handoffsIn.map(x => esc(x.fromTeam.label) + " → " + esc(x.toTeam.label) + (x.crossOrg ? " (cross-org)" : "") + (x.explicit ? " (declared)" : "")).join("<br>")]);
    if (d.overrideNote) rows.push(["Override", esc(d.overrideNote)]);
    return "<div class='tt-title'><span class='tt-code' style='background:" + safeColor(n.familyDef.optimal) + "'>" + esc(n.code) + "</span>" + esc(n.name) + "</div>" +
      (n.act.description ? "<div class='tt-desc'>" + esc(n.act.description) + "</div>" : "") +
      "<table>" + rows.map(r => "<tr><th>" + r[0] + "</th><td>" + r[1] + "</td></tr>").join("") + "</table><div class='tt-hint'>Click for details</div>";
  }
  function bindTooltip() {
    const tip = $("#tooltip");
    const move = e => {
      const n = nodeFromEvent(e);
      if (!n) { tip.hidden = true; return; }
      tip.innerHTML = tooltipHTML(n);
      tip.hidden = false;
      const pad = 14, w = tip.offsetWidth, hh = tip.offsetHeight;
      let x = e.clientX + pad, y = e.clientY + pad;
      if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
      if (y + hh > window.innerHeight - 8) y = e.clientY - hh - pad;
      tip.style.left = x + "px"; tip.style.top = y + "px";
    };
    ["#chart", "#present-stage"].forEach(sel => {
      const host = $(sel);
      host.addEventListener("mousemove", move);
      host.addEventListener("mouseleave", () => { tip.hidden = true; });
      host.addEventListener("click", e => { const n = nodeFromEvent(e); if (n) { selectedId = n.id; showDetails(n.id); highlightSelected(); } });
      // keyboard: rows are focusable, Enter / Space opens the details panel
      host.addEventListener("keydown", e => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const row = e.target.closest && e.target.closest(".vsm-row");
        if (!row) return;
        e.preventDefault();
        selectedId = row.getAttribute("data-id");
        showDetails(selectedId);
        highlightSelected();
      });
    });
  }
  function highlightSelected() {
    document.querySelectorAll(".vsm-row").forEach(r => r.classList.toggle("selected", r.getAttribute("data-id") === selectedId));
  }
  function showDetails(id) {
    const n = model.nodeById.get(id);
    const panel = $("#details");
    if (!n) { panel.hidden = true; selectedId = null; return; }
    if (document.body.classList.contains("presenting")) return;
    const d = n.duration, a = n.act;
    const kind = n.wasteDef ? n.wasteDef.label : (n.categoryDef.label || n.category);
    const succs = n.succs.map(s => model.nodeById.get(s).name);
    const preds = n.preds.map(p => model.nodeById.get(p).name);
    panel.innerHTML = "";
    panel.appendChild(h("div", { class: "details-head" },
      h("span", { class: "tt-code", style: "background:" + safeColor(n.familyDef.optimal) }, n.code),
      h("h2", null, n.name),
      h("button", { class: "icon", type: "button", title: "Close", onclick: () => { panel.hidden = true; selectedId = null; highlightSelected(); } }, "×")));
    panel.appendChild(buildStatusControl(a));
    const dl = h("dl");
    const add = (k, v) => { if (v === null || v === undefined || v === "") return; dl.appendChild(h("dt", null, k)); dl.appendChild(h("dd", null, v)); };
    add("ID", a.id);
    add("Description", a.description);
    add("Owner", n.team.label + (n.team.org ? " · " + n.team.org : ""));
    add("Phase", ((data.process.phases || []).find(p => p.id === a.phase) || {}).label || a.phase);
    add("Category", (n.categoryDef.label || n.category) + (n.isGate ? " (gate)" : ""));
    add("Waste type", n.wasteDef ? n.wasteDef.label + " — " + (n.wasteDef.description || "") : "none");
    const stRow = VSM.progress.statusOf(a);
    if (stRow.explicit) add("Status", (VSM.progress.STATUSES.find(s => s.id === stRow.id) || {}).label + (stRow.id === "doing" ? " (" + Math.round(stRow.fraction * 100) + "%)" : "") + (stRow.note ? " — " + stRow.note : ""));
    const un = data.process.units || "business days", ab = units().abbr;
    add("Current duration", fmt(d.current) + " " + un + "  (" + fmt(n.cur.start) + " → " + fmt(n.cur.end) + ")");
    if (a.time) add("Lead / cycle", fmt(a.time.leadCurrent) + " " + ab + " waiting + " + fmt(a.time.cycleCurrent) + " " + ab + " hands-on  ·  flow efficiency " + pct(d.current ? a.time.cycleCurrent / d.current : 0));
    add("Optimal duration", fmt(d.optimal) + " " + un);
    add("Removable", fmt(d.excess) + " " + un + (d.current ? " (" + pct(d.excess / d.current) + ")" : ""));
    add("Float", n.critical ? "0 — on the critical path" : fmt(n.cur.float) + " " + un);
    add("Optimal schedule", fmt(n.opt.start) + " → " + fmt(n.opt.end));
    add("Predecessors", preds.length ? preds.join(", ") : "none (starts at zero)");
    add("Successors", succs.length ? succs.join(", ") : "none");
    add("Handoffs in", n.hasHandoff ? n.handoffsIn.map(x => x.fromTeam.label + " → " + x.toTeam.label + (x.crossOrg ? " (cross-org)" : "") + (x.explicit ? " (declared in JSON)" : " (owner change)")).join("; ") : "none");
    add("Inclusion rule", VSM.rules.describe(a.when, data.scenario.attributes, namedRules()));
    if (d.overrideNote) add("Override", d.overrideNote);
    add("Notes", a.notes);
    panel.appendChild(dl);
    panel.appendChild(buildEditForm(a));
    panel.appendChild(h("pre", { class: "json" }, JSON.stringify(a, null, 2)));
    panel.hidden = false;
  }

  /* Project tracking for one activity: one click sets the status, the slider
     sets how far along a doing activity is, the note says why it is blocked.
     Applied immediately through the same validated override path as every
     other edit - tracking state lands in exports and the linked folder. */
  function buildStatusControl(a) {
    const st = VSM.progress.statusOf(a);
    const box = h("div", { class: "status-box" });
    box.appendChild(h("div", { class: "control-group" }, "Tracking"));
    const seg = h("div", { class: "segmented status-seg" });
    VSM.progress.STATUSES.forEach(s => {
      const on = st.id === s.id && st.explicit;
      const b = h("button", { type: "button", class: on ? "on" : "", title: s.label }, s.short);
      b.onclick = () => applyStatus(a.id, { status: on ? null : s.id });   // click again to clear
      seg.appendChild(b);
    });
    box.appendChild(seg);
    if (st.explicit && st.id === "doing") {
      const slider = h("input", { type: "range", min: "0", max: "100", step: "5" });
      slider.value = String(Math.round(st.fraction * 100));
      const val = h("b", null, Math.round(st.fraction * 100) + "%");
      slider.oninput = () => { val.textContent = slider.value + "%"; };
      slider.onchange = () => applyStatus(a.id, { progress: Number(slider.value) });
      box.appendChild(h("label", { class: "field" }, h("span", null, "Progress ", val), slider));
    }
    if (st.explicit) {
      const note = h("input", { class: "input", placeholder: st.id === "blocked" ? "Why is it blocked?" : "Status note (optional)", value: st.note });
      note.onchange = () => applyStatus(a.id, { statusNote: note.value.trim() || null });
      box.appendChild(note);
      if (st.date) box.appendChild(h("div", { class: "hint" }, "Status set " + st.date));
    } else {
      box.appendChild(h("div", { class: "hint" }, "No status recorded. Setting one turns the Tracker view into a live project readout."));
    }
    return box;
  }
  function applyStatus(id, patch) {
    const candidate = VSM.deepClone(data.process);
    const act = candidate.activities.find(x => x.id === id);
    if (!act) return;
    if (patch.status !== undefined) {
      if (patch.status === null) { delete act.status; delete act.progress; delete act.statusNote; delete act.statusDate; }
      else { act.status = patch.status; act.statusDate = new Date().toISOString().slice(0, 10); }
    }
    if (patch.progress !== undefined) { act.progress = patch.progress; act.statusDate = new Date().toISOString().slice(0, 10); }
    if (patch.statusNote !== undefined) { if (patch.statusNote) act.statusNote = patch.statusNote; else delete act.statusNote; }
    try { saveProcessOverride(candidate, "edited"); }
    catch (e) { toast("Status not saved: " + e.message, true); return; }
    data.process = candidate;
    rebuild();
  }

  /* Inline editing of one activity (for the "change one number live in the meeting" case). */
  function buildEditForm(a) {
    const unitName = data.process.units || "business days";
    const form = h("form", { class: "edit-form", onsubmit: e => { e.preventDefault(); applyEdit(a.id, form); } });
    const field = (label, input) => h("label", { class: "edit-field" }, h("span", null, label), input);
    const sel = (name, options, value, allowBlank) => {
      const s = h("select", { name, class: "select" });
      if (allowBlank) s.appendChild(h("option", { value: "" }, "none"));
      options.forEach(o => { const opt = h("option", { value: o.value }, o.label); if (o.value === (value || "")) opt.selected = true; s.appendChild(opt); });
      return s;
    };
    const allTeams = data.process.teams || {}, allCats = data.taxonomy.categories || {}, allWastes = data.taxonomy.wasteTypes || {};
    const teams = Object.keys(allTeams).map(id => ({ value: id, label: allTeams[id].label }));
    const cats = Object.keys(allCats).map(id => ({ value: id, label: allCats[id].label }));
    const wastes = Object.keys(allWastes).map(id => ({ value: id, label: allWastes[id].label }));
    const phases = (data.process.phases || []).map(p => ({ value: p.id, label: p.label }));
    form.appendChild(h("h3", null, "Edit activity"));
    form.appendChild(field("Name", h("input", { name: "name", class: "input", value: a.name || "" })));
    form.appendChild(h("div", { class: "edit-row" },
      field("Current (" + unitName + ")", h("input", { name: "current", class: "input", type: "number", step: "0.5", min: "0", value: a.duration ? a.duration.current : 0 })),
      field("Optimal (" + unitName + ")", h("input", { name: "optimal", class: "input", type: "number", step: "0.5", min: "0", value: a.duration ? a.duration.optimal : 0 }))));
    form.appendChild(h("div", { class: "edit-row" }, field("Owner", sel("owner", teams, a.owner)), field("Phase", sel("phase", phases, a.phase))));
    form.appendChild(h("div", { class: "edit-row" }, field("Category", sel("category", cats, a.category)), field("Waste type", sel("waste", wastes, a.waste, true))));
    form.appendChild(field("Predecessors (ids, ; separated)", h("input", { name: "predecessors", class: "input", value: (a.predecessors || []).join("; ") })));
    form.appendChild(field("Notes", h("textarea", { name: "notes", class: "input", rows: 2 }, a.notes || "")));
    form.appendChild(h("div", { class: "edit-actions" },
      h("button", { type: "submit", class: "primary" }, "Save changes"),
      h("span", { class: "hint" }, "Saved in this browser. Changing totals scales the existing lead/cycle split proportionally. Export to keep a copy.")));
    return form;
  }
  function applyEdit(id, form) {
    const f = form.elements;
    const candidate = VSM.deepClone(data.process);
    const act = candidate.activities.find(x => x.id === id);
    if (!act) return;
    const num = v => String(v).trim() === "" ? NaN : Number(v);
    act.name = f.name.value.trim() || act.name;
    VSM.schedule.setDuration(act, { current: num(f.current.value), optimal: num(f.optimal.value) });
    act.owner = f.owner.value || undefined;
    act.phase = f.phase.value || undefined;
    act.category = f.category.value || "value";
    if (f.waste.value) act.waste = f.waste.value; else delete act.waste;
    act.predecessors = f.predecessors.value.split(/[;,]/).map(x => x.trim()).filter(Boolean);
    if (f.notes.value.trim()) act.notes = f.notes.value.trim(); else delete act.notes;
    const issues = VSM.validate.run(candidate, data.taxonomy, data.scenario);
    if (issues.errors.length) { renderIssues(issues); toast("Edit not saved: " + issues.errors[0], true); return; }
    try { saveProcessOverride(candidate, "edited"); }
    catch (e) { toast("Edit not saved: " + e.message, true); return; }
    data.process = candidate;
    rebuild();
    toast("Saved " + act.name);
  }
  /* The saved override must be a plain object. A stored scalar or array parses
     without throwing and then silently discards anything assigned to it. */
  function readOverride() {
    let o = null;
    try { o = JSON.parse(localStorage.getItem(DATA_KEY) || "null"); } catch (e) { o = null; }
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  }
  /* Write it, then read it back. Assigning to a primitive is a silent no-op in
     sloppy mode, an array loses the property in JSON.stringify, and a storage
     that accepts a write and drops it never throws, so "setItem did not throw"
     is not the same as "the edit is saved". Every write of the override goes
     through here; checking only one of the three call sites left the other two
     able to report success over data that was never stored. */
  function writeOverride(o) {
    localStorage.setItem(DATA_KEY, JSON.stringify(o));
    const back = readOverride();
    const kept = Object.keys(o).every(k => back[k] !== undefined);
    if (!kept) throw new Error("the browser did not keep the change (storage returned something unexpected)");
    return back;
  }
  /* The triple loadData() will rebuild on the next startup. It falls back to
     the SHIPPED data for anything the override does not carry, so a process
     checked against whatever is live right now can still be broken against the
     set that actually loads: with a folder linked, the live taxonomy is the
     folder's and is never persisted. Pin anything that did not come from the
     shipped files into the override so the saved set is self-consistent. */
  function pinLiveData(override) {
    if (data.taxonomy !== VSM.data.taxonomy) override.taxonomy = data.taxonomy;
    if (data.scenario !== VSM.data.scenario) override.scenario = data.scenario;
    return override;
  }
  function saveProcessOverride(process, how) {
    const override = pinLiveData(readOverride());
    const issues = VSM.validate.run(process,
      override.taxonomy || VSM.data.taxonomy,
      override.scenario || VSM.data.scenario);
    if (issues.errors.length) throw new Error(issues.errors[0]);
    override.process = process;
    override.processSource = how || "loaded";
    writeOverride(override);
    $("#data-source").textContent = "Process data " + (how === "edited" ? "edited in this browser" : "loaded from a file") + " (not the shipped file). Export ▾ → Download data/process.data.js to keep it.";
    $("#btn-reset-data").hidden = false;
  }

  /* ------------------------------------------------------------ export + data loading */
  function slug(s) { return String(s || "value-stream").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""); }
  function exportTarget() {
    const presenting = document.body.classList.contains("presenting");
    if (!presenting) {
      // exports always use the 16:9 presentation composition
      if (state.view === "tracker") {
        return VSM.progressRender.draw(model, track, { layout: VSM.progressRender.presentation(), theme: state.theme, scenarioSummary: scenarioSummary() });
      }
      const L = VSM.layout.presentation(model.nodes.length, { showMetrics: state.display.presentMetrics, columns: state.display.presentColumns });
      return VSM.render.draw(model, { layout: L, view: state.view, display: state.display, filters: filtersForRender(), scenarioSummary: scenarioSummary(), theme: state.theme });
    }
    return presentSvg;
  }
  function toast(msg, isError) {
    const t = $("#toast");
    t.textContent = msg; t.classList.toggle("error", !!isError); t.hidden = false;
    clearTimeout(t._timer); t._timer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  /* A real preview dialog instead of confirm()'s wall of text: the summary
     lines as a list, warnings marked, Apply / Cancel. Headless hosts (the
     Node test VM, odd embeds) have no document.body, and there the native
     confirm keeps the same handlers runnable unchanged. */
  function ask(lines, applyLabel) {
    if (!document.body) return Promise.resolve(confirm(lines.join("\n")));
    return new Promise(resolve => {
      const done = v => { overlay.remove(); document.removeEventListener("keydown", onKey); resolve(v); };
      const onKey = e => { if (e.key === "Escape") done(false); };
      document.addEventListener("keydown", onKey);
      const overlay = h("div", { class: "overlay", role: "dialog", "aria-modal": "true" });
      overlay.addEventListener("click", e => { if (e.target === overlay) done(false); });
      const body = h("div", { class: "overlay-body" });
      let list = null;
      lines.forEach((ln, i) => {
        const s = String(ln === null || ln === undefined ? "" : ln);
        if (i === 0) return;                                   // the title
        if (!s.trim()) { list = null; return; }                // blank = paragraph break
        if (/^[•·]\s/.test(s)) {
          if (!list) { list = h("ul"); body.appendChild(list); }
          list.appendChild(h("li", { class: /warning|error|not a number|does not exist|duplicate/i.test(s) ? "warn" : "" }, s.replace(/^[•·]\s/, "")));
          return;
        }
        list = null;
        body.appendChild(h("p", { class: /^warnings?\s*\(/i.test(s) ? "warn-head" : "" }, s));
      });
      overlay.appendChild(h("div", { class: "overlay-box" },
        h("div", { class: "overlay-head" },
          h("h2", null, String(lines[0] || "Confirm")),
          h("button", { class: "icon", type: "button", title: "Cancel", onclick: () => done(false) }, "×")),
        body,
        h("div", { class: "overlay-foot" },
          h("button", { class: "ghost", type: "button", onclick: () => done(false) }, "Cancel"),
          h("button", { class: "primary", type: "button", onclick: () => done(true) }, applyLabel || "Apply"))));
      document.body.appendChild(overlay);
      const b = overlay.querySelector(".primary");
      if (b) b.focus();
    });
  }
  async function doExport(kind) {
    const name = slug(data.process.title) + "-" + state.view;
    try {
      if (kind === "png") { await VSM.exporter.exportPNG(exportTarget(), name + "-1920x1080.png", 1); toast("PNG exported (1920×1080)"); }
      else if (kind === "png2x") { await VSM.exporter.exportPNG(exportTarget(), name + "-3840x2160.png", 2); toast("PNG exported (3840×2160)"); }
      else if (kind === "svg") { VSM.exporter.exportSVG(exportTarget(), name + ".svg"); toast("SVG exported"); }
      else if (kind === "copy") { await VSM.exporter.copyPNG(exportTarget(), 2); toast("Copied to clipboard as PNG"); }
      else if (kind === "json") { VSM.exporter.exportJSON({ process: data.process, taxonomy: data.taxonomy, scenario: data.scenario }, slug(data.process.title) + ".json"); toast("JSON exported"); }
      else if (kind === "xlsx") { VSM.exportWorkbook.exportXLSX(model, exportOpts(), slug(data.process.title) + "-value-stream.xlsx"); toast("Excel workbook exported in the Task List format"); }
      else if (kind === "csv") { VSM.exportWorkbook.exportCSV(model, exportOpts(), slug(data.process.title) + "-task-list.csv"); toast("CSV exported in the Task List format"); }
      else if (kind === "simple") { VSM.table.exportXLSX(data.process, slug(data.process.title) + "-activities.xlsx"); toast("Editable workbook exported — change it in Excel and Import it straight back"); }
      else if (kind === "simplecsv") { VSM.table.exportCSV(data.process, slug(data.process.title) + "-activities.csv"); toast("Editable CSV exported — change it and Import it straight back"); }
      else if (kind === "template") { VSM.table.exportXLSX(starterTemplate(), "flowline-starter-template.xlsx"); toast("Starter template exported — fill in the Activities sheet and Import it"); }
      else if (kind === "datajs") { VSM.exporter.download(new Blob([processDataJS(data.process)], { type: "text/javascript" }), "process.data.js"); toast("process.data.js downloaded: replace the copy in the data folder"); }
    } catch (e) { toast("Export failed: " + e.message, true); }
  }
  /* What the exporter needs to name the scenario and write the tailoring tabs. */
  function exportOpts() {
    return { scenarioCfg: data.scenario, scenarioSummary: scenarioSummary() };
  }
  /* Three example rows that show every column in use, for starting a value
     stream from a blank sheet. The Columns tab in the workbook explains each
     field; these rows show the shape (a dependency, a rule, a status). */
  function starterTemplate() {
    return {
      title: "My Value Stream",
      units: "business days",
      phases: [{ id: "plan", label: "Plan" }, { id: "build", label: "Build" }, { id: "run", label: "Run" }],
      teams: { "team-a": { label: "Team A", org: "Org 1" }, "team-b": { label: "Team B", org: "Org 2" } },
      activities: [
        { id: "step-1", name: "First step", phase: "plan", owner: "team-a", category: "value",
          duration: { current: 5, optimal: 2 }, predecessors: [], status: "done",
          description: "Replace these three rows with your process. id must be unique; predecessors reference ids." },
        { id: "step-2", name: "Approval gate example", phase: "plan", owner: "team-b", category: "approval",
          duration: { current: 3, optimal: 1 }, predecessors: ["step-1"], status: "doing", progress: 50,
          description: "category approval draws the decision diamond. The owner change from Team A is detected as a handoff." },
        { id: "step-3", name: "Build step example", phase: "build", owner: "team-a", category: "value",
          duration: { current: 10, optimal: 8 }, predecessors: ["step-2"],
          description: "Leave status blank until the work starts; the Tracker view fills in as statuses are set." }
      ]
    };
  }
  function processDataJS(process) {
    return "/* PROCESS DATA (the value stream). Plain JSON inside the VSM.register wrapper.\n" +
      "   Generated by Flowline on " + new Date().toISOString().slice(0, 10) + ".\n" +
      "   Edit, save, reload the page. See README.md for the field reference. */\n" +
      "VSM.register(\"process\", " + JSON.stringify(process, null, 2) + ");\n";
  }
  function loadFile(file) {
    if (/\.json$/i.test(file.name)) return loadJSONFile(file);
    if (/\.(xlsx|csv)$/i.test(file.name)) return loadTableFile(file);
    toast("Unsupported file type: use .xlsx, .csv or .json", true);
  }
  /* Does this workbook look like a workload onboarding source rather than
     one of our own Activities exports? Decided by the headers, not the file
     name, so a renamed copy still imports correctly. */
  function looksLikeSourceWorkbook(sheets) {
    for (const name of Object.keys(sheets)) {
      const m = sheets[name];
      if (!m || !m.length) continue;
      const h = VSM.schema.matchHeaders(m[0], VSM.schema.TASK);
      if (h.index.id !== undefined && h.index.name !== undefined &&
          h.index.leadCur !== undefined && h.index.cycleCur !== undefined) return true;
    }
    return false;
  }

  async function loadSourceWorkbook(file, sheets) {
    const r = VSM.import.fromSheets(sheets, { source: file.name });
    if (r.report.errors.length) { toast("Could not import " + file.name + ": " + r.report.errors[0], true); return; }
    const issues = VSM.validate.run(r.process, r.taxonomy, r.scenario);
    if (issues.errors.length) { renderIssues(issues); toast("Could not import " + file.name + ": " + issues.errors[0], true); return; }
    const c = r.report.counts, t = r.report.totals;
    const lines = [
      "Import " + file.name + "?", "",
      "This replaces the whole data set: activities, teams, phases, the waste taxonomy and the scenario switches.", "",
      c.tasks + " tasks · " + c.phases + " phases · " + c.teams + " teams",
      c.gates + " approval gates · " + c.handoffs + " declared handoffs · " + c.rework + " rework loops",
      c.edges + " dependency edges (" + c.edgesAdded + " added beyond the Predecessor IDs column)",
      c.conditions + " condition switches built from the Applies When column", "",
      "Elapsed = lead + cycle: " + t.elapsedCurrent + " h now, " + t.elapsedOptimal + " h optimized",
      "Flow efficiency " + t.flowEfficiency + "% → " + t.flowEfficiencyOptimal + "%"
    ];
    if (r.report.unmappedList.length) {
      lines.push("", "Values outside the known lists (" + r.report.unmappedList.length + "):",
        ...r.report.unmappedList.slice(0, 8).map(u => "• " + u.list + ": \"" + u.value + "\" ×" + u.count));
    }
    if (r.report.warnings.length) {
      lines.push("", "Warnings (" + r.report.warnings.length + "):",
        ...r.report.warnings.slice(0, 8).map(w => "• " + w), r.report.warnings.length > 8 ? "…" : "");
    }
    if (!await ask(lines, "Import")) { toast("Import cancelled"); return; }

    const override = readOverride();
    override.process = r.process; override.taxonomy = r.taxonomy; override.scenario = r.scenario;
    try { writeOverride(override); }
    catch (e) { toast("Import not saved: " + e.message, true); return; }
    lastImportReport = r.report;
    if (init()) toast("Imported " + file.name + " — " + c.tasks + " tasks, " + c.phases + " phases");
  }

  async function loadTableFile(file) {
    let sheets = null;
    if (/\.(xlsx|csv)$/i.test(file.name)) {
      try {
        if (/\.xlsx$/i.test(file.name)) {
          if (file.size > VSM.table.XLSX_LIMITS.compressedBytes) throw new Error("Workbook exceeds the 16 MB input limit");
          sheets = await VSM.table.parseXLSX(await file.arrayBuffer());
        } else sheets = { "Task List": VSM.table.parseCSV(await file.text()) };
      }
      catch (e) { toast("Could not read " + file.name + ": " + e.message, true); return; }
    }
    return importSheets(sheets, file);
  }
  /* One routing point for parsed sheets, whether they came from a file or
     from the clipboard: source workbooks replace the data set, anything else
     applies as an activities table.

     An IMPORTED FILE is authoritative - rows are updated, added and removed
     to match it, as always. A PASTE is not: the whole point of pasting is
     copying a few rows out of a bigger sheet, and treating that as the
     complete list would delete everything not pasted. Pasted rows therefore
     update and add, never remove. */
  async function importSheets(sheets, file, opts) {
    if (sheets && looksLikeSourceWorkbook(sheets)) return loadSourceWorkbook(file, sheets);
    const merge = !!(opts && opts.merge);
    try {
      const r = await VSM.table.importFile(file, data.process, sheets);
      if (merge && !r.data) {
        const existing = data.process.activities || [];
        const existingIds = new Set(existing.map(a => a.id));
        const incoming = new Map(r.activities.map(a => [a.id, a]));
        r.activities = existing.map(a => incoming.get(a.id) || a)
          .concat(r.activities.filter(a => !existingIds.has(a.id)));
        r.summary = {
          updated: [...incoming.keys()].filter(id => existingIds.has(id)).length,
          added: [...incoming.keys()].filter(id => !existingIds.has(id)).length,
          removed: 0
        };
        /* re-check predecessor references against the MERGED list: a pasted
           row may point at a row it did not bring along, which is fine now */
        const mergedIds = new Set(r.activities.map(a => a.id));
        r.problems = r.problems.filter(p => {
          const m = /predecessor '([^']+)' does not exist/.exec(p);
          return !m || !mergedIds.has(m[1]);
        });
      }
      const lines = ["Apply " + file.name + "?", "",
        merge ? r.summary.updated + " activities updated, " + r.summary.added + " added. Pasted rows merge in; nothing is removed."
          : r.summary.updated + " activities updated, " + r.summary.added + " added, " + r.summary.removed + " removed."];
      if (r.teams) lines.push("Teams sheet replaces " + Object.keys(r.teams).length + " teams.");
      if (r.phases) lines.push("Phases sheet replaces " + r.phases.length + " phases.");
      if (r.problems.length) lines.push("", "Warnings (" + r.problems.length + "):", ...r.problems.slice(0, 12).map(p => "• " + p), r.problems.length > 12 ? "…" : "");
      if (!await ask(lines, "Apply")) { toast("Import cancelled"); return; }
      const process = VSM.deepClone(data.process);
      process.activities = r.activities;
      if (r.teams) process.teams = r.teams;
      if (r.phases) process.phases = r.phases;
      process.version = new Date().toISOString().slice(0, 10);
      saveProcessOverride(process, "loaded");
      if (init()) toast("Imported " + file.name + ": " + r.activities.length + " activities");
    } catch (e) { toast("Could not import " + file.name + ": " + e.message, true); }
  }
  function loadJSONFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        const override = pinLiveData(readOverride());
        if (obj.process || obj.taxonomy || obj.scenario) Object.assign(override, obj);
        else if (obj.activities) override.process = obj;
        else if (obj.families) override.taxonomy = obj;
        else if (obj.attributes) override.scenario = obj;
        else throw new Error("Unrecognized JSON: expected activities, families, attributes, or a bundle");
        /* Validate the triple loadData() will rebuild on the next startup,
           which falls back to the SHIPPED data, not to whatever happens to be
           live right now. Checking against live data passes a partial override
           that is broken against the shipped files, persists it, and breaks
           every later page load. */
        let issues;
        try {
          issues = VSM.validate.run(override.process || VSM.data.process,
                                    override.taxonomy || VSM.data.taxonomy,
                                    override.scenario || VSM.data.scenario);
        } catch (err) { throw new Error("the file could not be checked: " + err.message); }
        if (issues.errors.length) { renderIssues(issues); throw new Error(issues.errors[0]); }
        writeOverride(override);
        /* Only claim success if init() actually accepted the data; toast()
           writes one shared element, so an unconditional success message here
           would paint over the error init() just raised. */
        if (init()) toast("Loaded " + file.name);
      } catch (e) { toast("Could not load JSON: " + e.message, true); }
    };
    reader.readAsText(file);
  }

  /* ------------------------------------------------------------ linked data folder
     Link once, then edit the files in an editor and press Reload, or edit in the
     app and press Save. Chrome and Edge only; the Load / Download buttons are the
     fallback everywhere else. */
  function applyLoadedData(loaded, message) {
    const candidate = {
      process: loaded.process || data.process,
      taxonomy: loaded.taxonomy || data.taxonomy,
      scenario: loaded.scenario || data.scenario
    };
    const issues = VSM.validate.run(candidate.process, candidate.taxonomy, candidate.scenario);
    lastIssues = issues;
    if (issues.errors.length) {
      renderIssues(issues);
      /* The folder is already linked at this point (files.js set the mode and
         stored the handle), so the panel has to say so. Without this the user
         is told they are on the shipped data and Reload, Save and Unlink stay
         hidden, which leaves no way to fix or drop the folder. */
      describeSource();
      toast(issues.errors.length + " error" + (issues.errors.length === 1 ? "" : "s") + " in the folder's data; the previous version is still shown", true);
      return false;
    }
    // a linked folder is the source of truth, so drop any browser-held override
    localStorage.removeItem(DATA_KEY);
    data = candidate;
    /* The incoming data may declare a different toggle vocabulary. Same
       filter as startup: keep what still applies, default the rest. */
    state.scenario = mergeScenario(data.scenario.attributes, state.scenario);
    if (state.profile && !(data.scenario.presets || []).some(p => p.id === state.profile)) state.profile = null;
    describeSource(null);
    buildScenarioControls();
    buildOwnerFilter();
    selectedId = null; $("#details").hidden = true;
    rebuild();
    if (message) toast(message);
    return true;
  }
  async function linkFolder() {
    try {
      const loaded = await VSM.files.link();
      if (!loaded) return;                       // picker cancelled
      applyLoadedData(loaded, "Linked to " + VSM.files.state.label + ". Edit the files and press Reload.");
    } catch (e) { toast(e.message, true); describeSource(); }
  }
  async function reloadFolder() {
    try {
      const loaded = await (VSM.files.state.mode === "linked" ? VSM.files.reload() : VSM.files.reconnect());
      if (!loaded) { toast("No folder is linked", true); return; }
      applyLoadedData(loaded, "Reloaded from " + VSM.files.state.label);
    } catch (e) { toast(e.message, true); describeSource(); }
  }
  async function saveFolder() {
    try {
      const written = await VSM.files.save(data, "Saved from the app");
      describeSource(null);
      toast(written.length ? "Saved " + written.join(", ") + " to " + VSM.files.state.label : "No changes to save");
    } catch (e) { toast(e.message, true); }
  }
  async function startupFolder() {
    if (!VSM.files.supported()) return;
    let r = null;
    try { r = await VSM.files.restore(); } catch (e) { return; }
    if (!r) return;
    if (r.data) applyLoadedData(r.data, "Reconnected to " + VSM.files.state.label);
    else { describeSource(); if (r.error) toast("Linked folder: " + r.error, true); }
  }

  /* ------------------------------------------------------------ init */
  function bindOnce() {
    document.querySelectorAll("[data-view]").forEach(b => b.onclick = () => setView(b.dataset.view));
    $("#btn-present").onclick = enterPresentation;
    $("#btn-theme").onclick = toggleTheme;
    $("#btn-theme-present").onclick = toggleTheme;
    $("#btn-exit-present").onclick = exitPresentation;
    document.addEventListener("keydown", e => { if (e.key === "Escape" && document.body.classList.contains("presenting")) exitPresentation(); });
    document.querySelectorAll("[data-export]").forEach(b => b.onclick = () => { closeMenus(); doExport(b.dataset.export); });

    /* The Export menu opens on click and stays open until an item is chosen or
       the pointer lands somewhere else. The old CSS :hover version closed as
       soon as the cursor strayed off the button, including while crossing the
       gap down to the first item, which made it near impossible to use. */
    document.querySelectorAll(".menu").forEach(menu => {
      const btn = menu.querySelector("button");
      if (!btn) return;
      btn.onclick = e => {
        e.stopPropagation();
        const open = menu.classList.toggle("open");
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        document.querySelectorAll(".menu").forEach(m => { if (m !== menu) closeMenu(m); });
      };
    });
    document.addEventListener("click", e => { if (!e.target.closest(".menu")) closeMenus(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenus(); });
    $("#btn-sidebar").onclick = () => { state.sidebar = !state.sidebar; applyPanels(); saveState(); setTimeout(renderChart, 220); };
    $("#btn-metrics").onclick = () => { state.metricsPanel = !state.metricsPanel; applyPanels(); saveState(); setTimeout(renderChart, 60); };
    $("#file-json").onchange = e => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ""; };
    $("#btn-reset-data").onclick = () => { localStorage.removeItem(DATA_KEY); init(); toast("Back to the shipped data files"); };
    $("#btn-link-folder").onclick = linkFolder;
    $("#btn-reload-folder").onclick = reloadFolder;
    $("#btn-save-folder").onclick = saveFolder;
    $("#btn-unlink-folder").onclick = async () => { await VSM.files.unlink(); init(); toast("Folder unlinked"); };
    if (!VSM.files.supported()) {
      $("#btn-link-folder").disabled = true;
      $("#btn-link-folder").title = "Folder linking needs Chrome or Edge. Use Load and Export here.";
    }
    $("#btn-reset-state").onclick = () => { localStorage.removeItem(STATE_KEY); init(); };
    document.addEventListener("dragover", e => { e.preventDefault(); });
    document.addEventListener("drop", e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) loadFile(f); });
    /* Paste straight from Excel / Google Sheets: copied cells arrive as
       tab-separated text with a header row, and go through the same preview
       as a dropped file. The largest friction cut there is: no export, no
       save-as, no file picker - copy, click the page, paste. */
    document.addEventListener("paste", e => {
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (document.querySelector(".overlay")) return;         // a dialog owns its own paste
      const txt = e.clipboardData && e.clipboardData.getData ? e.clipboardData.getData("text/plain") : "";
      if (!txt || txt.indexOf("\n") < 0) return;              // one line is not a table
      const matrix = txt.indexOf("\t") >= 0
        ? txt.replace(/\r/g, "").split("\n").map(l => l.split("\t")).filter(r => r.some(v => String(v).trim() !== ""))
        : VSM.table.parseCSV(txt);
      if (matrix.length < 2) return;
      const heads = matrix[0].map(x => String(x || "").trim().toLowerCase());
      if (!heads.includes("id")) { toast("Pasted table not recognised: the first row must be headers including 'id' (see the starter template in Export)", true); return; }
      if (!heads.includes("name") && !heads.includes("task")) { toast("Pasted table needs a 'name' (or 'Task') column beside 'id'", true); return; }
      e.preventDefault();
      importSheets({ "Pasted": matrix }, { name: "pasted table (" + (matrix.length - 1) + " row" + (matrix.length === 2 ? "" : "s") + ")" }, { merge: true });
    });
    $("#btn-designer").onclick = () => VSM.designer.open(data, {
      onApply: candidate => {
        try { saveProcessOverride(candidate, "edited"); }
        catch (e) { toast("Not applied: " + e.message, true); return false; }
        data.process = candidate;
        buildOwnerFilter();
        rebuild();
        toast("Process structure updated");
      }
    });
    let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(renderChart, 120); });
    bindTooltip();
  }

  function init() {
    const ok = loadData();
    loadState();
    $("#title").textContent = data.process.title || "Value Stream";
    $("#subtitle").textContent = data.process.subtitle || "";
    document.title = (data.process.title ? data.process.title + " · " : "") + "Flowline - Value Stream Timeline";
    applyPanels();
    applyTheme();
    document.querySelectorAll("[data-view]").forEach(b => b.classList.toggle("on", b.dataset.view === state.view));
    buildScenarioControls();
    buildOwnerFilter();
    bindDisplayControls();
    selectedId = null; $("#details").hidden = true;
    rebuild();
    return ok;
  }

  window.addEventListener("DOMContentLoaded", () => { bindOnce(); init(); startupFolder(); });
  // small public surface for tests / console use
  VSM.app = { getModel: () => model, getState: () => state, getData: () => data, getIssues: () => lastIssues, rebuild, setView, toggleTheme, enterPresentation, exitPresentation, exportTarget, applyLoadedData };
})();
