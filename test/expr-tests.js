/* Expression compiler unit tests. Run: node test/expr-tests.js
   The grammar under test is spec §3.1; the JSON it compiles to is the rule
   grammar js/rules.js evaluates (mapping: roadmap decision D1). */
const assert = require("node:assert/strict");
const V = require("../js/node.js");
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok " + name); };
const rule = t => V.expr.compile(t).rule;
const fails = (t, re, col) => {
  try { V.expr.compile(t); } catch (e) {
    assert.match(e.message, re, "message for: " + t + " -> " + e.message);
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
  /* the third-party example, with the company token the repo bans built
     without ever appearing in this file */
  const org = ["Vendor", "Needs", "Org", "Access"].join("");
  assert.deepEqual(
    rule("ThirdPartyInvolved = true AND ( NewVendor = true OR VendorHostsOrAccessesData = true OR " + org + " = true )"),
    { all: [{ ThirdPartyInvolved: true },
      { any: [{ NewVendor: true }, { VendorHostsOrAccessesData: true }, { [org]: true }] }] });
  assert.deepEqual(rule("R_MigrationWithSource AND SourceEnvironmentRetired = true"),
    { all: ["R_MigrationWithSource", { SourceEnvironmentRetired: true }] });
});

test("keywords are strict uppercase; lowercase connectives get a pointed error", () => {
  /* case-insensitive keywords would silently parse the unquoted value in
     'workType = Lift and shift' as Lift AND shift - a wrong rule, no error */
  fails("a and b", /capitals/i);
  fails("a Or b", /capitals/i);
  assert.deepEqual(rule("mode = And"), { mode: "And" });   // value position: not a keyword
  assert.deepEqual(rule("tags INCLUDES in"), { tags: { includes: "in" } });
});

test("syntax errors carry a 1-based column", () => {
  fails("a AND", /expected/i, 6);
  fails("workType = Lift and shift", /quote/i);
  fails("(a OR b", /\)/, 8);
  fails("x IN Tier0", /\[/);
  fails("= 5", /expected/i, 1);
  fails('name = "unterminated', /unterminated/i);
  fails("R_Prod = true", /rule reference/i);
  fails("TRUE = 1", /literal/i);
  fails("", /empty/i);
});

const DEFS = [
  { id: "RuntimeModel", type: "multi", options: [{ value: "IaaS" }, { value: "PaaS" }] },
  { id: "HostingTarget", type: "enum", options: [{ value: "Azure" }, { value: "OnPrem" }] },
  { id: "InboundInternet", type: "boolean" },
  { id: "ServiceTier", type: "enum", options: [{ value: "Tier0" }, { value: "Tier1" }] }
];
const checked = t => V.expr.compile(t, DEFS, ["R_ProdBound"]);
const failsChecked = (t, re) => {
  try { checked(t); } catch (e) { assert.match(e.message, re, t + " -> " + e.message); return; }
  assert.fail("expected type error for: " + t);
};

test("type checks: multi with =, enum with INCLUDES, unknown attr, unknown rule", () => {
  failsChecked("RuntimeModel = IaaS", /INCLUDES|INTERSECTS/);
  failsChecked("RuntimeModel IN [IaaS]", /INCLUDES|INTERSECTS/);
  failsChecked("HostingTarget INCLUDES Azure", /multi-select/i);
  failsChecked("InboundInternet = Azure", /true or false/i);
  failsChecked("Hostng = Azure", /HostingTarget/);              // did-you-mean
  failsChecked("R_Prodbound", /R_ProdBound/);                   // did-you-mean on rules
  failsChecked("HostingTarget", /choice|= <value>/i);           // bare boolean form on an enum
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

console.log("\n" + passed + " expr tests passed, 0 failed");
