/* ============================================================================
   SCENARIO RUNS - persist every scenario worth keeping (spec §2.5, §4.9).
   ----------------------------------------------------------------------------
   A run snapshots the USER's answers, both override maps, the derived
   headline values, and the result: included/excluded ids, totals, critical
   path. Reloading one means rebuilding from its answers and overrides - the
   engine recomputes, and a test asserts the result is identical, because a
   "saved scenario" that quietly drifts is worse than none.

   Runs are DATA. Nothing here evaluates them as rules, and the saved set is
   what the admin mode's impact preview replays against candidate rule
   changes: "if I change this expression, which of the scenarios we actually
   care about changes shape?"

   Storage: localStorage under one key, capped at 20 runs (oldest dropped),
   every write read back - a storage that accepts a write and keeps nothing
   must fail the save, not toast success (the app's own 1.0.2 lesson).
   ========================================================================== */
(function (root) {
  const VSM = root.VSM = root.VSM || {};
  const KEY = "vsm.runs.v1";
  const CAP = 20;

  const storage = () => (typeof localStorage !== "undefined" ? localStorage
    : root.localStorage);

  function record(model, state, name) {
    const s = state || {};
    const derivedVals = {};
    if (model.derived && model.derived.provenance) {
      Object.keys(model.derived.provenance).forEach(id => { derivedVals[id] = model.derived.provenance[id].value; });
    }
    return {
      runId: "r-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8),
      name: String(name || "unnamed scenario"),
      createdUtc: new Date().toISOString(),
      answers: JSON.parse(JSON.stringify(s.scenario || {})),
      overrides: JSON.parse(JSON.stringify(s.overrides || {})),
      taskOverrides: JSON.parse(JSON.stringify(s.taskOverrides || {})),
      derived: derivedVals,
      includedKeys: model.nodes.map(n => n.id),
      excludedKeys: (model.excluded || []).map(x => x.id),
      totals: {
        elapsed: model.metrics.currentElapsed,
        optimal: model.metrics.optimalElapsed,
        gates: model.metrics.gates,
        tasks: model.nodes.length
      },
      criticalKeys: model.nodes.filter(n => n.critical).map(n => n.id)
    };
  }

  /* answers compared shallowly, arrays as sets - the changed-answer list is
     for a human reading "what did I do differently", not for replay */
  function diff(a, b) {
    const setEq = (x, y) => Array.isArray(x) && Array.isArray(y)
      ? x.length === y.length && x.every(v => y.includes(v)) : x === y;
    const inA = new Set(a.includedKeys), inB = new Set(b.includedKeys);
    const changed = [];
    const keys = new Set(Object.keys(a.answers || {}).concat(Object.keys(b.answers || {})));
    const aa = a.answers || {}, ba = b.answers || {};             // an imported run may lack answers
    keys.forEach(k => { if (!setEq(aa[k], ba[k])) changed.push({ id: k, from: aa[k], to: ba[k] }); });
    return {
      addedTasks: b.includedKeys.filter(id => !inA.has(id)),
      removedTasks: a.includedKeys.filter(id => !inB.has(id)),
      elapsedDelta: (b.totals.elapsed || 0) - (a.totals.elapsed || 0),
      gatesDelta: (b.totals.gates || 0) - (a.totals.gates || 0),
      changedAnswers: changed
    };
  }

  function list() {
    const st = storage();
    if (!st) return [];
    try {
      const raw = JSON.parse(st.getItem(KEY) || "[]");
      return Array.isArray(raw) ? raw.filter(r => r && typeof r === "object" && r.runId) : [];
    } catch (e) { return []; }
  }

  function write(runs) {
    const st = storage();
    if (!st) throw new Error("no storage available to keep scenarios in");
    st.setItem(KEY, JSON.stringify(runs));
    const back = list();
    if (back.length !== runs.length) throw new Error("the browser did not keep the saved scenario (storage kept nothing)");
    return back;
  }

  function save(run) {
    const runs = list().filter(r => r.runId !== run.runId);
    runs.push(run);
    while (runs.length > CAP) runs.shift();
    return write(runs);
  }

  function remove(runId) { return write(list().filter(r => r.runId !== runId)); }

  function replaceAll(runs) { return write(Array.isArray(runs) ? runs.filter(r => r && r.runId).slice(-CAP) : []); }

  VSM.runs = { record, diff, list, save, remove, replaceAll, storageKey: KEY };
  if (typeof module !== "undefined" && module.exports) module.exports = VSM.runs;
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
