/* ============================================================================
   ANALYSIS  -  why is the number what it is, and what would move it.
   ----------------------------------------------------------------------------
   A schedule that says "335 days" and nothing else is unarguable, which is the
   opposite of useful. These functions take the model apart:

     profile()      how parallel the stream is, what the critical path is made
                    of, and how much of it is waiting rather than working
     sensitivity()  what a given intervention is worth, in days off the path

   Everything here is read-only and DOM-free, so it runs in Node against a real
   workbook from a command line.
   ========================================================================== */
(function (root) {
  const VSM = root.VSM = root.VSM || {};
  const r1 = v => Math.round(v * 10) / 10;

  /* The actual chain that sets the end date: walk back from the latest finish,
     hopping to whichever predecessor the step was waiting on. */
  function criticalChain(model) {
    if (!model.nodes.length) return [];
    let end = model.nodes[0];
    model.nodes.forEach(n => { if (n.cur.end > end.cur.end) end = n; });
    const chain = [end];
    const byId = model.nodeById;
    const seen = new Set([end.id]);
    let cur = end;
    while (cur && cur.preds && cur.preds.length) {
      let driver = null;
      cur.preds.forEach(p => {
        const n = byId.get(p);
        if (!n || seen.has(n.id)) return;
        /* the predecessor whose finish equals this step's start is the one
           that held it up; ties go to the longer one */
        if (Math.abs(n.cur.end - cur.cur.start) < 1e-6 && (!driver || n.duration.current > driver.duration.current)) driver = n;
      });
      if (!driver) break;
      chain.push(driver); seen.add(driver.id); cur = driver;
    }
    return chain.reverse();
  }

  function profile(model, opts) {
    const perDay = (opts && opts.hoursPerDay) || (model.process && model.process.hoursPerDay) || 1;
    const toDays = v => v / perDay;
    const chain = criticalChain(model);
    const summed = model.nodes.reduce((s, n) => s + n.duration.current, 0);
    const path = model.metrics.currentElapsed;

    /* lead vs cycle along the chain only, which is where it actually costs */
    let chainLead = 0, chainCycle = 0, chainUnsplit = 0;
    chain.forEach(n => {
      const t = n.act && n.act.time;
      if (t) { chainLead += t.leadCurrent * (n.duration.factor || 1); chainCycle += t.cycleCurrent * (n.duration.factor || 1); }
      else chainUnsplit += n.duration.current;
    });

    const byPhase = Object.create(null);   // keyed by an imported phase id; see js/schedule.js
    chain.forEach(n => {
      const p = (n.act && n.act.phase) || "unassigned";
      byPhase[p] = byPhase[p] || { phase: p, steps: 0, days: 0, gates: 0 };
      byPhase[p].steps++; byPhase[p].days += toDays(n.duration.current);
      if (n.isGate) byPhase[p].gates++;
    });
    const phaseLabel = id => {
      const p = ((model.process && model.process.phases) || []).find(x => x.id === id);
      return p ? p.label : id;
    };

    return {
      tasks: model.nodes.length,
      summedDays: r1(toDays(summed)),
      pathDays: r1(toDays(path)),
      /* how much the stream overlaps. 1.0 means a single file queue: nothing
         runs at the same time as anything else. */
      parallelism: path ? Math.round((summed / path) * 100) / 100 : 0,
      chainSteps: chain.length,
      chainGates: chain.filter(n => n.isGate).length,
      chainLeadDays: r1(toDays(chainLead)),
      chainCycleDays: r1(toDays(chainCycle)),
      chainFlowEfficiency: (chainLead + chainCycle) ? Math.round(1000 * chainCycle / (chainLead + chainCycle)) / 10 : null,
      chainUnsplitDays: r1(toDays(chainUnsplit)),
      byPhase: Object.values(byPhase).map(p => ({ ...p, label: phaseLabel(p.phase), days: r1(p.days) })).sort((a, b) => b.days - a.days),
      longest: chain.slice().sort((a, b) => b.duration.current - a.duration.current).slice(0, 12)
        .map(n => ({ id: n.id, name: n.name, days: r1(toDays(n.duration.current)), gate: !!n.isGate, team: n.team.label }))
    };
  }

  /* ---------------------------------------------------------- what-ifs
     Each returns a modified copy of the process; the caller reschedules and
     compares. They are deliberately blunt levers a manager could actually
     pull, not parameter fitting. */
  const clone = p => JSON.parse(JSON.stringify(p));

  /* Scale every wait. Use this to ask what the answer would be if the
     estimates are systematically pessimistic: people asked "how long does this
     take" tend to answer with the bad case they remember rather than the
     typical one, and along a long chain those add up in one direction only. */
  function scaleLead(process, factor) {
    const p = clone(process);
    p.activities.forEach(a => {
      if (!a.time) { a.duration.current *= factor; a.duration.optimal *= factor; return; }
      a.time.leadCurrent *= factor; a.time.leadOptimal *= factor;
      a.duration.current = a.time.leadCurrent + a.time.cycleCurrent;
      a.duration.optimal = a.time.leadOptimal + a.time.cycleOptimal;
    });
    return p;
  }

  /* Nothing waits longer than N days. A service-level commitment on queues,
     which is usually a policy decision rather than a technical one. */
  function capWait(process, maxDays, perDay) {
    const cap = maxDays * (perDay || 8);
    const p = clone(process);
    p.activities.forEach(a => {
      if (!a.time) return;
      if (a.time.leadCurrent > cap) {
        a.time.leadCurrent = cap;
        a.duration.current = a.time.leadCurrent + a.time.cycleCurrent;
        if (a.duration.optimal > a.duration.current) a.duration.optimal = a.duration.current;
      }
    });
    return p;
  }

  /* Deduplicate shared queues. If several steps each record a wait for the
     same weekly board, the stream is charged for that wait several times over.
     This collapses the wait on all but the first step of each named group. */
  function mergeQueues(process, groupOf) {
    const p = clone(process);
    const firstSeen = new Set();
    p.activities.forEach(a => {
      const g = groupOf(a);
      if (!g) return;
      if (firstSeen.has(g)) {
        if (!a.time) return;
        a.time.leadCurrent = 0;
        a.duration.current = a.time.cycleCurrent;
        if (a.duration.optimal > a.duration.current) a.duration.optimal = a.duration.current;
      } else firstSeen.add(g);
    });
    return p;
  }

  /* ---------------------------------------------------------- unit sanity
     Is the workbook's lead time in business hours or calendar hours?

     Nobody writes this down, and it changes every elapsed figure by about 3x.
     The naive check does not work: every multiple of 24 is also a multiple of
     8, so "lands on an 8-hour grid" is true of calendar entries too and tells
     you nothing. The sets are nested, not separate.

     What does separate them:

       - A multiple of 8 that is NOT a multiple of 24 (8, 16, 40, 56, 80, 104)
         can only come from someone counting working hours. A calendar thinker
         never writes 40. This is the positive signal for business hours.

       - 168, 336, 504 are calendar weeks (7 x 24). In working hours a week is
         40, not 168, so these can only come from someone counting calendar
         time. This is the positive signal for calendar hours.

       - 24, 48, 72, 96 are genuinely ambiguous: three working days or one
         calendar day. They are counted but prove nothing on their own.

     A workbook in business hours is full of the first kind. A workbook in
     calendar hours has almost none of them and some of the second kind. */
  function unitCheck(process, perDay) {
    const step = perDay || 8;
    const rows = (process.activities || []).filter(a => a.time && a.time.leadCurrent > 0);
    if (!rows.length) return { rows: 0, verdict: "no lead/cycle split in this data, so there is nothing to check" };

    const near = (v, m) => Math.abs(v / m - Math.round(v / m)) < 0.02;
    const CAL_WEEKS = [168, 336, 504, 672, 840];
    const workOnly = [], calOnly = [], ambiguous = [], neither = [];
    rows.forEach(a => {
      const v = a.time.leadCurrent;
      if (CAL_WEEKS.some(w => near(v, w) && v >= 168)) calOnly.push(a);
      else if (near(v, step) && !near(v, 24)) workOnly.push(a);
      else if (near(v, 24)) ambiguous.push(a);
      else neither.push(a);
    });

    const pct = n => Math.round(100 * n / rows.length);
    const pw = pct(workOnly.length), pc = pct(calOnly.length), pn = pct(neither.length);
    let verdict, confident = true;
    if (pn > 50) {
      verdict = "UNCLEAR. " + pn + "% of waits sit on no round grid at all, which usually means the numbers were " +
        "derived or spread rather than entered by a person. The unit cannot be inferred from the values.";
      confident = false;
    } else if (pw >= 25 && pc === 0) {
      verdict = "BUSINESS HOURS. " + workOnly.length + " wait(s) are working-hour values a calendar thinker would never write " +
        "(" + workOnly.slice(0, 3).map(a => a.time.leadCurrent).join(", ") + "), and nothing looks like a calendar week. " +
        "The " + step + "-hour day is right and the elapsed figures hold.";
    } else if (pc > 0 && pw < 10) {
      verdict = "CALENDAR HOURS. " + calOnly.length + " wait(s) are calendar weeks (168, 336) and almost nothing is a " +
        "working-hour value. Every elapsed figure is roughly 3x too long: these waits should be divided by 24, not " + step + ".";
    } else if (pc > 0 && pw >= 10) {
      verdict = "MIXED. " + workOnly.length + " wait(s) look like working hours and " + calOnly.length +
        " look like calendar weeks. The rows are not comparable to each other and the totals mean nothing until this is settled.";
    } else {
      verdict = "PROBABLY BUSINESS HOURS, but weakly. Most waits are ambiguous multiples of 24, which are both three working " +
        "days and one calendar day. Confirm with whoever entered them.";
      confident = false;
    }

    return {
      rows: rows.length, perDay: step, confident, verdict,
      workingHoursOnly: workOnly.length, pctWorkingHoursOnly: pw,
      calendarWeeks: calOnly.length, pctCalendarWeeks: pc,
      ambiguous: ambiguous.length, pctAmbiguous: pct(ambiguous.length),
      offAnyGrid: neither.length, pctOffAnyGrid: pn,
      examplesWorking: workOnly.slice(0, 6).map(a => ({ id: a.id, name: a.name, hours: a.time.leadCurrent })),
      examplesCalendar: calOnly.slice(0, 6).map(a => ({ id: a.id, name: a.name, hours: a.time.leadCurrent })),
      examplesOffGrid: neither.slice(0, 6).map(a => ({ id: a.id, name: a.name, hours: a.time.leadCurrent })),
      biggestWaits: rows.slice().sort((a, b) => b.time.leadCurrent - a.time.leadCurrent).slice(0, 10)
        .map(a => ({
          id: a.id, name: a.name, hours: a.time.leadCurrent,
          workingDays: Math.round(a.time.leadCurrent / step * 10) / 10,
          calendarDaysIfWorkHours: Math.round(a.time.leadCurrent / step * 1.4),
          calendarDaysIf24: Math.round(a.time.leadCurrent / 24 * 10) / 10
        }))
    };
  }

  VSM.analyze = { profile, criticalChain, scaleLead, capWait, mergeQueues, unitCheck };
  if (typeof module !== "undefined" && module.exports) module.exports = VSM.analyze;
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
