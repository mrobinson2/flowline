/* ============================================================================
   PROGRESS  - project tracking arithmetic. Status in, rollups out.
   ----------------------------------------------------------------------------
   1.0 answers "how long does this process take?". This file answers "and
   where is THIS project right now?" from a status each activity may carry:

     status      todo | doing | done | blocked | skipped   (absent = todo)
     progress    0..100, how far a "doing" activity is     (absent = 50)
     statusNote  free text - why blocked, what's happening
     statusDate  YYYY-MM-DD of the last status change

   Three rules keep this honest:

   * TRACKING NEVER CHANGES THE SCHEDULE. The scheduler and the four analysis
     views do not read status. This file reads the scheduled model and layers
     the rollups on top, so ticking a box can never move a bar.

   * SKIPPED LEAVES THE DENOMINATOR. A task ruled out mid-project is not
     un-done work, and counting it as such would understate progress forever.

   * REMAINING TIME IS A CRITICAL PATH, NOT A SUM. Done and skipped work cost
     zero, a "doing" task costs its unfinished share, and the answer is the
     longest chain of what is left - the same arithmetic as the main chart,
     so the two never disagree about how scheduling works.

   Pure data in, data out; runs under Node so the tests can check the numbers.
   ========================================================================== */
(function (root) {
  const VSM = root.VSM = root.VSM || {};

  /* The vocabulary, including how each state is drawn. Colors are literal hex
     because the tracker SVG is exported the same way the timeline is. */
  const STATUSES = [
    { id: "todo",    label: "Not started", short: "To do",   color: "#64748B" },
    { id: "doing",   label: "In progress", short: "Doing",   color: "#3B82F6" },
    { id: "done",    label: "Done",        short: "Done",    color: "#22C55E" },
    { id: "blocked", label: "Blocked",     short: "Blocked", color: "#EF4444" },
    { id: "skipped", label: "Skipped (out of scope)", short: "Skipped", color: "#475569" }
  ];
  const VALID = new Set(STATUSES.map(s => s.id));

  const num = v => (typeof v === "number" && isFinite(v) ? v : null);

  /* One place that decides what an activity's status IS, shared by the
     rollups, the renderer and the details panel. Tolerant on purpose: a
     misspelled status out of a spreadsheet renders as todo and is reported,
     rather than blanking a chart over a tracking field. */
  function statusOf(act) {
    const a = act || {};
    const raw = a.status === undefined || a.status === null ? "" : String(a.status).trim().toLowerCase();
    const known = VALID.has(raw);
    const id = known ? raw : "todo";
    let p = num(a.progress);
    if (p !== null) p = Math.max(0, Math.min(100, p));
    /* the fraction of the work that is DONE, whatever the state calls itself */
    const fraction = id === "done" ? 1
      : id === "skipped" ? 0
      : id === "doing" ? (p === null ? 0.5 : p / 100)
      : 0;
    return {
      id, fraction,
      explicit: raw !== "",                       // was any status actually recorded?
      unknown: raw !== "" && !known ? a.status : null,
      note: a.statusNote ? String(a.statusNote) : "",
      date: a.statusDate ? String(a.statusDate) : ""
    };
  }

  /* Longest chain of unfinished work, in the model's own units. Done and
     skipped cost zero; doing costs its unfinished share; todo and blocked
     cost their full current duration. Same forward pass as the scheduler. */
  function remainingElapsed(model, stById) {
    const nodes = model.nodes;
    const byId = model.nodeById;
    const remainOf = n => {
      const st = stById.get(n.id);
      if (st.id === "done" || st.id === "skipped") return 0;
      return n.duration.current * (1 - (st.id === "doing" ? st.fraction : 0));
    };
    const indeg = new Map(nodes.map(n => [n.id, n.preds.length]));
    const finish = new Map();
    const queue = nodes.filter(n => indeg.get(n.id) === 0);
    let end = 0, seen = 0;
    for (let i = 0; i < queue.length; i++) {
      const n = queue[i];
      seen++;
      let start = 0;
      n.preds.forEach(p => { const f = finish.get(p); if (f > start) start = f; });
      const f = start + remainOf(n);
      finish.set(n.id, f);
      if (f > end) end = f;
      n.succs.forEach(s => { indeg.set(s, indeg.get(s) - 1); if (indeg.get(s) === 0) queue.push(byId.get(s)); });
    }
    /* the scheduler already rejected cyclic graphs, so seen === nodes.length;
       the guard costs nothing and keeps a bad caller from a silent zero */
    return seen === nodes.length ? Math.round(end * 1000) / 1000 : null;
  }

  /* Roll one list of nodes up into a tracker segment. */
  function segmentStats(nodes, stById) {
    const s = { total: 0, done: 0, doing: 0, todo: 0, blocked: 0, skipped: 0, weightDone: 0, weightTotal: 0 };
    nodes.forEach(n => {
      const st = stById.get(n.id);
      s[st.id]++;
      if (st.id === "skipped") return;            // out of scope, out of the denominator
      s.total++;
      const w = Math.max(0, n.duration.current);
      s.weightTotal += w;
      s.weightDone += w * st.fraction;
    });
    s.pct = s.weightTotal > 0 ? s.weightDone / s.weightTotal
      : s.total > 0 ? s.done / s.total : 0;       // all-milestone segment: fall back to counts
    s.state = s.total === 0 ? "empty"
      : s.done === s.total ? "done"
      : s.blocked > 0 ? "blocked"
      : (s.doing > 0 || s.done > 0) ? "active"
      : "upcoming";
    return s;
  }

  function compute(model) {
    const process = model.process || {};
    const nodes = model.nodes || [];
    const stById = new Map(nodes.map(n => [n.id, statusOf(n.act)]));
    const warnings = [];
    nodes.forEach(n => {
      const st = stById.get(n.id);
      if (st.unknown !== null) warnings.push(n.id + ": unknown status '" + st.unknown + "' treated as not started.");
    });

    const overall = segmentStats(nodes, stById);
    const tracked = nodes.some(n => stById.get(n.id).explicit);

    /* ---- segments: stages when the data declares them, else phases.
       Five or six segments is what an executive reads at a glance; nineteen
       is what the Gantt is for. */
    const phases = process.phases || [];
    const stages = process.stages || [];
    const phaseById = new Map(phases.map(p => [p.id, p]));
    const useStages = stages.length > 0 && phases.some(p => p.stage);
    const keyOf = n => {
      const ph = phaseById.get(n.act.phase);
      if (!useStages) return n.act.phase || null;
      return ph && ph.stage ? ph.stage : null;    // a phase outside every stage stays out of the bar
    };
    const defs = useStages ? stages : phases;
    const segments = [];
    defs.forEach(d => {
      const mine = nodes.filter(n => keyOf(n) === d.id);
      if (!mine.length) return;                   // the scenario excluded this whole band
      const seg = segmentStats(mine, stById);
      seg.id = d.id;
      seg.label = d.label || d.id;
      seg.short = d.short || seg.label;
      segments.push(seg);
    });
    const unbanded = nodes.filter(n => keyOf(n) === null);
    if (unbanded.length) {
      const seg = segmentStats(unbanded, stById);
      seg.id = "__other";
      seg.label = "Other"; seg.short = "Other";
      segments.push(seg);
    }

    /* ---- the lists a status meeting actually asks for */
    const brief = n => ({ id: n.id, name: n.name, owner: n.team ? (n.team.short || n.team.label) : "", note: stById.get(n.id).note, date: stById.get(n.id).date });
    const now = nodes.filter(n => stById.get(n.id).id === "doing").map(brief);
    const blocked = nodes.filter(n => stById.get(n.id).id === "blocked").map(brief);
    /* ready to start: todo, and every predecessor finished or out of scope */
    const doneish = id => { const st = stById.get(id); return st && (st.id === "done" || st.id === "skipped"); };
    const next = nodes.filter(n => stById.get(n.id).id === "todo" && n.preds.every(doneish)).map(brief);

    const gates = nodes.filter(n => n.isGate);
    const gatesPassed = gates.filter(n => stById.get(n.id).id === "done").length;

    const health = overall.total === 0 ? "not-started"
      : overall.done === overall.total ? "complete"
      : overall.blocked > 0 ? "blocked"
      : (overall.done > 0 || overall.doing > 0) ? "on-track"
      : "not-started";

    return {
      tracked, warnings, statuses: stById,
      counts: { total: overall.total, done: overall.done, doing: overall.doing, todo: overall.todo, blocked: overall.blocked, skipped: overall.skipped },
      pct: overall.pct,
      pctCount: overall.total ? overall.done / overall.total : 0,
      segments, level: useStages ? "stage" : "phase",
      now, blocked: blocked, next,
      gates: { total: gates.length, passed: gatesPassed },
      remaining: remainingElapsed(model, stById),
      health
    };
  }

  VSM.progress = { STATUSES, statusOf, compute };
  if (typeof module !== "undefined" && module.exports) module.exports = VSM.progress;
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
