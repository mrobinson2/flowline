# Flowline 1.1 — from map to tracker

Design brief for the 1.1.0 release. Four improvements, chosen after reviewing
the v5 workbook specification (stages over phases, task tracking, executive
status view) against what the 1.0.3 code already does well.

The theme of the release: 1.0 answers *"how long does this process take and
where could time come out?"* 1.1 adds *"and where is THIS project, right now?"*
— same data, same chart, plus a status per activity and a view a CTO can read
in thirty seconds.

## 1. Project tracking (the data model)

Every activity may now carry:

| field | type | meaning |
|---|---|---|
| `status` | `todo` \| `doing` \| `done` \| `blocked` \| `skipped` | absent = `todo` |
| `progress` | number 0–100 | how far along a `doing` activity is; defaults to 50 |
| `statusNote` | string | why it is blocked / anything worth saying |
| `statusDate` | `YYYY-MM-DD` | when the status last changed (stamped by the UI) |

Design rules:

* **Tracking never changes the schedule.** The scheduler, the four analysis
  views and every 1.0 number are untouched by status. Status is a layer read
  by `js/progress.js` and drawn by the tracker view. A value stream map that
  re-planned itself when you ticked a box would be a different (and worse) tool.
* **Unknown status values are warnings, not errors** (same policy as an
  unknown phase): the row still renders, treated as `todo`, and the sidebar
  says so.
* `js/progress.js` is pure data-in/data-out and runs under Node, so the
  rollup arithmetic is tested from the command line like everything else.

Progress rollup (in `VSM.progress.compute(model)`):

* **Weighted % complete** = done current-duration / total current-duration of
  the tasks in the current scenario. Weighting by current duration means the
  tracker measures the plan you are actually executing. Count-based % is
  computed alongside because both get asked for in the same meeting.
* `skipped` leaves the denominator entirely — a task ruled out mid-project
  should not read as un-done work.
* **Remaining time** = the critical path recomputed with done/skipped at zero
  duration and `doing` at `current × (1 − progress)`. That is "the longest
  chain of unfinished work", which is the honest forecast this data can give.
  It is labelled as an estimate and carries the units module's human
  translation ("≈ 3.2 months").
* **Health** = `not-started` / `on-track` / `blocked` (any blocked task) /
  `complete`. No "at risk" state: without baseline dates the tool cannot know
  risk, and inventing it would be exactly the kind of confident nonsense the
  README promises not to produce.

## 2. Stages above phases (two-level rollup)

The v5 workbook groups its nineteen phases into five stages. The process data
now supports the same shape:

```js
"stages": [ { "id": "shape", "label": "Intake & Funding", "short": "Intake" } ],
"phases": [ { "id": "intake", "label": "Intake & Funding", "stage": "shape" } ]
```

* `stages` is optional. Without it, everything behaves exactly as 1.0.
* The tracker view segments by stage when stages exist, else by phase —
  five to six segments is what an executive can read at a glance; nineteen is
  what the Gantt is for.
* The importer accepts an optional `Stage` column on the Task List sheet and
  builds the stage list and phase→stage mapping from it.
* Validation: `stage` references must name a declared stage (warning, same
  policy as phase references).

## 3. The tracker view ("pizza tracker")

A fifth view button: **Tracker**. Not a fifth rendering mode of the Gantt — a
separate composition (`js/progress-render.js`) built for one purpose: a CTO
understands project state in under thirty seconds.

Layout, top to bottom:

1. **Headline**: big weighted %, health pill, "n of m activities done".
2. **The tracker bar**: one chevroned segment per stage (or phase). Done
   segments solid with a check, the active segment part-filled with a dot
   pulse, upcoming segments outlined, blocked segments flagged red. Never
   color alone: each segment carries its label, its own %, and done/total
   counts.
3. **Fact strip**: Now (in-progress activities + owners) · Blocked (with
   reasons) · Remaining (critical path of unfinished work, human units) ·
   Gates (passed / total).
4. **Footnote**: scenario summary + the estimate caveat.

Interactive mode fills the app width; presentation/export reuse the same
1920×1080 contract as the timeline, so PNG / SVG / clipboard export work
unchanged. All styling is SVG attributes, no CSS classes, per the renderer's
export rule. In the interactive tracker, clicking an activity chip opens the
same details panel as a timeline row.

Status entry lives in the details panel (status buttons + progress slider +
note), because that panel already owns inline editing, and edits persist
through the same validated `saveProcessOverride` path as duration edits. The
timeline gains a small status glyph on tracked rows (✓ done, ▶ doing,
✕ blocked, dimmed when done) so tracking state is visible in every view once
tracking is in use.

## 4. Process designer (stages / phases / sequencing in the UI)

A **Design** button opens an overlay editor with three tabs:

* **Stages** — add, rename, re-order, delete stages; set the short label.
* **Phases** — add, rename, re-order, delete phases; assign each phase to a
  stage. Deleting a phase that activities still reference requires choosing
  where those activities move (nothing is orphaned silently).
* **Sequence** — the activity list grouped by phase: move rows up/down
  (row order is chart order), move an activity to a different phase, and a
  one-click "sort rows to match phase order" for a file whose rows have
  drifted out of band order.

Every change is validated with `VSM.validate.run` against a working copy and
applied only on **Apply changes** — the same last-good-data contract as
imports: a half-finished edit can never blank the projector. Edits persist via
the existing override/linked-folder plumbing and land in every export.

## 5. Spreadsheet round-trip made easier

* **Paste from Excel.** Copy rows in Excel or Google Sheets, click once on
  the page, paste. Tab-separated clipboard text with a header row is parsed
  with the same pipeline as a dropped file, preview included. This is the
  single largest friction cut for the "change three numbers in a meeting"
  case: no export, no save-as, no file picker.
* **A real import preview** replaces the `confirm()` wall of text: a modal
  listing what will change, the warnings, and Apply / Cancel. (Headless hosts
  without `document.body` fall back to `confirm`, which keeps the Node VM
  tests running the real handlers.)
* **Export menu gains the simple formats**: the editable Activities workbook
  (.xlsx with Activities / Teams / Phases / Columns sheets) and its CSV — the
  format `Import` accepts back directly — alongside the existing Task List
  format. Plus a **starter template** for starting from scratch.
* **Status round-trips.** The Activities sheet gains `status`, `progress`,
  `statusNote`, `statusDate` columns; the Task List export gains a `Tracking`
  sheet; the importer reads either back. Track in the app, export, and the
  spreadsheet answers "what's our status" without the app open — or fill
  status in Excel and import it.

## What deliberately did not change

The scheduler, rules engine, validation contract, the four analysis views,
presentation composition, and the Task List A..Y column contract are
untouched. The tracker is additive; every 1.0 file still loads; a process
with no status data renders 1.0-identically everywhere except one extra view
button.
