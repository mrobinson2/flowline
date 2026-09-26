/* ============================================================================
   SCHEDULER  - turns process data + a scenario into a timeline model.
   ----------------------------------------------------------------------------
   Responsibilities:
     * apply the rules engine to decide which activities are included
     * resolve durations (including scenario overrides)
     * keep dependency chains intact when a middle activity is excluded
     * compute early start / finish for the CURRENT and OPTIMAL schedules
     * compute float / critical path (current schedule)
     * detect handoffs (owner change) and organizational boundary crossings
     * compute summary metrics
   No DOM access here: pure data in, pure data out.
   ========================================================================== */
VSM.schedule = (function () {
  const num = v => (typeof v === "number" && isFinite(v) ? v : 0);

  /* Three toggles at 2x each is 8x, which is almost always a data error
     rather than a real scenario, so cap it and say so rather than render it. */
  const MAX_FACTOR = 6;
  const round = v => Math.round(v * 1000) / 1000;

  // Preserve the recorded lead/cycle proportions when a total is edited or
  // overridden. A zero original total is represented as unsplit lead time.
  function resolveTime(act, duration) {
    if (!act.time) return null;
    const out = {};
    ["Current", "Optimal"].forEach(suffix => {
      const lead = Math.max(0, num(act.time["lead" + suffix]));
      const cycle = Math.max(0, num(act.time["cycle" + suffix]));
      const total = Math.max(0, num(duration[suffix.toLowerCase()]));
      out["cycle" + suffix] = lead + cycle ? total * cycle / (lead + cycle) : 0;
      out["lead" + suffix] = total - out["cycle" + suffix];
    });
    return out;
  }

  function setDuration(act, duration) {
    const time = resolveTime(act, duration);
    act.duration = duration;
    if (time) act.time = Object.assign({}, act.time, time);
  }

  function resolveDuration(act, scenario, named) {
    let d = act.duration || { current: 0, optimal: 0 };
    let note = null;
    if (Array.isArray(act.overrides)) {
      for (const o of act.overrides) {
        if (VSM.rules.evaluate(o.when, scenario, named)) { d = o.duration || d; note = o.note || "Scenario override applied"; break; }
      }
    }
    /* Scenario multipliers. Toggles do not only add and remove steps, they
       change how long the same step takes: an Architecture Review Board for a
       standard catalog pattern is not the review a greenfield build pioneering
       three new services gets. Without this the model understates the big
       scenarios and overstates the small ones, which is exactly backwards.
       Every live multiplier applies, and they compound. */
    let factor = 1;
    const applied = [];
    if (Array.isArray(act.multipliers)) {
      for (const m of act.multipliers) {
        const f = Number(m.factor);
        if (!isFinite(f) || f <= 0) continue;
        if (!VSM.rules.evaluate(m.when, scenario, named)) continue;
        factor *= f;
        applied.push(m.note || ("x" + f));
      }
    }
    let factorWarning = null;
    if (factor > MAX_FACTOR) { factorWarning = "combined scenario multiplier " + round(factor) + "x capped at " + MAX_FACTOR + "x"; factor = MAX_FACTOR; }
    if (applied.length) note = (note ? note + " · " : "") + applied.join(" · ");

    const current = Math.max(0, num(d.current)) * factor;
    let optimal = Math.max(0, num(d.optimal)) * factor;
    let warning = factorWarning;
    if (optimal > current) { warning = "optimal (" + round(optimal) + ") exceeds current (" + round(current) + "); clamped"; optimal = current; }
    return { current: round(current), optimal: round(optimal), excess: round(current - optimal), factor, overrideNote: note, warning };
  }

  function build(process, taxonomy, scenario, named, attrDefs, overrides) {
    /* Resolve toggle implications here rather than in the UI, so every caller
       gets the same answer: the app, the tests, and anything running in Node.
       The result depends only on the final state, never on the order things
       were switched on. */
    if (attrDefs && VSM.rules.applyImplications) scenario = VSM.rules.applyImplications(attrDefs, scenario);
    /* Then the derived attributes (lane, tier-driven controls, privacy
       trigger), in declaration order, with provenance and any sticky user
       overrides. The model carries the result so the UI can explain it. */
    let derived = null;
    if (attrDefs && VSM.derive) {
      derived = VSM.derive.compute(attrDefs, scenario, named, overrides);
      scenario = derived.scenario;
    }
    const acts = process.activities || [];
    const teams = process.teams || {};
    const warnings = [];
    const byId = new Map();
    acts.forEach(a => { if (byId.has(a.id)) throw new Error("Duplicate id: " + a.id); byId.set(a.id, a); });

    /* 1. inclusion */
    const includedIds = new Set(acts.filter(a => VSM.rules.evaluate(a.when, scenario, named)).map(a => a.id));

    /* 2. predecessor sets (explicit successors are folded in) */
    const predMap = new Map(acts.map(a => [a.id, new Set(a.predecessors || [])]));
    acts.forEach(a => (a.successors || []).forEach(s => { if (predMap.has(s)) predMap.get(s).add(a.id); }));

    /* 3. effective predecessors: skip excluded activities but inherit their predecessors

       Walked with an explicit stack, not recursion. A scenario that switches
       off a long run of consecutive steps makes this hop once per excluded
       link, and at a few thousand links the recursive version overflowed the
       call stack and threw out of build() - which nothing above catches, so the
       page went blank. js/validate.js already uses Kahn's algorithm over the
       same graph for exactly this reason; this is the other half of it. */
    const effCache = new Map();
    function effPreds(rootId) {
      if (effCache.has(rootId)) return effCache.get(rootId);
      const onPath = new Set();
      const stack = [{ id: rootId, preds: null, at: 0, out: null }];
      while (stack.length) {
        const frame = stack[stack.length - 1];
        if (frame.preds === null) {
          frame.preds = [...(predMap.get(frame.id) || [])];
          frame.out = new Set();
          onPath.add(frame.id);
        }
        let descended = false;
        while (frame.at < frame.preds.length) {
          const p = frame.preds[frame.at];
          if (!byId.has(p)) { warnings.push(frame.id + " references unknown predecessor '" + p + "'"); frame.at++; continue; }
          if (includedIds.has(p)) { frame.out.add(p); frame.at++; continue; }
          if (effCache.has(p)) { effCache.get(p).forEach(x => frame.out.add(x)); frame.at++; continue; }
          if (onPath.has(p)) throw new Error("Dependency cycle near " + frame.id + " -> " + p);
          stack.push({ id: p, preds: null, at: 0, out: null });
          descended = true;
          break;
        }
        if (descended) continue;
        effCache.set(frame.id, frame.out);
        onPath.delete(frame.id);
        stack.pop();
      }
      return effCache.get(rootId);
    }

    /* 4. nodes */
    const nodes = [];
    const nodeById = new Map();
    acts.forEach((a, index) => {
      if (!includedIds.has(a.id)) return;
      const cat = (taxonomy.categories || {})[a.category] || {};
      const wt = a.waste ? (taxonomy.wasteTypes || {})[a.waste] : null;
      if (a.waste && !wt) warnings.push(a.id + ": unknown waste type '" + a.waste + "'");
      if (!cat.family) warnings.push(a.id + ": unknown category '" + a.category + "'");
      const family = (wt && wt.family) || cat.family || "value";
      const n = {
        id: a.id, act: a, index,
        name: a.name || a.id,
        owner: a.owner || null,
        team: teams[a.owner] || { label: a.owner || "Unassigned", org: null },
        category: a.category, categoryDef: cat,
        waste: wt ? a.waste : null, wasteDef: wt,
        family, familyDef: (taxonomy.families || {})[family] || { optimal: "#64748b", excess: "#94a3b8" },
        code: wt ? wt.code : (cat.code || ""),
        isGate: !!cat.gate || !!a.milestone,
        isMilestone: !!a.milestone,
        duration: resolveDuration(a, scenario, named),
        preds: Array.from(effPreds(a.id)),
        succs: [],
        handoffsIn: []
      };
      if (n.duration.warning) warnings.push(a.id + ": " + n.duration.warning);
      nodes.push(n);
      nodeById.set(n.id, n);
    });
    nodes.forEach(n => n.preds.forEach(p => nodeById.get(p).succs.push(n.id)));

    /* 5. topological order (Kahn, stable on file order) */
    const indeg = new Map(nodes.map(n => [n.id, n.preds.length]));
    const order = [];
    let queue = nodes.filter(n => indeg.get(n.id) === 0);
    while (queue.length) {
      queue.sort((a, b) => a.index - b.index);
      const n = queue.shift();
      order.push(n);
      n.succs.forEach(s => { indeg.set(s, indeg.get(s) - 1); if (indeg.get(s) === 0) queue.push(nodeById.get(s)); });
    }
    if (order.length !== nodes.length) throw new Error("Dependency cycle: " + nodes.filter(n => !order.includes(n)).map(n => n.id).join(", "));

    /* 5b. drop redundant links: a predecessor that is already an ancestor of another predecessor
           adds nothing to the schedule and only clutters the chart (this mostly happens when
           excluded activities are bridged). */
    const ancestors = new Map();
    order.forEach(n => {
      const set = new Set();
      n.preds.forEach(p => { set.add(p); ancestors.get(p).forEach(x => set.add(x)); });
      ancestors.set(n.id, set);
    });
    nodes.forEach(n => {
      n.preds = n.preds.filter(p => !n.preds.some(q => q !== p && ancestors.get(q).has(p)));
      n.succs = [];
    });
    nodes.forEach(n => n.preds.forEach(p => nodeById.get(p).succs.push(n.id)));

    /* 6. forward pass, current and optimal */
    order.forEach(n => {
      n.cur = { start: 0, end: 0 };
      n.opt = { start: 0, end: 0 };
      n.preds.forEach(p => {
        const pn = nodeById.get(p);
        n.cur.start = Math.max(n.cur.start, pn.cur.end);
        n.opt.start = Math.max(n.opt.start, pn.opt.end);
      });
      n.cur.end = n.cur.start + n.duration.current;
      n.opt.end = n.opt.start + n.duration.optimal;
    });
    const currentElapsed = nodes.reduce((m, n) => Math.max(m, n.cur.end), 0);
    const optimalElapsed = nodes.reduce((m, n) => Math.max(m, n.opt.end), 0);

    /* 7. backward pass (current schedule) for float / critical path */
    for (let i = order.length - 1; i >= 0; i--) {
      const n = order[i];
      let lf = currentElapsed;
      n.succs.forEach(s => { const sn = nodeById.get(s); lf = Math.min(lf, sn.cur.lateStart); });
      n.cur.lateFinish = lf;
      n.cur.lateStart = lf - n.duration.current;
      n.cur.float = Math.round((n.cur.lateStart - n.cur.start) * 100) / 100;
      n.critical = n.cur.float <= 0.0001;
    }

    /* 8. handoffs and organizational boundaries */
    const links = [];
    nodes.forEach(n => {
      const a = n.act;
      n.preds.forEach(p => {
        const pn = nodeById.get(p);
        const explicit = a.handoff === true || (Array.isArray(a.handoffs) && a.handoffs.includes(p));
        const auto = a.handoff !== false && pn.owner !== n.owner;
        const isHandoff = explicit || auto;
        const crossOrg = isHandoff && !!pn.team.org && !!n.team.org && pn.team.org !== n.team.org;
        /* A predecessor that was never declared arrived here through an
           excluded step (effPreds bridged past it). Mark the link and carry
           the excluded declared predecessor(s) it stands in for, so the chart
           can say a dependency was preserved rather than dropped. `via` is the
           first hop of the bridge; a deeper chain names its entry point. */
        const declared = predMap.get(n.id) || new Set();
        const bridged = !declared.has(p);
        const link = { from: p, to: n.id, handoff: isHandoff, explicit, crossOrg, bridged, fromTeam: pn.team, toTeam: n.team };
        if (bridged) {
          link.via = [...declared].filter(x => byId.has(x) && !includedIds.has(x));
        }
        links.push(link);
        if (isHandoff) n.handoffsIn.push(link);
      });
      n.hasHandoff = n.handoffsIn.length > 0;
      n.crossOrg = n.handoffsIn.some(h => h.crossOrg);
    });

    /* 9. metrics */
    const m = {
      activities: nodes.length,
      currentElapsed, optimalElapsed,
      removableElapsed: currentElapsed - optimalElapsed,
      removablePct: currentElapsed ? (currentElapsed - optimalElapsed) / currentElapsed : 0,
      sumCurrent: 0, sumOptimal: 0, sumExcess: 0,
      handoffs: nodes.filter(n => n.hasHandoff).length,          // activities that receive a handoff (rings on the chart)
      handoffLinks: links.filter(l => l.handoff).length,          // dependency links that cross an ownership change
      crossOrgHandoffs: nodes.filter(n => n.crossOrg).length,
      gates: nodes.filter(n => n.isGate).length,
      milestones: nodes.filter(n => n.isMilestone).length,
      waitingCurrent: 0, waitingExcess: 0,
      wasteActivities: nodes.filter(n => n.waste).length,
      /* Null-prototype: these are keyed by ids that come out of an imported
         file, and a get-or-create against a normal object literal resolves
         "__proto__" to Object.prototype and then increments it. */
      byWaste: Object.create(null), byFamily: Object.create(null)
    };
    nodes.forEach(n => {
      m.sumCurrent += n.duration.current; m.sumOptimal += n.duration.optimal; m.sumExcess += n.duration.excess;
      if (n.wasteDef && n.wasteDef.waiting) { m.waitingCurrent += n.duration.current; m.waitingExcess += n.duration.excess; }
      /* A DERIVED waste type is counted from the structure, not from a tag on
         the activity. "Handoff" is the one that matters: the chart draws a
         ring wherever ownership changes between a predecessor and its
         successor, but nothing in the data is tagged waste="handoff", so the
         chip used to read zero while the chart was covered in rings. Same
         word, two meanings, and the panel was reporting the wrong one. */
      n.derivedWaste = [];
      Object.keys(taxonomy.wasteTypes || {}).forEach(id => {
        const def = taxonomy.wasteTypes[id];
        if (!def.derived) return;
        const hit = def.derived === "handoff" ? n.hasHandoff
          : def.derived === "crossOrg" ? n.crossOrg
          : def.derived === "gate" ? n.isGate
          : def.derived === "critical" ? n.critical : false;
        if (!hit) return;
        n.derivedWaste.push(id);
        const b = m.byWaste[id] = m.byWaste[id] || { count: 0, current: 0, optimal: 0, excess: 0, derived: true };
        b.count++; b.current += n.duration.current; b.optimal += n.duration.optimal; b.excess += n.duration.excess;
      });

      const w = n.waste || "none";
      m.byWaste[w] = m.byWaste[w] || { count: 0, current: 0, optimal: 0, excess: 0 };
      m.byWaste[w].count++; m.byWaste[w].current += n.duration.current; m.byWaste[w].optimal += n.duration.optimal; m.byWaste[w].excess += n.duration.excess;
      m.byFamily[n.family] = m.byFamily[n.family] || { count: 0, current: 0, optimal: 0, excess: 0 };
      m.byFamily[n.family].count++; m.byFamily[n.family].current += n.duration.current; m.byFamily[n.family].optimal += n.duration.optimal; m.byFamily[n.family].excess += n.duration.excess;
    });
    const orgPairs = new Set(links.filter(l => l.crossOrg).map(l => [l.fromTeam.org, l.toTeam.org].sort().join(" | ")));
    m.orgBoundaries = orgPairs.size;

    return { nodes, nodeById, links, metrics: m, warnings, scenario, process, taxonomy, derived };
  }

  return { build, resolveDuration, resolveTime, setDuration };
})();
if (typeof module !== "undefined" && module.exports) module.exports = VSM.schedule;
