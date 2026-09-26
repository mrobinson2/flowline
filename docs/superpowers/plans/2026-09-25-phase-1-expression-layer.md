# Phase 1: Expression Layer and Schema Extensions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the workbook a first-class rule language — a text `IncludeExpression` column, a named `Rules` sheet, and the Variables-sheet columns later phases consume — all compiling to the existing JSON rule grammar so nothing downstream changes.

**Architecture:** One new module, `js/expr.js`, compiles the spec §3.1 text grammar into the exact JSON objects `VSM.rules.evaluate` already runs (decision D1 mapping in the roadmap). The importer gains a per-task precedence chain (IncludeExpression > Scenario Matrix > Applies When phrase) and reads two extended sheets. Everything else — evaluator, scheduler, validator — sees the same rule objects it sees today.

**Tech Stack:** Vanilla JS IIFE on `VSM.expr`, no dependencies, Node-testable. Fixture regenerated with the seeded `fixture/make_fixture.py` (openpyxl 3.1.5 present).

**Spec:** `/Volumes/Forge/07-Projects/flowline/flowline_full_extraction.md` §2.1–2.3, §3; roadmap charter in `docs/superpowers/plans/2026-09-25-spec-gap-closure.md` (decisions D1–D3 bind this plan).

## Global Constraints

All of the roadmap's Global Constraints apply. Phase-1 specifics:

- Operator mapping is exactly decision D1. `INTERSECTS` → `includesAny`. A bare boolean attribute `X` → `{ X: true }`.
- Expressions are parsed by `js/expr.js`, never `eval`'d.
- Keywords (`AND OR NOT IN INCLUDES INTERSECTS TRUE FALSE`) match case-insensitively **by position**; values stay case-sensitive. Values are strings except the words `true`/`false` (any case), which become booleans. No numeric coercion — workbook cells are text and enum options are strings.
- A failed per-task expression compile is a **warning naming the task and column**, and the task falls back to the next precedence source — never a silent exclusion. A failed `Rules`-sheet compile is an **error** (shared rules poison everything downstream).
- Old files keep loading: every new column and sheet is optional, `confirmed: false`, with aliases; the `Toggles` sheet answers to the name `Variables`.
- Export keeps A..Z column positions; new Task List columns append after `Stage`.
- The fixture must still import 146 tasks / 19 phases and reconcile its full-scope schedule 146/146.

## Review Focus

1. **`=` on a multi-select attribute** (`RuntimeModel = IaaS`): compile error suggesting `INCLUDES`/`INTERSECTS`, not silent false. Test in Task 2.
2. **Both IncludeExpression and a Matrix row for one task, disagreeing:** expression wins, one warning names the task. Test in Task 6.
3. **Expression referencing an unknown attribute** (`Hostng = Azure`): compile error with did-you-mean, surfaced as an import warning; task falls back to its matrix rule. Test in Tasks 2 and 6.
4. **A value that collides with a keyword** (`workType = "Lift and shift"`, phrase contains no keyword, but a bare `and` inside an unquoted value would split): quoted values accepted verbatim; unquoted multi-word values are a syntax error pointing at the second word, message suggesting quotes. Test in Task 1.
5. **`Rules` sheet referencing a rule defined lower in the sheet, or itself:** forward references allowed (two-pass id collection); self/circular references rejected by the existing `validate.js` named-rule loop check — pin with a test in Task 5.

---

### Task 1: `js/expr.js` — lexer + parser + D1 mapping (no type checks yet)

**Files:**
- Create: `js/expr.js`
- Test: `test/expr-tests.js` (new file, run by `test/run-tests.js`? No — standalone: `node test/expr-tests.js`, wired into CI in Task 8; keeps run-tests.js focused on the fixture)

**Interfaces:**
- Produces: `VSM.expr.compile(text[, attrDefs[, ruleIds]]) -> { rule, refs }`; throws `Error` with `.column` (1-based) and `.message` on bad syntax. `refs` = sorted unique attribute ids + `R_*` names referenced. Also `VSM.expr.KEYWORDS`. Node export like every other module.
- Consumed by: Tasks 2–3 (same module), Task 5–7 (importer), Phase 6 (admin editor).

- [ ] **Step 1: Write the failing tests** — create `test/expr-tests.js`:

```js
/* Expression compiler unit tests. Run: node test/expr-tests.js */
const assert = require("node:assert/strict");
const V = require("../js/node.js");
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok " + name); };
const rule = t => V.expr.compile(t).rule;
const fails = (t, re, col) => {
  try { V.expr.compile(t); } catch (e) {
    assert.match(e.message, re, "message for: " + t);
    if (col !== undefined) assert.equal(e.column, col, "column for: " + t);
    return;
  }
  assert.fail("expected compile to throw for: " + t);
};

test("bare boolean, equality, booleans and quoting", () => {
  assert.deepEqual(rule("PavedRoad"), { PavedRoad: true });
  assert.deepEqual(rule("InboundInternet = true"), { InboundInternet: true });
  assert.deepEqual(rule("InboundInternet = FALSE"), { InboundInternet: false });
  assert.deepEqual(rule("HostingTarget = Azure"), { HostingTarget: "Azure" });
  assert.deepEqual(rule('workType = "Lift and shift"'), { workType: "Lift and shift" });
  assert.deepEqual(rule("HostingTarget != OnPrem"), { HostingTarget: { ne: "OnPrem" } });
});

test("IN, NOT IN, INCLUDES, INTERSECTS", () => {
  assert.deepEqual(rule("ServiceTier IN [Tier0, Tier1, Tier2]"),
    { ServiceTier: { in: ["Tier0", "Tier1", "Tier2"] } });
  assert.deepEqual(rule("ServiceTier NOT IN [Tier4]"), { ServiceTier: { notIn: ["Tier4"] } });
  assert.deepEqual(rule("RuntimeModel INCLUDES PaaS"), { RuntimeModel: { includes: "PaaS" } });
  assert.deepEqual(rule("RuntimeModel INTERSECTS [IaaS, Containers]"),
    { RuntimeModel: { includesAny: ["IaaS", "Containers"] } });
});

test("AND, OR, NOT, parentheses, precedence (AND binds tighter)", () => {
  assert.deepEqual(rule("a AND b"), { all: [{ a: true }, { b: true }] });
  assert.deepEqual(rule("a OR b AND c"), { any: [{ a: true }, { all: [{ b: true }, { c: true }] }] });
  assert.deepEqual(rule("(a OR b) AND c"), { all: [{ any: [{ a: true }, { b: true }] }, { c: true }] });
  assert.deepEqual(rule("NOT a"), { not: { a: true } });
  assert.deepEqual(rule("NOT (a OR b)"), { not: { any: [{ a: true }, { b: true }] } });
  assert.deepEqual(rule("TRUE"), true);
  assert.deepEqual(rule("FALSE"), false);
});

test("rule references and refs collection", () => {
  assert.deepEqual(rule("R_ProdBound"), "R_ProdBound");
  const spec = "R_ProdBound AND ( ServiceTier IN [Tier0, Tier1, Tier2] OR InboundInternet = true )";
  assert.deepEqual(rule(spec), { all: ["R_ProdBound",
    { any: [{ ServiceTier: { in: ["Tier0", "Tier1", "Tier2"] } }, { InboundInternet: true }] }] });
  assert.deepEqual(V.expr.compile(spec).refs, ["InboundInternet", "R_ProdBound", "ServiceTier"]);
});

test("the spec's worked examples compile", () => {
  assert.deepEqual(
    rule("ThirdPartyInvolved = true AND ( NewVendor = true OR VendorHostsOrAccessesData = true OR VendorNeedsOrgAccess = true )"),
    { all: [{ ThirdPartyInvolved: true },
      { any: [{ NewVendor: true }, { VendorHostsOrAccessesData: true }, { VendorNeedsOrgAccess: true }] }] });
  assert.deepEqual(rule("R_MigrationWithSource AND SourceEnvironmentRetired = true"),
    { all: ["R_MigrationWithSource", { SourceEnvironmentRetired: true }] });
});

test("keywords are case-insensitive by position; values stay case-sensitive", () => {
  assert.deepEqual(rule("a and b or not c"), { any: [{ all: [{ a: true }, { b: true }] }, { not: { c: true } }] });
  assert.deepEqual(rule("mode = And"), { mode: "And" });   // value position: not a keyword
  assert.deepEqual(rule("tags INCLUDES in"), { tags: { includes: "in" } });
});

test("syntax errors carry a 1-based column", () => {
  fails("a AND", /expected/i, 6);
  fails("a ANDD b", /unquoted|expected|unexpected/i);
  fails("workType = Lift and shift", /quote/i);            // unquoted multi-word value
  fails("(a OR b", /\)/, 8);
  fails("x IN Tier0", /\[/i);
  fails("= 5", /expected/i, 1);
  fails('name = "unterminated', /unterminated/i);
  fails("R_Prod = true", /rule reference/i);               // ruleRef takes no operator
  fails("TRUE = 1", /TRUE|literal/i);
  fails("", /empty/i);
});

console.log("\n" + passed + " expr tests passed, 0 failed");
```

Note the worked example substitutes a neutral organization token — the repo's housekeeping test bans the source company's own, tree-wide.

- [ ] **Step 2: Run, verify failure** — `node test/expr-tests.js` → fails with `V.expr is undefined` (expr.js not created, not loaded).

- [ ] **Step 3: Implement `js/expr.js`.** Structure (complete the obvious mechanical parts in place):

```js
/* ============================================================================
   EXPRESSIONS - the workbook's text rule language, compiled to VSM.rules JSON.
   Grammar (spec §3.1): OR < AND < NOT < primary; comparisons =, !=, IN,
   NOT IN, INCLUDES, INTERSECTS; R_* rule references; TRUE/FALSE.
   Compiled, never eval'd. Keywords match case-insensitively by position;
   values are case-sensitive strings, except true/false which are booleans.
   ========================================================================== */
(function (root) {
  const VSM = root.VSM = root.VSM || {};
  const KEYWORDS = ["AND", "OR", "NOT", "IN", "INCLUDES", "INTERSECTS", "TRUE", "FALSE"];
  const err = (message, column) => Object.assign(new Error(message), { column });

  function lex(src) { /* tokens: word | string | op(=,!=) | lparen rparen lbracket rbracket comma; each { t, v, col } (col 1-based). Quoted strings: ' or ", no escapes, unterminated -> err. Word charset [A-Za-z0-9_.-]+. '!' must be followed by '='. Any other char -> err("unexpected character ...", col). */ }

  function parse(toks, src) {
    let pos = 0;
    const peek = () => toks[pos];
    const kw = (t, k) => t && t.t === "word" && t.v.toUpperCase() === k;
    const atEnd = () => pos >= toks.length;
    const endCol = () => (toks.length ? toks[toks.length - 1].col + String(toks[toks.length - 1].v).length : src.length + 1);
    const refs = new Set();

    function expression() { /* andExpr (OR andExpr)* -> {any:[...]} when >1 */ }
    function andExpr() { /* notExpr (AND notExpr)* -> {all:[...]} when >1 */ }
    function notExpr() { /* (NOT)? -> {not: notExpr()} else primary() */ }
    function primary() {
      const t = peek();
      if (!t) throw err("expected an expression, found the end", endCol());
      if (t.t === "lparen") { /* eat, expression, expect rparen or err("expected ')'", col) */ }
      if (t.t === "word") {
        if (kw(t, "TRUE") || kw(t, "FALSE")) { /* eat; if next is an operator -> err("TRUE/FALSE is a literal and takes no operator", next.col); return t.v.toUpperCase() === "TRUE"; */ }
        if (/^R_/.test(t.v)) { /* eat; if next is operator/IN/etc -> err("a rule reference takes no operator", ...); refs.add(t.v); return t.v; */ }
        return comparison();
      }
      throw err("expected a condition, a rule reference or '(' here", t.col);
    }
    function comparison() {
      const name = peek(); pos++;             // the attribute word
      refs.add(name.v);
      const t = peek();
      if (t && t.t === "op") { /* eat; const v = scalar(); return t.v === "=" ? pair(name.v, v) : { [name.v]: { ne: v } }; */ }
      if (kw(t, "IN")) { /* eat; return { [name.v]: { in: list() } } */ }
      if (kw(t, "NOT")) { /* eat; expect IN or err; return { [name.v]: { notIn: list() } } */ }
      if (kw(t, "INCLUDES")) { /* eat; return { [name.v]: { includes: scalar() } } */ }
      if (kw(t, "INTERSECTS")) { /* eat; return { [name.v]: { includesAny: list() } } */ }
      /* bare boolean — but a following bare word means an unquoted multi-word
         value or a typo'd keyword: say so with the second word's column */
      if (t && (t.t === "word" && !kw(t, "AND") && !kw(t, "OR"))) throw err("unexpected '" + t.v + "' — multi-word values need quotes, e.g. \"Lift and shift\"", t.col);
      return { [name.v]: true };
    }
    function pair(name, v) { return { [name]: v }; }        // = true/false folds to {X:true}/{X:false}
    function scalar() { /* word or string token; word "true"/"false" any case -> boolean; missing -> err("expected a value", endCol()) */ }
    function list() { /* expect lbracket or err("IN takes a bracketed list, e.g. IN [A, B]", col); scalars separated by comma; expect rbracket */ }

    if (!toks.length) throw err("empty expression", 1);
    const rule = expression();
    if (!atEnd()) throw err("unexpected '" + peek().v + "'", peek().col);
    return { rule, refs: [...refs].sort() };
  }

  function compile(text, attrDefs, ruleIds) {
    const src = String(text == null ? "" : text);
    const out = parse(lex(src), src);
    if (attrDefs) typeCheck(out, attrDefs, ruleIds);         // Task 2
    return out;
  }
  function typeCheck() { /* Task 2 */ }

  VSM.expr = { compile, KEYWORDS };
  if (typeof module !== "undefined" && module.exports) module.exports = VSM.expr;
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
```

Wire the module into Node: in `js/node.js`, add `require("./expr.js");` after `require("./rules.js");`.

Bare-boolean disambiguation detail: `a AND b` — after `a`, the next token is the keyword `AND`, which `comparison()` must treat as end-of-comparison, not as an unquoted value. The final guard therefore excludes `AND`/`OR` (and `rparen`/`rbracket`/`comma`/end) before raising the multi-word-value error.

- [ ] **Step 4: Run to green** — `node test/expr-tests.js` → all pass. Adjust the two message-regex tests to the exact wording you shipped if needed (wording is free; the column numbers are not).

- [ ] **Step 5: Commit** — `git add js/expr.js js/node.js test/expr-tests.js && git commit -m "Expressions: compile the workbook rule language to the engine's JSON rules"` (attribution footer as usual).

### Task 2: Type checking against attribute definitions

**Files:** Modify `js/expr.js` (`typeCheck`), extend `test/expr-tests.js`.

**Interfaces:**
- Produces: `compile(text, attrDefs, ruleIds)` where `attrDefs` is the scenario `attributes` array (`{ id, type: boolean|enum|multi, options?: [{value}] }`) and `ruleIds` an array/Set of known `R_*` names. Errors carry `.column` of the offending token. Unknown enum **values** are collected on the result as `warnings: string[]` (non-fatal). `near(name, candidates)` did-you-mean helper exported for reuse.

- [ ] **Step 1: Failing tests** (append):

```js
const DEFS = [
  { id: "RuntimeModel", type: "multi", options: [{ value: "IaaS" }, { value: "PaaS" }] },
  { id: "HostingTarget", type: "enum", options: [{ value: "Azure" }, { value: "OnPrem" }] },
  { id: "InboundInternet", type: "boolean" },
  { id: "ServiceTier", type: "enum", options: [{ value: "Tier0" }, { value: "Tier1" }] }
];
const checked = (t) => V.expr.compile(t, DEFS, ["R_ProdBound"]);
const failsChecked = (t, re) => {
  try { checked(t); } catch (e) { assert.match(e.message, re, t); return; }
  assert.fail("expected type error for: " + t);
};

test("type checks: multi with =, enum with INCLUDES, unknown attr, unknown rule", () => {
  failsChecked("RuntimeModel = IaaS", /INCLUDES|INTERSECTS/);
  failsChecked("RuntimeModel IN [IaaS]", /INCLUDES|INTERSECTS/);
  failsChecked("HostingTarget INCLUDES Azure", /multi-select|only applies/i);
  failsChecked("InboundInternet = Azure", /true or false/i);
  failsChecked("Hostng = Azure", /HostingTarget/);              // did-you-mean
  failsChecked("R_Prodbound", /R_ProdBound|unknown rule/i);     // did-you-mean on rules
  failsChecked("HostingTarget", /enum|choice|= <value>/i);      // bare boolean form on an enum
});

test("unknown enum values warn, not fail", () => {
  const r = checked("HostingTarget = AWS");
  assert.deepEqual(r.rule, { HostingTarget: "AWS" });
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /AWS/);
});

test("valid checked expressions pass clean", () => {
  assert.equal(checked("R_ProdBound AND RuntimeModel INTERSECTS [IaaS, PaaS]").warnings.length, 0);
  assert.equal(checked("ServiceTier IN [Tier0, Tier1] OR InboundInternet").warnings.length, 0);
});
```

- [ ] **Step 2: RED** — new tests fail (`typeCheck` is a stub).
- [ ] **Step 3: Implement.** Walk the compiled rule tree (it is plain JSON: recurse `all`/`any` arrays, `not`, strings = rule refs, objects = comparisons). For each comparison key + operator shape apply the table below; use token columns captured during parse (retain a side list `sites: [{ name, op, values, col }]` while parsing instead of re-walking, simpler and column-accurate). Checks:
  - name not in attrDefs and not `R_*`: error `unknown attribute '<n>'` + `did you mean '<near>'?` (nearest by case-insensitive prefix/edit-distance-1 over ids).
  - `R_*` not in ruleIds (when ruleIds given): error + near over ruleIds.
  - multi + `=`/`!=`/`in`/`notIn`: error "…is a multi-select; use INCLUDES <value> or INTERSECTS [a, b]".
  - enum/boolean + `includes`/`includesAny`: error "…only applies to multi-select attributes".
  - boolean compared to a non-boolean scalar: error "…is a yes/no toggle; compare with true or false".
  - bare-boolean form (`{X:true}` written as bare `X`) where X is enum/multi: error "…is a choice; write X = <value>".
  - enum scalar/list members not in options: push warning "…'<v>' is not an option of '<attr>' (options: …)".
  `compile` returns `{ rule, refs, warnings }` (warnings `[]` when unchecked).
- [ ] **Step 4: GREEN** — `node test/expr-tests.js` all pass.
- [ ] **Step 5: Commit** — "Expressions: type-check against the attribute definitions, with did-you-mean".

### Task 3: `expr.print` — canonical text from a JSON rule

**Files:** Modify `js/expr.js`, extend `test/expr-tests.js`.

**Interfaces:** `VSM.expr.print(rule) -> string`; throws `Error` (`message` mentions "not representable") for shapes outside D1 (`gt/gte/lt/lte/eq/includesAll`, array shorthand). Round-trip law: `compile(print(r)).rule` deep-equals a D1-shaped `r`.

- [ ] **Step 1: Failing tests:**

```js
test("print: canonical text, precedence parens, quoting", () => {
  const P = V.expr.print;
  assert.equal(P({ PavedRoad: true }), "PavedRoad");
  assert.equal(P({ PavedRoad: false }), "PavedRoad = false");
  assert.equal(P({ HostingTarget: "Azure" }), "HostingTarget = Azure");
  assert.equal(P({ workType: "Lift and shift" }), 'workType = "Lift and shift"');
  assert.equal(P({ ServiceTier: { in: ["Tier0", "Tier1"] } }), "ServiceTier IN [Tier0, Tier1]");
  assert.equal(P({ RuntimeModel: { includesAny: ["IaaS"] } }), "RuntimeModel INTERSECTS [IaaS]");
  assert.equal(P({ any: [{ a: true }, { all: [{ b: true }, { c: true }] }] }), "a OR b AND c");
  assert.equal(P({ all: [{ any: [{ a: true }, { b: true }] }, { c: true }] }), "(a OR b) AND c");
  assert.equal(P({ not: { any: [{ a: true }, { b: true }] } }), "NOT (a OR b)");
  assert.equal(P("R_ProdBound"), "R_ProdBound");
  assert.equal(P(true), "TRUE");
  assert.equal(P({ a: 1, b: 2 }), "a = 1 AND b = 2");   // multi-key object = AND
});

test("print round-trips through compile", () => {
  [{ all: ["R_X", { any: [{ ServiceTier: { in: ["Tier0"] } }, { InboundInternet: true }] }] },
   { not: { workType: { notIn: ["saas", "cots"] } } },
   { integrations: { includes: "public-internet" } }
  ].forEach(r => assert.deepEqual(V.expr.compile(V.expr.print(r)).rule, r));
});

test("print refuses shapes the grammar cannot say", () => {
  assert.throws(() => V.expr.print({ x: { gt: 3 } }), /not representable/i);
  assert.throws(() => V.expr.print({ x: { includesAll: ["a"] } }), /not representable/i);
  assert.throws(() => V.expr.print({ x: ["a", "b"] }), /not representable/i);
});
```

Note `a = 1 AND b = 2`: numbers print bare and re-compile as the **string** `"1"`, so the numeric round trip is not identity — acceptable because workbook-authored rules only contain strings/booleans; the test above round-trips only string/boolean shapes.

- [ ] **Step 2: RED.** — `print` undefined.
- [ ] **Step 3: Implement** with precedence levels (OR=1, AND=2, NOT=3, leaf=4); parenthesize a child whose level is below its parent's; `maybeQuote(v)` = bare when `/^[A-Za-z0-9_.\-]+$/` and not keyword-shaped (`AND`→quoted), else double-quoted (error if the value contains a `"`: not representable).
- [ ] **Step 4: GREEN**, then run the whole file: `node test/expr-tests.js`.
- [ ] **Step 5: Commit** — "Expressions: print a rule back as canonical text".

### Task 4: Schema — new Task List columns, Rules sheet, Variables columns + alias

**Files:** Modify `js/schema.js`; modify `test/run-tests.js` (two assertions that pin column counts).

**Interfaces (consumed by Tasks 5–7 and the exporter):**
- `S.TASK` gains, after `stage`, all `confirmed: false, optional: true`, in this order (export order):
  `ruleId` "Rule ID" (text, aliases ["RuleID"]) · `includeExpression` "Include Expression" (text, aliases ["IncludeExpression", "Inclusion Expression", "Include Expr"]) · `triggerExplanation` "Trigger Explanation" (text, aliases ["TriggerExplanation", "Why Included"]) · `defaultIncluded` "Default Included" (text, aliases ["DefaultIncluded"]) · `canOverride` "Can Override" (text, aliases ["CanOverride"]) · `rulePriority` "Rule Priority" (number, aliases ["RulePriority"]).
- New `const RULES_SHEET = [...]`: `id` "Rule ID" (required) · `expression` "Expression" (required) · `means` "Means" (optional) · `why` "Why It Exists" (optional, aliases ["WhyItExists", "Rationale"]). Registered as `SHEETS.rules = { name: "Rules", aliases: ["Named Rules", "Rule Definitions"], columns: RULES_SHEET }`.
- `S.TOGGLES` gains (all optional, `confirmed: false`): `section` "Section" (number) · `shownWhen` "Shown When" (text, aliases ["ShownWhen"]) · `derived` "Derived" (text) · `derivation` "Derivation" (text) · `required` "Required" (text) · `overrideRequiresReason` "Override Requires Reason" (text, aliases ["OverrideRequiresReason"]) · `auditRelevant` "Audit Relevant" (text, aliases ["AuditRelevant"]).
- `SHEETS.toggles.aliases` gains `"Variables"`.
- Export `RULES_SHEET` on `VSM.schema` as `RULES`.

- [ ] **Step 1: Failing test.** `test/run-tests.js` currently asserts `Task List has all 26 columns (A..Y + Stage)` — that is the pin. Update it to 32 and add a position pin so the original 25 stay put:

```js
  eq("Task List has all 32 columns (A..Y + Stage + rule columns)", taskSheet.headers.length, 32);
  eq("column A..Y positions unchanged", taskSheet.headers.slice(0, 25).join("|"),
     want.slice(0, 25).join("|"));
```

(`want` is already `VSM.schema.TASK.map(c => c.header)` in that section.) Run `node test/run-tests.js` → the 32 assertion FAILS against the 26-column schema. That is the RED for this task.
- [ ] **Step 2: Implement the schema rows exactly as the Interfaces block lists them.**
- [ ] **Step 3: GREEN** — `node test/run-tests.js` (204+2 pass; the fixture has none of the new columns yet, which is fine — all optional) and `node test/regressions.js`.
- [ ] **Step 4: Commit** — "Schema: rule-layer columns, the Rules sheet, and the Variables alias".

### Task 5: Importer reads the Rules sheet (two-pass), retains it, exports it

**Files:** Modify `js/import.js`, `js/export-workbook.js`; test in `test/regressions.js`.

**Interfaces:**
- Produces on the scenario: `rules` (named-rule table now includes compiled sheet rules), `ruleMeta[ruleId] = { means, why, expression }` (the authored text), `rulesSheet = { headers, rows }` verbatim (same pattern as `matrixSheet`).
- Export writes a `Rules` sheet from `rulesSheet` when present (verbatim, like the matrix).
- Compile failures on this sheet are **errors** (`report.errors`), naming the rule id and column.

- [ ] **Step 1: Failing test:**

```js
  await test("1.3.0: Rules sheet compiles, resolves forward refs, and round-trips", () => {
    const sheets = {
      "Task List": [
        ["ID", "Phase", "Task", "Predecessor IDs", "Current Lead Time (hrs)", "Current Cycle Time (hrs)", "Applies When"],
        ["1", "P1", "Base step", "", "8", "4", "Every workload"],
        ["2", "P1", "Gated step", "1", "8", "4", "Sometimes"]
      ],
      "Toggles": [
        ["Toggle ID", "Group", "Label", "Type", "Options", "Default"],
        ["rfi", "Sourcing", "RFI", "boolean", "", "No"],
        ["rfp", "Sourcing", "RFP", "boolean", "", "No"]
      ],
      "Rules": [
        ["Rule ID", "Expression", "Means", "Why It Exists"],
        ["R_Selection", "R_AnySourcing", "any sourcing route", "written once"],
        ["R_AnySourcing", "rfi OR rfp", "rfi or rfp", ""]
      ]
    };
    const r = V.import.fromSheets(sheets, {});
    assert.equal(r.report.errors.length, 0, JSON.stringify(r.report.errors));
    assert.deepEqual(r.scenario.rules.R_AnySourcing, { any: [{ rfi: true }, { rfp: true }] });
    assert.equal(r.scenario.rules.R_Selection, "R_AnySourcing");   // forward ref resolved by name
    assert.equal(r.scenario.ruleMeta.R_Selection.means, "any sourcing route");
    assert.ok(r.scenario.rulesSheet && r.scenario.rulesSheet.rows.length === 2);
    const issues = V.validate.run(r.process, r.taxonomy, r.scenario);
    assert.equal(issues.errors.length, 0, JSON.stringify(issues.errors));
    /* a bad expression is an ERROR, and names the rule */
    const bad = JSON.parse(JSON.stringify(sheets));
    bad.Rules.push(["R_Broken", "rfi AND", "", ""]);
    const r2 = V.import.fromSheets(bad, {});
    assert.ok(r2.report.errors.some(e => e.includes("R_Broken")));
  });
```

- [ ] **Step 2: RED** (`rulesSheet` undefined; rules not compiled).
- [ ] **Step 3: Implement** in `fromSheets`, after `readToggles`, before activities: read `found.rules` with `readSheet(found.rules, S.RULES, report, "Rules")`; first pass collect ids (reject duplicates and non-`R_` ids with errors: "rule ids start with R_"); second pass `VSM.expr.compile(row.expression, togglesAsAttrDefs, allRuleIds)` per row — catch → `report.errors.push("Rules sheet, '" + id + "': " + e.message + (e.column ? " (column " + e.column + ")" : ""))`. Merge compiled into the scenario's named-rule table for BOTH branches (toggles present or not — but Rules without Toggles: compile with `attrDefs = undefined` so it type-checks nothing; still usable with phrase-switch attributes only if names align; simplest: when no Toggles, compile unchecked). Expression `warnings` → `report.warnings` prefixed with the rule id. Attach `ruleMeta` and verbatim `rulesSheet`. In `export-workbook.js` mirror the matrixSheet block for `cfg.rulesSheet` (sheet name "Rules", widths `[16, 60, 40, 60]`).
  `togglesAsAttrDefs`: the toggles array already has `{ id, type, options }` — pass it directly.
- [ ] **Step 4: GREEN** + both suites + Review Focus #5 pin (append to the same test): a self-referencing rule (`["R_Loop", "R_Loop", "", ""]`) imports without a report **error** from the compiler (the ref exists) but `validate.run` on the result reports the loop — assert `issues2.errors.some(e => /loop/.test(e))`.
- [ ] **Step 5: Commit** — "Import: read, compile and round-trip the Rules sheet".

### Task 6: Per-task IncludeExpression with precedence and conflict warning

**Files:** Modify `js/import.js` (activity loop); test in `test/regressions.js`.

**Interfaces:**
- Activity gains: `a.when` from the expression when the cell is non-blank and compiles; `a.triggerExplanation`, `a.canOverride` ("yes"/"governed" lowercased, only when present), `a.rulePriority` (number), `a.defaultIncluded` (boolean, only when the cell parses as yes/no) — all optional, all pass through `validate.js` untouched (it ignores unknown activity keys).
- Precedence per task: IncludeExpression > Matrix entry > Applies When phrase. Expression+Matrix both present → expression wins + one warning naming the task. Expression fails to compile → warning with the task id, message and column; fall back to matrix/phrase.

- [ ] **Step 1: Failing test:**

```js
  await test("1.3.0: IncludeExpression wins over the matrix, falls back on a bad compile", () => {
    const sheets = {
      "Task List": [
        ["ID", "Phase", "Task", "Predecessor IDs", "Current Lead Time (hrs)", "Current Cycle Time (hrs)", "Include Expression", "Trigger Explanation"],
        ["1", "P1", "Base", "", "8", "4", "", ""],
        ["2", "P1", "Expression-gated", "1", "8", "4", "genAI = true", "Included for AI work"],
        ["3", "P1", "Conflicted", "1", "8", "4", "genAI = true", ""],
        ["4", "P1", "Broken expression", "1", "8", "4", "genAI AND", ""]
      ],
      "Toggles": [
        ["Toggle ID", "Group", "Label", "Type", "Options", "Default"],
        ["genAI", "Technical", "AI workload", "boolean", "", "No"]
      ],
      "Profiles": [["Profile ID", "Label", "Description", "genAI"]],
      "Scenario Matrix": [
        ["Task ID", "Task", "Baseline", "genAI"],
        ["1", "Base", "Yes", ""],
        ["2", "Expression-gated", "No", "R"],
        ["3", "Conflicted", "Yes", ""],       // matrix says baseline; expression says genAI-only
        ["4", "Broken expression", "No", "R"] // fallback target
      ]
    };
    const r = V.import.fromSheets(sheets, {});
    assert.equal(r.report.errors.length, 0, JSON.stringify(r.report.errors));
    const byId = Object.fromEntries(r.process.activities.map(a => [a.id, a]));
    assert.deepEqual(byId["2"].when, { genAI: true });
    assert.equal(byId["2"].triggerExplanation, "Included for AI work");
    assert.deepEqual(byId["3"].when, { genAI: true }, "expression must beat the matrix");
    assert.ok(r.report.warnings.some(w => w.startsWith("3") && /expression wins/i.test(w)));
    assert.ok(r.report.warnings.some(w => w.startsWith("4") && /column/i.test(w)));
    assert.deepEqual(byId["4"].when, { genAI: true }, "task 4 falls back to its matrix rule");
    /* and the model actually gates on it */
    const off = V.schedule.build(r.process, r.taxonomy, { genAI: false }, r.scenario.rules, r.scenario.attributes);
    const on = V.schedule.build(r.process, r.taxonomy, { genAI: true }, r.scenario.rules, r.scenario.attributes);
    assert.equal(off.nodes.length, 2);   // 1 + 3? no: 3 is expression-gated too -> off
    assert.equal(on.nodes.length, 4);
  });
```

Careful with the `off.nodes.length` expectation: task 1 baseline (when undefined → included) and task 3 carries the expression `{genAI:true}` → excluded when off. So `off` = task 1 only… plus nothing else = 1? Task 2 excluded, 3 excluded, 4 excluded → `assert.equal(off.nodes.length, 1)`. Use 1, not 2 — recheck at RED time against the printed model.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement** in the activity loop, before the existing `if (matrix)` block: read `txt(r.includeExpression)`; when non-blank, compile against `toggles` + known rule ids (sheet rules + matrix-less phrase rules); success → `a.when = compiled.rule`, `usedExpression = true`, push compiled `warnings`; failure → warning `id + ": Include Expression: " + e.message + " (column " + e.column + ")"`. The matrix block then runs only when `!usedExpression`; when `usedExpression && matrix && matrix.has(id)` push the conflict warning `id + ": has both an Include Expression and a Scenario Matrix row; the expression wins."` — and still apply the matrix `factors` (duration multipliers are orthogonal to inclusion; note this in a comment). Carry the other new cells: `triggerExplanation`, `canOverride` (lowercase, warn if not yes/governed), `rulePriority` via `num()`, `defaultIncluded` via the existing yes/no regex.
- [ ] **Step 4: GREEN** + full suites.
- [ ] **Step 5: Commit** — "Import: per-task Include Expression, winning over the matrix with a named warning".

### Task 7: Variables-sheet columns onto attributes; `shownWhen` compiled and validated

**Files:** Modify `js/import.js` (`readToggles` + scenario assembly), `js/validate.js` (one line beside the `enabledWhen` check at ~line 215); test in `test/regressions.js`.

**Interfaces:**
- Attribute gains (only when the cell is non-blank): `section` (number), `shownWhen` (compiled rule; the words `Always` (any case) and blank mean absent; `Diagnostic mode only` → `{ diagnosticMode: true }` — Phase 3 consumes, and a comment says so), `derived` (boolean from yes/no), `derivation` (raw text, uncompiled — Phase 2 owns its semantics), `required`, `overrideRequiresReason`, `auditRelevant` (booleans from yes/no).
- `validate.js` checks `shownWhen` with `checkRule`, exactly as `enabledWhen`.
- A `Variables`-named sheet imports identically to `Toggles` (alias from Task 4).

- [ ] **Step 1: Failing test:**

```js
  await test("1.3.0: Variables sheet columns land on the attributes and shownWhen validates", () => {
    const sheets = {
      "Task List": [
        ["ID", "Phase", "Task", "Predecessor IDs", "Current Lead Time (hrs)", "Current Cycle Time (hrs)"],
        ["1", "P1", "Step", "", "8", "4"]
      ],
      "Variables": [
        ["Toggle ID", "Group", "Label", "Type", "Options", "Default", "Section", "Shown When", "Derived", "Derivation", "Required", "Override Requires Reason"],
        ["hosting", "Where", "Hosting", "choice", "Azure;OnPrem", "Azure", "2", "Always", "", "", "Yes", ""],
        ["privateEndpoint", "Network", "Private endpoint", "boolean", "", "No", "5", "hosting = Azure", "Yes", "RuntimeModel includes PaaS", "", "Yes"]
      ]
    };
    const r = V.import.fromSheets(sheets, {});
    assert.equal(r.report.errors.length, 0, JSON.stringify(r.report.errors));
    const attrs = Object.fromEntries(r.scenario.attributes.map(a => [a.id, a]));
    assert.equal(attrs.hosting.section, 2);
    assert.equal(attrs.hosting.shownWhen, undefined);              // Always = absent
    assert.equal(attrs.hosting.required, true);
    assert.deepEqual(attrs.privateEndpoint.shownWhen, { hosting: "Azure" });
    assert.equal(attrs.privateEndpoint.derived, true);
    assert.equal(attrs.privateEndpoint.derivation, "RuntimeModel includes PaaS");
    assert.equal(attrs.privateEndpoint.overrideRequiresReason, true);
    assert.equal(V.validate.run(r.process, r.taxonomy, r.scenario).errors.length, 0);
    /* a shownWhen naming a ghost attribute is caught by validation */
    const bad = JSON.parse(JSON.stringify(sheets));
    bad.Variables[2][7] = "hostng = Azure";
    const r2 = V.import.fromSheets(bad, {});
    assert.ok(r2.report.warnings.some(w => /privateEndpoint/.test(w) && /hostng/.test(w)),
      "a bad shownWhen should warn at import: " + JSON.stringify(r2.report.warnings));
  });
```

- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement.** In `readToggles`, capture the new cells onto each toggle (`yes()` helper for the yes/no columns). `shownWhen`/anything expression-shaped compiles **after** all toggles are read (needs the full vocabulary): do it in `fromSheets` right after `readToggles` returns — a compile failure is a warning naming the toggle, and the attribute ships without `shownWhen` (visible is the safe default). Copy the new fields onto the scenario attributes in the assembly block. Add the `validate.js` line:

```js
    scenarioCfg.attributes.forEach(a => { if (a.shownWhen !== undefined) checkRule(a.shownWhen, "scenario attribute '" + a.id + "' shownWhen", []); });
```

- [ ] **Step 4: GREEN** + both suites.
- [ ] **Step 5: Commit** — "Import: Variables-sheet columns (section, shownWhen, derivation flags) onto the attributes".

### Task 8: Load order — browser, bundle, CI for the new test file

**Files:** Modify `index.html` (add `<script src="js/expr.js"></script>` after the `js/rules.js` tag), `.github/workflows/ci.yml` (add `node test/expr-tests.js` beside the other two), `README.md` "Running the numbers" block (one line: `node test/expr-tests.js  # expression-language unit tests`).

- [ ] **Step 1:** Make the three edits. `tools/bundle.js` needs nothing — it inlines whatever `index.html` references.
- [ ] **Step 2: Verify** — `node tools/bundle.js` writes; `grep -c "VSM.expr" dist/flowline.html` ≥ 1; `node test/expr-tests.js && node test/run-tests.js && node test/regressions.js` all green.
- [ ] **Step 3: Commit** — "Wire the expression module into the page, the bundle and CI".

### Task 9: Fixture carries the new layer; integration proof

**Files:** Modify `fixture/make_fixture.py`; regenerate `fixture/sample-value-stream.xlsx`; tests in `test/run-tests.js` (it already imports the fixture — extend its assertions).

**Changes to the generator (seeded, so regeneration is deterministic):**
- `TOGGLE_COLUMNS` + the six new Variables columns; give every toggle a `Section` (workType/discovery→1, sourcing→3 for rfi/rfp/poc and 5 for vendor/hardware/license, technical→2 except pavedRoad/newService→3, risk→4), `Shown When` `Always` except `rfi`/`rfp`/`poc` → `discovery = true`, and `drRequired` → `Derived: Yes`, `Derivation: tier IN ["Tier 0", "Tier 1", "Tier 2", "Tier 3"]` (text only in this phase).
- New `Rules` sheet: `R_Sourcing = newVendor = true OR hardware = true OR newLicense = true`; `R_SelectionNeeded = rfi = true OR rfp = true OR poc = true`; `R_TopTier = tier IN ["Tier 0", "Tier 1"]`.
- Task List gains the six new columns; the ~10 `AI_TASKS` rows get `Include Expression: genAI = true` and `Trigger Explanation: AI governance applies to generative AI workloads` (semantically identical to their matrix cells, so scope is unchanged); every other row leaves them blank. Give the phase-8 gate rows `Can Override: Governed` and everything else blank.
- [ ] **Step 1: Failing assertions** in `test/run-tests.js` (the fixture-import section): after the existing counts,

```js
  ok("fixture Rules sheet compiled", !!ws.scenario.rules.R_Sourcing);
  eq("fixture AI tasks carry the expression", ws.process.activities.filter(a => a.triggerExplanation).length, AI_COUNT);
```

where `AI_COUNT` is read from the import (`ws.process.activities.filter(...)` — pin the exact number the regenerated fixture prints). Run → RED (old fixture has no such sheet).
- [ ] **Step 2:** Edit the generator, `cd fixture && python3 make_fixture.py`, confirm its printed totals are **unchanged** (lead 7992.0, cycle 889.0, gates 36, critical path identical) — the new columns must not perturb the seeded schedule.
- [ ] **Step 3: GREEN** — the extended assertions pass; the existing reconcile assertion (146/146 against the workbook's own CPM columns under full scope) still passes, which proves the expressions reproduced the matrix semantics exactly.
- [ ] **Step 4:** `node test/expr-tests.js && node test/run-tests.js && node test/regressions.js && node tools/bundle.js` — all green.
- [ ] **Step 5: Commit** — "Fixture: Rules sheet, Include Expressions and Variables columns, schedule unchanged".
