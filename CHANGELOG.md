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
