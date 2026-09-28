# Phase 4: Explainability — Result Summary, Why Drawer, Assumptions Banner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every included AND excluded task answers "why?" in one click, citing the specific answers that decided it (spec §4.6). The excluded tab is the point: reviewers challenge absences far more often than presences, and "prove to me this isn't missing a control" is the question that decides whether the tool is trusted.

**Architecture:** `schedule.build` starts returning the excluded activities beside the included nodes; `VSM.derive.explain` (a thin export of the existing leaf-walk) says which answers satisfied or failed any rule; a slide-over drawer renders both partitions grouped Stage→Phase; a sidebar summary block opens it; a dismissible assumptions banner sits under the KPI strip. Per-task include/exclude **overrides** land here too (spec §4.6's "override control appears when CanOverride = Yes", evaluation-contract step 5): `build`'s 6th argument grows into `{ derived, tasks }` with the old flat shape still accepted, and `Governed` tasks refuse exclusion.

**Spec:** `flowline_full_extraction.md` §4.6, §3.4 step 5; roadmap Phase 4 charter. Also folds in the deferred minor "fallback copy for a defaulted derived enum" — it is §4.4 explainability work and belongs here.

## Global Constraints

Roadmap constraints, plus: the default map stays 39 nodes / 198 days; `build`'s existing 4/5/6-arg callers keep working unchanged (the flat overrides map still means derived overrides); excluded-task explanations must cite actual attribute values, never the rule text alone; tracking (`progress.js`) never reads task overrides — a forced-in task is scheduled work like any other.

## Review Focus

1. **Excluded + included partitions the register:** for any scenario, `excluded.length + nodes.length === activities.length` and the id sets are disjoint. Task 1 asserts it for three scenarios.
2. **A task override on a `Governed` task:** exclusion refused with a warning naming the task; inclusion-forcing allowed (governance gates can be added, not removed). Task 2.
3. **Legacy 6th-arg shape:** a flat `{ architectureLane: { value, reason } }` map still applies as derived overrides (Phase 2 saved states carry this shape). Task 2.
4. **A forced-in task whose predecessors are excluded** must arrive with bridged links, not an orphaned row. Task 2 asserts its preds resolve.
5. **explain() on a named-rule reference** expands through the table (an activity whose `when` is `"drRequired"` must explain in terms of `serviceTier`/`productionIncluded`, not the opaque rule name). Task 1.

### Task 1: The engine explains exclusions — `model.excluded` + `derive.explain`

**Files:** `js/schedule.js` (after the inclusion set), `js/derive.js` (export `explain`), regression group.

**Interfaces:**
- `model.excluded` = `[{ id, name, phase, stage, when }]` for every activity whose rule evaluated false (never for ones missing from the file). `stage` resolved via the phase→stage map when stages exist.
- `VSM.derive.explain(rule, scenario, named, attrDefs) -> [{ attr, label, value, valueLabel, satisfied }]` — the existing `because(..., wantSatisfied undefined)` path, exported; named-rule strings expand through the table.

**Test (RED first):** three scenarios over the shipped data assert the partition property (RF#1); `explain(d.scenario.rules.drRequired, {serviceTier:"Tier 4", productionIncluded:true}, rules, attrs)` returns a `serviceTier` leaf with `satisfied: false` and `valueLabel "Tier 4"` (RF#5); an excluded entry for `dr-design` under Tier 4 carries `when` usable by explain.

### Task 2: Per-task overrides in the engine, Governed enforcement

**Files:** `js/schedule.js` (`build` 6th arg + inclusion), regression group.

**Interfaces:** `build(process, taxonomy, scenario, named, attrDefs, ov)` where `ov` is either the legacy flat derived-override map or `{ derived: {...}, tasks: { [id]: true|false } }` (detected by the presence of a `derived` or `tasks` key whose value is an object of the right shape — concretely: treat as composite when `ov.derived` or `ov.tasks` is a plain object and no other key looks like an attribute override `{value}` entry; otherwise legacy). `tasks[id] = true` forces inclusion when the rule said no; `false` forces exclusion — unless `act.canOverride === "governed"`, which pushes a warning `"<id>: is a governed gate; it cannot be switched off"` and keeps it. Only activities carrying `canOverride` ("yes" or "governed") accept overrides at all; others warn `"<id>: does not allow overrides"`. Forced-in tasks flow through `effPreds` like any included task (RF#4). `model.taskOverrides` echoes what applied.

**Test:** shipped data + `{ tasks: { "dr-design": false } }` on defaults → dr-design gone (its `canOverride` will be set to `"yes"` for the DR trio and `"governed"` for `sec-attest`/`cab` in `data/process.data.js` in this task — the sample finally uses the Phase 1 field); `{ tasks: { "cab": false } }` → cab stays + warning; `{ tasks: { "vendor-risk": true } }` on defaults → vendor-risk present with resolved preds; legacy flat map still overrides the lane (RF#3).

### Task 3: The why drawer + sidebar summary

**Files:** `js/app.js` (drawer, summary block below derived chips), `index.html` (`#result-summary`, `#why-drawer` shells), `css/app.css`.

- Summary: `"N of M tasks · G gates · <elapsed> <units>"` + `[Why these tasks?]` button.
- Drawer: fixed right slide-over, header with Included(n)/Excluded(m) tabs + close; body grouped by Stage → Phase (fall back to phase-only); each row: name + owner short; expanding shows category, lead/cycle (when split exists), `triggerExplanation` or `rules.describe`, and the explain() leaves rendered as "answers that decided it" — satisfied ones on Included, failing ones leading on Excluded ("Excluded because Service tier = Tier 4"). Rows with `canOverride` get the override control (Include anyway / Exclude — writes `state.taskOverrides`, rebuild; Governed shows a lock note instead of Exclude).
- `state.taskOverrides` persisted like `state.overrides`; passed to build as the composite shape; drawer re-renders on rebuild while open.
- Defaulted-derived-enum copy (deferred minor): in `renderDerived`, when `because` is empty and not overridden, render "No rule matched; using the default." — one line.

Verification is browser-level in Task 5; the VM harness executes the builders (crash = existing groups fail).

### Task 4: Assumptions banner

**Files:** `js/app.js`, `index.html` (`#assumptions` strip under the metrics panel), `css/app.css`.

Items, only when present: tasks with `noEstimate` ("N task(s) have no time estimate — the schedule understates any scenario including them", naming up to 3); overridden derivations with their reasons; task overrides in force; `serviceTier === "tbd"` ("the tier-driven controls are provisional"). Dismiss hides until the item set changes (compare a JSON hash in memory, not persisted). Rendered from `model` in `rebuild()`.

### Task 5: Browser verification + docs

Serve on localhost; verify: summary reads "39 of 60 tasks · …" on defaults and updates on preset change; drawer opens, tabs count correctly, `dr-design` under Tier 4 sits in Excluded with "Service tier = Tier 4" leading its explanation; forcing it back in via the override control returns it to the chart with links; `cab` shows the governed lock; banner appears with tier tbd + an override, dismisses, returns when items change; both themes. Update `docs/UI-VIEWS.md`/`UI-TOOLS.md` (drawer + banner) and README (one paragraph in Scenario tailoring on "why" and overrides). Suites + bundle + commit.
