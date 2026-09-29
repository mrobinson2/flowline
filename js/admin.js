/* ============================================================================
   ADMIN CORE - the rule layer edited from the app, never from code (spec §4.7).
   ----------------------------------------------------------------------------
   This file is the Node-tested half: reference finding (what blocks retiring
   a variable), the IMPACT PREVIEW (replay every saved scenario against the
   live data and the candidate and diff the two - the one feature
   without which nobody dares edit a rule), the version log, and the text
   round trip the rule editor uses. The overlay is js/admin-ui.js; its apply
   path goes through the same validate-then-persist contract as every import.
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

  /* Replay each saved run's own answers and overrides against the LIVE data
     and against the CANDIDATE, and diff the two: that difference is what THIS
     edit does to the run. Diffing the candidate against what the run recorded
     instead would pin every earlier applied change on the edit under review
     (a run saved before last week's rule change shows that change forever).
     A run whose live replay no longer matches its recording is flagged
     `stale` so the table can say it was saved under older rules. The current
     sidebar state rides along as a pseudo-run supplied by the caller. */
  function replay(d, run, fallbackTaxonomy) {
    /* the answers as the engine sees them under THESE gates - the same
       neutralizing the app applies before every build */
    const answers = VSM.rules.effective(d.scenario.attributes, run.answers || {}, d.scenario.rules);
    const m = VSM.schedule.build(d.process, d.taxonomy || fallbackTaxonomy,
      answers, d.scenario.rules, d.scenario.attributes,
      { derived: run.overrides || {}, tasks: run.taskOverrides || {} });
    return m.nodes.map(n => n.id);
  }
  function impact(data, candidate, runs) {
    return (runs || []).map(run => {
      const recorded = run.includedKeys || [];
      /* a run that no longer replays under the live data is stale by
         definition; its recording is the best "before" there is */
      let now, broken = false;
      try { now = replay(data, run); } catch (e) { now = recorded; broken = true; }
      const rec = new Set(recorded);
      const stale = broken || now.length !== recorded.length || now.some(id => !rec.has(id));
      let after;
      try { after = replay(candidate, run, data.taxonomy); }
      catch (e) {
        return { runId: run.runId, name: run.name, error: e.message, added: [], removed: [], before: now.length, after: 0, stale };
      }
      const was = new Set(now), next = new Set(after);
      return {
        runId: run.runId, name: run.name,
        added: after.filter(id => !was.has(id)),
        removed: now.filter(id => !next.has(id)),
        before: now.length, after: after.length, stale
      };
    });
  }

  /* Rule text for the editor. The expression language names rules R_<id>;
     workbook imports key them that way, but the shipped data (and anything
     hand-written) keys them bare, e.g. "drRequired". The editor shows every
     rule reference as R_ and maps it back on the way in, so a bare-keyed rule
     round-trips instead of reading as an unknown attribute. */
  const alias = id => (/^R_/.test(id) ? id : "R_" + id);
  function mapRefs(rule, fn, d) {
    const depth = d || 0;
    if (depth > 64) return rule;
    if (typeof rule === "string") return fn(rule);
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) return rule;
    const keys = Object.keys(rule);
    if (keys.length === 1 && (keys[0] === "all" || keys[0] === "any"))
      return { [keys[0]]: (rule[keys[0]] || []).map(r => mapRefs(r, fn, depth + 1)) };
    if (keys.length === 1 && keys[0] === "not") return { not: mapRefs(rule.not, fn, depth + 1) };
    return rule;                                   // a comparison: values are data, not refs
  }
  /* -> { text, json: false } or, for a shape the grammar cannot say,
     { text: <pretty JSON>, json: true } */
  function ruleToText(rule) {
    try { return { text: VSM.expr.print(mapRefs(rule, alias)), json: false }; }
    catch (e) { return { text: JSON.stringify(rule, null, 2), json: true }; }
  }
  /* -> { rule, warnings }; throws with .column (from expr.compile) */
  function textToRule(text, attrDefs, ruleIds) {
    const ids = ruleIds || [];
    const back = new Map(ids.map(id => [alias(id), id]));
    const c = VSM.expr.compile(text, attrDefs, [...back.keys()]);
    return { rule: mapRefs(c.rule, r => (back.has(r) ? back.get(r) : r)), warnings: c.warnings };
  }

  /* Derivations as one Derivation cell. A boolean derives from one rule;
     an enum from ORDERED cases, first match wins, then the default:

       custom WHEN architectureDeviation OR newEnterprisePlatform; fast WHEN
       approvedPatternExists AND patternConforms; ELSE standard

     Cases are split on ";" outside quotes and at the first WHEN outside
     quotes; WHEN and ELSE are uppercase keywords, like AND/OR. A value that
     is not a plain word is quoted. */
  const plainValue = v => /^[A-Za-z0-9_.\-]+$/.test(v) && VSM.expr.KEYWORDS.indexOf(v.toUpperCase()) < 0 && !/^(when|else)$/i.test(v);
  function derivationToText(derive) {
    if (!derive) return { text: "", json: false };
    if (derive.when !== undefined) return ruleToText(derive.when);
    const val = v => {
      const s = String(v);
      if (plainValue(s)) return s;
      if (s.indexOf('"') >= 0) throw new Error("a value containing double quotes");
      return '"' + s + '"';
    };
    try {
      const parts = (derive.cases || []).map(c => {
        const t = ruleToText(c.when);
        if (t.json) throw new Error("case not expressible");
        return val(c.value) + " WHEN " + t.text;
      });
      if (derive.default !== undefined && derive.default !== null) parts.push("ELSE " + val(derive.default));
      return { text: parts.join("; "), json: false };
    } catch (e) { return { text: JSON.stringify(derive), json: true }; }
  }
  /* split on sep outside double or single quotes */
  function splitOutside(text, re) {
    const out = [];
    let q = null, start = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      const m = re.exec(text.slice(i));
      if (m && m.index === 0) { out.push(text.slice(start, i)); i += m[0].length - 1; start = i + 1; if (re.once) break; }
    }
    out.push(text.slice(start));
    return out;
  }
  const unquote = s => { const t = s.trim(); return /^(["']).*\1$/.test(t) ? t.slice(1, -1) : t; };
  /* -> derive object; throws with a message naming the case */
  function textToDerivation(text, attr, attrDefs, ruleIds) {
    if (attr.type !== "enum") return { when: textToRule(text, attrDefs, ruleIds).rule };
    const known = new Set((attr.options || []).map(o => o.value));
    const check = (v, where) => {
      if (known.size && !known.has(v)) throw new Error(where + ": '" + v + "' is not one of " + attr.id + "'s options (" + [...known].join(", ") + ")");
      return v;
    };
    const out = { cases: [] };
    const segs = splitOutside(String(text), /^;/).map(x => x.trim()).filter(Boolean);
    segs.forEach((seg, i) => {
      const where = "case " + (i + 1);
      const el = /^ELSE\s+([\s\S]+)$/.exec(seg);
      if (el) {
        if (i !== segs.length - 1) throw new Error(where + ": ELSE must be the last case");
        out.default = check(unquote(el[1]), where);
        return;
      }
      const re = /^\sWHEN\s/; re.once = true;
      const [lhs, rhs] = splitOutside(" " + seg, re);
      if (rhs === undefined) throw new Error(where + ": expected '<value> WHEN <condition>' or 'ELSE <value>'");
      let when;
      try { when = textToRule(rhs, attrDefs, ruleIds).rule; }
      catch (e) { throw Object.assign(new Error(where + ": " + e.message), { column: e.column }); }
      out.cases.push({ when, value: check(unquote(lhs), where) });
    });
    if (!out.cases.length) throw new Error("no WHEN cases");
    return out;
  }

  /* An edited condition is authored text from now on: it is exported as the
     row's Include Expression (which wins over the Scenario Matrix on
     re-import), and the workbook's own phrase and explanation are dropped
     because they describe the rule that was replaced. TRUE means always. */
  function setCondition(activity, rule) {
    if (rule === true) delete activity.when; else activity.when = rule;
    activity.whenSource = "expression";
    delete activity.appliesWhen;
    delete activity.triggerExplanation;
    return activity;
  }

  /* every applied change leaves a row { timestamp, author, target, before,
     after }; the log travels with the scenario (JSON and workbook export) */
  function pushVersion(scenario, entry) {
    if (!Array.isArray(scenario.versions)) scenario.versions = [];
    scenario.versions.push(Object.assign({ timestamp: new Date().toISOString(), author: "" }, entry));
    while (scenario.versions.length > 100) scenario.versions.shift();
    return scenario.versions;
  }

  VSM.admin = { referencesTo, impact, pushVersion, setCondition, ruleToText, textToRule, alias, derivationToText, textToDerivation };
  if (typeof module !== "undefined" && module.exports) module.exports = VSM.admin;
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
