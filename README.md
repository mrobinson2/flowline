# Flowline

A single-page, no-server app that turns a value stream into a scenario-driven Gantt timeline and makes process waste visible: how long each activity takes today, how much of that time is necessary, how much is removable, where work waits, and where it changes hands.

Open `index.html` in a browser. No install, no build, no network.

**Maintenance release 1.0.1:** fixes eight reviewed security and correctness
issues. See [CHANGELOG.md](CHANGELOG.md) for the changes, workbook size limits,
CSV safety behavior and validation results. A ready-to-use handoff prompt is in
[FIX_SUMMARY_PROMPT.md](FIX_SUMMARY_PROMPT.md). The standalone app is
`dist/flowline.html`. Run both `node test/run-tests.js` and
`node test/regressions.js` before rebuilding with `node tools/bundle.js`.

## Folder

```
flowline/
├── index.html                 the app shell (controls, panels, script includes)
├── css/app.css                application chrome (dark theme)
├── js/
│   ├── registry.js            VSM namespace + data registry
│   ├── units.js               what time is measured in (days vs hours) - one place
│   ├── schema.js              THE WORKBOOK'S SHAPE: column names, picklists     <- edit when a header changes
│   ├── validate.js            checks the data and reports errors by activity id
│   ├── rules.js               declarative rules engine (which activities appear)
│   ├── schedule.js            scheduler: inclusion, durations, ES/EF, float, handoffs, metrics
│   ├── layout.js              size calculations (interactive vs. 16:9 presentation)
│   ├── render.js              SVG renderer (bars, gates, handoff markers, labels, legend)
│   ├── export.js              SVG / PNG / clipboard / JSON export
│   ├── table.js               Excel (.xlsx) and CSV export / import, no libraries
│   ├── import.js              an Excel workbook -> the app's model
│   ├── files.js               link the data folder: reload from it and save back to it
│   ├── node.js                loads the engine in plain Node, no browser
│   └── app.js                 UI wiring and state
├── data/
│   ├── process.data.js        THE VALUE STREAM: phases, teams, activities   <- edit in workshops
│   ├── taxonomy.data.js       colors, waste categories, activity categories, markers
│   └── scenario.data.js       scenario attributes (the controls) and presets
├── test/run-tests.js          node test/run-tests.js - the arithmetic, with no browser
├── fixture/                   a synthetic workbook with the real schema and real totals
├── dist/
│   └── flowline.html                everything above inlined into one file (the release download)
└── tools/bundle.js            rebuilds dist/ from the folder (node tools/bundle.js)
```

## Loading an Excel workbook

Press **Load** and pick the .xlsx. The app looks at the headers, not the file
name: a sheet carrying `ID`, `Task`, `Current Lead Time (hrs)` and
`Current Cycle Time (hrs)` is treated as the source workbook and replaces the
whole data set — activities, teams, phases, the waste taxonomy and the scenario
switches. Anything else is treated as one of this app's own Activities exports
and merges into the current data as before.

Three things the import decides, each of which it also tells you about:

**Elapsed time is lead + cycle.** The workbook's Lead Time column is wait-only.
That is not a guess: Flow Efficiency on the Summary tab equals
`cycle / (lead + cycle)` to the decimal on every phase, which it can only do if
lead excludes touch time. A bar's length is therefore lead + cycle. Reading lead
as total elapsed would report 11.1% flow efficiency where the truth is 10.0%.

**Each distinct "Applies When" phrase becomes an on/off switch.** No rule
grammar to write by hand: add a phrase in Excel, reload, and a new switch is
there. They all start on, so the first render is the whole task list.

**Team Topologies Type is used as the organization boundary,** so a
cross-boundary handoff means Platform → Governance and the like. The Assigned
Team is still the owner and still what the owner column and filters use.

Values outside a known picklist are kept, counted and listed in the panel —
never silently dropped. Unknown columns are reported and ignored.

### The Edges sheet

Column order is **Successor ID, then Predecessor ID**. Reading those two the
other way round reverses every dependency in the graph and produces a schedule
that looks entirely plausible and is backwards, so the schema pins it
explicitly. `Zero-Slack Link = BINDING` marks the links that drive the end
date; those are carried through on `process.bindingLinks` so the chart can draw
them heavier than the rest.

### The day is eight hours

The Task List carries hours (columns L–O) and the schedule carries days
(R–X). One hour is 0.125 of a day: every Earliest Finish in the workbook lands
on an exact eighth (4.63, 6.75, 10.25, 14.13), which is only possible at eight
hours to the day. `VSM.schema.HOURS_PER_DAY` holds it and a test asserts the
property still holds on whatever workbook is loaded.

### Two schedules, checked against each other

The workbook computes its own Duration, Earliest Start, Earliest Finish, Latest
Start, Latest Finish, Slack and Critical Path. This app recomputes all of it,
because the workbook's figures go stale the moment a scenario switch drops a
step out of the graph. The workbook's numbers are kept on each activity as
`source` and compared:

```js
const rec = VSM.import.reconcile(process, model);
// { endOurs, endTheirs, checked, mismatchCount, worstDelta,
//   mismatches[], criticalOurs, criticalTheirs, criticalAgrees }
```

Two independent forward passes over the same graph is the cheapest bug detector
available to either side. It is sensitive: on the fixture, reversing a single
dependency moves the end date 10.4 days and flags 146 tasks, mis-setting the
working day to 7.5 hours moves it 56 days, and a single task 16 hours short
shows up as exactly one mismatch naming that task.

### Tailoring: profiles and modifiers

Three more tabs turn the workbook into a tailoring policy rather than one flat
task list. They are optional: without them the app falls back to building a
switch per distinct Applies When phrase.

**Toggles** is the vocabulary, one row per lever: `Toggle ID`, `Group`,
`Label`, `Type` (boolean or choice), `Options`, `Default`, `Implies`, `Help`.
Add a row, get a control. `Implies` lets one lever pull another on, so
requesting an RFP switches on the discovery phase whether or not anyone ticked
it, and the UI shows that toggle locked with the reason.

**Profiles** are named starting points, with one column per toggle. A profile
**declares a subset and stays silent on the rest**, and a blank cell means
silence, not off. That is what lets "standard paved-road app, and by the way it
involves AI" exist without a separate profile for every combination: switching
profile overwrites only what the profile names, so a modifier it never
mentioned stays where you put it. Change something the profile *does* declare
and it is no longer that profile, which the dropdown reflects.

**Scenario Matrix** is the decision table: `Task ID`, `Task`, `Baseline`, then
one column per condition. A column header names a condition:

```
genAI                     the boolean toggle is on
workType=Greenfield build the choice toggle equals that value
tier=Tier 0|Tier 1        the choice toggle is any of those
```

Cells: blank means the condition has no opinion, `R` means it requires the
task, `N` means it removes it, and **a number means it requires the task and
multiplies its duration** by that much. The multiplier matters more than it
looks: an Architecture Review Board for a catalog pattern is not the review a
greenfield build pioneering three new services gets, and a model that only adds
and removes rows understates exactly the projects where the estimate counts.

Resolution: a task is in if Baseline says so or any live condition requires it,
and out only if nothing live requires it and something live excludes it.
**Required beats excluded, always, and the collision is reported by name.** A
governance tool that can silently drop a control because two toggles disagreed
will eventually embarrass somebody.

The order things are switched on never changes the answer. The model is
recomputed from the whole current state rather than mutated step by step, and a
test asserts profile-then-modifier equals modifier-then-profile.

**Full scope** is generated, not written: the preset that reaches every step
any project could need, at unmodified length. Where a step can be reached more
than one way it picks a route with no multiplier, so the complete map still
matches the workbook it came from. That is also the only scenario the
workbook's own CPM columns describe, so it is what reconciliation runs against.

### When a column name changes

Edit `js/schema.js`. It declares every column, its aliases and its picklist, and
the importer, the validator and the exporter all read from it. Headers are
matched with case, spacing and punctuation ignored, so
`Interaction Mode ("Team Topologies")` also matches `Interaction mode`.
Columns marked `confirmed: false` are the ones this file is still guessing at;
`VSM.schema.unconfirmed()` lists them, and so does the end of the test run.

## Running the numbers without a browser

```
node test/run-tests.js                          # against the synthetic fixture
IMPORT_FILE=/path/to/real.xlsx node test/run-tests.js
```

`js/node.js` loads the engine — registry, units, schema, rules, validate,
schedule, layout, table, import — under plain Node with no DOM. Only the
renderer needs a browser. Node 18 or newer; the .xlsx reader uses
`DecompressionStream`.

This exists so the arithmetic can be checked from a command line: point it at a
real workbook and it reports the totals, the values outside the picklists, and
whether the reduction figure quoted by summed hours differs from the one on the
critical path. It usually does, and only one of the two belongs on a slide.

## Editing data during a workshop

### Link the data folder (the fastest loop)

Click **Link data folder** in the sidebar and pick either the app folder or its `data` folder. After that:

* edit `data/process.data.js` in your editor, save, click **Reload** in the app, and the chart updates
* or edit in the app (or import a spreadsheet) and click **Save**, and the files on disk are rewritten

The browser asks for read and write access once; nothing is installed and no server is involved. The link is remembered across page refreshes, and the browser reconfirms permission after a restart. Chrome and Edge support this; Firefox and Safari do not, so those fall back to the **Load** and **Export** buttons, which work everywhere.

The file reader tolerates the `/* ... */` comments in the shipped files and a stray trailing comma, and a broken edit is reported with the file and line rather than blanking the chart.


The three files in `data/` are JSON with a one-line wrapper:

```js
VSM.register("process", {
  ... plain JSON ...
});
```

Edit anything between the outer braces, save, reload the page. The wrapper exists because browsers refuse `fetch()` of a local file when the page is opened from disk (`file://`), while `<script src>` works everywhere. The same files work unchanged when the folder is hosted as a static site.

Pure `.json` files also work: use **Load JSON** (or drop a `.json` file on the page). The app accepts a process file (`{"activities": [...]}`), a taxonomy file (`{"families": ...}`), a scenario file (`{"attributes": ...}`) or a bundle `{"process": ..., "taxonomy": ..., "scenario": ...}`. Loaded data is kept in the browser's local storage until you click **Discard loaded JSON**. **Export ▾ → Download data as JSON** writes the current data set out as pure JSON.

### Excel / CSV round trip (bulk edits)

**Export ▾ → Excel workbook (.xlsx)** writes the current scenario's activities to *Task List* (columns A–Y), with dependency, phase-summary, team, chart and scenario information in companion sheets. **CSV (Task List)** writes the same task rows as a single CSV. Exported rows reflect the selected scenario; use the JSON bundle to preserve the complete master data and configuration.

Edit in Excel, save, then **Import** the .xlsx or .csv (or drop it on the page). Task List headers route either format through the source importer, replacing the data set after confirmation. CSV carries only the task table; it does not preserve the companion scenario sheets. Legacy *Activities* tables remain supported: their rows update, add, remove and reorder activities, and optional *Teams* and *Phases* sheets replace those lists. Invalid data is rejected before saving. The chart re-renders and valid data is kept in the browser.

To make the change permanent, **Export ▾ → Download data/process.data.js** and replace the file in the `data` folder. That file is what the app loads on the next open, on any machine.

Legacy Activities column notes: `predecessors` and `handoffs` are ids separated by `;`. `when` and `overrides` hold the rule JSON as text (copy them from an existing row). `handoff` and `milestone` are TRUE / FALSE / blank. Durations are numbers. CSV text that could be interpreted as a formula is prefixed with an apostrophe; that protection is retained on reimport.

The workbook is written and read by the app itself with no libraries: .xlsx is zipped XML, and the browser's built-in DecompressionStream inflates the parts Excel compresses (Edge / Chrome 103+, Safari 16.4+, Firefox 113+). CSV works everywhere.

### Editing one activity live

Click an activity, then use the **Edit activity** form at the bottom of the details panel (name, durations, owner, phase, category, waste type, predecessors, notes). **Save changes** re-renders on the spot. Same rule as above: download `process.data.js` afterwards to keep it.

### Activity fields

| field | meaning |
|---|---|
| `id` | unique key, referenced by `predecessors` |
| `name` | label next to the bar |
| `description`, `notes` | shown in tooltip / details panel |
| `phase` | groups rows into bands (see `phases`) |
| `owner` | team id (see `teams`). Owner change between predecessor and activity = handoff |
| `category` | `value`, `enabling`, or `approval` (gates get a diamond at their decision point) |
| `waste` | optional waste type id from the taxonomy (drives color family and the code badge) |
| `duration` | `{ "current": 12, "optimal": 3 }` in the process units (business days) |
| `predecessors` | finish-to-start dependencies; successors are derived |
| `when` | inclusion rule (see below); omit for "always" |
| `overrides` | `[ { "when": {...}, "duration": {...}, "note": "..." } ]`, first match wins |
| `handoff` | `true` = every incoming link is a handoff, `false` = never |
| `handoffs` | `["pred-id"]` declare a handoff from specific predecessors (same team, different group) |
| `milestone` | `true` = diamond only, no bar (use with duration 0) |

If a predecessor is excluded by the scenario, the activity inherits that predecessor's own predecessors, so chains stay intact when a branch is switched off. Redundant links (a predecessor that is already an ancestor of another predecessor) are dropped automatically to keep the chart clean.

### Rules

Write a policy once under `"rules"` in `scenario.data.js`, then reference it by name from any activity:

```json
"rules": {
  "securityReview": { "securityReview": true },
  "sensitiveData":  { "dataClassification": { "in": ["confidential", "restricted"] } },
  "deepSecurity":   { "all": [ "securityReview", "sensitiveData" ] }
}
```

```json
"when": "deepSecurity"
```

Change the policy in one place and every activity using it follows. Inline rule objects still work exactly as before; names are shorthand, and the two mix freely (`{ "all": ["cloud", "aiWorkload"] }`).

Rules are evaluated against the scenario values. Grammar:

```json
{ "hosting": "cloud" }                                       equals
{ "hosting": "cloud", "aiWorkload": true }                   AND (all keys must match)
{ "any": [ { "aiWorkload": true }, { "drRequired": true } ] } OR
{ "not": { "hosting": "cloud" } }                            NOT
{ "dataClassification": { "in": ["confidential", "restricted"] } }
{ "integrations": { "includes": "sso" } }                    multi-select contains
{ "integrations": { "includesAny": ["sso", "sap"] } }
{ "attr": { "ne": v } }  { "attr": { "gt": n } }             also gte, lt, lte, notIn, includesAll
```

Scenario attributes are defined in `scenario.data.js`; add a new attribute there and it becomes a control immediately. Attribute types are `boolean`, `enum` (single choice) and `multi` (multi-select). `enabledWhen` greys a control out and neutralizes its value when its rule does not match (for example, hardware procurement only applies on-premises).

### Taxonomy

`families` are color pairs (solid "optimal" shade + lighter "excess" shade that is always drawn hatched). `wasteTypes` and `categories` point at a family and carry a short `code` printed on the bar, so a color-blind reader or a black-and-white print still tells a queue (`Q`) from rework (`R`). `waiting: true` on a waste type counts it toward the "waiting time" metric. Add, rename or recolor freely.

## Validation

The data is checked before anything is drawn. Errors name the activity and say what to fix:

```
activity #6 (vendor-rfp) inclusion rule: unknown scenario attribute 'hostng'.
  Without this check the activity would silently never appear.
activity #8 (vendor-contract): optimal duration (9) is larger than current (2).
  Optimal is the minimum necessary time, so it cannot exceed today's.
dependency loop: intake -> sizing -> biz-case -> intake-triage -> intake.
```

This matters most for rules. A misspelled attribute or option used to evaluate quietly to false, so the activity just vanished from the chart with nothing to explain it. Now it is reported.

Checks cover duplicate and malformed ids, missing predecessors, dependency loops (including in branches the current scenario excludes), negative or non-numeric durations, optimal above current, unknown category / waste / owner / phase references, unknown rule names and rule loops, bad operators, preset values that are not valid options, and taxonomy colors that are not six-digit hex (SVG and PNG export need a literal color).

When a load fails validation the previous chart stays on screen and the errors are listed in the sidebar, so a typo during a workshop never blanks the projector.

## What the visualization encodes

* **Stacked bar**: solid segment = optimal / necessary time, hatched lighter segment = excess / removable time. Total length = current duration. Current = optimal + excess.
* **Color family** = activity kind (value, enabling, approval) or waste type. Code badge on the bar repeats it in text.
* **Ring at the start of a bar** = the activity receives a handoff (owner changed). Filled center dot = the handoff also crosses an organizational boundary. A number beside the ring = several handoffs converge on that row. Handoffs are detected from `owner`, or declared with `handoff` / `handoffs`.
* **Diamond at the end of a bar** = approval / decision point. A gate can have duration (its bar still shows optimal vs. excess, so necessary decision time is separated from queueing and bureaucracy) or be a pure milestone (outlined diamond).
* **Dependency lines**: thin grey; purple when the link is a handoff.
* **Phase bands** with rotated labels on the left.
* **Theme**: the Light mode / Dark mode button in the top bar switches the whole app, presentation mode and every export. The choice is remembered.
* **Side columns**: the row number and responsible team on the left, and `current / optimal / removable` on the right, so a bar too small to read still reports its numbers. On by default while you work and off on slides, where the shape matters more than the detail. Both are checkboxes under Display. Teams can carry a `short` name used when the full label will not fit.
* **Keyboard**: rows are focusable, Enter or Space opens the details panel, and every row carries a spoken-word summary for screen readers.
* **Views**: Current (default), Opportunity (necessary time greyed out, excess in color), Waste / Friction (value work dimmed, waste types and handoff rings emphasized), Optimal (the schedule if every activity ran at its optimal duration; activities with optimal 0 shrink to a dashed marker).
* **Metrics**: current / optimal / removable elapsed (critical path), excess inside activities (sum), handoffs (activities receiving one, cross-org count, distinct org boundaries), approval gates, waiting time. The breakdown bar shows where the removable days sit by family.

Labels sit to the left of their bar when there is room, otherwise to the right, otherwise inside a wide bar, otherwise truncated with an ellipsis on the roomier side.

## Presentation mode and export

Above 80 visible rows the toolbar warns that a slide stops being readable; filter or split the scenario for detail slides.

Presentation mode renders a fixed 1920×1080 composition: title, scenario summary, metrics strip, timeline, legend. Row height, bar height, label font, marker size and margins are computed from the number of rows (26 px rows for ~30 activities down to ~9 px rows for 80) so the whole scenario fits one 16:9 slide without CSS scaling; text stays vector-crisp. Exports (PNG at 1920×1080 or 3840×2160, SVG, copy-to-clipboard as PNG) always use this composition, even when triggered from the interactive view, so they drop straight into PowerPoint.

## Architecture notes

* Rendering (`render.js`), scheduling/rules (`schedule.js`, `rules.js`), process data (`data/process.data.js`) and visual taxonomy (`data/taxonomy.data.js`) are separate files with one-way dependencies: data → rules → schedule → layout → render → app.
* The renderer is a custom SVG timeline rather than Frappe Gantt. Frappe is date-based, mutates its own DOM, and has no concept of stacked segments, gate diamonds, handoff markers, presentation sizing or label placement; wrapping it would have meant fighting it at every step. The custom renderer is ~500 lines, has no dependencies, and the SVG it produces is the export.
* Hosting later: copy the folder to any static web server (IIS, nginx, Azure Static Web Apps, a storage account). Nothing changes. If the data should come from an API instead, replace the three `<script src="data/...">` lines with a fetch that calls `VSM.register(...)` before `app.js` runs.
* State (scenario, view, filters, display settings) is kept in local storage so a reload during a workshop lands back on the same scenario. **Reset scenario & settings** clears it.

## Palette note

Twelve color families cannot all be pairwise distinct for every kind of color vision; that is why every family also carries a text code, why excess is always hatched, and why handoffs and gates have their own shapes. Families with similar hues (amber queue vs. orange procurement, indigo testing vs. blue value) remain distinguishable by code and marker. Change the hex values in `taxonomy.data.js` if your brand palette differs.
