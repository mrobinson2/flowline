/* ============================================================================
   ADMIN MODE - the overlay that edits the rule layer (spec §4.7).
   ----------------------------------------------------------------------------
   The quality bar, verbatim: a platform architect changes which tasks fire by
   editing one expression, sees the impact across reference scenarios before
   saving, and never touches code or the spreadsheet.

     Variables   the questions: add, reorder, retire (blocked while anything
                 still reads the variable, and the blockers are listed)
     Rules       named rules, as expression text with live compile feedback
     Activities  each activity's inclusion condition, same editor
     History     the version log every applied change appends to

   Same contract as the process designer: edits land on a WORKING COPY and are
   STAGED; nothing reaches the chart until the whole candidate validates. The
   impact preview is not optional - Apply is only reachable from it, because
   "without it nobody will dare edit a rule". The preview replays every saved
   scenario, plus what is on screen, against the candidate (VSM.admin.impact).

   This file builds DOM and knows nothing about persistence: app.js hands it
   the data, the scenarios to replay, and an onApply callback.
   ========================================================================== */
VSM.adminUI = (function () {
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
  const move = (arr, i, delta) => {
    const j = i + delta;
    if (j < 0 || j >= arr.length) return false;
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    return true;
  };
  const ID = /^[A-Za-z][A-Za-z0-9_]*$/;

  function open(data, opts) {
    if (document.getElementById("admin-overlay")) return;
    const work = {
      process: VSM.deepClone(data.process),
      taxonomy: data.taxonomy,
      scenario: VSM.deepClone(data.scenario)
    };
    work.scenario.rules = work.scenario.rules || {};
    const runs = (opts && opts.runs) || [];
    const onApply = (opts && opts.onApply) || (() => {});

    let tab = "rules", mode = "edit", editing = null, search = "", note = "", blocked = null;
    /* staged changes, one per target; `before` is kept from the first edit so
       the version log says what the live data had, not an intermediate draft */
    const pending = [];
    function stage(target, before, after) {
      const p = pending.find(x => x.target === target);
      if (p) { p.after = after; if (p.before === p.after) pending.splice(pending.indexOf(p), 1); }
      else if (before !== after) pending.push({ target, before, after });
      issues.hidden = true;                        // the last check was of an older candidate
    }

    const overlay = h("div", { id: "admin-overlay", class: "overlay", role: "dialog", "aria-modal": "true", "aria-label": "Admin mode" });
    const box = h("div", { class: "overlay-box designer admin" });
    overlay.appendChild(box);
    const issues = h("div", { class: "designer-issues", hidden: "" });

    /* a stray Escape or backdrop click must not throw away staged work */
    const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey); };
    const softClose = () => {
      if (!pending.length) { close(); return; }
      note = pending.length + " staged change" + (pending.length === 1 ? "" : "s") + " would be lost. Use Discard to close without applying.";
      render();
    };
    const onKey = e => { if (e.key === "Escape" && !e.defaultPrevented) softClose(); };
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", e => { if (e.target === overlay) softClose(); });

    const attrs = () => work.scenario.attributes;
    const ruleIds = () => Object.keys(work.scenario.rules);
    const text = rule => VSM.admin.ruleToText(rule).text;
    const actName = id => { const a = work.process.activities.find(x => x.id === id) || data.process.activities.find(x => x.id === id); return a ? (a.name || id) : id; };

    function check() {
      let r;
      try { r = VSM.validate.run(work.process, work.taxonomy, work.scenario); }
      catch (e) { r = { errors: ["the candidate could not be checked: " + e.message], warnings: [] }; }
      issues.innerHTML = "";
      issues.hidden = !r.errors.length;
      r.errors.slice(0, 8).forEach(m => issues.appendChild(h("div", { class: "bad" }, m)));
      if (r.errors.length > 8) issues.appendChild(h("div", null, "… and " + (r.errors.length - 8) + " more"));
      return r;
    }

    /* ------------------------------------------------------ the rule editor
       Expression text in, compiled JSON out, checked on every keystroke
       against the WORKING variables and rules. A rule the grammar cannot say
       is edited as JSON instead of being shown as something it is not. */
    function editor(rule, onStage) {
      const start = VSM.admin.ruleToText(rule);
      const isJson = start.json;
      const ta = h("textarea", { class: "input admin-expr", rows: isJson ? "6" : "3", spellcheck: "false", "aria-label": "Condition" });
      ta.value = start.text;
      const fb = h("div", { class: "admin-feedback" });
      const sugg = h("div", { class: "admin-suggest" });
      const stageBtn = h("button", { class: "primary small", type: "button" }, "Stage change");
      let compiled = null;

      function caret(src, column) {
        const i = Math.max(0, Math.min(src.length, column - 1));
        const ls = src.lastIndexOf("\n", i - 1) + 1, le = src.indexOf("\n", i);
        const line = src.slice(ls, le < 0 ? src.length : le);
        return h("pre", { class: "admin-caret" }, line + "\n" + " ".repeat(i - ls) + "^");
      }
      function compile() {
        fb.innerHTML = ""; compiled = null;
        const src = ta.value;
        try {
          if (isJson) {
            compiled = { rule: JSON.parse(src), warnings: [] };
            fb.appendChild(h("div", { class: "ok" }, "Valid JSON. This shape has no expression form, so it is edited as JSON."));
          } else {
            compiled = VSM.admin.textToRule(src, attrs(), ruleIds());
            fb.appendChild(h("div", { class: "ok" }, "✓ compiles"));
            compiled.warnings.forEach(w => fb.appendChild(h("div", { class: "warn" }, w)));
          }
        } catch (e) {
          fb.appendChild(h("div", { class: "bad" }, (e.column ? "Column " + e.column + ": " : "") + e.message));
          if (e.column) fb.appendChild(caret(src, e.column));
        }
        stageBtn.disabled = !compiled;
        suggest();
      }
      /* the word under the cursor, completed from variable ids, rule names
         and the keywords - a datalist cannot complete mid-expression */
      function suggest() {
        sugg.innerHTML = "";
        if (isJson) return;
        const upto = ta.value.slice(0, ta.selectionStart);
        const m = /[A-Za-z0-9_]+$/.exec(upto);
        if (!m) return;
        const w = m[0], low = w.toLowerCase();
        const pool = attrs().map(a => a.id).concat(ruleIds().map(id => (/^R_/.test(id) ? id : "R_" + id)), VSM.expr.KEYWORDS);
        pool.filter(id => id !== w && id.toLowerCase().startsWith(low)).slice(0, 8).forEach(id => {
          sugg.appendChild(h("button", {
            type: "button", class: "chip", onmousedown: e => e.preventDefault(), onclick: () => {
              const at = ta.selectionStart - w.length;
              ta.value = ta.value.slice(0, at) + id + ta.value.slice(ta.selectionStart);
              ta.selectionStart = ta.selectionEnd = at + id.length;
              ta.focus(); compile();
            }
          }, id));
        });
      }
      ta.addEventListener("input", compile);
      ta.addEventListener("click", suggest);
      ta.addEventListener("keyup", e => { if (e.key.startsWith("Arrow")) suggest(); });
      ta.addEventListener("keydown", e => { if (e.key === "Escape") { e.preventDefault(); editing = null; render(); } });
      stageBtn.onclick = () => { if (compiled) { onStage(compiled.rule); editing = null; render(); } };
      setTimeout(() => { ta.focus(); compile(); }, 0);
      return h("div", { class: "admin-editor" }, ta, sugg, fb,
        h("div", { class: "admin-editor-actions" },
          h("span", { class: "hint" }, isJson ? "JSON rule" : "AND  OR  NOT  =  !=  IN [..]  NOT IN [..]  INCLUDES  INTERSECTS [..]  R_rule  TRUE  FALSE"),
          h("button", { class: "ghost small", type: "button", onclick: () => { editing = null; render(); } }, "Cancel"),
          stageBtn));
    }

    const isStaged = target => pending.some(p => p.target === target);

    /* ---------------------------------------------------------- rules tab */
    function rulesTab() {
      const list = h("div", { class: "designer-list" });
      /* rule names in structural positions only - a comparison's values are data */
      const names = (r, out, d) => {
        if (typeof r === "string") out.push(r);
        else if (r && typeof r === "object" && !Array.isArray(r) && (d || 0) < 64) {
          if (Array.isArray(r.all) || Array.isArray(r.any)) (r.all || r.any).forEach(x => names(x, out, (d || 0) + 1));
          else if (r.not !== undefined) names(r.not, out, (d || 0) + 1);
        }
        return out;
      };
      const used = id => work.process.activities.filter(a => names(a.when, []).includes(id)).length;
      ruleIds().forEach(id => {
        const key = "rule:" + id, target = "rule " + id;
        const row = h("div", { class: "admin-row" + (isStaged(target) ? " staged" : "") },
          h("div", { class: "admin-row-head" },
            h("code", { class: "admin-id" }, /^R_/.test(id) ? id : "R_" + id),
            h("span", { class: "designer-count", title: "Activities whose condition names this rule" }, used(id) + " act"),
            isStaged(target) ? h("span", { class: "admin-badge" }, "staged") : null,
            h("button", { class: "ghost small", type: "button", onclick: () => { editing = editing === key ? null : key; render(); } }, editing === key ? "Close" : "Edit")),
          editing === key
            ? editor(work.scenario.rules[id], rule => {
              const before = text(data.scenario.rules[id]);
              work.scenario.rules[id] = rule;
              stage(target, before, text(rule));
            })
            : h("code", { class: "admin-text" }, text(work.scenario.rules[id])));
        list.appendChild(row);
      });
      return h("div", null,
        h("p", { class: "hint" }, "A named rule is written once and referenced by name (R_…) from activity conditions and other rules. Change one here and every activity that names it follows."),
        list);
    }

    /* ----------------------------------------------------- activities tab */
    function activitiesTab() {
      const list = h("div", { class: "designer-list" });
      const q = search.trim().toLowerCase();
      const acts = work.process.activities.filter(a => !q || a.id.toLowerCase().includes(q) || String(a.name || "").toLowerCase().includes(q)
        || (a.when !== undefined && text(a.when).toLowerCase().includes(q)));
      acts.forEach(a => {
        const key = "act:" + a.id, target = "activity " + a.id + " condition";
        const live = data.process.activities.find(x => x.id === a.id);
        list.appendChild(h("div", { class: "admin-row" + (isStaged(target) ? " staged" : "") },
          h("div", { class: "admin-row-head" },
            h("span", { class: "designer-name", title: a.id }, a.name || a.id),
            h("code", { class: "admin-id muted" }, a.id),
            isStaged(target) ? h("span", { class: "admin-badge" }, "staged") : null,
            h("button", { class: "ghost small", type: "button", onclick: () => { editing = editing === key ? null : key; render(); } }, editing === key ? "Close" : "Edit")),
          editing === key
            ? editor(a.when === undefined ? true : a.when, rule => {
              if (rule === true) delete a.when; else a.when = rule;
              const was = live && live.when !== undefined ? text(live.when) : "TRUE";
              stage(target, was, rule === true ? "TRUE" : text(rule));
            })
            : h("code", { class: "admin-text" + (a.when === undefined ? " muted" : "") }, a.when === undefined ? "always included" : text(a.when))));
      });
      const box = h("input", { class: "input", type: "search", placeholder: "Search activities by name, id or condition", value: search });
      box.addEventListener("input", e => { search = e.target.value; const pos = e.target.selectionStart; render(); const b = document.querySelector("#admin-overlay input[type=search]"); if (b) { b.focus(); b.selectionStart = b.selectionEnd = pos; } });
      return h("div", null,
        h("p", { class: "hint" }, "Each activity's inclusion condition. TRUE means always included. Showing " + acts.length + " of " + work.process.activities.length + "."),
        box, list);
    }

    /* ------------------------------------------------------ variables tab */
    function variablesTab() {
      const list = h("div", { class: "designer-list" });
      const liveOrder = data.scenario.attributes.map(a => a.id).join(", ");
      const restage = () => stage("variable order", liveOrder, attrs().map(a => a.id).join(", "));
      attrs().forEach((a, i) => {
        const row = h("div", { class: "admin-row" },
          h("div", { class: "admin-row-head" },
            h("code", { class: "admin-id" }, a.id),
            h("span", { class: "designer-name", title: a.label || "" }, a.label || ""),
            h("span", { class: "designer-count" }, a.type + (a.derived ? " · derived" : "") + (a.section ? " · §" + a.section : "")),
            h("button", { class: "ghost small", type: "button", title: "Move up", onclick: () => { if (move(attrs(), i, -1)) { restage(); render(); } } }, "↑"),
            h("button", { class: "ghost small", type: "button", title: "Move down", onclick: () => { if (move(attrs(), i, 1)) { restage(); render(); } } }, "↓"),
            h("button", {
              class: "ghost small danger", type: "button", title: "Retire this variable", onclick: () => {
                const refs = VSM.admin.referencesTo(work, a.id);
                if (refs.length) { blocked = { id: a.id, refs }; render(); return; }
                attrs().splice(i, 1);
                blocked = null;
                const inLive = data.scenario.attributes.some(x => x.id === a.id);
                if (inLive) stage("variable " + a.id, "defined (" + a.type + ")", "retired");
                else {                                   // added and retired in one session: no trace
                  const k = pending.findIndex(p => p.target === "variable " + a.id);
                  if (k >= 0) pending.splice(k, 1);
                }
                if (isStaged("variable order")) restage();
                note = "Retired " + a.id + ". Nothing referenced it.";
                render();
              }
            }, "Retire")));
        if (blocked && blocked.id === a.id) {
          row.appendChild(h("div", { class: "admin-blocked" },
            h("div", { class: "bad" }, "Cannot retire " + a.id + ": " + blocked.refs.length + " place" + (blocked.refs.length === 1 ? "" : "s") + " still read it. Change these first."),
            h("ul", null, blocked.refs.map(r => h("li", null, r.kind + " · " + r.id + (r.label ? " (" + r.label + ")" : ""))))));
        }
        list.appendChild(row);
      });

      /* add: the minimum a question needs to exist and be referenced */
      const f = {
        id: h("input", { class: "input short", placeholder: "id, e.g. dataResidency" }),
        label: h("input", { class: "input", placeholder: "Question shown in the sidebar" }),
        type: h("select", { class: "select short" }, ["boolean", "enum", "multi"].map(t => h("option", { value: t }, t === "boolean" ? "yes / no" : t === "enum" ? "one of" : "any of"))),
        options: h("input", { class: "input", placeholder: "options, comma separated (one of / any of)" }),
        section: h("select", { class: "select short", title: "Sidebar section" }, [1, 2, 3, 4, 5, 6].map(n => h("option", { value: String(n) }, "Section " + n)))
      };
      const addErr = h("div", { class: "admin-feedback" });
      const add = () => {
        addErr.innerHTML = "";
        const id = f.id.value.trim(), label = f.label.value.trim(), type = f.type.value;
        const opts = f.options.value.split(",").map(x => x.trim()).filter(Boolean);
        const fail = m => { addErr.appendChild(h("div", { class: "bad" }, m)); };
        if (!ID.test(id)) return fail("The id must start with a letter and use only letters, digits and _.");
        if (/^R_/.test(id)) return fail("R_ is reserved for rule names.");
        if (attrs().some(a => a.id === id) || ruleIds().includes(id)) return fail("'" + id + "' is already a variable or rule.");
        if (!label) return fail("Give it a label - it is the question people answer.");
        if (type !== "boolean" && opts.length < 2) return fail("A choice needs at least two options.");
        const attr = { id, label, type, section: Number(f.section.value) };
        if (type === "boolean") attr.default = false;
        else { attr.options = opts.map(v => ({ value: v })); attr.default = type === "multi" ? [] : opts[0]; }
        attrs().push(attr);
        stage("variable " + id, "(none)", "added (" + type + (opts.length ? ": " + opts.join(", ") : "") + ")");
        if (isStaged("variable order")) restage();
        note = "Added " + id + ". Reference it from a rule or an activity condition.";
        render();
      };
      return h("div", null,
        h("p", { class: "hint" }, "The questions the sidebar asks, in sidebar order. Retiring is blocked while any rule, condition, derivation, visibility gate or preset still reads the variable."),
        list,
        h("div", { class: "admin-add" },
          h("div", { class: "designer-row" }, f.id, f.label),
          h("div", { class: "designer-row" }, f.type, f.options, f.section,
            h("button", { class: "ghost small", type: "button", onclick: add }, "+ Add variable")),
          addErr));
    }

    /* -------------------------------------------------------- history tab */
    function historyTab() {
      const v = (work.scenario.versions || []).slice().reverse();
      if (!v.length) return h("p", { class: "hint" }, "No changes applied from admin mode yet. Every applied change is logged here and travels with the JSON export.");
      return h("div", null,
        h("p", { class: "hint" }, v.length + " applied change" + (v.length === 1 ? "" : "s") + ", newest first (the log keeps the last 100)."),
        h("div", { class: "designer-list" }, v.map(e => h("div", { class: "admin-row" },
          h("div", { class: "admin-row-head" },
            h("code", { class: "admin-id" }, e.target),
            h("span", { class: "designer-count" }, String(e.ts || "").replace("T", " ").slice(0, 16))),
          h("div", { class: "admin-diff" },
            h("code", { class: "admin-text muted" }, String(e.before)), " → ", h("code", { class: "admin-text" }, String(e.after)))))));
    }

    /* ----------------------------------------------------- impact preview */
    function impactView() {
      const rows = VSM.admin.impact(data, work, runs);
      const changed = rows.filter(r => r.error || r.added.length || r.removed.length);
      const ids = (list, sign) => h("ul", { class: "admin-ids" }, list.map(id => h("li", null, sign + " " + actName(id) + " ", h("code", null, id))));
      const table = h("table", { class: "admin-impact" },
        h("thead", null, h("tr", null, h("th", null, "Scenario"), h("th", null, "Tasks"), h("th", null, "Added"), h("th", null, "Removed"))),
        h("tbody", null, rows.map(r => {
          const tr = h("tr", { class: r.error ? "err" : (r.added.length || r.removed.length) ? "changed" : "" },
            h("td", null, r.name, r.runId === "current" ? h("span", { class: "admin-badge" }, "on screen") : null,
              r.stale && r.runId !== "current" ? h("span", { class: "admin-badge muted", title: "Replayed today this scenario already differs from what was saved - an earlier change moved it. Counts here are this edit's effect only." }, "saved under older rules") : null),
            h("td", null, r.error ? "—" : r.before === r.after ? String(r.after) : r.before + " → " + r.after),
            h("td", { class: "plus" }, r.added.length ? "+" + r.added.length : ""),
            h("td", { class: "minus" }, r.removed.length ? "−" + r.removed.length : ""));
          const out = [tr];
          if (r.error) out.push(h("tr", { class: "detail" }, h("td", { colspan: "4" }, h("div", { class: "bad" }, "Would not build: " + r.error))));
          else if (r.added.length || r.removed.length) out.push(h("tr", { class: "detail" }, h("td", { colspan: "4" },
            h("details", null, h("summary", null, "Which tasks"), r.added.length ? ids(r.added, "+") : null, r.removed.length ? ids(r.removed, "−") : null))));
          return out;
        }).flat()));
      return h("div", null,
        h("p", { class: "admin-summary" },
          changed.length
            ? changed.length + " of " + rows.length + " scenario" + (rows.length === 1 ? "" : "s") + " change shape under these edits."
            : "None of the " + rows.length + " scenario" + (rows.length === 1 ? "" : "s") + " change shape under these edits."),
        h("p", { class: "hint" }, "Each scenario is replayed with its own answers against the live rules and against the edited ones; the difference is what these edits do to it."),
        runs.length <= 1 ? h("p", { class: "hint" }, "Only the on-screen scenario is replayed. Save scenarios (sidebar, Saved scenarios) to check an edit against the cases you care about.") : null,
        table,
        h("h4", null, "Staged changes"),
        h("div", { class: "designer-list" }, pending.map(p => h("div", { class: "admin-diff" },
          h("code", { class: "admin-id" }, p.target), " ",
          h("code", { class: "admin-text muted" }, String(p.before)), " → ", h("code", { class: "admin-text" }, String(p.after))))));
    }

    /* ---------------------------------------------------------- the frame */
    function render() {
      box.innerHTML = "";
      box.appendChild(h("div", { class: "designer-head" },
        h("h2", null, mode === "impact" ? "Admin mode · impact preview" : "Admin mode"),
        h("button", { class: "icon", type: "button", title: "Close", onclick: softClose }, "×")));
      let body;
      if (mode === "impact") {
        body = h("div", { class: "designer-body" }, impactView());
      } else {
        box.appendChild(h("div", { class: "designer-tabs" },
          [["variables", "Variables (" + attrs().length + ")"], ["rules", "Rules (" + ruleIds().length + ")"],
          ["activities", "Activities (" + work.process.activities.length + ")"], ["history", "History (" + (work.scenario.versions || []).length + ")"]]
            .map(([t, label]) => h("button", { class: "tab" + (tab === t ? " on" : ""), type: "button", onclick: () => { tab = t; editing = null; blocked = null; render(); } }, label))));
        body = h("div", { class: "designer-body" },
          tab === "variables" ? variablesTab() : tab === "rules" ? rulesTab() : tab === "activities" ? activitiesTab() : historyTab());
      }
      box.appendChild(body);
      if (note) { body.insertBefore(h("div", { class: "hint designer-note" }, note), body.firstChild); note = ""; }
      box.appendChild(issues);
      const n = pending.length;
      const foot = h("div", { class: "designer-foot" },
        h("span", { class: "hint" }, n ? n + " staged change" + (n === 1 ? "" : "s") + ". Nothing is live until you apply from the impact preview." : "Stage an edit, then preview its impact on every saved scenario before applying."),
        h("button", { class: "ghost", type: "button", onclick: close }, n ? "Discard" : "Close"));
      if (mode === "impact") {
        foot.appendChild(h("button", { class: "ghost", type: "button", onclick: () => { mode = "edit"; render(); } }, "Back to editing"));
        foot.appendChild(h("button", {
          class: "primary", type: "button", onclick: () => {
            if (check().errors.length) { mode = "edit"; render(); return; }
            const candidate = VSM.deepClone(work);
            pending.forEach(p => VSM.admin.pushVersion(candidate.scenario, p));
            if (onApply(candidate, pending.slice()) !== false) close();
          }
        }, "Apply " + n + " change" + (n === 1 ? "" : "s")));
      } else {
        const prev = h("button", {
          class: "primary", type: "button", onclick: () => {
            /* a candidate that does not validate never gets as far as a preview */
            if (check().errors.length) { note = "Fix the errors below before previewing - the live data is untouched."; render(); return; }
            mode = "impact"; editing = null; render();
          }
        }, "Preview impact");
        prev.disabled = !n;
        foot.appendChild(prev);
      }
      box.appendChild(foot);
    }

    render();
    document.body.appendChild(overlay);
  }

  return { open };
})();
if (typeof module !== "undefined" && module.exports) module.exports = VSM.adminUI;
