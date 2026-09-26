/* ============================================================================
   ADMIN CORE - the rule layer edited from the app, never from code (spec §4.7).
   ----------------------------------------------------------------------------
   This file is the Node-tested half: reference finding (what blocks retiring
   a variable), the IMPACT PREVIEW (replay every saved scenario against the
   candidate data and diff each against what it recorded - the one feature
   without which nobody dares edit a rule), and the version log. The overlay
   that drives it lives in js/app.js, and the apply path goes through the same
   validate-then-persist contract as every import.
   ========================================================================== */
(function (root) {
  const VSM = root.VSM = root.VSM || {};

  /* attribute ids a JSON rule reads, named-rule refs left as names */
  function ruleAttrs(rule, out, depth) {
    const d = depth || 0;
    if (d > 64 || rule === undefined || rule === null || typeof rule === "boolean" || typeof rule === "string") return out;
    if (Array.isArray(rule)) { rule.forEach(r => ruleAttrs(r, out, d + 1)); return out; }
    if (typeof rule !== "object") return out;
    Object.keys(rule).forEach(k => {
      if (k === "all" || k === "any") { (rule[k] || []).forEach(r => ruleAttrs(r, out, d + 1)); return; }
      if (k === "not") { ruleAttrs(rule[k], out, d + 1); return; }
      out.push(k);
    });
    return out;
  }
  const reads = (rule, attrId) => ruleAttrs(rule, [], 0).includes(attrId);

  /* Everything that would break if attrId disappeared. A retire is blocked
     while this is non-empty, and the list is shown - "delete it anyway" with
     ghost references is exactly the silent-false failure validate.js exists
     to prevent. */
  function referencesTo(data, attrId) {
    const out = [];
    ((data.process && data.process.activities) || []).forEach(a => {
      if (reads(a.when, attrId)) out.push({ kind: "activity", id: a.id, label: a.name });
      (a.overrides || []).forEach(o => { if (reads(o.when, attrId)) out.push({ kind: "activity", id: a.id, label: a.name + " (duration override)" }); });
      (a.multipliers || []).forEach(m => { if (reads(m.when, attrId)) out.push({ kind: "activity", id: a.id, label: a.name + " (multiplier)" }); });
    });
    const sc = data.scenario || {};
    Object.keys(sc.rules || {}).forEach(id => { if (reads(sc.rules[id], attrId)) out.push({ kind: "rule", id }); });
    (sc.attributes || []).forEach(a => {
      if (a.id === attrId) return;
      if (a.derive && (reads(a.derive.when, attrId) || (a.derive.cases || []).some(c => reads(c.when, attrId))))
        out.push({ kind: "derive", id: a.id, label: a.label });
      if (reads(a.shownWhen, attrId)) out.push({ kind: "shownWhen", id: a.id, label: a.label });
      if (reads(a.enabledWhen, attrId)) out.push({ kind: "enabledWhen", id: a.id, label: a.label });
    });
    (sc.presets || []).forEach(p => {
      if (p.set && Object.prototype.hasOwnProperty.call(p.set, attrId)) out.push({ kind: "preset", id: p.id, label: p.label });
    });
    return out;
  }

  /* Replay each saved run's own answers and overrides against the CANDIDATE
     data, and diff what comes out against what the run recorded. The current
     sidebar state rides along as a pseudo-run supplied by the caller. */
  function impact(data, candidate, runs) {
    return (runs || []).map(run => {
      let after;
      try {
        const m = VSM.schedule.build(candidate.process, candidate.taxonomy || data.taxonomy,
          Object.assign({}, run.answers), candidate.scenario.rules, candidate.scenario.attributes,
          { derived: run.overrides || {}, tasks: run.taskOverrides || {} });
        after = m.nodes.map(n => n.id);
      } catch (e) {
        return { runId: run.runId, name: run.name, error: e.message, added: [], removed: [], before: run.includedKeys.length, after: 0 };
      }
      const was = new Set(run.includedKeys), now = new Set(after);
      return {
        runId: run.runId, name: run.name,
        added: after.filter(id => !was.has(id)),
        removed: run.includedKeys.filter(id => !now.has(id)),
        before: run.includedKeys.length, after: after.length
      };
    });
  }

  /* every applied change leaves a row; the log travels with the scenario */
  function pushVersion(scenario, entry) {
    if (!Array.isArray(scenario.versions)) scenario.versions = [];
    scenario.versions.push(Object.assign({ ts: new Date().toISOString() }, entry));
    while (scenario.versions.length > 100) scenario.versions.shift();
    return scenario.versions;
  }

  VSM.admin = { referencesTo, impact, pushVersion };
  if (typeof module !== "undefined" && module.exports) module.exports = VSM.admin;
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
