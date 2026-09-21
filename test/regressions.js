/* Regression coverage for the eight issues fixed in 1.0.1 and the ten
   fixed in 1.0.2 (see CHANGELOG.md).
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
async function test(name, fn) { await fn(); passed++; console.log("ok " + name); }

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
function appHarness(initial) {
  const storage = new Map(), messages = [], elements = new Map();
  let refuseStorage = false;
  const context = vm.createContext({
    VSM: { ...V, render: { fmt: String, pct: String } },
    window: { addEventListener() {} },
    document: { querySelector(s) { if (!elements.has(s)) elements.set(s, {}); return elements.get(s); } },
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem(key, value) { if (refuseStorage) throw new Error("Storage full"); storage.set(key, value); },
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
    VSM.testApp = { setData(d) { data = d; }, getData() { return data; }, applyEdit, loadTableFile, loadJSONFile, loadData, safeColor, esc: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) };
  // small public surface`);
  vm.runInContext(src, context);
  const api = context.VSM.testApp;
  api.setData(clone(initial));
  return { api, storage, messages, refuseStorage() { refuseStorage = true; } };
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

  console.log("\n" + passed + " regression groups passed, 0 failed");
})().catch(e => { console.error(e); process.exitCode = 1; });
