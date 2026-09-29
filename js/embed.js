/* ============================================================================
   EMBED  -  mount the chart inside somebody else's application.
   ----------------------------------------------------------------------------
   index.html owns a whole page: a sidebar, a toolbar, presentation mode, local
   storage, file pickers. A host application has its own chrome and wants none
   of that. It wants a chart in a div.

   This is that. It depends on the engine and the renderer and on nothing in
   js/app.js, so it carries no opinions about layout, persistence or controls.
   The host decides the scenario, the host decides the size, the host owns the
   surrounding page.

       const chart = VSM.embed.create(el, {
         data: { process, taxonomy, scenario },   // or omit to use the shipped data
         profile: "build-paved",                  // a preset id, optional
         scenario: { aiWorkload: true },          // overrides on top, optional
         view: "current", theme: "dark"
       });
       chart.update({ view: "waste" });
       chart.destroy();

   Written this way specifically so the same code can run as a Backstage
   frontend plugin, a SharePoint-hosted page, or anything else: a React
   component mounts it with a ref in useEffect, calls update() when its props
   change, and destroy() on unmount. Nothing here knows or cares.
   ========================================================================== */
(function (root) {
  const VSM = root.VSM = root.VSM || {};

  const DEFAULTS = {
    view: "current",
    theme: "dark",
    density: "normal",
    width: null,               // null = measure the container
    zoom: 1,
    columns: true,
    phases: true,
    links: "all",
    critical: false,
    onSelect: null             // (activity, node) => void
  };

  /* Resolve the scenario the way the app does: start from the declared
     defaults, lay a profile over the top, lay explicit overrides over that,
     neutralise hidden and disabled controls, then follow toggle implications
     as the scheduler does. Same order every time, so the answer
     never depends on how the host got here. */
  function resolveScenario(cfg, profileId, overrides) {
    const attrs = (cfg && cfg.attributes) || [];
    const named = (cfg && cfg.rules) || {};
    let s = VSM.rules.defaults(attrs);
    if (profileId) {
      const p = ((cfg && cfg.presets) || []).find(x => x.id === profileId);
      if (p) s = Object.assign(s, VSM.deepClone(p.set || p.values || {}));
    }
    if (overrides) s = Object.assign(s, VSM.deepClone(overrides));
    s = VSM.rules.effective(attrs, s, named);
    if (VSM.rules.applyImplications) s = VSM.rules.applyImplications(attrs, s);
    return s;
  }

  function summarise(cfg, scenario) {
    const parts = [];
    ((cfg && cfg.attributes) || []).forEach(a => {
      if (a.hidden && a.type !== "enum") return;
      const v = scenario[a.id];
      if (a.type === "boolean") { if (v) parts.push(a.label); }
      else if (a.type === "multi") {
        if (v && v.length) parts.push(a.label + ": " + v.map(x => {
          const o = (a.options || []).find(y => y.value === x); return o ? o.label : x;
        }).join(", "));
      } else {
        const o = (a.options || []).find(y => y.value === v);
        if (o) parts.push(o.label);
      }
    });
    return parts.join("  ·  ");
  }

  function create(container, options) {
    if (!container) throw new Error("VSM.embed.create needs a container element");
    const opts = Object.assign({}, DEFAULTS, options || {});
    let data = opts.data || {
      process: VSM.data.process, taxonomy: VSM.data.taxonomy, scenario: VSM.data.scenario
    };
    /* The same validation gate the app uses. A host embedding this should be
       told its data is broken rather than shown an empty box. */
    function validateData(next) {
      if (!next || !next.process) throw new Error("No process data. Pass { data: { process, taxonomy, scenario } }.");
      const issues = VSM.validate.run(next.process, next.taxonomy, next.scenario);
      if (issues.errors.length) {
        const err = new Error("Invalid data: " + issues.errors[0]);
        err.issues = issues;
        throw err;
      }
    }
    validateData(data);

    let current = opts, model = null, svg = null;

    function render() {
      const cfg = data.scenario;
      const scenario = resolveScenario(cfg, current.profile, current.scenario);
      model = VSM.schedule.build(data.process, data.taxonomy, scenario, (cfg && cfg.rules) || {}, (cfg && cfg.attributes) || []);

      const width = current.width || container.clientWidth || 1200;

      /* the Tracker view has its own renderer and layouts; everything else
         goes through the timeline renderer as before */
      if (current.view === "tracker" && VSM.progressRender && VSM.progress) {
        const track = VSM.progress.compute(model);
        const next2 = VSM.progressRender.draw(model, track, {
          layout: current.presentation ? VSM.progressRender.presentation() : VSM.progressRender.interactive(width),
          theme: current.theme,
          scenarioSummary: summarise(cfg, scenario)
        });
        container.textContent = "";
        container.appendChild(next2);
        svg = next2;
        if (typeof current.onSelect === "function") {
          svg.querySelectorAll("[data-id]").forEach(el => {
            el.style.cursor = "pointer";
            el.addEventListener("click", () => {
              const n = model.nodeById.get(el.getAttribute("data-id"));
              if (n) current.onSelect(n.act, n);
            });
          });
        }
        return model;
      }

      const layout = current.presentation
        ? VSM.layout.presentation(model.nodes.length, { showMetrics: current.metrics !== false, columns: current.columns })
        : VSM.layout.interactive(model.nodes.length, {
            density: current.density, width, zoom: current.zoom,
            columns: current.columns, rowNumbers: current.rowNumbers !== false
          });

      const next = VSM.render.draw(model, {
        layout, view: current.view,
        display: {
          links: current.links, phases: current.phases, columns: current.columns,
          critical: current.critical, hideNonMatching: false
        },
        filters: { wasteTypes: new Set(), owners: new Set(), search: current.search || "" },
        scenarioSummary: summarise(cfg, scenario),
        theme: current.theme
      });

      container.textContent = "";
      container.appendChild(next);
      svg = next;

      if (typeof current.onSelect === "function") {
        svg.querySelectorAll("[data-id]").forEach(el => {
          el.style.cursor = "pointer";
          el.addEventListener("click", () => {
            const n = model.nodeById.get(el.getAttribute("data-id"));
            if (n) current.onSelect(n.act, n);
          });
        });
      }
      return model;
    }

    render();

    function update(patch) {
      const next = Object.assign({}, current, patch || {});
      const nextData = patch && Object.prototype.hasOwnProperty.call(patch, "data") ? patch.data : data;
      validateData(nextData);
      current = next;
      data = nextData;
      return render();
    }

    return {
      /* change anything and redraw; unspecified options keep their value */
      update,
      /* swap the whole data set, e.g. after the host imports a workbook */
      setData(next) { return update({ data: next }); },
      getModel() { return model; },
      getSvg() { return svg; },
      getScenarioOptions() {
        const cfg = data.scenario || {};
        return {
          profiles: (cfg.presets || []).map(p => ({ id: p.id, label: p.label, description: p.description })),
          attributes: (cfg.attributes || []).filter(a => !a.hidden)
        };
      },
      /* the same analysis the command-line diagnostic uses */
      analyze() { return VSM.analyze ? VSM.analyze.profile(model, { hoursPerDay: data.process.hoursPerDay || 1 }) : null; },
      destroy() { container.textContent = ""; model = null; svg = null; }
    };
  }

  VSM.embed = { create, resolveScenario, DEFAULTS };
  if (typeof module !== "undefined" && module.exports) module.exports = VSM.embed;
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
