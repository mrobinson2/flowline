/* ============================================================================
   SCENARIO CONFIGURATION  (the controls in the left panel)
   ----------------------------------------------------------------------------
   Everything between the outer { } is plain JSON.

   attributes : each entry becomes a control. Types:
                  "boolean"  -> on/off switch
                  "enum"     -> single choice
                  "multi"    -> multi-select
                "group"       puts the control under a heading
                "enabledWhen" greys the control out unless the rule matches
                "disabledValue" is what a greyed-out control contributes to
                              rules, so a forced-on control stays on
   presets    : named profiles. Each DECLARES a subset of the toggles and stays
                silent on the rest, so a modifier it never mentions survives a
                profile change. Work type is what a profile sets; hosting, AI,
                integrations and the rest are modifiers that ride on top.

   Activities reference these attribute ids in their "when" rules, e.g.
     "when": { "hosting": "cloud", "aiWorkload": true }
   ========================================================================== */
VSM.register("scenario", {
  "attributes": [
    {
      /* Set by the Scenario dropdown, so it is not drawn as a control of its
         own. "hidden" keeps the attribute in the model (every work-type rule
         reads it) without duplicating the dropdown in the panel below it. */
      "id": "workType", "hidden": true, "label": "Work type",
      "type": "enum", "default": "paved",
      "options": [
        { "value": "saas",      "label": "Adopt SaaS" },
        { "value": "cots",      "label": "Deploy COTS" },
        { "value": "paved",     "label": "Build on Paved Road" },
        { "value": "custom",    "label": "Build Custom / Non-Standard" },
        { "value": "rehost",    "label": "Rehost Existing App" },
        { "value": "modernize", "label": "Modernize / Upgrade Existing App" },
        { "value": "capacity",  "label": "Expand Capacity" }
      ]
    },

    {
      "id": "hosting", "group": "Platform", "label": "Hosting", "type": "enum", "default": "cloud",
      "options": [
        { "value": "cloud",   "label": "Cloud" },
        { "value": "on-prem", "label": "On-Premises" }
      ]
    },
    { "id": "aiWorkload", "group": "Platform", "label": "AI workload", "type": "boolean", "default": false },

    { "id": "newVendor", "group": "Sourcing", "label": "New vendor involved", "type": "boolean", "default": false },
    { "id": "hardwareProcurement", "group": "Sourcing", "label": "Hardware procurement", "type": "boolean", "default": true,
      "enabledWhen": { "hosting": "on-prem" } },

    /* Pilot / PoC is the inverse of "needs DR": a non-production proof of
       concept does not get a disaster recovery design, a DR environment or a
       failover test. Activities still read the named rule "drRequired", which
       is defined below as "not a pilot", so the intent stays readable in the
       data even though the control is phrased the other way round. */
    { "id": "pilotPoc", "group": "Scope & Risk", "label": "Pilot / PoC workload", "type": "boolean", "default": false,
      "help": "Non-production, so no DR design, DR environment or failover test." },

    /* On by default because almost everything reaching production needs one,
       but always available to turn off. Judgement about whether a given
       workload actually handles personal data belongs to the person doing the
       tailoring, not to a rule in this file. */
    { "id": "privacyReview", "group": "Scope & Risk", "label": "Data Privacy Review", "type": "boolean", "default": true,
      "help": "On by default. Turn it off for a workload that handles no personal or regulated data." },

    {
      "id": "integrations", "group": "Integrations & Connectivity", "label": "Integrations & Connectivity",
      "type": "multi", "default": [],
      "options": [
        { "value": "core-services",   "label": "Core systems integration" },
        { "value": "api-gateway",            "label": "API gateway" },
        { "value": "data-warehouse",      "label": "Data warehouse" },
        { "value": "sso",        "label": "SSO" },
        { "value": "public-internet", "label": "Public Internet" },
        { "value": "private-network", "label": "Private Network (Internal Only)" },
        { "value": "web-proxy",       "label": "Web Proxy" },
        { "value": "mft",             "label": "Managed file transfer" }
      ]
    }
  ],

  /* --------------------------------------------------------------------------
     NAMED RULES. Write a policy once here, then reference it by name from any
     activity:  "when": "drRequired"
     Change the policy in one place and every activity using it follows.
     -------------------------------------------------------------------------- */
  "rules": {
    "cloud":            { "hosting": "cloud" },
    "onPrem":           { "hosting": "on-prem" },
    "aiWorkload":       { "aiWorkload": true },
    "newVendor":        { "newVendor": true },
    "newHardware":      { "hosting": "on-prem", "hardwareProcurement": true },
    "privacyReview":    { "privacyReview": true },

    /* DR applies to anything that is not a pilot */
    "drRequired":       { "pilotPoc": false },

    /* A penetration test is warranted by AI, by privacy-sensitive data, or by
       anything reachable from the internet. */
    "deepSecurity":     { "any": [ "aiWorkload", "privacyReview", { "integrations": { "includes": "public-internet" } } ] },

    /* --- work type groupings, so activities do not have to list all seven --- */
    "netNew":           { "workType": { "in": ["paved", "custom"] } },
    "acquired":         { "workType": { "in": ["saas", "cots"] } },
    "existingApp":      { "workType": { "in": ["rehost", "modernize", "capacity"] } },
    /* SaaS, a capacity add and a straight lift-and-shift build no application */
    "writesCode":       { "workType": { "notIn": ["saas", "capacity", "rehost"] } },
    "notCapacity":      { "workType": { "ne": "capacity" } },
    /* work that stands up a footprint rather than reusing one that exists */
    "newFootprint":     { "workType": { "notIn": ["capacity", "modernize"] } },
    /* the paved road is pre-approved; a capacity add and a straight rehost change no design */
    "architectureReview": { "workType": { "notIn": ["paved", "capacity", "rehost"] } }
  },

  /* --------------------------------------------------------------------------
     PROFILES. Each declares its work type and the sourcing facts that follow
     from it, and stays silent on hosting, AI, pilot status, privacy and
     integrations. Those are modifiers: set them once and they survive every
     profile change.
     -------------------------------------------------------------------------- */
  "presets": [
    { "id": "adopt-saas", "label": "Adopt SaaS", "partial": true,
      "description": "Vendor-hosted service. No build, no environments of ours to stand up.",
      "set": { "workType": "saas", "newVendor": true, "hardwareProcurement": false } },

    { "id": "deploy-cots", "label": "Deploy COTS", "partial": true,
      "description": "Buy the product, deploy and run it ourselves.",
      "set": { "workType": "cots", "newVendor": true } },

    { "id": "build-paved", "label": "Build on Paved Road", "partial": true,
      "description": "New build on a pre-approved pattern from the catalog.",
      "set": { "workType": "paved", "newVendor": false, "hardwareProcurement": false } },

    { "id": "build-custom", "label": "Build Custom / Non-Standard", "partial": true,
      "description": "New build off the paved road, so the design gets reviewed in full.",
      "set": { "workType": "custom", "newVendor": false } },

    { "id": "rehost", "label": "Rehost Existing App", "partial": true,
      "description": "Lift and shift with no redesign.",
      "set": { "workType": "rehost", "newVendor": false, "hardwareProcurement": false } },

    { "id": "modernize", "label": "Modernize / Upgrade Existing App", "partial": true,
      "description": "Version uplift or re-platform of something already running.",
      "set": { "workType": "modernize", "newVendor": false } },

    { "id": "expand-capacity", "label": "Expand Capacity", "partial": true,
      "description": "More of what is already there. No new app, no new design.",
      "set": { "workType": "capacity", "newVendor": false } }
  ]
});
