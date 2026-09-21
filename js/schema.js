/* ============================================================================
   SCHEMA  - the one place the workbook's shape is declared.
   ----------------------------------------------------------------------------
   Everything that knows what a column is called lives here. The importer, the
   exporter and the validator all read this table, so when the workbook gains a
   column or a header is reworded, this file is the only edit.

   Three things are declared:
     TASK          the Task List sheet, column by column
     EDGES         the Edges sheet
     ASSUMPTIONS   the Assumptions sheet
   plus the picklists and the two mapping tables that turn the workbook's
   vocabulary (Lean step types, DOWNTIME wastes) into this app's taxonomy.

   Header matching is deliberately forgiving: headers are compared with
   punctuation, case and spacing removed, so   Interaction Mode ("Team
   Topologies")   matches   Interaction Mode (Team Topologies)   and
   Interaction mode.  Anything genuinely different goes in `aliases`.

   CONFIRMED / UNCONFIRMED
   Columns carry a `confirmed` flag. Confirmed ones were read off Mike's
   screenshots. Unconfirmed ones are this file's best guess and are listed by
   VSM.schema.unconfirmed() so the app can say out loud what it is assuming
   rather than failing silently on a real workbook.
   ========================================================================== */
(function (root) {
  const VSM = root.VSM = root.VSM || {};

  const norm = s => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, "");

  /* ------------------------------------------------------------------ picklists
     `map` turns a workbook value into this app's internal id. Values not in a
     picklist are reported by the importer, never silently dropped. */

  const STEP_TYPE = {
    label: "Step Type (Lean)",
    values: [
      { value: "Value-Add", id: "value", label: "Value-Add" },
      { value: "Business Non-Value-Add (Type 1 Muda)", id: "bnva", label: "Business non-value-add", aliases: ["Type 1 Muda", "BNVA", "Business Non Value Add"] },
      { value: "Waste (Type 2 Muda)", id: "waste", label: "Waste", aliases: ["Type 2 Muda", "NVA", "Non-Value-Add"] },
      { value: "Approval Gate", id: "gate", label: "Approval gate", aliases: ["Gate", "Approval"] },
      { value: "Handoff", id: "handoff", label: "Handoff" },
      { value: "Rework Loop", id: "rework", label: "Rework loop", aliases: ["Rework"] },
      { value: "Milestone", id: "milestone", label: "Milestone" }
    ]
  };

  /* The eight wastes. "-" is a legitimate value meaning none, not a blank. */
  const DOWNTIME = {
    label: "Waste Category (DOWNTIME)",
    values: [
      { value: "Defects", id: "defects" },
      { value: "Overproduction", id: "overproduction" },
      { value: "Waiting", id: "waiting" },
      { value: "Non-Utilized Talent", id: "talent", aliases: ["Non Utilized Talent", "Non-Utilised Talent", "Underutilized Talent"] },
      { value: "Transportation", id: "transportation" },
      { value: "Inventory", id: "inventory" },
      { value: "Motion", id: "motion" },
      { value: "Extra-Processing", id: "extraprocessing", aliases: ["Extra Processing", "Overprocessing", "Over-Processing"] },
      { value: "-", id: null, label: "none", aliases: ["", "N/A", "None"] }
    ]
  };

  const TT_TYPE = {
    label: "Team Topologies Type",
    values: [
      { value: "Stream-Aligned", id: "stream", aliases: ["Stream Aligned"] },
      { value: "Platform", id: "platform" },
      { value: "Enabling", id: "enabling" },
      { value: "Complicated-Subsystem", id: "subsystem", aliases: ["Complicated Subsystem"] },
      { value: "Governance Function (not a TT team)", id: "governance", aliases: ["Governance Function", "Governance"] }
    ]
  };

  const INTERACTION = {
    label: "Interaction Mode",
    values: [
      { value: "Collaboration", id: "collaboration" },
      { value: "X-as-a-Service", id: "xaas", aliases: ["X as a Service", "XaaS"] },
      { value: "Facilitating", id: "facilitating" },
      { value: "Handoff (TT anti-pattern)", id: "handoff", aliases: ["Handoff", "Handoff (anti-pattern)"] }
    ]
  };

  /* UNCONFIRMED: read off the screenshots but very likely incomplete. Unknown
     values are reported and kept verbatim rather than rejected. */
  const LANE = {
    label: "Lane Applicability",
    open: true,
    values: [
      { value: "All lanes", id: "all" },
      { value: "Conditional", id: "conditional" },
      { value: "Standard + Custom", id: "standard-custom", aliases: ["Standard and Custom"] },
      { value: "Custom only", id: "custom", aliases: ["Custom"] }
    ]
  };

  const PICKLISTS = { stepType: STEP_TYPE, waste: DOWNTIME, ttType: TT_TYPE, interaction: INTERACTION, lane: LANE };

  /* ------------------------------------------------------------------ columns
     type:  text | number | idlist | enum | rule
     enum:  names a picklist above
     Column order here is the order written on export. */

  /* Task List columns A..Y, all confirmed against the workbook.
     A..O describe the step. P..Q are the Lean quality measures. R..X are a
     precomputed CPM schedule IN DAYS, which this app recomputes rather than
     trusts (see import.js) but reconciles against - two independent forward
     passes disagreeing is the cheapest bug detector either of us has. */
  const TASK = [
    { key: "id",          header: "ID",                                 type: "text",   required: true,  confirmed: true },                                   // A
    /* NOT required: js/import.js treats a phase as optional everywhere (an
       activity without one simply sits under no band), but marking it required
       here made readSheet abandon the whole sheet, so a Task List with no
       Phase column imported nothing and reported "no data rows" on a sheet
       full of rows. */
    { key: "phase",       header: "Phase",                              type: "text",   confirmed: true },                                                    // B
    { key: "name",        header: "Task",                               type: "text",   required: true,  confirmed: true, aliases: ["Task Name", "Activity"] }, // C
    { key: "team",        header: "Assigned Team",                      type: "text",   confirmed: true, aliases: ["Team", "Owner"] },                        // D
    { key: "ttType",      header: "Team Topologies Type",               type: "enum",   enum: "ttType", confirmed: true },                                     // E
    { key: "interaction", header: "Interaction Mode (\"Team Topologies\")", type: "enum", enum: "interaction", confirmed: true, aliases: ["Interaction Mode"] }, // F
    { key: "preds",       header: "Predecessor IDs",                    type: "idlist", confirmed: true, aliases: ["Predecessors", "Predecessor ID"] },       // G
    { key: "stepType",    header: "Step Type (Lean)",                   type: "enum",   enum: "stepType", confirmed: true, aliases: ["Step Type"] },          // H
    { key: "waste",       header: "Waste Category (DOWNTIME)",          type: "enum",   enum: "waste", confirmed: true, aliases: ["Waste Category", "DOWNTIME"] }, // I
    { key: "lane",        header: "Lane Applicability",                 type: "enum",   enum: "lane", confirmed: true },                                       // J
    { key: "appliesWhen", header: "Applies When",                       type: "rule",   confirmed: true, aliases: ["Applies When (condition)", "Condition"] }, // K
    { key: "leadCur",     header: "Current Lead Time (hrs)",            type: "number", confirmed: true, aliases: ["Current Lead Time"] },                    // L
    { key: "cycleCur",    header: "Current Cycle Time (hrs)",           type: "number", confirmed: true, aliases: ["Current Cycle Time"] },                   // M
    { key: "leadOpt",     header: "Optimized Lead Time (hrs)",          type: "number", confirmed: true, aliases: ["Optimised Lead Time (hrs)", "Optimized Lead Time"] },   // N
    { key: "cycleOpt",    header: "Optimized Cycle Time (hrs)",         type: "number", confirmed: true, aliases: ["Optimised Cycle Time (hrs)", "Optimized Cycle Time"] }, // O
    { key: "pctCA",       header: "%C&A",                               type: "number", confirmed: true, optional: true,
      aliases: ["% C&A", "Percent Complete and Accurate", "%C and A", "Complete & Accurate", "Percent C&A"] },                                                 // P
    { key: "flowEff",     header: "Flow Efficiency",                    type: "number", confirmed: true, optional: true,
      aliases: ["Flow Efficiency %", "Flow Eff"] },                                                                                                           // Q
    { key: "durationDays", header: "Duration (days)",                   type: "number", confirmed: true, optional: true, aliases: ["Duration"] },             // R
    { key: "esDay",       header: "Earliest Start (day)",               type: "number", confirmed: true, optional: true, aliases: ["Earliest Start", "ES"] },  // S
    { key: "efDay",       header: "Earliest Finish (day)",              type: "number", confirmed: true, optional: true, aliases: ["Earliest Finish", "EF"] }, // T
    { key: "lsDay",       header: "Latest Start (day)",                 type: "number", confirmed: true, optional: true, aliases: ["Latest Start", "LS"] },    // U
    { key: "lfDay",       header: "Latest Finish (day)",                type: "number", confirmed: true, optional: true, aliases: ["Latest Finish", "LF"] },   // V
    { key: "slackDays",   header: "Slack (days)",                       type: "number", confirmed: true, optional: true, aliases: ["Slack", "Float"] },        // W
    { key: "criticalPath", header: "Critical Path",                     type: "text",   confirmed: true, optional: true, aliases: ["Critical", "On Critical Path"] }, // X
    { key: "notes",       header: "Notes",                              type: "text",   confirmed: true, optional: true, aliases: ["Comments", "Note"] }       // Y
  ];

  /* Edges sheet, confirmed. Note the column order: SUCCESSOR first, then
     predecessor. Reading it the other way round reverses every dependency in
     the graph, which produces a schedule that looks plausible and is backwards.
     "Zero-Slack Link" = BINDING marks the links that drive the end date. */
  const EDGES = [
    { key: "to",        header: "Successor ID",                type: "text",   required: true, confirmed: true, aliases: ["Successor", "To ID", "To"] },        // A
    { key: "from",      header: "Predecessor ID",              type: "text",   required: true, confirmed: true, aliases: ["Predecessor", "From ID", "From"] },  // B
    { key: "toName",    header: "Successor Task",              type: "text",   optional: true, confirmed: true },                                               // C
    { key: "fromName",  header: "Predecessor Task",            type: "text",   optional: true, confirmed: true },                                               // D
    { key: "predEF",    header: "Predecessor Earliest Finish", type: "number", optional: true, confirmed: true, aliases: ["Predecessor EF"] },                   // E
    { key: "succES",    header: "Successor Earliest Start",    type: "number", optional: true, confirmed: true, aliases: ["Successor ES"] },                     // F
    { key: "binding",   header: "Zero-Slack Link",             type: "text",   optional: true, confirmed: true, aliases: ["Zero Slack Link", "Binding"] }        // G
  ];

  /* UNCONFIRMED: assumed to be reduction factors keyed by Lean step type. */
  const ASSUMPTIONS = [
    { key: "stepType",   header: "Step Type (Lean)",            type: "enum", enum: "stepType", required: true, confirmed: false },
    { key: "leadFactor", header: "Lead Time Reduction Factor",  type: "number", confirmed: false, aliases: ["Lead Factor", "Lead Time Factor"] },
    { key: "cycleFactor", header: "Cycle Time Reduction Factor", type: "number", confirmed: false, aliases: ["Cycle Factor", "Cycle Time Factor"] }
  ];

  /* ------------------------------------------------- tailoring (three tabs)
     Together these are the tailoring policy: which governance and delivery
     steps apply to which kind of work, written down instead of decided in a
     meeting. The chart is a view of them.

     Toggles         the vocabulary of levers, one row per lever
     Profiles        named starting points; each DECLARES a subset of toggles
                     and stays silent on the rest, so a modifier the profile
                     does not mention survives a profile change
     Scenario Matrix the decision table: task down the side, lever across the
                     top, one cell saying what that lever does to that task */

  const TOGGLES = [
    { key: "id",      header: "Toggle ID", type: "text", required: true, confirmed: false, aliases: ["ID", "Key"] },
    { key: "group",   header: "Group",     type: "text", optional: true, confirmed: false, aliases: ["Category", "Section"] },
    { key: "label",   header: "Label",     type: "text", required: true, confirmed: false, aliases: ["Name", "Question"] },
    { key: "type",    header: "Type",      type: "text", optional: true, confirmed: false, aliases: ["Control", "Control Type"] },
    { key: "options", header: "Options",   type: "text", optional: true, confirmed: false, aliases: ["Values", "Choices"] },
    { key: "default", header: "Default",   type: "text", optional: true, confirmed: false, aliases: ["Default Value"] },
    { key: "implies", header: "Implies",   type: "text", optional: true, confirmed: false,
      aliases: ["Requires", "Turns On"] },
    { key: "help",    header: "Help",      type: "text", optional: true, confirmed: false, aliases: ["Notes", "Description"] }
  ];

  /* Profiles and the matrix have one column per toggle, so their headers are
     data rather than schema. Only the fixed leading columns are declared. */
  const PROFILE_FIXED = ["Profile ID", "Label", "Description"];
  const MATRIX_FIXED = ["Task ID", "Task", "Baseline"];

  /* A matrix column header names a condition:
       genAI                    the boolean toggle is on
       workType=Greenfield      the choice toggle equals that value
       tier=Tier 0|Tier 1       the choice toggle is any of those values
     Returns { id, values } or null. */
  function parseCondition(header) {
    const raw = String(header == null ? "" : header).trim();
    if (!raw) return null;
    const eq = raw.indexOf("=");
    if (eq < 0) return { id: raw, values: null };
    const id = raw.slice(0, eq).trim();
    const values = raw.slice(eq + 1).split("|").map(s => s.trim()).filter(Boolean);
    return id ? { id, values: values.length ? values : null } : null;
  }

  /* A matrix cell. blank = no opinion, R = required, N = not applicable,
     a number = required and this task takes that many times as long. */
  function parseCell(value) {
    const raw = String(value == null ? "" : value).trim();
    if (!raw) return { effect: "none" };
    const up = raw.toUpperCase();
    if (up === "N" || up === "NO" || up === "N/A" || up === "-" || up === "X") return { effect: "exclude" };
    if (up === "R" || up === "Y" || up === "YES" || up === "REQ" || up === "REQUIRED") return { effect: "require", factor: 1 };
    const n = Number(raw);
    if (isFinite(n) && n > 0) return { effect: "require", factor: n };
    return { effect: "unknown", raw };
  }

  const SHEETS = {
    tasks:       { name: "Task List",            aliases: ["Tasks", "Task Sheet", "Value Stream"], columns: TASK, required: true },
    edges:       { name: "Edges",                aliases: ["Dependencies", "Links"],               columns: EDGES },
    assumptions: { name: "Assumptions",          aliases: ["Assumption", "Factors"],               columns: ASSUMPTIONS },
    summaryPhase: { name: "Summary by Phase",    aliases: ["Summary", "Phase Summary"],            columns: null },
    summaryStep: { name: "Summary by Step Type", aliases: ["Step Type Summary", "Where the Time Goes"], columns: null },
    topologies:  { name: "Team Topologies View", aliases: ["Team Topologies", "Topologies"],       columns: null },
    scenarios:   { name: "Discovery Scenarios",  aliases: ["Scenarios"],                           columns: null },
    readme:      { name: "Read Me",              aliases: ["Instructions", "Notes"],   columns: null },
    toggles:     { name: "Toggles",              aliases: ["Levers", "Scenario Toggles", "Switches"], columns: TOGGLES },
    profiles:    { name: "Profiles",             aliases: ["Project Profiles", "Scenario Profiles"],  columns: null },
    matrix:      { name: "Scenario Matrix",      aliases: ["Tailoring Matrix", "Matrix", "Applicability Matrix"], columns: null }
  };

  /* The workbook's day is eight hours. Not assumed: every Earliest Finish on
     the Edges tab lands on an exact eighth of a day (4.63, 6.75, 10.25, 14.13),
     which only happens if one hour is 0.125 of a day. Duration (days) on the
     Task List is (Current Lead + Current Cycle) / 8. */
  const HOURS_PER_DAY = 8;

  /* --------------------------------------------------------------- lookups */

  /* Match a row of sheet headers to column keys. Returns
     { index: {key -> colIndex}, unknown: [header...], missing: [key...] } */
  function matchHeaders(headers, columns) {
    const want = new Map();
    columns.forEach(c => {
      want.set(norm(c.header), c.key);
      (c.aliases || []).forEach(a => { if (!want.has(norm(a))) want.set(norm(a), c.key); });
    });
    const index = {}, unknown = [];
    headers.forEach((h, i) => {
      const k = want.get(norm(h));
      if (k === undefined) { if (String(h || "").trim()) unknown.push(String(h).trim()); return; }
      if (index[k] === undefined) index[k] = i;          // first wins on duplicates
    });
    const missing = columns.filter(c => c.required && index[c.key] === undefined).map(c => c.key);
    return { index, unknown, missing };
  }

  /* Match a workbook value to a picklist entry. Returns the entry or null. */
  function matchValue(listName, raw) {
    const list = PICKLISTS[listName];
    if (!list) return null;
    const n = norm(raw);
    for (const v of list.values) {
      if (norm(v.value) === n) return v;
      if ((v.aliases || []).some(a => norm(a) === n)) return v;
    }
    return null;
  }

  function sheetByName(name) {
    const n = norm(name);
    for (const key of Object.keys(SHEETS)) {
      const s = SHEETS[key];
      if (norm(s.name) === n || (s.aliases || []).some(a => norm(a) === n)) return key;
    }
    return null;
  }

  /* Everything this file is still guessing at, so the app can say so. */
  function unconfirmed() {
    const out = [];
    [["Task List", TASK], ["Edges", EDGES], ["Assumptions", ASSUMPTIONS]].forEach(([sheet, cols]) => {
      cols.filter(c => c.confirmed === false).forEach(c => out.push(sheet + " · " + c.header));
    });
    Object.keys(PICKLISTS).forEach(k => { if (PICKLISTS[k].open) out.push("picklist · " + PICKLISTS[k].label + " (may be incomplete)"); });
    return out;
  }

  VSM.schema = {
    TASK, EDGES, ASSUMPTIONS, TOGGLES, PROFILE_FIXED, MATRIX_FIXED,
    SHEETS, PICKLISTS, HOURS_PER_DAY,
    norm, matchHeaders, matchValue, sheetByName, unconfirmed, parseCondition, parseCell
  };
  if (typeof module !== "undefined" && module.exports) module.exports = VSM.schema;
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
