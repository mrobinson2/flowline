# Admin mode

Admin mode is where you change **which tasks fire, and when**: the questions the sidebar asks, the named rules, each activity's inclusion condition, and the ids and wording of all three. You never touch code or the spreadsheet, and you never change the live chart by accident. Every edit is staged on a working copy. The only way to apply edits is through an **impact preview** that replays your saved scenarios against the edited rules. Every applied change is logged with who made it.

This guide covers every feature. For the id and meaning of everything that ships by default, see [REFERENCE.md](REFERENCE.md).

- [Opening it](#opening-it)
- [How editing works: stage, preview, apply](#how-editing-works-stage-preview-apply)
- [Variables tab](#variables-tab)
- [Rules tab](#rules-tab)
- [Activities tab](#activities-tab)
- [History tab](#history-tab)
- [Renaming ids](#renaming-ids)
- [The expression language](#the-expression-language)
- [The impact preview](#the-impact-preview)
- [Applying](#applying)
- [Where your changes live](#where-your-changes-live)
- [What admin mode does not edit](#what-admin-mode-does-not-edit)
- [Worked examples](#worked-examples)

## Opening it

In the sidebar's **Process** section, press **Open admin mode** (next to *Open process designer*). An overlay opens with four tabs: **Variables**, **Rules**, **Activities** and **History**. Each tab shows a count.

Closing is safe. **Escape**, the **×** and a click outside the box all close immediately when nothing is staged. When changes are staged, they refuse and point you to **Discard**, so a stray key cannot throw work away.

## How editing works: stage, preview, apply

1. **Edit.** Every change goes to a working copy of the data, never to what is on screen.
2. **Stage.** Each editor has a **Stage change** button. A staged row gets an accent border and a *staged* badge. The footer counts staged changes. Editing the same thing twice keeps one staged change, and its *before* is always the live value. Undoing your edit back to the live value unstages it.
3. **Preview impact.** This validates the whole working copy (every rule, reference and derivation) and then shows the impact table. A copy that does not validate never reaches the preview. The errors are listed, and the live data is untouched.
4. **Apply.** This is available only on the preview. It asks for your name, saves, and logs one version entry per staged change.

**Back to editing** returns from the preview with your staged work intact. **Discard** throws the working copy away.

## Variables tab

The questions the sidebar asks, in sidebar order, plus the derived values the engine works out. Each row shows the id, the label, the type (*boolean*, *enum* = one of, *multi* = any of), whether it is derived, and its sidebar section (§).

| Action | What it does |
|---|---|
| **↑ / ↓** | Moves the question within the list, which is the sidebar order. The whole new order is one staged change. |
| **Details** | Edit the **id**, the **label** (the question people read) and the **help text** under it. A label cannot be empty. See [Renaming ids](#renaming-ids). |
| **Retire** | Removes a question, but only when nothing still reads it. When something does, the retire is refused and every blocker is listed: an activity condition (including duration overrides and multipliers), a named rule, a derivation, a *shown when* or *enabled when* gate, or a preset that sets it. Change those first. Retiring a question you added in the same session leaves no trace in the log. |
| **Add variable** | The form under the list. **Id** must start with a letter and use only letters, digits and `_`. `R_` is reserved for rules, and the id must not already be a variable or rule. Also: the **label**, the **type** (yes / no, one of, any of), the **options** (comma-separated, at least two for a choice), the **section** (1–6) and the **group** heading it sits under. A blank group uses the last group in that section. A new yes/no defaults to No, a new choice to its first option, and a new any-of to nothing. |

A new question does nothing until something reads it. Reference it from a rule or an activity condition.

## Rules tab

**Named rules** are logic written once and referenced by name. In expressions a rule is always written `R_<id>`. The shipped data stores rule ids without the prefix (`drRequired`), and a workbook stores them with it (`R_Sourcing`). The editor shows both as `R_…` and stores each the way it came. Each row shows how many activities name the rule.

| Action | What it does |
|---|---|
| **Edit** | Rewrites the rule as an expression, with [live feedback](#the-expression-language). Every activity that names the rule follows the change. |
| **Rename** | Gives the rule a new id. Every `R_` reference follows (activity conditions, multipliers, other rules, derivations and gates), and so does the workbook's Rules sheet. |

A rule that refers to itself, directly or through another rule, compiles, because the name exists. Validation refuses it at **Preview impact**, naming the loop.

## Activities tab

Every activity, with a search box that matches name, id or condition text. Each row shows the name, the id, and the current condition, or *always included*.

| Action | What it does |
|---|---|
| **Edit** | The activity's **inclusion condition**, as an expression. `TRUE` means always included. Once edited, the condition counts as authored text. The Excel export writes it to the task's *Include Expression* cell, which wins over the Scenario Matrix row on re-import (the matrix row still supplies duration multipliers). The workbook's old *Applies When* phrase and *Trigger Explanation* are dropped, because they described the rule you replaced. |
| **Details** | Edit the **id**, the **name** (the label on the chart) and the **description** (shown in the details panel and tooltip). A name cannot be empty. See [Renaming ids](#renaming-ids). |

Durations, owner, phase, category, waste type, predecessors and notes are edited by clicking the activity's bar. The details panel's **Edit** form has a predecessor picker: type a task's name or id, and each predecessor is shown as a chip with its name. Stages, phases and row order live in the **process designer**.

## History tab

The version log: every applied change, newest first. Each entry has the **author**, the **time**, the **target** (for example `rule drRequired`, `activity dr-test condition`, `variable serviceTier id`), and the text **before** and **after**. The log keeps the last 100 entries. It travels with the JSON export and with the Excel export's **Versions** sheet, and it is read back on import.

## Renaming ids

An id is a name other things point at. Renaming one rewrites every pointer in the working copy, and the rename is then previewed and applied like any other edit.

| Renaming a… | Also rewrites |
|---|---|
| **Activity** | Other activities' predecessors and declared handoffs; the workbook's Scenario Matrix row for it. |
| **Question (variable)** | Every condition, duration override and multiplier that reads it; named rules; derivations; *shown when* / *enabled when* gates; presets that set it; *implies* lists (`id` or `id=value`); the workbook's Scenario Matrix column headers. |
| **Named rule** | Every `R_` reference (conditions, multipliers, other rules, derivations, gates); the workbook's Rules sheet. |

**Id rules**
- Activity ids start with a letter or digit and use letters, digits, `-`, `_` or `.`. They must be unique among activities.
- Question and rule ids start with a letter and use letters, digits and `_`. They must be unique across questions and rules. `R_` is only for rules.

A question and a named rule may share a name, and they are different things: renaming the question `aiWorkload` leaves the rule `R_aiWorkload` alone.

**A rename changes the shape of nothing.** The impact preview replays saved scenarios in the new vocabulary and shows no change. On **Apply**, what you had set follows the new ids:
- sidebar answers and derived overrides follow a renamed question;
- per-task include/exclude overrides and the selected row follow a renamed activity;
- saved scenarios are rewritten in the new vocabulary.

## The expression language

Conditions and rules are written as text and compiled on every keystroke against the working copy's questions and rules. Nothing is ever `eval`'d.

| Write | Means | Compiles to |
|---|---|---|
| `hosting = azure` | equals | `{ "hosting": "azure" }` |
| `hosting != azure` | not equal | `{ "hosting": { "ne": "azure" } }` |
| `serviceTier IN ["Tier 0", "Tier 1"]` | one of | `{ "serviceTier": { "in": [...] } }` |
| `hosting NOT IN [aws, gcp]` | none of | `{ "hosting": { "notIn": [...] } }` |
| `network INCLUDES inbound-internet` | an any-of answer contains | `{ "network": { "includes": ... } }` |
| `dataScope INTERSECTS [sox, glba]` | an any-of answer contains at least one of | `{ "dataScope": { "includesAny": [...] } }` |
| `aiWorkload` | a yes/no answer is Yes | `{ "aiWorkload": true }` |
| `aiWorkload = false` | a yes/no answer is No | `{ "aiWorkload": false }` |
| `R_cloud` | a named rule holds | `"cloud"` |
| `A AND B`, `A OR B`, `NOT A`, `( … )` | combine; NOT binds tightest, then AND, then OR | `all` / `any` / `not` |
| `TRUE`, `FALSE` | always / never | `true` / `false` |

**Rules of the grammar**
- **Keywords are UPPERCASE:** `AND OR NOT IN INCLUDES INTERSECTS TRUE FALSE`. A lowercase `and` is an error on purpose. Otherwise `workType = Lift and shift` would quietly parse as two conditions.
- **Values are case-sensitive** and are written as the option's value, not its label: `hosting = azure`, not `Azure`. Use the ids in [REFERENCE.md](REFERENCE.md#questions). A word made of letters, digits, `_`, `.` and `-` needs no quotes. Anything else is quoted: `"Tier 0"`, `'Lift and shift'`. `true` and `false` in any case become yes/no.
- **Types are checked.** An any-of question needs `INCLUDES` or `INTERSECTS` (`network = inbound-internet` is an error that says so). A yes/no question compares only with `true` or `false`, and `INCLUDES` works only on any-of questions.

**Feedback while you type**
- ✓ *compiles* in green.
- A **warning** in amber compiles but is suspicious, for example `hosting = Azure` warns that `Azure` is not one of `hosting`'s options.
- An **error** in red shows the column number and a caret under the offending token, with *did you mean …?* for a near-miss name (`serviceTer` → `serviceTier`). **Stage change** stays disabled until the text compiles.
- **Completion:** the word under the cursor is completed from question ids, rule names (`R_…`) and keywords. Click a chip to insert it.
- A rule shape the grammar cannot say (numeric comparisons, several operators on one question) is shown and edited **as JSON** instead of being misrepresented.

**Derivations in the workbook.** The Excel export writes each derived value's logic into its Toggles-sheet *Derivation* cell. A yes/no is one expression. A choice is ordered cases, first match wins: `custom WHEN architectureDeviation OR newEnterprisePlatform; fast WHEN approvedPatternExists AND patternConforms; ELSE standard`. Admin mode does not edit derivations. See [What admin mode does not edit](#what-admin-mode-does-not-edit).

## The impact preview

The preview answers: **if I apply this, which of the scenarios we care about change shape?**

- **What is replayed:** every saved scenario (sidebar → *Saved scenarios*), plus the scenario currently on screen, marked *on screen*. Each is rebuilt with its own answers and overrides, and hidden or disabled answers are neutralized exactly as the chart does.
- **What is compared:** each scenario under the **live** rules against the same scenario under the **edited** rules. The difference is what *this* edit does. For each scenario the table shows the task count before and after, the tasks **added** (+) and **removed** (−), and an expandable list of which tasks, with names.
- **Saved under older rules:** a saved scenario that already differs from its own recording, because an earlier change moved it, is flagged, so an old change is never blamed on the edit under review.
- **Would not build:** a scenario the edited rules cannot schedule, for example a dependency cycle, is shown as an error row.
- **Staged changes** are listed under the table with their before and after text.

Save the scenarios you care about before editing rules. With none saved, only the on-screen scenario is replayed, and the preview says so.

## Applying

**Apply** is on the preview only. It needs a name for the log, remembered in this browser. Applying:

1. validates the whole candidate again;
2. saves it in the browser, then reads it back to confirm the browser kept it;
3. appends one version entry per staged change: `{ timestamp, author, target, before, after }`;
4. swaps the live data, and moves renamed answers, overrides and saved scenarios to the new ids;
5. rebuilds the sidebar and the chart.

If the save fails, nothing changes and the reason is shown.

## Where your changes live

Applied changes are saved **in this browser**, as a copy of the questions, rules and activities that replaces the shipped files on every visit. The Data source section says *Data edited in this browser*. To keep or share the changes:

- **Export ▾ → JSON bundle** keeps everything, including the version log and saved scenarios.
- **Export ▾ → Excel** writes:
  - the live Rules sheet;
  - Toggles with sections, groups, gates, option labels and derivations;
  - each edited task's Include Expression;
  - the Scenario Matrix without retired questions' columns;
  - a Versions sheet.

  The workbook re-imports to the same map.
- **Link data folder → Save** writes the data files back to disk.

Each saved copy remembers which shipped data it was made against. If a later release changes the shipped parts your copy replaces, a notice above the metrics offers **Use the shipped data** or **Keep my data**. **Discard loaded data** in the Data source section returns to the shipped files.

## What admin mode does not edit

| To change | Use |
|---|---|
| Durations, owner, phase, category, waste type, predecessors, notes | Click the activity's bar → **Edit** in the details panel |
| Stages, phases, row order | **Open process designer** |
| A question's options, type, default, section or group (after it exists) | The JSON data files, or the workbook's Toggles sheet, then import |
| *Shown when* / *enabled when* gates, derivations, *implies* | The JSON data files, or the workbook's Toggles sheet |
| Duration multipliers | The JSON (`multipliers`) or the workbook's Scenario Matrix numeric cells |
| Presets | The JSON, or the workbook's Profiles sheet |
| New activities | The JSON, an Excel import, or pasting rows |

## Worked examples

**Make vendor onboarding depend on vendor people needing access only**
1. **Activities** → search `vendor-onboard` → **Edit**.
2. Replace the condition with `vendorNeedsOrgAccess` → **Stage change**.
3. **Preview impact** shows which saved scenarios lose the onboarding step: any that relied on professional services, vendor delivery or vendor personnel access. Then **Apply**.

**Rename a question**
1. **Variables** → `serviceTier` → **Details** → Id `tier` → **Stage change**.
2. **Preview impact** shows no change in any scenario → **Apply**.
3. Every rule, derivation and condition now reads `tier`, your current answer moved with it, and History logs `variable serviceTier id: serviceTier → tier`.

**Add a question and put it to work**
1. **Variables** → Add variable: id `dataResidencyEU`, label *Data must stay in the EU?*, yes / no, section 4, group *Data*.
2. **Activities** → `ds-residency` → **Edit** → `dataScope INCLUDES residency OR dataResidencyEU` → **Stage change**.
3. **Preview impact** → **Apply**. The new question appears in section 4, and answering Yes brings in the residency review.
