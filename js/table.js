/* ============================================================================
   TABLE I/O  - activities <-> CSV / Excel (.xlsx), no libraries.
   ----------------------------------------------------------------------------
   The workbook has three sheets: Activities (one row per activity), Teams and
   Phases. On import the Activities sheet is authoritative: rows are updated,
   added, removed and reordered to match the sheet. Unknown fields that exist
   on an activity in the current data (but not as columns) are preserved.

   .xlsx writing: a zip of XML parts with "stored" (uncompressed) entries.
   .xlsx reading: parses the zip directory; deflated parts are inflated with
   the browser's DecompressionStream (Edge/Chrome 103+, Safari 16.4+, Firefox 113+).
   ========================================================================== */
VSM.table = (function () {
  const COLUMNS = [
    { key: "id",           label: "id",           width: 22, hint: "unique key (required)" },
    { key: "name",         label: "name",         width: 42, hint: "label shown next to the bar" },
    { key: "phase",        label: "phase",        width: 12, hint: "phase id (see Phases sheet)" },
    { key: "owner",        label: "owner",        width: 14, hint: "team id (see Teams sheet)" },
    { key: "category",     label: "category",     width: 11, hint: "value | enabling | approval" },
    { key: "waste",        label: "waste",        width: 14, hint: "waste type id or blank" },
    { key: "current",      label: "current",      width: 9,  hint: "current duration (days)", type: "number" },
    { key: "optimal",      label: "optimal",      width: 9,  hint: "optimal duration (days)", type: "number" },
    { key: "predecessors", label: "predecessors", width: 36, hint: "ids separated by ; " },
    { key: "when",         label: "when",         width: 40, hint: "a named rule (e.g. securityReview), an inline rule as JSON, or blank for always" },
    { key: "overrides",    label: "overrides",    width: 40, hint: "JSON array, blank = none" },
    { key: "handoff",      label: "handoff",      width: 9,  hint: "TRUE / FALSE / blank (auto)" },
    { key: "handoffs",     label: "handoffs",     width: 18, hint: "declared handoff predecessor ids; separated" },
    { key: "milestone",    label: "milestone",    width: 10, hint: "TRUE = diamond only" },
    { key: "status",       label: "status",       width: 10, hint: "todo | doing | done | blocked | skipped (project tracking; blank = todo)" },
    { key: "progress",     label: "progress",     width: 10, hint: "0-100, % done of a 'doing' activity", type: "number" },
    { key: "statusnote",   label: "statusnote",   width: 30, hint: "blocked reason / status comment" },
    { key: "statusdate",   label: "statusdate",   width: 12, hint: "YYYY-MM-DD of the last status change" },
    { key: "description",  label: "description",  width: 60, hint: "free text" },
    { key: "notes",        label: "notes",        width: 50, hint: "free text" }
  ];

  /* ------------------------------------------------------------ activity -> row */
  function activityToRow(a) {
    const d = a.duration || {};
    return {
      id: a.id || "", name: a.name || "", phase: a.phase || "", owner: a.owner || "",
      category: a.category || "", waste: a.waste || "",
      current: d.current !== undefined ? d.current : "", optimal: d.optimal !== undefined ? d.optimal : "",
      predecessors: (a.predecessors || []).join("; "),
      // a named rule is written bare so the spreadsheet cell reads "securityReview", not "\"securityReview\""
      when: a.when === undefined || a.when === null ? "" : typeof a.when === "string" ? a.when : JSON.stringify(a.when),
      overrides: a.overrides ? JSON.stringify(a.overrides) : "",
      handoff: a.handoff === true ? "TRUE" : a.handoff === false ? "FALSE" : "",
      handoffs: (a.handoffs || []).join("; "),
      milestone: a.milestone ? "TRUE" : "",
      status: a.status || "", progress: a.progress !== undefined && a.progress !== null ? a.progress : "",
      statusnote: a.statusNote || "", statusdate: a.statusDate || "",
      description: a.description || "", notes: a.notes || ""
    };
  }

  /* ------------------------------------------------------------ rows -> activities */
  const splitIds = v => String(v || "").split(/[;,]/).map(s => s.trim()).filter(Boolean);
  const bool = v => { const s = String(v === undefined || v === null ? "" : v).trim().toLowerCase(); return s === "" ? null : (s === "true" || s === "yes" || s === "1" || s === "x"); };
  const num = v => { if (v === "" || v === null || v === undefined) return null; const n = Number(String(v).replace(",", ".")); return isFinite(n) ? n : null; };

  function rowsToActivities(rows, existing) {
    const byId = new Map((existing || []).map(a => [a.id, a]));
    const out = [], problems = [], seen = new Set();
    rows.forEach((r, i) => {
      const line = i + 2;
      const id = String(r.id || "").trim();
      if (!id) { if (Object.values(r).some(v => String(v || "").trim())) problems.push("Row " + line + ": missing id, skipped"); return; }
      if (seen.has(id)) { problems.push("Row " + line + ": duplicate id '" + id + "', skipped"); return; }
      seen.add(id);
      const a = Object.assign({}, byId.get(id) || {});
      a.id = id;
      a.name = String(r.name || "").trim() || a.name || id;
      a.phase = String(r.phase || "").trim() || undefined;
      a.owner = String(r.owner || "").trim() || undefined;
      a.category = String(r.category || "").trim() || "value";
      const waste = String(r.waste || "").trim();
      if (waste) a.waste = waste; else delete a.waste;
      const cur = num(r.current), opt = num(r.optimal);
      if (cur === null) problems.push("Row " + line + " (" + id + "): current duration is not a number, using 0");
      VSM.schedule.setDuration(a, { current: cur === null ? 0 : cur, optimal: opt === null ? (cur === null ? 0 : cur) : opt });
      a.predecessors = splitIds(r.predecessors);
      const w = String(r.when || "").trim();
      if (w) {
        if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(w) && w !== "true" && w !== "false") a.when = w;   // named rule
        else { try { a.when = JSON.parse(w); } catch (e) { problems.push("Row " + line + " (" + id + "): 'when' is neither a rule name nor valid JSON, treated as always included"); delete a.when; } }
      } else delete a.when;
      const o = String(r.overrides || "").trim();
      if (o) { try { a.overrides = JSON.parse(o); } catch (e) { problems.push("Row " + line + " (" + id + "): 'overrides' is not valid JSON, dropped"); delete a.overrides; } } else delete a.overrides;
      const h = bool(r.handoff); if (h === null) delete a.handoff; else a.handoff = h;
      const hs = splitIds(r.handoffs); if (hs.length) a.handoffs = hs; else delete a.handoffs;
      const m = bool(r.milestone); if (m) a.milestone = true; else delete a.milestone;
      /* tracking columns: optional, tolerant, round-trip clean */
      const st = String(r.status || "").trim().toLowerCase();
      if (st) { a.status = st; if (!["todo", "doing", "done", "blocked", "skipped"].includes(st)) problems.push("Row " + line + " (" + id + "): status '" + r.status + "' is not todo/doing/done/blocked/skipped; it will be treated as not started."); }
      else delete a.status;
      const pg = num(r.progress);
      if (pg !== null) a.progress = Math.max(0, Math.min(100, pg)); else delete a.progress;
      const sn = String(r.statusnote || "").trim(); if (sn) a.statusNote = sn; else delete a.statusNote;
      const sd = String(r.statusdate || "").trim(); if (sd) a.statusDate = sd; else delete a.statusDate;
      const desc = String(r.description || "").trim(); if (desc) a.description = desc; else delete a.description;
      const notes = String(r.notes || "").trim(); if (notes) a.notes = notes; else delete a.notes;
      // tidy key order for readable JSON
      const ordered = {};
      ["id", "name", "phase", "owner", "category", "waste", "duration", "predecessors", "when", "overrides", "handoff", "handoffs", "milestone", "status", "progress", "statusNote", "statusDate", "description", "notes"].forEach(k => { if (a[k] !== undefined) ordered[k] = a[k]; });
      Object.keys(a).forEach(k => { if (ordered[k] === undefined) ordered[k] = a[k]; });
      out.push(ordered);
    });
    const ids = new Set(out.map(a => a.id));
    out.forEach(a => a.predecessors.forEach(p => { if (!ids.has(p)) problems.push(a.id + ": predecessor '" + p + "' does not exist"); }));
    const summary = {
      updated: out.filter(a => byId.has(a.id)).length,
      added: out.filter(a => !byId.has(a.id)).length,
      removed: (existing || []).filter(a => !ids.has(a.id)).length
    };
    return { activities: out, problems, summary };
  }

  /* ------------------------------------------------------------ CSV */
  function csvEscape(v) {
    let s = v === null || v === undefined ? "" : String(v);
    // Quoting alone does not stop spreadsheet formula evaluation. Keep actual
    // numbers numeric; prefix potentially executable text with an apostrophe.
    if (typeof v !== "number" && (/^[\s\uFEFF]*[=+\-@＝＋－＠]/u.test(s) || /^[\t\r\n]/.test(s))) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(headers, rows) {
    const lines = [headers.map(csvEscape).join(",")];
    rows.forEach(r => lines.push(headers.map(h => csvEscape(r[h])).join(",")));
    return "﻿" + lines.join("\r\n");
  }
  function parseCSV(text) {
    text = text.replace(/^﻿/, "");
    const rows = []; let row = [], field = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\r") { /* skip */ }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(v => v !== ""));
  }
  function toObjects(matrix) {
    if (!matrix.length) return [];
    const headers = matrix[0].map(h => String(h || "").trim().toLowerCase());
    return matrix.slice(1).map(r => { const o = {}; headers.forEach((h, i) => { if (h) o[h] = r[i] === undefined ? "" : r[i]; }); return o; });
  }

  /* ------------------------------------------------------------ minimal zip (stored) */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zipStored(files) {
    const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
    const u16 = v => [v & 255, (v >> 8) & 255], u32 = v => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
    files.forEach(f => {
      const name = enc.encode(f.name), data = enc.encode(f.content), crc = crc32(data);
      const head = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)]);
      parts.push(head, name, data);
      central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
      offset += head.length + name.length + data.length;
    });
    const cdStart = offset, cdLen = central.reduce((s, p) => s + p.length, 0);
    const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdLen), ...u32(cdStart), ...u16(0)]);
    return new Blob([...parts, ...central, end], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  /* ------------------------------------------------------------ xlsx writer */
  const xml = s => String(s === null || s === undefined ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const colName = i => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  function sheetXML(headers, rows, widths) {
    let s = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
    if (widths) s += "<cols>" + widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join("") + "</cols>";
    s += "<sheetData>";
    const cell = (r, c, v, style) => {
      const ref = colName(c) + r;
      if (v === null || v === undefined || v === "") return "";
      if (typeof v === "number") return '<c r="' + ref + '"' + (style ? ' s="' + style + '"' : "") + "><v>" + v + "</v></c>";
      return '<c r="' + ref + '" t="inlineStr"' + (style ? ' s="' + style + '"' : "") + "><is><t xml:space=\"preserve\">" + xml(v) + "</t></is></c>";
    };
    s += '<row r="1">' + headers.map((h, c) => cell(1, c, h, 1)).join("") + "</row>";
    rows.forEach((r, i) => { s += '<row r="' + (i + 2) + '">' + headers.map((h, c) => cell(i + 2, c, r[h])).join("") + "</row>"; });
    s += "</sheetData></worksheet>";
    return s;
  }
  function toXLSX(sheets) {
    const files = [];
    files.push({ name: "[Content_Types].xml", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join("") + "</Types>" });
    files.push({ name: "_rels/.rels", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' });
    files.push({ name: "xl/workbook.xml", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map((s, i) => '<sheet name="' + xml(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join("") + "</sheets></workbook>" });
    files.push({ name: "xl/_rels/workbook.xml.rels", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join("") + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' });
    files.push({ name: "xl/styles.xml", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F1"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' });
    sheets.forEach((s, i) => files.push({ name: "xl/worksheets/sheet" + (i + 1) + ".xml", content: sheetXML(s.headers, s.rows, s.widths) }));
    return zipStored(files);
  }

  /* ------------------------------------------------------------ xlsx reader */
  const XLSX_LIMITS = Object.freeze({
    compressedBytes: 16 * 1024 * 1024, entries: 1024,
    partBytes: 16 * 1024 * 1024, expandedBytes: 32 * 1024 * 1024,
    sheets: 64, rows: 100000, cells: 250000, columns: 256,
    rowIndex: 1048576
  });
  async function unzip(buffer) {
    if (buffer.byteLength > XLSX_LIMITS.compressedBytes) throw new Error("Workbook exceeds the 16 MB input limit");
    const dv = new DataView(buffer), u8 = new Uint8Array(buffer);
    const bounds = (offset, size) => {
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset + size > u8.length) throw new Error("Truncated or invalid zip entry");
    };
    let eocd = -1;
    for (let i = u8.length - 22; i >= 0 && i >= u8.length - 70000; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error("Not a zip / xlsx file");
    const count = dv.getUint16(eocd + 10, true), cdOff = dv.getUint32(eocd + 16, true);
    if (count > XLSX_LIMITS.entries) throw new Error("Workbook has too many zip entries");
    if (dv.getUint16(eocd + 4, true) || dv.getUint16(eocd + 6, true)) throw new Error("Multi-disk zip is not supported");
    const cdSize = dv.getUint32(eocd + 12, true);
    bounds(cdOff, cdSize);
    if (cdOff + cdSize > eocd) throw new Error("Invalid zip directory size");
    const dec = new TextDecoder(), entries = new Map(), cache = new Map();
    let p = cdOff;
    for (let i = 0; i < count; i++) {
      bounds(p, 46);
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("Bad zip directory");
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), loff = dv.getUint32(p + 42, true);
      bounds(p, 46 + nlen + elen + clen);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      if (entries.has(name)) throw new Error("Duplicate zip entry: " + name);
      bounds(loff, 30);
      if (dv.getUint32(loff, true) !== 0x04034b50) throw new Error("Bad zip local header");
      const lnlen = dv.getUint16(loff + 26, true), lelen = dv.getUint16(loff + 28, true);
      const start = loff + 30 + lnlen + lelen;
      bounds(start, csize);
      entries.set(name, { start, csize, method, size: dv.getUint32(p + 24, true), crc: dv.getUint32(p + 16, true), flags: dv.getUint16(p + 8, true) });
      p += 46 + nlen + elen + clen;
    }
    if (p !== cdOff + cdSize) throw new Error("Invalid zip directory length");
    let expanded = 0;
    // Inflate only XML parts referenced by the workbook. Enforce the actual
    // streamed byte count as well as metadata: declared sizes can be forged.
    async function get(name) {
      if (cache.has(name)) return cache.get(name);
      const entry = entries.get(name);
      if (!entry) return "";
      if (entry.flags & 1) throw new Error("Encrypted workbooks are not supported");
      if (entry.size > XLSX_LIMITS.partBytes || expanded + entry.size > XLSX_LIMITS.expandedBytes) throw new Error("Workbook exceeds the expanded XML size limit");
      const data = u8.subarray(entry.start, entry.start + entry.csize);
      let bytes;
      if (entry.method === 0) {
        if (data.length > XLSX_LIMITS.partBytes || expanded + data.length > XLSX_LIMITS.expandedBytes) throw new Error("Workbook exceeds the expanded XML size limit");
        bytes = data;
        expanded += bytes.length;
      } else if (entry.method === 8) {
        if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot inflate .xlsx parts; save as CSV instead");
        const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
        const chunks = [];
        let size = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength; expanded += value.byteLength;
            if (size > XLSX_LIMITS.partBytes || expanded > XLSX_LIMITS.expandedBytes) throw new Error("Workbook exceeds the expanded XML size limit");
            chunks.push(value);
          }
        } catch (e) { await reader.cancel().catch(() => {}); throw e; }
        finally { reader.releaseLock(); }
        bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      } else throw new Error("Unsupported zip compression " + entry.method);
      if (bytes.length !== entry.size || crc32(bytes) !== entry.crc) throw new Error("Corrupt workbook zip entry: " + name);
      const text = dec.decode(bytes);
      cache.set(name, text);
      return text;
    }
    return { get };
  }
  /* ------------------------------------------------------------ minimal XML scan
     Deliberately NOT DOMParser. Spreadsheet XML is a narrow, predictable shape
     (no nesting of row-in-row or c-in-c), so a tag scanner reads it correctly -
     and, unlike DOMParser, it also runs under Node, which is what makes the
     import path testable from a command line with no browser. */
  const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  function unesc(s) {
    return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (m, e) => {
      if (e[0] === "#") {
        const n = Number(e[1] === "x" || e[1] === "X" ? "0" + e.slice(1) : e.slice(1));
        /* String.fromCodePoint throws a RangeError above 0x10FFFF, which would
           escape parseXLSX as an internal error rather than a readable one.
           An out-of-range reference is not valid XML, so leave it as written. */
        if (!Number.isInteger(n) || n < 0 || n > 0x10FFFF) return m;
        return String.fromCodePoint(n);
      }
      return ENT[e] !== undefined ? ENT[e] : m;
    });
  }
  /* Attribute scanner.

     This used to be /([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g applied to the whole
     region between <tag and >. That region is attacker-controlled, and on a long
     run of name characters that never reaches ="..." the engine retries from
     every position, which is quadratic: a 51 KB workbook carrying one padded
     start tag took 55 seconds to parse, and the cost grows with the square of
     the padding while the file stays small enough to pass every size limit.

     A single forward pass cannot backtrack, so the cost is now linear in the
     length of the region. It also accepts single-quoted values, which the
     regex silently dropped. */
  const NAME_START = c => (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "_" || c === ":";
  const NAME_CHAR = c => NAME_START(c) || (c >= "0" && c <= "9") || c === "." || c === "-";
  const isWS = c => c === " " || c === "\t" || c === "\n" || c === "\r";
  function attrs(s) {
    const out = Object.create(null);   // an attribute literally named __proto__ must stay a plain key
    if (!s) return out;
    let i = 0;
    const n = s.length;
    while (i < n) {
      while (i < n && isWS(s[i])) i++;
      if (i >= n) break;
      if (!NAME_START(s[i])) { i++; continue; }         // junk: step over one character
      const nameStart = i;
      while (i < n && NAME_CHAR(s[i])) i++;
      const name = s.slice(nameStart, i);
      while (i < n && isWS(s[i])) i++;
      if (s[i] !== "=") continue;                        // a bare name, no value
      i++;
      while (i < n && isWS(s[i])) i++;
      const q = s[i];
      if (q !== '"' && q !== "'") continue;              // unquoted values are not valid XML
      const close = s.indexOf(q, i + 1);
      if (close < 0) break;                              // unterminated: nothing useful left
      out[name] = unesc(s.slice(i + 1, close));
      i = close + 1;
    }
    return out;
  }
  /* Comment and CDATA scanning.

     These two functions used to ask indexOf for the next "<!--", the next
     "<![CDATA[" and the next close tag on EVERY comment, each time starting
     over from the cursor. A search for a needle the part does not contain
     scans to the end of the part, so the cost grew with the square of the
     number of comments: a 1 KB workbook carrying 60,000 empty comments took
     20 seconds, which is the same hang the attribute scanner was rewritten to
     remove, reintroduced one function along.

     Caching each indexOf and only re-running it once its answer fell behind
     the cursor made the algorithm linear on paper, and it still ran quadratic
     in practice: once a search had seen more than one string representation
     the call sites fell off their fast path and every lookup scanned the whole
     part again. So both functions now do what attrs() does - walk the string
     once, one character at a time, with a cursor that only ever moves forward.
     There is nothing left for an engine to be clever about. */
  const LT = 60, BANG = 33, DASH = 45;
  /* index just past the terminator, or -1 if it never arrives */
  function skipPast(s, term, from) {
    const n = s.length, first = term.charCodeAt(0), len = term.length;
    for (let i = from; i <= n - len; i++) {
      if (s.charCodeAt(i) === first && s.startsWith(term, i)) return i + len;
    }
    return -1;
  }
  /* Is a comment or CDATA section opening at i? Returns its terminator, or "". */
  function opensSkippable(s, i) {
    if (s.charCodeAt(i) !== LT || s.charCodeAt(i + 1) !== BANG) return "";
    if (s.charCodeAt(i + 2) === DASH && s.charCodeAt(i + 3) === DASH) return "-->";
    if (s.startsWith("[CDATA[", i + 2)) return "]]>";
    return "";
  }
  /* Find the real close tag, stepping over comments and CDATA sections so a
     literal "</t>" written inside either one does not truncate the element. */
  function findClose(xml, close, from) {
    const n = xml.length, first = close.charCodeAt(0), len = close.length;
    let i = from;
    while (i <= n - len) {
      if (xml.charCodeAt(i) === LT) {
        const term = opensSkippable(xml, i);
        if (term) {
          const past = skipPast(xml, term, i + (term === "-->" ? 4 : 9));
          if (past < 0) {
            // unterminated; fall back to the first literal match, as before
            for (let j = i; j <= n - len; j++) if (xml.charCodeAt(j) === first && xml.startsWith(close, j)) return j;
            return -1;
          }
          i = past;
          continue;
        }
      }
      if (xml.charCodeAt(i) === first && xml.startsWith(close, i)) return i;
      i++;
    }
    return -1;
  }
  /* every <tag ...>inner</tag> and <tag .../> at any depth, in document order */
  function nodes(xml, tag) {
    const out = [];
    if (!xml) return out;
    const re = new RegExp("<" + tag + "(\\s[^>]*?)?(/?)>", "g");
    const close = "</" + tag + ">";
    let m;
    while ((m = re.exec(xml))) {
      if (m[2] === "/") { out.push({ attrs: attrs(m[1]), inner: "" }); continue; }
      const start = m.index + m[0].length;
      const end = findClose(xml, close, start);
      if (end < 0) break;
      out.push({ attrs: attrs(m[1]), inner: xml.slice(start, end) });
      re.lastIndex = end + close.length;
    }
    return out;
  }
  /* concatenated text of every <t> inside, entity-decoded */
  /* Comments carry no data; CDATA carries it verbatim and must not be
     entity-decoded a second time. */
  function plain(str) {
    const n = str.length;
    let out = "", seg = 0, i = 0;                     // seg = start of the run of ordinary text
    while (i < n) {
      if (str.charCodeAt(i) !== LT) { i++; continue; }
      const term = opensSkippable(str, i);
      if (!term) { i++; continue; }
      const open = term === "-->" ? 4 : 9;
      const past = skipPast(str, term, i + open);
      if (past < 0) { out += unesc(str.slice(seg, i)); return out; }   // unterminated: drop the remainder
      out += unesc(str.slice(seg, i));
      // CDATA payload is already literal and must not be entity-decoded again
      if (term === "]]>") out += str.slice(i + 9, past - 3);
      i = past;
      seg = past;
    }
    return out + unesc(str.slice(seg));
  }
  const textOf = inner => nodes(inner, "t").map(n => plain(n.inner)).join("");
  function firstText(inner, tag) {
    const n = nodes(inner, tag)[0];
    return n ? plain(n.inner) : null;
  }

  function cellText(cell, shared) {
    const t = cell.attrs.t;
    if (t === "s") { const v = firstText(cell.inner, "v"); return shared[Number(v || 0)] || ""; }
    if (t === "inlineStr") return textOf(cell.inner);
    const v = firstText(cell.inner, "v");
    if (v === null) return "";
    if (t === "b") return v === "1" ? "TRUE" : "FALSE";
    if (t === "str" || t === "e") return v;
    const n = Number(v);
    return isFinite(n) ? n : v;
  }

  async function parseXLSX(buffer) {
    const files = await unzip(buffer);
    const workbook = await files.get("xl/workbook.xml");
    if (!workbook) throw new Error("Not an .xlsx workbook (no xl/workbook.xml inside)");
    const relMap = Object.create(null);
    nodes(await files.get("xl/_rels/workbook.xml.rels"), "Relationship").forEach(r => { relMap[r.attrs.Id] = r.attrs.Target; });
    const shared = nodes(await files.get("xl/sharedStrings.xml"), "si").map(si => textOf(si.inner));
    const sheets = Object.create(null), sheetNodes = nodes(workbook, "sheet");
    if (sheetNodes.length > XLSX_LIMITS.sheets) throw new Error("Workbook has too many sheets");
    let rowCount = 0, cellCount = 0;
    for (const [i, sh] of sheetNodes.entries()) {
      const rid = sh.attrs["r:id"] || sh.attrs.id;
      let target = relMap[rid] || ("worksheets/sheet" + (i + 1) + ".xml");
      target = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");
      const xml = await files.get(target);
      const matrix = new Map();
      let previousRow = 0;
      nodes(xml, "row").forEach(row => {
        if (++rowCount > XLSX_LIMITS.rows) throw new Error("Workbook has too many rows");
        const r = row.attrs.r === undefined ? previousRow + 1 : Number(row.attrs.r);
        if (!Number.isInteger(r) || r < 1 || r > XLSX_LIMITS.rowIndex || matrix.has(r)) throw new Error("Invalid or duplicate workbook row index");
        previousRow = r;
        const arr = [];
        matrix.set(r, arr);
        nodes(row.inner, "c").forEach((c, ci0) => {
          if (++cellCount > XLSX_LIMITS.cells) throw new Error("Workbook has too many cells");
          const ref = c.attrs.r || "", match = /^([A-Za-z]{1,3})([1-9][0-9]*)$/.exec(ref);
          if (ref && (!match || Number(match[2]) !== r)) throw new Error("Invalid workbook cell reference");
          const letters = match ? match[1] : "";
          let ci = 0; for (const ch of letters) ci = ci * 26 + (ch.toUpperCase().charCodeAt(0) - 64);
          ci = ci ? ci - 1 : ci0;                      // fall back to position if r is absent
          if (ci >= XLSX_LIMITS.columns) throw new Error("Workbook exceeds the 256-column limit");
          arr[ci] = cellText(c, shared);
        });
      });
      sheets[sh.attrs.name] = [...matrix.entries()].sort((a, b) => a[0] - b[0]).map(entry => entry[1]).filter(r => r.some(v => v !== undefined && v !== ""));
    }
    return sheets;
  }

  /* ------------------------------------------------------------ public: build workbook / csv from process */
  function activitiesRows(process) { return (process.activities || []).map(activityToRow); }
  function workbookSheets(process) {
    const teams = process.teams || {}, phases = process.phases || [];
    return [
      { name: "Activities", headers: COLUMNS.map(c => c.key), widths: COLUMNS.map(c => c.width), rows: activitiesRows(process) },
      { name: "Teams", headers: ["id", "label", "org"], widths: [16, 34, 18], rows: Object.keys(teams).map(id => ({ id, label: teams[id].label || "", org: teams[id].org || "" })) },
      { name: "Phases", headers: ["id", "label", "short"], widths: [14, 30, 14], rows: phases.map(p => ({ id: p.id, label: p.label || "", short: p.short || "" })) },
      { name: "Columns", headers: ["column", "meaning"], widths: [16, 60], rows: COLUMNS.map(c => ({ column: c.key, meaning: c.hint })) }
    ];
  }
  function exportXLSX(process, filename) { VSM.exporter.download(toXLSX(workbookSheets(process)), filename || "activities.xlsx"); }
  function exportCSV(process, filename) { VSM.exporter.download(new Blob([toCSV(COLUMNS.map(c => c.key), activitiesRows(process))], { type: "text/csv;charset=utf-8" }), filename || "activities.csv"); }

  /* Parse an uploaded file into { activities, teams?, phases?, problems, summary } */
  async function importFile(file, process, parsedSheets) {
    let sheets = parsedSheets;
    if (sheets) { /* reuse an already inspected file */ }
    else if (/\.xlsx$/i.test(file.name)) {
      if (file.size > XLSX_LIMITS.compressedBytes) throw new Error("Workbook exceeds the 16 MB input limit");
      sheets = await parseXLSX(await file.arrayBuffer());
    }
    else if (/\.csv$/i.test(file.name)) sheets = { Activities: parseCSV(await file.text()) };
    else throw new Error("Expected a .xlsx or .csv file");
    const source = VSM.schema && Object.values(sheets).some(matrix => {
      if (!matrix.length) return false;
      const index = VSM.schema.matchHeaders(matrix[0], VSM.schema.TASK).index;
      return ["id", "name", "leadCur", "cycleCur"].every(k => index[k] !== undefined);
    });
    if (source) {
      if (!VSM.import) throw new Error("Task List import requires js/import.js");
      const result = VSM.import.fromSheets(sheets, { source: file.name });
      if (result.report.errors.length) throw new Error(result.report.errors[0]);
      const issues = VSM.validate.run(result.process, result.taxonomy, result.scenario);
      if (issues.errors.length) throw new Error(issues.errors[0]);
      const oldIds = new Set((process.activities || []).map(a => a.id));
      const newIds = new Set(result.process.activities.map(a => a.id));
      return {
        activities: result.process.activities, teams: result.process.teams, phases: result.process.phases,
        // Source-format imports replace the complete data set, including units.
        data: { process: result.process, taxonomy: result.taxonomy, scenario: result.scenario },
        problems: result.report.warnings,
        summary: {
          updated: [...newIds].filter(id => oldIds.has(id)).length,
          added: [...newIds].filter(id => !oldIds.has(id)).length,
          removed: [...oldIds].filter(id => !newIds.has(id)).length
        }
      };
    }
    const actSheet = sheets.Activities || sheets.activities || Object.values(sheets)[0];
    if (!actSheet || !actSheet.length) throw new Error("No Activities sheet / rows found");
    const headers = actSheet[0].map(h => String(h || "").trim().toLowerCase());
    if (!headers.includes("id") || !headers.includes("name")) throw new Error("The first row must contain at least the 'id' and 'name' columns");
    const result = rowsToActivities(toObjects(actSheet), process.activities || []);
    if (sheets.Teams && sheets.Teams.length > 1) {
      const teams = {};
      toObjects(sheets.Teams).forEach(r => { const id = String(r.id || "").trim(); if (id) teams[id] = { label: String(r.label || id), org: String(r.org || "") || undefined }; });
      result.teams = teams;
    }
    if (sheets.Phases && sheets.Phases.length > 1) {
      result.phases = toObjects(sheets.Phases).map(r => ({ id: String(r.id || "").trim(), label: String(r.label || r.id || ""), short: String(r.short || "") || undefined })).filter(p => p.id);
    }
    return result;
  }

  return { COLUMNS, XLSX_LIMITS, activityToRow, rowsToActivities, toCSV, parseCSV, toObjects, toXLSX, parseXLSX, exportXLSX, exportCSV, importFile };
})();
if (typeof module !== "undefined" && module.exports) module.exports = VSM.table;
