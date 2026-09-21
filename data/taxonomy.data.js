/* ============================================================================
   VISUAL TAXONOMY  (colors, waste categories, activity categories, markers)
   ----------------------------------------------------------------------------
   Everything between the outer { } is plain JSON. Edit freely, save, reload.

   families   : color families. Each has an "optimal" (solid, saturated) shade
                and an "excess" (lighter, hatched) shade. Add a family, then
                point a category or waste type at it.
   categories : the kind of activity when NO waste type applies.
   wasteTypes : process friction categories. Each maps to a color family and a
                short code that is printed on the bar so color is never the only
                signal. "waiting: true" counts the type toward "waiting time".
   ========================================================================== */
VSM.register("taxonomy", {
  "families": {
    "value":       { "label": "Value-adding work",        "optimal": "#3B82F6", "excess": "#93C5FD" },
    "enabling":    { "label": "Necessary enabling work",  "optimal": "#8B9BB4", "excess": "#CBD5E1" },
    "approval":    { "label": "Approval / governance",    "optimal": "#22C55E", "excess": "#86EFAC" },
    "handoff":     { "label": "Handoff",                  "optimal": "#A855F7", "excess": "#D8B4FE" },
    "queue":       { "label": "Queue / waiting",          "optimal": "#F59E0B", "excess": "#FDE68A" },
    "rework":      { "label": "Rework",                   "optimal": "#EF4444", "excess": "#FCA5A5" },
    "manual":      { "label": "Manual processing",        "optimal": "#EC4899", "excess": "#F9A8D4" },
    "procurement": { "label": "Procurement delay",        "optimal": "#F97316", "excess": "#FDBA74" },
    "external":    { "label": "External dependency",      "optimal": "#06B6D4", "excess": "#A5F3FC" },
    "testing":     { "label": "Testing / validation delay","optimal": "#6366F1", "excess": "#C7D2FE" },
    "scheduling":  { "label": "Scheduling delay",         "optimal": "#84CC16", "excess": "#D9F99D" },
    "duplicate":   { "label": "Duplicate review",         "optimal": "#A16207", "excess": "#FDE047" }
  },

  "categories": {
    "value":    { "label": "Value-adding",       "family": "value",    "code": "V" },
    "enabling": { "label": "Necessary enabling", "family": "enabling", "code": "E" },
    "approval": { "label": "Approval gate",      "family": "approval", "code": "A", "gate": true }
  },

  "wasteTypes": {
    "handoff":       { "label": "Handoff",                    "family": "handoff",     "code": "HO", "derived": "handoff",
                   "description": "Work changes ownership; context is lost or re-explained. DERIVED: counted from the ownership changes the scheduler detects, not from a tag on an activity, so it always matches the rings drawn on the chart." },
    "approval-gate": { "label": "Approval / governance gate", "family": "approval",    "code": "AG", "description": "A decision or control point. Optimal = minimum decision time; excess = queueing for the meeting, re-presenting, chasing signatures." },
    "queue":         { "label": "Queue / waiting",            "family": "queue",       "code": "Q",  "waiting": true, "description": "Work sits idle waiting for capacity, a slot, or a response." },
    "rework":        { "label": "Rework",                     "family": "rework",      "code": "R",  "description": "Repeating work because of defects, missed requirements, or late feedback." },
    "manual":        { "label": "Manual processing",          "family": "manual",      "code": "M",  "description": "Hand-performed steps that could be automated or self-service." },
    "procurement":   { "label": "Procurement delay",          "family": "procurement", "code": "P",  "waiting": true, "description": "Buying, PO, shipping and lead-time delays." },
    "external":      { "label": "External dependency",        "family": "external",    "code": "X",  "waiting": true, "description": "Waiting on a party outside the delivery team's control (vendor, third party, another business unit)." },
    "testing":       { "label": "Testing / validation delay", "family": "testing",     "code": "T",  "waiting": true, "description": "Delay caused by test environments, test cycles, or validation backlogs." },
    "scheduling":    { "label": "Scheduling delay",           "family": "scheduling",  "code": "S",  "waiting": true, "description": "Waiting for a calendar slot: release window, board meeting, change freeze." },
    "duplicate":     { "label": "Duplicate review",           "family": "duplicate",   "code": "D",  "description": "Reviewing something that has already been reviewed elsewhere." }
  },

  "markers": {
    "handoff":         { "label": "Handoff (same organization)",   "shape": "ring" },
    "handoffCrossOrg": { "label": "Handoff across organizations",  "shape": "ring-dot" },
    "gate":            { "label": "Approval / decision point",     "shape": "diamond" },
    "milestone":       { "label": "Milestone (no duration)",       "shape": "diamond-outline" }
  }
});
