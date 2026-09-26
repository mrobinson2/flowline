/* Regression coverage for the eight issues fixed in 1.0.1, the ten fixed in
   1.0.2 and the seventeen fixed in 1.0.3 (see CHANGELOG.md).
   Run: node test/regressions.js. Uses only Node built-ins. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const zlib = require("node:zlib");
const V = require("../js/node.js");
require("../js/files.js");
const shipped = V.loadData();
const clone = x => JSON.parse(JSON.stringify(x));
const scenario = { attributes: [], rules: {} };
const task = (id, extra) => Object.assign({ id, name: id, category: "value", duration: { current: 8, optimal: 4 }, predecessors: [] }, extra);
const dataset = activities => ({ process: { units: "hours", hoursPerDay: 8, activities }, taxonomy: clone(shipped.taxonomy), scenario });
const build = data => V.schedule.build(data.process, data.taxonomy, {}, {});
let passed = 0;
/* ONLY=<substring> node test/regressions.js runs just the matching groups,
   which is how each of these was checked to fail against the release it
   describes before it was checked to pass against this one. */
const only = process.env.ONLY || "";
async function test(name, fn) {
  if (only && !name.includes(only)) return;
  await fn(); passed++; console.log("ok " + name);
}

// ZIPs are built in memory, with correct CRCs and optionally forged sizes.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc32 = bytes => { let crc = 0xffffffff; for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; };
function zip(parts) {
  const body = [], directory = []; let offset = 0;
  for (const part of parts) {
    const name = Buffer.from(part.name), raw = Buffer.from(part.text);
    const method = part.stored ? 0 : 8, compressed = part.stored ? raw : zlib.deflateRawSync(raw);
    const size = part.declared === undefined ? raw.length : part.declared;
    const crc = crc32(raw), h = Buffer.alloc(30), c = Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50); h.writeUInt16LE(method, 8); h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(compressed.length, 18); h.writeUInt32LE(size, 22); h.writeUInt16LE(name.length, 26);
    c.writeUInt32LE(0x02014b50); c.writeUInt16LE(method, 10); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(compressed.length, 20); c.writeUInt32LE(size, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    body.push(h, name, compressed); directory.push(c, name); offset += h.length + name.length + compressed.length;
  }
  const cd = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(parts.length, 8); end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  const b = Buffer.concat([...body, cd, end]);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
}
function workbook(sheet, extra = []) {
  return zip([
    { name: "xl/workbook.xml", text: '<workbook><sheets><sheet name="Activities" r:id="rId1"/></sheets></workbook>' },
    { name: "xl/worksheets/sheet1.xml", text: '<worksheet><sheetData>' + sheet + '</sheetData></worksheet>' }, ...extra
  ]);
}
const cell = (r, ref, text) => '<row r="' + r + '"><c r="' + ref + '" t="inlineStr"><is><t>' + text + '</t></is></c></row>';

// Run the actual app handlers in a VM. Only browser presentation and startup
// wiring are replaced; validation, persistence, editing and import stay real.
/* Enough of an element for js/app.js's h() and the panel builders to run.
   Only presentation is faked; the code under test is the real thing. */
function fakeNode(tag) {
  const node = {
    tag, children: [], attrs: {}, style: {}, dataset: {}, hidden: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute(k, v) { node.attrs[k] = v; },
    getAttribute(k) { return node.attrs[k]; },
    addEventListener() {},
    appendChild(c) { node.children.push(c); return c; },
    querySelector: () => null,
    querySelectorAll: () => []
  };
  Object.defineProperty(node, "innerHTML", { get: () => node._html || "", set(v) { node._html = v; if (v === "") node.children.length = 0; } });
  Object.defineProperty(node, "textContent", { get: () => node._text || "", set(v) { node._text = v; } });
  return node;
}
function appHarness(initial) {
  const storage = new Map(), messages = [], elements = new Map();
  let refuseStorage = false, dropStorage = false;
  const context = vm.createContext({
    VSM: { ...V, render: { fmt: String, pct: String } },
    window: { addEventListener() {}, innerWidth: 1400 },
    document: {
      querySelector(s) { if (!elements.has(s)) elements.set(s, fakeNode(s)); return elements.get(s); },
      querySelectorAll: () => [],
      createElement: tag => fakeNode(tag),
      createTextNode: t => ({ tag: "#text", text: String(t) })
    },
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem(key, value) {
        if (refuseStorage) throw new Error("Storage full");
        if (dropStorage) return;                 // accepts the write and keeps nothing
        storage.set(key, value);
      },
      removeItem: key => storage.delete(key)
    },
    confirm: () => true,
    FileReader: class { readAsText(file) { this.result = file.content; this.onload(); } },
    record: (message, error) => messages.push({ message, error })
  });
  let src = fs.readFileSync(path.join(__dirname, "../js/app.js"), "utf8");
  src = src.replace("  // small public surface", `
    toast = (m, bad) => record(m, bad);
    renderIssues = r => { lastIssues = r; };
    rebuild = () => { model = VSM.schedule.build(data.process, data.taxonomy, {}, {}); };
    init = () => { const ok = loadData(); rebuild(); return ok; };   // mirrors the real init(), which reports whether the data validated
    VSM.testApp = { setData(d) { data = d; }, getData() { return data; }, applyEdit, loadTableFile, loadJSONFile, loadData, safeColor, importSheets, esc: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
      loadState, buildScenarioControls, buildEditForm,
      renderWasteChips: () => { rebuild(); renderWasteChips(); } };
  // small public surface`);
  vm.runInContext(src, context);
  const api = context.VSM.testApp;
  api.setData(clone(initial));
  return {
    api, storage, messages,
    el: s => { if (!elements.has(s)) elements.set(s, fakeNode(s)); return elements.get(s); },
    refuseStorage() { refuseStorage = true; },
    dropStorage() { dropStorage = true; }
  };
}
function form(extra = {}) {
  const values = Object.assign({ name: "A", current: "8", optimal: "4", owner: "", phase: "", category: "value", waste: "", predecessors: "", notes: "" }, extra);
  return { elements: Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { value }])) };
}

(async () => {
  await test("oversized compressed input is rejected before parsing", async () => {
    await assert.rejects(V.table.parseXLSX(new ArrayBuffer(V.table.XLSX_LIMITS.compressedBytes + 1)), /input limit/);
  });
  await test("declared oversized XML is rejected", async () => {
    await assert.rejects(V.table.parseXLSX(zip([{ name: "xl/workbook.xml", text: "x", declared: V.table.XLSX_LIMITS.partBytes + 1 }])), /size limit/);
  });
  await test("forged small sizes cannot bypass streaming decompression limits", async () => {
    await assert.rejects(V.table.parseXLSX(zip([{ name: "xl/workbook.xml", text: "x".repeat(V.table.XLSX_LIMITS.partBytes + 1), declared: 1 }])), /size limit/);
  });
  await test("unused compressed entries are never inflated", async () => {
    const old = global.DecompressionStream;
    let streams = 0;
    global.DecompressionStream = class { constructor(type) { streams++; return new old(type); } };
    try {
      const sheets = await V.table.parseXLSX(workbook(cell(1, "A1", "hello"), [{ name: "unused.bin", text: "x".repeat(1024 * 1024) }]));
      assert.equal(sheets.Activities[0][0], "hello"); assert.equal(streams, 2);
    } finally { global.DecompressionStream = old; }
  });
  await test("total XML expansion is limited across referenced parts", async () => {
    const pad = " ".repeat(12 * 1024 * 1024);
    await assert.rejects(V.table.parseXLSX(zip([
      { name: "xl/workbook.xml", text: '<workbook><sheets><sheet name="A"/></sheets></workbook>' + pad },
      { name: "xl/sharedStrings.xml", text: '<sst/>' + pad },
      { name: "xl/worksheets/sheet1.xml", text: '<worksheet/>' + pad }
    ])), /size limit/);
  });
  await test("sparse rows preserve order without filling missing rows", async () => {
    const out = await V.table.parseXLSX(workbook(cell(1048576, "A1048576", "last") + cell(1, "A1", "first")));
    assert.deepEqual(out.Activities, [["first"], ["last"]]);
  });
  await test("invalid row and column references are rejected", async () => {
    for (const [r, ref] of [[4294967294, "A4294967294"], [0, "A0"], [1, "XFD1"], [1, "A2"]]) {
      await assert.rejects(V.table.parseXLSX(workbook(cell(r, ref, "x"))), /row index|cell reference|column limit/);
    }
  });
  await test("bad ZIP bounds produce a controlled error", async () => {
    const b = workbook(cell(1, "A1", "x"));
    new DataView(b).setUint32(b.byteLength - 6, 0xfffffff0, true);
    await assert.rejects(V.table.parseXLSX(b), /invalid zip entry/);
  });
  await test("CSV formula prefixes and leading controls are neutralized", () => {
    for (const value of ["=1+1", "+SUM(1,2)", "-1+2", "@SUM(1)", " \t=1", "\ttext", "\r=1", "\n=1", "＝1+1"]) {
      const rows = V.table.parseCSV(V.table.toCSV(["name"], [{ name: value }]));
      assert.equal(rows[1][0], "'" + value);
    }
    assert.equal(V.table.parseCSV(V.table.toCSV(["n"], [{ n: -3 }]))[1][0], "-3");
  });
  await test("ordinary CSV punctuation remains intact", () => {
    const value = 'Text, "quoted"\nnext line';
    assert.equal(V.table.parseCSV(V.table.toCSV(["name"], [{ name: value }]))[1][0], value);
  });
  await test("inline cycle is rejected without changing memory or storage", () => {
    const h = appHarness(dataset([task("A"), task("B", { predecessors: ["A"] })]));
    const before = JSON.stringify(h.api.getData());
    h.api.applyEdit("A", form({ predecessors: "B" }));
    assert.equal(JSON.stringify(h.api.getData()), before); assert.equal(h.storage.size, 0);
    assert.match(h.messages.at(-1).message, /Edit not saved.*dependency loop/);
  });
  await test("invalid durations and missing predecessors are rejected before saving", () => {
    for (const values of [{ current: "-1" }, { current: "" }, { optimal: "9" }, { predecessors: "missing" }]) {
      const h = appHarness(dataset([task("A")]));
      h.api.applyEdit("A", form(values)); assert.equal(h.storage.size, 0);
      assert.match(h.messages.at(-1).message, /Edit not saved/);
    }
  });
  await test("failed storage write leaves the live process unchanged", () => {
    const h = appHarness(dataset([task("A")])); h.refuseStorage();
    h.api.applyEdit("A", form({ current: "16" }));
    assert.equal(h.api.getData().process.activities[0].duration.current, 8);
    assert.match(h.messages.at(-1).message, /Edit not saved: Storage full/);
  });
  await test("phase summaries convert days to hours once", () => {
    const d = dataset([task("A")]); d.process.units = "business days";
    const row = V.exportWorkbook.summaryByPhase(build(d))[0];
    assert.equal(row["Current Lead (hrs)"], 64); assert.equal(row["Optimized Lead (hrs)"], 32);
  });
  await test("shipped default export totals reconcile to scheduled hours", () => {
    const m = V.schedule.build(shipped.process, shipped.taxonomy, V.rules.defaults(shipped.scenario.attributes), shipped.scenario.rules);
    const total = V.exportWorkbook.summaryByPhase(m).reduce((s, r) => s + r["Current Lead (hrs)"] + r["Current Cycle (hrs)"], 0);
    assert.equal(total, 2328);
  });
  await test("hour, day and week exports agree across sheets", () => {
    for (const [units, factor] of [["hours", 1], ["hrs", 1], ["business days", 8], ["weeks", 40]]) {
      const d = dataset([task("A")]); d.process.units = units;
      const m = build(d), row = V.exportWorkbook.taskRows(m, {})[0], phase = V.exportWorkbook.summaryByPhase(m)[0];
      assert.equal(row["Current Lead Time (hrs)"], 8 * factor);
      assert.equal(phase["Current Lead (hrs)"], 8 * factor);
    }
  });
  await test("duration edit preserves lead/cycle proportions and round-trips", () => {
    const d = dataset([task("A", { time: { leadCurrent: 6, cycleCurrent: 2, leadOptimal: 3, cycleOptimal: 1 } })]);
    const h = appHarness(d); h.api.applyEdit("A", form({ current: "16" }));
    const a = h.api.getData().process.activities[0];
    assert.equal(a.time.leadCurrent, 12); assert.equal(a.time.cycleCurrent, 4);
    const rows = V.exportWorkbook.taskRows(build(h.api.getData()), {});
    assert.equal(rows[0]["Current Lead Time (hrs)"], 12); assert.equal(rows[0]["Duration (days)"], 2);
    const matrix = V.table.parseCSV(V.table.toCSV(V.schema.TASK.map(x => x.header), rows));
    const imported = V.import.fromSheets({ "Task List": matrix });
    assert.equal(imported.process.activities[0].duration.current, 16);
  });
  await test("duration overrides and multipliers keep export splits consistent", () => {
    const d = dataset([task("A", { time: { leadCurrent: 6, cycleCurrent: 2, leadOptimal: 3, cycleOptimal: 1 }, overrides: [{ when: true, duration: { current: 16, optimal: 8 } }], multipliers: [{ when: true, factor: 2 }] })]);
    const row = V.exportWorkbook.taskRows(build(d), {})[0];
    assert.equal(row["Current Lead Time (hrs)"], 24); assert.equal(row["Current Cycle Time (hrs)"], 8);
    assert.equal(row["Duration (days)"], 4);
  });
  await test("legacy Activities edits also synchronize time without mutating input", () => {
    const a = task("A", { time: { leadCurrent: 6, cycleCurrent: 2, leadOptimal: 3, cycleOptimal: 1 } });
    const r = V.table.rowsToActivities([{ ...V.table.activityToRow(a), current: 16 }], [a]);
    assert.equal(r.activities[0].time.leadCurrent, 12); assert.equal(a.time.leadCurrent, 6);
  });
  await test("actual CSV upload handler accepts Task List exports", async () => {
    const d = dataset([task("A")]), h = appHarness(d);
    const csv = V.table.toCSV(V.schema.TASK.map(x => x.header), V.exportWorkbook.taskRows(build(d), {}));
    await h.api.loadTableFile({ name: "export.csv", text: async () => csv });
    assert.equal(JSON.parse(h.storage.get("vsm.data.v1")).process.activities[0].duration.current, 8);
    assert.match(h.messages.at(-1).message, /Imported export.csv/);
  });
  await test("actual CSV upload handler still accepts legacy Activities", async () => {
    const d = dataset([task("A")]), h = appHarness(d);
    const csv = V.table.toCSV(V.table.COLUMNS.map(x => x.key), [V.table.activityToRow(task("A"))]);
    await h.api.loadTableFile({ name: "legacy.csv", text: async () => csv });
    assert.equal(JSON.parse(h.storage.get("vsm.data.v1")).process.activities[0].id, "A");
  });
  await test("public file import API accepts its Task List CSV export", async () => {
    const d = dataset([task("A")]);
    const csv = V.table.toCSV(V.schema.TASK.map(x => x.header), V.exportWorkbook.taskRows(build(d), {}));
    const result = await V.table.importFile({ name: "export.csv", text: async () => csv }, d.process);
    assert.equal(result.activities[0].duration.current, 8);
    assert.equal(result.data.process.units, "hours");
    assert.equal(result.summary.updated, 1);
  });
  await test("linked-file parser preserves commas, escaped quotes and comment-like text", () => {
    const notes = 'Keep comma,} comma,] URL https://example.test and /* literal */ "quote" \\';
    assert.equal(V.files.tolerantParse(JSON.stringify({ notes }), "test").notes, notes);
    assert.equal(V.files.unwrap('/* comment */ VSM.register("process", {"notes": "comma,}", /* note */ "items": [1,2,],});', "test").notes, "comma,}");
  });
  await test("successor-only and mixed dependency cycles are rejected", () => {
    for (const acts of [
      [task("A", { successors: ["B"] }), task("B", { successors: ["A"] })],
      [task("A", { successors: ["B"], predecessors: ["B"] }), task("B")],
      [task("A", { successors: ["A"] })]
    ]) {
      const d = dataset(acts);
      assert.match(V.validate.run(d.process, d.taxonomy, d.scenario).errors.join(" "), /dependency loop/);
      assert.throws(() => build(d), /Dependency cycle/);
    }
  });
  await test("valid successor edges schedule normally", () => {
    const d = dataset([task("A", { successors: ["B"] }), task("B")]);
    assert.equal(V.validate.run(d.process, d.taxonomy, d.scenario).errors.length, 0);
    assert.equal(build(d).nodeById.get("B").cur.start, 8);
  });
  await test("malformed dependency arrays return validation errors", () => {
    for (const field of ["predecessors", "successors", "handoffs", "overrides"]) {
      const d = dataset([task("A", { [field]: "bad" })]);
      assert.ok(V.validate.run(d.process, d.taxonomy, d.scenario).errors.length);
    }
  });
  await test("invalid JSON import never replaces persisted good data", () => {
    const h = appHarness(dataset([task("A")]));
    h.api.loadJSONFile({ name: "bad.json", content: JSON.stringify({ activities: [task("A", { predecessors: ["missing"] })] }) });
    assert.equal(h.storage.size, 0); assert.equal(h.api.getData().process.activities[0].id, "A");
    assert.match(h.messages.at(-1).message, /Could not load JSON/);
  });
  await test("startup recovers from invalid persisted dependencies", () => {
    const h = appHarness(dataset([task("A")]));
    h.storage.set("vsm.data.v1", JSON.stringify({ process: { activities: [task("bad", { successors: ["bad"] })] } }));
    h.api.setData(null); h.api.loadData();
    assert.equal(h.api.getData().process.activities.length, shipped.process.activities.length);
  });

  /* ==================================================== 1.0.2 findings ==== */

  const protoKeys = ["count", "current", "optimal", "excess", "steps", "days", "gates"];
  const cleanProto = () => protoKeys.forEach(k => { delete Object.prototype[k]; });
  const polluted = () => protoKeys.filter(k => k in {});

  await test("prototype-pollution ids are rejected by validation", () => {
    for (const key of ["__proto__", "constructor", "toString"]) {
      const d = dataset([task("A", { waste: key })]);
      assert.ok(V.validate.run(d.process, d.taxonomy, d.scenario).errors.some(e => /unknown waste type/.test(e)), key);
      const c = dataset([task("A", { category: key })]);
      assert.ok(V.validate.run(c.process, c.taxonomy, c.scenario).errors.some(e => /unknown category/.test(e)), key);
      const o = dataset([task("A", { owner: key })]);
      o.process.teams = { t: { label: "T" } };
      assert.ok(V.validate.run(o.process, o.taxonomy, o.scenario).errors.some(e => /unknown owner/.test(e)), key);
    }
    const tax = clone(shipped.taxonomy); tax.categories.value.family = "__proto__";
    const d = dataset([task("A")]); d.taxonomy = tax;
    assert.ok(V.validate.run(d.process, d.taxonomy, d.scenario).errors.some(e => /unknown family/.test(e)));
  });

  await test("the scheduler cannot write to Object.prototype even if validation is skipped", () => {
    cleanProto();
    build(dataset([task("A", { waste: "__proto__" })]));
    const tax = clone(shipped.taxonomy); tax.categories.value.family = "__proto__";
    const d = dataset([task("A")]); d.taxonomy = tax; build(d);
    assert.deepEqual(polluted(), [], "schedule.build polluted Object.prototype");
    cleanProto();
  });

  await test("analyze keeps its phase totals off Object.prototype", () => {
    cleanProto();
    const d = dataset([task("A", { phase: "__proto__" })]);
    const issues = V.validate.run(d.process, d.taxonomy, d.scenario);
    assert.equal(issues.errors.length, 0);                 // an unknown phase is only a warning, by design
    V.analyze.profile(build(d), { hoursPerDay: 8 });
    assert.deepEqual(polluted(), [], "analyze.profile polluted Object.prototype");
    cleanProto();
  });

  await test("a padded start tag no longer costs quadratic time", async () => {
    const pad = " " + "a".repeat(200000);                  // 200k attribute-name chars, never an '='
    const started = Date.now();
    const sheets = await V.table.parseXLSX(zip([
      { name: "xl/workbook.xml", text: '<workbook><sheets><sheet name="Activities" r:id="rId1"/></sheets></workbook>' },
      { name: "xl/worksheets/sheet1.xml", text: '<worksheet><sheetData><row' + pad + ' r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>' }
    ]));
    const ms = Date.now() - started;
    assert.equal(sheets.Activities[0][0], "x");            // the row still parses
    assert.ok(ms < 2000, "200k-char attribute region took " + ms + "ms; the scanner has gone quadratic again");
  });

  await test("the attribute scanner reads single quotes and odd shapes", async () => {
    const sheets = await V.table.parseXLSX(zip([
      { name: "xl/workbook.xml", text: "<workbook><sheets><sheet name='Activities' r:id='rId1'/></sheets></workbook>" },
      { name: "xl/worksheets/sheet1.xml", text: "<worksheet><sheetData><row r='1' bare hidden = \"0\" ><c r='A1' t='inlineStr'><is><t>ok</t></is></c></row></sheetData></worksheet>" }
    ]));
    assert.equal(sheets.Activities[0][0], "ok");
  });

  await test("out-of-range character references do not throw", async () => {
    const sheets = await V.table.parseXLSX(workbook(cell(1, "A1", "a&#9999999999;b&#x110000;c&#65;")));
    assert.equal(sheets.Activities[0][0], "a&#9999999999;b&#x110000;cA");
  });

  await test("comments and CDATA inside cell text are handled", async () => {
    const sheets = await V.table.parseXLSX(workbook(
      cell(1, "A1", "x<!-- </t> -->y") + '<row r="2"><c r="A2" t="inlineStr"><is><t><![CDATA[a<b>c]]></t></is></c></row>'));
    assert.equal(sheets.Activities[0][0], "xy");
    assert.equal(sheets.Activities[1][0], "a<b>c");
  });

  await test("a non-object saved blob cannot swallow an edit silently", () => {
    for (const blob of ["[]", '"hello"', "5", "true", "null"]) {
      const h = appHarness(dataset([task("A")]));
      h.storage.set("vsm.data.v1", blob);
      h.api.applyEdit("A", form({ current: "16" }));
      const stored = h.storage.get("vsm.data.v1");
      const kept = stored && stored !== blob && JSON.parse(stored).process;
      const claimed = /^Saved /.test(h.messages.at(-1).message);
      assert.equal(claimed, !!kept, "blob " + blob + ": toast said " + h.messages.at(-1).message + " but persisted=" + !!kept);
      assert.equal(h.api.getData().process.activities[0].duration.current, kept ? 16 : 8);
    }
  });

  await test("a partial import is validated against the shipped data, not the live data", () => {
    const h = appHarness(dataset([task("A")]));
    // a taxonomy with no "value" category: fine against this tiny live process,
    // broken against the shipped process that loadData() will recombine it with
    const tax = clone(shipped.taxonomy); delete tax.categories.value;
    h.api.loadJSONFile({ name: "tax.json", content: JSON.stringify(tax) });
    assert.equal(h.storage.size, 0, "an override invalid against the shipped data was persisted");
    assert.match(h.messages.at(-1).message, /Could not load JSON/);
  });

  await test("a success message never paints over a load failure", () => {
    const h = appHarness(dataset([task("A")]));
    const tax = clone(shipped.taxonomy); delete tax.categories.value;
    h.api.loadJSONFile({ name: "tax.json", content: JSON.stringify(tax) });
    assert.ok(!h.messages.some(m => /^Loaded /.test(m.message)), "reported success for a rejected import");
  });

  await test("deeply nested rules return an error instead of overflowing the stack", () => {
    const depth = 5000;
    const when = JSON.parse('{"not":'.repeat(depth) + '{"hosting":"cloud"}' + "}".repeat(depth));
    const d = dataset([task("A", { when })]);
    let issues;
    assert.doesNotThrow(() => { issues = V.validate.run(d.process, d.taxonomy, d.scenario); });
    assert.ok(issues.errors.some(e => /nested more than/.test(e)));
  });

  await test("startup survives data that cannot even be checked", () => {
    const h = appHarness(dataset([task("A")]));
    const depth = 5000;
    const when = '{"not":'.repeat(depth) + '{"hosting":"cloud"}' + "}".repeat(depth);
    h.storage.set("vsm.data.v1", '{"process":{"units":"hours","activities":[{"id":"A","name":"A","category":"value","duration":{"current":1,"optimal":1},"predecessors":[],"when":' + when + "}]}}");
    h.api.setData(null);
    assert.doesNotThrow(() => h.api.loadData());
    assert.equal(h.api.getData().process.activities.length, shipped.process.activities.length);
  });

  await test("a failed folder save reports exactly which files landed", async () => {
    let n = 0;
    const dir = {
      queryPermission: async () => "granted",
      requestPermission: async () => "granted",
      getFileHandle: async () => ({
        getFile: async () => { throw new Error("new file"); },
        createWritable: async () => { if (++n === 3) throw new Error("QuotaExceededError"); return { write: async () => {}, close: async () => {} }; }
      })
    };
    VSM.files.state.mode = "linked"; VSM.files.state.dir = dir; VSM.files.state.label = "stub";
    const err = await VSM.files.save(shipped, "test").then(() => null, e => e);
    assert.ok(err, "expected the third write to fail");
    assert.deepEqual(err.written, ["process.data.js", "taxonomy.data.js"]);
    assert.equal(err.failedOn, "scenario.data.js");
    assert.match(err.message, /mixed set/);
    VSM.files.state.mode = "shipped"; VSM.files.state.dir = null;
  });

  await test("a non-hex colour cannot reach the tooltip markup", () => {
    const h = appHarness(dataset([task("A")]));
    const tax = clone(shipped.taxonomy);
    tax.families.value.optimal = "#ff0000' onmouseover='alert(1)";
    const d = dataset([task("A")]); d.taxonomy = tax;
    // validate is the first gate
    assert.ok(V.validate.run(d.process, d.taxonomy, d.scenario).errors.some(e => /six-digit hex/.test(e)));
    // and the renderer is the second, independently of it
    assert.equal(h.api.safeColor("#ff0000' onmouseover='alert(1)"), "#64748b");
    assert.equal(h.api.safeColor("#3B82F6"), "#3B82F6");
    assert.equal(h.api.esc('a"b\'c<d>e&f'), "a&quot;b&#39;c&lt;d&gt;e&amp;f");
  });

  /* ==================================================== 1.0.3 findings ==== */

  /* A fake DOM just big enough for js/render.js. The renderer is the one module
     the Node entry point cannot load, and two of these findings live in it. */
  function withRenderer(fn) {
    const node = tag => {
      const e = { tag, children: [], attrs: {}, style: {} };
      e.setAttribute = (k, v) => { e.attrs[k] = v; };
      e.appendChild = c => { e.children.push(c); return c; };
      Object.defineProperty(e, "textContent", { get: () => e._t || "", set(v) { e._t = v; } });
      return e;
    };
    const saved = { document: global.document, window: global.window };
    global.document = {
      createElementNS: (ns, tag) => node(tag),
      createElement: tag => {
        const e = node(tag);
        // measureText costs real time per character, as the browser's does:
        // a stub that just reads .length hides a quadratic label fitter
        e.getContext = () => ({ font: "", measureText(s) { let w = 0; for (let i = 0; i < s.length; i++) w += 6; return { width: w }; } });
        return e;
      }
    };
    global.window = { innerWidth: 1400, innerHeight: 900 };
    delete require.cache[require.resolve("../js/render.js")];
    require("../js/render.js");
    try { return fn(V.render); }
    finally { global.document = saved.document; global.window = saved.window; }
  }
  const walk = (n, out = []) => { out.push(n); (n.children || []).forEach(c => walk(c, out)); return out; };

  await test("comments and CDATA no longer make the XML scan quadratic", async () => {
    /* The 1.0.2 comment handling restarted three indexOf searches from the
       cursor on every comment. 60,000 empty comments in a 1 KB file took 20s. */
    const ms = [];
    for (const k of [40000, 160000]) {                       // 4x the input
      const inner = "<!--x-->".repeat(k) + '<c r="A1" t="inlineStr"><is><t>ok</t></is></c>';
      const started = Date.now();
      const sheets = await V.table.parseXLSX(zip([
        { name: "xl/workbook.xml", text: '<workbook><sheets><sheet name="Activities" r:id="rId1"/></sheets></workbook>' },
        { name: "xl/worksheets/sheet1.xml", text: '<worksheet><sheetData><row r="1">' + inner + "</row></sheetData></worksheet>" }
      ]));
      assert.equal(sheets.Activities[0][0], "ok");           // and it still parses
      ms.push(Date.now() - started);
    }
    assert.ok(ms[1] < 4000, "160,000 comments took " + ms[1] + "ms; the scan has gone quadratic again");
    // quadratic would be ~16x for 4x the input; allow plenty of slack for a cold JIT
    assert.ok(ms[1] < Math.max(ms[0], 5) * 8, "scan time grew " + ms[0] + "ms -> " + ms[1] + "ms, faster than linearly");
  });

  await test("a huge duration cannot make the renderer draw a gridline per tick", () => {
    withRenderer(render => {
      const times = [];
      for (const current of [40, 1e8, 1e18, 1e300]) {
        const d = dataset([task("A", { duration: { current, optimal: 0 } })]);
        const model = build(d);
        const L = V.layout.interactive(1, { width: 1200, zoom: 1, density: "normal", columns: true });
        const started = Date.now();
        const svg = render.draw(model, { layout: L, view: "current", display: {}, filters: null, scenarioSummary: "", theme: "dark" });
        times.push(Date.now() - started);
        const lines = walk(svg).filter(e => e.tag === "line").length;
        assert.ok(lines < 600, "drew " + lines + " lines for a duration of " + current);
      }
      assert.ok(Math.max(...times) < 2000, "draw took " + Math.max(...times) + "ms; the tick loop is unbounded again");
    });
  });

  await test("a very long activity name does not hang the label fitter", () => {
    withRenderer(render => {
      // the old fitter re-measured the whole string once per character dropped
      const d = dataset([task("A", { name: "x".repeat(200000) })]);
      const L = V.layout.interactive(1, { width: 1200, zoom: 1, density: "normal", columns: true });
      const started = Date.now();
      render.draw(build(d), { layout: L, view: "current", display: {}, filters: null, scenarioSummary: "", theme: "dark" });
      const ms = Date.now() - started;
      assert.ok(ms < 1500, "a 200,000-character label took " + ms + "ms");
    });
  });

  await test("the legend survives a family the taxonomy does not define", () => {
    withRenderer(render => {
      // no category on the activity -> schedule falls back to family "value",
      // which this taxonomy has no entry for. Presentation and every export.
      const tax = { families: { ops: { label: "Ops", optimal: "#3b82f6", excess: "#93c5fd" } }, categories: {}, wasteTypes: {} };
      const process = { units: "hours", activities: [{ id: "A", name: "A", duration: { current: 2, optimal: 1 }, predecessors: [] }] };
      assert.equal(V.validate.run(process, tax, scenario).errors.length, 0, "this data really is valid");
      const model = V.schedule.build(process, tax, {}, {});
      const L = V.layout.presentation(1, { showMetrics: true, columns: true });
      assert.ok(L.showLegend);
      assert.doesNotThrow(() => render.draw(model, { layout: L, view: "current", display: {}, filters: null, scenarioSummary: "", theme: "dark" }));
    });
  });

  await test("a taxonomy with no categories or wasteTypes still renders the panels", () => {
    const tax = { families: { value: { label: "V", optimal: "#3b82f6", excess: "#93c5fd" } } };
    const process = { units: "hours", activities: [{ id: "A", name: "A", duration: { current: 2, optimal: 1 }, predecessors: [] }] };
    assert.equal(V.validate.run(process, tax, scenario).errors.length, 0, "this data really is valid");
    const h = appHarness({ process, taxonomy: tax, scenario });
    h.api.loadState();
    assert.doesNotThrow(() => h.api.renderWasteChips());
    assert.doesNotThrow(() => h.api.buildEditForm(process.activities[0]));
  });

  await test("an attribute id that is an Object.prototype member does not break the sidebar", () => {
    const scen = {
      attributes: [
        { id: "rfp", label: "RFP", type: "boolean", default: true, implies: ["constructor"] },
        { id: "constructor", label: "Constructor toggle", type: "boolean", default: false }
      ],
      rules: {}, presets: []
    };
    const d = { process: { units: "hours", activities: [task("A")] }, taxonomy: clone(shipped.taxonomy), scenario: scen };
    assert.equal(V.validate.run(d.process, d.taxonomy, d.scenario).errors.length, 0, "this data really is valid");
    const h = appHarness(d);
    h.api.loadState();
    assert.doesNotThrow(() => h.api.buildScenarioControls());
  });

  await test("a long chain of excluded activities does not overflow the stack", () => {
    const acts = [];
    const n = 20000;
    for (let i = 0; i < n; i++) {
      acts.push(task("T" + i, { predecessors: i ? ["T" + (i - 1)] : [], when: i < n - 1 ? false : undefined }));
    }
    const d = dataset(acts);
    assert.equal(V.validate.run(d.process, d.taxonomy, d.scenario).errors.length, 0);
    let model;
    assert.doesNotThrow(() => { model = build(d); });
    assert.equal(model.nodes.length, 1);
    // and a cycle among the excluded ones is still caught
    const cyc = dataset([
      task("A", { predecessors: ["B"], when: false }),
      task("B", { predecessors: ["A"], when: false }),
      task("C", { predecessors: ["A"] })
    ]);
    assert.throws(() => build(cyc), /Dependency cycle/);
  });

  await test("validation refuses a __proto__ key and absurd nesting", () => {
    const withProto = JSON.parse('{"units":"hours","activities":[{"id":"A","name":"A","category":"value","duration":{"current":1,"optimal":1},"predecessors":[],"__proto__":{"x":1}}]}');
    assert.match(V.validate.run(withProto, shipped.taxonomy, scenario).errors[0], /__proto__/);
    const deep = n => JSON.parse('{"a":'.repeat(n) + "1" + "}".repeat(n));
    const nested = { units: "hours", activities: [task("A", { junk: deep(5000) })] };
    const issues = V.validate.run(nested, shipped.taxonomy, scenario);
    assert.match(issues.errors[0], /nested more than/);
    // JSON.stringify is what would have thrown later, so nothing valid may reach it
    assert.doesNotThrow(() => JSON.stringify({ units: "hours", activities: [task("A", { junk: deep(50) })] }));
    assert.equal(V.validate.run({ units: "hours", activities: [task("A", { junk: deep(50) })] }, shipped.taxonomy, scenario).errors.length, 0);
  });

  await test("prototype members are not mistaken for layout or export values", () => {
    for (const name of ["constructor", "toString", "valueOf", "nonsense"]) {
      const L = V.layout.interactive(5, { density: name, width: 1200 });
      assert.equal(L.rowH, 28, "density " + name);
      assert.ok(isFinite(L.height) && isFinite(L.font));
    }
    const cfg = {
      attributes: [{ id: "constructor", label: "C", type: "boolean", default: false }, { id: "ai", label: "AI", type: "boolean", default: false }],
      presets: [{ id: "p1", label: "P1", set: { ai: true } }], rules: {}
    };
    const model = build(dataset([task("A")]));
    const profiles = V.exportWorkbook.sheets(model, { scenarioCfg: cfg, scenarioSummary: "" }).find(s => s.name === "Profiles");
    assert.equal(profiles.rows[0].constructor, "", "a profile silent about a toggle must export as blank");
    assert.equal(profiles.rows[0].ai, "Yes");
  });

  await test("the importer keeps a phase or team named like a prototype member", () => {
    const r = V.import.fromSheets({
      "Task List": [
        ["ID", "Phase", "Task", "Assigned Team", "Current Lead Time (hrs)", "Current Cycle Time (hrs)"],
        ["T1", "Constructor", "Thing", "Constructor", "4", "4"],
        ["T2", "Build", "Other", "Platform Ops", "2", "2"]
      ]
    }, {});
    assert.deepEqual(r.process.phases.map(p => p.id), ["constructor", "build"]);
    assert.deepEqual(Object.keys(r.process.teams).sort(), ["constructor", "platform-ops"]);
    assert.equal(r.report.counts.teams, 2);
    const model = V.schedule.build(r.process, r.taxonomy, V.rules.defaults(r.scenario.attributes), r.scenario.rules);
    assert.equal(model.nodes[0].team.label, "Constructor", "the team must be the imported one, not Object");
  });

  await test("a blank cell is not a zero", () => {
    const headers = ["ID", "Phase", "Task", "Assigned Team", "Current Lead Time (hrs)", "Current Cycle Time (hrs)",
      "Optimized Lead Time (hrs)", "Optimized Cycle Time (hrs)", "%C&A"];
    const r = V.import.fromSheets({ "Task List": [headers, ["T1", "Build", "Thing", "Ops", "8", "8", "", ""]] }, {});
    const a = r.process.activities[0];
    assert.deepEqual(a.duration, { current: 16, optimal: 16 }, "a blank Optimized column falls back to the current time");
    assert.equal(a.pctCA, undefined, "a blank %C&A is not 0% complete and accurate");
    assert.equal(a.source, undefined, "a workbook with no CPM columns has no source figures");
    assert.equal(r.report.totals.elapsedOptimal, 16);
    const model = V.schedule.build(r.process, r.taxonomy, V.rules.defaults(r.scenario.attributes), r.scenario.rules);
    assert.equal(V.import.reconcile(r.process, model).checked, 0, "nothing to reconcile against, so nothing is claimed");
  });

  await test("a Task List with no Phase column still imports", () => {
    const r = V.import.fromSheets({
      "Task List": [["ID", "Task", "Assigned Team", "Current Lead Time (hrs)", "Current Cycle Time (hrs)"], ["T1", "Thing", "Ops", "4", "4"]]
    }, {});
    assert.equal(r.report.errors.length, 0, r.report.errors.join(" | "));
    assert.equal(r.process.activities.length, 1);
    assert.equal(r.process.activities[0].phase, undefined);
  });

  await test("long condition phrases do not collapse onto one attribute id", () => {
    const base = "Applies when the customer is in the regulated segment";
    const headers = ["ID", "Phase", "Task", "Assigned Team", "Current Lead Time (hrs)", "Current Cycle Time (hrs)", "Applies When"];
    const r = V.import.fromSheets({
      "Task List": [headers, ["T1", "Build", "A", "Ops", "1", "1", base], ["T2", "Build", "B", "Ops", "1", "1", base + " and has a DPA"]]
    }, {});
    const ids = r.scenario.attributes.map(a => a.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate attribute ids: " + ids.join(", "));
    assert.equal(V.validate.run(r.process, r.taxonomy, r.scenario).errors.length, 0,
      "the importer produced a model its own validator rejects");
  });

  await test("full scope reaches steps that only a choice toggle routes to", () => {
    const r = V.import.fromSheets({
      "Task List": [["ID", "Phase", "Task", "Assigned Team", "Current Lead Time (hrs)", "Current Cycle Time (hrs)"],
        ["T1", "Build", "Base", "Ops", "1", "1"], ["T2", "Build", "Greenfield only", "Ops", "1", "1"], ["T3", "Build", "Dead row", "Ops", "1", "1"]],
      "Toggles": [["Toggle ID", "Label", "Type", "Options", "Default", "Group"],
        ["workType", "Work type", "choice", "Greenfield;Brownfield", "Brownfield", "Scope"]],
      "Scenario Matrix": [["Task ID", "Baseline", "workType=Greenfield"], ["T1", "Yes", ""], ["T2", "No", "R"], ["T3", "No", ""]]
    }, {});
    const full = r.scenario.presets.find(p => p.id === "full-scope");
    assert.equal(full.set.workType, "Greenfield", "full scope must pick the value that reaches T2");
    const resolved = V.rules.applyImplications(r.scenario.attributes, Object.assign(V.rules.defaults(r.scenario.attributes), full.set));
    const model = V.schedule.build(r.process, r.taxonomy, resolved, r.scenario.rules, r.scenario.attributes);
    assert.ok(model.nodes.some(n => n.id === "T2"), "the complete map left out an enum-routed step");
    assert.ok(r.report.warnings.some(w => /T3.*can never appear/.test(w)), "a row nothing can reach must be reported");
  });

  await test("an import validated against a linked folder's taxonomy persists it too", () => {
    /* loadData() rebuilds override + SHIPPED, so persisting only the process
       saved something checked against data nobody kept. */
    const taxonomy = clone(shipped.taxonomy);
    taxonomy.categories.bespoke = { label: "Bespoke", family: "value", code: "X" };
    const h = appHarness({ process: { units: "hours", activities: [task("A", { category: "bespoke" })] }, taxonomy, scenario });
    h.api.applyEdit("A", form({ current: "16", category: "bespoke" }));
    const stored = JSON.parse(h.storage.get("vsm.data.v1"));
    assert.ok(stored.taxonomy, "the taxonomy the edit was checked against was not saved");
    h.api.setData(null);
    assert.equal(h.api.loadData(), true, "the saved set does not load cleanly on the next startup");
    assert.equal(h.api.getData().process.activities[0].duration.current, 16);
  });

  await test("no import path reports success over a storage that keeps nothing", () => {
    for (const run of [
      h => h.api.applyEdit("A", form({ current: "16" })),
      h => h.api.loadJSONFile({ name: "d.json", content: JSON.stringify({ activities: [task("A", { duration: { current: 3, optimal: 1 } })] }) })
    ]) {
      const h = appHarness(dataset([task("A")]));
      h.dropStorage();
      run(h);
      const last = h.messages.at(-1);
      assert.ok(last && last.error, "reported success over a write that was dropped: " + (last && last.message));
      assert.match(last.message, /did not keep the change|not saved|Could not load/);
    }
  });

  await test("a refused set is described, not left claiming the import worked", () => {
    /* The import path writes "Process data loaded from a file" BEFORE init()
       runs. When the recombined set is then refused, the old code kept working
       data on screen but skipped describeSource, so the panel went on claiming
       the new file was in use. */
    const h = appHarness(dataset([task("A")]));
    h.el("#data-source").textContent = "Process data loaded from a file (not the shipped file). Export ▾ → Download data/process.data.js to keep it.";
    h.el("#btn-reset-data").hidden = true;
    h.storage.set("vsm.data.v1", JSON.stringify({ process: { activities: [task("bad", { predecessors: ["nope"] })] }, processSource: "loaded" }));
    assert.equal(h.api.loadData(), false);
    assert.equal(h.api.getData().process.activities[0].id, "A", "the working data must stay on screen");
    assert.equal(h.el("#btn-reset-data").hidden, false, "the discard button stayed hidden");
    assert.match(h.el("#data-source").textContent, /Link a folder or download/, "the panel was not re-described after the refusal");
  });

  await test("a pasted subset merges into the data instead of replacing it", async () => {
    /* The paste path reuses the activities import, and that import treats the
       sheet as the complete list: rows absent from it are REMOVED. Correct
       for a file; catastrophic for a paste, whose whole point is carrying a
       few rows out of a bigger sheet. First build routed pastes straight
       through and a two-row paste deleted the other sixty-seven. */
    const h = appHarness(dataset([task("A"), task("B", { predecessors: ["A"] }), task("C", { predecessors: ["B"] })]));
    await h.api.importSheets(
      { Pasted: [["id", "name", "current", "optimal", "predecessors", "status"], ["B", "B renamed", "16", "4", "A", "done"], ["D", "New from paste", "8", "4", "C", ""]] },
      { name: "pasted table" }, { merge: true });
    const acts = h.api.getData().process.activities;
    assert.equal(acts.length, 4, "a 2-row paste must not shrink a 3-row process");
    /* compared as JSON: the activities were built inside the VM realm, whose
       Array prototype fails deepStrictEqual against ours on identical values */
    assert.equal(JSON.stringify(acts.map(a => a.id)), JSON.stringify(["A", "B", "C", "D"]), "unpasted rows keep their place");
    assert.equal(acts.find(a => a.id === "B").name, "B renamed", "pasted rows still update");
    assert.equal(acts.find(a => a.id === "B").status, "done", "tracking columns ride along");
    /* the false alarm: D referenced C, which was not pasted but exists */
    const warned = h.messages.some(m => /does not exist/.test(m.message));
    assert.ok(!warned, "a reference to an existing unpasted row must not warn");
  });

  await test("1.2.0: blank current-time cells are surfaced, never silent zero", () => {
    const sheets = { "Task List": [
      ["ID", "Phase", "Task", "Predecessor IDs", "Current Lead Time (hrs)", "Current Cycle Time (hrs)"],
      ["1", "P1", "Estimated step", "", "8", "4"],
      ["2", "P1", "Hardware step, no estimate", "1", "", ""]
    ] };
    const r = V.import.fromSheets(sheets, {});
    assert.equal(r.report.errors.length, 0);
    assert.ok(r.report.warnings.some(w => w.startsWith("2") && w.includes("no current time estimate")),
      "expected a warning naming task 2, got: " + JSON.stringify(r.report.warnings));
    assert.equal(r.report.counts.missingEstimates, 1);
    assert.equal(r.process.activities.find(a => a.id === "2").noEstimate, true);
    assert.equal(r.process.activities.find(a => a.id === "1").noEstimate, undefined);
  });

  await test("1.2.0: Scenario Matrix round-trips through the Task List export", async () => {
    const buf = fs.readFileSync(path.join(__dirname, "..", "fixture", "sample-value-stream.xlsx"));
    const r = await V.import.fromWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), {});
    assert.equal(r.report.errors.length, 0);
    assert.ok(r.scenario.matrixSheet, "importer did not retain the matrix sheet");
    assert.ok(r.scenario.matrixSheet.rows.length >= 100, "matrix rows missing");
    const model = V.schedule.build(r.process, r.taxonomy,
      V.rules.defaults(r.scenario.attributes), r.scenario.rules, r.scenario.attributes);
    const out = V.exportWorkbook.sheets(model, { scenarioCfg: r.scenario, scenarioSummary: "" });
    const m = out.find(s => s.name === "Scenario Matrix");
    assert.ok(m, "export writes no Scenario Matrix sheet");
    assert.equal(m.rows.length, r.scenario.matrixSheet.rows.length);
    assert.deepEqual(m.headers, r.scenario.matrixSheet.headers);
  });

  await test("1.2.0: links across an excluded step carry bridged + via", () => {
    const data = dataset([
      task("a"),
      task("b", { predecessors: ["a"], when: false }),
      task("c", { predecessors: ["b"] })
    ]);
    const model = build(data);
    const bridge = model.links.find(l => l.from === "a" && l.to === "c");
    assert.ok(bridge, "a->c bridge missing");
    assert.equal(bridge.bridged, true);
    assert.deepEqual(bridge.via, ["b"]);
    const plain = build(dataset([task("a"), task("b", { predecessors: ["a"] })]))
      .links.find(l => l.from === "a" && l.to === "b");
    assert.equal(plain.bridged, false);
    assert.equal(plain.via, undefined);
  });

  await test("1.2.0: bridged-link names do not rebuild the activity map per link", () => {
    /* The first build of the bridge annotation constructed a Map over every
       activity once per bridged link - O(links x activities), the same class
       of scan 1.0.3 finding 16 removed from the importer. */
    withRenderer(render => {
      const ms = [];
      for (const N of [1500, 6000]) {                          // 4x the input
        const acts = [task("v0")];
        for (let i = 0; i < N - 1; i++) {
          acts.push(task("x" + i, { predecessors: ["v" + i], when: false }));
          acts.push(task("v" + (i + 1), { predecessors: ["x" + i] }));
        }
        const model = build(dataset(acts));
        assert.equal(model.links.filter(l => l.bridged).length, N - 1, "chain should bridge every link");
        const L = V.layout.interactive(N, { width: 1200, zoom: 1, density: "normal", columns: true });
        const started = Date.now();
        const svg = render.draw(model, { layout: L, view: "current", display: {}, filters: null, scenarioSummary: "", theme: "dark" });
        ms.push(Date.now() - started);
        const titled = walk(svg).filter(e => e.tag === "title" && /^Bridged through /.test(e.textContent)).length;
        assert.equal(titled, N - 1, "every bridged link still carries its annotation");
      }
      assert.ok(ms[1] < 4000, "drawing 6,000 bridged links took " + ms[1] + "ms; the name map is being rebuilt per link");
      // quadratic would be ~16x for 4x the input; allow generous slack for a cold JIT
      assert.ok(ms[1] < Math.max(ms[0], 25) * 8, "draw time grew " + ms[0] + "ms -> " + ms[1] + "ms, faster than linearly");
    });
  });

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
        ["R_AnySourcing", "rfi = true OR rfp = true", "rfi or rfp", ""]
      ]
    };
    const r = V.import.fromSheets(sheets, {});
    assert.equal(r.report.errors.length, 0, JSON.stringify(r.report.errors));
    assert.deepEqual(r.scenario.rules.R_AnySourcing, { any: [{ rfi: true }, { rfp: true }] });
    assert.equal(r.scenario.rules.R_Selection, "R_AnySourcing");   // forward ref kept by name
    assert.equal(r.scenario.ruleMeta.R_Selection.means, "any sourcing route");
    assert.ok(r.scenario.rulesSheet && r.scenario.rulesSheet.rows.length === 2);
    assert.equal(V.validate.run(r.process, r.taxonomy, r.scenario).errors.length, 0);
    const model = V.schedule.build(r.process, r.taxonomy,
      V.rules.defaults(r.scenario.attributes), r.scenario.rules, r.scenario.attributes);
    const out = V.exportWorkbook.sheets(model, { scenarioCfg: r.scenario, scenarioSummary: "" });
    const rulesOut = out.find(s => s.name === "Rules");
    assert.ok(rulesOut, "export writes no Rules sheet");
    assert.equal(rulesOut.rows.length, 2);
    /* a bad expression is an ERROR naming the rule */
    const bad = JSON.parse(JSON.stringify(sheets));
    bad.Rules.push(["R_Broken", "rfi AND", "", ""]);
    const r2 = V.import.fromSheets(bad, {});
    assert.ok(r2.report.errors.some(e => e.includes("R_Broken")), JSON.stringify(r2.report.errors));
    /* a self-reference imports (the id exists) but validation reports the loop */
    const loopy = JSON.parse(JSON.stringify(sheets));
    loopy.Rules.push(["R_Loop", "R_Loop", "", ""]);
    const r3 = V.import.fromSheets(loopy, {});
    assert.equal(r3.report.errors.length, 0, JSON.stringify(r3.report.errors));
    const issues3 = V.validate.run(r3.process, r3.taxonomy, r3.scenario);
    assert.ok(issues3.errors.some(e => /loop/.test(e)), JSON.stringify(issues3.errors));
  });

  await test("1.3.0: IncludeExpression wins over the matrix, falls back on a bad compile", () => {
    const sheets = {
      "Task List": [
        ["ID", "Phase", "Task", "Predecessor IDs", "Current Lead Time (hrs)", "Current Cycle Time (hrs)", "Include Expression", "Trigger Explanation", "Can Override", "Rule Priority", "Default Included"],
        ["1", "P1", "Base", "", "8", "4", "", "", "", "10", "Yes"],
        ["2", "P1", "Expression-gated", "1", "8", "4", "genAI = true", "Included for AI work", "Governed", "30", ""],
        ["3", "P1", "Conflicted", "1", "8", "4", "genAI = true", "", "", "", ""],
        ["4", "P1", "Broken expression", "1", "8", "4", "genAI AND", "", "", "", ""]
      ],
      "Toggles": [
        ["Toggle ID", "Group", "Label", "Type", "Options", "Default"],
        ["genAI", "Technical", "AI workload", "boolean", "", "No"]
      ],
      "Scenario Matrix": [
        ["Task ID", "Task", "Baseline", "genAI"],
        ["1", "Base", "Yes", ""],
        ["2", "Expression-gated", "No", "R"],
        ["3", "Conflicted", "Yes", ""],
        ["4", "Broken expression", "No", "R"]
      ]
    };
    const r = V.import.fromSheets(sheets, {});
    assert.equal(r.report.errors.length, 0, JSON.stringify(r.report.errors));
    const byId = Object.fromEntries(r.process.activities.map(a => [a.id, a]));
    assert.deepEqual(byId["2"].when, { genAI: true });
    assert.equal(byId["2"].triggerExplanation, "Included for AI work");
    assert.equal(byId["2"].canOverride, "governed");
    assert.equal(byId["2"].rulePriority, 30);
    assert.equal(byId["1"].defaultIncluded, true);
    assert.deepEqual(byId["3"].when, { genAI: true }, "expression must beat the matrix");
    assert.ok(r.report.warnings.some(w => w.startsWith("3") && /expression wins/i.test(w)), JSON.stringify(r.report.warnings));
    assert.ok(r.report.warnings.some(w => w.startsWith("4") && /column/i.test(w)), JSON.stringify(r.report.warnings));
    assert.deepEqual(byId["4"].when, { genAI: true }, "task 4 falls back to its matrix rule");
    const off = V.schedule.build(r.process, r.taxonomy, { genAI: false }, r.scenario.rules, r.scenario.attributes);
    const on = V.schedule.build(r.process, r.taxonomy, { genAI: true }, r.scenario.rules, r.scenario.attributes);
    assert.equal(off.nodes.length, 1);   // only the baseline task; 2, 3, 4 are all genAI-gated
    assert.equal(on.nodes.length, 4);
  });

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
    assert.equal(V.validate.run(r.process, r.taxonomy, r.scenario).errors.length, 0,
      JSON.stringify(V.validate.run(r.process, r.taxonomy, r.scenario).errors));
    /* a shownWhen naming a ghost attribute warns at import and ships without it */
    const bad = JSON.parse(JSON.stringify(sheets));
    bad.Variables[2][7] = "hostng = Azure";
    const r2 = V.import.fromSheets(bad, {});
    assert.ok(r2.report.warnings.some(w => /privateEndpoint/.test(w) && /hostng/.test(w)),
      JSON.stringify(r2.report.warnings));
    const pe2 = r2.scenario.attributes.find(a => a.id === "privateEndpoint");
    assert.equal(pe2.shownWhen, undefined, "a broken shownWhen must not ship");
    assert.equal(V.validate.run(r2.process, r2.taxonomy, r2.scenario).errors.length, 0);
  });

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
    assert.ok(off.provenance.drRequired.because.some(b => b.attr === "serviceTier" && b.satisfied === false),
      JSON.stringify(off.provenance.drRequired.because));
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

  console.log("\n" + passed + " regression groups passed, 0 failed");
})().catch(e => { console.error(e); process.exitCode = 1; });
