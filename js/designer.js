/* ============================================================================
   PROCESS DESIGNER  - stages, phases and row order, edited in the UI.
   ----------------------------------------------------------------------------
   1.0 could only reshape a process in a text editor or a spreadsheet. This
   overlay edits the structure in place:

     Stages    add / rename / reorder / delete the two-level rollup
     Phases    add / rename / reorder / delete, and assign each to a stage
     Sequence  the activity list in chart order: move rows, move an activity
               to a different phase, one click to sort rows into band order

   The contract is the same one imports honour: every change happens on a
   WORKING COPY, Apply validates the whole candidate with VSM.validate.run,
   and nothing reaches the live chart until it passes. A half-finished edit
   can never blank the projector.

   This file builds DOM and knows nothing about persistence: app.js hands it
   the data and an onApply callback that runs the usual override/linked-folder
   plumbing.
   ========================================================================== */
VSM.designer = (function () {
  const h = (tag, attrs, ...children) => {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === "class") e.className = attrs[k];
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    children.flat().forEach(c => { if (c === null || c === undefined) return; e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  };

  /* ids for stages/phases created in the UI: slug of the label, unique */
  function makeId(label, taken) {
    const base = String(label || "item").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "item";
    let id = base, n = 2;
    while (taken.has(id)) id = base + "-" + (n++);
    return id;
  }
  const move = (arr, i, delta) => {
    const j = i + delta;
    if (j < 0 || j >= arr.length) return false;
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    return true;
  };

  function open(data, opts) {
    if (document.getElementById("designer-overlay")) return;      // one at a time
    const work = VSM.deepClone(data.process);                     // the working copy
    work.stages = work.stages || [];
    work.phases = work.phases || [];
    const onApply = (opts && opts.onApply) || (() => {});
    let tab = "phases";

    const overlay = h("div", { id: "designer-overlay", class: "overlay", role: "dialog", "aria-modal": "true", "aria-label": "Process designer" });
    const box = h("div", { class: "overlay-box designer" });
    overlay.appendChild(box);
    const issues = h("div", { class: "designer-issues", hidden: "" });

    const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = e => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", e => { if (e.target === overlay) close(); });

    /* validate the working copy against the LIVE taxonomy and scenario - the
       same pair the applied result will run with */
    function check() {
      let r;
      try { r = VSM.validate.run(work, data.taxonomy, data.scenario); }
      catch (e) { r = { errors: ["the edit could not be checked: " + e.message], warnings: [] }; }
      issues.innerHTML = "";
      issues.hidden = !r.errors.length && !r.warnings.length;
      r.errors.slice(0, 6).forEach(m => issues.appendChild(h("div", { class: "bad" }, m)));
      r.warnings.slice(0, 4).forEach(m => issues.appendChild(h("div", null, m)));
      return r;
    }

    /* ---------------------------------------------------------- stages tab */
    function stagesTab() {
      const list = h("div", { class: "designer-list" });
      const usedBy = id => work.phases.filter(p => p.stage === id).length;
      work.stages.forEach((s, i) => {
        list.appendChild(h("div", { class: "designer-row" },
          h("input", { class: "input", value: s.label || "", placeholder: "Stage name", oninput: e => { s.label = e.target.value; } }),
          h("input", { class: "input short", value: s.short || "", placeholder: "Short", title: "Short label for tight spaces", oninput: e => { s.short = e.target.value || undefined; } }),
          h("span", { class: "designer-count", title: "Phases in this stage" }, usedBy(s.id) + " ph"),
          h("button", { class: "ghost small", type: "button", title: "Move up", onclick: () => { if (move(work.stages, i, -1)) render(); } }, "↑"),
          h("button", { class: "ghost small", type: "button", title: "Move down", onclick: () => { if (move(work.stages, i, 1)) render(); } }, "↓"),
          h("button", {
            class: "ghost small danger", type: "button", title: "Delete this stage", onclick: () => {
              work.phases.forEach(p => { if (p.stage === s.id) delete p.stage; });
              work.stages.splice(i, 1);
              render();
            }
          }, "✕")));
      });
      const explain = work.stages.length
        ? "Stages are the executive rollup: the tracker view draws one segment per stage. Assign phases to stages on the Phases tab."
        : "No stages yet. Stages group phases into the handful of bands an executive reads at a glance (e.g. five stages over nineteen phases). Optional — without them the tracker segments by phase.";
      return h("div", null,
        h("p", { class: "hint" }, explain),
        list,
        h("button", {
          class: "ghost small", type: "button", onclick: () => {
            const taken = new Set(work.stages.map(s => s.id));
            const label = "Stage " + (work.stages.length + 1);
            work.stages.push({ id: makeId(label, taken), label });
            render();
          }
        }, "+ Add stage"));
    }

    /* ---------------------------------------------------------- phases tab */
    function phasesTab() {
      const list = h("div", { class: "designer-list" });
      const usedBy = id => work.activities.filter(a => a.phase === id).length;
      work.phases.forEach((p, i) => {
        const stageSel = h("select", { class: "select short", title: "Stage this phase rolls up into" });
        stageSel.appendChild(h("option", { value: "" }, work.stages.length ? "(no stage)" : "(no stages defined)"));
        work.stages.forEach(s => {
          const o = h("option", { value: s.id }, s.label || s.id);
          if (p.stage === s.id) o.selected = true;
          stageSel.appendChild(o);
        });
        stageSel.onchange = () => { if (stageSel.value) p.stage = stageSel.value; else delete p.stage; };
        const n = usedBy(p.id);
        list.appendChild(h("div", { class: "designer-row" },
          h("input", { class: "input", value: p.label || "", placeholder: "Phase name", oninput: e => { p.label = e.target.value; } }),
          h("input", { class: "input short", value: p.short || "", placeholder: "Short", title: "Short label for the rotated band", oninput: e => { p.short = e.target.value || undefined; } }),
          stageSel,
          h("span", { class: "designer-count", title: "Activities in this phase" }, n + " act"),
          h("button", { class: "ghost small", type: "button", title: "Move up", onclick: () => { if (move(work.phases, i, -1)) render(); } }, "↑"),
          h("button", { class: "ghost small", type: "button", title: "Move down", onclick: () => { if (move(work.phases, i, 1)) render(); } }, "↓"),
          h("button", {
            class: "ghost small danger", type: "button",
            title: n ? "This phase still has activities — move them first (Sequence tab), or they keep the old id and lose their band" : "Delete this phase",
            onclick: () => {
              if (n) {
                /* nothing orphaned silently: the activities must go somewhere */
                const other = work.phases.filter(x => x.id !== p.id);
                if (!other.length) { alertRow("The last phase cannot be deleted while activities use it."); return; }
                const target = other[0];
                work.activities.forEach(a => { if (a.phase === p.id) a.phase = target.id; });
                toastRow(n + " activities moved to “" + (target.label || target.id) + "”.");
              }
              work.phases.splice(i, 1);
              render();
            }
          }, "✕")));
      });
      return h("div", null,
        h("p", { class: "hint" }, "Phase order here is band order on the chart and in every summary. Deleting a phase moves its activities to the first remaining phase and says so."),
        list,
        h("button", {
          class: "ghost small", type: "button", onclick: () => {
            const taken = new Set(work.phases.map(p => p.id));
            const label = "Phase " + (work.phases.length + 1);
            work.phases.push({ id: makeId(label, taken), label });
            render();
          }
        }, "+ Add phase"));
    }

    let note = "";
    function toastRow(m) { note = m; }
    function alertRow(m) { note = m; }

    /* -------------------------------------------------------- sequence tab */
    function sequenceTab() {
      const list = h("div", { class: "designer-list" });
      const phaseIdx = new Map(work.phases.map((p, i) => [p.id, i]));
      const label = id => { const p = work.phases.find(x => x.id === id); return p ? (p.label || p.id) : (id || "(no phase)"); };
      let lastPhase = {};
      work.activities.forEach((a, i) => {
        if (a.phase !== lastPhase) {
          list.appendChild(h("div", { class: "designer-group" }, label(a.phase).toUpperCase()));
          lastPhase = a.phase;
        }
        const sel = h("select", { class: "select short", title: "Move this activity to another phase" });
        sel.appendChild(h("option", { value: "" }, "(no phase)"));
        work.phases.forEach(p => {
          const o = h("option", { value: p.id }, p.label || p.id);
          if (a.phase === p.id) o.selected = true;
          sel.appendChild(o);
        });
        sel.onchange = () => { if (sel.value) a.phase = sel.value; else delete a.phase; render(); };
        list.appendChild(h("div", { class: "designer-row" },
          h("span", { class: "designer-name", title: a.id }, a.name || a.id),
          sel,
          h("button", { class: "ghost small", type: "button", title: "Move row up", onclick: () => { if (move(work.activities, i, -1)) render(); } }, "↑"),
          h("button", { class: "ghost small", type: "button", title: "Move row down", onclick: () => { if (move(work.activities, i, 1)) render(); } }, "↓")));
      });
      return h("div", null,
        h("p", { class: "hint" }, "Row order here is row order on the chart (dependencies are unaffected — edit those in the details panel). Rows that have drifted out of phase order fragment the bands; sort fixes that in one click."),
        h("button", {
          class: "ghost small", type: "button", onclick: () => {
            /* stable sort into phase order; activities keep their relative order */
            const rank = a => { const r = phaseIdx.get(a.phase); return r === undefined ? work.phases.length : r; };
            work.activities = work.activities.map((a, i) => [a, i])
              .sort((x, y) => rank(x[0]) - rank(y[0]) || x[1] - y[1])
              .map(x => x[0]);
            render();
          }
        }, "Sort rows to match phase order"),
        list);
    }

    /* ---------------------------------------------------------- the frame */
    function render() {
      box.innerHTML = "";
      box.appendChild(h("div", { class: "designer-head" },
        h("h2", null, "Process designer"),
        h("button", { class: "icon", type: "button", title: "Close without applying", onclick: close }, "×")));
      const tabs = h("div", { class: "designer-tabs" },
        ["stages", "phases", "sequence"].map(t =>
          h("button", { class: "tab" + (tab === t ? " on" : ""), type: "button", onclick: () => { tab = t; render(); } },
            t === "stages" ? "Stages (" + work.stages.length + ")"
              : t === "phases" ? "Phases (" + work.phases.length + ")"
              : "Sequence (" + work.activities.length + ")")));
      box.appendChild(tabs);
      const body = h("div", { class: "designer-body" },
        tab === "stages" ? stagesTab() : tab === "phases" ? phasesTab() : sequenceTab());
      box.appendChild(body);
      if (note) { body.insertBefore(h("div", { class: "hint designer-note" }, note), body.firstChild); note = ""; }
      box.appendChild(issues);
      box.appendChild(h("div", { class: "designer-foot" },
        h("span", { class: "hint" }, "Changes apply only when they validate; the chart keeps the last good data until then."),
        h("button", { class: "ghost", type: "button", onclick: close }, "Cancel"),
        h("button", {
          class: "primary", type: "button", onclick: () => {
            /* prune empty labels so a half-typed row does not persist as "" */
            work.stages = work.stages.filter(s => String(s.label || "").trim());
            const liveStages = new Set(work.stages.map(s => s.id));
            work.phases.forEach(p => {
              if (!String(p.label || "").trim()) p.label = p.id;
              if (p.stage && !liveStages.has(p.stage)) delete p.stage;   // no dangling rollups
            });
            if (!work.stages.length) delete work.stages;
            const r = check();
            if (r.errors.length) return;                       // the issues box says why
            if (onApply(VSM.deepClone(work)) !== false) close();
          }
        }, "Apply changes")));
      check();
    }

    render();
    document.body.appendChild(overlay);
  }

  return { open };
})();
if (typeof module !== "undefined" && module.exports) module.exports = VSM.designer;
