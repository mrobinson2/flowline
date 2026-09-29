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
  let refuseStorage = false, dropStorage = false, refuseRunStorage = false;
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
        if (refuseStorage || (refuseRunStorage && key === V.runs.storageKey)) throw new Error("Storage full");
        if (dropStorage) return;                 // accepts the write and keeps nothing
        storage.set(key, value);
      },
      removeItem: key => storage.delete(key)
    },
    confirm: () => true,
    FileReader: class { readAsText(file) { this.result = file.content; this.onload(); } },
    record: (message, error) => messages.push({ message, error })
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/runs.js"), "utf8"), context);
  let src = fs.readFileSync(path.join(__dirname, "../js/app.js"), "utf8");
  src = src.replace("  // small public surface", `
    toast = (m, bad) => record(m, bad);
    renderIssues = r => { lastIssues = r; };
    rebuild = () => { model = VSM.schedule.build(data.process, data.taxonomy, {}, {}); };
    init = () => { const ok = loadData(); rebuild(); return ok; };   // mirrors the real init(), which reports whether the data validated
    VSM.testApp = { setData(d) { data = d; }, getData() { return data; }, applyEdit, loadTableFile, loadJSONFile, loadData, safeColor, importSheets, esc: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
      loadState, buildScenarioControls, buildEditForm, getState: () => state, effectiveScenario,
      renderWasteChips: () => { rebuild(); renderWasteChips(); } };
  // small public surface`);
  vm.runInContext(src, context);
  const api = context.VSM.testApp;
  api.setData(clone(initial));
  return {
    api, storage, messages,
    el: s => { if (!elements.has(s)) elements.set(s, fakeNode(s)); return elements.get(s); },
    refuseStorage() { refuseStorage = true; },
    refuseRunStorage() { refuseRunStorage = true; },
    dropStorage() { dropStorage = true; }
  };
}
function form(extra = {}) {
  const values = Object.assign({ name: "A", current: "8", optimal: "4", owner: "", phase: "", category: "value", waste: "", predecessors: "", notes: "" }, extra);
  return { elements: Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { value }])) };
}

(async () => {
  await test("duration override patches preserve omitted totals and reject invalid effective durations", () => {
    for (const [patch, expected] of [[{ optimal: 2 }, { current: 8, optimal: 2 }], [{ current: 10 }, { current: 10, optimal: 4 }]]) {
      const d = dataset([task("A", { overrides: [{ when: true, duration: patch }] })]);
      assert.deepEqual(V.validate.run(d.process, d.taxonomy, d.scenario).errors, []);
      const duration = build(d).nodes[0].duration;
      assert.equal(duration.current, expected.current); assert.equal(duration.optimal, expected.optimal);
    }
    for (const patch of [{ current: Infinity }, { optimal: NaN }, { current: 2 }, { optimal: 20 }, "invalid"]) {
      const d = dataset([task("A", { overrides: [{ when: true, duration: patch }] })]);
      assert.ok(V.validate.run(d.process, d.taxonomy, d.scenario).errors.some(e => /override.*duration/.test(e)), JSON.stringify(patch));
    }
  });
  await test("activity identifiers must remain strings for DOM selection and dependency lookup", () => {
    for (const id of [1, true, ["A"], { toString: () => "A" }]) {
      const d = dataset([task(id)]);
      d.process.activities[0].name = "A";
      assert.ok(V.validate.run(d.process, d.taxonomy, d.scenario).errors.some(e => /id/.test(e)), String(id));
    }
    const d = dataset([task("1")]);
    assert.deepEqual(V.validate.run(d.process, d.taxonomy, d.scenario).errors, []);
  });
  await test("critical-chain analysis includes terminal zero-duration gates", () => {
    const a = task("A");
    const gate = task("gate", { category: "approval", duration: { current: 0, optimal: 0 }, predecessors: ["A"] });
    for (const acts of [[a, gate], [gate, a]]) {
      const m = build(dataset(acts));
      assert.deepEqual(V.analyze.criticalChain(m).map(n => n.id), ["A", "gate"]);
      assert.equal(V.analyze.profile(m).chainGates, 1);
    }
  });
  await test("PNG rendering failures reject the export instead of leaving it pending", async () => {
    for (const kind of ["context", "draw", "encode"]) {
      let img;
      const canvas = { getContext: () => kind === "context" ? null : {
        scale() {}, drawImage() { if (kind === "draw") throw new Error("Drawing failed"); }
      }, toBlob() { throw new Error("Encoding failed"); } };
      const context = vm.createContext({ VSM: {}, Image: class { constructor() { img = this; } },
        document: { createElement: () => canvas }, XMLSerializer: class { serializeToString() { return "<svg/>"; } } });
      vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/export.js"), "utf8"), context);
      const svg = { cloneNode() { return this; }, querySelectorAll: () => [], setAttribute() {}, getAttribute: () => "0 0 1920 1080" };
      const pending = context.VSM.exporter.toPNGBlob(svg, 1);
      const rejected = assert.rejects(pending, /canvas|Drawing failed|Encoding failed/i);
      assert.doesNotThrow(() => img.onload(), "load handlers must reject their promise on failure");
      await rejected;
    }
  });
  await test("analysis and workbook reconciliation respect units and resolved duration overrides", () => {
    for (const [units, scale] of [["hours", 8], ["business days", 1], ["weeks", 0.2]]) {
      const a = task("A", {
        duration: { current: 5 * scale, optimal: 2.5 * scale },
        time: { leadCurrent: 3 * scale, cycleCurrent: 2 * scale, leadOptimal: 1.5 * scale, cycleOptimal: scale },
        overrides: [{ when: true, duration: { current: 10 * scale, optimal: 5 * scale } }],
        multipliers: [{ when: true, factor: 1.5 }],
        source: { durationDays: 15, ef: 15 }
      });
      const d = dataset([a]); d.process.units = units;
      const m = build(d), profile = V.analyze.profile(m, { hoursPerDay: 8 });
      assert.equal(profile.pathDays, 15, units);
      assert.equal(profile.chainLeadDays, 9, units);
      assert.equal(profile.chainCycleDays, 6, units);
      assert.equal(profile.chainLeadDays + profile.chainCycleDays, profile.pathDays, units);
      const reconciled = V.import.reconcile(d.process, m);
      assert.equal(reconciled.endOurs, 15, units);
      assert.equal(reconciled.mismatchCount, 0, units);
      assert.deepEqual(reconciled.durationMismatches, [], units);
    }
  });
  await test("wait caps use business days across process units and keep lead-cycle totals consistent", () => {
    for (const [units, scale] of [["hours", 8], ["business days", 1], ["weeks", 0.2]]) {
      const p = dataset([task("A", { duration: { current: 5 * scale, optimal: 2.5 * scale },
        time: { leadCurrent: 3 * scale, cycleCurrent: 2 * scale, leadOptimal: 1.5 * scale, cycleOptimal: scale } })]).process;
      p.units = units;
      const capped = V.analyze.capWait(p, 1, 8).activities[0];
      assert.ok(Math.abs(capped.duration.current - 3 * scale) < 1e-9, units);
      const zero = V.analyze.capWait(p, 0, 8).activities[0];
      assert.ok(Math.abs(zero.time.leadOptimal + zero.time.cycleOptimal - zero.duration.optimal) < 1e-9, units);
      const shared = clone(p); shared.activities.push({ ...clone(shared.activities[0]), id: "B" });
      const second = V.analyze.mergeQueues(shared, () => "shared queue").activities[1];
      assert.ok(Math.abs(second.time.leadOptimal + second.time.cycleOptimal - second.duration.optimal) < 1e-9, units);
      assert.equal(p.activities[0].duration.current, 5 * scale, "what-if must not mutate the source");
    }
  });
  await test("spreadsheet clipboard cells retain embedded newlines, tabs and escaped quotes", () => {
    const text = 'id\tname\tnotes\r\nA\t"A\tname"\t"First line\nSecond ""quoted"" line"\r\nB\tB\tplain\r\n';
    assert.deepEqual(V.table.parseCSV(text, "\t"), [
      ["id", "name", "notes"], ["A", "A\tname", 'First line\nSecond "quoted" line'], ["B", "B", "plain"]
    ]);
    assert.deepEqual(V.table.parseCSV('id,name,notes\nA,A,"contains\ta tab"'), [
      ["id", "name", "notes"], ["A", "A", "contains\ta tab"]
    ]);
  });
  await test("source-format clipboard rows merge without removing tasks or changing dataset units", async () => {
    const d = dataset([task("A"), task("B", { status: "done", notes: "keep this note" })]);
    d.process.units = "business days";
    d.process.title = "Existing process";
    d.process.phases = [{ id: "existing", label: "Existing phase" }];
    d.scenario = { attributes: [{ id: "allow", label: "Allow", type: "boolean", default: true }], rules: { go: { allow: true } } };
    const h = appHarness(d);
    const sheets = { Pasted: [
      ["ID", "Task", "Phase", "Assigned Team", "Predecessor IDs", "Current Lead Time (hrs)", "Current Cycle Time (hrs)", "Optimized Lead Time (hrs)", "Optimized Cycle Time (hrs)", "Include Expression"],
      ["B", "Updated B", "New phase", "New team", "A", 8, 8, 4, 4, "R_go"],
      ["C", "Added C", "New phase", "New team", "B", 16, 8, 8, 4, "R_go"]
    ] };
    await h.api.importSheets(sheets, { name: "pasted table" }, { merge: true });
    const next = h.api.getData();
    assert.deepEqual(clone(next.process.activities.map(a => a.id)), ["A", "B", "C"]);
    assert.equal(next.process.units, "business days");
    assert.equal(next.process.title, "Existing process");
    assert.deepEqual(clone(next.process.activities[0]), d.process.activities[0]);
    const b = next.process.activities[1];
    assert.deepEqual(clone(b.duration), { current: 2, optimal: 1 });
    assert.deepEqual(clone(b.predecessors), ["A"]);
    assert.equal(b.time.leadCurrent, 1);
    assert.equal(b.when, "go");
    assert.equal(b.status, "done");
    assert.equal(b.notes, "keep this note");
    assert.ok(next.process.phases.some(p => p.id === "existing"));
    assert.ok(next.process.phases.some(p => p.id === b.phase));
    assert.ok(next.process.teams[b.owner]);
    assert.deepEqual(clone(next.scenario), d.scenario);
    assert.deepEqual(V.validate.run(next.process, next.taxonomy, next.scenario).errors, []);
    assert.equal(h.messages.at(-1).error, undefined);
  });
  await test("source clipboard preserves omitted fields and rejects broken dependencies before saving", async () => {
    const d = dataset([task("A"), task("B", { phase: "p", owner: "team", predecessors: ["A"], when: false, canOverride: "governed" })]);
    d.process.phases = [{ id: "p", label: "Phase" }];
    d.process.teams = { team: { label: "Team" } };
    const h = appHarness(d);
    const heads = ["ID", "Task", "Current Lead Time (hrs)", "Current Cycle Time (hrs)"];
    await h.api.importSheets({ Pasted: [heads, ["B", "Updated", 10, 2]] }, { name: "pasted table" }, { merge: true });
    const b = h.api.getData().process.activities.find(a => a.id === "B");
    assert.equal(h.api.getData().process.activities.length, 2);
    assert.equal(b.phase, "p"); assert.equal(b.owner, "team"); assert.equal(b.when, false);
    assert.equal(b.canOverride, "governed");
    assert.deepEqual(clone(b.predecessors), ["A"]);
    assert.equal(b.duration.optimal, 4);
    for (const [column, expectedLead, expectedCycle] of [["Optimized Lead Time (hrs)", 1, 1], ["Optimized Cycle Time (hrs)", 3, 1]]) {
      const partial = appHarness(dataset([task("A", { time: { leadCurrent: 6, cycleCurrent: 2, leadOptimal: 3, cycleOptimal: 1 } })]));
      await partial.api.importSheets({ Pasted: [[...heads, column], ["A", "Partial optimized time", 10, 2, 1]] }, { name: "pasted table" }, { merge: true });
      const a = partial.api.getData().process.activities[0];
      assert.equal(a.time.leadOptimal, expectedLead, "omitted optimized lead must survive");
      assert.equal(a.time.cycleOptimal, expectedCycle, "omitted optimized cycle must survive");
      assert.equal(a.duration.optimal, expectedLead + expectedCycle);
    }
    const before = JSON.stringify(h.api.getData()), stored = h.storage.get("vsm.data.v1");
    for (const pred of ["missing", "B"]) {
      await h.api.importSheets({ Pasted: [[...heads, "Predecessor IDs"], ["A", "Bad dependency", 8, 0, pred]] }, { name: "pasted table" }, { merge: true });
      assert.equal(JSON.stringify(h.api.getData()), before);
      assert.equal(h.storage.get("vsm.data.v1"), stored);
      assert.equal(h.messages.at(-1).error, true);
    }
    const file = appHarness(d);
    await file.api.importSheets({ "Task List": [heads, ["B", "File replacement", 10, 2]] }, { name: "source.csv" });
    assert.deepEqual(clone(file.api.getData().process.activities.map(a => a.id)), ["B"], "files remain authoritative replacements");
  });
  await test("source clipboard converts hours to weeks and avoids collisions with live definitions", () => {
    const d = dataset([task("A", { owner: "new-team", phase: "new-phase" })]);
    d.process.units = "weeks";
    d.process.hoursPerDay = 10;
    d.process.teams = { "new-team": { label: "Original team", org: "Original org" }, custom: { label: "Reused team" } };
    d.process.stages = [{ id: "new-stage", label: "Original stage" }];
    d.process.phases = [{ id: "new-phase", label: "Original phase", stage: "new-stage" }];
    const snapshot = JSON.stringify(d);
    const r = V.import.fromSheets({ Pasted: [
      ["ID", "Task", "Phase", "Stage", "Assigned Team", "Current Lead Time (hrs)", "Current Cycle Time (hrs)"],
      ["B", "New B", "New phase", "New stage", "New team", 40, 10],
      ["C", "New C", "New phase", "New stage", "Reused team", 20, 5]
    ] }, { mergeInto: d });
    assert.equal(JSON.stringify(d), snapshot, "preview parsing must not mutate live data");
    const b = r.process.activities[1], c = r.process.activities[2];
    assert.equal(b.duration.current, 1);
    assert.equal(b.time.cycleCurrent, 0.2);
    assert.equal(b.owner, "new-team-2"); assert.equal(c.owner, "custom");
    assert.equal(b.phase, "new-phase-2");
    assert.equal(r.process.phases.find(p => p.id === b.phase).stage, "new-stage-2");
    assert.equal(r.process.teams["new-team"].label, "Original team");
    assert.deepEqual(V.validate.run(r.process, r.taxonomy, r.scenario).errors, []);
  });
  await test("linked folders distinguish missing files from failed reads before loading or saving", async () => {
    const prior = { ...V.files.state };
    const missing = () => Object.assign(new Error("File missing"), { name: "NotFoundError" });
    const denied = () => Object.assign(new Error("Access denied"), { name: "NotAllowedError" });
    let writes = 0, failOptional = true;
    const dir = {
      queryPermission: async () => "granted",
      getFileHandle: async (name, opts) => {
        if (opts?.create) { writes++; return { createWritable: async () => ({ write: async () => {}, close: async () => {} }) }; }
        if (name === V.files.FILES.process) return { getFile: async () => ({ size: 100, text: async () => V.files.wrap("process", dataset([task("A")]).process) }) };
        throw failOptional ? denied() : missing();
      }
    };
    Object.assign(V.files.state, { mode: "linked", dir });
    try {
      await assert.rejects(V.files.reload(), /Access denied/);
      await assert.rejects(V.files.save(dataset([task("B")])), /Access denied/);
      assert.equal(writes, 0, "all reads must succeed before any write starts");
      failOptional = false;
      const loaded = await V.files.reload();
      assert.equal(loaded.process.activities[0].id, "A");
      assert.equal(loaded.taxonomy, undefined, "an absent optional file remains supported");
      const written = await V.files.save(dataset([task("B")]));
      assert.equal(written.length, 3);
    } finally { Object.assign(V.files.state, prior); }
  });
  await test("malformed saved scenarios cannot break the sidebar or erase valid saved runs", () => {
    const run = V.runs.record(build(dataset([task("A")])), {}, "valid");
    const bad = [
      { runId: "missing-fields" }, { ...run, name: {} }, { ...run, totals: null },
      { ...run, includedKeys: "A" }, { ...run, totals: { ...run.totals, elapsed: "bad" } }
    ];
    const store = new Map();
    global.localStorage = { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, v) };
    try {
      store.set(V.runs.storageKey, JSON.stringify([run, ...bad]));
      assert.deepEqual(V.runs.list(), [run], "persisted malformed entries must be skipped");
      V.runs.replaceAll([run]);
      const before = store.get(V.runs.storageKey);
      for (const item of bad) {
        assert.throws(() => V.runs.replaceAll([item]), /invalid saved scenario/i);
        assert.equal(store.get(V.runs.storageKey), before);
      }
      assert.throws(() => V.runs.replaceAll({}), /invalid saved scenario/i);
      assert.equal(store.get(V.runs.storageKey), before);
    } finally { delete global.localStorage; }
  });
  await test("rejected JSON bundles preserve saved scenarios and partial restores report failure", () => {
    const original = V.runs.record(build(dataset([task("A")])), {}, "original");
    const incoming = V.runs.record(build(dataset([task("B")])), {}, "incoming");
    const serialized = JSON.stringify([original]);
    const h = appHarness(dataset([task("A")]));
    h.storage.set(V.runs.storageKey, serialized);
    h.api.loadJSONFile({ name: "bad.json", content: JSON.stringify({ ...dataset([task("bad", { predecessors: ["missing"] })]), runs: [] }) });
    assert.equal(h.storage.get(V.runs.storageKey), serialized, "invalid bundle must not delete saved runs");
    h.api.loadJSONFile({ name: "unrecognized.json", content: JSON.stringify({ runs: [] }) });
    assert.equal(h.storage.get(V.runs.storageKey), serialized);
    h.refuseRunStorage();
    h.api.loadJSONFile({ name: "partial.json", content: JSON.stringify({ ...dataset([task("B")]), runs: [incoming] }) });
    assert.equal(h.api.getData().process.activities[0].id, "B");
    assert.equal(h.storage.get(V.runs.storageKey), serialized);
    assert.equal(h.messages.at(-1).error, true, "a success toast must not hide the failed scenario restore");
    assert.match(h.messages.at(-1).message, /saved scenarios.*not restored/i);
    const good = appHarness(dataset([task("A")]));
    good.api.loadJSONFile({ name: "good.json", content: JSON.stringify({ ...dataset([task("B")]), runs: [incoming] }) });
    assert.equal(JSON.parse(good.storage.get(V.runs.storageKey))[0].name, "incoming");
    assert.equal(good.messages.at(-1).error, undefined);
  });
  await test("designer stays editable after a rejected apply with no stages", () => {
    const create = tag => {
      const n = fakeNode(tag);
      n.events = {};
      n.addEventListener = (event, handler) => { n.events[event] = handler; };
      n.remove = () => { n.removed = true; };
      return n;
    };
    const body = create("body");
    const context = vm.createContext({ VSM: { ...V }, document: {
      body, getElementById: () => null, createElement: create,
      createTextNode: text => ({ text }), addEventListener() {}, removeEventListener() {}
    } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/designer.js"), "utf8"), context);
    let attempts = 0;
    context.VSM.designer.open(dataset([task("A")]), { onApply(candidate) {
      attempts++;
      assert.equal(candidate.stages, undefined, "persisted data can omit empty stages");
      return false; // e.g. quota exceeded; the working copy must survive
    } });
    const descendants = n => [n, ...(n.children || []).flatMap(descendants)];
    const click = label => {
      const button = descendants(body).find(n => n.tag === "button" && (n.children || []).some(c => c.text === label));
      assert.ok(button, label + " exists");
      button.events.click();
    };
    click("Apply changes");
    click("Stages (0)");
    click("Apply changes");
    assert.equal(attempts, 2);
    assert.equal(body.children[0].removed, undefined);
    click("+ Add stage");
    assert.ok(descendants(body).some(n => n.text === "Stages (1)"));
  });
  await test("integration entry points load derivation, tracker and workbook expression engines", () => {
    const root = path.join(__dirname, "..");
    const html = fs.readFileSync(path.join(root, "examples/embedded.html"), "utf8");
    const engine = fs.readFileSync(path.join(root, "examples/backstage-plugin/src/engine.ts"), "utf8");
    const guide = fs.readFileSync(path.join(root, "BACKSTAGE.md"), "utf8");
    const entryPoints = [
      ["embedded example", [...html.matchAll(/<script src="\.\.\/([^"]+)"><\/script>/g)].map(m => m[1])],
      ["Backstage example", [...engine.matchAll(/import '\.\/vsm\/([^']+)'/g)].map(m => m[1] + ".js")],
      ["Backstage guide", [...guide.matchAll(/import '\.\/vsm\/([^']+)'/g)].map(m => m[1] + ".js")]
    ];
    for (const [name, files] of entryPoints) {
      const context = vm.createContext({ TextDecoder, TextEncoder });
      files.forEach(file => vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file }));
      const api = context.VSM;
      api.render.draw = () => fakeNode("svg");
      const data = dataset([task("base"), task("derived-task", { when: { derivedFlag: true } })]);
      data.scenario = { attributes: [{ id: "derivedFlag", label: "Derived", type: "boolean", default: false, derived: true, derive: { when: true } }], rules: {} };
      const chart = api.embed.create(fakeNode("div"), { data });
      assert.equal(chart.getModel().nodes.length, 2, name + " must evaluate derived answers");
      assert.equal(typeof api.progressRender?.draw, "function", name + " must support the documented tracker view");
      let tracked = false;
      api.progressRender.draw = () => { tracked = true; return fakeNode("svg"); };
      chart.update({ view: "tracker" });
      assert.ok(tracked, name + " must use the tracker renderer");
      if (api.import) {
        const result = api.import.fromSheets({ "Task List": [
          ["ID", "Phase", "Task", "Current Lead Time (hrs)", "Current Cycle Time (hrs)", "Include Expression"],
          ["expression-task", "P1", "Expression task", "8", "4", "genAI = true"]
        ] }, {});
        assert.deepEqual(Array.from(result.report.errors), [], name + " workbook must import cleanly");
        assert.deepEqual(clone(result.process.activities[0].when), { genAI: true }, name + " must compile workbook expressions");
      }
    }
  });
  await test("embed data updates validate and replace the chart without mutating caller data", () => {
    const context = vm.createContext({ VSM: { ...V, render: { draw: () => fakeNode("svg") } } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/embed.js"), "utf8"), context);
    const original = Object.freeze(dataset([task("A")]));
    const next = dataset([task("B")]);
    const chart = context.VSM.embed.create(fakeNode("div"), { data: original });
    assert.equal(chart.update({ data: next }).nodes[0].id, "B");
    assert.equal(chart.update({ theme: "light" }).nodes[0].id, "B");
    const model = chart.getModel(), svg = chart.getSvg();
    assert.throws(() => chart.update({ data: dataset([task("bad", { predecessors: ["missing"] })]) }), /Invalid data/);
    assert.equal(chart.getModel(), model);
    assert.equal(chart.getSvg(), svg);
    assert.equal(chart.update({}).nodes[0].id, "B");
    chart.setData(dataset([task("C")]));
    assert.equal(chart.update({}).nodes[0].id, "C");
    assert.equal(original.process.activities[0].id, "A");
    assert.equal(next.process.activities[0].id, "B");
  });
  await test("saved scenarios reject silently dropped replacements and capped saves", () => {
    const store = new Map();
    global.localStorage = { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, v) };
    try {
      const run = V.runs.record(build(dataset([task("A")])), {}, "original");
      V.runs.save(run);
      global.localStorage.setItem = () => {};
      assert.throws(() => V.runs.save({ ...run, name: "changed" }), /did not keep/);
      assert.equal(V.runs.list()[0].name, "original");
      global.localStorage.setItem = (k, v) => store.set(k, v);
      const full = Array.from({ length: 20 }, (_, i) => ({ ...run, runId: "run-" + i }));
      V.runs.replaceAll(full);
      global.localStorage.setItem = () => {};
      assert.throws(() => V.runs.save({ ...run, runId: "new-run" }), /did not keep/);
      assert.throws(() => V.runs.replaceAll(full.map(r => ({ ...r, name: "changed" }))), /did not keep/);
      global.localStorage.setItem = (k, v) => store.set(k, v);
      assert.equal(V.runs.save({ ...run, runId: "new-run" }).at(-1).runId, "new-run");
      assert.equal(V.runs.list().length, 20);
    } finally { delete global.localStorage; }
  });
  await test("embedded scenarios neutralize hidden and diagnostic answers before implications", () => {
    const attrs = [
      { id: "visible", label: "Visible", type: "boolean", default: false },
      { id: "hidden", label: "Hidden", type: "boolean", default: true, shownWhen: { visible: true }, implies: ["implied"] },
      { id: "diagnostic", label: "Diagnostic", type: "boolean", default: true, diagnosticOnly: true },
      { id: "implied", label: "Implied", type: "boolean", default: false }
    ];
    const cfg = { attributes: attrs, rules: {} };
    const data = dataset([task("always"), task("hidden-task", { when: { hidden: true } }),
      task("diagnostic-task", { when: { diagnostic: true } }), task("implied-task", { when: { implied: true } })]);
    const answers = V.rules.defaults(attrs);
    const appModel = V.schedule.build(data.process, data.taxonomy, V.rules.effective(attrs, answers, {}), {}, attrs);
    const embeddedModel = V.schedule.build(data.process, data.taxonomy, V.embed.resolveScenario(cfg), {}, attrs);
    assert.deepEqual(embeddedModel.nodes.map(n => n.id), appModel.nodes.map(n => n.id));
    assert.deepEqual(embeddedModel.nodes.map(n => n.id), ["always"]);
    const visible = V.embed.resolveScenario(cfg, null, { visible: true });
    assert.equal(visible.hidden, true);
    assert.equal(visible.implied, true);
    assert.equal(answers.hidden, true, "neutralizing must preserve the user's stored answer");
  });
  await test("saved scenario reads tolerate a denied localStorage getter", () => {
    Object.defineProperty(global, "localStorage", { configurable: true, get() { throw new Error("Storage denied"); } });
    try {
      assert.equal(V.runs.list().length, 0);
      assert.throws(() => V.runs.save({ runId: "test" }), /Storage denied|no storage/);
    } finally { delete global.localStorage; }
  });
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
        getFile: async () => { throw Object.assign(new Error("new file"), { name: "NotFoundError" }); },
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

  await test("1.3.0: derived attributes resolve inside build and overrides ride along", () => {
    const defs = [
      { id: "serviceTier", label: "Service tier", type: "enum", default: "Tier3",
        options: ["Tier0", "Tier3", "Tier4"].map(v => ({ value: v, label: v })) },
      { id: "drRequired", label: "DR required", type: "boolean", default: false, derived: true,
        derive: { when: { serviceTier: { in: ["Tier0", "Tier3"] } } } }
    ];
    const acts = [task("always"), task("dr-step", { when: { drRequired: true } })];
    const d = { process: { units: "hours", hoursPerDay: 8, activities: acts }, taxonomy: clone(shipped.taxonomy), scenario: { attributes: defs, rules: {} } };
    const on = V.schedule.build(d.process, d.taxonomy, V.rules.defaults(defs), {}, defs);
    assert.ok(on.nodes.some(n => n.id === "dr-step"), "derived true should include the step");
    assert.ok(on.derived && on.derived.provenance.drRequired, "the model carries the derivation");
    const off = V.schedule.build(d.process, d.taxonomy,
      Object.assign(V.rules.defaults(defs), { serviceTier: "Tier4" }), {}, defs);
    assert.ok(!off.nodes.some(n => n.id === "dr-step"), "derived false should exclude the step");
    const forced = V.schedule.build(d.process, d.taxonomy,
      Object.assign(V.rules.defaults(defs), { serviceTier: "Tier4" }), {}, defs,
      { drRequired: { value: true, reason: "regulator says so" } });
    assert.ok(forced.nodes.some(n => n.id === "dr-step"), "the override must win over the derivation");
    assert.equal(forced.derived.overridden.drRequired.reason, "regulator says so");
  });

  await test("1.3.0: derivation shape, option membership and forward references validate", () => {
    const P = { units: "hours", activities: [task("x")] };
    const T = clone(shipped.taxonomy);
    const run = attrs => V.validate.run(P, T, { attributes: attrs, rules: {} });
    const tier = { id: "tier", label: "Tier", type: "enum", default: "t0",
      options: [{ value: "t0" }, { value: "t1" }] };

    /* good: the Task 1 shape validates clean */
    const good = run([tier,
      { id: "dr", label: "DR", type: "boolean", default: false, derived: true, derive: { when: { tier: "t0" } } },
      { id: "lane", label: "Lane", type: "enum", default: "std", options: [{ value: "std" }, { value: "fast" }],
        derived: true, derive: { cases: [{ when: { dr: true }, value: "std" }], default: "fast" } }]);
    assert.equal(good.errors.length, 0, JSON.stringify(good.errors));

    /* forward reference: A reads B, B declared later */
    const fwd = run([tier,
      { id: "a", label: "A", type: "boolean", default: false, derived: true, derive: { when: { b: true } } },
      { id: "b", label: "B", type: "boolean", default: false, derived: true, derive: { when: { tier: "t0" } } }]);
    assert.ok(fwd.errors.some(e => e.includes("'a'") && e.includes("'b'")), JSON.stringify(fwd.errors));

    /* a case value outside the options */
    const badCase = run([tier,
      { id: "lane", label: "Lane", type: "enum", default: "std", options: [{ value: "std" }],
        derived: true, derive: { cases: [{ when: { tier: "t0" }, value: "warp" }], default: "std" } }]);
    assert.ok(badCase.errors.some(e => /warp/.test(e)), JSON.stringify(badCase.errors));

    /* a default outside the options */
    const badDefault = run([tier,
      { id: "lane", label: "Lane", type: "enum", default: "std", options: [{ value: "std" }],
        derived: true, derive: { cases: [{ when: { tier: "t0" }, value: "std" }], default: "warp" } }]);
    assert.ok(badDefault.errors.some(e => /warp/.test(e)), JSON.stringify(badDefault.errors));

    /* a derive rule naming a ghost attribute goes through checkRule */
    const ghost = run([tier,
      { id: "dr", label: "DR", type: "boolean", default: false, derived: true, derive: { when: { teir: "t0" } } }]);
    assert.ok(ghost.errors.some(e => /teir/.test(e)), JSON.stringify(ghost.errors));

    /* derive on a multi is refused */
    const multi = run([tier,
      { id: "m", label: "M", type: "multi", default: [], options: [{ value: "a" }],
        derived: true, derive: { when: { tier: "t0" } } }]);
    assert.ok(multi.errors.some(e => /multi/.test(e)), JSON.stringify(multi.errors));
  });

  await test("1.3.0: the dissolved vocabulary keeps the default map identical", () => {
    /* the shipped default scenario BEFORE the vocabulary change: 39 rows */
    const OLD_DEFAULT_IDS = ["arch-design","biz-case","cab","cloud-cost-approval","cloud-env-dev","cloud-iac","cloud-iam","cloud-landing-zone","cloud-network","cloud-subscription","code-review","data-class","dba-provision","defect-rework","deploy-prod","dev-build","dr-design","dr-env-cloud","dr-test","go-live","hypercare","intake","intake-triage","kickoff","ops-readiness","pen-test","perf-test","privacy-review","privacy-signoff","qa-env-wait","qa-test","release-window","sast","sec-attest","sec-design-review","sec-findings-rework","sizing","threat-model","uat"];
    const d = clone({ process: shipped.process, taxonomy: shipped.taxonomy, scenario: shipped.scenario });
    assert.ok(!d.scenario.attributes.some(a => a.id === "pilotPoc" || a.id === "privacyReview"),
      "the pilotPoc / privacyReview toggles must be dissolved (spec §8.5)");
    const build2 = sc => V.schedule.build(d.process, d.taxonomy,
      Object.assign(V.rules.defaults(d.scenario.attributes), sc || {}), d.scenario.rules, d.scenario.attributes);
    const model = build2();
    assert.deepEqual(model.nodes.map(n => n.id).sort(), OLD_DEFAULT_IDS, "default map must not change");
    assert.equal(model.metrics.currentElapsed, 198, "default elapsed must stay 198 days");
    /* tier drives the DR chain */
    const t4 = build2({ serviceTier: "Tier 4" });
    const dropped = OLD_DEFAULT_IDS.filter(x => !t4.nodes.some(n => n.id === x));
    /* 1.6.0: Tier 4 also needs no performance validation, and that derived
       flag now gates the performance test */
    assert.ok(dropped.length >= 3 && dropped.every(x => /^dr-/.test(x) || x === "perf-test"), JSON.stringify(dropped));
    /* pattern conformance drives the lane, the lane drives the ARB chain */
    const std = build2({ patternConforms: false });
    ["arb", "arb-rework", "sec-design-recheck"].forEach(id =>
      assert.ok(std.nodes.some(n => n.id === id), id + " should appear on the standard lane"));
    assert.equal(std.derived.provenance.architectureLane.value, "standard");
    /* data scope drives privacy: no personal or regulated data, no PIA */
    const noPii = build2({ dataScope: ["internal-business"] });
    assert.ok(!noPii.nodes.some(n => n.id === "privacy-review"), "no regulated data, no privacy impact assessment");
    /* a stale saved state carrying retired ids stays inert */
    const stale = build2({ pilotPoc: true, privacyReview: false });
    assert.deepEqual(stale.nodes.map(n => n.id).sort(), OLD_DEFAULT_IDS, "retired ids must be inert");
  });

  await test("1.3.0: saved browser state survives a vocabulary change", () => {
    /* Startup used to merge saved answers blindly; only the linked-folder
       path filtered them. A retired enum value then evaluated as a ghost:
       every rule reading it went false and rows vanished with no error. */
    const attrs = [
      { id: "hosting", label: "Hosting", type: "enum", default: "azure",
        options: [{ value: "azure" }, { value: "on-prem" }] },
      { id: "integrations", label: "Integrations", type: "multi", default: [],
        options: [{ value: "api-gateway" }, { value: "mft" }] },
      { id: "aiWorkload", label: "AI", type: "boolean", default: false }
    ];
    const h = appHarness({ process: { units: "hours", activities: [task("A")] },
      taxonomy: clone(shipped.taxonomy), scenario: { attributes: attrs, rules: {} } });
    h.storage.set("vsm.state.v1", JSON.stringify({ scenario: {
      hosting: "cloud",                                   // retired option value
      integrations: ["public-internet", "mft"],           // one retired, one alive
      aiWorkload: true,                                   // still valid
      pilotPoc: true                                      // retired attribute id
    } }));
    h.api.loadState();
    const s = h.api.getState().scenario;
    assert.equal(s.hosting, "azure", "a retired enum value must fall back to the default");
    /* JSON compare: the state lives in the VM realm, whose Array prototype
       fails deepStrictEqual against ours on identical values */
    assert.equal(JSON.stringify(s.integrations), JSON.stringify(["mft"]), "retired multi values must be filtered out");
    assert.equal(s.aiWorkload, true, "valid saved answers must survive");
    assert.equal(s.pilotPoc, undefined, "a retired attribute id must not ride along");
  });

  await test("1.3.0: vocabulary v2 - hosting split, network split, sourcing facts", () => {
    const OLD_DEFAULT_IDS = ["arch-design","biz-case","cab","cloud-cost-approval","cloud-env-dev","cloud-iac","cloud-iam","cloud-landing-zone","cloud-network","cloud-subscription","code-review","data-class","dba-provision","defect-rework","deploy-prod","dev-build","dr-design","dr-env-cloud","dr-test","go-live","hypercare","intake","intake-triage","kickoff","ops-readiness","pen-test","perf-test","privacy-review","privacy-signoff","qa-env-wait","qa-test","release-window","sast","sec-attest","sec-design-review","sec-findings-rework","sizing","threat-model","uat"];
    const d = clone({ process: shipped.process, taxonomy: shipped.taxonomy, scenario: shipped.scenario });
    const build2 = sc => V.schedule.build(d.process, d.taxonomy,
      Object.assign(V.rules.defaults(d.scenario.attributes), sc || {}), d.scenario.rules, d.scenario.attributes);
    /* the default map survives its third vocabulary change */
    const dft = build2();
    assert.equal(JSON.stringify(dft.nodes.map(n => n.id).sort()), JSON.stringify(OLD_DEFAULT_IDS));
    assert.equal(dft.metrics.currentElapsed, 198);
    /* §8.2: bare "Cloud" is retired; AWS keeps generic cloud work and drops the Azure-specific rows */
    const hosting = d.scenario.attributes.find(a => a.id === "hosting");
    assert.ok(!hosting.options.some(o => o.value === "cloud"), "bare Cloud must be retired");
    assert.ok(hosting.options.length >= 6, "hosting gains the split targets");
    const aws = build2({ hosting: "aws" });
    ["cloud-network", "cloud-iac", "cloud-cost-approval", "cloud-env-dev"].forEach(id =>
      assert.ok(aws.nodes.some(n => n.id === id), id + " is generic cloud work and must survive AWS"));
    ["cloud-subscription", "cloud-landing-zone", "cloud-iam", "gpu-quota"].forEach(id =>
      assert.ok(!aws.nodes.some(n => n.id === id), id + " is Azure-specific and must drop on AWS"));
    /* §8.6: inbound exposure and outbound dependency are different consequences */
    const inb = build2({ network: ["inbound-internet"] });
    assert.ok(inb.nodes.some(n => n.id === "int-internet"), "inbound triggers the exposure/WAF review");
    assert.ok(!inb.nodes.some(n => n.id === "int-web-proxy"), "inbound alone must not trigger the proxy");
    assert.equal(inb.derived.provenance.wafRequired.value, true);
    const outb = build2({ network: ["outbound-internet"] });
    assert.ok(outb.nodes.some(n => n.id === "int-web-proxy"), "outbound triggers proxy allowlisting");
    assert.ok(!outb.nodes.some(n => n.id === "int-internet"), "outbound alone must not trigger the exposure review");
    assert.equal(outb.derived.provenance.proxyAllowlisting.value, true);
    /* §8.4's common real case: an existing vendor's people need access - SOW
       and onboarding, but no new-vendor contracting and no product selection */
    const svc = build2({ thirdPartyInvolved: true, vendorNeedsOrgAccess: true, professionalServices: true });
    assert.ok(svc.nodes.some(n => n.id === "vendor-onboard"), "access -> onboarding");
    assert.ok(svc.nodes.some(n => n.id === "vendor-risk"), "third party with access -> risk assessment");
    assert.ok(!svc.nodes.some(n => n.id === "vendor-contract"), "no new vendor, no contract negotiation");
    assert.ok(!svc.nodes.some(n => n.id === "vendor-rfp" || n.id === "prod-eval"), "no product selection for a services engagement");
    /* the SaaS profile still lights its vendor chain through the new facts;
       1.6.0: its default route is an evaluation, which is its own step now
       (an RFP only when the selection facts call for one) */
    const saas = d.scenario.presets.find(p => p.id === "adopt-saas");
    const saasModel = build2(saas.set);
    ["prod-eval", "vendor-risk", "vendor-contract"].forEach(id =>
      assert.ok(saasModel.nodes.some(n => n.id === id), id + " must fire for SaaS adoption"));
    /* identity is its own vocabulary now */
    assert.ok(!d.scenario.attributes.find(a => a.id === "integrations").options.some(o => /sso|internet|proxy|private/i.test(o.value)),
      "sso and the network chips leave the integrations group");
    const sso = build2({ identity: ["sso-federation"] });
    assert.ok(sso.nodes.some(n => n.id === "int-sso"), "sso-federation drives the SSO integration");
    /* §8.3: the GenAI split, with its dependents disclosed only when it is on */
    const genAI = d.scenario.attributes.find(a => a.id === "genAiWorkload");
    assert.ok(genAI, "genAiWorkload exists");
    const dep = d.scenario.attributes.find(a => a.id === "genAiMonthlyCostOver1k");
    assert.ok(dep && dep.shownWhen && dep.shownWhen.genAiWorkload === true, "cost dependent discloses on genAI");
    /* every attribute the sidebar renders carries a wizard section */
    const missing = d.scenario.attributes.filter(a => !a.hidden && !a.derived && !a.section).map(a => a.id);
    assert.equal(missing.length, 0, "attributes without a section: " + missing.join(", "));
  });

  await test("1.3.0: shownWhen hides a control's value from evaluation and restores it", () => {
    const attrs = [
      { id: "genAI", label: "GenAI", type: "boolean", default: false, section: 2 },
      { id: "costOver1k", label: "Cost over 1k", type: "boolean", default: false, section: 2,
        shownWhen: { genAI: true } }
    ];
    const h = appHarness({ process: { units: "hours", activities: [task("A"), task("gate", { predecessors: ["A"], when: { costOver1k: true } })] },
      taxonomy: clone(shipped.taxonomy), scenario: { attributes: attrs, rules: {} } });
    h.api.loadState();
    const st = h.api.getState();
    st.scenario.costOver1k = true;          // answered while visible...
    st.scenario.genAI = false;              // ...then its parent turned off
    const hidden = h.api.effectiveScenario();
    assert.equal(hidden.costOver1k, false, "a hidden value must not evaluate");
    st.scenario.genAI = true;
    const shown = h.api.effectiveScenario();
    assert.equal(shown.costOver1k, true, "re-showing restores the retained value");
  });

  await test("1.4.0: the model carries its exclusions and explain() cites real answers", () => {
    const d = clone({ process: shipped.process, taxonomy: shipped.taxonomy, scenario: shipped.scenario });
    const build2 = sc => V.schedule.build(d.process, d.taxonomy,
      Object.assign(V.rules.defaults(d.scenario.attributes), sc || {}), d.scenario.rules, d.scenario.attributes);
    /* RF#1: included + excluded partition the register, three scenarios */
    [ {}, { serviceTier: "Tier 4" }, { hosting: "on-prem", network: ["inbound-internet"] } ].forEach(sc => {
      const m = build2(sc);
      assert.equal(m.nodes.length + m.excluded.length, d.process.activities.length, JSON.stringify(sc));
      const inc = new Set(m.nodes.map(n => n.id));
      assert.ok(m.excluded.every(x => !inc.has(x.id)), "partitions overlap");
    });
    /* an excluded row knows its phase, stage and rule */
    const t4 = build2({ serviceTier: "Tier 4" });
    const dr = t4.excluded.find(x => x.id === "dr-design");
    assert.ok(dr, "dr-design should be excluded at Tier 4");
    assert.equal(dr.phase, "design");
    assert.equal(dr.stage, "deliver");
    assert.ok(dr.when !== undefined);
    /* RF#5: explain expands a named-rule reference into real answers */
    const leaves = V.derive.explain(dr.when, t4.scenario, d.scenario.rules, d.scenario.attributes);
    const tier = leaves.find(l => l.attr === "serviceTier");
    assert.ok(tier && tier.satisfied === false && tier.valueLabel === "Tier 4", JSON.stringify(leaves));
  });

  await test("1.4.0: per-task overrides apply where allowed; Governed gates refuse exclusion", () => {
    const d = clone({ process: shipped.process, taxonomy: shipped.taxonomy, scenario: shipped.scenario });
    const build2 = (sc, ov) => V.schedule.build(d.process, d.taxonomy,
      Object.assign(V.rules.defaults(d.scenario.attributes), sc || {}), d.scenario.rules, d.scenario.attributes, ov);
    /* the sample now uses the Phase 1 field: DR trio overridable, the
       security attestation and CAB governed */
    const byId = Object.fromEntries(d.process.activities.map(a => [a.id, a]));
    assert.equal(byId["dr-design"].canOverride, "yes");
    assert.equal(byId["cab"].canOverride, "governed");
    /* exclude an overridable task */
    const noDr = build2({}, { tasks: { "dr-design": false } });
    assert.ok(!noDr.nodes.some(n => n.id === "dr-design"));
    assert.ok(noDr.taskOverrides && noDr.taskOverrides["dr-design"] === false);
    /* RF#2: a governed gate cannot be switched off */
    const keepCab = build2({}, { tasks: { "cab": false } });
    assert.ok(keepCab.nodes.some(n => n.id === "cab"), "cab must survive");
    assert.ok(keepCab.warnings.some(w => /cab/.test(w) && /governed/i.test(w)), JSON.stringify(keepCab.warnings));
    /* RF#4: forcing a task IN when its rule said no - preds resolve, no orphan */
    const forced = build2({}, { tasks: { "vendor-risk": true } });
    const vr = forced.nodes.find(n => n.id === "vendor-risk");
    assert.ok(vr, "vendor-risk forced in");
    assert.ok(vr.preds.length > 0 && vr.preds.every(pr => forced.nodeById.has(pr)), "preds must resolve");
    /* an unknown id warns rather than silently vanishing */
    const ghost = build2({}, { tasks: { "no-such-task": false } });
    assert.ok(ghost.warnings.some(w => /no-such-task/.test(w)), JSON.stringify(ghost.warnings));
    /* RF#3: the legacy flat 6th-arg shape still means derived overrides */
    const legacy = build2({}, { architectureLane: { value: "custom", reason: "board" } });
    assert.equal(legacy.derived.provenance.architectureLane.value, "custom");
    assert.ok(legacy.nodes.some(n => n.id === "arb"));
  });

  await test("1.4.0: scenario runs record, reload identically, diff, and refuse lying storage", () => {
    /* Node has no localStorage; the module takes the global when present */
    const store = new Map();
    global.localStorage = { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
    try {
      const d = clone({ process: shipped.process, taxonomy: shipped.taxonomy, scenario: shipped.scenario });
      const answers = V.rules.defaults(d.scenario.attributes);
      const build2 = (sc, ov) => V.schedule.build(d.process, d.taxonomy, Object.assign({}, answers, sc || {}), d.scenario.rules, d.scenario.attributes, ov);
      const m1 = build2({}, { derived: { architectureLane: { value: "custom", reason: "board" } }, tasks: {} });
      const run = V.runs.record(m1, { scenario: answers, overrides: { architectureLane: { value: "custom", reason: "board" } }, taskOverrides: {} }, "baseline custom");
      assert.equal(run.name, "baseline custom");
      assert.equal(run.totals.tasks, m1.nodes.length);
      V.runs.save(run);
      assert.equal(V.runs.list().length, 1);
      /* RF#1: reload = rebuild from the run's answers + overrides -> identical */
      const saved = V.runs.list()[0];
      const m2 = build2(saved.answers, { derived: saved.overrides, tasks: saved.taskOverrides });
      assert.equal(JSON.stringify(m2.nodes.map(n => n.id).sort()), JSON.stringify(saved.includedKeys.slice().sort()));
      assert.equal(m2.metrics.currentElapsed, saved.totals.elapsed);
      /* RF#2: diff two profiles */
      const saas = d.scenario.presets.find(p2 => p2.id === "adopt-saas").set;
      const cots = d.scenario.presets.find(p2 => p2.id === "deploy-cots").set;
      const ra = V.runs.record(build2(saas), { scenario: Object.assign({}, answers, saas), overrides: {}, taskOverrides: {} }, "saas");
      const rb = V.runs.record(build2(cots), { scenario: Object.assign({}, answers, cots), overrides: {}, taskOverrides: {} }, "cots");
      const df = V.runs.diff(ra, rb);
      assert.ok(df.addedTasks.length + df.removedTasks.length > 0, "profiles must differ");
      assert.ok(typeof df.elapsedDelta === "number");
      assert.ok(df.changedAnswers.some(c => c.id === "workType" && c.from === "saas" && c.to === "cots"), JSON.stringify(df.changedAnswers));
      /* the ring caps at 20 */
      for (let i = 0; i < 25; i++) V.runs.save(V.runs.record(m1, { scenario: answers, overrides: {}, taskOverrides: {} }, "r" + i));
      assert.equal(V.runs.list().length, 20);
      /* RF#3: storage that accepts and drops the write must throw */
      global.localStorage.setItem = () => {};
      store.clear();
      assert.throws(() => V.runs.save(run), /keep|stor/i);
    } finally { delete global.localStorage; }
  });

  await test("1.4.0: admin core - references found everywhere, impact replays the run's answers", () => {
    /* RF#1: one reference of each kind */
    const syn = {
      process: { units: "hours", activities: [
        task("a", { when: { tier: "t0" } }),
        task("b", { predecessors: ["a"] })
      ] },
      taxonomy: clone(shipped.taxonomy),
      scenario: {
        attributes: [
          { id: "tier", label: "Tier", type: "enum", default: "t0", options: [{ value: "t0" }, { value: "t1" }], section: 4 },
          { id: "gated", label: "Gated", type: "boolean", default: false, shownWhen: { tier: "t0" }, section: 4 },
          { id: "locked", label: "Locked", type: "boolean", default: false, enabledWhen: { tier: "t0" }, section: 4 },
          { id: "dr", label: "DR", type: "boolean", default: false, derived: true, derive: { when: { tier: "t0" } }, section: 4 }
        ],
        rules: { topTier: { tier: "t0" } },
        presets: [{ id: "p1", label: "P1", partial: true, set: { tier: "t1" } }]
      }
    };
    const refs = V.admin.referencesTo(syn, "tier");
    const kinds = refs.map(r => r.kind).sort();
    ["activity", "derive", "enabledWhen", "preset", "rule", "shownWhen"].forEach(k =>
      assert.ok(kinds.includes(k), "missing reference kind " + k + " in " + JSON.stringify(kinds)));
    assert.equal(V.admin.referencesTo(syn, "nothing-uses-this").length, 0);

    /* RF#2: impact uses each run's own answers */
    const store = new Map();
    global.localStorage = { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
    try {
      const d = clone({ process: shipped.process, taxonomy: shipped.taxonomy, scenario: shipped.scenario });
      const answers = V.rules.defaults(d.scenario.attributes);
      const mk = sc => {
        const m = V.schedule.build(d.process, d.taxonomy, Object.assign({}, answers, sc), d.scenario.rules, d.scenario.attributes);
        return V.runs.record(m, { scenario: Object.assign({}, answers, sc), overrides: {}, taskOverrides: {} }, JSON.stringify(sc));
      };
      const baseline = mk({});                       // DR present (Tier 3)
      const tier4 = mk({ serviceTier: "Tier 4" });   // DR already absent
      const candidate = clone(d);
      candidate.scenario.rules.drRequired = false;   // the rule change under preview
      const rows = V.admin.impact(d, candidate, [baseline, tier4]);
      const rb = rows.find(r => r.runId === baseline.runId);
      const r4 = rows.find(r => r.runId === tier4.runId);
      assert.ok(rb.removed.length >= 3 && rb.removed.every(id => /^dr-/.test(id) || id === "dr-test"), JSON.stringify(rb.removed));
      assert.equal(rb.added.length, 0);
      assert.equal(r4.removed.length + r4.added.length, 0, "a Tier 4 run must be untouched: " + JSON.stringify(r4));
      assert.ok(!rb.stale && !r4.stale);
      /* a foreign run with no answers diffs rather than throws */
      assert.equal(V.runs.diff({ includedKeys: [], totals: {} }, { includedKeys: [], totals: {}, answers: { x: 1 } }).changedAnswers.length, 1);
      /* a run that no longer replays under the live data is flagged stale */
      const brokenLive = clone(d); brokenLive.process.activities[0].predecessors = [brokenLive.process.activities[1].id, brokenLive.process.activities[0].id];
      const [rs] = V.admin.impact(brokenLive, d, [baseline]);
      assert.ok(rs.stale, "unreplayable run must read as stale: " + JSON.stringify(rs));
      /* once that change is live, an unrelated edit must not be blamed for it:
         the baseline is stale (recorded with DR) but this edit changes nothing */
      const unrelated = clone(candidate);
      unrelated.scenario.attributes.push({ id: "unused", label: "Unused", type: "boolean", default: false, section: 1 });
      const [again] = V.admin.impact(candidate, unrelated, [baseline]);
      assert.equal(again.added.length + again.removed.length, 0, JSON.stringify(again));
      assert.ok(again.stale, "a run recorded under older rules is flagged stale");
      /* versions append and cap */
      const sc2 = { versions: [] };
      for (let i = 0; i < 105; i++) V.admin.pushVersion(sc2, { target: "t" + i, before: i, after: i + 1 });
      assert.equal(sc2.versions.length, 100);
      assert.equal(sc2.versions[99].target, "t104");
      assert.ok(sc2.versions[0].timestamp); assert.equal(sc2.versions[0].author, "", "author defaults to empty, never missing");
    } finally { delete global.localStorage; }
  });

  await test("1.4.0: the impact replay sees what the chart sees; rule text round-trips bare rule ids", () => {
    /* a disabled answer is neutralized before the build - in the app and in
       the replay alike, or an untouched candidate reports phantom changes */
    const syn = {
      process: { units: "hours", activities: [task("a"), task("g", { predecessors: ["a"], when: { gated: true } })] },
      taxonomy: clone(shipped.taxonomy),
      scenario: {
        attributes: [
          { id: "tier", label: "Tier", type: "enum", default: "t0", options: [{ value: "t0" }, { value: "t1" }], section: 4 },
          { id: "gated", label: "Gated", type: "boolean", default: false, enabledWhen: { tier: "t0" }, section: 4 }
        ],
        rules: {}
      }
    };
    const answers = { tier: "t1", gated: true };           // gated is on but disabled
    const eff = V.rules.effective(syn.scenario.attributes, answers, {});
    assert.equal(eff.gated, false);
    assert.equal(answers.gated, true, "effective() must not touch the person's answers");
    const m = V.schedule.build(syn.process, syn.taxonomy, eff, {}, syn.scenario.attributes);
    const run = V.runs.record(m, { scenario: answers }, "disabled answer");
    assert.deepEqual(run.includedKeys, ["a"]);
    const [row] = V.admin.impact(syn, clone(syn), [run]);
    assert.equal(row.added.length + row.removed.length, 0, "unchanged candidate must replay identically: " + JSON.stringify(row));

    /* the editor names rules R_<id>; shipped rules are keyed bare */
    const d = clone({ process: shipped.process, scenario: shipped.scenario });
    const ids = Object.keys(d.scenario.rules);
    d.process.activities.filter(a => a.when !== undefined).forEach(a => {
      const t = V.admin.ruleToText(a.when);
      if (t.json) return;
      const back = V.admin.textToRule(t.text, d.scenario.attributes, ids).rule;
      assert.deepEqual(back, a.when, a.id + ": " + t.text);
    });
    const vc = V.admin.ruleToText({ any: [{ contractChangeRequired: true }, "newVendor"] });
    assert.equal(vc.text, "contractChangeRequired OR R_newVendor");
    assert.equal(V.admin.textToRule("FALSE", d.scenario.attributes, ids).rule, false);
    /* a self-reference compiles (the name exists) - validation is what refuses it */
    assert.equal(V.admin.textToRule("R_drRequired", d.scenario.attributes, ids).rule, "drRequired");
    /* an unrepresentable shape falls back to JSON rather than lying */
    const j = V.admin.ruleToText({ x: { gte: 3 } });
    assert.ok(j.json && JSON.parse(j.text).x.gte === 3);
    /* errors carry a column and a suggestion */
    try { V.admin.textToRule("serviceTer = \"Tier 1\"", d.scenario.attributes, ids); assert.fail("should throw"); }
    catch (e) { assert.equal(e.column, 1); assert.ok(/did you mean 'serviceTier'/.test(e.message), e.message); }
  });

  await test("1.4.0: admin edits survive a workbook export and re-import", async () => {
    const toMatrix = sh => [sh.headers].concat(sh.rows.map(r => sh.headers.map(h => r[h] === undefined ? "" : r[h])));
    const everything = d => { const all = {}; d.process.activities.forEach(a => { all[a.id] = true; }); return all; };
    const roundTrip = d => {
      const m = V.schedule.build(d.process, d.taxonomy, V.rules.defaults(d.scenario.attributes), d.scenario.rules, d.scenario.attributes, { derived: {}, tasks: everything(d) });
      const sheets = {};
      V.exportWorkbook.sheets(m, { scenarioCfg: d.scenario, scenarioSummary: "" }).forEach(sh => { sheets[sh.name] = toMatrix(sh); });
      return { sheets, r: V.import.fromSheets(sheets, {}) };
    };
    const included = (d, sc) => JSON.stringify(V.schedule.build(d.process, d.taxonomy,
      V.rules.effective(d.scenario.attributes, sc, d.scenario.rules), d.scenario.rules, d.scenario.attributes).nodes.map(n => n.id).sort());

    const buf = fs.readFileSync(path.join(__dirname, "..", "fixture", "sample-value-stream.xlsx"));
    const d = await V.import.fromWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), {});
    const attrs = () => d.scenario.attributes, ids = () => Object.keys(d.scenario.rules);
    /* the edits admin mode makes, through the same helpers it uses */
    d.scenario.rules.R_TopTier = V.admin.textToRule('tier IN ["Tier 0"]', attrs(), ids()).rule;
    attrs().splice(2, 0, { id: "residency", label: "Data must stay in-region?", type: "boolean", default: false, section: 5, group: "Sourcing" });
    const a44 = d.process.activities.find(a => a.id === "44");            // matrix-sourced, carries a multiplier
    V.admin.setCondition(a44, V.admin.textToRule("newService AND R_TopTier", attrs(), ids()).rule);
    const a45 = d.process.activities.find(a => a.id === "45");
    V.admin.setCondition(a45, V.admin.textToRule("residency OR R_Sourcing", attrs(), ids()).rule);
    V.admin.pushVersion(d.scenario, { author: "A. Architect", target: "rule R_TopTier", before: "tier IN [...]", after: 'tier IN ["Tier 0"]' });
    assert.equal(V.validate.run(d.process, d.taxonomy, d.scenario).errors.length, 0);
    assert.equal(a44.appliesWhen, undefined, "an edited condition drops the stale workbook phrase");

    const { sheets, r } = roundTrip(d);
    assert.equal(r.report.errors.length, 0, JSON.stringify(r.report.errors));
    /* nothing new beyond what the source workbook itself warns about, plus the
       expected note on the two edited rows (they keep their matrix rows, which
       still supply multipliers) */
    const noise = r.report.warnings.filter(w => d.report.warnings.indexOf(w) < 0
      && !/^(44|45): has both an Include Expression and a Scenario Matrix row/.test(w));
    assert.deepEqual(noise, [], "unexpected warnings: " + JSON.stringify(noise));
    assert.deepEqual(r.scenario.rules.R_TopTier, { tier: { in: ["Tier 0"] } });
    assert.deepEqual(r.process.activities.find(a => a.id === "44").when, a44.when);
    assert.equal(r.process.activities.find(a => a.id === "44").multipliers.length, 1, "the matrix multiplier still applies");
    assert.deepEqual(r.process.activities.find(a => a.id === "45").when, a45.when);
    assert.deepEqual(r.scenario.attributes.map(a => a.id), attrs().map(a => a.id), "variable order");
    assert.equal(r.scenario.attributes.find(a => a.id === "residency").section, 5);
    assert.equal(JSON.stringify(r.scenario.versions), JSON.stringify(d.scenario.versions), "version log incl. author");
    /* and the thing that matters: every scenario includes the same tasks */
    const base = V.rules.defaults(attrs());
    const scs = [base, Object.assign({}, base, { residency: true }), Object.assign({}, base, { tier: "Tier 1", newService: true })]
      .concat(d.scenario.presets.map(p => V.rules.applyPreset(attrs(), base, p)));
    scs.forEach((sc, i) => assert.equal(included(r, sc), included(d, sc), "scenario #" + i + " changed across the round trip"));
    /* a second trip is a fixed point: same sheets */
    const again = roundTrip(r).sheets;
    ["Task List", "Toggles", "Rules", "Scenario Matrix", "Versions"].forEach(n =>
      assert.equal(JSON.stringify(again[n]), JSON.stringify(sheets[n]), n + " drifted on the second trip"));

    /* a retired variable's (necessarily empty) matrix column is not written back */
    const g = JSON.parse(JSON.stringify(d));
    g.scenario.matrixSheet.headers.push("ghost");
    g.scenario.matrixSheet.rows.forEach(row => row.push(""));
    assert.ok(!roundTrip(g).sheets["Scenario Matrix"][0].includes("ghost"));

    /* the shipped data (bare rule ids, no workbook of origin): conditions and
       named rules come back, and no phantom switches appear */
    const sd = clone({ process: shipped.process, taxonomy: shipped.taxonomy, scenario: shipped.scenario });
    const s2 = roundTrip(sd).r;
    assert.equal(s2.report.errors.length, 0, JSON.stringify(s2.report.errors));
    assert.equal(s2.scenario.attributes.length, sd.scenario.attributes.length, "phantom switches from Applies When phrases");
    /* compared as canonical text: {a, b} and {all: [a, b]} are the same rule,
       and the printer names every rule reference R_ either way */
    const canon = rule => V.admin.ruleToText(rule === undefined ? true : rule).text;
    sd.process.activities.forEach(a => {
      if (V.admin.ruleToText(a.when === undefined ? true : a.when).json) return;
      assert.equal(canon(s2.process.activities.find(x => x.id === a.id).when), canon(a.when), a.id);
    });
    Object.keys(sd.scenario.rules).forEach(id => assert.equal(canon(s2.scenario.rules["R_" + id]), canon(sd.scenario.rules[id]), id));
  });

  await test("1.5.0: the shipped sample survives the workbook round trip - gates, ordered derivations, labels", () => {
    const toMatrix = sh => [sh.headers].concat(sh.rows.map(r => sh.headers.map(h => r[h] === undefined ? "" : r[h])));
    const trip = d => {
      const all = {}; d.process.activities.forEach(a => { all[a.id] = true; });
      const m = V.schedule.build(d.process, d.taxonomy, V.rules.defaults(d.scenario.attributes), d.scenario.rules, d.scenario.attributes, { derived: {}, tasks: all });
      const sheets = {};
      V.exportWorkbook.sheets(m, { scenarioCfg: d.scenario, scenarioSummary: "" }).forEach(sh => { sheets[sh.name] = toMatrix(sh); });
      return { sheets, r: V.import.fromSheets(sheets, {}) };
    };
    const included = (d, sc) => JSON.stringify(V.schedule.build(d.process, d.taxonomy,
      V.rules.effective(d.scenario.attributes, sc, d.scenario.rules), d.scenario.rules, d.scenario.attributes).nodes.map(n => n.id).sort());
    const d = clone({ process: shipped.process, taxonomy: shipped.taxonomy, scenario: shipped.scenario });
    const { sheets, r } = trip(d);
    assert.equal(r.report.errors.length, 0, JSON.stringify(r.report.errors));
    assert.deepEqual(r.report.warnings, [], JSON.stringify(r.report.warnings));
    const byId = id => r.scenario.attributes.find(a => a.id === id);
    /* the fields that had no column */
    assert.deepEqual(byId("patternConforms").enabledWhen, { approvedPatternExists: true });
    assert.deepEqual(byId("hardwareProcurement").enabledWhen, { hosting: "on-prem" });
    assert.equal(byId("workType").hidden, true);
    assert.equal(byId("workType").options.find(o => o.value === "saas").label, "Adopt SaaS");
    const lane = d.scenario.attributes.find(a => a.id === "architectureLane");
    assert.equal(JSON.stringify(byId("architectureLane").derive), JSON.stringify(lane.derive), "ordered cases survive");
    assert.equal(byId("selectionRoute").derive.cases.length, d.scenario.attributes.find(a => a.id === "selectionRoute").derive.cases.length);
    /* and the point: every scenario includes the same tasks */
    const base = V.rules.defaults(d.scenario.attributes);
    const scs = [base,
      Object.assign({}, base, { serviceTier: "Tier 4" }),
      Object.assign({}, base, { serviceTier: "Tier 0", newTechnology: true }),
      Object.assign({}, base, { hosting: "on-prem", hardwareProcurement: true }),
      Object.assign({}, base, { hosting: "azure", hardwareProcurement: true }),      // disabled answer
      Object.assign({}, base, { approvedPatternExists: false, patternConforms: true }),
      Object.assign({}, base, { approvedPatternExists: true, patternConforms: true, serviceTier: "Tier 4" })]
      .concat(d.scenario.presets.map(p => V.rules.applyPreset(d.scenario.attributes, base, p)))
      .concat(d.scenario.presets.map(p => Object.assign(V.rules.applyPreset(d.scenario.attributes, base, p), { requirementsUnderstood: false, unprovenTechnicalClaim: true })));
    scs.forEach((sc, i) => assert.equal(included(r, sc), included(d, sc), "scenario #" + i + " changed across the round trip"));
    /* a second trip changes nothing in the rule layer (the sample's own
       day-based durations and waste taxonomy are converted on the first
       trip; workbook-origin data is held to a full fixed point in 1.4.0) */
    const again = trip(r).sheets;
    ["Toggles", "Rules"].forEach(n => assert.equal(JSON.stringify(again[n]), JSON.stringify(sheets[n]), n + " drifted on the second trip"));

    /* the case syntax on its own: text round trip, and loud failures */
    const attrs = d.scenario.attributes, ids = Object.keys(d.scenario.rules);
    const t = V.admin.derivationToText(lane.derive);
    assert.ok(/^custom WHEN .+; fast WHEN .+; ELSE standard$/.test(t.text), t.text);
    assert.equal(JSON.stringify(V.admin.textToDerivation(t.text, lane, attrs, ids)), JSON.stringify(lane.derive));
    assert.throws(() => V.admin.textToDerivation("sideways WHEN serviceTier = \"Tier 0\"; ELSE standard", lane, attrs, ids), /not one of/);
    assert.throws(() => V.admin.textToDerivation("custom WHEN serviceTeer = x", lane, attrs, ids), /unknown attribute/);
    /* a Derivation cell that reads as cases but does not compile warns - it is not prose */
    const bad = JSON.parse(JSON.stringify(sheets));
    const hd = bad.Toggles[0], row = bad.Toggles.find(x => x[0] === "architectureLane");
    row[hd.indexOf("Derivation")] = "custom WHEN nosuchThing; ELSE standard";
    const rb = V.import.fromSheets(bad, {});
    assert.ok(rb.report.warnings.some(w => /architectureLane/.test(w) && /Derivation/.test(w)), JSON.stringify(rb.report.warnings));
  });

  await test("1.6.0: every menu answer drives work, and the default map does not move", () => {
    const d = clone({ process: shipped.process, taxonomy: shipped.taxonomy, scenario: shipped.scenario });
    const A = d.scenario.attributes, R = d.scenario.rules;
    const base = V.rules.defaults(A);
    const build = sc => V.schedule.build(d.process, d.taxonomy, V.rules.effective(A, sc, R), R, A);
    const sig = sc => {
      const m = build(sc), x = m.metrics, r1 = v => Math.round(v * 10) / 10;
      return JSON.stringify({ el: r1(x.currentElapsed), opt: r1(x.optimalElapsed), exc: r1(x.sumExcess), ho: x.handoffs, g: x.gates, w: r1(x.waitingCurrent), ids: m.nodes.map(n => n.id).sort() });
    };
    const ids = sc => build(sc).nodes.map(n => n.id);

    /* the default map is exactly what 1.5.0 shipped */
    const m0 = build(base).metrics;
    assert.deepEqual([m0.currentElapsed, m0.optimalElapsed, Math.round(m0.sumExcess * 10) / 10, m0.handoffs, m0.gates, m0.waitingCurrent, build(base).nodes.length],
      [198, 90.5, 161.5, 31, 9, 69, 39], "the default map moved");

    /* contexts an answer is flipped in: the default, every preset, and the
       states that switch a gated question on */
    const preset = id => V.rules.applyPreset(A, base, d.scenario.presets.find(p => p.id === id));
    const contexts = [base]
      .concat(d.scenario.presets.map(p => V.rules.applyPreset(A, base, p)))
      .concat([Object.assign({}, base, { hosting: "on-prem" }),
        Object.assign({}, base, { genAiWorkload: true, aiWorkload: true }),
        Object.assign(preset("adopt-saas"), { unprovenTechnicalClaim: true })]);
    /* A value is live when, in some context, it gives a different map from
       at least one other value of the same question. For a multi-select a
       value is compared alone against nothing, and added against removed. */
    const dead = [];
    A.filter(a => !a.derived && !a.hidden).forEach(a => {
      const values = a.type === "boolean" ? [true, false] : (a.options || []).map(o => o.value);
      values.forEach(v => {
        const live = contexts.some(c => {
          const at = val => sig(Object.assign({}, c, { [a.id]: val }));
          if (a.type === "multi") {
            const rest = (Array.isArray(c[a.id]) ? c[a.id] : []).filter(x => x !== v);
            return at([v]) !== at([]) || at(rest.concat([v])) !== at(rest);
          }
          const mine = at(v);
          return values.some(u => u !== v && at(u) !== mine);
        });
        if (!live) dead.push(a.id + "=" + v);
      });
    });
    assert.deepEqual(dead, [], "answers that change nothing in any context: " + dead.join(", "));

    /* every derived value is read by something that reaches the map */
    const unread = A.filter(a => a.derived && !V.admin.referencesTo(d, a.id).some(r => r.kind !== "preset")).map(a => a.id);
    assert.deepEqual(unread, [], "derived values nothing reads: " + unread.join(", "));

    /* RF#3 GenAI is AI/ML plus more */
    const ai = ids(Object.assign({}, base, { aiWorkload: true })), gen = ids(Object.assign({}, base, { genAiWorkload: true }));
    assert.ok(ai.every(id => gen.includes(id)), "GenAI must include every AI/ML step");
    assert.ok(gen.length > ai.length, "GenAI must add its own steps");
    /* RF#4 Paved Road and Custom differ at every tier */
    ["Tier 0", "Tier 1", "Tier 2", "Tier 3", "Tier 4", "tbd"].forEach(t =>
      assert.notEqual(sig(Object.assign(preset("build-paved"), { serviceTier: t })), sig(Object.assign(preset("build-custom"), { serviceTier: t })), "paved = custom at " + t));
    /* RF#5 each selection route has its own shape */
    const saas = preset("adopt-saas");
    const routes = {
      eval: {}, rfp: { competitiveSourcing: true }, "rfi-rfp": { requirementsUnderstood: false },
      "eval-poc": { unprovenTechnicalClaim: true }, "rfp-poc": { competitiveSourcing: true, unprovenTechnicalClaim: true },
      "rfi-rfp-poc": { requirementsUnderstood: false, unprovenTechnicalClaim: true }
    };
    const shapes = Object.keys(routes).map(k => {
      const m = build(Object.assign({}, saas, routes[k]));
      assert.equal(m.derived.provenance.selectionRoute.value, k);
      return JSON.stringify(m.nodes.map(n => n.id).filter(id => /^vendor-|^prod-eval/.test(id)).sort());
    });
    assert.equal(new Set(shapes).size, shapes.length, "selection routes share a task set: " + shapes.join(" | "));
  });

  await test("1.6.1: the version is known, and saved data made against older shipped data is detected", () => {
    /* the constant the UI shows is the VERSION file, not a second copy that drifts */
    assert.equal(V.version.VERSION, fs.readFileSync(path.join(__dirname, "..", "VERSION"), "utf8").trim());
    const shippedNow = clone({ process: shipped.process, taxonomy: shipped.taxonomy, scenario: shipped.scenario });
    const fp = V.version.fingerprint;
    assert.equal(fp(shippedNow.process), fp(clone(shippedNow.process)), "deterministic");
    const moved = clone(shippedNow.process); moved.activities[0].duration.current += 1;
    assert.notEqual(fp(moved), fp(shippedNow.process), "sensitive to one duration");

    /* no saved copy: nothing to warn about */
    assert.equal(V.version.staleness(null, shippedNow), null);
    assert.equal(V.version.staleness({}, shippedNow), null);
    /* a copy saved before 1.6.1 carries no basis: it predates this release by definition */
    const legacy = { process: clone(shippedNow.process), processSource: "edited" };
    const st = V.version.staleness(legacy, shippedNow);
    assert.ok(st && st.savedWith === null && st.parts.join() === "process", JSON.stringify(st));
    /* stamped against today's shipped data: fresh */
    const fresh = V.version.stamp({ process: clone(shippedNow.process), scenario: clone(shippedNow.scenario) }, shippedNow);
    assert.equal(fresh.basis.version, V.version.VERSION);
    assert.equal(V.version.staleness(fresh, shippedNow), null);
    /* the shipped scenario changes under a copy that pins its own scenario: stale, naming the part */
    const newer = clone(shippedNow); newer.scenario.attributes[1].label += " (renamed)";
    assert.deepEqual(V.version.staleness(fresh, newer).parts, ["scenario"]);
    /* ...but a copy that only carries the process does not care: the scenario loads fresh */
    const onlyProcess = V.version.stamp({ process: clone(shippedNow.process) }, shippedNow);
    assert.equal(V.version.staleness(onlyProcess, newer), null);
    /* stamping never touches the saved data itself */
    assert.equal(JSON.stringify(onlyProcess.process), JSON.stringify(shippedNow.process));
  });

  await test("1.6.2: the days/hours switch converts what is shown, never the data", () => {
    const U = V.units;
    const hrs = { units: "hours", hoursPerDay: 8 }, days = { units: "business days" }, wks = { units: "weeks" };
    /* the data's own unit, untouched: auto (or no choice) is the old behaviour */
    ["auto", undefined].forEach(display => {
      const u = U.resolve(hrs, { display });
      assert.equal(u.id, "hours"); assert.equal(u.abbr, "h"); assert.equal(u.v(80), 80); assert.equal(u.tickSize, 8);
    });
    /* hours shown as business days: 80 h is 10 d; a gridline every business week (40 h) */
    const hd = U.resolve(hrs, { display: "days" });
    assert.equal(hd.id, "days"); assert.equal(hd.abbr, "d"); assert.equal(hd.v(80), 10); assert.equal(hd.f(84), "10.5");
    assert.equal(hd.tickSize, 40, "tick spacing stays in the model's (source) unit");
    assert.equal(hd.tickLabel(2), "Wk 2"); assert.equal(hd.originLabel, "Bus. day 0");
    assert.equal(hd.endLabel(1584), "Business day 198");
    assert.equal(hd.secondary(1584), U.resolve(hrs).secondary(1584), "the human translation does not change");
    /* a 10-hour working day is honoured */
    assert.equal(U.resolve({ units: "hours", hoursPerDay: 10 }, { display: "days" }).v(100), 10);
    /* days shown as hours */
    const dh = U.resolve(days, { display: "hours" });
    assert.equal(dh.id, "hours"); assert.equal(dh.v(198), 1584); assert.equal(dh.tickSize, 1); assert.equal(dh.tickLabel(3), "Bus. day 3");
    assert.equal(dh.endLabel(198), "Hour 1584");
    /* weeks convert both ways */
    assert.equal(U.resolve(wks, { display: "days" }).v(2), 10);
    assert.equal(U.resolve(wks, { display: "hours" }).v(1), 40);
    /* asking for the unit the data is already in changes nothing */
    assert.equal(U.resolve(days, { display: "days" }).v(7), 7);
    /* an unknown choice falls back to the data's own unit */
    assert.equal(U.resolve(hrs, { display: "fortnights" }).id, "hours");

    /* end to end: an hours model drawn with days shown says days on the axis */
    withRenderer(render => {
      const acts = [task("a", { duration: { current: 80, optimal: 40 } }), task("b", { predecessors: ["a"], duration: { current: 40, optimal: 8 } })];
      const data = dataset(acts); data.process.units = "hours"; data.process.hoursPerDay = 8;
      const model = build(data);
      const L = V.layout.interactive(2, { width: 1200, zoom: 1, density: "normal", columns: true });
      const texts = svg => walk(svg).filter(e => e.tag === "text").map(e => e.textContent).join(" | ");
      const asHours = texts(render.draw(model, { layout: L, view: "current", display: {}, filters: null, scenarioSummary: "", theme: "dark" }));
      const asDays = texts(render.draw(model, { layout: L, view: "current", display: { timeUnit: "days" }, filters: null, scenarioSummary: "", theme: "dark" }));
      assert.ok(/Hour 120/.test(asHours), asHours.slice(0, 300));
      assert.ok(/Business day 15/.test(asDays), asDays.slice(0, 300));
      assert.ok(/\b10 \/ 5 \/ 5\b/.test(asDays), "row columns in days: " + asDays.slice(0, 400));
      assert.equal(model.metrics.currentElapsed, 120, "the model itself stays in hours");
    });
  });

  await test("1.6.2: a hidden element stays hidden - no display rule without a [hidden] rule", () => {
    /* 1.6.1 gave the stale-data notice display:flex, which beats the hidden
       attribute, and every visitor saw an empty orange bar above the metrics */
    const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
    const css = fs.readFileSync(path.join(__dirname, "..", "css", "app.css"), "utf8");
    const hiddenEls = [...html.matchAll(/<\w+[^>]*>/g)].map(m => m[0]).filter(tag => /\shidden(\s|>|=)/.test(tag));
    const selectors = [];
    hiddenEls.forEach(tag => {
      const id = /\sid="([^"]+)"/.exec(tag);
      if (id) selectors.push("#" + id[1]);
      const cls = /\sclass="([^"]+)"/.exec(tag);
      if (cls) cls[1].split(/\s+/).forEach(c => selectors.push("." + c));
    });
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] }));
    const bad = [];
    selectors.forEach(sel => {
      const esc = sel.replace(/[.#]/g, "\\$&");
      const shows = rules.some(r => /display\s*:\s*(?!none)/.test(r.body) &&
        r.sel.split(",").some(x => new RegExp("^" + esc + "$").test(x.trim())));
      if (!shows) return;
      const guarded = rules.some(r => /display\s*:\s*none/.test(r.body) &&
        r.sel.split(",").some(x => new RegExp("^" + esc + "\\[hidden\\]$").test(x.trim())));
      if (!guarded) bad.push(sel);
    });
    assert.deepEqual(bad, [], "display rules that override [hidden]: " + bad.join(", "));
  });

  console.log("\n" + passed + " regression groups passed, 0 failed");
})().catch(e => { console.error(e); process.exitCode = 1; });
