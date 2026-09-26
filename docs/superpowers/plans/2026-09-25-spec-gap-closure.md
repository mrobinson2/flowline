# Flowline Spec Gap Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gaps between the v5 data-model/UI specification (`/Volumes/Forge/07-Projects/flowline/flowline_full_extraction.md`, Part II) and the shipped Flowline 1.1.0 code, without rebuilding anything the spec says to keep.

**Architecture:** Everything compiles down to the existing JSON rule grammar (`VSM.rules.evaluate`) and the existing scheduler — the spec's text expression language becomes a small compiler (`js/expr.js`), the spec's derived variables become a data-driven derivation pass (`js/derive.js`) that runs before inclusion, and the spec's UI additions render from data the way the sidebar already does. No new frameworks, no build step, no library.

**Tech Stack:** Vanilla JS (IIFE modules on `VSM.*`), custom SVG renderer, Node 18+ test harness (`test/run-tests.js`, `test/regressions.js`), no dependencies.

**Spec:** `/Volumes/Forge/07-Projects/flowline/flowline_full_extraction.md` — Part II §§1–9 are the requirements; §8.8 supplies the sequencing this plan adapts. The gap analysis this plan closes is summarized below in "Gap inventory".

## Program shape — read this first

The spec covers multiple independent subsystems. Per the writing-plans scope rule, this document is:

1. **The program roadmap** — phase ordering, dependency graph, the load-bearing design decisions, and a scoped charter per phase with exact interfaces and acceptance criteria.
2. **The fully executable plan for Phase 0** (four bite-sized tasks, real code, real tests). Phase 0 ships on its own.

**Phases 1–6 each get their own plan document** (same format as Phase 0 here) written immediately before that phase starts, arguing from this roadmap's charter for it. Do not implement a charter directly from this file.

## Gap inventory (what this program closes)

| # | Spec section | Gap | Closed in |
|---|---|---|---|
| 1 | §7 constraint | Blank current-time cells import as silent 0 | Phase 0 |
| 2 | §2.3/§4.9 | Scenario Matrix does not round-trip on export | Phase 0 |
| 3 | §4.6 | No per-row hover "why included" | Phase 0 |
| 4 | §6 | Bridged edges not visually distinguished/annotated | Phase 0 |
| 5 | §3 | No text expression language (`IncludeExpression`) | Phase 1 |
| 6 | §2.2/§2.3 | No Rules sheet (Means/WhyItExists), no TriggerExplanation/CanOverride/RulePriority columns | Phase 1 |
| 7 | §5 | No derivation engine (lane, selection route, tier-driven controls), no sticky overrides with reasons | Phase 2 |
| 8 | §8.5 | No ServiceTier, no DataScope; `pilotPoc`/`privacyReview` anti-pattern toggles still shipped | Phase 2 |
| 9 | §4.1–4.5, §8 | Sidebar: no six sections, no completion dots, no ShownWhen, no derived chips, booleans are bare switches, 4 groups instead of 12 | Phase 3 |
| 10 | §4.6 | No result summary, no "why" drawer, **no excluded-task explanation**, no assumptions banner | Phase 4 |
| 11 | §2.5/§4.9 | No ScenarioRuns persistence, no save/name/reload, no scenario compare | Phase 5 |
| 12 | §4.7 | No admin mode (variable editor, rule editor, impact preview, versioning) | Phase 6 |
| 13 | §4.0/§4.8 | Gantt bands by phase not stage; no diagnostic mode; no FrictionCategory column | Phase 7 (optional) |

## Global Constraints

Every task in every phase implicitly includes these. Exact sources in parentheses.

- Vanilla JS, zero runtime dependencies, no build step; engine files stay DOM-free and load under Node 18+ via `js/node.js` (repo invariant).
- Expressions are parsed, never `eval`'d (spec §7).
- `AppliesWhen (display)` is never parsed when any structured rule source (IncludeExpression or Scenario Matrix) exists for the workbook. **Documented deviation from spec §7 ("must never be parsed"):** the phrase-to-switch fallback is retained for pure-legacy workbooks that carry no rule columns at all — otherwise they import nothing — and its use is reported as a warning naming this deviation.
- Task ids are stable identifiers; never renumbered, never reused (spec §7).
- Excluding a task must never orphan its successors (spec §7; already holds — keep the regression green).
- Tasks with missing time estimates are surfaced as warnings, never silently treated as zero (spec §7; Phase 0 Task 1).
- No hard-coded business logic in the application layer: if a behavior cannot be expressed in variables, rules, or expressions, raise it rather than code around it (spec §7).
- Last-good-data contract: an invalid load never blanks the chart; errors name the row and the fix (repo invariant).
- Every defect fix lands with a regression group in `test/regressions.js`, checked to FAIL before the fix, then to pass (repo convention; CHANGELOG documents this per release).
- Task List export keeps columns A..Y in their exact positions; new columns append after `Notes` (repo 1.1 convention, see `js/schema.js` stage column comment).
- Run before any commit that claims completion: `node test/run-tests.js && node test/regressions.js && node tools/bundle.js`.

## Review Focus

Failure modes the spec implies but no current test exercises, most likely to bite first. Each is pinned to the phase that owns the code; the per-phase plan must carry its test.

1. **Multi-select attribute compared with `=`** (e.g. `RuntimeModel = IaaS` where RuntimeModel is `multi`): a user authoring an IncludeExpression will write this constantly. Expected: validation error suggesting `INCLUDES`, never a silent always-false. → Phase 1 (`expr.compile` type check against attribute defs).
2. **Sticky override survives recompute:** user overrides derived `ArchitectureLane` to Fast with a reason, then changes `ServiceTier`. Expected: lane stays Fast, banner shows the override and its reason; the derivation never silently reverts it (spec §5 "sticky"). → Phase 2.
3. **Circular derivation** (`A` derives from `B`, `B` from `A`): expected loud validation error naming the cycle, mirroring the existing named-rule loop check (spec §3.4 "fail loudly"). → Phase 2 (`validate.js`).
4. **A task with both an IncludeExpression cell and a Scenario Matrix row that disagree:** expected deterministic precedence (expression wins) plus a warning naming the task — never a silent merge. → Phase 1 (importer precedence test).
5. **Saved browser state / old data files after the vocabulary change:** a `localStorage` scenario recorded against the 1.1 attribute ids (`pilotPoc`, `privacyReview`, `hosting=cloud`) loading into the 12-group vocabulary. Expected: valid choices kept, retired ids dropped, rest defaulted, no "undefined" in the summary line (the `applyLoadedData` contract, extended to startup state). → Phase 3.

## Load-bearing design decisions

These bind all phases. Changing one means revisiting this roadmap.

**D1 — One evaluator.** The spec's text grammar (§3.1) compiles to the *existing* JSON rule objects. `VSM.rules.evaluate/describe` stay the single evaluation path. Operator mapping is fixed as:

| Spec text | JSON rule |
|---|---|
| `X = v` | `{ X: v }` (bare `X` for booleans → `{ X: true }`) |
| `X != v` | `{ X: { ne: v } }` |
| `X IN [a,b]` | `{ X: { in: [a,b] } }` |
| `X NOT IN [a,b]` | `{ X: { notIn: [a,b] } }` |
| `X INCLUDES v` | `{ X: { includes: v } }` |
| `X INTERSECTS [a,b]` | `{ X: { includesAny: [a,b] } }` |
| `A AND B` | `{ all: [A, B] }` |
| `A OR B` | `{ any: [A, B] }` |
| `NOT A` | `{ not: A }` |
| `R_Name` | `"R_Name"` (named-rule string reference) |
| `TRUE` / `FALSE` | `true` / `false` |

**D2 — Three authoring formats, one precedence.** Per task: `IncludeExpression` cell (richest) > Scenario Matrix row > `Applies When` phrase (legacy fallback, warned). The Matrix stays supported — it already works, is tested, and is the easiest format for Excel authors; the expression column is the upgrade path, not a replacement.

**D3 — Variables sheet = extended Toggles sheet.** `js/schema.js` TOGGLES gains optional columns `Section` (1–6), `ShownWhen`, `Derived`, `Derivation`, `Required`, `OverrideRequiresReason`, with `Variables` as a sheet-name alias — old workbooks keep loading unchanged.

**D4 — Derivations are data.** An attribute row with `Derived = Yes` carries its logic; booleans as one expression, enums as ordered cases (`derive: { cases: [{ when, value }], default }` in JSON form; the workbook `Derivation` column holds the §5 text). `js/derive.js` computes them in declaration order, records provenance (the attribute values that fired), and respects sticky overrides. `applyImplications` stays for backward compatibility.

**D5 — The real register is a data drop-in.** The source organization's 153-task workbook is not in this repo and is not a code dependency (this repo ships as a template and its tests ban company-specific strings). Every phase is verified against `fixture/make_fixture.py` extended to emit the new sheets/columns. When the real v5 workbook arrives, it imports through the same path with zero code changes — that is the acceptance test of the whole program.

## Phase dependency graph and estimates

```
P0 ──► P1 ──► P2 ──► P3 ──► P5 ──► P6
                 └──► P4 ──┘
P7 optional, any time after P1
```

| Phase | Scope | Rough effort |
|---|---|---|
| 0 | Correctness + explainability quick wins | 0.5–1 day |
| 1 | Expression layer + schema extensions | 2–3 days |
| 2 | Derivation engine + tier/data groups | 3–4 days |
| 3 | Sidebar restructure (6 sections / 12 groups) | 2–3 days |
| 4 | Explainability (summary, why drawer, banner) | 2–3 days |
| 5 | Scenario runs, save, compare | 1–2 days |
| 6 | Admin mode with impact preview | 3–4 days |
| 7 | Optional leftovers | as desired |

Phase 1 is shippable alone (spec §8.8 says the same); each later phase is additive and independently releasable.

---

# Phase 0 — executable now

Four tasks. Low interdependence. Each ends green on `node test/run-tests.js && node test/regressions.js`.

### Task 1: Blank current-time cells warn instead of silently importing as zero

Spec §7: "Tasks with missing time estimates must be surfaced as warnings, never silently treated as zero." Today `js/import.js` warns only when a cell holds non-numeric *text*; a *blank* Current Lead + Current Cycle pair imports as 0 with no report (the exact hardware-task case the spec's open item 1 describes).

**Files:**
- Modify: `js/import.js` (activity loop, around the `const lc = num(r.leadCur) || 0` block; and `report.counts`)
- Test: `test/regressions.js` (new group)

**Interfaces:**
- Consumes: `VSM.import.fromSheets(sheets, opts)` → `{ process, taxonomy, scenario, report }` (existing).
- Produces: `report.counts.missingEstimates` (integer, count of tasks whose current lead AND cycle were both blank) and one warning per such task containing the task id and the phrase `no current time estimate`. Phase 4's assumptions banner reads `missingEstimates` and the per-activity flag `a.noEstimate === true`.

- [ ] **Step 1: Write the failing test** (append to `test/regressions.js` before the final summary lines, using the file's existing `test`/`assert` helpers)

```js
await test("1.2.0: blank current-time cells are surfaced, never silent zero", () => {
  const sheets = { "Task List": [
    ["ID", "Phase", "Task", "Predecessor IDs", "Current Lead Time (hrs)", "Current Cycle Time (hrs)"],
    ["1", "P1", "Estimated step", "", "8", "4"],
    ["2", "P1", "Hardware step, no estimate", "1", "", ""]
  ] };
  const r = V.import.fromSheets(sheets, {});
  assert.equal(r.report.errors.length, 0);
  assert.ok(r.report.warnings.some(w => w.startsWith("2") && w.includes("no current time estimate")),
    "expected a warning naming task 2, got: " + JSON.stringify(r.report.warnings));
  assert.equal(r.report.counts.missingEstimates, 1);
  assert.equal(r.process.activities.find(a => a.id === "2").noEstimate, true);
  assert.equal(r.process.activities.find(a => a.id === "1").noEstimate, undefined);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `ONLY="silent zero" node test/regressions.js`
Expected: FAIL (no warning, `counts.missingEstimates` undefined).

- [ ] **Step 3: Implement in `js/import.js`**

In the activity loop, directly after the existing line
`if (num(r.leadCur) === null && txt(r.leadCur) !== "") report.warnings.push(...)`, add:

```js
      const noEstimate = num(r.leadCur) === null && num(r.cycleCur) === null
        && txt(r.leadCur) === "" && txt(r.cycleCur) === "";
      if (noEstimate) {
        missingEstimates++;
        report.warnings.push(id + ": no current time estimate; treated as 0, so any scenario including this task understates its lead time.");
      }
```

Declare the counter beside the existing totals accumulators (`let leadCur = 0, ...` line):

```js
    let missingEstimates = 0;
```

Set the flag on the activity where other optional fields are set (beside `if (waste) a.waste = waste;`):

```js
      if (noEstimate) a.noEstimate = true;
```

Add to `report.counts` (in the block that builds it):

```js
      missingEstimates,
```

And in `summarize(report)`, after the unmapped-values line:

```js
    if (c.missingEstimates) lines.push(c.missingEstimates + " task(s) have no current time estimate (treated as 0)");
```

- [ ] **Step 4: Run the test, verify it passes; run both full suites**

Run: `ONLY="silent zero" node test/regressions.js && node test/run-tests.js && node test/regressions.js`
Expected: all pass (the fixture has estimates on every row, so counts stay 0 there).

- [ ] **Step 5: Commit**

```bash
git add js/import.js test/regressions.js
git commit -m "Import: surface blank current-time cells instead of silently reading zero"
```

### Task 2: Scenario Matrix round-trips through export

The importer consumes the Scenario Matrix into per-activity `when` rules and drops the sheet; `js/export-workbook.js` writes Toggles and Profiles but not the Matrix, so one export/import cycle silently strips every task's tailoring. Retain the raw sheet on the scenario and write it back.

**Files:**
- Modify: `js/import.js` (`fromSheets`, the `if (toggles)` scenario-assembly branch)
- Modify: `js/export-workbook.js` (`sheets()`, after the Profiles block)
- Test: `test/regressions.js` (new group)

**Interfaces:**
- Produces: `scenario.matrixSheet = { headers: string[], rows: any[][] }` — the Scenario Matrix sheet verbatim (header row + data rows). Consumed by the exporter here and by Phase 6's admin rule editor (which becomes the component that keeps `matrixSheet` in sync with rule edits; until then, in-app rule edits do not rewrite the sheet and the Export Notes row added below says so).

- [ ] **Step 1: Write the failing test**

```js
await test("1.2.0: Scenario Matrix round-trips through the Task List export", async () => {
  const buf = fs.readFileSync(path.join(__dirname, "..", "fixture", "sample-value-stream.xlsx"));
  const r = await V.import.fromWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), {});
  assert.equal(r.report.errors.length, 0);
  assert.ok(r.scenario.matrixSheet, "importer did not retain the matrix sheet");
  assert.ok(r.scenario.matrixSheet.rows.length >= 100, "matrix rows missing");
  const model = V.schedule.build(r.process, r.taxonomy,
    V.rules.defaults(r.scenario.attributes), r.scenario.rules, r.scenario.attributes);
  const out = V.exportWorkbook.sheets(model, { scenarioCfg: r.scenario, scenarioSummary: "" });
  const m = out.find(s => s.name === "Scenario Matrix");
  assert.ok(m, "export writes no Scenario Matrix sheet");
  assert.equal(m.rows.length, r.scenario.matrixSheet.rows.length);
  assert.deepEqual(m.headers, r.scenario.matrixSheet.headers);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `ONLY="Matrix round-trips" node test/regressions.js`
Expected: FAIL at "importer did not retain the matrix sheet".

- [ ] **Step 3: Implement**

`js/import.js`, inside the `if (toggles) { ... }` scenario-assembly branch, after the `scenario = { attributes: ..., rules: ..., presets: ..., groups: ... }` object is built and before the full-scope preset push:

```js
      if (matrix && found.matrix) {
        scenario.matrixSheet = {
          headers: found.matrix.matrix[0].map(txt),
          rows: found.matrix.matrix.slice(1).filter(row => txt(row[0]) !== "")
        };
      }
```

`js/export-workbook.js`, after the Profiles `out.push` block (still inside `if (cfg && cfg.attributes)`):

```js
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
```

And add one row to the "Export Notes" sheet's `rows` array:

```js
        { Field: "Scenario Matrix", Value: "Copied verbatim from the imported workbook. In-app rule edits are not yet written back into it." },
```

- [ ] **Step 4: Verify pass, then check the validator tolerates the new key**

Run: `ONLY="Matrix round-trips" node test/regressions.js && node test/run-tests.js && node test/regressions.js`
Expected: all pass. If `validate.run` rejects the unknown `matrixSheet` key on the scenario (it should not — its checks enumerate known sections), the fixture-import groups will fail here; in that case whitelist the key where the scenario is walked and re-run.

- [ ] **Step 5: Commit**

```bash
git add js/import.js js/export-workbook.js test/regressions.js
git commit -m "Export: carry the Scenario Matrix sheet through the round trip"
```

### Task 3: Hover tooltip says why a row is included

Spec §4.6: "each row gains a small ⓘ affordance... Hover shows the one-line TriggerExplanation. This is the lowest-friction path to explainability and should be built before the full drawer." The details panel already shows the inclusion rule on click; the hover tooltip does not. Until Phase 1 imports `TriggerExplanation`, `VSM.rules.describe` is the explanation text (and remains the fallback after).

**Files:**
- Modify: `js/app.js` (`tooltipHTML`, the `rows` array)

**Interfaces:**
- Consumes: `VSM.rules.describe(cond, attrDefs, named)` (existing).
- Produces: tooltip row labelled `Included when`, shown only for conditional activities. Phase 1 upgrades the same row to prefer `a.triggerExplanation` when present — keep the label.

- [ ] **Step 1: Implement** (UI-only; the fake-DOM harness cannot hover, so this is browser-verified)

In `js/app.js` `tooltipHTML(n)`, after the `["Float", ...]` row push:

```js
    if (n.act.when !== undefined) {
      rows.push(["Included when", esc(n.act.triggerExplanation
        || VSM.rules.describe(n.act.when, data.scenario.attributes, namedRules()))]);
    }
```

- [ ] **Step 2: Verify in the browser**

Run: `open index.html`. Hover `Vendor RFP & evaluation` → tooltip shows `Included when: newVendor (New vendor involved = on)`. Hover `Submit intake request` (unconditional) → no `Included when` row. Toggle dark/light; row renders in both.

- [ ] **Step 3: Run suites (no engine change, but the VM harness executes `tooltipHTML` paths on selection), rebuild bundle**

Run: `node test/run-tests.js && node test/regressions.js && node tools/bundle.js`
Expected: all pass, bundle written.

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "Tooltip: show the inclusion rule on hover, ahead of the full why-drawer"
```

### Task 4: Bridged dependency links are marked and annotated

Spec §6: "Bridged edges should be visually distinguished in the graph view and annotated 'bridged through *task name* (excluded)'. Reviewers need to see that a dependency was preserved rather than dropped." The scheduler already bridges; nothing marks the links.

**Files:**
- Modify: `js/schedule.js` (step 8, link construction)
- Modify: `js/render.js` (dependency-links block, lines ~245–259)
- Test: `test/regressions.js` (new group)

**Interfaces:**
- Consumes: `predMap` (declared predecessors incl. folded successors), `includedIds`, `byId` — all in scope at step 8.
- Produces: each link gains `bridged: boolean` and, when bridged, `via: string[]` (the *declared* predecessors of the target that were excluded — the first hop of the bridge; a deeper chain lists its entry point, which is the honest approximation without carrying full paths). Phase 4's drawer reuses `via`.

- [ ] **Step 1: Write the failing test**

```js
await test("1.2.0: links across an excluded step carry bridged + via", () => {
  const data = dataset([
    task("a"),
    task("b", { predecessors: ["a"], when: false }),
    task("c", { predecessors: ["b"] })
  ]);
  const model = build(data);
  const bridge = model.links.find(l => l.from === "a" && l.to === "c");
  assert.ok(bridge, "a->c bridge missing");
  assert.equal(bridge.bridged, true);
  assert.deepEqual(bridge.via, ["b"]);
  const plain = build(dataset([task("a"), task("b", { predecessors: ["a"] })]))
    .links.find(l => l.from === "a" && l.to === "b");
  assert.equal(plain.bridged, false);
  assert.equal(plain.via, undefined);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `ONLY="bridged" node test/regressions.js`
Expected: FAIL (`bridged` is `undefined`).

- [ ] **Step 3: Implement**

`js/schedule.js`, step 8, replace the link construction inside `n.preds.forEach(p => { ... })`:

```js
        const declared = predMap.get(n.id) || new Set();
        const bridged = !declared.has(p);
        const link = { from: p, to: n.id, handoff: isHandoff, explicit, crossOrg, bridged, fromTeam: pn.team, toTeam: n.team };
        if (bridged) {
          link.via = [...declared].filter(x => byId.has(x) && !includedIds.has(x));
        }
```

(The existing `const link = { from: p, to: n.id, handoff: isHandoff, explicit, crossOrg, fromTeam: pn.team, toTeam: n.team };` line is replaced by the block above; everything after — `links.push(link)` etc. — stays.)

`js/render.js`, in the dependency-links block, replace the `el("path", { ... }, g);` call:

```js
        const attrs = {
          d, fill: "none",
          stroke: lk.handoff ? handoffColor : T.link,
          "stroke-opacity": lk.handoff ? (dim ? 0.25 : 0.7) : (dim ? 0.4 : 1),
          "stroke-width": lk.handoff ? L.linkW + 0.3 : L.linkW
        };
        if (lk.bridged) attrs["stroke-dasharray"] = "4 3";
        const p = el("path", attrs, g);
        if (lk.bridged && lk.via && lk.via.length) {
          const names = lk.via.map(id => { const x = model.nodeById.get(id); return x ? x.name : id; });
          el("title", null, p).textContent = "Bridged through " + names.join(", ") + " (excluded by the scenario)";
        }
```

Note: `lk.via` holds *excluded* ids, so `model.nodeById.get(id)` returns undefined for them — fall back to the raw activity name via the process data instead:

```js
          const byActId = new Map((model.process.activities || []).map(a => [a.id, a.name || a.id]));
          const names = lk.via.map(id => byActId.get(id) || id);
```

Use this second form; delete the `nodeById` line from the block above.

- [ ] **Step 4: Verify pass, browser check, rebuild**

Run: `ONLY="bridged" node test/regressions.js && node test/run-tests.js && node test/regressions.js && node tools/bundle.js`
Expected: all pass. Browser: `open index.html`, pick the *Expand Capacity* preset (excludes design steps) — links skipping excluded work render dashed; native tooltip on the line names the excluded step. Confirm the SVG export keeps the dashes (inline attributes, so it will).

- [ ] **Step 5: Commit**

```bash
git add js/schedule.js js/render.js test/regressions.js
git commit -m "Chart: draw bridged dependencies dashed and name the excluded step they cross"
```

---

# Phase charters (each becomes its own plan doc before execution)

## Phase 1 — Expression layer and schema extensions (spec §2, §3)

**Files:** create `js/expr.js`; modify `js/schema.js`, `js/import.js`, `js/validate.js`, `js/node.js` (load order), `index.html` + `tools/bundle.js` script list, `fixture/make_fixture.py`; tests in `test/run-tests.js` + `test/regressions.js`.

**Interface contract:**

```js
VSM.expr.compile(text, attrDefs) -> { rule, refs: string[] }   // throws { message, column } on syntax error
VSM.expr.print(rule, attrDefs)   -> string                      // canonical text, for the Phase 6 editor
```

Grammar exactly spec §3.1; operator mapping exactly decision D1. `compile` type-checks operators against `attrDefs` (Review Focus #1: `=` on a `multi` attribute is an error suggesting `INCLUDES`).

**Schema additions (all optional, all aliased so old files load):** Task List gains `RuleID`, `IncludeExpression`, `TriggerExplanation`, `DefaultIncluded`, `CanOverride` (`Yes|Governed`), `RulePriority` after `Stage`; new `Rules` sheet (`RuleID`, `Expression`, `Means`, `WhyItExists`) → compiled into `scenario.rules`, prose kept on `scenario.ruleMeta[RuleID]`; `Toggles` sheet gains `Section`, `ShownWhen`, `Derived`, `Derivation`, `Required`, `OverrideRequiresReason`, `AuditRelevant` with sheet-name alias `Variables` (spec §2.1's full "columns to add" list).

**Importer precedence (decision D2):** per task, IncludeExpression > Matrix entry > Applies When phrase; both-present conflict warns naming the task (Review Focus #4). `TriggerExplanation` lands on the activity as `a.triggerExplanation` — the exact field Phase 0 Task 3's tooltip and the Phase 4 drawer read. `CanOverride`/`RulePriority`/`DefaultIncluded` are carried on the activity for Phases 2/4/6.

**Acceptance:** extended fixture imports clean; `R_ProdBound AND (ServiceTier IN [Tier0, Tier1, Tier2] OR InboundInternet = true)` compiles to `{ all: ["R_ProdBound", { any: [{ ServiceTier: { in: ["Tier0","Tier1","Tier2"] } }, { InboundInternet: true }] }] }`; unknown attribute in an expression is a validation error with did-you-mean; `expr.print(expr.compile(t).rule)` round-trips the worked examples in spec §3.3; full-scope reconcile against the fixture's CPM columns still agrees.

## Phase 2 — Derivation engine, ServiceTier, DataScope (spec §5, §8.5)

**Files:** create `js/derive.js`; modify `js/schedule.js` (call derive before inclusion), `js/validate.js` (cycle/order check — Review Focus #3), `js/app.js` (derived chips + override-with-reason modal), `data/scenario.data.js`, `fixture/make_fixture.py`.

**Interface contract:**

```js
VSM.derive.compute(attrDefs, scenario, named, overrides)
  -> { scenario,                                  // resolved values
       provenance: { [id]: [{ attr, label, value }] },  // what fired each derivation
       overridden: { [id]: { value, reason } } }        // sticky user overrides, echoed back
```

Attribute JSON forms: boolean `derive: { when: <rule> }`; enum `derive: { cases: [{ when: <rule>, value }], default }`. Declaration order is evaluation order; forward references are validation errors. Overrides are sticky across recomputes (Review Focus #2) and require a reason when `OverrideRequiresReason`.

**Data changes (the §8.5 dissolution):** retire `pilotPoc` → `lifecycleStage` (PoC / Pilot / New production service / Change / Capacity / Migration / Retirement) + `productionIncluded`; retire `privacyReview` → `dataScope` multi (the §7 list); add `serviceTier` (Tier 0–4, Not yet determined) + derived `drRequired`, `formalDrTestRequired`, `highAvailability`, `support24x7`, `performanceValidationRequired` per spec §5.9; add derived `ArchitectureLane` and `SelectionRoute` with the §5.6/§5.7 cases; rewrite sample activities' `when` rules onto the new vocabulary.

**Acceptance:** on the fixture, moving Tier 4→Tier 1 changes ≥10 tasks; the lane chip shows "Because: …" from provenance, never generic text; overriding the lane demands a reason, survives a tier change, and appears in warnings; `serviceTier = "Not yet determined"` produces a visible provisional-rules note.

## Phase 3 — Sidebar restructure: six sections, twelve groups (spec §4.1–4.5, §8)

**Files:** modify `js/app.js` (`buildScenarioControls` rewrite), `css/app.css`, `data/scenario.data.js`, `index.html`.

**Scope:** collapsible sections 1–6 with ●/◐/○ completion indicators mapped from `Section`; `ShownWhen` progressive disclosure — hidden values retained in state, excluded from evaluation via `effectiveScenario`, restored on re-show; booleans become Yes/No segmented controls (spec §4.3 explicitly bans bare switches); `single` renders segmented ≤6 options else dropdown; `multi` keeps chips, gains a collapsed count badge; the full §8 vocabulary lands in `data/scenario.data.js` (hosting 7 options retiring bare "Cloud", runtime multi, AI/GenAI split with the two GenAI dependents, sourcing 12, novelty, identity 11, integrations 12, network 12 with the inbound/outbound split, delivery + support models). Derived chips from Phase 2 render at the bottom of their section.

**Acceptance:** defaults-only produces a usable map (sections 3–6 pre-populated); Review Focus #5 regression — a 1.1-era saved state and a 1.1-era data file both load with valid choices kept, orphans dropped, no "undefined" in the summary; every control still round-trips through the Toggles/Variables sheet.

## Phase 4 — Explainability: result summary, why drawer, assumptions banner (spec §4.6)

**Files:** modify `js/schedule.js` (also return `excluded: [{ id, name, phase, stage, when }]`), `js/rules.js` (add `explain(cond, scenario, named) -> { pass, because: [{ attr, label, value, op, needed }] }` leaf trace), `js/app.js` (drawer + banner + sidebar summary), `css/app.css`.

**Scope:** sidebar block `N of M tasks included · G gates · D <units> [Why these tasks?]`; slide-over drawer with **Included** and **Excluded** tabs grouped Stage→Phase, each row expanding to team, category, lead/cycle, `TriggerExplanation`, and the specific answers from `rules.explain` ("Excluded because HostingTarget is SaaSVendorHosted"); assumptions banner beneath the KPI strip listing `noEstimate` tasks (Phase 0 Task 1), overridden derivations with reasons (Phase 2), `serviceTier` TBD, and any expression that failed to evaluate.

**Acceptance:** on the fixture, every included *and* excluded task answers "why" in one click, citing actual attribute values; the excluded tab count + included count equals the register size.

## Phase 5 — Scenario runs, save, compare (spec §2.5, §4.9)

**Files:** create `js/runs.js`; modify `js/app.js`, `js/export.js` (bundle includes runs).

**Interface contract:**

```js
VSM.runs.record(model, state)  -> run     // { runId, createdUtc, answers, overrides, derived,
                                          //   includedKeys, excludedKeys, totals, criticalKeys, name }
VSM.runs.list() / save(run) / load(runId) / remove(runId)   // localStorage-backed, capped ring
VSM.runs.diff(a, b) -> { addedTasks, removedTasks, elapsedDelta, gatesDelta, changedAnswers }
```

**Scope:** save/name/reload named scenarios; side-by-side compare panel rendering `diff` ("What does choosing SaaS over COTS actually save?"); JSON export/import of runs; these saved runs are the reference set Phase 6's impact preview replays.

**Acceptance:** reloading a run reproduces an identical model (asserted: same includedKeys, same elapsed); compare between two shipped presets shows a correct task diff and day delta in a Node test.

## Phase 6 — Admin mode with impact preview (spec §4.7)

**Files:** create `js/admin.js`; modify `js/app.js` (entry), `js/export-workbook.js` (write edited Variables/Rules/Matrix back — closes the Task 2 sync caveat), `css/app.css`.

**Scope:** overlay with three tabs — **Variables** (add/reorder/retire; retiring a variable referenced by any live rule/expression is blocked with the list of blocking tasks, built from `expr.compile(...).refs` plus JSON-rule walking), **Rules** (edit `IncludeExpression`/named rules as text via `expr.print`/`expr.compile`, live validation, autocomplete over variable + rule ids), **Impact preview** — before saving any rule change, replay every saved reference run (Phase 5) against the candidate rules and show which tasks change inclusion per run; **versioning** — every applied change appends `{ author, timestamp, target, before, after }` to `scenario.versions`, carried through export. `CanOverride = Governed` tasks refuse a normal-user exclusion override.

**Acceptance (the spec's quality bar, verbatim):** a platform architect changes which tasks fire for SaaS adoption by editing one expression in admin mode, sees the impact across reference scenarios before saving, and never touches code or the spreadsheet.

## Phase 7 — Optional alignment leftovers

Stage bands on the Gantt (band by stage when `stages` exist, display toggle keeps phase bands available); diagnostic mode (Section-0/GroupNum-0 rework variables revealed by a toggle, rework loops included in the timeline, planned vs observed side by side — pairs naturally with the tracker's status data); `FrictionCategory` as a third classification column alongside `StepTypeLean`/`WasteCategory` (spec §4.0 recommendation); binding (zero-slack) links drawn heavier. None block anything; schedule by appetite.

---

## Out of scope, permanently or until data arrives

- **The real source register** (153 tasks, 92 variables, 12 rules): not in this repo. Decision D5 makes it a drop-in; nothing in this program fabricates it.
- **Spec open items §9** (hardware time estimates, `R_ThirdPartyRisk` validation with Cybersecurity, Stage-3 grouping): owned by the source organization's stakeholders, not code.
- **Backstage plugin parity** with new features: the embed API keeps working (validated by existing tests); porting the new sidebar into the example plugin is a separate effort.
