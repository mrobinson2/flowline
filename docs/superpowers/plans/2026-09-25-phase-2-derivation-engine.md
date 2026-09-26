# Phase 2: Derivation Engine, ServiceTier, DataScope — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user describes the workload; the engine decides the work. Derived attributes (architecture lane, selection route, tier-driven controls, privacy trigger) are computed with provenance, shown as chips with "Because:", and overridable with a recorded reason — closing the spec's "single largest functional gap" (ServiceTier) and dissolving the two anti-pattern toggles (`pilotPoc`, `privacyReview`).

**Architecture:** New module `js/derive.js` resolves derived attributes in declaration order after `applyImplications`, inside `schedule.build`, so every caller (app, embed, Node tests) gets identical answers. Derivations are data on the attribute (`derive: { when }` for booleans, `derive: { cases: [{ when, value }], default }` for enums) evaluated with the existing `VSM.rules.evaluate`. Sticky user overrides ride in as a new optional `build` argument and come back on `model.derived` with provenance. The shipped sample vocabulary is rewritten so the **named rule ids stay the same** (`drRequired`, `privacyReview`, `deepSecurity`, `architectureReview`) while their bodies point at derived attributes — activities don't change, and the default map stays row-for-row identical.

**Tech Stack:** Vanilla JS IIFE on `VSM.derive`, Node-testable; UI chips in `js/app.js` + `css/app.css`.

**Spec:** `flowline_full_extraction.md` §5 (derivation order), §8.5 (the dissolution), §4.4 (derived-field UI contract); roadmap decisions D4. Phase 1's `derived`/`derivation`/`overrideRequiresReason` attribute fields are the authored carriers.

## Global Constraints

Roadmap constraints apply, plus:

- Derivations evaluate in attribute-declaration order; a derivation may reference authored attributes anywhere and derived attributes **declared above it only** — a forward reference is a validation error (this makes cycles impossible by construction; Review Focus #3).
- Provenance is never generic text: it lists the specific attribute values that satisfied the winning rule (spec §4.4 "Never generic text").
- An override is sticky across recomputes and never silently reverted (spec §5 "sticky"; Review Focus #2); overriding an attribute with `overrideRequiresReason` demands a non-empty reason.
- The shipped sample's **default scenario renders the identical activity set** before and after the vocabulary change — preservation is asserted, not hoped.
- `applyImplications` keeps working unchanged (old data files still load).

## Review Focus

1. **Sticky override vs recompute (RF#2):** override lane to Fast with a reason, then change `serviceTier` — lane stays Fast, provenance says overridden. Test in Task 1.
2. **Forward/circular derivation reference (RF#3):** derived A referencing derived B declared below it → validation error naming both. Test in Task 3.
3. **Override of a non-derived attribute:** `derive.compute` must ignore overrides naming authored attributes (the sidebar owns those) rather than silently forcing them. Test in Task 1.
4. **Derived attribute with `default` missing from `options`** or a case `value` not in options → validation error. Test in Task 3.
5. **Old saved state carrying retired ids** (`pilotPoc`, `privacyReview` in `localStorage`): `loadState` merges saved scenario over defaults — retired keys land in `state.scenario` harmlessly (rules no longer read them) and must not break `effectiveScenario` or evaluation. Pin with a regression in Task 4.

---

### Task 1: `js/derive.js` — ordered derivations, provenance, sticky overrides

**Files:** Create `js/derive.js`; wire `require("./derive.js")` in `js/node.js` after `expr.js`; `<script src="js/derive.js">` after `js/expr.js` in `index.html`. Test: new regression group.

**Interfaces (consumed by Tasks 2–5):**

```js
VSM.derive.compute(attrDefs, scenario, named, overrides)
// -> { scenario,                                   // copy with derived values resolved
//      derived: [id...],                           // derived attribute ids, in order
//      provenance: { [id]: { value, because: [{ attr, label, value, valueLabel }] } },
//      overridden: { [id]: { value, reason } } }   // echo of the applied overrides
```

- Boolean form: `a.derive = { when: <rule> }` → value = `rules.evaluate(when, resolved, named)`.
- Enum form: `a.derive = { cases: [{ when: <rule>, value }], default }` → first matching case wins; none → `default`.
- `because` = the leaf comparisons of the winning rule that are satisfied by the current values: walk the rule; for each `{attr: cond}` leaf that `rules.evaluate({attr: cond}, resolved, named)` passes, emit `{ attr, label, value: resolved[attr], valueLabel }` (labels via `attrDefs`; named-rule strings expand through the table first). For a boolean derivation that is FALSE, `because` lists the failing leaves of the same walk (`satisfied: false` on each) so the chip can say why not.
- `overrides` entries whose id is not a derived attribute are ignored and reported back under `overridden` with `ignored: true`.
- Each derivation evaluates against the scenario **as resolved so far** (earlier derived values visible), never mutating the input.

- [ ] **Step 1: Failing regression group** (in `test/regressions.js`, house style):

```js
  await test("1.3.0: derivation engine computes in order with provenance and sticky overrides", () => {
    const defs = [
      { id: "serviceTier", label: "Service tier", type: "enum", default: "Tier3",
        options: ["Tier0", "Tier1", "Tier2", "Tier3", "Tier4"].map(v => ({ value: v, label: v })) },
      { id: "productionIncluded", label: "Production deployment included", type: "boolean", default: true },
      { id: "drRequired", label: "DR required", type: "boolean", default: false, derived: true,
        derive: { when: { all: [{ productionIncluded: true }, { serviceTier: { in: ["Tier0", "Tier1", "Tier2", "Tier3"] } }] } } },
      { id: "lane", label: "Architecture route", type: "enum", default: "standard", derived: true,
        overrideRequiresReason: true,
        derive: { cases: [
          { when: { drRequired: true }, value: "standard" },
          { when: true, value: "fast" }
        ], default: "standard" } }
    ];
    const s = V.rules.defaults(defs);
    const r = V.derive.compute(defs, s, {}, null);
    assert.equal(r.scenario.drRequired, true);
    assert.equal(r.scenario.lane, "standard");            // sees the EARLIER derived value
    assert.deepEqual(r.derived, ["drRequired", "lane"]);
    const because = r.provenance.drRequired.because;
    assert.ok(because.some(b => b.attr === "serviceTier" && b.value === "Tier3"), JSON.stringify(because));
    assert.ok(because.some(b => b.attr === "productionIncluded" && b.value === true));
    /* boolean false explains itself too */
    const off = V.derive.compute(defs, Object.assign({}, s, { serviceTier: "Tier4" }), {}, null);
    assert.equal(off.scenario.drRequired, false);
    assert.ok(off.provenance.drRequired.because.some(b => b.attr === "serviceTier" && b.satisfied === false));
    /* sticky override survives an input change and reports itself */
    const ov = { lane: { value: "fast", reason: "pattern conforms, board approved" } };
    const r2 = V.derive.compute(defs, Object.assign({}, s, { serviceTier: "Tier0" }), {}, ov);
    assert.equal(r2.scenario.lane, "fast");
    assert.equal(r2.overridden.lane.reason, "pattern conforms, board approved");
    /* an override naming an authored attribute is ignored, not forced */
    const r3 = V.derive.compute(defs, s, {}, { serviceTier: { value: "Tier0", reason: "x" } });
    assert.equal(r3.scenario.serviceTier, "Tier3");
    assert.equal(r3.overridden.serviceTier.ignored, true);
  });
```

- [ ] **Step 2: RED** (`V.derive` undefined) → **Step 3: implement** (≈120 lines; leaf walk shared by true/false paths; `named` strings expand via the table before leaf collection, depth-capped like `rules.describe`) → **Step 4: GREEN + full suites** → **Step 5: commit** "Derive: ordered derived attributes with provenance and sticky overrides".

### Task 2: `schedule.build` runs derivations; the model carries them

**Files:** Modify `js/schedule.js` (top of `build`, beside `applyImplications`); regression group.

**Interfaces:** `build(process, taxonomy, scenario, named, attrDefs, overrides)` — new optional 6th arg. After implications: `const dv = attrDefs && VSM.derive ? VSM.derive.compute(attrDefs, scenario, named, overrides) : null; if (dv) scenario = dv.scenario;` and the returned model gains `derived: dv` (null when no attrDefs). Inclusion, overrides on durations, everything downstream unchanged.

- [ ] **Step 1: Failing test:** activities `[task("always"), task("dr-step", { when: { drRequired: true } })]` with the Task 1 `defs`: `build(..., defaults, {}, defs)` includes `dr-step` (derived true at Tier3); with `serviceTier: "Tier4"` it drops; with the Tier4 scenario **plus** `overrides = { drRequired: { value: true, reason: "regulator says so" } }` it returns; and `model.derived.provenance.drRequired` exists. Assert all four.
- [ ] **Step 2–5:** RED → implement → GREEN + suites → commit "Schedule: derived attributes resolve inside build, overrides ride along".

### Task 3: Validation of derivations

**Files:** Modify `js/validate.js` (attributes section); regression group.

**Rules:** for each attribute with `derive`: boolean form needs `when` (checked via `checkRule`); enum form needs non-empty `cases[]` (each `when` via `checkRule`, each `value` in `options`) and a `default` in `options`; a `derive` on a `multi` attribute is an error (nothing derives multis in the spec); any rule inside `derive` referencing a **derived attribute declared later** errors naming both ids (walk rules collecting attr keys; compare against declaration index). `overrideRequiresReason` on a non-derived attribute is a warning (meaningless but harmless).

- [ ] **Step 1: Failing test:** four bad scenarios asserted to error — forward reference (`A` derives from `B`, `B` declared after `A`, message contains both ids); case value not in options; default missing; `derive.when` naming a ghost attribute (existing `checkRule` catches — assert the message). One good scenario (Task 1 defs) validates clean.
- [ ] **Step 2–5:** RED → implement → GREEN + suites → commit "Validate: derivation shape, option membership, and forward references".

### Task 4: The shipped vocabulary — §8.5 dissolution, lane, route, tier

**Files:** Rewrite `data/scenario.data.js`; modify `test/run-tests.js` shipped-data section only if an assertion pins a retired id; regression for RF#5.

**The new attribute list, in declaration order** (this order is load-bearing — derivations reference upward only). Groups shown are sidebar groups; `Section` fields land in Phase 3.

| id | type | notes |
|---|---|---|
| `workType` | enum (hidden) | unchanged 7 options |
| `hosting` | enum | unchanged `cloud`/`on-prem` (Phase 3 expands) |
| `aiWorkload` | boolean | unchanged |
| `newVendor`, `hardwareProcurement` | boolean | unchanged |
| `lifecycleStage` | enum | `poc`, `pilot`, `new-prod` (default), `change`, `capacity-exp`, `migration`, `retirement` — group "Scope & Risk" |
| `productionIncluded` | boolean, default **true** | replaces the inverse of `pilotPoc`; help: "PoC and Pilot usually leave this off" |
| `dataScope` | multi | options: `no-business-data`, `internal-business`, `customer-personal`, `employee`, `confidential-restricted`, `payment-cardholder`, `sox`, `glba`, `residency`, `retention`, `ai-training` — **default `["customer-personal"]`** so the shipped demo's default map is unchanged (the old `privacyReview` toggle defaulted on); help says the sample assumes customer data |
| `serviceTier` | enum | `Tier 0`–`Tier 4`, `Not yet determined`; default **`Tier 3`** (keeps DR in the default map, ARB out — see below) |
| `approvedPatternExists` | boolean, default true | group "Is it standard?" |
| `patternConforms` | boolean, default true, `enabledWhen: { approvedPatternExists: true }` |
| `newTechnology`, `newEnterprisePlatform`, `architectureDeviation` | boolean, default false |
| `requirementsUnderstood` (default true), `vendorLandscapeKnown` (default true) | boolean | group "Sourcing" |
| `candidateProductCount` | enum `1` (default), `2-3`, `4-6`, `unknown` |
| `competitiveSourcing`, `unprovenTechnicalClaim` | boolean, default false |
| `integrations` | multi | unchanged 8 chips (Phase 3 splits) |
| — derived from here — | | all `derived: true` |
| `regulatedData` | boolean | `derive.when: { dataScope: { includesAny: ["customer-personal","employee","confidential-restricted","payment-cardholder","sox","glba"] } }` (spec §5.2) |
| `drRequired` | boolean | `{ all: [{ productionIncluded: true }, { serviceTier: { in: [Tier0..Tier3] } }] }` — §5.9 plus the production gate (the old toggle's semantics; a PoC gets no DR design) |
| `formalDrTestRequired` | boolean | tiers 0–2, same production gate |
| `highAvailability`, `support24x7` | boolean | tiers 0–1 |
| `performanceValidationRequired` | boolean | tiers 0–3 |
| `architectureLane` | enum `fast`/`standard`/`custom`, `overrideRequiresReason: true` | §5.6 cases: deviation OR newEnterprisePlatform OR (newTechnology AND tier∈[0,1]) → `custom`; approvedPatternExists AND patternConforms AND tier∈[3,4] → `fast`; default `standard` |
| `selectionRoute` | enum `none`/`eval`/`eval-poc`/`rfp`/`rfp-poc`/`rfi-rfp`/`rfi-rfp-poc`, `overrideRequiresReason: true` | §5.7 cases gated on `workType IN [saas, cots]`; the PoC suffix folds in as extra cases (`unprovenTechnicalClaim` variants listed before their plain twins) |
| `productEvaluationRequired`, `rfiRequired`, `rfpRequired`, `pocRequired` | boolean | §5.8, from `selectionRoute` membership |

**Named rules — same ids, new bodies** (activities untouched): `drRequired: { drRequired: true }` · `privacyReview: { regulatedData: true }` · `deepSecurity: { any: ["aiWorkload", "privacyReview", { integrations: { includes: "public-internet" } }] }` (unchanged text, new meaning via `privacyReview`) · `architectureReview: { architectureLane: { in: ["standard", "custom"] } }` · keep `cloud/onPrem/aiWorkload/newVendor/newHardware/netNew/acquired/existingApp/writesCode/notCapacity/newFootprint` verbatim.

**Presets gain the novelty facts** so the lane derives correctly per §1's mappings: `build-paved` sets `approvedPatternExists: true, patternConforms: true, architectureDeviation: false`; `build-custom` sets `approvedPatternExists: false, architectureDeviation: true`; `rehost`/`expand-capacity` set `approvedPatternExists: true, patternConforms: true`; `modernize` sets `approvedPatternExists: true, patternConforms: false`; `adopt-saas`/`deploy-cots` set `approvedPatternExists: false`.

**Default-map preservation argument (assert it, don't trust it):** defaults = paved profile facts → lane `fast` → `architectureReview` false → ARB trio out (as before, `paved` was excluded); `dataScope` default customer-personal → `privacyReview` true (as before); Tier 3 + production → `drRequired` true (as before, non-pilot). The old and new default models must have the **same node id set**.

- [ ] **Step 1: Failing tests first:**

```js
  await test("1.3.0: the dissolved vocabulary keeps the default map identical", () => {
    const d = V.loadData();   // new data under test
    const model = V.schedule.build(d.process, d.taxonomy,
      V.rules.defaults(d.scenario.attributes), d.scenario.rules, d.scenario.attributes);
    const ids = model.nodes.map(n => n.id).sort();
    assert.deepEqual(ids, OLD_DEFAULT_IDS);   // captured from the pre-change build, hard-coded here
    assert.ok(!d.scenario.attributes.some(a => a.id === "pilotPoc" || a.id === "privacyReview"));
    /* tier drives the DR chain */
    const t4 = V.schedule.build(d.process, d.taxonomy,
      Object.assign(V.rules.defaults(d.scenario.attributes), { serviceTier: "Tier 4" }),
      d.scenario.rules, d.scenario.attributes);
    const dropped = ids.filter(x => !t4.nodes.some(n => n.id === x));
    assert.ok(dropped.length >= 3 && dropped.every(x => /^dr-/.test(x) || x === "dr-test"), JSON.stringify(dropped));
    /* pattern conformance drives the lane, the lane drives the ARB chain */
    const std = V.schedule.build(d.process, d.taxonomy,
      Object.assign(V.rules.defaults(d.scenario.attributes), { patternConforms: false }),
      d.scenario.rules, d.scenario.attributes);
    ["arb", "arb-rework", "sec-design-recheck"].forEach(id =>
      assert.ok(std.nodes.some(n => n.id === id), id + " should appear on the standard lane"));
    assert.equal(std.derived.provenance.architectureLane.value, "standard");
  });
```

`OLD_DEFAULT_IDS`: capture **before** touching the data — `node -e "...build(shipped)...console.log(JSON.stringify(ids))"` — and paste the literal into the test. RF#5 regression in the same group: run `V.rules.defaults(newAttrs)` merged with `{ pilotPoc: true, privacyReview: false }` (a stale saved state) through `build` — no throw, retired keys inert.
- [ ] **Step 2: RED** (new test against old data fails on the `pilotPoc` absence assertion — write it, watch it fail, then rewrite the data file).
- [ ] **Step 3:** Rewrite `data/scenario.data.js` per the tables. Comment discipline: keep the file's teaching voice; the §8.5 dissolution note replaces the old pilot/privacy comments.
- [ ] **Step 4: GREEN + every suite + bundle.** If a shipped-data assertion elsewhere in `run-tests.js` pins a retired id, update it in this commit and say so in the message.
- [ ] **Step 5: Commit** "Data: the user describes the workload - tier, data scope, lifecycle, novelty; lane and controls derive".

### Task 5: Derived chips UI with override-with-reason

**Files:** Modify `js/app.js`, `index.html` (a `#derived-chips` block between the scenario controls and the waste legend), `css/app.css`. Browser verification via localhost (the Task 3/4 Phase-0 pattern).

**Behavior (spec §4.4):** for each `model.derived.derived` id: a muted chip with the attribute label + value label; expandable "Because:" list from `provenance[id].because` (each line `label = valueLabel`, failing leaves prefixed "not: " for false booleans); an "Override" affordance opening the shared overlay (`ask`-style) with a value control (Yes/No or the enum's options) and a reason field — required (submit disabled while empty) when `overrideRequiresReason`; applying writes `state.overrides[id] = { value, reason }`, persists via `saveState`, `rebuild()`. An overridden chip carries a persistent "overridden" badge, its reason as title text, and a "Clear" affordance deleting the override. `rebuild()` passes `state.overrides` to `build`; `renderDerived()` is called from `rebuild()` after the model exists. Overrides survive preset changes (they live outside `state.scenario`); `defaultState()` gains `overrides: {}`; `loadState` merges saved ones.

- [ ] **Step 1:** Implement (no fake-DOM test can hover/click through the overlay; the engine-side stickiness is already pinned by Task 1/2 tests — this task's verification is the browser).
- [ ] **Step 2: Browser-verify** on `http://127.0.0.1:<port>`: chips render for the nine derived attributes; lane chip says `fast` with "Because: An approved pattern exists = Yes, Pattern conforms = Yes, Service tier = Tier 3"; overriding lane to `custom` demands a reason, survives switching tier to Tier 0 and back, shows the badge, clears cleanly; `privacyReview`-driven rows drop when `dataScope` is emptied. Both themes.
- [ ] **Step 3:** Suites + bundle green (the VM harness runs `buildScenarioControls`/`rebuild` — a crash there fails existing groups).
- [ ] **Step 4: Commit** "Sidebar: derived chips with provenance and override-with-reason".

### Task 6: Docs touch-up

**Files:** `README.md` (Scenario tailoring section gains a paragraph on derived values + overrides), `docs/UI-TOOLS.md` sidebar bullet.

- [ ] One commit: "Docs: derived values and overrides". (Full doc rewrite waits for Phase 3's sidebar restructure.)
