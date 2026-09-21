/* ============================================================================
   WORKBOOK IMPORT  -  the source workbook -> the app's model.
   ----------------------------------------------------------------------------
   This reads the workbook as it actually is rather than asking anyone to
   reshape it: Task List, Edges, Assumptions. Column names come from
   js/schema.js, which is the only file to edit when a header changes.

   The three decisions worth knowing about, because they are judgement calls
   and the report names each one:

   1. ELAPSED TIME = LEAD + CYCLE.
      The workbook's Lead Time column is wait-only, not total elapsed. That is
      not an assumption: Flow Efficiency in the Summary tab matches
      cycle / (lead + cycle) to the decimal across every phase, which it only
      can if lead excludes touch time. So a bar's length is lead + cycle, its
      solid part is cycle (hands on the work) and its hatched part is lead
      (waiting). Reading lead as total elapsed would overstate flow efficiency -
      889/7992 = 11.1% against a true 10.0%.

   2. THE "APPLIES WHEN" PHRASES BECOME THE SCENARIO SWITCHES.
      Each distinct phrase other than the always-phrases turns into one on/off
      control. No rule grammar to hand-write: add a phrase in Excel, get a
      switch. They default to on, so the first render is the whole 146 rows.

   3. TEAM TOPOLOGIES TYPE IS USED AS THE ORGANIZATION BOUNDARY.
      Cross-boundary handoffs are then Platform -> Governance and the like,
      which is the boundary that actually costs time here. The Assigned Team
      is still the owner and still what swim lanes group by.

   Nothing is silently dropped. Values outside a picklist, unknown headers and
   unresolvable predecessors are all collected in `report` and shown.
   ========================================================================== */
(function (root) {
  const VSM = root.VSM = root.VSM || {};
  const S = VSM.schema;

  /* phrases meaning "this step is always in scope" */
  const ALWAYS = ["every workload", "all", "all lanes", "always", "n/a", "-", ""];

  const slug = s => String(s == null ? "" : s).toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "x";
  const txt = v => String(v === undefined || v === null ? "" : v).trim();
  /* A BLANK CELL IS NOT ZERO. Number("") is 0 and isFinite(0) is true, so this
     used to answer 0 for an empty cell and null only for genuine text. Three
     fallbacks downstream test for null and so never fired: a blank Optimized
     column became an optimized time of zero rather than falling back to the
     current time, a blank %C&A became a recorded "0% complete and accurate",
     and a workbook with no CPM columns at all got a full set of zeroed source
     figures that reconcile() then reported as a total disagreement. */
  const num = v => {
    const s = String(v === undefined || v === null ? "" : v).replace(/,/g, "").trim();
    if (s === "") return null;
    const n = Number(s);
    return isFinite(n) ? n : null;
  };

  /* slug() truncates at 48 characters, so two long phrases that differ only
     after that point collapse onto one id. That produced duplicate scenario
     attribute ids and a model the app's own validator then rejected. A
     namespaced slugger remembers what it has handed out: the same text always
     gets the same id, and different text never shares one. */
  function slugger() {
    const byText = new Map(), used = new Set();
    return raw => {
      const key = String(raw === undefined || raw === null ? "" : raw).trim();
      if (byText.has(key)) return byText.get(key);
      const base = slug(key);
      let id = base, n = 2;
      while (used.has(id)) id = base.slice(0, 44) + "-" + (n++);
      used.add(id); byText.set(key, id);
      return id;
    };
  }

  /* --------------------------------------------------------------- taxonomy
     Built from the workbook's own vocabulary, not ours. The bar glyph for a
     waste is its letter in DOWNTIME, so the letter carries the meaning and
     colour is never the only signal - which also survives printing. */
  function buildTaxonomy() {
    return {
      families: {
        value:          { label: "Value-adding work",           optimal: "#3B82F6", excess: "#93C5FD" },
        bnva:           { label: "Business non-value-add",      optimal: "#8B9BB4", excess: "#CBD5E1" },
        muda2:          { label: "Waste (Type 2 Muda)",         optimal: "#B91C1C", excess: "#FCA5A5" },
        approval:       { label: "Approval / governance",       optimal: "#22C55E", excess: "#86EFAC" },
        handoff:        { label: "Handoff",                     optimal: "#A855F7", excess: "#D8B4FE" },
        rework:         { label: "Rework loop",                 optimal: "#EF4444", excess: "#FCA5A5" },
        defects:        { label: "Defects",                     optimal: "#DC2626", excess: "#FCA5A5" },
        overproduction: { label: "Overproduction",              optimal: "#EC4899", excess: "#F9A8D4" },
        waiting:        { label: "Waiting",                     optimal: "#F59E0B", excess: "#FDE68A" },
        talent:         { label: "Non-utilized talent",         optimal: "#06B6D4", excess: "#A5F3FC" },
        transportation: { label: "Transportation",              optimal: "#8B5CF6", excess: "#DDD6FE" },
        inventory:      { label: "Inventory (work in progress)", optimal: "#F97316", excess: "#FDBA74" },
        motion:         { label: "Motion",                      optimal: "#84CC16", excess: "#D9F99D" },
        extraprocessing:{ label: "Extra-processing",            optimal: "#6366F1", excess: "#C7D2FE" }
      },
      categories: {
        value:     { label: "Value-Add",                            family: "value",    code: "V" },
        bnva:      { label: "Business non-value-add (Type 1 Muda)",  family: "bnva",     code: "B" },
        waste:     { label: "Waste (Type 2 Muda)",                   family: "muda2",    code: "W" },
        gate:      { label: "Approval gate",                         family: "approval", code: "A", gate: true },
        handoff:   { label: "Handoff",                               family: "handoff",  code: "H" },
        rework:    { label: "Rework loop",                           family: "rework",   code: "R" },
        milestone: { label: "Milestone",                             family: "value",    code: "M" }
      },
      /* the eight wastes; code = the letter of DOWNTIME */
      wasteTypes: {
        defects:         { label: "Defects",                 family: "defects",         code: "D", description: "Work that has to be corrected: rejected submissions, failed reviews, incorrect requests." },
        overproduction:  { label: "Overproduction",          family: "overproduction",  code: "O", description: "Producing more, sooner or in more detail than the next step needs." },
        waiting:         { label: "Waiting",                 family: "waiting",         code: "W", waiting: true, description: "Idle time: queues for a reviewer, a board slot, a response, an environment." },
        talent:          { label: "Non-utilized talent",     family: "talent",          code: "N", description: "Skilled people doing work below their capability, or not consulted where they would help." },
        transportation:  { label: "Transportation",          family: "transportation",  code: "T", description: "Moving work, artefacts or requests between teams, tools and tickets." },
        inventory:       { label: "Inventory",               family: "inventory",       code: "I", waiting: true, description: "Work in progress sitting in queues, backlogs and part-finished requests." },
        motion:          { label: "Motion",                  family: "motion",          code: "M", description: "People switching between systems, re-entering the same data, hunting for information." },
        extraprocessing: { label: "Extra-processing",        family: "extraprocessing", code: "E", description: "Steps beyond what the outcome requires: duplicate reviews, re-approvals, unused detail." }
      },
      markers: {
        handoff:         { label: "Handoff (same topology type)",       shape: "ring" },
        handoffCrossOrg: { label: "Handoff across topology types",      shape: "ring-dot" },
        gate:            { label: "Approval / decision point",          shape: "diamond" },
        milestone:       { label: "Milestone (no duration)",            shape: "diamond-outline" }
      }
    };
  }

  /* ------------------------------------------------------------------ sheets */
  function pickSheets(sheets) {
    const found = {};
    Object.keys(sheets).forEach(name => {
      const key = S.sheetByName(name);
      if (key && !found[key]) found[key] = { name, matrix: sheets[name] };
    });
    if (!found.tasks) {
      // fall back to the first sheet that has an ID and a Task column
      for (const name of Object.keys(sheets)) {
        const m = sheets[name];
        if (!m || !m.length) continue;
        const h = S.matchHeaders(m[0], S.TASK);
        if (h.index.id !== undefined && h.index.name !== undefined) { found.tasks = { name, matrix: m }; break; }
      }
    }
    return found;
  }

  function readSheet(sheet, columns, report, label) {
    if (!sheet || !sheet.matrix || sheet.matrix.length < 2) return [];
    const h = S.matchHeaders(sheet.matrix[0], columns);
    h.unknown.forEach(u => report.notes.push(label + ": column '" + u + "' is not in the schema and was ignored."));
    h.missing.forEach(k => report.errors.push(label + ": no column found for '" + k + "'."));
    if (h.missing.length) return [];
    return sheet.matrix.slice(1).map((row, i) => {
      const o = { __row: i + 2 };
      columns.forEach(c => { const idx = h.index[c.key]; o[c.key] = idx === undefined ? "" : (row[idx] === undefined ? "" : row[idx]); });
      return o;
    }).filter(o => Object.keys(o).some(k => k !== "__row" && txt(o[k]) !== ""));
  }

  /* ====================================================================
     TAILORING: Toggles + Profiles + Scenario Matrix
     --------------------------------------------------------------------
     A project is one PROFILE (what kind of work is this) plus any number of
     MODIFIERS (is there AI in it, is there a discovery phase, is there
     hardware to buy). They are deliberately different things:

       - A profile DECLARES values for some toggles and stays silent on the
         rest. Switching profile therefore leaves a modifier it never
         mentioned exactly where the person put it. That is what makes
         "greenfield build, and by the way it involves AI" expressible
         without a separate profile for every combination.

       - The model is recomputed from the whole current state every time,
         never mutated step by step, so picking the profile first and the
         modifier second gives the identical answer to doing it the other way
         round. A test asserts that, because a tailoring tool whose answer
         depends on click order is not a policy, it is a guess.

     Cell grammar is in schema.parseCell: blank / R / N / a multiplier.
     Resolution: a task is in if Baseline says so or any live toggle requires
     it, and out only if nothing live requires it and something live excludes
     it. R BEATS N, ALWAYS, and the collision is reported by name. A
     governance tool that can silently drop a control because two toggles
     disagreed is a tool that will eventually embarrass somebody.
     ==================================================================== */

  function readToggles(sheet, report) {
    if (!sheet || !sheet.matrix || sheet.matrix.length < 2) return null;
    const rows = readSheet(sheet, S.TOGGLES, report, "Toggles");
    if (!rows.length) return null;
    const out = [];
    const seenToggles = new Set();          // a scan of `out` per row is quadratic on a large sheet
    rows.forEach(r => {
      const id = txt(r.id);
      if (!id) { report.warnings.push("Toggles row " + r.__row + " has no Toggle ID and was skipped."); return; }
      if (seenToggles.has(id)) { report.warnings.push("Toggles row " + r.__row + ": duplicate toggle '" + id + "'."); return; }
      seenToggles.add(id);
      const declared = txt(r.type).toLowerCase();
      const optionList = txt(r.options).split(/\s*;\s*/).map(s => s.trim()).filter(Boolean);
      const type = declared === "choice" || declared === "enum" || (!declared && optionList.length) ? "enum"
        : declared === "multi" ? "multi" : "boolean";
      const t = {
        id, label: txt(r.label) || id, type,
        group: txt(r.group) || "Options",
        help: txt(r.help) || undefined,
        implies: txt(r.implies).split(/\s*[;,]\s*/).map(s => s.trim()).filter(Boolean)
      };
      if (type === "enum" || type === "multi") {
        if (!optionList.length) { report.warnings.push("Toggle '" + id + "' is a choice but lists no options; treated as a yes/no switch."); t.type = "boolean"; }
        else t.options = optionList.map(v => ({ value: v, label: v }));
      }
      const def = txt(r.default);
      if (t.type === "boolean") t.default = /^(y|yes|true|1|on)$/i.test(def);
      else if (t.type === "multi") t.default = def ? def.split(/\s*;\s*/).map(s => s.trim()).filter(Boolean) : [];
      else {
        t.default = def || (t.options && t.options[0] ? t.options[0].value : null);
        if (def && t.options && !t.options.some(o => o.value === def)) {
          report.warnings.push("Toggle '" + id + "': default '" + def + "' is not one of its options; using '" + t.options[0].value + "'.");
          t.default = t.options[0].value;
        }
      }
      out.push(t);
    });
    return out.length ? out : null;
  }

  /* Profiles: a header row of toggle ids, then one row per profile. A blank
     cell means the profile has no opinion, which is the whole point. */
  function readProfiles(sheet, toggles, report) {
    if (!sheet || !sheet.matrix || sheet.matrix.length < 2 || !toggles) return null;
    const header = sheet.matrix[0].map(h => txt(h));
    const fixed = S.PROFILE_FIXED.map(S.norm);
    const byId = new Map(toggles.map(t => [S.norm(t.id), t]));
    const cols = [];
    header.forEach((h, i) => {
      const n = S.norm(h);
      if (!h || fixed.indexOf(n) >= 0) return;
      const t = byId.get(n);
      if (!t) { report.warnings.push("Profiles: column '" + h + "' is not a toggle and was ignored."); return; }
      cols.push({ i, toggle: t });
    });
    const idx = k => header.findIndex(h => S.norm(h) === S.norm(k));
    const iId = idx("Profile ID"), iLabel = idx("Label"), iDesc = idx("Description");
    const out = [];
    sheet.matrix.slice(1).forEach((row, n) => {
      const id = txt(row[iId]);
      if (!id) return;
      const set = Object.create(null);
      cols.forEach(c => {
        const raw = txt(row[c.i]);
        if (raw === "") return;                              // silent: modifier survives
        const t = c.toggle;
        if (t.type === "boolean") set[t.id] = /^(y|yes|true|1|on)$/i.test(raw);
        else if (t.type === "multi") set[t.id] = raw.split(/\s*;\s*/).map(s => s.trim()).filter(Boolean);
        else {
          if (t.options && !t.options.some(o => o.value === raw)) {
            report.warnings.push("Profile '" + id + "': '" + raw + "' is not an option of toggle '" + t.id + "'.");
            return;
          }
          set[t.id] = raw;
        }
      });
      out.push({ id, label: txt(row[iLabel]) || id, description: txt(row[iDesc]) || undefined, set });
    });
    return out.length ? out : null;
  }

  /* The decision table. Returns a map taskId -> { baseline, rules[], factors[] }
     where each rule/factor carries the condition its column named. */
  function readMatrix(sheet, toggles, report) {
    if (!sheet || !sheet.matrix || sheet.matrix.length < 2 || !toggles) return null;
    const header = sheet.matrix[0].map(h => txt(h));
    const fixedNorm = S.MATRIX_FIXED.map(S.norm);
    const byId = new Map(toggles.map(t => [S.norm(t.id), t]));
    const idx = k => header.findIndex(h => S.norm(h) === S.norm(k));
    const iTask = idx("Task ID"), iBase = idx("Baseline");
    if (iTask < 0) { report.errors.push("Scenario Matrix: no 'Task ID' column."); return null; }

    const cols = [];
    header.forEach((h, i) => {
      if (!h || fixedNorm.indexOf(S.norm(h)) >= 0) return;
      const cond = S.parseCondition(h);
      const t = cond && byId.get(S.norm(cond.id));
      if (!t) { report.warnings.push("Scenario Matrix: column '" + h + "' does not name a toggle and was ignored."); return; }
      if (cond.values && t.type === "boolean") {
        report.warnings.push("Scenario Matrix: column '" + h + "' gives a value for the yes/no toggle '" + t.id + "'; the value was ignored.");
        cond.values = null;
      }
      if (cond.values && t.options) {
        const bad = cond.values.filter(v => !t.options.some(o => o.value === v));
        bad.forEach(v => report.warnings.push("Scenario Matrix: column '" + h + "' names '" + v + "', which is not an option of '" + t.id + "'."));
      }
      if (!cond.values && t.type !== "boolean") {
        report.warnings.push("Scenario Matrix: column '" + h + "' is a choice toggle with no value; write it as '" + t.id + "=<value>'. Column ignored.");
        return;
      }
      /* the rule this column stands for, in the engine's own grammar */
      const rule = cond.values
        ? (cond.values.length === 1 ? { [t.id]: cond.values[0] } : { [t.id]: { in: cond.values } })
        : { [t.id]: true };
      /* `values` is what fullScopeSet() scores choice toggles on. It was never
         set here, so both of that function's enum branches were dead code and
         the "Full scope" preset silently omitted every step reached only
         through a choice toggle. */
      cols.push({ i, header: h, toggle: t, rule, values: cond.values || null });
    });
    if (!cols.length) { report.warnings.push("Scenario Matrix has no usable toggle columns."); return null; }

    const out = new Map();
    sheet.matrix.slice(1).forEach((row, n) => {
      const id = txt(row[iTask]);
      if (!id) return;
      const entry = { baseline: iBase >= 0 ? /^(y|yes|true|1|always|base)$/i.test(txt(row[iBase])) : false, require: [], exclude: [], factors: [] };
      cols.forEach(c => {
        const cell = S.parseCell(row[c.i]);
        if (cell.effect === "none") return;
        if (cell.effect === "unknown") {
          report.warnings.push("Scenario Matrix row " + (n + 2) + " (" + id + "), column '" + c.header + "': '" + cell.raw + "' is not R, N or a number. Ignored.");
          return;
        }
        if (cell.effect === "exclude") { entry.exclude.push(c); return; }
        entry.require.push(c);
        if (cell.factor && cell.factor !== 1) entry.factors.push({ col: c, factor: cell.factor });
      });
      /* No Baseline and nothing requiring it means entryToRule() returns false
         and the task is invisible under every combination of toggles. That is
         almost always a half-filled row, and it used to happen in silence -
         the one thing this importer promises never to do. */
      if (!entry.baseline && !entry.require.length) {
        report.warnings.push("Scenario Matrix row " + (n + 2) + " (" + id + "): no Baseline and no toggle requires it, so this task can never appear. Set Baseline to Yes, or put an R in one of the toggle columns.");
      }
      out.set(id, entry);
    });
    return out;
  }

  /* The scenario that shows the complete map: every step that could ever
     apply to anything. That view matters on its own (it is what the workbook
     itself is, the master list), and it is also the only scenario the
     workbook's own CPM columns describe, so it is what reconciliation has to
     run against.

     Built rather than hand-listed: a toggle goes on exactly when it is the
     only route to some step, meaning some task with Baseline = No is required
     by it. Toggles that merely stretch durations, or that only remove steps,
     stay off, so full scope is the full task list at unmodified length. */
  function fullScopeSet(toggles, matrix) {
    const set = Object.create(null);
    if (!toggles || !matrix) return set;
    /* Where a step can be reached more than one way, take a route that does
       not also stretch it. Otherwise "show me everything" quietly inflates
       durations, and the complete map stops matching the workbook it came
       from. Only fall back to a multiplier-carrying route when it is the
       single way in. */
    const needed = new Set();
    const orphans = [...matrix.values()].filter(e => !e.baseline && e.require.length);
    orphans.forEach(e => {
      const clean = e.require.filter(c => !e.factors.some(f => f.col === c));
      if (clean.length) needed.add(clean[0]);
    });
    orphans.forEach(e => { if (!e.require.some(c => needed.has(c))) needed.add(e.require[0]); });
    /* pick the choice value that excludes the fewest steps */
    toggles.filter(t => t.type === "enum" && t.options).forEach(t => {
      const score = Object.create(null);
      t.options.forEach(o => { score[o.value] = 0; });
      matrix.forEach(entry => {
        entry.exclude.forEach(c => {
          if (c.toggle.id !== t.id || !c.values) return;
          c.values.forEach(v => { if (score[v] !== undefined) score[v]++; });
        });
      });
      let best = t.default !== null && t.default !== undefined ? t.default : t.options[0].value;
      let bestScore = score[best] === undefined ? Infinity : score[best];
      t.options.forEach(o => { if (score[o.value] < bestScore) { best = o.value; bestScore = score[o.value]; } });
      set[t.id] = best;
    });
    needed.forEach(c => {
      if (c.toggle.type === "boolean") set[c.toggle.id] = true;
      else if (c.values && c.values.length) {
        /* a choice that is the sole route to a step overrides the low-exclusion
           pick above, since without it that step can never be seen */
        if (set[c.toggle.id] === undefined || !c.values.includes(set[c.toggle.id])) set[c.toggle.id] = c.values[0];
      }
    });
    return set;
  }

  /* Turn one task's matrix entry into a `when` rule the engine can evaluate.
       in  if  baseline OR any requiring toggle is live
       out if  nothing requiring is live AND something excluding is live
     R beats N by construction: the exclusions only get a say when no
     requirement fired. */
  function entryToRule(entry) {
    const req = entry.require.map(c => c.rule);
    const exc = entry.exclude.map(c => c.rule);
    if (!req.length && !exc.length) return entry.baseline ? undefined : false;   // evaluate(false) is always false
    if (entry.baseline) {
      // in by default; drop out only when an exclusion fires and nothing requires it
      if (!exc.length) return undefined;
      const excFired = exc.length === 1 ? exc[0] : { any: exc };
      if (!req.length) return { not: excFired };
      const reqFired = req.length === 1 ? req[0] : { any: req };
      return { any: [reqFired, { not: excFired }] };
    }
    if (!req.length) return false;                          // only exclusions, and not in the baseline
    const reqFired = req.length === 1 ? req[0] : { any: req };
    return reqFired;                                        // exclusions cannot remove what is not baseline
  }

  /* ------------------------------------------------------------------ main */
  function fromSheets(sheets, opts) {
    opts = opts || {};
    const report = { errors: [], warnings: [], notes: [], unmapped: Object.create(null), counts: {}, totals: {}, unconfirmed: S.unconfirmed() };
    const found = pickSheets(sheets);
    if (!found.tasks) { report.errors.push("No Task List sheet found. Expected a sheet named 'Task List' with ID and Task columns."); return { report }; }

    const taskRows = readSheet(found.tasks, S.TASK, report, "Task List");
    if (!taskRows.length) { report.errors.push("The Task List sheet has no data rows."); return { report }; }

    const noteUnmapped = (list, value, where) => {
      const k = list + " · " + value;
      report.unmapped[k] = report.unmapped[k] || { list, value, count: 0, examples: [] };
      report.unmapped[k].count++;
      if (report.unmapped[k].examples.length < 4) report.unmapped[k].examples.push(where);
    };

    /* ---- phases, in the order they first appear (they are numbered already) */
    /* Null-prototype throughout this function: every one of these maps is
       keyed by a slug of text out of the workbook, and slug() leaves
       "constructor" alone. Against a plain object the get-or-create guards
       below saw Object.prototype.constructor, decided the phase or team was
       already registered, and dropped it with no warning. */
    const phaseOrder = [], phaseById = Object.create(null);
    /* One slugger per namespace, shared with the per-activity lookups below so
       a phase and the activity pointing at it always agree on the id. */
    const phaseSlug = slugger(), teamSlug = slugger(), condSlug = slugger();
    taskRows.forEach(r => {
      const label = txt(r.phase); if (!label) return;
      const id = phaseSlug(label);
      if (!phaseById[id]) {
        // "3. Placement & Pattern Selection" -> short "Placement"
        const stripped = label.replace(/^\s*\d+[.)]\s*/, "");
        phaseById[id] = { id, label: stripped, short: stripped.split(/\s*[&/(]|\s+-\s+/)[0].trim().split(/\s+/).slice(0, 2).join(" "), n: txt(label).match(/^\s*(\d+)/) ? Number(RegExp.$1) : phaseOrder.length + 1 };
        phaseOrder.push(phaseById[id]);
      }
    });
    phaseOrder.sort((a, b) => a.n - b.n);

    /* ---- teams; organization boundary = Team Topologies Type */
    const teams = Object.create(null);
    taskRows.forEach(r => {
      const label = txt(r.team); if (!label) return;
      const id = teamSlug(label);
      const tt = txt(r.ttType);
      const ttDef = tt ? S.matchValue("ttType", tt) : null;
      if (tt && !ttDef) noteUnmapped("Team Topologies Type", tt, txt(r.id));
      if (!teams[id]) {
        teams[id] = { label, short: label.split(/\s*\/\s*/)[0].trim(), org: ttDef ? ttDef.value : (tt || "Unspecified"), ttType: ttDef ? ttDef.id : null };
      } else if (ttDef && teams[id].ttType && teams[id].ttType !== ttDef.id) {
        report.warnings.push("Team '" + label + "' is given more than one Team Topologies Type (" + teams[id].org + " and " + ttDef.value + "). The first was kept.");
      }
    });

    /* ---- tailoring: the three tabs if present, the Applies When phrases if not */
    const toggles = readToggles(found.toggles, report);
    const profiles = toggles ? readProfiles(found.profiles, toggles, report) : null;
    const matrix = toggles ? readMatrix(found.matrix, toggles, report) : null;
    if (toggles && !matrix) report.warnings.push("A Toggles tab was found but no usable Scenario Matrix, so no task is tied to any toggle yet.");
    if (!toggles && (found.profiles || found.matrix)) report.warnings.push("Profiles or Scenario Matrix found without a Toggles tab. Toggles defines the vocabulary, so both were ignored.");

    /* ---- scenario switches from the distinct "Applies When" phrases */
    const conditions = new Map();
    taskRows.forEach(r => {
      const phrase = txt(r.appliesWhen);
      if (!phrase || ALWAYS.indexOf(phrase.toLowerCase()) >= 0) return;
      if (!conditions.has(phrase)) conditions.set(phrase, { id: condSlug(phrase), label: phrase, count: 0 });
      conditions.get(phrase).count++;
    });
    const attributes = [...conditions.values()]
      .sort((a, b) => b.count - a.count)
      .map(c => ({ id: c.id, label: c.label, type: "boolean", default: true, help: c.count + " step" + (c.count === 1 ? "" : "s") }));
    const namedRules = Object.create(null);
    conditions.forEach(c => { namedRules[c.id] = { [c.id]: true }; });

    /* ---- activities */
    const activities = [], seen = new Set();
    const unmatchedInMatrix = [], matrixConflicts = [];
    let leadCur = 0, cycleCur = 0, leadOpt = 0, cycleOpt = 0;
    taskRows.forEach(r => {
      const id = txt(r.id);
      if (!id) { report.warnings.push("Row " + r.__row + " has no ID and was skipped."); return; }
      if (seen.has(id)) { report.warnings.push("Row " + r.__row + ": duplicate ID '" + id + "' was skipped."); return; }
      seen.add(id);

      const stepRaw = txt(r.stepType);
      const step = stepRaw ? S.matchValue("stepType", stepRaw) : null;
      if (stepRaw && !step) noteUnmapped("Step Type (Lean)", stepRaw, id);
      const category = step ? step.id : "value";

      const wasteRaw = txt(r.waste);
      const wasteDef = wasteRaw ? S.matchValue("waste", wasteRaw) : null;
      if (wasteRaw && !wasteDef) noteUnmapped("Waste Category (DOWNTIME)", wasteRaw, id);
      const waste = wasteDef && wasteDef.id ? wasteDef.id : null;

      const laneRaw = txt(r.lane);
      const laneDef = laneRaw ? S.matchValue("lane", laneRaw) : null;
      if (laneRaw && !laneDef) noteUnmapped("Lane Applicability", laneRaw, id);

      const interRaw = txt(r.interaction);
      const interDef = interRaw ? S.matchValue("interaction", interRaw) : null;
      if (interRaw && !interDef) noteUnmapped("Interaction Mode", interRaw, id);

      const lc = num(r.leadCur) || 0, cc = num(r.cycleCur) || 0;
      let lo = num(r.leadOpt), co = num(r.cycleOpt);
      if (lo === null) lo = lc; if (co === null) co = cc;
      if (num(r.leadCur) === null && txt(r.leadCur) !== "") report.warnings.push(id + ": current lead time '" + txt(r.leadCur) + "' is not a number, treated as 0.");
      leadCur += lc; cycleCur += cc; leadOpt += lo; cycleOpt += co;

      const current = Math.round((lc + cc) * 1000) / 1000;
      const optimal = Math.round((lo + co) * 1000) / 1000;
      if (optimal > current) report.warnings.push(id + ": optimized time (" + optimal + ") is longer than current (" + current + ").");

      const phrase = txt(r.appliesWhen);
      const cond = phrase && ALWAYS.indexOf(phrase.toLowerCase()) < 0 ? conditions.get(phrase) : null;

      const a = {
        id,
        name: txt(r.name) || id,
        phase: txt(r.phase) ? phaseSlug(txt(r.phase)) : undefined,
        owner: txt(r.team) ? teamSlug(txt(r.team)) : undefined,
        category,
        duration: { current, optimal },
        /* the lead/cycle split kept intact: solid = cycle, hatched = lead */
        time: { leadCurrent: lc, cycleCurrent: cc, leadOptimal: lo, cycleOptimal: co },
        predecessors: txt(r.preds).split(/[;,]/).map(s => s.trim()).filter(Boolean),
        interaction: interDef ? interDef.id : (interRaw || undefined),
        lane: laneDef ? laneDef.id : (laneRaw || undefined),
        appliesWhen: phrase || undefined
      };
      if (waste) a.waste = waste;
      /* The matrix owns inclusion when it exists; the Applies When phrase is
         then documentation only, kept on the activity for the details panel. */
      if (matrix) {
        const entry = matrix.get(id);
        if (!entry) {
          unmatchedInMatrix.push(id);
          if (cond) a.when = cond.id;                       // fall back to the phrase for this row
        } else {
          const rule = entryToRule(entry);
          if (rule !== undefined) a.when = rule;
          if (entry.factors.length) {
            a.multipliers = entry.factors.map(f => ({
              when: f.col.rule, factor: f.factor,
              note: f.col.toggle.label + (f.col.header.indexOf("=") > 0 ? " (" + f.col.header.split("=")[1] + ")" : "") + " makes this " + f.factor + "x"
            }));
          }
          if (entry.require.length && entry.exclude.length) {
            matrixConflicts.push({
              id, name: a.name,
              requiredBy: entry.require.map(c => c.header),
              excludedBy: entry.exclude.map(c => c.header)
            });
          }
        }
      } else if (cond) a.when = cond.id;
      if (category === "milestone") a.milestone = true;
      /* the workbook's own Handoff step type is an explicit declaration, which
         is narrower and more deliberate than our owner-change detection */
      if (category === "handoff") a.handoff = true;
      if (interDef && interDef.id === "handoff") a.antiPattern = true;
      if (num(r.pctCA) !== null) a.pctCA = num(r.pctCA);
      if (txt(r.notes) !== "") a.notes = txt(r.notes);
      /* The workbook's own CPM columns (R..X, in days). Kept as `source` and
         never used to place a bar - this app recomputes the schedule, because
         the moment a scenario switch excludes a step the workbook's numbers are
         stale. They are used to cross-check ours. */
      const src = {
        durationDays: num(r.durationDays), es: num(r.esDay), ef: num(r.efDay),
        ls: num(r.lsDay), lf: num(r.lfDay), slack: num(r.slackDays),
        critical: /^(y|yes|true|1|x|critical)$/i.test(txt(r.criticalPath)),
        flowEff: num(r.flowEff)
      };
      if (Object.keys(src).some(k => src[k] !== null && src[k] !== false)) a.source = src;
      const bits = [];
      if (step) bits.push(step.label || step.value);
      if (wasteDef && wasteDef.id) bits.push("DOWNTIME: " + wasteDef.value);
      if (interDef) bits.push(interDef.value);
      if (laneDef || laneRaw) bits.push("Lanes: " + (laneDef ? laneDef.value : laneRaw));
      bits.push("lead " + lc + " h · cycle " + cc + " h");
      a.description = bits.join(" · ");
      activities.push(a);
    });

    /* ---- edges: unioned with the Predecessor IDs column */
    const ids = new Set(activities.map(a => a.id));
    const byId = new Map(activities.map(a => [a.id, a]));
    let edgeCount = 0, edgeAdded = 0;
    let bindingEdges = 0;
    const binding = new Set();
    const predSets = new Map();
    if (found.edges) {
      const edgeRows = readSheet(found.edges, S.EDGES, report, "Edges");
      edgeRows.forEach(e => {
        const from = txt(e.from), to = txt(e.to);
        if (!from || !to) return;
        edgeCount++;
        if (!ids.has(from)) { report.warnings.push("Edges row " + e.__row + ": predecessor '" + from + "' is not a task ID."); return; }
        if (!ids.has(to)) { report.warnings.push("Edges row " + e.__row + ": successor '" + to + "' is not a task ID."); return; }
        const t = byId.get(to);
        // a Set per task: indexOf here is O(predecessors) on every edge row
        let have = predSets.get(to);
        if (!have) { have = new Set(t.predecessors); predSets.set(to, have); }
        if (!have.has(from)) { have.add(from); t.predecessors.push(from); edgeAdded++; }
        /* Zero-Slack Link = BINDING: the links that actually drive the end
           date. Worth carrying through so the chart can draw them heavier than
           the rest instead of showing 180 equal-weight arrows. */
        if (/^binding$/i.test(txt(e.binding))) { binding.add(from + ">" + to); bindingEdges++; }
      });
      if (bindingEdges) report.notes.push(bindingEdges + " of " + edgeCount + " dependency links are marked BINDING (zero slack). Those are the chain that sets the end date.");
    } else {
      report.notes.push("No Edges sheet found; dependencies came from the Predecessor IDs column alone.");
    }
    /* predecessors naming rows that are not in the sheet */
    activities.forEach(a => {
      const bad = a.predecessors.filter(p => !ids.has(p));
      bad.forEach(p => report.warnings.push(a.id + ": predecessor '" + p + "' does not exist and was dropped."));
      if (bad.length) a.predecessors = a.predecessors.filter(p => ids.has(p));
    });

    /* ---- assumptions (kept for reference; the Optimized columns are what is used) */
    let assumptions = null;
    if (found.assumptions) {
      const rows = readSheet(found.assumptions, S.ASSUMPTIONS, report, "Assumptions");
      if (rows.length) {
        assumptions = Object.create(null);
        rows.forEach(r => {
          const st = S.matchValue("stepType", txt(r.stepType));
          const key = st ? st.id : slug(r.stepType);
          assumptions[key] = { stepType: txt(r.stepType), lead: num(r.leadFactor), cycle: num(r.cycleFactor) };
        });
        report.notes.push("Assumptions sheet read for reference. Bar lengths come from the Optimized columns in the Task List, not from these factors, so the two can be compared rather than one silently overriding the other.");
      }
    }

    /* ---- assembled model */
    const process = {
      title: opts.title || "Value Stream",
      subtitle: opts.subtitle || "Current state, with the optimized state alongside",
      units: "hours",
      unitLabel: "hrs",
      hoursPerDay: S.HOURS_PER_DAY,
      bindingLinks: binding.size ? [...binding] : undefined,
      version: new Date().toISOString().slice(0, 10),
      source: opts.source || (found.tasks.name + " sheet"),
      caveat: opts.caveat || "Durations are unvalidated estimates.",
      timeModel: { elapsed: "lead + cycle", solid: "cycle", hatched: "lead", note: "Lead time in this workbook is wait-only; elapsed time is lead + cycle." },
      phases: phaseOrder.map(p => ({ id: p.id, label: p.label, short: p.short })),
      teams,
      activities,
      assumptions: assumptions || undefined
    };

    /* ---- the scenario the sidebar is built from */
    let scenario;
    if (toggles) {
      /* A Toggles tab with no Scenario Matrix still leaves the Applies When
         column doing the work, and those phrases are not toggle ids. Without
         this, every phrase-gated task carries a `when` naming an attribute
         that does not exist, which evaluates false and drops the row. The
         validator catches it, but the importer should not create it. */
      const extra = [];
      if (!matrix) {
        const known = new Set(toggles.map(t => t.id));
        conditions.forEach(c => {
          if (known.has(c.id)) return;
          extra.push({ id: c.id, label: c.label, type: "boolean", default: true,
            group: "From Applies When", help: c.count + " step" + (c.count === 1 ? "" : "s") });
        });
        if (extra.length) {
          report.notes.push("No Scenario Matrix, so " + extra.length +
            " switch(es) were built from the Applies When column and added after the declared toggles.");
        }
      }
      scenario = {
        attributes: toggles.map(t => {
          const a = { id: t.id, label: t.label, type: t.type, default: t.default, group: t.group };
          if (t.options) a.options = t.options;
          if (t.help) a.help = t.help;
          if (t.implies && t.implies.length) a.implies = t.implies;
          return a;
        }).concat(extra),
        rules: matrix ? {} : namedRules,
        /* A profile sets only what it declares. Everything it stays silent
           about keeps whatever the person chose, which is what lets "and it
           involves AI" ride along on top of any profile. */
        presets: (profiles || []).map(p => ({ id: p.id, label: p.label, description: p.description, set: p.set, partial: true })),
        groups: [...new Set(toggles.map(t => t.group))]
      };
      if (matrix) {
        scenario.presets.push({
          id: "full-scope", label: "Full scope (every step that could apply)",
          description: "The complete map. Every step that any project could need, at unmodified length. This is the view the workbook's own schedule columns describe.",
          set: fullScopeSet(toggles, matrix), partial: false
        });
      }
      if (!scenario.presets.length) {
        report.notes.push("No Profiles tab, so the toggles start at their declared defaults with no named starting points.");
      }
    } else {
      scenario = {
        attributes: attributes.length ? attributes : [{ id: "all", label: "All steps", type: "boolean", default: true }],
        rules: namedRules,
        presets: [
          { id: "everything", label: "Every step (full map)", set: attributes.reduce((o, a) => (o[a.id] = true, o), Object.create(null)) },
          { id: "baseline", label: "Baseline workload only", set: attributes.reduce((o, a) => (o[a.id] = false, o), Object.create(null)) }
        ]
      };
      report.notes.push("No Toggles tab, so the scenario switches were built from the distinct Applies When phrases. Add Toggles, Profiles and Scenario Matrix tabs to tailor properly.");
    }

    if (matrix) {
      if (unmatchedInMatrix.length) {
        report.warnings.push(unmatchedInMatrix.length + " task(s) are not in the Scenario Matrix and fall back to their Applies When phrase: " +
          unmatchedInMatrix.slice(0, 10).join(", ") + (unmatchedInMatrix.length > 10 ? " …" : ""));
      }
      const extra = [...matrix.keys()].filter(k => !seen.has(k));
      if (extra.length) report.warnings.push("Scenario Matrix names " + extra.length + " task ID(s) that are not in the Task List: " + extra.slice(0, 10).join(", ") + (extra.length > 10 ? " …" : ""));
      report.matrixConflicts = matrixConflicts;
      if (matrixConflicts.length) {
        report.notes.push(matrixConflicts.length + " task(s) are required by one toggle and excluded by another. Required wins, so nothing was dropped, but each one is a tailoring decision somebody should make on purpose.");
      }
    }

    const rnd = n => Math.round(n * 10) / 10;
    report.counts = {
      tasks: activities.length, phases: phaseOrder.length, teams: Object.keys(teams).length,
      edges: edgeCount, edgesAdded: edgeAdded, conditions: attributes.length,
      gates: activities.filter(a => a.category === "gate").length,
      handoffs: activities.filter(a => a.category === "handoff").length,
      rework: activities.filter(a => a.category === "rework").length,
      antiPatternHandoffs: activities.filter(a => a.antiPattern).length
    };
    report.totals = {
      leadCurrent: rnd(leadCur), cycleCurrent: rnd(cycleCur),
      leadOptimal: rnd(leadOpt), cycleOptimal: rnd(cycleOpt),
      elapsedCurrent: rnd(leadCur + cycleCur), elapsedOptimal: rnd(leadOpt + cycleOpt),
      flowEfficiency: leadCur + cycleCur ? rnd(100 * cycleCur / (leadCur + cycleCur)) : 0,
      flowEfficiencyOptimal: leadOpt + cycleOpt ? rnd(100 * cycleOpt / (leadOpt + cycleOpt)) : 0
    };
    report.unmappedList = Object.values(report.unmapped);
    return { process, taxonomy: buildTaxonomy(), scenario, report };
  }

  /* --------------------------------------------------------------- reconcile
     The workbook carries its own forward and backward pass (Duration, ES, EF,
     LS, LF, Slack, Critical Path - columns R..X, in days). This app recomputes
     all of it from the dependencies, because the workbook's figures go stale
     the moment a scenario switch drops a step out of the graph.

     Two independent schedules over the same data is a gift: where they agree,
     both are probably right; where they diverge, one of them has a bug and it
     is worth knowing which before either number reaches a slide. Run this with
     every condition switched on, which is the state the workbook's own numbers
     describe.

     Returns { checked, agree, worstDelta, mismatches[], endOurs, endTheirs }
     with everything expressed in DAYS. */
  function reconcile(process, model, tolDays) {
    const perDay = Number(process.hoursPerDay) || S.HOURS_PER_DAY;
    const tol = tolDays === undefined ? 0.02 : tolDays;
    const out = { checked: 0, agree: 0, worstDelta: 0, mismatches: [], durationMismatches: [] };
    model.nodes.forEach(n => {
      const src = n.act && n.act.source;
      if (!src) return;
      if (src.durationDays !== null && src.durationDays !== undefined) {
        const ours = n.duration.current / perDay;
        if (Math.abs(ours - src.durationDays) > tol) {
          out.durationMismatches.push({ id: n.id, name: n.name, ours: Math.round(ours * 100) / 100, theirs: src.durationDays });
        }
      }
      if (src.ef === null || src.ef === undefined) return;
      out.checked++;
      const oursEF = n.cur.end / perDay;
      const d = Math.abs(oursEF - src.ef);
      if (d > out.worstDelta) out.worstDelta = Math.round(d * 100) / 100;
      if (d <= tol) out.agree++;
      else if (out.mismatches.length < 25) {
        out.mismatches.push({
          id: n.id, name: n.name,
          ours: Math.round(oursEF * 100) / 100, theirs: src.ef,
          delta: Math.round((oursEF - src.ef) * 100) / 100
        });
      }
    });
    const ends = model.nodes.map(n => (n.act && n.act.source ? n.act.source.ef : null)).filter(v => v !== null && v !== undefined);
    // reduce, not spread: Math.max(...ends) throws RangeError past ~125k arguments
    out.endTheirs = ends.length ? ends.reduce((m, v) => (v > m ? v : m), -Infinity) : null;
    out.endOurs = Math.round((model.metrics.currentElapsed / perDay) * 100) / 100;
    out.mismatchCount = out.checked - out.agree;

    /* the critical path each of us found, compared as sets */
    const flagged = model.nodes.filter(n => n.act && n.act.source && n.act.source.critical !== undefined);
    if (flagged.length) {
      out.criticalTheirs = flagged.filter(n => n.act.source.critical).length;
      out.criticalOurs = model.nodes.filter(n => n.critical).length;
      out.criticalOnlyTheirs = flagged.filter(n => n.act.source.critical && !n.critical).map(n => n.id);
      out.criticalOnlyOurs = flagged.filter(n => !n.act.source.critical && n.critical).map(n => n.id);
      out.criticalAgrees = out.criticalOnlyTheirs.length === 0 && out.criticalOnlyOurs.length === 0;
    }
    return out;
  }

  /* Convenience: an ArrayBuffer straight from a file input or fs. */
  async function fromWorkbook(buffer, opts) {
    const sheets = await VSM.table.parseXLSX(buffer);
    return fromSheets(sheets, opts);
  }

  /* A short human summary of what the import did, for the toast / panel. */
  function summarize(report) {
    const c = report.counts || {}, t = report.totals || {};
    const lines = [
      c.tasks + " tasks · " + c.phases + " phases · " + c.teams + " teams · " + c.conditions + " condition switches",
      c.gates + " approval gates · " + c.handoffs + " declared handoffs · " + c.rework + " rework loops",
      "elapsed " + t.elapsedCurrent + " h → " + t.elapsedOptimal + " h   ·   flow efficiency " + t.flowEfficiency + "% → " + t.flowEfficiencyOptimal + "%"
    ];
    if (report.unmappedList && report.unmappedList.length) lines.push(report.unmappedList.length + " value(s) outside the known picklists — see the panel");
    if (report.warnings.length) lines.push(report.warnings.length + " warning(s)");
    return lines.join("\n");
  }

  VSM.import = { fromSheets, fromWorkbook, summarize, reconcile, buildTaxonomy, slug };
  if (typeof module !== "undefined" && module.exports) module.exports = VSM.import;
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
