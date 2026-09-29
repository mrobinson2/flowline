/* ============================================================================
   VERSION - which Flowline this is, and whether saved data predates it.
   ----------------------------------------------------------------------------
   Data imported, loaded or edited in the app is saved in the browser as a full
   copy of the parts it replaces (process, taxonomy, scenario), and that copy
   wins over the shipped files on every later visit. Before 1.6.1 that was
   silent across upgrades: a copy saved against 1.5 kept hiding the 1.6 sample
   with nothing on screen to say so.

   So every saved copy is stamped with a BASIS - the version and a fingerprint
   of each shipped part as it was when the copy was saved - and startup asks
   whether any part the copy replaces has changed in the shipped files since.
   Only the parts the copy carries count: a copy holding just the process does
   not pin the questions, so a change to the shipped scenario reaches it anyway.

   VERSION must equal the VERSION file; a regression holds them together.
   ========================================================================== */
(function (root) {
  const VSM = root.VSM = root.VSM || {};
  const VERSION = "1.6.2";
  const PARTS = ["process", "taxonomy", "scenario"];

  /* FNV-1a over the JSON text: stable, dependency-free, and enough to tell
     "the same data" from "not the same data" - this is not a security hash */
  function fingerprint(value) {
    const text = JSON.stringify(value === undefined ? null : value);
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
  }

  /* records what the shipped files were when this copy was saved */
  function stamp(override, shipped) {
    const fingerprints = {};
    PARTS.forEach(p => { fingerprints[p] = fingerprint(shipped && shipped[p]); });
    override.basis = { version: VERSION, fingerprints };
    return override;
  }

  /* -> null when nothing to say, else { savedWith: version|null, parts: [...] }
     naming the replaced parts whose shipped files changed since the save */
  function staleness(override, shipped) {
    if (!override || typeof override !== "object") return null;
    const carried = PARTS.filter(p => override[p] !== undefined && override[p] !== null);
    if (!carried.length) return null;
    const basis = override.basis && typeof override.basis === "object" ? override.basis : null;
    const fps = basis && basis.fingerprints && typeof basis.fingerprints === "object" ? basis.fingerprints : null;
    const parts = carried.filter(p => !fps || fps[p] !== fingerprint(shipped && shipped[p]));
    if (!parts.length) return null;
    return { savedWith: basis && typeof basis.version === "string" ? basis.version : null, parts };
  }

  VSM.version = { VERSION, fingerprint, stamp, staleness };
  if (typeof module !== "undefined" && module.exports) module.exports = VSM.version;
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
