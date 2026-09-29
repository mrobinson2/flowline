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
  function impact(data, candidate, runs, renames) {
    const acts = (renames && renames.activities) || {};
    const ra = id => (Object.prototype.hasOwnProperty.call(acts, id) ? acts[id] : id);
    return (runs || []).map(run => {
      const recorded = run.includedKeys || [];
      /* a run that no longer replays under the live data is stale by
         definition; its recording is the best "before" there is */
      let now, broken = false;
      try { now = replay(data, run); } catch (e) { now = recorded; broken = true; }
      const rec = new Set(recorded);
      const stale = broken || now.length !== recorded.length || now.some(id => !rec.has(id));
      /* the candidate speaks the renamed vocabulary: replay the run in it,
         and compare against the live result under the new names */
      now = now.map(ra);
      let after;
      try { after = replay(candidate, renames ? renameRun(run, renames) : run, data.taxonomy); }
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

  /* ------------------------------------------------------------- renaming
     An id is a name other things point at. Renaming one rewrites every
     pointer in the candidate - never the live data - and returns how many it
     moved. The candidate then goes through the same validate / preview /
     apply path as any edit, so a rename that would leave a ghost fails
     validation instead of reaching the chart.

     Rule JSON is walked structurally: a comparison object's KEYS are
     variable ids, a bare string in a rule position is a named-rule
     reference, and values are data (renaming a variable to "tier" does not
     rewrite an option called "tier"). */
  function mapRule(rule, onKey, onRef, d) {
    const depth = d || 0;
    if (depth > 64) return rule;
    if (typeof rule === "string") return onRef ? onRef(rule) : rule;
    if (Array.isArray(rule)) return rule.map(r => mapRule(r, onKey, onRef, depth + 1));
    if (!rule || typeof rule !== "object") return rule;
    const keys = Object.keys(rule);
    if (keys.length === 1 && (keys[0] === "all" || keys[0] === "any"))
      return { [keys[0]]: (rule[keys[0]] || []).map(r => mapRule(r, onKey, onRef, depth + 1)) };
    if (keys.length === 1 && keys[0] === "not") return { not: mapRule(rule.not, onKey, onRef, depth + 1) };
    if (!onKey) return rule;
    const out = {};
    keys.forEach(k => { out[onKey(k)] = rule[k]; });
    return out;
  }
  /* every rule-valued slot in the data, rewritten in place */
  function eachRule(data, fn) {
    ((data.process && data.process.activities) || []).forEach(a => {
      if (a.when !== undefined) a.when = fn(a.when);
      (a.overrides || []).forEach(o => { if (o.when !== undefined) o.when = fn(o.when); });
      (a.multipliers || []).forEach(m => { if (m.when !== undefined) m.when = fn(m.when); });
    });
    const sc = data.scenario || {};
    Object.keys(sc.rules || {}).forEach(k => { sc.rules[k] = fn(sc.rules[k]); });
    (sc.attributes || []).forEach(a => {
      if (a.shownWhen !== undefined) a.shownWhen = fn(a.shownWhen);
      if (a.enabledWhen !== undefined) a.enabledWhen = fn(a.enabledWhen);
      if (a.derive) {
        if (a.derive.when !== undefined) a.derive.when = fn(a.derive.when);
        (a.derive.cases || []).forEach(c => { c.when = fn(c.when); });
      }
    });
  }
  /* rename a key of a plain object without moving it in the key order */
  function renameKey(obj, from, to) {
    if (!obj || !Object.prototype.hasOwnProperty.call(obj, from)) return obj;
    const out = {};
    Object.keys(obj).forEach(k => { out[k === from ? to : k] = obj[k]; });
    return out;
  }
  const ACT_ID = /^[A-Za-z0-9][A-Za-z0-9_.\-]*$/, VAR_ID = /^[A-Za-z][A-Za-z0-9_]*$/;
  /* -> null when newId may replace oldId, else the reason it may not */
  function checkId(data, kind, oldId, newId) {
    const id = String(newId || "").trim();
    if (!id) return "The id cannot be empty.";
    if (id === oldId) return null;
    const sc = data.scenario || {};
    if (kind === "activity") {
      if (!ACT_ID.test(id)) return "An activity id starts with a letter or digit and uses letters, digits, '-', '_' or '.'.";
      if (((data.process && data.process.activities) || []).some(a => a.id === id)) return "'" + id + "' is already the id of another activity.";
      return null;
    }
    if (kind === "variable" && /^R_/.test(id)) return "R_ is reserved for rule names.";
    const bare = kind === "rule" ? id.replace(/^R_/, "") : id;
    if (!VAR_ID.test(bare)) return "An id must start with a letter and use only letters, digits and _.";
    const taken = (sc.attributes || []).map(a => a.id).concat(Object.keys(sc.rules || {})).filter(x => x !== oldId);
    if (taken.includes(id) || taken.includes(bare) || taken.includes(alias(bare))) return "'" + id + "' is already a variable or rule.";
    return null;
  }
  function renameActivity(data, oldId, newId) {
    let n = 0;
    ((data.process && data.process.activities) || []).forEach(a => {
      if (a.id === oldId) { a.id = newId; n++; }
      ["predecessors", "handoffs"].forEach(k => {
        if (Array.isArray(a[k])) a[k] = a[k].map(p => (p === oldId ? (n++, newId) : p));
      });
    });
    /* the Scenario Matrix kept from an imported workbook is keyed by task id */
    const mx = data.scenario && data.scenario.matrixSheet;
    if (mx && Array.isArray(mx.headers)) {
      const c = mx.headers.findIndex(h => String(h).trim().toLowerCase() === "task id");
      if (c >= 0) (mx.rows || []).forEach(r => { if (String(r[c]).trim() === oldId) { r[c] = newId; n++; } });
    }
    return n;
  }
  /* "id" or "id=value" -> the same with the id replaced */
  const headRename = (spec, oldId, newId) => {
    const s = String(spec), eq = s.indexOf("=");
    const head = (eq < 0 ? s : s.slice(0, eq)).trim();
    return head === oldId ? newId + (eq < 0 ? "" : s.slice(eq)) : null;
  };
  function renameVariable(data, oldId, newId) {
    let n = 0;
    const sc = data.scenario || {};
    eachRule(data, r => mapRule(r, k => (k === oldId ? (n++, newId) : k), null));
    (sc.attributes || []).forEach(a => {
      if (a.id === oldId) { a.id = newId; n++; }
      if (Array.isArray(a.implies)) a.implies = a.implies.map(spec => { const r = headRename(spec, oldId, newId); if (r === null) return spec; n++; return r; });
    });
    (sc.presets || []).forEach(p => {
      ["set", "values"].forEach(k => { if (p[k] && Object.prototype.hasOwnProperty.call(p[k], oldId)) { p[k] = renameKey(p[k], oldId, newId); n++; } });
    });
    const mx = sc.matrixSheet;
    if (mx && Array.isArray(mx.headers)) mx.headers = mx.headers.map(h => { const r = headRename(h, oldId, newId); if (r === null) return h; n++; return r; });
    return n;
  }
  function renameRule(data, oldId, newId) {
    const sc = data.scenario || {};
    if (!sc.rules || !Object.prototype.hasOwnProperty.call(sc.rules, oldId)) return 0;
    let n = 1;
    sc.rules = renameKey(sc.rules, oldId, newId);
    eachRule(data, r => mapRule(r, null, ref => (ref === oldId ? (n++, newId) : ref)));
    if (sc.ruleMeta) {
      if (sc.ruleMeta[oldId]) sc.ruleMeta = renameKey(sc.ruleMeta, oldId, newId);
      if (sc.ruleMeta[alias(oldId)]) sc.ruleMeta = renameKey(sc.ruleMeta, alias(oldId), alias(newId));
    }
    if (Array.isArray(sc.phraseRules)) sc.phraseRules = sc.phraseRules.map(x => (x === oldId ? newId : x));
    const rs = sc.rulesSheet;
    if (rs && Array.isArray(rs.headers)) {
      const c = rs.headers.findIndex(h => /^(rule\s*id|ruleid|id)$/i.test(String(h).trim()));
      if (c >= 0) (rs.rows || []).forEach(r => { if (String(r[c]).trim() === alias(oldId)) r[c] = alias(newId); });
    }
    return n;
  }
  /* a saved run in the renamed vocabulary, so the impact preview compares
     like with like: a pure rename changes the shape of nothing */
  function renameRun(run, renames) {
    const acts = (renames && renames.activities) || {}, vars = (renames && renames.variables) || {};
    const ra = id => (Object.prototype.hasOwnProperty.call(acts, id) ? acts[id] : id);
    const rv = id => (Object.prototype.hasOwnProperty.call(vars, id) ? vars[id] : id);
    const keys = (o, f) => { const out = {}; Object.keys(o || {}).forEach(k => { out[f(k)] = o[k]; }); return out; };
    return Object.assign({}, run, {
      answers: keys(run.answers, rv), overrides: keys(run.overrides, rv), taskOverrides: keys(run.taskOverrides, ra),
      includedKeys: (run.includedKeys || []).map(ra), excludedKeys: (run.excludedKeys || []).map(ra)
    });
  }

  /* The task a person means when they type into a predecessor field: an id
     (any case), the picker's own "id — name" text, a whole name, or a part of
     a name that only one task has. A miss explains itself - several matches
     are listed, nothing found suggests the nearest id - so an unknown id is
     caught while typing, not as a validation error after Save. */
  function matchActivity(activities, text, selfId) {
    const acts = activities || [];
    const raw = String(text || "").trim();
    if (!raw) return { error: "Type a task id or part of its name." };
    const lead = raw.split(/\s+[—–-]\s+/)[0].trim();           // "id — name"
    const low = raw.toLowerCase(), leadLow = lead.toLowerCase();
    const pick = a => (a.id === selfId ? { error: "A task cannot depend on itself." } : { id: a.id });
    let hit = acts.find(a => a.id === raw || a.id === lead) || acts.find(a => a.id.toLowerCase() === low || a.id.toLowerCase() === leadLow);
    if (hit) return pick(hit);
    hit = acts.find(a => String(a.name || "").toLowerCase() === low);
    if (hit) return pick(hit);
    const part = acts.filter(a => String(a.name || "").toLowerCase().includes(low) && a.id !== selfId);
    if (part.length === 1) return pick(part[0]);
    if (part.length > 1) return { error: part.length + " tasks match '" + raw + "' - pick one from the list.", candidates: part.slice(0, 8).map(a => a.id) };
    /* one edit away from an id: a typo, not a different task */
    const near = acts.map(a => a.id).find(id => {
      const x = id.toLowerCase();
      if (Math.abs(x.length - leadLow.length) > 1) return false;
      let i = 0, j = 0, diff = 0;
      while (i < x.length && j < leadLow.length) {
        if (x[i] === leadLow[j]) { i++; j++; continue; }
        if (++diff > 1) return false;
        if (x.length > leadLow.length) i++; else if (leadLow.length > x.length) j++; else { i++; j++; }
      }
      return diff + (x.length - i) + (leadLow.length - j) <= 1;
    });
    return { error: "No task with id or name '" + raw + "'" + (near ? " - did you mean '" + near + "'?" : ".") };
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

  VSM.admin = { referencesTo, impact, pushVersion, setCondition, ruleToText, textToRule, alias, derivationToText, textToDerivation, checkId, renameActivity, renameVariable, renameRule, renameRun, matchActivity };
  if (typeof module !== "undefined" && module.exports) module.exports = VSM.admin;
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
