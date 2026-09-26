/* ============================================================================
   VALIDATION  - checks the data files before anything is rendered.
   ----------------------------------------------------------------------------
   Why this exists: a typo in an activity's "when" rule (a misspelled attribute
   id, an option value that does not exist) used to evaluate quietly to false,
   so the activity simply vanished from the chart with no explanation. In a
   workshop that reads as "the tool is wrong". Every reference is now checked
   up front and reported with the id of the offending entry.

   Errors   block rendering (the previous chart stays on screen).
   Warnings render, but are listed in the sidebar.
   ========================================================================== */
VSM.validate = (function () {
  /* Scenario attributes are rule keys, so they stay identifier-shaped.
     Activity ids are whatever the source system calls them - the source workbook
     numbers its tasks 1..146 - so anything without whitespace or a separator
     is accepted. The separators matter because predecessor lists split on
     ";" and ",", and a "." would break a future dotted path. */
  const ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
  const ACT_ID = /^[^\s;,|]+$/;
  const OPS = ["eq", "ne", "in", "notIn", "includes", "includesAny", "includesAll", "gt", "gte", "lt", "lte"];

  /* One walk over the raw data, before anything reads a field, checking two
     things nothing else can.

     1. A "__proto__" key. JSON.parse turns it into a real own property and
        nothing here wants one. It is also ambiguous in a data FILE: read back
        through js/files.js it is an own property, but the browser loads
        data/*.data.js as a script, where "__proto__" in an object literal sets
        the prototype instead. Refuse it rather than carry two meanings.

     2. Nesting deeper than anything real. JSON.parse accepts structures that
        JSON.stringify and VSM.deepClone then overflow the stack on, so data
        that validated cleanly could still throw from the save path or from an
        inline edit. The rule depth cap further down only covers rules; this
        covers every field. */
  const MAX_DEPTH = 200;
  function structureFault(root) {
    const stack = [{ v: root, path: "", depth: 0 }];
    const seen = new Set();
    let budget = 500000;
    while (stack.length && budget-- > 0) {
      const { v, path, depth } = stack.pop();
      if (!v || typeof v !== "object" || seen.has(v)) continue;
      if (depth > MAX_DEPTH) return { why: "is nested more than " + MAX_DEPTH + " levels deep", path };
      seen.add(v);
      if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) stack.push({ v: v[i], path: path + "[" + i + "]", depth: depth + 1 });
        continue;
      }
      for (const k of Object.keys(v)) {
        const at = (path ? path + "." : "") + k;
        if (k === "__proto__") return { why: "uses a \"__proto__\" key, which is not allowed", path: at };
        stack.push({ v: v[k], path: at, depth: depth + 1 });
      }
    }
    return null;
  }

  function run(process, taxonomy, scenarioCfg) {
    const errors = [], warnings = [];
    const err = m => errors.push(m);
    const warn = m => warnings.push(m);

    [["process", process], ["taxonomy", taxonomy], ["scenario", scenarioCfg]].forEach(([label, obj]) => {
      const fault = obj && structureFault(obj);
      // a 200-level path is unreadable, so show where it starts and where it ends
      const short = p => (p.length > 90 ? p.slice(0, 50) + " … " + p.slice(-30) : p);
      if (fault) err(label + " data: " + label + (fault.path ? "." + short(fault.path) : "") + " " + fault.why + ".");
    });
    if (errors.length) return { errors, warnings };

    if (!process || !Array.isArray(process.activities)) return { errors: ["process data: 'activities' must be an array."], warnings };
    if (!taxonomy || typeof taxonomy.families !== "object") return { errors: ["taxonomy data: 'families' must be an object."], warnings };
    if (!scenarioCfg || !Array.isArray(scenarioCfg.attributes)) return { errors: ["scenario data: 'attributes' must be an array."], warnings };

    // Reject invalid container shapes before later passes iterate them.
    const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
    ["families", "categories", "wasteTypes"].forEach(k => {
      if (taxonomy[k] !== undefined && (!object(taxonomy[k]) || Object.values(taxonomy[k]).some(v => !object(v)))) err("taxonomy data: '" + k + "' must contain objects.");
    });
    if (process.phases !== undefined && !Array.isArray(process.phases)) err("process data: phases must be an array.");
    if (scenarioCfg.presets !== undefined && !Array.isArray(scenarioCfg.presets)) err("scenario data: presets must be an array.");
    scenarioCfg.attributes.forEach(a => {
      if (!object(a)) { err("scenario attributes must contain objects."); return; }
      if (a.implies !== undefined && !Array.isArray(a.implies)) err("scenario attribute: implies must be an array.");
      if (a.options !== undefined && (!Array.isArray(a.options) || a.options.some(o => !object(o)))) err("scenario attribute: options must contain objects.");
    });
    process.activities.forEach(a => {
      if (!object(a)) { err("activities must contain objects."); return; }
      ["predecessors", "successors", "handoffs", "overrides"].forEach(k => {
        if (a[k] !== undefined && !Array.isArray(a[k])) err("activity '" + a.id + "': " + k + " must be an array.");
      });
      if (Array.isArray(a.overrides) && a.overrides.some(o => !object(o))) err("activity '" + a.id + "': overrides must contain objects.");
    });
    if (errors.length) return { errors, warnings };

    /* ---------------------------------------------------- scenario attributes */
    const attrs = new Map();
    scenarioCfg.attributes.forEach((a, i) => {
      const at = "scenario attribute #" + (i + 1) + (a && a.id ? " (" + a.id + ")" : "");
      if (!a || !ID.test(a.id || "")) { err(at + ": needs an id of letters, digits, hyphens or underscores, starting with a letter."); return; }
      if (attrs.has(a.id)) { err(at + ": duplicate attribute id."); return; }
      if (!["boolean", "enum", "multi"].includes(a.type)) { err(at + ": type must be boolean, enum or multi."); return; }
      if (a.type !== "boolean" && (!Array.isArray(a.options) || !a.options.length)) { err(at + ": " + a.type + " attributes need an options array."); return; }
      attrs.set(a.id, a);
    });

    /* "implies" lets one toggle switch another on (an RFP means there is a
       discovery phase). A typo here would silently fail to pull in the steps
       it was meant to, so the target has to exist and the chain has to end. */
    scenarioCfg.attributes.forEach((a, i) => {
      if (!a || !a.implies || !a.implies.length) return;
      const at = "scenario attribute #" + (i + 1) + " (" + a.id + ")";
      if (!Array.isArray(a.implies)) { err(at + ": \"implies\" must be an array of toggle ids."); return; }
      a.implies.forEach(spec => {
        const parts = String(spec).split("=");
        const id = parts[0].trim(), val = parts.length > 1 ? parts.slice(1).join("=").trim() : null;
        if (id === a.id) { err(at + ": implies itself."); return; }
        const target = attrs.get(id);
        if (!target) { err(at + ": implies '" + id + "', which is not a toggle."); return; }
        if (target.type === "boolean" && val !== null) err(at + ": '" + id + "' is a yes/no toggle, so write it as '" + id + "' with no value.");
        if (target.type !== "boolean") {
          if (val === null) { err(at + ": '" + id + "' is a choice, so write it as '" + id + "=<value>'."); return; }
          const opts = (target.options || []).map(o => o.value);
          if (!opts.includes(val)) err(at + ": implies '" + id + "=" + val + "', but the options are " + opts.join(", ") + ".");
        }
      });
    });
    /* a loop would make the resolved scenario depend on iteration order */
    (function () {
      const seen = new Map();
      const walk = (id, stack) => {
        if (stack.includes(id)) { err("scenario toggles imply each other in a loop: " + stack.concat(id).join(" -> ") + "."); return true; }
        if (seen.get(id)) return false;
        const a = attrs.get(id);
        if (a && a.implies) for (const spec of a.implies) {
          if (walk(String(spec).split("=")[0].trim(), stack.concat(id))) return true;
        }
        seen.set(id, true);
        return false;
      };
      [...attrs.keys()].some(id => walk(id, []));
    })();

    /* ---------------------------------------------------- taxonomy */
    const families = taxonomy.families || {}, cats = taxonomy.categories || {}, wastes = taxonomy.wasteTypes || {};
    /* Membership must be an OWN-property test. Writing !map[key] treats every
       Object.prototype member as a valid id, so "__proto__" and "constructor"
       sail through validation and then reach the get-or-create accumulators in
       js/schedule.js, which write straight onto Object.prototype. */
    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
    Object.entries(families).forEach(([id, f]) => {
      ["optimal", "excess"].forEach(k => {
        if (!/^#[0-9a-f]{6}$/i.test(f[k] || "")) err("taxonomy family '" + id + "': " + k + " must be a six-digit hex color such as #3B82F6 (SVG and PNG export need a literal color).");
      });
    });
    Object.entries(cats).forEach(([id, c]) => { if (!has(families, c.family)) err("taxonomy category '" + id + "': unknown family '" + c.family + "'."); });
    Object.entries(wastes).forEach(([id, w]) => { if (!has(families, w.family)) err("taxonomy waste type '" + id + "': unknown family '" + w.family + "'."); });

    /* ---------------------------------------------------- rules (named + inline) */
    const named = scenarioCfg.rules || {};
    const MAX_RULE_DEPTH = 64;
    function checkRule(rule, where, stack, depth) {
      depth = depth || 0;
      if (depth > MAX_RULE_DEPTH) {
        err(where + ": rule is nested more than " + MAX_RULE_DEPTH + " levels deep. Flatten it, or move part of it into a named rule.");
        return;
      }
      if (rule === undefined || rule === null || typeof rule === "boolean") return;
      if (typeof rule === "string") {
        if (!Object.prototype.hasOwnProperty.call(named, rule)) {
          err(where + ": unknown named rule '" + rule + "'. Define it under \"rules\" in the scenario data, or use an inline rule object.");
          return;
        }
        if (stack.includes(rule)) { err(where + ": named rules reference each other in a loop: " + stack.concat(rule).join(" -> ") + "."); return; }
        checkRule(named[rule], where + " -> rule '" + rule + "'", stack.concat(rule), depth + 1);
        return;
      }
      if (Array.isArray(rule)) { rule.forEach(r => checkRule(r, where, stack, depth + 1)); return; }
      if (typeof rule !== "object") { err(where + ": a rule must be true, false, a named rule, or a rule object."); return; }
      Object.keys(rule).forEach(key => {
        const v = rule[key];
        if (key === "all" || key === "any") {
          if (!Array.isArray(v) || !v.length) { err(where + ": \"" + key + "\" needs a non-empty array of rules."); return; }
          v.forEach(r => checkRule(r, where, stack, depth + 1));
          return;
        }
        if (key === "not") { checkRule(v, where, stack, depth + 1); return; }
        const attr = attrs.get(key);
        if (!attr) {
          const near = [...attrs.keys()].find(k => k.toLowerCase() === String(key).toLowerCase());
          err(where + ": unknown scenario attribute '" + key + "'" + (near ? " (did you mean '" + near + "'?)" : "") + ". Without this check the activity would silently never appear.");
          return;
        }
        const options = (attr.options || []).map(o => o.value);
        const checkValue = val => {
          if (attr.type === "boolean") { if (typeof val !== "boolean") err(where + ": '" + key + "' is a yes/no attribute, so compare it with true or false, not " + JSON.stringify(val) + "."); return; }
          if (!options.includes(val)) err(where + ": '" + key + "' has no option " + JSON.stringify(val) + ". Valid options: " + options.join(", ") + ".");
        };
        if (v !== null && typeof v === "object" && !Array.isArray(v)) {
          Object.keys(v).forEach(op => {
            if (!OPS.includes(op)) { err(where + ": unknown operator '" + op + "' on '" + key + "'. Supported: " + OPS.join(", ") + "."); return; }
            if (["gt", "gte", "lt", "lte"].includes(op)) { if (typeof v[op] !== "number") err(where + ": operator '" + op + "' on '" + key + "' needs a number."); return; }
            const list = ["in", "notIn", "includesAny", "includesAll"].includes(op);
            if (list && !Array.isArray(v[op])) { err(where + ": operator '" + op + "' on '" + key + "' needs an array."); return; }
            (list ? v[op] : [v[op]]).forEach(checkValue);
            if (["includes", "includesAny", "includesAll"].includes(op) && attr.type !== "multi") err(where + ": operator '" + op + "' only applies to multi-select attributes; '" + key + "' is " + attr.type + ".");
          });
        } else if (Array.isArray(v)) v.forEach(checkValue);
        else checkValue(v);
      });
    }
    Object.entries(named).forEach(([id, r]) => checkRule(r, "named rule '" + id + "'", [id]));
    scenarioCfg.attributes.forEach(a => { if (a.enabledWhen !== undefined) checkRule(a.enabledWhen, "scenario attribute '" + a.id + "' enabledWhen", []); });
    scenarioCfg.attributes.forEach(a => { if (a.shownWhen !== undefined) checkRule(a.shownWhen, "scenario attribute '" + a.id + "' shownWhen", []); });

    /* ------------------------------------------------- derived attributes
       Derivations run in declaration order (js/derive.js), so a derivation
       may reference authored attributes anywhere and derived attributes
       declared ABOVE it only. Enforcing that here is what makes derivation
       cycles impossible rather than merely detected. */
    (function () {
      const order = new Map(scenarioCfg.attributes.map((a, i) => [a && a.id, i]));
      const derivedIdx = new Map(scenarioCfg.attributes.filter(a => a && a.derived).map(a => [a.id, order.get(a.id)]));
      function ruleAttrs(rule, out, depth) {
        const d = depth || 0;
        if (d > 64 || rule === undefined || rule === null || typeof rule === "boolean") return out;
        if (typeof rule === "string") { const t = scenarioCfg.rules || {}; if (Object.prototype.hasOwnProperty.call(t, rule)) ruleAttrs(t[rule], out, d + 1); return out; }
        if (Array.isArray(rule)) { rule.forEach(r => ruleAttrs(r, out, d + 1)); return out; }
        if (typeof rule !== "object") return out;
        Object.keys(rule).forEach(k => {
          if (k === "all" || k === "any") { (rule[k] || []).forEach(r => ruleAttrs(r, out, d + 1)); return; }
          if (k === "not") { ruleAttrs(rule[k], out, d + 1); return; }
          out.push(k);
        });
        return out;
      }
      scenarioCfg.attributes.forEach(a => {
        if (!a || !a.derived) return;
        const at = "scenario attribute '" + a.id + "'";
        /* A derived attribute whose logic exists only as prose (a workbook's
           Derivation column that the expression grammar cannot read) is
           legitimate authoring - the engine just cannot compute it yet, so
           the value stays at its default. Say so; do not refuse the file. */
        if (!a.derive || typeof a.derive !== "object") {
          warn(at + ": marked Derived but its derivation is prose only, so the engine leaves it at its default" + (a.derivation ? " (\"" + a.derivation + "\")" : "") + ".");
          return;
        }
        if (a.type === "multi") { err(at + ": a multi-select cannot be derived."); return; }
        const options = (a.options || []).map(o => o.value);
        const rulesToCheck = [];
        if (a.derive.cases) {
          if (!Array.isArray(a.derive.cases) || !a.derive.cases.length) { err(at + ": derive.cases must be a non-empty array."); return; }
          a.derive.cases.forEach((c, i) => {
            if (!c || typeof c !== "object") { err(at + ": derive.cases[" + i + "] must be an object with when and value."); return; }
            rulesToCheck.push([c.when, at + " derive.cases[" + i + "]"]);
            if (a.type === "enum" && !options.includes(c.value)) err(at + ": derive case value " + JSON.stringify(c.value) + " is not one of the options (" + options.join(", ") + ").");
          });
          const def = a.derive.default !== undefined ? a.derive.default : a.default;
          if (a.type === "enum" && !options.includes(def)) err(at + ": derive default " + JSON.stringify(def) + " is not one of the options (" + options.join(", ") + ").");
        } else {
          if (a.derive.when === undefined) { err(at + ": a boolean derivation needs derive.when."); return; }
          rulesToCheck.push([a.derive.when, at + " derive.when"]);
        }
        rulesToCheck.forEach(([rule, where]) => {
          checkRule(rule, where, []);
          ruleAttrs(rule, [], 0).forEach(ref => {
            if (!derivedIdx.has(ref)) return;                          // authored attrs may sit anywhere
            if (derivedIdx.get(ref) >= order.get(a.id)) err(where + ": references derived attribute '" + ref + "', which is declared at or below '" + a.id + "'. Derivations run in declaration order; move '" + ref + "' above.");
          });
        });
      });
      scenarioCfg.attributes.forEach(a => {
        if (a && a.overrideRequiresReason && !a.derived) warn("scenario attribute '" + a.id + "': overrideRequiresReason only applies to derived attributes.");
      });
    })();

    /* ---------------------------------------------------- presets */
    (scenarioCfg.presets || []).forEach(p => {
      if (!p || typeof p.label !== "string") { err("preset: every preset needs a label."); return; }
      Object.keys(p.values || {}).forEach(k => {
        const attr = attrs.get(k);
        if (!attr) { err("preset '" + p.label + "': unknown attribute '" + k + "'."); return; }
        const val = p.values[k], options = (attr.options || []).map(o => o.value);
        if (attr.type === "boolean" && typeof val !== "boolean") err("preset '" + p.label + "': '" + k + "' should be true or false.");
        if (attr.type === "enum" && !options.includes(val)) err("preset '" + p.label + "': '" + k + "' has no option " + JSON.stringify(val) + ".");
        if (attr.type === "multi") {
          if (!Array.isArray(val)) err("preset '" + p.label + "': '" + k + "' should be an array.");
          else val.filter(v => !options.includes(v)).forEach(v => err("preset '" + p.label + "': '" + k + "' has no option " + JSON.stringify(v) + "."));
        }
      });
    });

    /* ---------------------------------------------------- teams, stages, phases */
    const teams = process.teams || {}, phases = process.phases || [];
    Object.entries(teams).forEach(([id, t]) => { if (!t || typeof t.label !== "string") err("team '" + id + "': needs a label."); });
    if (process.stages !== undefined && !Array.isArray(process.stages)) err("process data: stages must be an array.");
    const stageIds = new Set();
    (Array.isArray(process.stages) ? process.stages : []).forEach(s => {
      if (!s || !s.id) { err("stage: every stage needs an id."); return; }
      if (stageIds.has(s.id)) err("stage '" + s.id + "': duplicate id.");
      stageIds.add(s.id);
    });
    const phaseIds = new Set();
    phases.forEach(p => {
      if (!p || !p.id) { err("phase: every phase needs an id."); return; }
      if (phaseIds.has(p.id)) err("phase '" + p.id + "': duplicate id.");
      phaseIds.add(p.id);
      /* a mistyped stage reference silently drops the phase out of the tracker
         bar, so it gets the same treatment as a mistyped phase on an activity */
      if (p.stage && !stageIds.has(p.stage)) warn("phase '" + p.id + "': stage '" + p.stage + "' is not in the stages list, so the tracker will not roll this phase into a stage.");
    });

    /* ---------------------------------------------------- activities */
    const ids = new Set();
    process.activities.forEach((a, i) => {
      const at = "activity #" + (i + 1) + (a && a.id ? " (" + a.id + ")" : "");
      if (!a || !ACT_ID.test(String(a.id === undefined || a.id === null ? "" : a.id))) { err(at + ": needs an id with no spaces, semicolons, commas or pipes (those separate predecessor lists)."); return; }
      if (ids.has(a.id)) { err(at + ": duplicate activity id. Ids must be unique because predecessors reference them."); return; }
      ids.add(a.id);
      if (typeof a.name !== "string" || !a.name.trim()) err(at + ": name is required.");
      const d = a.duration || {};
      ["current", "optimal"].forEach(k => {
        if (typeof d[k] !== "number" || !isFinite(d[k]) || d[k] < 0) err(at + ": duration." + k + " must be a number of " + (process.units || "days") + " that is zero or more.");
      });
      if (typeof d.current === "number" && typeof d.optimal === "number" && d.optimal > d.current) {
        err(at + ": optimal duration (" + d.optimal + ") is larger than current (" + d.current + "). Optimal is the minimum necessary time, so it cannot exceed today's.");
      }
      if (a.category && !has(cats, a.category)) err(at + ": unknown category '" + a.category + "'. Valid: " + Object.keys(cats).join(", ") + ".");
      if (a.waste && !has(wastes, a.waste)) err(at + ": unknown waste type '" + a.waste + "'. Valid: " + Object.keys(wastes).join(", ") + ".");
      if (a.owner && !has(teams, a.owner)) err(at + ": unknown owner '" + a.owner + "'. Add it to \"teams\" or fix the id.");
      if (a.phase && !phaseIds.has(a.phase)) warn(at + ": phase '" + a.phase + "' is not in the phases list, so the row will not sit under a phase band.");
      /* Tracking fields. Warnings, not errors: a typo in a status out of a
         spreadsheet should never blank a chart, so the row renders as not
         started and the sidebar says why the tracker disagrees with Excel. */
      if (a.status !== undefined && !["todo", "doing", "done", "blocked", "skipped"].includes(String(a.status).trim().toLowerCase())) {
        warn(at + ": unknown status '" + a.status + "'. Valid: todo, doing, done, blocked, skipped. Treated as not started.");
      }
      if (a.progress !== undefined && (typeof a.progress !== "number" || !isFinite(a.progress) || a.progress < 0 || a.progress > 100)) {
        warn(at + ": progress must be a number from 0 to 100. Treated as 50.");
      }
      if (a.predecessors !== undefined && !Array.isArray(a.predecessors)) err(at + ": predecessors must be an array of activity ids.");
      if (a.handoffs !== undefined && !Array.isArray(a.handoffs)) err(at + ": handoffs must be an array of predecessor ids.");
      if (a.when !== undefined) checkRule(a.when, at + " inclusion rule", []);
      /* Scenario multipliers: a bad factor here silently stretches or shrinks
         a bar rather than removing it, which is harder to notice than a
         missing row and just as wrong. */
      if (a.multipliers !== undefined) {
        if (!Array.isArray(a.multipliers)) err(at + ": \"multipliers\" must be an array of { when, factor }.");
        else a.multipliers.forEach((m, mi) => {
          const mw = at + " multiplier #" + (mi + 1);
          if (!m || typeof m !== "object") { err(mw + ": must be an object with a \"when\" rule and a \"factor\"."); return; }
          checkRule(m.when, mw, []);
          const f = Number(m.factor);
          if (!isFinite(f) || f <= 0) err(mw + ": factor must be a positive number, not " + JSON.stringify(m.factor) + ".");
          else if (f > 10) err(mw + ": factor " + f + " is implausible. Multipliers scale a task's duration, so 2 means twice as long.");
        });
      }
      (a.overrides || []).forEach((o, oi) => {
        const ow = at + " override #" + (oi + 1);
        checkRule(o.when, ow, []);
        const od = o.duration || {};
        ["current", "optimal"].forEach(k => { if (od[k] !== undefined && (typeof od[k] !== "number" || od[k] < 0)) err(ow + ": duration." + k + " must be a number of zero or more."); });
        if (typeof od.current === "number" && typeof od.optimal === "number" && od.optimal > od.current) err(ow + ": optimal duration is larger than current.");
      });
    });

    /* references and cycles: checked against the FULL activity list, so a broken
       link in a branch that this scenario happens to exclude is still reported. */
    const byId = new Map(process.activities.filter(a => a && a.id).map(a => [a.id, a]));
    byId.forEach((a, id) => {
      (a.predecessors || []).forEach(p => { if (!byId.has(p)) err("activity '" + id + "': predecessor '" + p + "' does not exist."); });
      (a.handoffs || []).forEach(p => { if (!(a.predecessors || []).includes(p)) warn("activity '" + id + "': declared handoff from '" + p + "', which is not one of its predecessors, so it will never be drawn."); });
      (a.successors || []).forEach(sc => { if (!byId.has(sc)) err("activity '" + id + "': successor '" + sc + "' does not exist."); });
    });
    // Use the same combined graph as the scheduler, including successors.
    // Kahn's algorithm avoids recursion limits on long dependency chains.
    const preds = new Map([...byId].map(([id, a]) => [id, new Set((a.predecessors || []).filter(p => byId.has(p)))]));
    byId.forEach((a, id) => (a.successors || []).forEach(s => { if (preds.has(s)) preds.get(s).add(id); }));
    const next = new Map([...byId.keys()].map(id => [id, []]));
    const degree = new Map();
    preds.forEach((ps, id) => { degree.set(id, ps.size); ps.forEach(p => next.get(p).push(id)); });
    const queue = [...byId.keys()].filter(id => degree.get(id) === 0);
    for (let i = 0; i < queue.length; i++) {
      next.get(queue[i]).forEach(id => { degree.set(id, degree.get(id) - 1); if (degree.get(id) === 0) queue.push(id); });
    }
    if (queue.length !== byId.size) err("dependency loop involving: " + [...degree].filter(([, n]) => n > 0).map(([id]) => id).join(", ") + ". An activity cannot depend on itself, directly or through a chain.");

    return { errors, warnings };
  }

  return { run };
})();
if (typeof module !== "undefined" && module.exports) module.exports = VSM.validate;
