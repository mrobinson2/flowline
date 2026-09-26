# Phase 5: Scenario Runs — Save, Reload, Compare — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist every scenario worth keeping (spec §2.5 ScenarioRuns, §4.9): save/name/reload, side-by-side compare ("what does choosing SaaS over COTS actually save?"), JSON export/import — and the saved set becomes Phase 6's impact-preview reference scenarios.

**Architecture:** `js/runs.js`, pure record/diff plus a storage-backed list keyed `vsm.runs.v1` (localStorage, injectable for Node tests). A run snapshots the USER's answers (`scenario`), both override maps, the derived headline values, the result sets and totals. Reload = restore answers+overrides and rebuild; identity is asserted, not assumed.

## Global Constraints
Roadmap constraints; runs are data (never evaluated as rules); storage failures follow the app's read-back-verify pattern; the ring caps at 20 runs (oldest dropped, reported).

## Review Focus
1. **Reload identity:** record → reload → identical includedKeys and elapsed. Task 1 asserts.
2. **Diff correctness:** two preset scenarios diff to the right added/removed sets and deltas. Task 1.
3. **Storage that lies** (accepts writes, keeps nothing): save reports failure, never success. Task 1 with the harness's dropStorage pattern.

### Task 1: `js/runs.js` + regression group
`VSM.runs = { record(model, state, name), diff(a, b), list(), save(run), remove(runId), storageKey }`.
- `record` -> `{ runId ("r-" + ts + rand), name, createdUtc, answers (state.scenario copy), overrides, taskOverrides, derived (id -> value), includedKeys, excludedKeys, totals: { elapsed, gates, tasks }, criticalKeys }`.
- `diff(a,b)` -> `{ addedTasks, removedTasks, elapsedDelta, gatesDelta, changedAnswers: [{id, from, to}] }` (answers compared shallowly, arrays as sets).
- `save` appends, trims to 20, writes JSON, reads back (throws when storage kept nothing). `list` tolerates garbage (returns []).
- Node test: polyfill `global.localStorage` (Map-backed); record a run off the shipped model, mutate state, reload via answers+overrides -> rebuild -> assert includedKeys/elapsed identical (RF#1); diff adopt-saas vs deploy-cots asserts non-empty added/removed + numeric deltas (RF#2); a lying storage throws on save (RF#3).

### Task 2: UI + export round trip + browser verification
Sidebar "Saved scenarios" block under Result: name input + Save; per run: Load / Compare / ×. Compare = overlay table (task diff capped at 12 rows each way, deltas, changed answers). `exportJSON` bundle gains `runs` (current list); `loadJSONFile` restores `obj.runs` to storage when present (validated as an array). Browser: save two preset-derived runs, load one (chart matches), compare shows deltas, delete works, export/import round-trips the runs. Docs: one UI-TOOLS bullet.
