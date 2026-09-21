/* ============================================================================
   TESTS  -  node test/run-tests.js
   ----------------------------------------------------------------------------
   No browser, no install, no framework. Every number asserted here is one that
   would embarrass us on a projector if it were wrong.

   The import tests run against fixture/sample-value-stream.xlsx -
   invented task names, real column names, and phase totals that reconcile to
   the real workbook's Summary by Phase tab. Point IMPORT_FILE at a real
   workbook to check that one instead:

       IMPORT_FILE=/path/to/real.xlsx node test/run-tests.js
   ========================================================================== */
const path = require("path");
const VSM = require(path.join(__dirname, "..", "js", "node.js"));

let pass = 0, fail = 0;
const results = [];
function ok(name, cond, detail) {
  if (cond) { pass++; results.push("  ok   " + name); }
  else { fail++; results.push("  FAIL " + name + (detail ? "\n         " + detail : "")); }
}
function eq(name, got, want, tol) {
  const near = typeof want === "number" && typeof got === "number" && Math.abs(got - want) <= (tol || 0);
  ok(name, near || got === want, "got " + JSON.stringify(got) + ", wanted " + JSON.stringify(want));
}
function section(t) { results.push("\n" + t); }

(async () => {
  /* ===================================================== 1. the shipped data */
  section("shipped data");
  const d = VSM.loadData();
  const v = VSM.validate.run(d.process, d.taxonomy, d.scenario);
  ok("validates with no errors", (v.errors || []).length === 0, (v.errors || []).join(" | "));

  const scenario = VSM.rules.defaults(d.scenario.attributes);
  const model = VSM.schedule.build(d.process, d.taxonomy, scenario, d.scenario.rules);
  ok("builds a schedule", model.nodes.length > 0);
  ok("current elapsed >= optimal elapsed", model.metrics.currentElapsed >= model.metrics.optimalElapsed);
  ok("every node has a finite start and end",
    model.nodes.every(n => isFinite(n.cur.start) && isFinite(n.cur.end) && n.cur.end >= n.cur.start));
  ok("critical path spans the whole timeline", (() => {
    const crit = model.nodes.filter(n => n.critical);
    if (!crit.length) return false;
    return Math.max(...crit.map(n => n.cur.end)) === model.metrics.currentElapsed;
  })());

  /* excluding a scenario attribute must never lengthen the timeline */
  const fewer = VSM.rules.defaults(d.scenario.attributes);
  Object.keys(fewer).forEach(k => { if (typeof fewer[k] === "boolean") fewer[k] = false; });
  const lean = VSM.schedule.build(d.process, d.taxonomy, fewer, d.scenario.rules);
  ok("turning switches off never lengthens the timeline",
    lean.metrics.currentElapsed <= model.metrics.currentElapsed,
    lean.metrics.currentElapsed + " vs " + model.metrics.currentElapsed);

  /* ===================================================== 2. the workbook import */
  section("workbook import");
  const file = process.env.IMPORT_FILE || path.join(__dirname, "..", "fixture", "sample-value-stream.xlsx");
  const real = !!process.env.IMPORT_FILE;
  const res = await VSM.import.fromWorkbook(VSM.readWorkbook(file));
  ok("import produced no errors", res.report.errors.length === 0, res.report.errors.join(" | "));
  if (!res.process) { report(); return; }

  const c = res.report.counts, t = res.report.totals;
  if (!real) {
    /* these are the fixture's figures, and they match the real Summary by Phase */
    eq("146 tasks", c.tasks, 146);
    eq("19 phases", c.phases, 19);
    eq("182 edges", c.edges, 182);
    eq("146 binding links", (res.process.bindingLinks || []).length, 146);
    eq("36 approval gates", c.gates, 36);
    eq("4 declared handoffs", c.handoffs, 4);
    eq("6 rework loops", c.rework, 6);
    eq("current lead 7992 h", t.leadCurrent, 7992, 0.05);
    eq("current cycle 889 h", t.cycleCurrent, 889, 0.05);
    eq("optimized lead 2243.8 h", t.leadOptimal, 2243.8, 0.05);
    eq("optimized cycle 523.8 h", t.cycleOptimal, 523.8, 0.05);
    eq("flow efficiency 10.0%", t.flowEfficiency, 10.0, 0.05);
  } else {
    results.push("  (real workbook: counts not asserted)  " + JSON.stringify(c));
  }

  /* flow efficiency is cycle / (lead + cycle) - the definition the workbook's
     own Summary tab matches. Guard it so nobody "fixes" it to cycle / lead. */
  eq("flow efficiency = cycle / (lead + cycle)",
    Math.round(1000 * t.cycleCurrent / (t.leadCurrent + t.cycleCurrent)) / 10, t.flowEfficiency, 0.06);

  /* the split must survive the import intact */
  const sumLead = res.process.activities.reduce((s, a) => s + a.time.leadCurrent, 0);
  const sumCycle = res.process.activities.reduce((s, a) => s + a.time.cycleCurrent, 0);
  eq("per-task lead times sum to the total", Math.round(sumLead * 10) / 10, t.leadCurrent, 0.05);
  eq("per-task cycle times sum to the total", Math.round(sumCycle * 10) / 10, t.cycleCurrent, 0.05);
  ok("every bar length equals its lead + cycle",
    res.process.activities.every(a => Math.abs(a.duration.current - (a.time.leadCurrent + a.time.cycleCurrent)) < 0.0011));

  ok("no task is its own predecessor", res.process.activities.every(a => a.predecessors.indexOf(a.id) < 0));
  ok("every predecessor exists", (() => {
    const ids = new Set(res.process.activities.map(a => a.id));
    return res.process.activities.every(a => a.predecessors.every(p => ids.has(p)));
  })());
  ok("every task has a phase", res.process.activities.every(a => !!a.phase));
  ok("every task has an owning team", res.process.activities.every(a => !!a.owner));
  ok("every owner is a declared team", (() => {
    const teams = res.process.teams;
    return res.process.activities.every(a => !!teams[a.owner]);
  })());

  /* ===================================================== 3. the imported model runs */
  section("imported model end to end");
  const iv = VSM.validate.run(res.process, res.taxonomy, res.scenario);
  ok("imported data validates", (iv.errors || []).length === 0, (iv.errors || []).slice(0, 3).join(" | "));

  /* Reconciliation and the "is everything reachable" check both run at FULL
     SCOPE, not at the toggle defaults. Defaults describe one kind of project;
     the workbook's own schedule columns describe the complete task list. */
  const full = res.scenario.presets.find(p => p.id === "full-scope");
  const iScenario = full
    ? Object.assign(VSM.rules.defaults(res.scenario.attributes), full.set)
    : VSM.rules.defaults(res.scenario.attributes);
  const iModel = VSM.schedule.build(res.process, res.taxonomy, iScenario, res.scenario.rules, res.scenario.attributes);
  ok("a full-scope preset exists", !!full);
  eq("full scope reaches every task", iModel.nodes.length, c.tasks);
  ok("full scope applies no duration multipliers", iModel.nodes.every(n => !n.duration.factor || n.duration.factor === 1),
    iModel.nodes.filter(n => n.duration.factor > 1).slice(0, 3).map(n => n.id + " x" + n.duration.factor).join(", "));
  ok("no dependency cycle", !(iModel.warnings || []).some(w => /loop|cycle/i.test(w)), (iModel.warnings || []).slice(0, 2).join(" | "));
  ok("elapsed time is shorter than the sum of the parts (work overlaps)",
    iModel.metrics.currentElapsed < t.elapsedCurrent,
    iModel.metrics.currentElapsed + " vs " + t.elapsedCurrent);
  ok("optimized critical path is shorter than the current one",
    iModel.metrics.optimalElapsed < iModel.metrics.currentElapsed,
    iModel.metrics.optimalElapsed + " vs " + iModel.metrics.currentElapsed);

  /* the claim that matters on a slide: the reduction quoted must be the
     critical path, not the sum of hours. Prove they differ, so the tool can
     never quietly print one while labelling it the other. */
  const sumReduction = Math.round(1000 * (1 - t.elapsedOptimal / t.elapsedCurrent)) / 10;
  const pathReduction = Math.round(1000 * (1 - iModel.metrics.optimalElapsed / iModel.metrics.currentElapsed)) / 10;
  results.push("  note  reduction by summed hours " + sumReduction + "%, by critical path " + pathReduction + "%");
  ok("the two reduction figures are genuinely different", Math.abs(sumReduction - pathReduction) > 0.5);

  /* ---- the workbook's own CPM schedule vs ours ----
     The workbook computes Duration / ES / EF / LS / LF / Slack / Critical Path
     in days (columns R..X). This app recomputes all of it from the
     dependencies. Two independent forward passes over the same graph is the
     cheapest bug detector available, so they are compared rather than one
     being trusted. */
  section("reconciliation against the workbook's own schedule");
  const rec = VSM.import.reconcile(res.process, iModel);
  results.push("  note  our end " + rec.endOurs + " d vs workbook " + rec.endTheirs + " d, worst per-task gap " + rec.worstDelta + " d");
  ok("the workbook carries a schedule to check against", rec.checked > 0, "no Earliest Finish column found");
  eq("every task's earliest finish agrees", rec.mismatchCount, 0,
    0);
  ok("no task duration disagrees with lead + cycle over 8h days",
    rec.durationMismatches.length === 0,
    JSON.stringify(rec.durationMismatches.slice(0, 3)));
  ok("end-to-end dates agree", rec.endTheirs !== null && Math.abs(rec.endOurs - rec.endTheirs) <= 0.02,
    rec.endOurs + " vs " + rec.endTheirs);
  results.push("  note  critical path: workbook says " + rec.criticalTheirs + " tasks, we say " + rec.criticalOurs);
  ok("the same tasks are on the critical path", rec.criticalAgrees === true,
    "only theirs: " + (rec.criticalOnlyTheirs || []).slice(0, 8).join(",") +
    " | only ours: " + (rec.criticalOnlyOurs || []).slice(0, 8).join(","));

  /* An hour is an eighth of a day, so every date lands on a clean eighth -
     4.63, 6.75, 10.25, 14.13. The column is stored to two decimals, so allow
     for that rounding (0.625 prints as 0.63) but nothing wider. This is the
     evidence the 8-hour day is real rather than assumed; if a workbook ever
     fails it, the hours-to-days conversion in it is not 8. */
  ok("the 8-hour day holds: dates land on exact eighths", (() => {
    const bad = res.process.activities.filter(a => a.source && a.source.ef !== null &&
      Math.abs(a.source.ef * 8 - Math.round(a.source.ef * 8)) > 0.05);
    return bad.length === 0;
  })(), "some Earliest Finish values are not a whole number of hours at 8 hrs/day");

  /* ===================================================== 3b. tailoring */
  section("tailoring: profiles and modifiers");
  const U = VSM.units.resolve(res.process);
  const perDay = res.process.hoursPerDay || 8;
  const run = sc => {
    const m = VSM.schedule.build(res.process, res.taxonomy, sc, res.scenario.rules, res.scenario.attributes);
    return { tasks: m.nodes.length, days: Math.round((m.metrics.currentElapsed / perDay) * 10) / 10, gates: m.metrics.gates, model: m };
  };
  const base = VSM.rules.defaults(res.scenario.attributes);
  const profiles = res.scenario.presets.filter(p => p.id !== "full-scope");
  const applyProfile = p => Object.assign({}, base, p.set);

  /* ORDER INDEPENDENCE. Pick the profile then tick the modifier, or tick the
     modifier then pick the profile: a tailoring policy whose answer depends on
     click order is not a policy. */
  if (profiles.length) {
    const p = profiles[0];
    const a = Object.assign({}, applyProfile(p), { genAI: true });          // profile, then modifier
    const b = Object.assign({}, base, { genAI: true }, p.set);              // modifier, then profile
    eq("profile then modifier equals modifier then profile", run(a).tasks, run(b).tasks);
    ok("a profile leaves undeclared modifiers alone", !("genAI" in p.set) && run(a).tasks > run(applyProfile(p)).tasks,
      "profile declares genAI, so this cannot be checked");
  }

  /* R BEATS N. Paved road wants to skip the architecture governance gates; a
     service nobody has run here before wants them back. The step must survive,
     and the collision must be reported rather than silently resolved. */
  const both = Object.assign({}, base, { pavedRoad: true, newService: true });
  const pavedOnly = Object.assign({}, base, { pavedRoad: true, newService: false });
  ok("required beats excluded when two toggles disagree", run(both).tasks > run(pavedOnly).tasks,
    run(both).tasks + " vs " + run(pavedOnly).tasks);
  ok("the collisions are reported by name", (res.report.matrixConflicts || []).length > 0,
    "no conflicts recorded, so the R-beats-N path was never exercised");

  /* multipliers must actually stretch something */
  const withMult = Object.assign({}, base, { newService: true });
  ok("a duration multiplier lengthens the work", run(withMult).days > run(Object.assign({}, base, { newService: false })).days);

  /* THE DELIVERABLE: what each profile costs, and what each modifier adds. */
  const rowsOut = [];
  profiles.forEach(p => { const r = run(applyProfile(p)); rowsOut.push([p.label, r.tasks, r.days, r.gates]); });
  const fullRun = run(iScenario);
  rowsOut.push(["Full scope (every step)", fullRun.tasks, fullRun.days, fullRun.gates]);
  results.push("\n  profile                              tasks   days  gates");
  rowsOut.forEach(r => results.push("  " + String(r[0]).padEnd(36) + String(r[1]).padStart(5) + String(r[2]).padStart(7) + String(r[3]).padStart(7)));

  const anchor = profiles.find(p => p.id === "standard-paved") || profiles[0];
  if (anchor) {
    const a0 = run(applyProfile(anchor));
    const mods = res.scenario.attributes.filter(m => m.type === "boolean" && !(m.id in anchor.set));
    results.push("\n  modifier on top of \"" + anchor.label + "\" (" + a0.tasks + " tasks, " + a0.days + " d)");
    mods.forEach(m => {
      /* measure against the modifier OFF, not against the profile, so a
         modifier that defaults on still shows what it is worth */
      const offS = run(Object.assign({}, applyProfile(anchor), { [m.id]: false }));
      const onS = run(Object.assign({}, applyProfile(anchor), { [m.id]: true }));
      const dt = Math.round((onS.days - offS.days) * 10) / 10;
      results.push("  " + m.label.padEnd(36) + ("+" + (onS.tasks - offS.tasks)).padStart(5) +
        (dt >= 0 ? "+" + dt : String(dt)).padStart(8) + " d" + (m.default ? "   (on by default)" : ""));
    });
    ok("every profile is smaller than full scope", rowsOut.slice(0, -1).every(r => r[1] < fullRun.tasks));
    ok("the profiles actually separate (spread over 30 tasks)",
      Math.max(...rowsOut.map(r => r[1])) - Math.min(...rowsOut.map(r => r[1])) >= 30,
      "task counts: " + rowsOut.map(r => r[1]).join(", ") + " - if these bunch up, the matrix is marking too much as Baseline");
  }

  ok("chains stay intact in every profile",
    profiles.every(p => run(applyProfile(p)).model.nodes.every(n => isFinite(n.cur.start) && n.cur.start >= 0)));

  /* ===================================================== 3c. analysis */
  section("analysis");
  const prof = VSM.analyze.profile(iModel, { hoursPerDay: perDay });
  eq("profile agrees with the model on the path length", prof.pathDays, Math.round((iModel.metrics.currentElapsed / perDay) * 10) / 10, 0.05);
  ok("the critical chain is a real chain", prof.chainSteps > 1 && prof.chainSteps <= prof.tasks);
  ok("parallelism is at least 1", prof.parallelism >= 1, String(prof.parallelism));
  eq("summed work equals the sum of every task", prof.summedDays,
    Math.round((iModel.nodes.reduce((a, n) => a + n.duration.current, 0) / perDay) * 10) / 10, 0.05);
  ok("chain lead plus cycle accounts for the chain",
    Math.abs((prof.chainLeadDays + prof.chainCycleDays + prof.chainUnsplitDays) - prof.pathDays) < 0.6,
    prof.chainLeadDays + " + " + prof.chainCycleDays + " + " + prof.chainUnsplitDays + " vs " + prof.pathDays);
  results.push("  note  " + prof.tasks + " tasks, " + prof.summedDays + " d of work, " + prof.pathDays +
    " d on the path, parallelism " + prof.parallelism + "x, chain " + prof.chainSteps + " steps");

  /* every what-if must shorten the path, never lengthen it */
  const rebuild = proc => VSM.schedule.build(proc, res.taxonomy, iScenario, res.scenario.rules, res.scenario.attributes);
  const halved = rebuild(VSM.analyze.scaleLead(res.process, 0.5));
  ok("halving every wait shortens the path", halved.metrics.currentElapsed < iModel.metrics.currentElapsed);
  ok("halving every wait does not halve the path (working time remains)",
    halved.metrics.currentElapsed > iModel.metrics.currentElapsed * 0.45,
    "path fell further than the waiting in it, which means the lead/cycle split is not being respected");
  const capped = rebuild(VSM.analyze.capWait(res.process, 10, perDay));
  ok("capping waits shortens the path", capped.metrics.currentElapsed <= iModel.metrics.currentElapsed);
  ok("a what-if never changes the task count", capped.nodes.length === iModel.nodes.length && halved.nodes.length === iModel.nodes.length);

  /* ===================================================== 3d. shipped profiles */
  section("shipped profiles and the handoff count");
  const sd = VSM.data;
  const sBase = VSM.rules.defaults(sd.scenario.attributes);
  const eff = sc => {
    const out = Object.assign({}, sc);
    sd.scenario.attributes.forEach(a => {
      if (!VSM.rules.isEnabled(a, sc, sd.scenario.rules)) {
        out[a.id] = a.disabledValue !== undefined ? a.disabledValue : (a.type === "boolean" ? false : a.type === "multi" ? [] : out[a.id]);
      }
    });
    return out;
  };
  const runP = set => VSM.schedule.build(sd.process, sd.taxonomy, eff(Object.assign({}, sBase, set)), sd.scenario.rules, sd.scenario.attributes);

  eq("seven work-type profiles", sd.scenario.presets.length, 7);
  ok("every profile is partial, so modifiers survive a profile change",
    sd.scenario.presets.every(p => p.partial === true && p.set));
  ok("no profile declares hosting, AI or integrations",
    sd.scenario.presets.every(p => !("hosting" in p.set) && !("aiWorkload" in p.set) && !("integrations" in p.set)),
    "a profile that sets those would stamp on the modifiers");

  const counts = sd.scenario.presets.map(p => ({ label: p.label, n: runP(p.set).nodes.length }));
  results.push("\n  profile                              tasks");
  counts.forEach(c => results.push("  " + c.label.padEnd(36) + String(c.n).padStart(5)));
  ok("the profiles separate by at least 12 tasks",
    Math.max(...counts.map(c => c.n)) - Math.min(...counts.map(c => c.n)) >= 12,
    counts.map(c => c.n).join(", "));

  /* reported bug: the chart drew handoff rings while the panel said 0 */
  const hm = runP({});
  eq("the handoff chip matches the rings on the chart",
    (hm.metrics.byWaste.handoff || { count: 0 }).count, hm.metrics.handoffs);
  ok("handoffs are actually detected", hm.metrics.handoffs > 0);
  ok("a derived waste type is marked as such", (hm.metrics.byWaste.handoff || {}).derived === true);

  /* removed and renamed things must be gone from the data, not just the panel */
  const ids = sd.scenario.attributes.map(a => a.id);
  ok("securityReview is gone", ids.indexOf("securityReview") < 0);
  ok("dataClassification is gone", ids.indexOf("dataClassification") < 0);
  ok("pilotPoc replaces drRequired", ids.indexOf("pilotPoc") >= 0 && ids.indexOf("drRequired") < 0);
  ok("Data Privacy Review defaults on", sd.scenario.attributes.find(a => a.id === "privacyReview").default === true);
  /* It is on by default, but it is never taken away from the person doing the
     tailoring. Whether a workload actually handles personal data is their
     call, not a rule's. */
  ok("Data Privacy Review is always available to toggle", (() => {
    const a = sd.scenario.attributes.find(x => x.id === "privacyReview");
    return a.enabledWhen === undefined && a.disabledValue === undefined
      && VSM.rules.isEnabled(a, Object.assign({}, sBase, { pilotPoc: false }), sd.scenario.rules)
      && VSM.rules.isEnabled(a, Object.assign({}, sBase, { pilotPoc: true }), sd.scenario.rules);
  })());
  ok("turning it off actually turns it off, pilot or not", (() => {
    const offProd = eff(Object.assign({}, sBase, { pilotPoc: false, privacyReview: false }));
    const offPilot = eff(Object.assign({}, sBase, { pilotPoc: true, privacyReview: false }));
    return offProd.privacyReview === false && offPilot.privacyReview === false;
  })());
  ok("turning it off drops the privacy work",
    runP({ privacyReview: false }).nodes.length < runP({ privacyReview: true }).nodes.length);
  ok("a pilot drops the DR work", runP({ pilotPoc: true }).nodes.length < runP({ pilotPoc: false }).nodes.length);

  const names = sd.process.activities.map(a => a.name);
  ["Architecture Review Board", "Security review", "Threat modeling & access review"].forEach(n =>
    ok("activity renamed: " + n, names.indexOf(n) >= 0));
  ["Global Architecture Council", "SRD Review", "Routing & Access Controls (RAC)", "OKTA SSO integration"].forEach(n =>
    ok("company-specific name gone: " + n, names.indexOf(n) < 0));

  const opts = (sd.scenario.attributes.find(a => a.id === "integrations").options || []).map(o => o.label);
  ["Core systems integration", "API gateway", "Data warehouse", "SSO", "Public Internet",
   "Private Network (Internal Only)", "Web Proxy", "Managed file transfer"].forEach(l =>
    ok("integration option: " + l, opts.indexOf(l) >= 0));
  ok("every integration option drives at least one activity", (() => {
    const none = runP({ integrations: [] }).nodes.length;
    return (sd.scenario.attributes.find(a => a.id === "integrations").options || [])
      .every(o => runP({ integrations: [o.value] }).nodes.length > none);
  })(), "an option that changes nothing is a control that lies");

  /* A repo that ships as a template should not carry one company's internal
     names. This walks the source tree rather than the model, so it also
     catches a stray reference in a comment, a README or the fixture. */
  (function houseKeeping() {
    const fs = require("fs"), path = require("path"), root = path.join(__dirname, "..");
    const BANNED = [/\bGMF\b/i, /GM Financial/i, /\bOKTA\b/i, /\bSRD\b/, /Databricks/i,
                    /\bCCoE\b/i, /Global Architecture Council/i, /\/home\/[a-z]+\//i];
    const skip = new Set(["dist", "node_modules", ".git", "__pycache__"]);
    const hits = [];
    (function walk(dir) {
      fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
        if (skip.has(e.name)) return;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return walk(full);
        if (!/\.(js|ts|tsx|html|css|md|py)$/.test(e.name)) return;
        if (full === __filename) return;
        const text = fs.readFileSync(full, "utf8");
        BANNED.forEach(re => { if (re.test(text)) hits.push(path.relative(root, full) + " :: " + re); });
      });
    })(root);
    ok("no company-specific strings anywhere in the source tree", hits.length === 0, hits.join("; "));
  })();

  /* ===================================================== 3e. export format */
  section("export in the workbook format");
  const em = runP({});
  const esheets = VSM.exportWorkbook.sheets(em, { scenarioCfg: sd.scenario, scenarioSummary: "test" });
  const taskSheet = esheets.find(s2 => s2.name === "Task List");
  const want = VSM.schema.TASK.map(c => c.header);
  eq("Task List has all 25 columns", taskSheet.headers.length, 25);
  ok("headers match the schema exactly, in order", JSON.stringify(taskSheet.headers) === JSON.stringify(want),
    JSON.stringify(taskSheet.headers.filter((h, i) => h !== want[i])));
  eq("one row per rendered task", taskSheet.rows.length, em.nodes.length);
  ok("an Edges sheet is written", !!esheets.find(s2 => s2.name === "Edges"));
  ok("the schedule columns are filled in", taskSheet.rows.every(r => r["Earliest Finish (day)"] !== "" && r["Duration (days)"] !== ""));
  ok("at least one row is flagged critical", taskSheet.rows.some(r => r["Critical Path"] === "Yes"));
  ok("every Step Type is a known Lean value", (() => {
    const known = VSM.schema.PICKLISTS.stepType.values.map(v => v.value);
    return taskSheet.rows.every(r => known.indexOf(r["Step Type (Lean)"]) >= 0);
  })());
  ok("the export records which scenario it was", (() => {
    const notes = esheets.find(s2 => s2.name === "Export Notes");
    return !!notes && notes.rows.some(r => r.Field === "Scenario");
  })(), "an export that does not say its scope can be mistaken for the master list");

  /* ===================================================== 3f. extra worksheets */
  section("worksheets the app does not know about");
  {
    const sheetsCopy = await VSM.table.parseXLSX(VSM.readWorkbook(file));
    sheetsCopy["Team Notes"] = [["Team", "Note"], ["Platform", "owns the paved road"]];
    sheetsCopy["Q4 Actuals"] = [["ID", "Actual Days"], [1, 4.5]];
    sheetsCopy["Pivot - Gates by Team"] = [["Team", "Gates"], ["Platform", 4]];
    const withExtra = VSM.import.fromSheets(sheetsCopy, { source: "extra-sheets" });
    ok("adding unknown worksheets causes no errors", withExtra.report.errors.length === 0,
      withExtra.report.errors.join(" | "));
    eq("the task count is unaffected", withExtra.report.counts.tasks, res.report.counts.tasks);
    eq("the edge count is unaffected", withExtra.report.counts.edges, res.report.counts.edges);
    ok("unknown worksheets are not even mentioned",
      !withExtra.report.warnings.some(w => /Team Notes|Q4 Actuals|Pivot/.test(w)));
    /* No reserved name may be claimed by two DIFFERENT sheets, or a workbook
       would have two tabs fighting over one slot and the winner would be
       whichever Excel happened to list first. Spellings that normalise to the
       same thing within one sheet's own alias list are fine. */
    const owner = new Map(), clashes = [];
    Object.entries(VSM.schema.SHEETS).forEach(([key, sh]) => {
      [sh.name].concat(sh.aliases || []).forEach(n => {
        const nm = VSM.schema.norm(n);
        if (owner.has(nm) && owner.get(nm) !== key) clashes.push(n + ": " + owner.get(nm) + " vs " + key);
        else owner.set(nm, key);
      });
    });
    ok("no reserved worksheet name is claimed by two different sheets", clashes.length === 0, clashes.join(" | "));
  }

  /* ===================================================== 3g. Teams sheet */
  section("teams cross-reference");
  {
    const tm = runP({});
    const tsheets = VSM.exportWorkbook.sheets(tm, { scenarioCfg: sd.scenario, scenarioSummary: "test" });
    const teams = tsheets.find(x => x.name === "Teams");
    ok("a Teams sheet is written", !!teams);
    ok("it maps every short name shown on the chart back to a full name", (() => {
      const shorts = new Set(teams.rows.map(r => r["Short Name (shown on the chart)"]));
      return tm.nodes.every(n => shorts.has((n.team.short || n.team.label)));
    })(), "a short name on the chart with no row here would be a mystery to the reader");
    ok("only teams that own a task in this export are listed",
      teams.rows.length === new Set(tm.nodes.map(n => n.owner)).size);
    ok("every listed team owns at least one task", teams.rows.every(r => r["Tasks in this export"] > 0));
    eq("the task counts add up to the export",
      teams.rows.reduce((a, r) => a + r["Tasks in this export"], 0), tm.nodes.length);
    ok("the full names match the Task List column", (() => {
      const task = tsheets.find(x => x.name === "Task List");
      const full = new Set(teams.rows.map(r => r["Assigned Team (full name)"]));
      return task.rows.every(r => !r["Assigned Team"] || full.has(r["Assigned Team"]));
    })());
  }

  /* ===================================================== 3h. hidden work type */
  section("work type is the dropdown, not a duplicate control");
  {
    const wt = sd.scenario.attributes.find(a => a.id === "workType");
    ok("work type still exists in the model", !!wt);
    ok("work type is hidden from the control panel", wt.hidden === true);
    ok("every profile still sets it", sd.scenario.presets.every(p => "workType" in p.set));
    ok("the work-type rules still resolve", (() => {
      const a = runP(sd.scenario.presets[0].set).nodes.length;
      const b = runP(sd.scenario.presets[6].set).nodes.length;
      return a !== b;
    })(), "if hiding the control broke the rules, every profile would render the same");
  }

  /* ===================================================== 3i. units */
  section("business days, said out loud");
  {
    const U = VSM.units;
    eq("a working day is 8 hours", U.HOURS_PER_DAY, 8);
    eq("a working week is 5 days", U.DAYS_PER_WEEK, 5);
    eq("a calendar month is 21 business days", U.DAYS_PER_MONTH, 21);
    eq("a calendar year is 260 business days", U.DAYS_PER_YEAR, 260);
    /* the spans the app prints must be CALENDAR spans of business days */
    eq("260 business days reads as a year", U.human(260), "1 years");
    eq("21 business days reads as a month", U.human(21), "1 months");
    eq("10 business days reads as two weeks", U.human(10), "2 weeks");
    eq("335 business days is 469 calendar days", U.calendarDays(335), 469);
    ok("the day unit says business day, not day",
      /business day/i.test(U.resolve({ units: "business days" }).many));
    ok("the axis origin says which kind of day it is",
      /bus/i.test(U.resolve({ units: "business days" }).originLabel));
    /* the scheduler must stay calendar-free: it adds numbers, nothing more */
    ok("the scheduler contains no calendar logic", (() => {
      const src = require("fs").readFileSync(path.join(__dirname, "..", "js", "schedule.js"), "utf8");
      return !/new Date|getDay\(|weekend|holiday/.test(src);
    })(), "a scheduler that half-knows about weekends is worse than one that does not");

    /* the units check should call a clean 8-hour grid what it is */
    const clean = { activities: [8, 16, 40, 80, 24, 120].map((v, i) =>
      ({ id: "t" + i, name: "t" + i, time: { leadCurrent: v, cycleCurrent: 4 } })) };
    ok("a workbook on the 8-hour grid is recognised",
      /business hours/i.test(VSM.analyze.unitCheck(clean, 8).verdict),
      VSM.analyze.unitCheck(clean, 8).verdict);
    const cal = { activities: [24, 72, 168, 336, 24, 168].map((v, i) =>
      ({ id: "c" + i, name: "c" + i, time: { leadCurrent: v, cycleCurrent: 4 } })) };
    const cv = VSM.analyze.unitCheck(cal, 8).verdict;
    ok("a workbook on the 24-hour grid is flagged, not silently converted",
      /calendar|mixed/i.test(cv), cv);
  }

  /* ===================================================== 3j. chart vs file */
  section("everything on the chart is in the file");
  {
    const cm = runP({});
    const cs = VSM.exportWorkbook.sheets(cm, { scenarioCfg: sd.scenario, scenarioSummary: "test" });
    const task = cs.find(x => x.name === "Task List");
    const chart = cs.find(x => x.name === "Chart View");

    eq("the Task List is still exactly the 25 declared columns", task.headers.length, 25);
    ok("Chart View has a row per drawn row", !!chart && chart.rows.length === cm.nodes.length);

    /* the handoff rings: the chart draws them, nothing in A..Y names them */
    eq("every handoff ring is listed",
      chart.rows.filter(r => r["Receives handoff"] === "Yes").length, cm.metrics.handoffs);
    ok("a ring says which team handed over",
      chart.rows.filter(r => r["Receives handoff"] === "Yes").every(r => r["Handoff from"].length > 0));
    eq("cross-boundary rings are counted too",
      chart.rows.filter(r => r["Cross-boundary handoff"] === "Yes").length, cm.metrics.crossOrgHandoffs);

    /* the right-hand column prints cur / opt / rem, so rem must be somewhere */
    ok("the removable figure the chart prints is in the file",
      chart.rows.every(r => r.Removable !== "" && r.Removable !== undefined));
    ok("removable equals current minus optimal on every row", chart.rows.every(r => {
      const cur = r["Current (days)"] !== undefined ? r["Current (days)"] : r["Current (hrs)"];
      return Math.abs((cur - r.Optimal) - r.Removable) < 0.02;
    }));

    /* gates, milestones and the critical underline */
    eq("gate diamonds are listed", chart.rows.filter(r => r.Gate === "Yes").length, cm.metrics.gates);
    eq("the critical underline matches the Critical Path column",
      chart.rows.filter(r => r["On critical path"] === "Yes").length,
      task.rows.filter(r => r["Critical Path"] === "Yes").length);

    /* a stretched row must say so where the hours are, not only on another tab */
    const stretched = VSM.schedule.build(
      { ...sd.process, activities: sd.process.activities.map((a, i) =>
          i === 0 ? { ...a, multipliers: [{ when: true, factor: 2, note: "test stretch" }] } : a) },
      sd.taxonomy, eff(sBase), sd.scenario.rules, sd.scenario.attributes);
    const st = VSM.exportWorkbook.sheets(stretched, { scenarioCfg: sd.scenario, scenarioSummary: "test" });
    const stretchedRow = st.find(x => x.name === "Task List").rows.find(r => /multiplier/i.test(r.Notes));
    ok("a scenario multiplier is declared in the row that carries it", !!stretchedRow,
      "silently stretched hours look like a data error against the source workbook");
    ok("and it names the factor", stretchedRow && /2x/.test(stretchedRow.Notes), stretchedRow && stretchedRow.Notes);

    /* Chart View must not be mistaken for an input sheet on re-import */
    ok("Chart View is not a reserved worksheet name", VSM.schema.sheetByName("Chart View") === null);
    ok("Teams is not a reserved input sheet either", VSM.schema.sheetByName("Teams") === null);
  }

  /* ===================================================== 3k. embed API */
  section("embeddable in someone else's app");
  {
    /* The embed API must not depend on js/app.js. A host application supplies
       its own chrome, so anything that reaches back into the page would break
       the moment this runs inside Backstage. */
    const src = require("fs").readFileSync(path.join(__dirname, "..", "js", "embed.js"), "utf8");
    ok("embed does not reach into the app's own DOM",
      !/getElementById|#sidebar|#chart|#metrics|localStorage/.test(src),
      "a host owns its page; the chart must only touch the container it is given");
    ok("embed does not depend on app.js", !/VSM\.app/.test(src));

    /* the scenario resolution the host relies on, checked headlessly */
    const cfg = sd.scenario;
    const base = VSM.embed.resolveScenario(cfg, null, null);
    eq("no profile gives the declared defaults", base.workType, "paved");
    const saas = VSM.embed.resolveScenario(cfg, "adopt-saas", null);
    eq("a profile sets its work type", saas.workType, "saas");
    const saasAi = VSM.embed.resolveScenario(cfg, "adopt-saas", { aiWorkload: true });
    ok("overrides ride on top of a profile", saasAi.workType === "saas" && saasAi.aiWorkload === true);
    ok("resolution is order independent", (() => {
      const a = VSM.embed.resolveScenario(cfg, "deploy-cots", { aiWorkload: true, pilotPoc: true });
      const b = VSM.embed.resolveScenario(cfg, "deploy-cots", { pilotPoc: true, aiWorkload: true });
      return JSON.stringify(a) === JSON.stringify(b);
    })());

    /* the host gets what it needs to build its own controls */
    const model = VSM.schedule.build(sd.process, sd.taxonomy, saas, cfg.rules, cfg.attributes);
    ok("a profile resolved by embed schedules the same as one resolved by the app",
      model.nodes.length === runP(cfg.presets.find(p => p.id === "adopt-saas").set).nodes.length);
  }

  /* ===================================================== 4. round trip */
  section("excel round trip");
  const wb = VSM.table.toXLSX([{ name: "Activities", headers: VSM.table.COLUMNS.map(x => x.key), widths: VSM.table.COLUMNS.map(x => x.width), rows: res.process.activities.slice(0, 40).map(VSM.table.activityToRow) }]);
  const buf = await wb.arrayBuffer();
  const back = await VSM.table.parseXLSX(buf);
  ok("a written workbook reads back", !!back.Activities && back.Activities.length === 41);
  const rows = VSM.table.toObjects(back.Activities);
  const first = res.process.activities[0];
  eq("round trip keeps the id", String(rows[0].id), String(first.id));
  eq("round trip keeps the duration", Number(rows[0].current), first.duration.current, 0.001);
  ok("round trip keeps an ampersand in a name", (() => {
    const amp = res.process.activities.slice(0, 40).findIndex(a => /&/.test(a.name));
    return amp < 0 ? true : rows[amp].name === res.process.activities[amp].name;
  })());

  report();

  function report() {
    console.log(results.join("\n"));
    console.log("\n" + pass + " passed, " + fail + " failed");
    if (res && res.report) {
      const u = res.report.unmappedList || [];
      if (u.length) console.log("\nvalues outside the known picklists:\n" + u.map(x => "  " + x.list + ": '" + x.value + "' (" + x.count + ")").join("\n"));
      if (res.report.warnings.length) console.log("\nwarnings (" + res.report.warnings.length + "):\n" + res.report.warnings.slice(0, 8).map(w => "  " + w).join("\n"));
      if (res.report.notes.length) console.log("\nnotes:\n" + res.report.notes.map(n => "  " + n).join("\n"));
      console.log("\nstill guessing at (js/schema.js):\n" + res.report.unconfirmed.map(x => "  " + x).join("\n"));
    }
    process.exit(fail ? 1 : 0);
  }
})().catch(e => { console.error(e); process.exit(1); });
