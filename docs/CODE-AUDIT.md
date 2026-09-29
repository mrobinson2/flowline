# Repository defect audit

Status: audit and defect fixes complete, prepared for v1.5.1. This records the scope and evidence of three review passes; it does not claim the repository is defect-free. The previously open clipboard data-loss defect is resolved. Separate v1.6.0 feature work has moved to its own worktree; the full unmodified suite passes on this release branch.

## Resolved defects

| Area | Defect and correction | Evidence |
| --- | --- | --- |
| Embedded data updates | `update({ data })` ignored replacement data. It now validates and adopts the replacement; `setData()` uses the same path without overwriting the caller's dataset object. Invalid replacements preserve the current chart and model. | Regression reproduced the old chart retaining task A instead of switching to B. It now checks replacement, subsequent redraws, invalid-data rejection, and caller ownership. |
| Saved scenarios | Read-back verification checked only the number of runs. Dropped edits and saves at the 20-run limit could report success. Verification now checks the complete serialized value. | Regression reproduced a missing error for a dropped replacement and covers capped saves and bulk replacements. |
| Restricted browser storage | Access to the `localStorage` property occurred outside the read error handler. A denied getter could break saved-scenario reads. Reads now return an empty list; saves still report failure. | Regression reproduced the getter exception and now passes. |
| Embedded scenario resolution | Hidden and diagnostic-only answers could include tasks that the main app excluded, including tasks enabled through implications. The embed uses shared effective-answer logic before implications. | Regression reproduced three extra tasks and now confirms parity with the main app and preservation of authored answers. |
| Integration module loading | The HTML example and Backstage integration omitted derivation and tracking modules. Backstage also omitted the expression/admin modules needed by workbook import. Updated the actual entry points and the setup guide. | Regression executes each entry point's declared modules in an isolated VM and checks derived-task inclusion, Tracker dispatch, and workbook expression compilation where import is exposed. |
| Designer failed-save recovery | Applying a process with no stages deleted the working copy's stages array. A rejected save left an editor that crashed on the next action. Empty stages are now omitted only from the submitted candidate. | Regression reproduced the crash, then verified retry, tab navigation, and adding a stage after a rejected apply. |
| JSON bundle import ordering | Saved scenarios were overwritten before the dataset was validated or saved. A failed scenario restore was also hidden by a success toast. Runs now change after the dataset is accepted, and partial restore failures remain visible. | Regression demonstrated an invalid bundle erasing saved runs and verifies rejected, successful, and partially successful imports. |
| Malformed saved scenarios | Records with only a run ID passed storage filtering but crashed sidebar/comparison readers. Storage reads now skip malformed records; writes reject them before changing storage. | Regression covers missing fields, wrong field types, invalid bulk replacements, and preserving valid saved runs. |
| Linked-folder read failures | Optional-file permission failures were treated as missing files; save preflight also ignored read failures and could proceed to overwrite files. Only `NotFoundError` now permits fallback or creation. | Regression verifies failed reads reject reload/save before any writes, while genuinely absent optional files remain supported. |
| Source-format clipboard merge | Pasting source-format rows replaced the dataset, deleting unpasted tasks. Pasted rows now update/add by ID, preserve omitted fields and dependencies on unpasted rows, convert hours to the live units, and merge referenced definitions without ID collisions. File imports still replace. | App-handler regressions cover deletion, conditions and named-rule aliases, omitted optimized-time components, dependency cycles/missing IDs, days/weeks conversion, definition collisions, and rejected-import persistence. |
| Quoted spreadsheet cells | Splitting clipboard text by tabs/newlines broke quoted notes containing those characters. Clipboard import now uses the shared delimited-text parser. | Regression and Chrome paste check preserve embedded newlines, tabs, and escaped quotes in one cell. |
| Analysis and reconciliation units | Analysis and workbook reconciliation divided all values by hours per day, even when the process already used days or weeks. Chain lead/cycle analysis also ignored duration overrides. Shared unit conversion and resolved time splits now supply these values. | Regression covers hours, days, weeks, duration overrides, chain totals, and reconciliation against source days. |
| What-if duration consistency | Wait caps interpreted days incorrectly outside hourly datasets; wait caps and merged queues could leave optimized lead/cycle splits inconsistent with their total. Shared unit conversion and duration setters now keep them consistent. | Regression covers equivalent caps in hours/days/weeks and verifies both current and optimized time totals. |
| Activity edit fields | Half-unit input steps prevented saving valid fractional durations. Unassigned owners/phases silently selected the first option. Duration inputs accept arbitrary precision and assignment selectors include “none.” | Chrome reproduced a blocked 0.125-day edit and accidental assignment, then verified saving a renamed fractional-duration task while retaining empty owner/phase. |
| PNG export failure handling | Exceptions during canvas creation, drawing, or encoding escaped the image callback, leaving the export promise pending. The callback now rejects the promise with the error. | Regression covers missing context, drawing failure, and encoding failure. Chrome also generated a valid 1920×1080 PNG. |
| Zero-duration critical gates | Critical-chain analysis could stop at a gate's predecessor when both finished at the same instant, omitting a terminal gate. Tied endpoints now prefer a terminal node. | Regression checks both activity orders and the reported chain gate count. |
| Partial duration overrides | A scenario override containing only one duration total replaced the entire duration object, turning the omitted total into zero. Overrides now merge with base totals; validation checks the effective pair and rejects non-finite or malformed values. | Regression reproduces the zeroed current duration and covers current-only/optimal-only patches, NaN, Infinity, malformed payloads, and optimal greater than current. |
| Activity ID types | Validation accepted numeric, boolean, and array IDs through string coercion, although DOM selection and dependency lookup require string keys. IDs now must be strings. | Regression rejects non-string IDs and confirms numeric-looking strings remain valid. |

## Verification

Verification results:

- `node test/run-tests.js`: 213 passed, 0 failed.
- `node test/expr-tests.js`: 13 passed, 0 failed.
- `node test/regressions.js`: 100 regression groups passed, 0 failed (81 before the audit), run without fixture overrides or skipped groups on the v1.5.1 release worktree.
- `node tools/bundle.js`: succeeded; regenerated the ignored `dist/flowline.html` output.
- `git diff --check`: passed.

Primary reproduction tests were observed failing before their fixes; additional boundary coverage was added alongside them. Integration tests execute engine behavior with rendering stubs; they do not prove successful compilation inside a real Backstage installation.

During the audit, concurrent v1.6.0 sample-content edits temporarily conflicted with an existing service-tier assertion. That feature work subsequently moved to a separate worktree. The release verification above runs the actual v1.5.1 files directly and supersedes the earlier isolated-fixture result; it does not certify the separate v1.6.0 feature.

Additional checks:

- A deterministic independent path-enumeration experiment (seed 90421) checked 250 ten-node DAGs and 3,466 node results against the scheduler. It covered mixed predecessor/successor declarations, excluded bridges, zero durations, shuffled activity order, and both current and optimal schedules. No mismatches.
- A second independent experiment (seed 90422) checked 200 nine-node DAGs with excluded tasks and todo/doing/done/blocked/skipped states. Remaining-path enumeration and critical-chain duration sums produced 400 matching checks.
- Chrome smoke tests on the local app: initial rendering, switching all five views without console errors, visual inspection of Tracker, switching to Adopt SaaS (40 tasks / 238 days), and entering/exiting Tracker presentation mode.
- Marking the intake activity Done updated Tracker to one completed task and a 236-day remaining path. That state survived a page reload. No browser console errors were captured.
- Chrome administrative editing rejected a misspelled attribute, previewed a valid rule change, applied it, and added a history entry. The original rule was then restored.
- Chrome export produced a file with a valid PNG signature and 1920×1080 dimensions. Clipboard and fractional activity editing were checked in the real browser as described above.

## Review coverage and limits

Reviewed saved-scenario persistence, the embed API and scenario resolution, integration module lists, JSON/table/workbook/clipboard import boundaries, designer apply handling, linked-folder read/write failures, analysis and export behavior, activity/admin editing, validation, and scheduling/derivation/progress arithmetic. Read the repository's behavior and contribution documentation and exercised the existing suites, targeted reproductions, independent arithmetic checks, and Chrome workflows.

No reproduced defect from this audit remains open. Browser checks cover the observed workflows in Chrome, not every browser or every UI interaction. File-system failure cases use mocks; Backstage compilation was not exercised in an installed Backstage application. Concurrent v1.6.0 content integration still needs its own final full-suite verification.

CodeGraph is not initialized in this checkout. Initialization was offered to the user; no index was created. The initial worktree was clean. The separate v1.6.0 sample-data, plan, and test changes were preserved in their own worktree.
