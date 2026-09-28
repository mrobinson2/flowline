# Phase 6: Admin Mode with Impact Preview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal (the spec's quality bar, verbatim §7):** a platform architect changes which tasks fire for SaaS adoption by editing one expression in admin mode, sees the impact across reference scenarios before saving, and never touches code or the spreadsheet.

**Architecture:** `js/admin.js` = pure, Node-tested core (`referencesTo`, `impact`) plus an overlay UI. Impact preview replays every saved run (Phase 5) and the current scenario against the candidate data and diffs each against its recorded result. Applying validates the whole candidate triple and persists through the app's existing override path (last-good-data contract); every applied change appends to `scenario.versions` (capped 100, carried through export automatically).

## Global Constraints
Roadmap constraints; the impact preview is MANDATORY in the apply flow (spec: "without it nobody will dare edit a rule"); retiring a referenced variable is blocked with the list of what blocks it; expression editing round-trips through `expr.print`/`expr.compile` with live errors; a candidate that fails validation never replaces live data.

## Review Focus
1. **referencesTo completeness:** finds references in activity `when`s, named rules, `derive` rules, `shownWhen`/`enabledWhen`, and preset `set`s — a retire that misses one leaves a ghost. Task 1 asserts one of each.
2. **Impact against a saved run uses the RUN's answers**, not the current sidebar state. Task 1: a rule change that only matters under the run's answers shows up in that run's row only.
3. **Apply-with-invalid-candidate:** compile passes but validation fails (e.g. rule referencing a retired attr elsewhere) → live data untouched, errors listed. Task 2 browser check.

### Task 1: `js/admin.js` core + regression group
- `referencesTo(data, attrId) -> [{ kind: "activity"|"rule"|"derive"|"shownWhen"|"enabledWhen"|"preset", id, label? }]` (rule-attr walker shared style with validate.js, named-rule refs expanded by name only — a rule referencing R_X does not reference X's attrs for retire purposes; the named rule itself carries them).
- `impact(data, candidate, runs) -> [{ runId, name, added: [ids], removed: [ids], before, after }]` — for each run (plus a caller-supplied pseudo-run for "current"), rebuild with the CANDIDATE process/scenario and the run's answers+overrides, diff against the run's includedKeys.
- `pushVersion(scenario, entry)` — appends `{ ts, target, before, after }`, caps 100.
- Tests: references of one attr found in all six places on a synthetic data set; impact on the shipped data + a saved baseline run when the candidate's `drRequired` named rule becomes `false` reports the DR ids removed for that run; a candidate change irrelevant to a Tier-4 run reports empty for it (RF#2).

### Task 2: The overlay + apply flow + browser verification
- Entry button beside the process designer. Overlay tabs: **Variables** (list: id/label/type/section/derived; add via small form; up/down reorder; Retire → blocked modal listing `referencesTo` hits, else removes), **Rules** (named rules: expression text via `expr.print` with JSON fallback, textarea editing with live `expr.compile` feedback incl. column and did-you-mean, datalist autocomplete over ids; activities: search + per-activity `when` as expression, same editor).
- Apply flow (both tabs): build the candidate (deep clone + edit), `validate.run` it; on pass show the **impact table** (per saved run + current: +added/−removed counts, expandable ids); Apply → `pushVersion`, persist process+scenario override (read-back verified), swap live data, rebuild everything; Cancel discards.
- Browser: change `drRequired`'s expression to `FALSE` → impact shows the DR removals on the saved "paved baseline" run and none on a Tier-4 run → apply → chart drops DR chain → versions.length grew; retire `serviceTier` blocked, listing its referrers; a bad expression shows column + did-you-mean and cannot apply. Docs bullet + README line.

## Implementation notes (Task 2)
- **Impact baseline changed from the plan.** Diffing the candidate against each run's *recorded* result blamed every earlier applied change on the edit under review (browser check: after `drRequired := FALSE` was applied, an unrelated variable reorder still reported "−3 DR tasks" on the baseline run). `impact()` now diffs candidate replay against live-data replay, and flags `stale` runs whose live replay no longer matches their recording ("saved under older rules").
- Replays go through `rules.effective()` (moved out of app.js) so disabled/hidden answers are neutralized exactly as the chart does.
- The shipped named rules are keyed bare (`drRequired`), the grammar wants `R_`: `ruleToText`/`textToRule` alias them for the editor.
- The overlay is its own file, `js/admin-ui.js` (designer.js pattern), not app.js.
- **Workbook write-back (charter item, closes Phase 0 Task 2's caveat).** Export writes Task List AA–AF (Include Expression for `whenSource: "expression"` rows and for non-workbook data), the Rules sheet from live rules (phrase shims excluded via `scenario.phraseRules`), Toggles with Section/Shown When/Derived/Derivation, the matrix minus retired-variable columns, and a Versions sheet the importer reads back. The importer no longer mints a phrase switch for a row whose Include Expression compiles. Regression: fixture + admin edits → export → re-import is equivalent for every preset, and a second trip is a fixed point. Not carried: `enabledWhen`, enum derivations with ordered cases (Export Notes says so).
- **Versions carry `{ timestamp, author, target, before, after }`** (charter shape; `ts` renamed before release). Apply requires a name.
