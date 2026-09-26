/* ============================================================================
   SCENARIO CONFIGURATION  (the controls in the left panel)
   ----------------------------------------------------------------------------
   Everything between the outer { } is plain JSON.

   attributes : each entry becomes a control. Types:
                  "boolean"  -> Yes/No choice
                  "enum"     -> single choice
                  "multi"    -> multi-select
                "section"     1..6: which wizard section the control lives in
                              (1 What are you doing? 2 Where will it run?
                               3 Is it standard? 4 Data and risk?
                               5 External dependencies? 6 Who builds/runs it?)
                "group"       puts the control under a heading inside its section
                "enabledWhen" greys the control out unless the rule matches
                "shownWhen"   hides it entirely until the rule matches; hidden
                              values are kept, not evaluated, and restored
                "derived"     the ENGINE computes this one (see "derive"); the
                              panel shows it as a chip with its reasons, and a
                              person can override it - with a recorded reason
                              where "overrideRequiresReason" says so
   presets    : named profiles. Each DECLARES a subset of the toggles and stays
                silent on the rest, so a modifier it never mentions survives a
                profile change.

   THE DESIGN RULE (the v5 specification's first principle): the user
   describes the workload; the engine decides the work. Nobody is asked "do
   you need a privacy review?" - they say what data is involved. Nobody picks
   an architecture lane - pattern facts and the service tier derive it.

   Some options here are vocabulary-first: runtime model, delivery ownership
   and most identity choices describe the workload for exports and future
   rules without yet driving a sample activity. Their help text says so.
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

    /* ================================================= 1 What are you doing? */
    { "id": "lifecycleStage", "section": 1, "group": "Lifecycle", "label": "Lifecycle stage", "type": "enum", "default": "new-prod",
      "options": [
        { "value": "poc",          "label": "Proof of concept" },
        { "value": "pilot",        "label": "Pilot" },
        { "value": "new-prod",     "label": "New production service" },
        { "value": "change",       "label": "Change to existing service" },
        { "value": "capacity-exp", "label": "Capacity expansion" },
        { "value": "migration",    "label": "Migration / modernization" },
        { "value": "retirement",   "label": "Retirement" }
      ] },
    { "id": "productionIncluded", "section": 1, "group": "Lifecycle", "label": "Production deployment included", "type": "boolean", "default": true,
      "help": "A PoC or pilot usually leaves this off - and with it goes DR design, the DR environment and the failover test." },

    /* ========================================= 2 Where and how will it run? */
    { "id": "hosting", "section": 2, "group": "Platform", "label": "Hosting target", "type": "enum", "default": "azure",
      "help": "Bare “Cloud” is deliberately not an option: it would fire Azure-specific landing-zone work for an AWS workload.",
      "options": [
        { "value": "azure",             "label": "Azure" },
        { "value": "aws",               "label": "AWS" },
        { "value": "gcp",               "label": "GCP" },
        { "value": "on-prem",           "label": "On-Premises" },
        { "value": "saas-vendor",       "label": "SaaS / vendor-hosted" },
        { "value": "hybrid",            "label": "Hybrid / multi-environment" },
        { "value": "existing-platform", "label": "Existing enterprise platform" }
      ] },
    { "id": "runtimeModel", "section": 2, "group": "Platform", "label": "Runtime / service model", "type": "multi", "default": ["paas"],
      "help": "Vocabulary-first: describes the workload for exports and rules. The sample binds only the private-endpoint derivation to it so far.",
      "options": [
        { "value": "iaas",            "label": "IaaS / virtual machines" },
        { "value": "containers",      "label": "Containers / Kubernetes" },
        { "value": "paas",            "label": "PaaS / managed service" },
        { "value": "serverless",      "label": "Serverless" },
        { "value": "data-platform",   "label": "Database / data platform" },
        { "value": "physical",        "label": "Physical infrastructure" },
        { "value": "vendor-hosted",   "label": "Vendor-hosted SaaS" },
        { "value": "shared-platform", "label": "Existing shared platform" }
      ] },
    { "id": "aiWorkload", "section": 2, "group": "AI", "label": "AI / ML workload", "type": "boolean", "default": false },
    { "id": "genAiWorkload", "section": 2, "group": "AI", "label": "Generative AI workload", "type": "boolean", "default": false,
      "help": "Generative AI carries its own approval path beyond traditional ML." },
    { "id": "genAiMonthlyCostOver1k", "section": 2, "group": "AI", "label": "GenAI run-rate over $1k/month", "type": "boolean", "default": false,
      "shownWhen": { "genAiWorkload": true } },
    { "id": "azureOpenAiPolicyException", "section": 2, "group": "AI", "label": "Model policy exception required", "type": "boolean", "default": false,
      "shownWhen": { "genAiWorkload": true } },

    /* ==================================================== 3 Is it standard? */
    { "id": "approvedPatternExists", "section": 3, "group": "Pattern", "label": "An approved pattern exists", "type": "boolean", "default": true },
    { "id": "patternConforms", "section": 3, "group": "Pattern", "label": "The design conforms to the pattern", "type": "boolean", "default": true,
      "enabledWhen": { "approvedPatternExists": true } },
    { "id": "newTechnology", "section": 3, "group": "Pattern", "label": "New technology for the organization", "type": "boolean", "default": false },
    { "id": "newEnterprisePlatform", "section": 3, "group": "Pattern", "label": "New enterprise platform / shared service", "type": "boolean", "default": false },
    { "id": "architectureDeviation", "section": 3, "group": "Pattern", "label": "Deviation from architecture standards", "type": "boolean", "default": false },

    { "id": "requirementsUnderstood", "section": 3, "group": "Selection facts", "label": "Requirements sufficiently understood", "type": "boolean", "default": true },
    { "id": "vendorLandscapeKnown", "section": 3, "group": "Selection facts", "label": "Vendor landscape known", "type": "boolean", "default": true },
    { "id": "candidateProductCount", "section": 3, "group": "Selection facts", "label": "Plausible candidate products", "type": "enum", "default": "1",
      "options": [
        { "value": "1",       "label": "One clear candidate" },
        { "value": "2-3",     "label": "Two or three" },
        { "value": "4-6",     "label": "Four to six" },
        { "value": "unknown", "label": "Unknown" }
      ] },
    { "id": "competitiveSourcing", "section": 3, "group": "Selection facts", "label": "Competitive sourcing required", "type": "boolean", "default": false },
    { "id": "unprovenTechnicalClaim", "section": 3, "group": "Selection facts", "label": "An unproven technical claim must be tested", "type": "boolean", "default": false },

    /* ======================================= 4 What data and business risk? */
    { "id": "dataScope", "section": 4, "group": "Data", "label": "Data involved", "type": "multi", "required": true,
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
    { "id": "serviceTier", "section": 4, "group": "Criticality", "label": "Service tier", "type": "enum", "default": "Tier 3", "required": true,
      "help": "Tier 0 is the most critical. 'Not yet determined' leaves the tier-driven controls at their defaults - decide it before go-live.",
      "options": [
        { "value": "Tier 0", "label": "Tier 0" },
        { "value": "Tier 1", "label": "Tier 1" },
        { "value": "Tier 2", "label": "Tier 2" },
        { "value": "Tier 3", "label": "Tier 3" },
        { "value": "Tier 4", "label": "Tier 4" },
        { "value": "tbd",    "label": "Not yet determined" }
      ] },

    /* ================================== 5 What external dependencies exist? */
    { "id": "thirdPartyInvolved", "section": 5, "group": "Sourcing", "label": "A third party is involved", "type": "boolean", "default": false },
    { "id": "newVendor", "section": 5, "group": "Sourcing", "label": "New vendor to the organization", "type": "boolean", "default": false },
    { "id": "existingApprovedVendor", "section": 5, "group": "Sourcing", "label": "Existing approved vendor", "type": "boolean", "default": false },
    { "id": "hardwareProcurement", "section": 5, "group": "Sourcing", "label": "Hardware purchase", "type": "boolean", "default": true,
      "enabledWhen": { "hosting": "on-prem" } },
    { "id": "softwareLicense", "section": 5, "group": "Sourcing", "label": "New or expanded software license", "type": "boolean", "default": false },
    { "id": "professionalServices", "section": 5, "group": "Sourcing", "label": "Professional services / SOW", "type": "boolean", "default": false },
    { "id": "vendorNeedsOrgAccess", "section": 5, "group": "Sourcing", "label": "Vendor people need internal access", "type": "boolean", "default": false },
    { "id": "vendorHostsOrAccessesData", "section": 5, "group": "Sourcing", "label": "Vendor hosts or accesses our data", "type": "boolean", "default": false },
    { "id": "managedService", "section": 5, "group": "Sourcing", "label": "Managed service", "type": "boolean", "default": false },
    { "id": "contractChangeRequired", "section": 5, "group": "Sourcing", "label": "Contract / MSA change required", "type": "boolean", "default": false },
    { "id": "soleSource", "section": 5, "group": "Sourcing", "label": "Sole-source route", "type": "boolean", "default": false },

    { "id": "identity", "section": 5, "group": "Identity & Access", "label": "Identity & Access", "type": "multi", "default": [],
      "help": "The sample binds SSO / federation; the rest describe the workload for exports and future rules.",
      "options": [
        { "value": "workforce",          "label": "Workforce user access" },
        { "value": "customer-identity",  "label": "Customer identity" },
        { "value": "partner-external",   "label": "Partner / external users" },
        { "value": "sso-federation",     "label": "SSO / federation" },
        { "value": "role-group-based",   "label": "Role / group-based access" },
        { "value": "privileged",         "label": "Privileged access" },
        { "value": "service-account",    "label": "Service account / machine identity" },
        { "value": "m2m-api",            "label": "M2M / API authentication" },
        { "value": "secrets-vaulting",   "label": "Secrets / key management" },
        { "value": "access-certification", "label": "Access certification" },
        { "value": "vendor-personnel",   "label": "Vendor personnel access" }
      ] },

    {
      "id": "integrations", "section": 5, "group": "Integrations", "label": "Integrations",
      "type": "multi", "default": [],
      "options": [
        { "value": "core-services",  "label": "Core systems integration" },
        { "value": "api-gateway",    "label": "API gateway" },
        { "value": "data-warehouse", "label": "Data warehouse" },
        { "value": "mft",            "label": "Managed file transfer" }
      ]
    },

    { "id": "network", "section": 5, "group": "Network & Exposure", "label": "Network & Exposure", "type": "multi", "default": [],
      "help": "Inbound exposure and outbound dependency are split on purpose: one earns the WAF and exposure review, the other earns proxy allowlisting.",
      "options": [
        { "value": "inbound-internet",     "label": "Public internet inbound" },
        { "value": "outbound-internet",    "label": "Public internet outbound" },
        { "value": "private-connectivity", "label": "Private connectivity (internal only)" },
        { "value": "hybrid-connectivity",  "label": "Hybrid / on-premises connectivity" },
        { "value": "load-balancer",        "label": "Load balancer required" },
        { "value": "firewall-change",      "label": "Firewall rules required" },
        { "value": "dns-ipam",             "label": "DNS / IPAM required" },
        { "value": "certificate-pki",      "label": "Certificate / PKI required" }
      ] },

    /* ================================== 6 Who builds and operates it? */
    { "id": "deliveryOwnership", "section": 6, "group": "Delivery model", "label": "Delivery ownership", "type": "enum", "default": "internal",
      "help": "Vendor or joint delivery pulls vendor onboarding in.",
      "options": [
        { "value": "internal",        "label": "Internal team delivered" },
        { "value": "vendor",          "label": "Vendor delivered" },
        { "value": "joint",           "label": "Joint internal / vendor" },
        { "value": "managed-service", "label": "Managed service" },
        { "value": "self-service",    "label": "Platform self-service" }
      ] },
    { "id": "supportModel", "section": 6, "group": "Delivery model", "label": "Production support model", "type": "enum", "default": "stream-aligned",
      "help": "Vocabulary-first: recorded with the scenario and exports; the sample's run activities are unconditional.",
      "options": [
        { "value": "stream-aligned", "label": "Stream-aligned team owns operations" },
        { "value": "platform-sre",   "label": "Platform / SRE-supported" },
        { "value": "central-ops",    "label": "Central operations" },
        { "value": "vendor",         "label": "Vendor-supported" },
        { "value": "shared",         "label": "Shared support model" }
      ] },

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

    /* network consequences (spec §5.10) */
    { "id": "wafRequired", "group": "Derived", "label": "WAF / exposure review required", "type": "boolean", "default": false,
      "derived": true,
      "derive": { "when": { "network": { "includes": "inbound-internet" } } } },
    { "id": "proxyAllowlisting", "group": "Derived", "label": "Proxy / egress allowlisting", "type": "boolean", "default": false,
      "derived": true,
      "derive": { "when": { "network": { "includes": "outbound-internet" } } } },
    { "id": "privateEndpoint", "group": "Derived", "label": "Private endpoint design", "type": "boolean", "default": true,
      "derived": true,
      "derive": { "when": { "runtimeModel": { "includes": "paas" } } } },

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
     Ids that activities referenced in 1.1 are unchanged; the hosting split
     changes what "cloud" MEANS (any hyperscaler) and adds "azure" for the
     rows that are genuinely Azure-specific - the exact misfire §8.2 warns
     about when everything hangs off one bare Cloud switch.
     -------------------------------------------------------------------------- */
  "rules": {
    "cloud":            { "hosting": { "in": ["azure", "aws", "gcp", "hybrid"] } },
    "azure":            { "hosting": "azure" },
    "onPrem":           { "hosting": "on-prem" },
    "aiWorkload":       { "aiWorkload": true },
    "newVendor":        { "newVendor": true },
    "newHardware":      { "hosting": "on-prem", "hardwareProcurement": true },

    /* the engine derives the privacy trigger from the data described */
    "privacyReview":    { "regulatedData": true },

    /* DR follows the service tier and production intent, not a pilot switch */
    "drRequired":       { "drRequired": true },

    /* spec §2.2's R_ThirdPartyRisk: a third party, AND it is new or touches
       our data or our systems. An existing vendor's services engagement does
       not re-run TPRM by itself. */
    "thirdPartyRisk":   { "all": [{ "thirdPartyInvolved": true },
                                   { "any": [{ "newVendor": true }, { "vendorHostsOrAccessesData": true }, { "vendorNeedsOrgAccess": true }] }] },

    /* A penetration test is warranted by AI, by privacy-relevant data, or by
       anything reachable from the internet. */
    "deepSecurity":     { "any": [ "aiWorkload", "privacyReview", { "network": { "includes": "inbound-internet" } } ] },

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
     from it, and the PATTERN facts the architecture lane derives from.
     Everything else - hosting, AI, data, tier, identity, network - is a
     modifier: set it once and it survives every profile change.
     -------------------------------------------------------------------------- */
  "presets": [
    { "id": "adopt-saas", "label": "Adopt SaaS", "partial": true,
      "description": "Vendor-hosted service. No build, no environments of ours to stand up.",
      "set": { "workType": "saas", "newVendor": true, "hardwareProcurement": false,
               "thirdPartyInvolved": true, "vendorHostsOrAccessesData": true,
               "approvedPatternExists": false, "patternConforms": false } },

    { "id": "deploy-cots", "label": "Deploy COTS", "partial": true,
      "description": "Buy the product, deploy and run it ourselves.",
      "set": { "workType": "cots", "newVendor": true,
               "thirdPartyInvolved": true, "softwareLicense": true,
               "approvedPatternExists": false, "patternConforms": false } },

    { "id": "build-paved", "label": "Build on Paved Road", "partial": true,
      "description": "New build on a pre-approved pattern from the catalog.",
      "set": { "workType": "paved", "newVendor": false, "hardwareProcurement": false,
               "thirdPartyInvolved": false,
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
