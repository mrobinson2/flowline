/* ============================================================================
   DERIVED ATTRIBUTES - the engine decides what the user should not be asked.
   ----------------------------------------------------------------------------
   An attribute with `derived: true` carries its logic as data:

     boolean:  derive: { when: <rule> }
     enum:     derive: { cases: [{ when: <rule>, value }], default }

   compute() resolves them IN DECLARATION ORDER against the scenario as
   resolved so far, so a derivation may read authored answers and any derived
   value declared above it - and nothing below it, which is what makes cycles
   impossible (validate.js enforces the ordering).

   Every derived value carries PROVENANCE: the specific attribute values that
   satisfied (or, for a false boolean, failed) the deciding rule, so the UI
   can say "Because: Service tier = Tier 1" instead of generic text.

   User OVERRIDES are sticky: an override wins over the derivation on every
   recompute until it is explicitly cleared, and is echoed back so the UI can
   badge it. An override naming a non-derived attribute is ignored and
   reported - the sidebar owns authored answers, not this module.
   ========================================================================== */
(function (root) {
  const VSM = root.VSM = root.VSM || {};
  const MAX_DEPTH = 20;

  /* Collect the leaf comparisons of a rule, expanding named-rule references
     through the table, and record whether each leaf currently holds. */
  function leaves(rule, scenario, named, out, depth) {
    const d = depth || 0;
    if (d > MAX_DEPTH || rule === undefined || rule === null || typeof rule === "boolean") return out;
    if (typeof rule === "string") {
      const table = named || {};
      if (Object.prototype.hasOwnProperty.call(table, rule)) leaves(table[rule], scenario, named, out, d + 1);
      return out;
    }
    if (Array.isArray(rule)) { rule.forEach(r => leaves(r, scenario, named, out, d + 1)); return out; }
    if (typeof rule !== "object") return out;
    Object.keys(rule).forEach(key => {
      const v = rule[key];
      if (key === "all" || key === "any") { (v || []).forEach(r => leaves(r, scenario, named, out, d + 1)); return; }
      if (key === "not") { leaves(v, scenario, named, out, d + 1); return; }
      out.push({ attr: key, satisfied: VSM.rules.evaluate({ [key]: v }, scenario, named) });
    });
    return out;
  }

  function labelled(leaf, attrDefs, scenario) {
    const def = (attrDefs || []).find(a => a.id === leaf.attr);
    const value = scenario[leaf.attr];
    const opt = def && def.options ? def.options.find(o => o.value === value) : null;
    return {
      attr: leaf.attr,
      label: def ? def.label : leaf.attr,
      value,
      valueLabel: opt ? opt.label : (value === true ? "Yes" : value === false ? "No" : Array.isArray(value) ? value.join(", ") : String(value)),
      satisfied: leaf.satisfied
    };
  }

  /* because-list for a decision: the leaves of the deciding rule, labelled.
     For a satisfied rule the satisfied leaves explain it; for a false boolean
     the unsatisfied leaves explain the absence. Both are kept (each entry
     says which it is) so the chip can render either side. */
  function because(rule, scenario, named, attrDefs, wantSatisfied) {
    const ls = leaves(rule, scenario, named, [], 0)
      .filter(l => (wantSatisfied ? l.satisfied : !l.satisfied) || wantSatisfied === undefined)
      .map(l => labelled(l, attrDefs, scenario));
    /* de-duplicate by attribute: a rule may test the same attribute twice */
    const seen = new Set();
    return ls.filter(l => (seen.has(l.attr) ? false : (seen.add(l.attr), true)));
  }

  function compute(attrDefs, scenario, named, overrides) {
    const defs = attrDefs || [];
    const resolved = Object.assign({}, scenario);
    const derivedIds = [];
    const provenance = Object.create(null);
    const overridden = Object.create(null);
    const ov = overrides || {};

    /* report overrides that name attributes this module does not own */
    Object.keys(ov).forEach(id => {
      const def = defs.find(a => a.id === id);
      if (!def || !def.derived) overridden[id] = { value: ov[id] && ov[id].value, reason: ov[id] && ov[id].reason, ignored: true };
    });

    defs.forEach(a => {
      if (!a.derived || !a.derive) return;
      derivedIds.push(a.id);

      if (Object.prototype.hasOwnProperty.call(ov, a.id) && ov[a.id] && !overridden[a.id]) {
        resolved[a.id] = ov[a.id].value;
        overridden[a.id] = { value: ov[a.id].value, reason: ov[a.id].reason };
        provenance[a.id] = { value: ov[a.id].value, because: [], overridden: true };
        return;
      }

      if (a.derive.cases) {
        let value = a.derive.default !== undefined ? a.derive.default : a.default;
        let winner = null;
        for (const c of a.derive.cases) {
          if (VSM.rules.evaluate(c.when, resolved, named)) { value = c.value; winner = c.when; break; }
        }
        resolved[a.id] = value;
        provenance[a.id] = { value, because: winner === null || winner === true ? [] : because(winner, resolved, named, defs, true) };
      } else {
        const on = VSM.rules.evaluate(a.derive.when, resolved, named);
        resolved[a.id] = on;
        provenance[a.id] = { value: on, because: because(a.derive.when, resolved, named, defs, on) };
      }
    });

    return { scenario: resolved, derived: derivedIds, provenance, overridden };
  }

  VSM.derive = { compute };
  if (typeof module !== "undefined" && module.exports) module.exports = VSM.derive;
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
