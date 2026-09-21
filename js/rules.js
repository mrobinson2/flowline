/* ============================================================================
   RULES ENGINE  - declarative conditions evaluated against a scenario object.
   ----------------------------------------------------------------------------
   Condition grammar (JSON):
     true / null / undefined            -> always
     false                              -> never
     { "attr": value }                  -> scenario.attr equals value
     { "a": 1, "b": 2 }                 -> all keys must match (AND)
     { "all": [c1, c2] }                -> AND
     { "any": [c1, c2] }                -> OR
     { "not": c }                       -> NOT
     { "attr": { "in": [..] } }         -> value is one of
     { "attr": { "notIn": [..] } }
     { "attr": { "ne": v } }
     { "attr": { "includes": v } }      -> multi-select contains v
     { "attr": { "includesAny": [..] } }
     { "attr": { "includesAll": [..] } }
     { "attr": { "gt"|"gte"|"lt"|"lte": n } }
     { "attr": [v1, v2] }               -> shorthand: enum "in" / multi "includesAll"
   ========================================================================== */
VSM.rules = (function () {
  const OPS = new Set(["eq", "ne", "in", "notIn", "includes", "includesAny", "includesAll", "gt", "gte", "lt", "lte"]);

  function eq(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
    return a === b;
  }

  function matchAttr(actual, expected) {
    if (Array.isArray(expected)) {
      return Array.isArray(actual) ? expected.every(e => actual.includes(e)) : expected.includes(actual);
    }
    if (expected !== null && typeof expected === "object") {
      return Object.keys(expected).every(op => {
        const arg = expected[op];
        switch (op) {
          case "eq": return eq(actual, arg);
          case "ne": return !eq(actual, arg);
          case "in": return Array.isArray(arg) && arg.includes(actual);
          case "notIn": return Array.isArray(arg) && !arg.includes(actual);
          case "includes": return Array.isArray(actual) && actual.includes(arg);
          case "includesAny": return Array.isArray(actual) && arg.some(a => actual.includes(a));
          case "includesAll": return Array.isArray(actual) && arg.every(a => actual.includes(a));
          case "gt": return actual > arg;
          case "gte": return actual >= arg;
          case "lt": return actual < arg;
          case "lte": return actual <= arg;
          default: return false;
        }
      });
    }
    return eq(actual, expected);
  }

  /* Named rules live in scenario.data.js under "rules". A condition that is a plain
     string looks the rule up there, so one policy can be written once and referenced
     by any number of activities:  "when": "securityReview"
     `named` is supplied by the caller; validate.js has already rejected unknown names
     and reference loops, and the depth guard is a belt-and-braces stop. */
  /* The depth counter covers STRUCTURAL nesting as well as named-rule
     indirection. It used to count only the latter, so an inline rule nested
     thousands of levels deep recursed once per level. validate.js refuses such
     a rule before it reaches here, but this function is the one an embedding
     host can reach directly, and a stack overflow is not a good answer. */
  const MAX_DEPTH = 200;
  function evaluate(cond, scenario, named, depth) {
    const d = depth || 0;
    if (d > MAX_DEPTH) return false;
    if (cond === undefined || cond === null || cond === true) return true;
    if (cond === false) return false;
    if (typeof cond === "string") {
      const table = named || {};
      if (!Object.prototype.hasOwnProperty.call(table, cond) || d > 20) return false;
      return evaluate(table[cond], scenario, table, d + 1);
    }
    if (Array.isArray(cond)) return cond.every(c => evaluate(c, scenario, named, d + 1));
    if (typeof cond !== "object") return false;
    return Object.keys(cond).every(key => {
      const v = cond[key];
      if (key === "all") return (v || []).every(c => evaluate(c, scenario, named, d + 1));
      if (key === "any") return (v || []).some(c => evaluate(c, scenario, named, d + 1));
      if (key === "not") return !evaluate(v, scenario, named, d + 1);
      return matchAttr(scenario[key], v);
    });
  }

  /* Human-readable description of a rule, for the details panel. */
  function describe(cond, attrDefs, named, depth) {
    const label = id => { const d = (attrDefs || []).find(a => a.id === id); return d ? d.label : id; };
    const optLabel = (id, v) => {
      const d = (attrDefs || []).find(a => a.id === id);
      const o = d && d.options ? d.options.find(x => x.value === v) : null;
      return o ? o.label : String(v);
    };
    const d = depth || 0;
    if (d > MAX_DEPTH) return "…";
    if (cond === undefined || cond === null || cond === true) return "Always included";
    if (cond === false) return "Never included";
    if (typeof cond === "string") {
      const table = named || {};
      if (!Object.prototype.hasOwnProperty.call(table, cond) || d > 20) return "unknown rule '" + cond + "'";
      return cond + " (" + describe(table[cond], attrDefs, table, d + 1) + ")";
    }
    if (Array.isArray(cond)) return cond.map(c => describe(c, attrDefs, named, d + 1)).join(" AND ");
    return Object.keys(cond).map(key => {
      const v = cond[key];
      if (key === "all") return "(" + (v || []).map(c => describe(c, attrDefs, named, d + 1)).join(" AND ") + ")";
      if (key === "any") return "(" + (v || []).map(c => describe(c, attrDefs, named, d + 1)).join(" OR ") + ")";
      if (key === "not") return "NOT (" + describe(v, attrDefs, named, d + 1) + ")";
      if (typeof v === "boolean") return label(key) + (v ? " = on" : " = off");
      if (Array.isArray(v)) return label(key) + " in [" + v.map(x => optLabel(key, x)).join(", ") + "]";
      if (v !== null && typeof v === "object") {
        return Object.keys(v).map(op => {
          const arg = v[op];
          const a = Array.isArray(arg) ? "[" + arg.map(x => optLabel(key, x)).join(", ") + "]" : optLabel(key, arg);
          return label(key) + " " + op + " " + a;
        }).join(" AND ");
      }
      return label(key) + " = " + optLabel(key, v);
    }).join(" AND ");
  }

  /* Build the default scenario from the attribute definitions. */
  function defaults(attrDefs) {
    const s = {};
    (attrDefs || []).forEach(a => {
      if (a.default !== undefined) s[a.id] = Array.isArray(a.default) ? a.default.slice() : a.default;
      else s[a.id] = a.type === "boolean" ? false : a.type === "multi" ? [] : (a.options && a.options[0] ? a.options[0].value : null);
    });
    return s;
  }

  function isEnabled(attrDef, scenario, named) { return evaluate(attrDef.enabledWhen, scenario, named); }

  /* Some toggles drag others along: asking for an RFP means there is a
     discovery phase whether or not anyone ticked it. `implies` on an attribute
     lists the toggles it turns on, written either as "discovery" or as
     "tier=Tier 1" for a choice.

     Run to a fixed point so a chain (rfp -> discovery -> ...) resolves, with a
     hard stop in case somebody writes a loop. The person's own choices are not
     modified; this returns the RESOLVED scenario, which keeps the raw state
     honest and the result independent of the order things were clicked. */
  function applyImplications(attrDefs, scenario) {
    const defs = attrDefs || [];
    const out = Object.assign({}, scenario);
    const active = a => {
      const v = out[a.id];
      return a.type === "boolean" ? v === true : Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== "";
    };
    for (let pass = 0; pass < defs.length + 5; pass++) {
      let changed = false;
      defs.forEach(a => {
        if (!a.implies || !a.implies.length || !active(a)) return;
        a.implies.forEach(spec => {
          const eq = String(spec).indexOf("=");
          const id = eq < 0 ? String(spec).trim() : String(spec).slice(0, eq).trim();
          const val = eq < 0 ? true : String(spec).slice(eq + 1).trim();
          const target = defs.find(d => d.id === id);
          if (!target) return;
          if (target.type === "boolean") { if (out[id] !== true) { out[id] = true; changed = true; } }
          else if (target.type === "multi") {
            const cur = Array.isArray(out[id]) ? out[id] : [];
            if (val !== true && cur.indexOf(val) < 0) { out[id] = cur.concat([val]); changed = true; }
          } else if (val !== true && out[id] !== val) { out[id] = val; changed = true; }
        });
      });
      if (!changed) break;
    }
    return out;
  }

  /* Which toggles a profile leaves alone, so the UI can say so. A profile
     DECLARES a subset; silence is not "off", it is "your choice stands". */
  function applyPreset(attrDefs, scenario, preset) {
    if (!preset) return Object.assign({}, scenario);
    const set = preset.set || {};
    if (preset.partial === false) return Object.assign(defaults(attrDefs), set);
    return Object.assign({}, scenario, set);
  }

  return { evaluate, describe, defaults, isEnabled, applyImplications, applyPreset, OPS };
})();
if (typeof module !== "undefined" && module.exports) module.exports = VSM.rules;
