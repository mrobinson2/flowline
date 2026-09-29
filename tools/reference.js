/* ============================================================================
   REFERENCE GENERATOR - every built-in id, with its name and meaning.
   ----------------------------------------------------------------------------
   Writes docs/REFERENCE.md from the shipped data files, so the reference is
   the data and cannot drift from it: test/regressions.js regenerates it in
   memory and fails when the committed file differs.

       node tools/reference.js          # rewrite docs/REFERENCE.md

   Conditions and derivations are printed in the expression language the
   admin mode and the workbook use (rules as R_<id>).
   ========================================================================== */
const path = require("path");
const fs = require("fs");
const V = require(path.join(__dirname, "..", "js", "node.js"));

const OUT = path.join(__dirname, "..", "docs", "REFERENCE.md");

/* a table cell: one line, pipes escaped */
const cell = v => String(v === undefined || v === null ? "" : v).replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim();
const code = v => (v === "" || v === undefined || v === null ? "" : "`" + String(v).replace(/`/g, "'") + "`");
const table = (headers, rows) => ["| " + headers.join(" | ") + " |", "|" + headers.map(() => "---").join("|") + "|"]
  .concat(rows.map(r => "| " + r.map(cell).join(" | ") + " |")).join("\n");
const ruleText = r => (r === undefined ? "" : V.admin.ruleToText(r).text);

function build() {
  const d = V.loadData();
  const P = d.process, S = d.scenario, T = d.taxonomy;
  const acts = P.activities, attrs = S.attributes, rules = S.rules || {};
  const teams = P.teams || {}, phases = P.phases || [], stages = P.stages || [];
  const teamName = id => (teams[id] ? teams[id].label : id || "");
  const optLabel = (a, v) => { const o = (a.options || []).find(x => x.value === v); return o ? o.label : v; };
  const fmtValue = (a, v) => (a && a.type === "boolean" ? (v ? "Yes" : "No")
    : Array.isArray(v) ? (v.length ? v.map(x => optLabel(a, x)).join(", ") : "(none)") : optLabel(a || {}, v));
  const byId = new Map(attrs.map(a => [a.id, a]));
  const out = [];

  out.push("# Built-in reference");
  out.push("");
  out.push("Every id that ships with Flowline " + V.version.VERSION + ", with the name people see and what it means: the " +
    attrs.filter(a => !a.derived).length + " sidebar questions, " + attrs.filter(a => a.derived).length + " derived values, " +
    Object.keys(rules).length + " named rules, " + (S.presets || []).length + " presets, " + acts.length + " activities, " +
    phases.length + " phases, " + Object.keys(teams).length + " teams, and the taxonomy.");
  out.push("");
  out.push("**Generated from the data files** by `node tools/reference.js` - do not edit by hand; a regression fails when this file and the data disagree. " +
    "Conditions are written in the expression language used by admin mode and the workbook's Include Expression column (see [ADMIN-MODE.md](ADMIN-MODE.md)); a named rule is referenced as `R_<id>`.");
  out.push("");
  out.push("Contents: [Questions](#questions) · [Derived values](#derived-values) · [Named rules](#named-rules) · [Presets](#presets) · [Activities](#activities) · [Phases and stages](#phases-and-stages) · [Teams](#teams) · [Categories and waste types](#categories-and-waste-types)");
  out.push("");

  /* ---------------- questions, by section ---------------- */
  out.push("## Questions");
  out.push("");
  out.push("What the sidebar asks, in sidebar order. The **id** is what conditions, rules and the workbook's Toggles sheet use.");
  const sections = [...new Set(attrs.filter(a => !a.derived).map(a => a.section || 0))].sort((x, y) => x - y);
  sections.forEach(sec => {
    const qs = attrs.filter(a => !a.derived && (a.section || 0) === sec);
    out.push("");
    out.push("### " + (sec ? "Section " + sec : "Set by the preset (hidden)"));
    out.push("");
    out.push(table(["Id", "Question", "Type", "Default", "Shown / enabled when", "Help"], qs.map(a => [
      code(a.id), a.label + (a.group ? " *(" + a.group + ")*" : ""),
      a.type === "boolean" ? "yes / no" : a.type === "multi" ? "any of" : "one of",
      fmtValue(a, a.default),
      [a.shownWhen !== undefined ? "shown when " + code(ruleText(a.shownWhen)) : "", a.enabledWhen !== undefined ? "enabled when " + code(ruleText(a.enabledWhen)) : "",
        a.hidden ? "hidden" : "", (a.implies || []).length ? "implies " + a.implies.map(code).join(", ") : ""].filter(Boolean).join("; "),
      a.help || ""])));
    qs.filter(a => a.options && a.options.length).forEach(a => {
      out.push("");
      out.push("**" + code(a.id) + " options:** " + a.options.map(o => code(o.value) + (o.label && o.label !== o.value ? " " + o.label : "")).join(" · "));
    });
  });
  out.push("");

  /* ---------------- derived values ---------------- */
  out.push("## Derived values");
  out.push("");
  out.push("Values the engine works out from the answers instead of asking. Each can be overridden in the sidebar (some require a reason). A choice derives from ordered cases, first match wins.");
  out.push("");
  out.push(table(["Id", "Name", "Type", "Derived as", "Default"], attrs.filter(a => a.derived).map(a => [
    code(a.id), a.label, a.type === "boolean" ? "yes / no" : "one of" + (a.options ? " (" + a.options.map(o => o.value + " = " + o.label).join(", ") + ")" : ""),
    a.derive ? code(V.admin.derivationToText(a.derive).text) : a.derivation || "", fmtValue(a, a.default)])));
  out.push("");

  /* ---------------- named rules ---------------- */
  const refsTo = id => acts.filter(a => JSON.stringify([a.when, (a.multipliers || []).map(m => m.when)]).includes('"' + id + '"'));
  out.push("## Named rules");
  out.push("");
  out.push("Logic written once and referenced by name. In expressions a rule is `R_<id>`.");
  out.push("");
  out.push(table(["Rule", "Expression", "Used by activities"], Object.keys(rules).map(id => [
    code(V.admin.alias(id)), code(ruleText(rules[id])), refsTo(id).map(a => a.id).join(", ")])));
  out.push("");

  /* ---------------- presets ---------------- */
  out.push("## Presets");
  out.push("");
  out.push("The scenario dropdown. A preset sets only the answers it names; everything else keeps your choice.");
  out.push("");
  out.push(table(["Id", "Name", "Sets", "Description"], (S.presets || []).map(p => [
    code(p.id), p.label, Object.keys(p.set || {}).map(k => code(k) + " = " + fmtValue(byId.get(k), p.set[k])).join("; "), p.description || ""])));
  out.push("");

  /* ---------------- activities, by phase ---------------- */
  out.push("## Activities");
  out.push("");
  out.push("Every step in the register, by phase, in chart order. **Current / optimal** are business days. **Included when** is the condition that puts the step in a scenario (always = unconditional). **Can override**: `yes` may be forced in or out from the why drawer; `governed` may be added but never removed.");
  const phaseIds = phases.map(p => p.id).concat([...new Set(acts.map(a => a.phase))].filter(id => !phases.some(p => p.id === id)));
  phaseIds.forEach(pid => {
    const list = acts.filter(a => a.phase === pid);
    if (!list.length) return;
    const ph = phases.find(p => p.id === pid);
    out.push("");
    out.push("### " + (ph ? ph.label : pid || "(no phase)") + " " + code(pid));
    out.push("");
    out.push(table(["Id", "Name", "Owner", "Kind", "Current / optimal", "Predecessors", "Included when", "Description"], list.map(a => [
      code(a.id), a.name, teamName(a.owner),
      [(T.categories && T.categories[a.category] ? T.categories[a.category].label : a.category), a.waste ? (T.wasteTypes && T.wasteTypes[a.waste] ? T.wasteTypes[a.waste].label : a.waste) : "", a.canOverride ? "override: " + a.canOverride : "", a.milestone ? "milestone" : ""].filter(Boolean).join(" · "),
      a.duration.current + " / " + a.duration.optimal,
      (a.predecessors || []).map(code).join(", "),
      (a.when === undefined ? "always" : code(ruleText(a.when))) + ((a.multipliers || []).length ? "; " + a.multipliers.map(m => "×" + m.factor + " when " + code(ruleText(m.when)) + (m.note ? " (" + m.note + ")" : "")).join("; ") : ""),
      a.description || ""])));
  });
  out.push("");

  /* ---------------- phases, stages, teams, taxonomy ---------------- */
  out.push("## Phases and stages");
  out.push("");
  out.push(table(["Phase id", "Phase", "Short", "Stage"], phases.map(p => [code(p.id), p.label, p.short || "", p.stage ? (stages.find(s => s.id === p.stage) || { label: p.stage }).label + " " + code(p.stage) : ""])));
  if (stages.length) { out.push(""); out.push(table(["Stage id", "Stage", "Short"], stages.map(s => [code(s.id), s.label, s.short || ""]))); }
  out.push("");
  out.push("## Teams");
  out.push("");
  out.push("A change of owning team between a step and its predecessor is counted as a handoff; a change of organization (Team Topologies type) as a cross-org handoff.");
  out.push("");
  out.push(table(["Team id", "Team", "Short name", "Organization"], Object.keys(teams).map(id => [code(id), teams[id].label, teams[id].short || "", teams[id].org || ""])));
  out.push("");
  out.push("## Categories and waste types");
  out.push("");
  out.push(table(["Category id", "Category", "Family"], Object.keys(T.categories || {}).map(id => [code(id), T.categories[id].label, T.categories[id].family || ""])));
  out.push("");
  out.push(table(["Waste id", "Waste type", "Description"], Object.keys(T.wasteTypes || {}).map(id => [code(id), T.wasteTypes[id].label, T.wasteTypes[id].description || ""])));
  out.push("");
  return out.join("\n");
}

module.exports = { build, OUT };
if (require.main === module) {
  fs.writeFileSync(OUT, build());
  console.log("docs/REFERENCE.md written (" + fs.statSync(OUT).size + " bytes)");
}
