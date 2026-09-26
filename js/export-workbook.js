/* ============================================================================
   EXPORT IN THE WORKBOOK'S OWN FORMAT
   ----------------------------------------------------------------------------
   The app used to export its own internal column set, which meant a round trip
   through Excel came back in a shape the source workbook did not recognise.
   This writes the real thing: Task List columns A..Y exactly as declared in
   js/schema.js, plus Edges, Assumptions and the three tailoring tabs.

   Columns R..X (Duration, Earliest Start, Earliest Finish, Latest Start,
   Latest Finish, Slack, Critical Path) are RECOMPUTED from the current model
   rather than copied through. That is the point: change a duration in the app
   or flip a toggle, export, and the schedule columns are right. A copied
   schedule would be stale the moment anything moved.

   Only the tasks the current scenario includes are written, and the header
   block says which scenario that was, so a file can never quietly be mistaken
   for the full master list.
   ========================================================================== */
(function (root) {
  const VSM = root.VSM = root.VSM || {};

  const txt = v => (v === undefined || v === null ? "" : String(v));
  const inHoursTop = model => /hour/i.test(String((model.process && model.process.units) || ""));
  const r2 = v => (v === null || v === undefined || !isFinite(v) ? "" : Math.round(v * 100) / 100);

  /* Reverse the import's mapping: our internal category -> the Lean step type
     the workbook uses. Driven by schema.PICKLISTS so the spellings match. */
  function stepTypeFor(node) {
    const list = VSM.schema.PICKLISTS.stepType.values;
    const byId = id => (list.find(v => v.id === id) || {}).value || "";
    if (node.isMilestone) return byId("milestone");
    const direct = byId(node.category);
    if (direct) return direct;
    /* the shipped sample data uses value/enabling/approval */
    if (node.category === "approval") return byId("gate");
    if (node.category === "enabling") return byId("bnva");
    return byId("value") || "Value-Add";
  }

  function wasteFor(node) {
    if (!node.waste) return "-";
    const list = VSM.schema.PICKLISTS.waste.values;
    const hit = list.find(v => v.id === node.waste);
    if (hit) return hit.value;
    /* a taxonomy of our own (queue, rework, manual...) has no DOWNTIME
       equivalent declared, so write the label rather than invent a mapping */
    return (node.wasteDef && node.wasteDef.label) || node.waste;
  }

  function ttTypeFor(node) {
    const a = node.act || {};
    if (a.ttType) return a.ttType;
    const team = node.team || {};
    const list = VSM.schema.PICKLISTS.ttType.values;
    const hit = list.find(v => v.id === team.ttType || v.value === team.org);
    return hit ? hit.value : (team.org || "");
  }

  function interactionFor(node) {
    const a = node.act || {};
    const list = VSM.schema.PICKLISTS.interaction.values;
    if (a.interaction) {
      const hit = list.find(v => v.id === a.interaction || v.value === a.interaction);
      if (hit) return hit.value;
      return a.interaction;
    }
    /* nothing declared: say what the structure shows rather than guess a mode */
    return node.hasHandoff ? "Handoff (TT anti-pattern)" : "";
  }

  /* The "Applies When" cell. Prefer the workbook's own phrase if the data came
     from one; otherwise write the rule in plain English so the column stays
     readable by a person rather than becoming JSON. */
  function appliesWhen(node, scenarioCfg, named) {
    const a = node.act || {};
    if (a.appliesWhen) return a.appliesWhen;
    if (a.when === undefined || a.when === null) return "Every workload";
    try { return VSM.rules.describe(a.when, (scenarioCfg || {}).attributes, named || {}); }
    catch (e) { return typeof a.when === "string" ? a.when : JSON.stringify(a.when); }
  }

  /* --------------------------------------------------------------- the rows */
  function taskRows(model, opts) {
    const perDay = (model.process && model.process.hoursPerDay) || VSM.schema.HOURS_PER_DAY;
    /* the sample data is in days; the workbook's columns are hours, so convert
       on the way out rather than writing days into a column labelled (hrs) */
    const unit = VSM.units.resolve(model.process);
    const toDays = v => unit.toDays(v);
    const toHours = v => toDays(v) * perDay;
    const scenarioCfg = opts && opts.scenarioCfg;
    const named = (scenarioCfg && scenarioCfg.rules) || {};
    const phaseLabel = id => {
      const p = ((model.process && model.process.phases) || []).find(x => x.id === id);
      return p ? p.label : (id || "");
    };
    const stageLabel = phaseId => {
      const p = ((model.process && model.process.phases) || []).find(x => x.id === phaseId);
      if (!p || !p.stage) return "";
      const s = ((model.process && model.process.stages) || []).find(x => x.id === p.stage);
      return s ? s.label : p.stage;
    };

    return model.nodes.map(n => {
      const a = n.act || {};
      const t = VSM.schedule.resolveTime(a, n.duration);
      const f = n.duration.factor || 1;
      const leadCur = t ? t.leadCurrent : null;
      const cycleCur = t ? t.cycleCurrent : null;
      const leadOpt = t ? t.leadOptimal : null;
      const cycleOpt = t ? t.cycleOptimal : null;
      /* without a lead/cycle split (the sample data), put everything in lead
         and leave cycle blank rather than inventing a split that is not there */
      const curTotal = toHours(n.duration.current);
      const optTotal = toHours(n.duration.optimal);
      const L = t ? r2(toHours(leadCur)) : r2(curTotal);
      const M = t ? r2(toHours(cycleCur)) : "";
      const N = t ? r2(toHours(leadOpt)) : r2(optTotal);
      const O = t ? r2(toHours(cycleOpt)) : "";
      const fe = t && (leadCur + cycleCur) ? Math.round(1000 * cycleCur / (leadCur + cycleCur)) / 1000 : "";

      return {
        "ID": a.id,
        "Phase": phaseLabel(a.phase),
        "Task": n.name,
        "Assigned Team": (n.team && n.team.label) || "",
        "Team Topologies Type": ttTypeFor(n),
        "Interaction Mode (\"Team Topologies\")": interactionFor(n),
        "Predecessor IDs": (n.preds || []).join(","),
        "Step Type (Lean)": stepTypeFor(n),
        "Waste Category (DOWNTIME)": wasteFor(n),
        "Lane Applicability": a.lane || "",
        "Applies When": appliesWhen(n, scenarioCfg, named),
        "Current Lead Time (hrs)": L,
        "Current Cycle Time (hrs)": M,
        "Optimized Lead Time (hrs)": N,
        "Optimized Cycle Time (hrs)": O,
        "%C&A": a.pctCA === undefined || a.pctCA === null ? "" : a.pctCA,
        "Flow Efficiency": fe,
        /* R..X recomputed from THIS model, not carried through */
        "Duration (days)": r2(toDays(n.duration.current)),
        "Earliest Start (day)": r2(toDays(n.cur.start)),
        "Earliest Finish (day)": r2(toDays(n.cur.end)),
        "Latest Start (day)": r2(toDays(n.cur.start + n.cur.float)),
        "Latest Finish (day)": r2(toDays(n.cur.end + n.cur.float)),
        "Slack (days)": r2(toDays(n.cur.float)),
        "Critical Path": n.critical ? "Yes" : "",
        /* If a scenario toggle stretched this step, the hours above are the
           stretched ones. Say so in the row, or someone comparing this file
           to the source workbook finds a discrepancy with no explanation and
           concludes the tool is wrong. */
        "Notes": [txt(a.notes), f !== 1 ? "Scenario multiplier " + f + "x applied" +
          ((a.multipliers || []).length ? " (" + a.multipliers.map(x => x.note).join("; ") + ")" : "") : ""]
          .filter(Boolean).join(" | "),
        /* column Z: the two-level rollup, blank when the data has no stages */
        "Stage": stageLabel(a.phase)
      };
    });
  }

  function edgeRows(model) {
    const perDay = (model.process && model.process.hoursPerDay) || VSM.schema.HOURS_PER_DAY;
    const toDays = v => VSM.units.resolve(model.process).toDays(v);
    const byId = model.nodeById;
    const rows = [];
    model.nodes.forEach(n => (n.preds || []).forEach(p => {
      const pn = byId.get(p);
      if (!pn) return;
      rows.push({
        "Successor ID": n.id,
        "Predecessor ID": p,
        "Successor Task": n.name,
        "Predecessor Task": pn.name,
        "Predecessor Earliest Finish": r2(toDays(pn.cur.end)),
        "Successor Earliest Start": r2(toDays(n.cur.start)),
        "Zero-Slack Link": Math.abs(pn.cur.end - n.cur.start) < 1e-6 ? "BINDING" : ""
      });
    }));
    return rows;
  }

  function summaryByPhase(model) {
    const perDay = (model.process && model.process.hoursPerDay) || VSM.schema.HOURS_PER_DAY;
    const toHours = v => VSM.units.resolve(model.process).toDays(v) * perDay;
    const order = ((model.process && model.process.phases) || []).map(p => p.id);
    const acc = new Map();
    model.nodes.forEach(n => {
      const id = (n.act && n.act.phase) || "unassigned";
      const e = acc.get(id) || { id, steps: 0, gates: 0, handoffs: 0, rework: 0, lead: 0, cycle: 0, optLead: 0, optCycle: 0 };
      const t = VSM.schedule.resolveTime(n.act || {}, n.duration);
      e.steps++;
      if (n.isGate) e.gates++;
      if (n.hasHandoff) e.handoffs++;
      if (n.category === "rework" || n.waste === "rework") e.rework++;
      if (t) { e.lead += t.leadCurrent; e.cycle += t.cycleCurrent; e.optLead += t.leadOptimal; e.optCycle += t.cycleOptimal; }
      else { e.lead += n.duration.current; e.optLead += n.duration.optimal; }
      acc.set(id, e);
    });
    const label = id => { const p = ((model.process && model.process.phases) || []).find(x => x.id === id); return p ? p.label : id; };
    return [...acc.values()]
      .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
      .map(e => ({
        "Phase": label(e.id), "Steps": e.steps, "Approval Gates": e.gates,
        "Handoffs": e.handoffs, "Rework Loops": e.rework,
        "Current Lead (hrs)": r2(toHours(e.lead)), "Current Cycle (hrs)": r2(toHours(e.cycle)),
        "Optimized Lead (hrs)": r2(toHours(e.optLead)), "Optimized Cycle (hrs)": r2(toHours(e.optCycle)),
        "Lead Time Reduction (hrs)": r2(toHours(e.lead + e.cycle - e.optLead - e.optCycle)),
        "Flow Efficiency %": (e.lead + e.cycle) ? Math.round(1000 * e.cycle / (e.lead + e.cycle)) / 10 : 0
      }));
  }

  /* ------------------------------------------------------------- the tabs */
  function sheets(model, opts) {
    opts = opts || {};
    const TASK_HEADERS = VSM.schema.TASK.map(c => c.header);
    const EDGE_HEADERS = VSM.schema.EDGES.map(c => c.header);
    const out = [
      { name: "Task List", headers: TASK_HEADERS, rows: taskRows(model, opts),
        widths: [6, 30, 44, 26, 24, 26, 16, 30, 22, 16, 30, 12, 12, 12, 12, 9, 12, 12, 12, 12, 12, 12, 10, 11, 30, 24] },
      { name: "Edges", headers: EDGE_HEADERS, rows: edgeRows(model), widths: [12, 13, 44, 44, 14, 14, 13] },
      { name: "Summary by Phase",
        headers: ["Phase", "Steps", "Approval Gates", "Handoffs", "Rework Loops", "Current Lead (hrs)", "Current Cycle (hrs)",
          "Optimized Lead (hrs)", "Optimized Cycle (hrs)", "Lead Time Reduction (hrs)", "Flow Efficiency %"],
        rows: summaryByPhase(model), widths: [34, 8, 14, 11, 13, 16, 16, 16, 16, 18, 15] }
    ];

    /* Teams cross-reference. The chart shows "Infra Ops" because the owner
       column on a 1920-wide slide cannot fit "Infrastructure Operations", so
       every team can carry a short name for that column. Nothing else uses it,
       and the full label is what the Task List and every other view show. This
       tab is the lookup between the two, so a short name on a chart is never a
       mystery. Only teams that own a task in this export are listed. */
    const teams = (model.process && model.process.teams) || {};
    const used = new Set(model.nodes.map(n => n.owner));
    const teamRows = Object.keys(teams).filter(id => used.has(id)).map(id => {
      const t = teams[id];
      const n = model.nodes.filter(x => x.owner === id).length;
      return {
        "Team ID": id,
        "Assigned Team (full name)": t.label || id,
        "Short Name (shown on the chart)": t.short || t.label || id,
        "Organization": t.org || "",
        "Team Topologies Type": t.ttType ? (VSM.schema.PICKLISTS.ttType.values.find(v => v.id === t.ttType) || {}).value || t.ttType : (t.org || ""),
        "Tasks in this export": n
      };
    }).sort((a, b) => String(a["Assigned Team (full name)"]).localeCompare(String(b["Assigned Team (full name)"])));
    out.push({
      name: "Teams", headers: Object.keys(teamRows[0] || { "Team ID": "" }),
      rows: teamRows, widths: [16, 34, 30, 20, 30, 12]
    });

    /* CHART VIEW. Everything the timeline draws that the Task List does not
       carry as a column of its own. The handoff rings are the reason this
       exists: the chart shows dozens of them and they are derived from an
       ownership change between a step and its predecessor, so nothing in the
       25 columns names them. Anyone reading the spreadsheet could work them
       out from Assigned Team plus Predecessor IDs, but they should not have
       to. Same for the removable figure the chart prints beside every row.

       This is deliberately a separate sheet rather than extra columns, so the
       Task List stays exactly A..Y and round-trips with the source workbook
       unchanged. */
    const chartRows = model.nodes.map((n, i) => {
      const a = n.act || {};
      const f = n.duration.factor || 1;
      return {
        "Row": i + 1,
        "ID": a.id,
        "Task": n.name,
        "Owner (short)": (n.team && n.team.short) || (n.team && n.team.label) || "",
        "Bar colour": (n.familyDef && n.familyDef.label) || n.family || "",
        "Bar code": n.code || "",
        "Receives handoff": n.hasHandoff ? "Yes" : "",
        "Handoffs converging": n.handoffsIn ? n.handoffsIn.length : 0,
        "Cross-boundary handoff": n.crossOrg ? "Yes" : "",
        "Handoff from": (n.handoffsIn || []).map(l => l.fromTeam.label).join("; "),
        "Gate": n.isGate ? "Yes" : "",
        "Milestone": n.isMilestone ? "Yes" : "",
        "On critical path": n.critical ? "Yes" : "",
        ["Current (" + (inHoursTop(model) ? "hrs" : "days") + ")"]: r2(n.duration.current),
        "Optimal": r2(n.duration.optimal),
        "Removable": r2(n.duration.excess),
        "Scenario multiplier": f !== 1 ? f + "x" : ""
      };
    });
    out.push({
      name: "Chart View", headers: Object.keys(chartRows[0] || { Row: "" }), rows: chartRows,
      widths: [6, 10, 44, 20, 26, 9, 15, 18, 20, 30, 7, 10, 15, 13, 11, 11, 16]
    });

    /* TRACKING. Written only when someone has actually recorded a status, so
       an untracked export carries no sheet of 150 blank rows. Round-trips: the
       importer reads this sheet back by ID, and it is equally fine filled in
       by hand in Excel. */
    const trackedNodes = model.nodes.filter(n => n.act && n.act.status !== undefined);
    if (trackedNodes.length) {
      out.push({
        name: "Tracking", headers: VSM.schema.TRACKING.map(c => c.header), widths: [10, 44, 12, 12, 40, 12],
        rows: trackedNodes.map(n => {
          const a = n.act;
          return {
            "ID": a.id, "Task": n.name,
            "Status": txt(a.status),
            "Progress %": a.progress === undefined || a.progress === null ? "" : a.progress,
            "Note": txt(a.statusNote),
            "Updated": txt(a.statusDate)
          };
        })
      });
    }

    /* the tailoring tabs, written from whatever the scenario config holds */
    const cfg = opts.scenarioCfg;
    if (cfg && cfg.attributes) {
      out.push({
        name: "Toggles", headers: VSM.schema.TOGGLES.map(c => c.header), widths: [16, 22, 40, 10, 54, 20, 16, 52],
        rows: cfg.attributes.map(a => ({
          "Toggle ID": a.id, "Group": a.group || "", "Label": a.label,
          "Type": a.type === "boolean" ? "boolean" : a.type === "multi" ? "multi" : "choice",
          "Options": (a.options || []).map(o => o.value).join(";"),
          "Default": Array.isArray(a.default) ? a.default.join(";") : a.default === true ? "Yes" : a.default === false ? "No" : txt(a.default),
          "Implies": (a.implies || []).join(";"),
          "Help": a.help || ""
        }))
      });
      if ((cfg.presets || []).length) {
        const ids = cfg.attributes.map(a => a.id);
        out.push({
          name: "Profiles", headers: VSM.schema.PROFILE_FIXED.concat(ids), widths: [20, 34, 52].concat(ids.map(() => 15)),
          rows: cfg.presets.map(p => {
            const set = p.set || p.values || {};
            /* Null-prototype row, own-property test on `set`: toggle ids come
               from the workbook, and `in` walks the prototype chain, so a
               profile silent about a toggle named "constructor" was exported
               as if it declared one (and "__proto__" wrote nothing at all). */
            const row = Object.assign(Object.create(null), { "Profile ID": p.id, "Label": p.label, "Description": p.description || "" });
            ids.forEach(id => {
              if (!Object.prototype.hasOwnProperty.call(set, id)) { row[id] = ""; return; }     // silence is the point
              const v = set[id];
              row[id] = Array.isArray(v) ? v.join(";") : v === true ? "Yes" : v === false ? "No" : txt(v);
            });
            return row;
          })
        });
      }
      if (cfg.rulesSheet && Array.isArray(cfg.rulesSheet.headers) && cfg.rulesSheet.headers.length) {
        out.push({
          name: "Rules",
          headers: cfg.rulesSheet.headers,
          widths: cfg.rulesSheet.headers.map((h, i) => (i === 0 ? 18 : i === 1 ? 60 : 44)),
          rows: cfg.rulesSheet.rows.map(row => {
            const o = Object.create(null);
            cfg.rulesSheet.headers.forEach((hd, i) => { o[hd] = row[i] === undefined || row[i] === null ? "" : row[i]; });
            return o;
          })
        });
      }
      if (cfg.matrixSheet && Array.isArray(cfg.matrixSheet.headers) && cfg.matrixSheet.headers.length) {
        out.push({
          name: "Scenario Matrix",
          headers: cfg.matrixSheet.headers,
          widths: cfg.matrixSheet.headers.map((h, i) => (i === 0 ? 12 : i === 1 ? 44 : i === 2 ? 10 : 14)),
          rows: cfg.matrixSheet.rows.map(row => {
            const o = Object.create(null);
            cfg.matrixSheet.headers.forEach((hd, i) => { o[hd] = row[i] === undefined || row[i] === null ? "" : row[i]; });
            return o;
          })
        });
      }
    }

    /* a header note so nobody mistakes a scoped export for the master list */
    out.push({
      name: "Export Notes", headers: ["Field", "Value"], widths: [30, 90],
      rows: [
        { Field: "Source", Value: (model.process && model.process.title) || "" },
        { Field: "Exported", Value: new Date().toISOString().slice(0, 16).replace("T", " ") },
        { Field: "Scenario", Value: opts.scenarioSummary || "(not recorded)" },
        { Field: "Tasks in this export", Value: model.nodes.length },
        { Field: "Units", Value: (model.process && model.process.units) || "business days" },
        { Field: "Hours per day", Value: (model.process && model.process.hoursPerDay) || VSM.schema.HOURS_PER_DAY },
        { Field: "Critical path", Value: r2(model.metrics.currentElapsed / (/hour/i.test(String((model.process && model.process.units) || "")) ? ((model.process && model.process.hoursPerDay) || 8) : 1)) + " days" },
        { Field: "Columns R..X", Value: "Recomputed from this export's scenario, not copied from the source workbook." },
        { Field: "Scenario Matrix", Value: "Copied verbatim from the imported workbook. In-app rule edits are not yet written back into it." },
        { Field: "Caveat", Value: (model.process && model.process.caveat) || "Durations are estimates." }
      ]
    });
    return out;
  }

  function exportXLSX(model, opts, filename) {
    VSM.exporter.download(VSM.table.toXLSX(sheets(model, opts)), filename || "value-stream.xlsx");
  }
  function exportCSV(model, opts, filename) {
    const headers = VSM.schema.TASK.map(c => c.header);
    const csv = VSM.table.toCSV(headers, taskRows(model, opts));
    VSM.exporter.download(new Blob([csv], { type: "text/csv;charset=utf-8" }), filename || "task-list.csv");
  }

  VSM.exportWorkbook = { sheets, taskRows, edgeRows, summaryByPhase, exportXLSX, exportCSV };
  if (typeof module !== "undefined" && module.exports) module.exports = VSM.exportWorkbook;
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
