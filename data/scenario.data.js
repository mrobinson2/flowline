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
                "derived"     the ENGINE computes this one (see "derive"); the
                              panel shows it as a chip with its reasons, and a
                              person can override it - with a recorded reason
                              where "overrideRequiresReason" says so
   presets    : named profiles. Each DECLARES a subset of the toggles and stays
                silent on the rest, so a modifier it never mentions survives a
                profile change.

   THE DESIGN RULE (the v5 specification's first principle): the user
   describes the workload; the engine decides the work. Nobody is asked "do
   you need a privacy review?" - they say what data is involved, and
   regulatedData derives. Nobody picks an architecture lane - pattern facts
   and the service tier derive it, and overriding it leaves a reason behind.

   Activities reference attribute ids in their "when" rules, e.g.
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

    /* -------- what stage of life is this work, and does it reach production?
       This pair replaces the old "Pilot / PoC workload" switch, which mixed
       two facts: a PoC proves a hypothesis, a pilot runs limited real use,
       and EITHER may or may not include production controls. */
    { "id": "lifecycleStage", "group": "Scope & Risk", "label": "Lifecycle stage", "type": "enum", "default": "new-prod",
      "options": [
        { "value": "poc",          "label": "Proof of concept" },
        { "value": "pilot",        "label": "Pilot" },
        { "value": "new-prod",     "label": "New production service" },
        { "value": "change",       "label": "Change to existing service" },
        { "value": "capacity-exp", "label": "Capacity expansion" },
        { "value": "migration",    "label": "Migration / modernization" },
        { "value": "retirement",   "label": "Retirement" }
      ] },
    { "id": "productionIncluded", "group": "Scope & Risk", "label": "Production deployment included", "type": "boolean", "default": true,
      "help": "A PoC or pilot usually leaves this off - and with it goes DR design, the DR environment and the failover test." },

    /* -------- what data is involved. The person describes the data; the
       engine decides whether a privacy review is required (regulatedData,
       below). The old "Data Privacy Review" toggle asked the user to perform
       that derivation in their head. */
    { "id": "dataScope", "group": "Scope & Risk", "label": "Data involved", "type": "multi",
      "default": ["customer-personal"],
      "help": "The shipped sample assumes customer personal data, which is what keeps the privacy work in the default map. Describe your own workload's data and the reviews follow.",
      "options": [
        { "value": "no-business-data",       "label": "No business data" },
        { "value": "internal-business",      "label": "Internal business data" },
        { "value": "customer-personal",      "label": "Customer / personal data" },
        { "value": "employee",               "label": "Employee data" },
        { "value": "confidential-restricted", "label": "Confidential / restricted" },
        { "value": "payment-cardholder",     "label": "Payment / cardholder data" },
        { "value": "sox",                    "label": "Financial reporting (SOX)" },
        { "value": "glba",                   "label": "Regulated (GLBA or similar)" },
        { "value": "residency",              "label": "Data residency constraints" },
        { "value": "retention",              "label": "Records-management retention" },
        { "value": "ai-training",            "label": "AI training / grounding data" }
      ] },

    /* -------- service criticality. THE single largest gap the specification
       called out: the tier drives DR, HA, support model, performance
       validation - all derived below rather than asked one by one. */
    { "id": "serviceTier", "group": "Scope & Risk", "label": "Service tier", "type": "enum", "default": "Tier 3",
      "help": "Tier 0 is the most critical. 'Not yet determined' leaves the tier-driven controls at their defaults - decide it before go-live.",
      "options": [
        { "value": "Tier 0", "label": "Tier 0" },
        { "value": "Tier 1", "label": "Tier 1" },
        { "value": "Tier 2", "label": "Tier 2" },
        { "value": "Tier 3", "label": "Tier 3" },
        { "value": "Tier 4", "label": "Tier 4" },
        { "value": "tbd",    "label": "Not yet determined" }
      ] },

    /* -------- pattern and novelty facts: the inputs the architecture lane
       derives from. The lane itself is not a question (spec §4 group 4). */
    { "id": "approvedPatternExists", "group": "Is it standard?", "label": "An approved pattern exists", "type": "boolean", "default": true },
    { "id": "patternConforms", "group": "Is it standard?", "label": "The design conforms to the pattern", "type": "boolean", "default": true,
      "enabledWhen": { "approvedPatternExists": true } },
    { "id": "newTechnology", "group": "Is it standard?", "label": "New technology for the organization", "type": "boolean", "default": false },
    { "id": "newEnterprisePlatform", "group": "Is it standard?", "label": "New enterprise platform / shared service", "type": "boolean", "default": false },
    { "id": "architectureDeviation", "group": "Is it standard?", "label": "Deviation from architecture standards", "type": "boolean", "default": false },

    /* -------- selection facts: the inputs the selection route derives from.
       RFI / RFP / PoC are not questions either (spec §4 group 5). */
    { "id": "requirementsUnderstood", "group": "Sourcing", "label": "Requirements sufficiently understood", "type": "boolean", "default": true },
    { "id": "vendorLandscapeKnown", "group": "Sourcing", "label": "Vendor landscape known", "type": "boolean", "default": true },
    { "id": "candidateProductCount", "group": "Sourcing", "label": "Plausible candidate products", "type": "enum", "default": "1",
      "options": [
        { "value": "1",       "label": "One clear candidate" },
        { "value": "2-3",     "label": "Two or three" },
        { "value": "4-6",     "label": "Four to six" },
        { "value": "unknown", "label": "Unknown" }
      ] },
    { "id": "competitiveSourcing", "group": "Sourcing", "label": "Competitive sourcing required", "type": "boolean", "default": false },
    { "id": "unprovenTechnicalClaim", "group": "Sourcing", "label": "An unproven technical claim must be tested", "type": "boolean", "default": false },

    {
      "id": "integrations", "group": "Integrations & Connectivity", "label": "Integrations & Connectivity",
      "type": "multi", "default": [],
      "options": [
        { "value": "core-services",   "label": "Core systems integration" },
        { "value": "api-gateway",     "label": "API gateway" },
        { "value": "data-warehouse",  "label": "Data warehouse" },
        { "value": "sso",             "label": "SSO" },
        { "value": "public-internet", "label": "Public Internet" },
        { "value": "private-network", "label": "Private Network (Internal Only)" },
        { "value": "web-proxy",       "label": "Web Proxy" },
        { "value": "mft",             "label": "Managed file transfer" }
      ]
    },

    /* ======================================================================
       DERIVED ATTRIBUTES. Everything below is computed, in this order, from
       the answers above (js/derive.js). Each renders as a chip that explains
       itself; overriding one records who insisted and why.
       Their DEFAULTS are deliberately the values the shipped default scenario
       derives, so a caller that never passes attribute definitions (and so
       never runs the derivation pass) still gets the 1.1-identical map.
       ====================================================================== */
    { "id": "regulatedData", "group": "Derived", "label": "Privacy-relevant data", "type": "boolean", "default": true,
      "derived": true,
      "derive": { "when": { "dataScope": { "includesAny": ["customer-personal", "employee", "confidential-restricted", "payment-cardholder", "sox", "glba"] } } } },

    { "id": "drRequired", "group": "Derived", "label": "DR required", "type": "boolean", "default": true,
      "derived": true,
      "derive": { "when": { "all": [{ "productionIncluded": true }, { "serviceTier": { "in": ["Tier 0", "Tier 1", "Tier 2", "Tier 3"] } }] } } },
    { "id": "formalDrTestRequired", "group": "Derived", "label": "Formal DR test before go-live", "type": "boolean", "default": false,
      "derived": true,
      "derive": { "when": { "all": [{ "productionIncluded": true }, { "serviceTier": { "in": ["Tier 0", "Tier 1", "Tier 2"] } }] } } },
    { "id": "highAvailability", "group": "Derived", "label": "High availability required", "type": "boolean", "default": false,
      "derived": true,
      "derive": { "when": { "serviceTier": { "in": ["Tier 0", "Tier 1"] } } } },
    { "id": "support24x7", "group": "Derived", "label": "24x7 operational support", "type": "boolean", "default": false,
      "derived": true,
      "derive": { "when": { "serviceTier": { "in": ["Tier 0", "Tier 1"] } } } },
    { "id": "performanceValidationRequired", "group": "Derived", "label": "Performance validation required", "type": "boolean", "default": true,
      "derived": true,
      "derive": { "when": { "serviceTier": { "in": ["Tier 0", "Tier 1", "Tier 2", "Tier 3"] } } } },

    { "id": "architectureLane", "group": "Derived", "label": "Architecture route", "type": "enum", "default": "fast",
      "derived": true, "overrideRequiresReason": true,
      "options": [
        { "value": "fast",     "label": "Fast Lane" },
        { "value": "standard", "label": "Standard Lane" },
        { "value": "custom",   "label": "Custom Lane" }
      ],
      "derive": {
        "cases": [
          { "when": { "any": [{ "architectureDeviation": true }, { "newEnterprisePlatform": true },
                              { "all": [{ "newTechnology": true }, { "serviceTier": { "in": ["Tier 0", "Tier 1"] } }] }] },
            "value": "custom" },
          { "when": { "all": [{ "approvedPatternExists": true }, { "patternConforms": true },
                              { "serviceTier": { "in": ["Tier 3", "Tier 4"] } }] },
            "value": "fast" }
        ],
        "default": "standard"
      } },

    { "id": "selectionRoute", "group": "Derived", "label": "Selection route", "type": "enum", "default": "none",
      "derived": true, "overrideRequiresReason": true,
      "options": [
        { "value": "none",        "label": "No product selection" },
        { "value": "eval",        "label": "Product evaluation only" },
        { "value": "eval-poc",    "label": "Evaluation + PoC" },
        { "value": "rfp",         "label": "RFP" },
        { "value": "rfp-poc",     "label": "RFP + PoC" },
        { "value": "rfi-rfp",     "label": "RFI then RFP" },
        { "value": "rfi-rfp-poc", "label": "RFI, RFP and PoC" }
      ],
      "derive": {
        "cases": [
          { "when": { "workType": { "notIn": ["saas", "cots"] } }, "value": "none" },
          { "when": { "all": [{ "any": [{ "requirementsUnderstood": false }, { "vendorLandscapeKnown": false }, { "candidateProductCount": { "in": ["4-6", "unknown"] } }] }, { "unprovenTechnicalClaim": true }] },
            "value": "rfi-rfp-poc" },
          { "when": { "any": [{ "requirementsUnderstood": false }, { "vendorLandscapeKnown": false }, { "candidateProductCount": { "in": ["4-6", "unknown"] } }] },
            "value": "rfi-rfp" },
          { "when": { "all": [{ "any": [{ "competitiveSourcing": true }, { "candidateProductCount": "2-3" }] }, { "unprovenTechnicalClaim": true }] },
            "value": "rfp-poc" },
          { "when": { "any": [{ "competitiveSourcing": true }, { "candidateProductCount": "2-3" }] },
            "value": "rfp" },
          { "when": { "unprovenTechnicalClaim": true }, "value": "eval-poc" }
        ],
        "default": "eval"
      } },

    { "id": "productEvaluationRequired", "group": "Derived", "label": "Product evaluation required", "type": "boolean", "default": false,
      "derived": true, "derive": { "when": { "selectionRoute": { "in": ["eval", "eval-poc"] } } } },
    { "id": "rfiRequired", "group": "Derived", "label": "RFI required", "type": "boolean", "default": false,
      "derived": true, "derive": { "when": { "selectionRoute": { "in": ["rfi-rfp", "rfi-rfp-poc"] } } } },
    { "id": "rfpRequired", "group": "Derived", "label": "RFP required", "type": "boolean", "default": false,
      "derived": true, "derive": { "when": { "selectionRoute": { "in": ["rfp", "rfp-poc", "rfi-rfp", "rfi-rfp-poc"] } } } },
    { "id": "pocRequired", "group": "Derived", "label": "Selection PoC required", "type": "boolean", "default": false,
      "derived": true, "derive": { "when": { "selectionRoute": { "in": ["eval-poc", "rfp-poc", "rfi-rfp-poc"] } } } }
  ],

  /* --------------------------------------------------------------------------
     NAMED RULES. Write a policy once here, then reference it by name from any
     activity:  "when": "drRequired"
     The IDS are unchanged from 1.1 - activities did not have to be touched -
     but the BODIES now point at derived attributes, which is the §8.5
     dissolution: the engine decides, the rule names the decision.
     -------------------------------------------------------------------------- */
  "rules": {
    "cloud":            { "hosting": "cloud" },
    "onPrem":           { "hosting": "on-prem" },
    "aiWorkload":       { "aiWorkload": true },
    "newVendor":        { "newVendor": true },
    "newHardware":      { "hosting": "on-prem", "hardwareProcurement": true },

    /* the engine derives the privacy trigger from the data described */
    "privacyReview":    { "regulatedData": true },

    /* DR follows the service tier and production intent, not a pilot switch */
    "drRequired":       { "drRequired": true },

    /* A penetration test is warranted by AI, by privacy-relevant data, or by
       anything reachable from the internet. */
    "deepSecurity":     { "any": [ "aiWorkload", "privacyReview", { "integrations": { "includes": "public-internet" } } ] },

    /* the Fast Lane inherits its reviews from the pattern; Standard and
       Custom earn the Architecture Review Board */
    "architectureReview": { "architectureLane": { "in": ["standard", "custom"] } },

    /* --- work type groupings, so activities do not have to list all seven --- */
    "netNew":           { "workType": { "in": ["paved", "custom"] } },
    "acquired":         { "workType": { "in": ["saas", "cots"] } },
    "existingApp":      { "workType": { "in": ["rehost", "modernize", "capacity"] } },
    /* SaaS, a capacity add and a straight lift-and-shift build no application */
    "writesCode":       { "workType": { "notIn": ["saas", "capacity", "rehost"] } },
    "notCapacity":      { "workType": { "ne": "capacity" } },
    /* work that stands up a footprint rather than reusing one that exists */
    "newFootprint":     { "workType": { "notIn": ["capacity", "modernize"] } }
  },

  /* --------------------------------------------------------------------------
     PROFILES. Each declares its work type, the sourcing facts that follow
     from it, and now the PATTERN facts the architecture lane derives from
     (spec §1's suggested mappings). Everything else - hosting, AI, data,
     tier, integrations - is a modifier: set it once and it survives every
     profile change.
     -------------------------------------------------------------------------- */
  "presets": [
    { "id": "adopt-saas", "label": "Adopt SaaS", "partial": true,
      "description": "Vendor-hosted service. No build, no environments of ours to stand up.",
      "set": { "workType": "saas", "newVendor": true, "hardwareProcurement": false,
               "approvedPatternExists": false, "patternConforms": false } },

    { "id": "deploy-cots", "label": "Deploy COTS", "partial": true,
      "description": "Buy the product, deploy and run it ourselves.",
      "set": { "workType": "cots", "newVendor": true,
               "approvedPatternExists": false, "patternConforms": false } },

    { "id": "build-paved", "label": "Build on Paved Road", "partial": true,
      "description": "New build on a pre-approved pattern from the catalog.",
      "set": { "workType": "paved", "newVendor": false, "hardwareProcurement": false,
               "approvedPatternExists": true, "patternConforms": true, "architectureDeviation": false } },

    { "id": "build-custom", "label": "Build Custom / Non-Standard", "partial": true,
      "description": "New build off the paved road, so the design gets reviewed in full.",
      "set": { "workType": "custom", "newVendor": false,
               "approvedPatternExists": false, "patternConforms": false, "architectureDeviation": true } },

    { "id": "rehost", "label": "Rehost Existing App", "partial": true,
      "description": "Lift and shift with no redesign.",
      "set": { "workType": "rehost", "newVendor": false, "hardwareProcurement": false,
               "approvedPatternExists": true, "patternConforms": true } },

    { "id": "modernize", "label": "Modernize / Upgrade Existing App", "partial": true,
      "description": "Version uplift or re-platform of something already running.",
      "set": { "workType": "modernize", "newVendor": false,
               "approvedPatternExists": true, "patternConforms": false } },

    { "id": "expand-capacity", "label": "Expand Capacity", "partial": true,
      "description": "More of what is already there. No new app, no new design.",
      "set": { "workType": "capacity", "newVendor": false,
               "approvedPatternExists": true, "patternConforms": true } }
  ]
});
