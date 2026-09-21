/* ============================================================================
   DATA SOURCE  - link the data folder once, then reload and save in place.
   ----------------------------------------------------------------------------
   The workshop loop this enables:
       link the folder once  ->  edit data/process.data.js in your editor
                             ->  click Reload  ->  the chart updates
   and the other direction:
       edit a duration in the app or import a spreadsheet
                             ->  click Save  ->  data/process.data.js is rewritten

   Read/write access is granted by the person through the browser's own folder
   picker; nothing is installed and no server is involved. The handle is kept in
   IndexedDB so a page refresh does not lose the link (the browser still asks to
   confirm permission after a restart).

   Browser support: Chrome / Edge 86+. Firefox and Safari do not implement the
   folder picker, so those fall back to the Load / Download buttons, which work
   everywhere. Everything here is feature-detected; nothing throws if it is absent.
   ========================================================================== */
VSM.files = (function () {
  const DB = "vsm-data-source", STORE = "handles", KEY = "folder";
  const state = { mode: "shipped", dir: null, label: "" };

  const supported = () => typeof window.showDirectoryPicker === "function" && window.isSecureContext !== false;

  /* ---------------------------------------------------- IndexedDB (handle only) */
  function idb(op, value) {
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(DB, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        let tx;
        try { tx = db.transaction(STORE, op === "get" ? "readonly" : "readwrite"); }
        catch (e) { db.close(); reject(e); return; }
        const store = tx.objectStore(STORE);
        const r = op === "get" ? store.get(KEY) : op === "put" ? store.put(value, KEY) : store.delete(KEY);
        tx.oncomplete = () => { db.close(); resolve(r.result); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  }

  /* ---------------------------------------------------- data file parsing
     The data files are JSON wrapped in one line of JavaScript so the app also
     works when opened straight from disk. Read the wrapper off, parse the JSON. */
  const FILES = { process: "process.data.js", taxonomy: "taxonomy.data.js", scenario: "scenario.data.js" };

  /* The shipped data files carry /* ... *\/ section comments, and hand-edited JSON
     often ends up with a trailing comma. Strict JSON.parse rejects both, so strip
     them first, stepping over string literals so a "//" inside a description or a
     URL is never mistaken for a comment. */
  function tolerantParse(body, filename) {
    let out = "", i = 0;
    while (i < body.length) {
      const c = body[i];
      if (c === '"') {                                   // copy a string literal verbatim
        out += c; i++;
        while (i < body.length) {
          if (body[i] === "\\") { out += body[i] + (body[i + 1] || ""); i += 2; continue; }
          out += body[i];
          if (body[i] === '"') { i++; break; }
          i++;
        }
        continue;
      }
      if (c === "/" && body[i + 1] === "/") { while (i < body.length && body[i] !== "\n") i++; continue; }
      if (c === "/" && body[i + 1] === "*") { i += 2; while (i < body.length && !(body[i] === "*" && body[i + 1] === "/")) i++; i += 2; continue; }
      out += c; i++;
    }
    // Remove trailing commas only outside strings. Comments are already gone.
    let clean = "", quoted = false;
    for (let j = 0; j < out.length; j++) {
      const c = out[j];
      if (quoted && c === "\\") { clean += c + (out[++j] || ""); continue; }
      if (c === '"') quoted = !quoted;
      if (!quoted && c === ",") {
        let next = j + 1;
        while (next < out.length && /\s/.test(out[next])) next++;
        if (out[next] === "}" || out[next] === "]") continue;
      }
      clean += c;
    }
    out = clean;
    try { return JSON.parse(out.trim()); }
    catch (e) {
      // point at the line in the ORIGINAL text so the message matches the editor
      const pos = Number((e.message.match(/position (\d+)/) || [])[1]);
      const line = isFinite(pos) ? " near line " + (out.slice(0, pos).split("\n").length) : "";
      throw new Error(filename + ": could not read the JSON" + line + ". " + e.message);
    }
  }

  function unwrap(text, filename) {
    const m = text.match(/VSM\.register\s*\(\s*["'][a-z]+["']\s*,\s*([\s\S]*)\)\s*;?\s*$/);
    return tolerantParse(m ? m[1] : text, filename);
  }

  function wrap(kind, obj, note) {
    const header = "/* " + kind.toUpperCase() + " DATA. Plain JSON inside the VSM.register wrapper.\n"
      + "   " + (note || "Saved by Flowline") + " on " + new Date().toISOString().slice(0, 10) + ".\n"
      + "   Edit, save, then click Reload in the app. See README.md for the field reference. */\n";
    return header + "VSM.register(\"" + kind + "\", " + JSON.stringify(obj, null, 2) + ");\n";
  }

  /* ---------------------------------------------------- folder access */
  async function permission(dir, mode) {
    if (!dir) return "denied";
    const opts = { mode };
    if (await dir.queryPermission(opts) === "granted") return "granted";
    return await dir.requestPermission(opts);
  }

  /* The person may pick the app folder or the data folder inside it. Accept both. */
  async function resolveDataDir(dir) {
    try { await dir.getFileHandle(FILES.process); return dir; }
    catch (e) {
      if (e.name !== "NotFoundError") throw e;
      const sub = await dir.getDirectoryHandle("data");   // throws with a clear name if absent
      await sub.getFileHandle(FILES.process);
      return sub;
    }
  }

  async function readDir(dir) {
    const out = {};
    for (const kind of Object.keys(FILES)) {
      let handle;
      try { handle = await dir.getFileHandle(FILES[kind]); }
      catch (e) { if (kind === "process") throw new Error("No " + FILES.process + " in that folder."); continue; }
      const file = await handle.getFile();
      if (file.size > 8 * 1024 * 1024) throw new Error(FILES[kind] + " is larger than 8 MB.");
      out[kind] = unwrap(await file.text(), FILES[kind]);
    }
    return out;
  }

  async function link() {
    if (!supported()) throw new Error("This browser cannot link a folder. Chrome and Edge can; in Firefox and Safari use Load and Download instead.");
    let picked;
    try { picked = await window.showDirectoryPicker({ mode: "readwrite", id: "vsm-data" }); }
    catch (e) { if (e.name === "AbortError") return null; throw e; }
    let dir;
    try { dir = await resolveDataDir(picked); }
    catch (e) { throw new Error("That folder has no " + FILES.process + " and no data subfolder holding one. Pick the app folder or its data folder."); }
    if (await permission(dir, "readwrite") !== "granted") throw new Error("Read and write permission was not granted.");
    const data = await readDir(dir);
    state.mode = "linked"; state.dir = dir; state.label = dir.name;
    try { await idb("put", dir); } catch (e) { /* private mode: this session only */ }
    return data;
  }

  async function reload() {
    if (state.mode !== "linked" || !state.dir) return null;
    if (await permission(state.dir, "readwrite") !== "granted") throw new Error("Permission to the linked folder was withdrawn. Link the folder again.");
    return readDir(state.dir);
  }

  /* Write the in-app data back to the linked folder. Only files that changed
     against what is on disk are rewritten, so file timestamps stay meaningful. */
  async function save(data, note) {
    if (state.mode !== "linked" || !state.dir) throw new Error("No folder is linked. Use Export to download the file instead.");
    if (await permission(state.dir, "readwrite") !== "granted") throw new Error("Write permission was not granted for the linked folder.");
    /* Serialize and diff everything BEFORE touching the disk, so a failure
       while building one file cannot leave the other two already rewritten.
       Three separate files cannot be written atomically through this API, so
       if a write itself fails part way the error carries the list of files
       that did land and the caller reports it rather than guessing. */
    const pending = [];
    for (const kind of Object.keys(FILES)) {
      if (!data[kind]) continue;
      const text = wrap(kind, data[kind], note);
      let current = null;
      try { current = await (await (await state.dir.getFileHandle(FILES[kind])).getFile()).text(); } catch (e) { /* new file */ }
      // ignore the generated date line when deciding whether anything really changed
      const strip = t => String(t || "").replace(/^\/\*[\s\S]*?\*\/\n/, "");
      if (current !== null && strip(current) === strip(text)) continue;
      pending.push({ name: FILES[kind], text });
    }
    const written = [];
    for (const item of pending) {
      try {
        const handle = await state.dir.getFileHandle(item.name, { create: true });
        const w = await handle.createWritable();
        await w.write(item.text);
        await w.close();
        written.push(item.name);
      } catch (e) {
        const err = new Error("Wrote " + (written.length ? written.join(", ") : "nothing") +
          ", then failed on " + item.name + ": " + e.message +
          (written.length ? ". The folder now holds a mixed set - save again or reload the folder." : ""));
        err.written = written;
        err.failedOn = item.name;
        throw err;
      }
    }
    return written;
  }

  /* On startup, silently restore the handle if permission is still granted.
     A prompt is never shown without a click, so if permission has lapsed we
     report it and the app carries on with the shipped data. */
  async function restore() {
    if (!supported()) return null;
    let dir;
    try { dir = await idb("get"); } catch (e) { return null; }
    if (!dir) return null;
    state.dir = dir; state.label = dir.name;
    let granted = "prompt";
    try { granted = await dir.queryPermission({ mode: "readwrite" }); } catch (e) { return null; }
    if (granted !== "granted") { state.mode = "needs-permission"; return { needsPermission: true }; }
    try {
      const data = await readDir(dir);
      state.mode = "linked";
      return { data };
    } catch (e) { state.mode = "needs-permission"; return { error: e.message }; }
  }

  async function reconnect() {
    if (!state.dir) throw new Error("Nothing to reconnect. Use Link folder.");
    if (await permission(state.dir, "readwrite") !== "granted") throw new Error("Permission was not granted.");
    const data = await readDir(state.dir);
    state.mode = "linked";
    return data;
  }

  async function unlink() {
    state.mode = "shipped"; state.dir = null; state.label = "";
    try { await idb("delete"); } catch (e) { /* ignore */ }
  }

  return { supported, link, reload, save, restore, reconnect, unlink, wrap, unwrap, tolerantParse, state, FILES };
})();
