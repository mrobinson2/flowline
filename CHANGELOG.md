# Flowline 1.1.0

Prepared 25 September 2026 from 1.0.3. 1.0 answers "how long does this process take and where could time come out?". 1.1 adds "and where is THIS project, right now?" — the same data and chart, plus a status per activity, an executive tracker view, structure editing in the app, and a spreadsheet round trip that includes pasting straight from Excel. The design brief is `docs/DESIGN-1.1.md`.

## Added

### Project tracking

1. **Every activity can carry a status** — `todo`, `doing`, `done`, `blocked` or `skipped` — plus a percent for in-progress work, a note, and the date the status last changed. Set it with one click in the details panel; it persists through the same validated override path as every other edit and lands in every export. Tracking never changes the schedule: the scheduler and the four analysis views do not read status, so ticking a box can never move a bar (a test holds the elapsed figure identical with and without statuses). `js/progress.js` is the rollup arithmetic, pure and Node-tested: percent complete weighted by current duration, counts, per-segment progress, and remaining time computed as the critical path of unfinished work — done and skipped at zero, `doing` at its unfinished share — so the forecast uses the same scheduling rules as the chart. A skipped task leaves the denominator: work ruled out mid-project is not un-done work.

2. **The Tracker view** (`js/progress-render.js`), a fifth view built for one purpose: a CTO understands project state in under thirty seconds. A headline percent with a health pill (in progress / blocked / complete), a segment-per-stage progress bar in the style of a delivery tracker — done segments solid with a check, the active one part-filled, blocked ones flagged red, never color alone — then four panels: what is in progress now and who owns it, what is blocked and why, what is ready to start, and the remaining critical path in human units with gates passed. Presentation mode and every PNG/SVG/clipboard export use a full 1920×1080 composition of the same view. Timeline rows also gain a status tick in the gutter and finished work steps back, so every view shows where the project is once tracking is in use.

3. **Stages above phases.** The process data can declare `stages` and roll each phase up into one (`data/process.data.js` shows the shipped example: four stages over six phases). The tracker segments by stage when stages exist — five or six segments is what an executive reads at a glance; nineteen is what the Gantt is for. The Task List export writes the rollup as a `Stage` column, placed after `Notes` so columns A..Y keep their exact positions for the source workbook's own tooling, and the importer reads a `Stage` column back into stages wherever it appears.

### Editing the structure in the app

4. **A process designer** (`js/designer.js`): stages, phases and row order edited in an overlay — add, rename, reorder and delete stages and phases, assign phases to stages, move activities between phases, reorder rows, and sort all rows into band order in one click. Every change happens on a working copy and applies only when the whole candidate validates, the same last-good-data contract imports honour; deleting a phase that still has activities moves them to the first remaining phase and says so, never orphans them silently.

### The spreadsheet round trip

5. **Paste from Excel.** Copy rows in Excel or Google Sheets, click the page, paste. Tab-separated clipboard text with a header row goes through the same pipeline and preview as a dropped file. Pasted rows **merge** — update and add, never remove — because the whole point of a paste is carrying a few rows out of a bigger sheet, and the first build's file semantics (the sheet is the complete list) would have deleted everything not pasted. A regression group holds that, checked to fail against the file-semantics routing before it was checked to pass.

6. **A real import preview** replaces the `confirm()` wall of text: what changes, the warnings, Apply / Cancel. Hosts without `document.body` (the Node test VM) fall back to `confirm`, so the tests keep running the real handlers.

7. **The editable formats are in the Export menu**: the Activities workbook and CSV — the format Import accepts straight back — and a starter template with three example rows showing every column, for starting a value stream from nothing. The Activities sheet gains `status` / `progress` / `statusnote` / `statusdate` columns, and the Task List export gains a `Tracking` sheet (written only when someone has recorded a status), which the importer reads back by task ID — so status set in the app survives a round trip through Excel, and status typed into Excel comes in with the import.

## Fixed

8. **Loading data with a different toggle vocabulary kept the old answers.** `applyLoadedData()` left `state.scenario` untouched, so after loading a folder or workbook whose scenario declares different attributes, the summary line read "undefined" and the rules evaluated against values that no longer exist. The state now keeps every choice that still applies, defaults the rest, drops the orphans, and clears a selected profile the new data does not declare.

9. **The source-tree scan walked into `.worktrees/`** and failed on checkouts carrying a git worktree; it now skips that directory like `.git` and `node_modules`.

Prepared 20 September 2026 from 1.0.2. Fixes seventeen findings from a review of 1.0.2, including two that 1.0.2 introduced while fixing something else. Nothing has been published remotely.

Two of these are hangs that any imported file can trigger, and they are the reason for the release. The rest are crashes, silent data loss in the importer, and the parts of three 1.0.2 fixes that only covered one of the paths they needed to.

## Fixed

### Hangs

1. **The quadratic parse came back, in the code that fixed it (high).** 1.0.2 taught the XML scanner to step over comments and CDATA sections. Both new functions asked `indexOf` for the next `<!--`, the next `<![CDATA[` and the next close tag on every comment, each time restarting from the cursor, and a search for a needle the part does not contain scans to the end of the part. A **1,120-byte** workbook carrying 60,000 empty comments took **20.6 seconds** to parse, against the 58 KB and 55 seconds of the bug 1.0.2 set out to remove. Caching each search and only re-running it once its answer fell behind the cursor is linear on paper and still ran quadratic in practice, so `findClose()` and `plain()` in `js/table.js` now walk the string one character at a time with a cursor that only moves forward, the way `attrs()` already did. The largest part the size limits allow (14.5 MB expanded, from a 22 KB file) now parses in 171 ms.

2. **One large number in one cell hung the chart (high).** `js/render.js` sized its gridline loop as `totalDays / tickSize` and stepped by one, and nothing validates an upper bound on a duration. A single activity reading `1e8` cost 2.6 seconds per render, `1e12` ran for hours and `1e15` ran the tab out of memory, on every rebuild rather than once. The loop now steps by the thinning factor and takes that factor from the pixel budget rather than from the tick spacing, so the work is bounded by the width of the plot: a 1200px chart never draws more than about 400 gridlines however long the timeline claims to be. `1e300` renders in 5 ms. `js/units.js` also refuses an `hoursPerDay` that is not a positive finite number, which was the other way to make the axis meaningless.

3. **A long label re-measured itself once per character (low).** `truncate()` dropped one character at a time and measured the whole string again each time. A 200,000-character activity name took 12 seconds. It is a binary search now, and the renderer clips any label to 512 characters before measuring, since nothing wider than the chart can be read.

### Crashes on data that validates

4. **The legend read a family the taxonomy need not define (medium).** `category` is optional on an activity, and `js/schedule.js` falls back to the family `value`, which a taxonomy is not obliged to have. `schedule.js` guards that with a default color; `drawLegend()` in `js/render.js` read `fams[f].optimal` straight through one line below a guarded lookup of the same thing. Presentation mode and every PNG and SVG export threw. It now falls back to the same neutral color.

5. **Panels read taxonomy sections that validation treats as optional (medium).** `validate.js` only checks `categories` and `wasteTypes` when they are present, so a taxonomy carrying `families` alone is valid data. The waste chips and the edit form called `Object.keys` on both without a default and threw out of the render. Both default now.

6. **A long excluded chain overflowed the stack (medium).** `effPreds()` in `js/schedule.js` recursed once per excluded link, so a scenario that switched off a run of about 3,000 consecutive steps threw `RangeError` out of `build()`. `validate.js` uses Kahn's algorithm over the same graph and says in a comment that it does so to avoid exactly this; the scheduler now walks it with an explicit stack. 100,000 links build in 311 ms, and a cycle among excluded activities is still reported. `rebuild()` in `js/app.js` also catches a scheduler throw now and reports it as a data error, rather than letting it escape into the startup handler and leave a blank page.

7. **An attribute id that is an `Object.prototype` member broke the sidebar (medium).** The 1.0.2 pollution fix covered `validate.js`, `schedule.js`, `analyze.js` and the importer's `unmapped` map. It missed `impliedBy` in `buildScenarioControls()`, a plain object keyed by attribute ids, and `validate.js`'s id rule allows `constructor`. The get-or-create found `Object.prototype.constructor`, which is truthy and has no `push()`, and the sidebar threw. Null-prototype now.

8. **Two more prototype-chain lookups (low).** `js/layout.js` picked a row height out of an object literal with a `|| 28` fallback that inherited members sail past, so `density: "constructor"` made every derived size `NaN`. `js/export-workbook.js` tested profile membership with `in`, which walks the chain, so a profile silent about a toggle named `constructor` exported as if it had declared one. Both use `hasOwnProperty` now.

9. **`__proto__` keys and absurd nesting are refused up front (low).** `JSON.parse` turns `"__proto__"` into a real own key, and the same key in a data file means one thing read as JSON and another loaded as a script, where it sets the prototype instead. `validate.js` now walks the three data objects once and refuses both that key and nesting past 200 levels, which is what `JSON.stringify` and `VSM.deepClone` overflow on. `js/rules.js` counts structural nesting towards its depth guard as well as named-rule indirection, so an embedding host cannot reach a stack overflow either.

### Importer

10. **A blank cell was read as zero (medium).** `Number("")` is `0` and `isFinite(0)` is true, so `num()` in `js/import.js` answered `0` for an empty cell and `null` only for text. Three fallbacks tested for `null` and so never fired: a blank Optimized column became an optimized time of zero rather than the current time (and the import summary told the reader their optimized state was 0 hours), a blank `%C&A` became a recorded 0% complete and accurate that a round trip wrote back out, and a workbook with no CPM columns at all got a full set of zeroed `source` figures that `reconcile()` then reported as a 100% disagreement.

11. **Phases and teams were silently dropped (medium).** `phaseById` and `teams` were plain objects guarded with `if (!map[id])`. `slug()` defangs `__proto__` but leaves `constructor` alone, so a phase or team named Constructor was never registered, counted or warned about, and `schedule.js` then handed back the `Object` constructor as the node's team. Every map in the importer keyed by workbook text is null-prototype now.

12. **The complete map was not complete (medium).** `fullScopeSet()` scored choice toggles on `c.values`, which `readMatrix()` never set, so both enum branches were dead code and the "Full scope (every step that could apply)" preset silently omitted every step reached only through a choice toggle. `readMatrix()` carries the values now. On the shipped fixture, full scope resolves to all 146 tasks and reconciles 146 of 146 against the workbook's own schedule columns.

13. **A half-filled matrix row made a task invisible (medium).** A Scenario Matrix row with no Baseline and no cells produced `when: false`, so the task never appeared under any combination of toggles, with nothing said about it. That is the one thing the importer's own header comment promises cannot happen. It is a warning now, naming the row and the task.

14. **Long condition phrases collided (medium).** `slug()` truncates at 48 characters, so two "Applies When" phrases differing only after that point produced duplicate scenario attribute ids, and the importer handed back a model that its own validator rejected. Ids are now allocated through a per-namespace slugger: the same text always gets the same id, different text never shares one.

15. **A Task List without a Phase column imported nothing (medium).** `phase` was marked required in `js/schema.js`, so `readSheet()` abandoned the sheet and the report said "The Task List sheet has no data rows" about a sheet full of rows. The importer treats a phase as optional everywhere else.

16. **Three scans that grew with the square of the input (low).** Toggle de-duplication scanned the whole accumulated list per row (64,000 rows took 13.2 seconds), the Edges pass did an `indexOf` over a task's predecessors per edge, and `reconcile()` used `Math.max(...ends)`, which throws past about 125,000 arguments and, because of finding 10, had an entry for every task. Sets, and a reduce.

### Finishing three 1.0.2 fixes

17. **Each covered one path and left the others.** The import validation fix (1.0.2 finding 5) was applied to `loadJSONFile` only: `saveProcessOverride`, which is what the spreadsheet import and inline editing both go through, still validated against whatever was live and persisted only the process, so with a folder linked it saved a process checked against a taxonomy nobody kept. It now validates the same shipped-backed triple `loadData()` will rebuild, and pins anything that did not come from the shipped files into the override so the saved set is self-consistent. The storage read-back guard (finding 4) was on one of the three `localStorage` write sites; all three go through one `writeOverride()` now, so a browser that accepts a write and keeps nothing can no longer produce a success message. The source-panel fix (finding 9) covered the linked-folder path but not startup: an import writes "loaded from a file" before `init()` runs, so when the recombined set was refused the panel went on claiming the new file was in use. `loadData()` re-describes the source on every refusal.

## Added

- 17 further regression groups, one per finding, in `test/regressions.js`, which now runs 59. Each was checked to fail against 1.0.2 before it was checked to pass against this release. They include timing assertions for the parser, the gridline loop and the label fitter, a fake DOM so the renderer and the sidebar panels can be exercised from Node, and a storage stub that accepts writes and keeps nothing.
- `ONLY=<substring> node test/regressions.js` runs just the matching groups.

## Validation

Executed with Node v22.22.2:

```text
node test/run-tests.js       151 passed, 0 failed
node test/regressions.js     59 regression groups passed, 0 failed
node tools/bundle.js         dist/flowline.html written (358 KB)
```

`index.html` and `dist/flowline.html` were both driven in Chromium: 39 bars render, the details panel opens, the tooltip path runs, presentation mode draws, `Object.prototype` is clean and the console is empty in both. Importing `fixture/sample-value-stream.xlsx` through the file picker loads 146 tasks and 19 phases in about 3 seconds, persists all three parts, and reloads cleanly with no errors. As in 1.0.2, this is not an exhaustive security audit, and full Microsoft Excel interoperability testing has not been performed.

---

# Flowline 1.0.2

Prepared 20 September 2026 from the 1.0.1 maintenance release. Fixes ten findings from an independent review of 1.0.1. Nothing has been published remotely.

## Fixed

### Security

1. **Prototype pollution from any imported file (high).** Validation tested whether an id existed by writing `!map[key]`, which is satisfied by every `Object.prototype` member, so `"waste": "__proto__"` passed against the untouched shipped taxonomy. The scheduler's get-or-create accumulator then short-circuited to `Object.prototype` and incremented four counters onto it, permanently for the session and re-applied on every load because the payload persisted to `localStorage`. Three routes reached it: an activity's `waste`, a taxonomy category's `family`, and an activity's `phase` by way of `js/analyze.js` (an unknown phase is only a warning, so that route did not even need the truthiness quirk). Because `h()` in `js/app.js` and `el()` in `js/render.js` enumerate with `for...in`, every element created afterwards picked up stray attributes, and under `js/embed.js` the pollution landed on the host application rather than on Flowline. Fixed on both sides: `js/validate.js` now tests membership with `hasOwnProperty`, and the accumulators in `js/schedule.js`, `js/analyze.js` and `js/import.js` are null-prototype objects, as `parseXLSX` already used for its sheet and relationship maps.

2. **A 58 KB workbook could hang the browser tab (high).** The XML attribute scanner used `/([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g` across the whole region between `<tag` and `>`. On a long run of name characters that never reaches `="…"` the engine retries from every position, which is quadratic. None of the 1.0.1 size limits applied, because one padded start tag contains no rows, no cells and no columns, and a repeated character compresses to nothing. A 51 KB file built from the shipped fixture took 55 seconds to parse; an 8 MB attribute run sat under the 16 MiB part ceiling at 58,367 bytes on disk. `attrs()` is now a single forward pass that cannot backtrack. The same file parses in 290 ms.

3. **Latent HTML injection in the tooltip (low).** `js/app.js` interpolated a taxonomy colour into a single-quoted `style` attribute with no escaping and assigned the result with `innerHTML`, and `esc()` escaped only `&`, `<` and `>`. No reachable path around the hex-colour check in `js/validate.js` was found, so this was not exploitable, but it left one regex in another file as the only barrier between an imported file and script execution in an origin that holds the File System Access handle for the user's linked folder. `esc()` now escapes quotes, and every colour goes through a local `safeColor()` check at the point of use.

### Correctness

4. **`saveProcessOverride` reported success while persisting nothing (medium).** `JSON.parse(localStorage.getItem(key) || "{}")` guarded an empty key but not a stored scalar or array. Assigning a property to a primitive is a silent no-op in sloppy mode, and an array loses it in `JSON.stringify`, so the function returned normally and the caller replaced live data and toasted "Saved". A shared `readOverride()` now rejects anything that is not a plain object, and the write is read back before it is called a success.

5. **Imports validated a different data set than the one that would load (medium).** `loadJSONFile` validated `override.X || data.X`, the live in-memory data, but persisted only the override, which `loadData` later recombines with the **shipped** data. Any partial override that was valid against live data and broken against the shipped files was written to `localStorage` and broke every later page load. Validation now runs against the same shipped-backed triple `loadData` will rebuild.

6. **A success message painted over the failure underneath it (medium).** `init()` was called and then followed by an unconditional success toast. `toast()` writes one shared element, so the error `init()` had just raised was replaced by "Loaded …". `init()` now returns whether the data validated, and all three import paths only claim success when it did.

7. **A deeply nested rule bricked startup with no way back (medium).** `checkRule` recurses per nesting level and the startup call to `VSM.validate.run` was not wrapped, so a 24 KB file threw `RangeError`, aborted `init()` and left a blank page with the "Discard loaded data" button still hidden. `checkRule` now caps nesting at 64 levels and reports it as a validation error, the startup call is wrapped, and the discard button is shown whenever a saved override exists.

8. **A failed folder save left a mismatched set on disk (medium).** `VSM.files.save()` wrote three files in a loop with no staging, and the exception propagated so the list of files already written was discarded. All three files are now serialized and diffed before anything is written, and a write failure throws an error carrying `written` and `failedOn` so the user is told exactly what landed.

9. **A linked folder with invalid data stranded the UI (low).** `applyLoadedData` returned early without refreshing the source panel although the folder was already linked and its handle stored, leaving Reload, Save and Unlink hidden and the panel claiming the shipped data was in use, across reloads. The panel is now refreshed on that path, and a parse error from the folder is reported as such instead of as a permissions problem.

10. **XML edge cases lost data quietly (low).** `String.fromCodePoint` was called with no range guard, so `&#9999999999;` threw an internal `RangeError` out of `parseXLSX`; an out-of-range reference is now left as written. The tag scanner took the first literal `</t>` with no awareness of context, so a `</t>` inside a comment truncated the element and CDATA came back as raw markup; both are now stepped over. Single-quoted attributes, which the old regex silently dropped, are read.

## Added

- 14 further regression groups covering all ten findings, including a timing assertion that fails if the attribute scanner goes quadratic again and an `Object.prototype` check around the scheduler and the analyzer. `test/regressions.js` now runs 42 groups.

## Validation

Executed with Node v22.22.2:

```text
node test/run-tests.js       151 passed, 0 failed
node test/regressions.js     42 regression groups passed, 0 failed
node tools/bundle.js         dist/flowline.html written (343 KB)
```

`index.html` and `dist/flowline.html` were both loaded in Chromium: 39 bars render, the details panel opens, the tooltip path runs, `Object.prototype` is clean and the console is empty. As in 1.0.1, this is not an exhaustive security audit, and full Microsoft Excel interoperability testing has not been performed.

---

# Flowline 1.0.1

Prepared September 20, 2026 from `flowline_1.zip`. This is a local maintenance release; nothing has been published remotely.

## Fixed

1. **Unbounded XLSX processing.** ZIP directory and entry offsets are checked before use. Only referenced workbook XML is inflated. Both declared and actual streamed sizes are bounded; oversized streams are cancelled. CRC and size checks reject corrupt parts. Sparse rows use a Map instead of filling an array up to a supplied row index. Invalid row/cell references and excessive workbook dimensions produce readable errors.
2. **CSV formula injection.** Potentially executable string cells receive a leading apostrophe, including formula prefixes after whitespace and leading tab/newline controls. Actual numeric values remain numeric. Ordinary quoted text and delimiters are preserved. The protective apostrophe is deliberately retained on CSV reimport; it is not silently removed. XLSX string cells continue to use explicit string types.
3. **Invalid inline edits persisted before validation.** Edits now operate on a copy, validate the complete candidate, and save successfully before replacing live data. Invalid dependencies, cycles, negative/nonfinite durations, optimal values above current, and storage failures leave the previous model intact. Imports are validated before persistence, and startup can recover to shipped data if an older saved override is invalid.
4. **Phase totals converted to hours twice.** Aggregation now stays in source units until the final conversion. The shipped default data exports 2,328 current hours, not 18,624. Task, edge and phase time conversions use the shared unit resolver, including hour abbreviations and weeks.
5. **Stale lead/cycle values after duration changes.** Editing a total proportionally scales its recorded lead/cycle breakdown. Both inline and legacy Activities-table edits use this behavior. Export also resolves the split against effective durations, including scenario overrides and multipliers. When the original split sums to zero, the new total is allocated to lead time. The edit form explains the proportional behavior.
6. **CSV export could not be reimported.** Both CSV and XLSX uploads are identified by headers and routed to the Task List importer when appropriate. Legacy Activities CSVs still work. Already-parsed XLSX files are reused instead of decompressed twice. The public `VSM.table.importFile()` API also accepts Task List CSV/XLSX and returns a `data` bundle containing the complete replacement process, taxonomy and scenario; callers should use that bundle to retain its units and configuration.
7. **Commas inside JSON strings were removed.** Trailing-comma cleanup now tracks quoted strings and escape sequences. Literal text such as `comma,}` and `comma,]`, URLs and comment-like string contents is preserved.
8. **Successor-based cycles bypassed validation.** Validation uses the combined predecessor/successor graph and an iterative cycle check. Malformed dependency arrays produce validation errors. Direct scheduler calls reject cycles with explicit errors instead of later dereferencing incomplete nodes.

## Added

- `test/regressions.js`: 28 regression groups covering all eight findings, storage failures, parser limits, malformed references, legacy imports and unit consistency. Test ZIP payloads are generated in memory.
- Regression execution in CI and release workflows, using Node 22, the locally tested runtime.
- `VERSION`, these release notes, and `FIX_SUMMARY_PROMPT.md`.
- A rebuilt self-contained `dist/flowline.html`.

## Workbook limits

The reader allows at most 16 MiB of compressed input, 1,024 ZIP entries, 16 MiB per referenced XML part, 32 MiB total expanded XML, 64 worksheets, 100,000 actual rows and 250,000 cells across worksheets, and 256 columns. Row numbers may be sparse up to Excel's 1,048,576-row boundary. These are application limits, not claims about Excel's full format capacity. Large legitimate workbooks may need to be reduced before import. Unsupported or encrypted compression is rejected for referenced parts.

## Validation

Executed with Node 22.19.0:

```text
node test/run-tests.js       151 passed, 0 failed
node test/regressions.js     28 regression groups passed, 0 failed
node tools/bundle.js         standalone build succeeded
```

Regression tests exercise the real app edit/import handlers in a Node VM with browser presentation stubbed. They do not replace a full interactive browser or Microsoft Excel compatibility test. No claim is made that this maintenance release is an exhaustive security audit.

## Run

Extract the ZIP and open `flowline/index.html`, or open `flowline/dist/flowline.html` for the self-contained version. There is no runtime installation step. The original archive has not been modified.
