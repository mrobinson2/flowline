/* ============================================================================
   PROCESS DATA  (the value stream)
   ----------------------------------------------------------------------------
   Everything between the outer { } is plain JSON. Edit, save, reload.

   Durations are in business days. Decimals are fine (0.5).

   Activity fields
     id            unique, used by predecessors
     name          label shown next to the bar
     description   shown in the details panel / tooltip
     phase         groups rows visually (see "phases" below)
     owner         team id (see "teams"). Ownership change between a predecessor
                   and this activity is detected automatically as a handoff.
     category      value | enabling | approval   (see taxonomy categories)
     waste         optional waste type id (see taxonomy wasteTypes)
     duration      { "current": days, "optimal": days }
     predecessors  ids this activity waits for (finish-to-start). If a
                   predecessor is excluded by the scenario, its own predecessors
                   are used instead, so chains stay intact.
     when          rule deciding whether the activity appears. Omit = always.
                     { "hosting": "cloud" }                         equals
                     { "hosting": "cloud", "aiWorkload": true }     both (AND)
                     { "any": [ {...}, {...} ] }                    OR
                     { "not": {...} }                               NOT
                     { "workType": { "in": ["a","b"] } }         one of
                     { "integrations": { "includes": "sso" } }      multi-select contains
     overrides     optional: [ { "when": {...}, "duration": {...}, "note": "" } ]
                   first matching override replaces the duration.
     handoff       true  = treat every incoming link as a handoff (even same team)
                   false = never a handoff (suppress auto-detection)
     handoffs      ["pred-id"] = declare a handoff only from those predecessors
     milestone     true = draw as a diamond only (usually with duration 0)
     notes         free text for the workshop

   Project tracking (all optional; the Tracker view reads them)
     status        todo | doing | done | blocked | skipped   (absent = todo)
     progress      0..100, how far a "doing" activity is (absent = 50)
     statusNote    free text - why blocked, what's happening
     statusDate    YYYY-MM-DD of the last status change

   Two-level rollup (optional)
     stages        [{ id, label, short }] - the executive grouping
     phases[].stage  the stage a phase rolls up into; the Tracker view draws
                   one segment per stage when these are set, else per phase
   ========================================================================== */
VSM.register("process", {
  "title": "Application Delivery Value Stream",
  "subtitle": "Intake to production for a new application or platform capability",
  "units": "business days",
  "version": "2026-09-16",

  "stages": [
    { "id": "define",  "label": "Define",  "short": "Define" },
    { "id": "source",  "label": "Source",  "short": "Source" },
    { "id": "deliver", "label": "Deliver", "short": "Deliver" },
    { "id": "launch",  "label": "Launch",  "short": "Launch" }
  ],

  "phases": [
    { "id": "intake",    "label": "Intake & Funding",         "short": "Intake",    "stage": "define" },
    { "id": "vendor",    "label": "Vendor Onboarding",        "short": "Vendor",    "stage": "source" },
    { "id": "design",    "label": "Architecture & Design",    "short": "Design",    "stage": "deliver" },
    { "id": "provision", "label": "Environment Provisioning", "short": "Provision", "stage": "deliver" },
    { "id": "build",     "label": "Build & Test",             "short": "Build",     "stage": "deliver" },
    { "id": "release",   "label": "Release & Handover",       "short": "Release",   "stage": "launch" }
  ],

  "teams": {
    "pmo":         { "label": "PMO / Project Management",   "short": "PMO",          "org": "Business" },
    "sponsor":     { "label": "Business Sponsor",           "short": "Sponsor",      "org": "Business" },
    "finance":     { "label": "Finance",                    "short": "Finance",      "org": "Finance" },
    "procurement": { "label": "Procurement",                "short": "Procurement",  "org": "Finance" },
    "legal":       { "label": "Legal & Privacy",            "short": "Legal",        "org": "Legal" },
    "ea":          { "label": "Enterprise Architecture",    "short": "Architecture", "org": "Technology" },
    "cloud":       { "label": "Cloud Platform",      "short": "Cloud",   "org": "Technology" },
    "infra":       { "label": "Infrastructure Operations",  "short": "Infra Ops",    "org": "Technology" },
    "network":     { "label": "Network Engineering",        "short": "Network",      "org": "Technology" },
    "dba":         { "label": "Database Services",          "short": "Database",     "org": "Technology" },
    "dev":         { "label": "Application Development",    "short": "App Dev",      "org": "Technology" },
    "qa":          { "label": "QA / Testing",               "short": "QA",           "org": "Technology" },
    "ops":         { "label": "IT Operations",              "short": "IT Ops",       "org": "Technology" },
    "coreservices":{ "label": "Core Services",             "short": "Core Svcs",    "org": "Technology" },
    "security":    { "label": "Cyber Security",             "short": "Security",     "org": "Security" },
    "cab":         { "label": "Change Advisory Board",      "short": "CAB",          "org": "Governance" },
    "resilience":  { "label": "Resilience / BCP",           "short": "Resilience",   "org": "Governance" },
    "data":        { "label": "Data Governance",            "short": "Data Gov",     "org": "Data & AI" },
    "ai":          { "label": "AI Platform & Governance",   "short": "AI Platform",  "org": "Data & AI" },
    "vendor":      { "label": "External Vendor",            "short": "Vendor",       "org": "External" }
  },

  "activities": [

    /* ---------------- Intake & Funding ---------------- */
    { "id": "intake", "name": "Submit intake request", "phase": "intake", "owner": "pmo",
      "category": "value", "duration": { "current": 2, "optimal": 1 }, "predecessors": [],
      "description": "Sponsor and PM complete the intake form describing the business need." },

    { "id": "intake-triage", "name": "Intake triage & prioritization", "phase": "intake", "owner": "pmo",
      "category": "enabling", "waste": "queue", "duration": { "current": 10, "optimal": 2 }, "predecessors": ["intake"],
      "description": "Request waits for the bi-weekly demand review before anyone looks at it.",
      "notes": "Most of this is calendar wait for the demand meeting, not work." },

    { "id": "biz-case", "name": "Business case & funding approval", "phase": "intake", "owner": "finance",
      "category": "approval", "waste": "approval-gate", "duration": { "current": 15, "optimal": 5 }, "predecessors": ["intake-triage"],
      "description": "Finance reviews the cost estimate and the sponsor obtains funding sign-off." },

    { "id": "sizing", "name": "High-level solution sizing", "phase": "intake", "owner": "ea",
      "category": "value", "duration": { "current": 5, "optimal": 3 }, "predecessors": ["biz-case"],
      "description": "Architecture produces a T-shirt size, hosting recommendation and rough cost." },

    { "id": "kickoff", "name": "Project kickoff & team assignment", "phase": "intake", "owner": "pmo",
      "category": "enabling", "waste": "scheduling", "duration": { "current": 8, "optimal": 2 }, "predecessors": ["sizing"],
      "description": "Waiting for named resources to free up and for a kickoff slot on everyone's calendar." },

    /* ---------------- Vendor Onboarding (only when a new vendor is involved) ---------------- */
    { "id": "vendor-rfp", "name": "Vendor RFP & evaluation", "phase": "vendor", "owner": "procurement",
      "category": "enabling", "waste": "external", "duration": { "current": 30, "optimal": 15 }, "predecessors": ["sizing"],
      "when": { "any": [{ "productEvaluationRequired": true }, { "rfpRequired": true }, { "rfiRequired": true }] },
      "description": "Issue RFP, score responses, shortlist, run demos." },

    { "id": "vendor-risk", "name": "Third-party risk assessment", "phase": "vendor", "owner": "security",
      "category": "approval", "waste": "approval-gate", "duration": { "current": 20, "optimal": 7 }, "predecessors": ["vendor-rfp"],
      "when": "thirdPartyRisk",
      "description": "Security questionnaire, SOC 2 review, and risk rating for the vendor." },

    { "id": "vendor-contract", "name": "Contract negotiation & legal review", "phase": "vendor", "owner": "legal",
      "category": "enabling", "waste": "external", "duration": { "current": 25, "optimal": 10 }, "predecessors": ["vendor-risk"],
      "when": { "any": [{ "contractChangeRequired": true }, "newVendor"] },
      "description": "MSA, DPA and order form redlines go back and forth with the vendor's counsel." },

    { "id": "vendor-onboard", "name": "Vendor onboarding (accounts, NDA, access)", "phase": "vendor", "owner": "procurement",
      "category": "enabling", "waste": "manual", "duration": { "current": 10, "optimal": 3 }, "predecessors": ["vendor-contract"],
      "when": { "any": [{ "vendorNeedsOrgAccess": true }, { "professionalServices": true }, { "deliveryOwnership": { "in": ["vendor", "joint"] } }] },
      "description": "Supplier record, NDA, badge and system access are set up by hand across four systems." },

    /* ---------------- Architecture & Design ---------------- */
    { "id": "arch-design", "name": "Solution architecture design", "phase": "design", "owner": "ea",
      "category": "value", "duration": { "current": 10, "optimal": 8 }, "predecessors": ["kickoff", "vendor-onboard"],
      "when": "notCapacity",
      "description": "Target architecture, integration design, hosting pattern selection." },

    { "id": "arb", "name": "Architecture Review Board", "phase": "design", "owner": "ea",
      "category": "approval", "waste": "approval-gate", "duration": { "current": 12, "optimal": 3 }, "predecessors": ["arch-design"],
      "when": "architectureReview",
      "description": "The design waits for the next ARB slot, is presented, and receives a decision.",
      "notes": "ARB meets every other week; the decision itself takes an hour." },

    { "id": "arb-rework", "name": "ARB rework & resubmission", "phase": "design", "owner": "ea",
      "category": "enabling", "waste": "rework", "duration": { "current": 5, "optimal": 0 }, "predecessors": ["arb"],
      "when": "architectureReview",
      "description": "Roughly half of first submissions are sent back for changes and re-presented.",
      "notes": "Optimal is zero: pre-review with a standards checklist would remove the loop." },

    { "id": "sec-design-recheck", "name": "Security re-review after ARB changes", "phase": "design", "owner": "security",
      "category": "approval", "waste": "duplicate", "duration": { "current": 5, "optimal": 0 }, "predecessors": ["arb-rework"],
      "when": "architectureReview",
            "description": "Security reviews the design a second time because the ARB changes were not shared with them.",
      "notes": "Duplicate of the security design review. Joint ARB + security session would remove it." },

    { "id": "data-class", "name": "Data classification", "phase": "design", "owner": "data",
      "category": "enabling", "duration": { "current": 3, "optimal": 1 }, "predecessors": ["arch-design"],
      "when": "notCapacity",
      "description": "Data owner classifies the data sets the solution will hold." },

    { "id": "privacy-review", "name": "Privacy impact assessment", "phase": "design", "owner": "legal",
      "category": "approval", "waste": "approval-gate", "duration": { "current": 15, "optimal": 5 }, "predecessors": ["data-class"],
      "when": "privacyReview",
      "description": "Legal & Privacy assess personal data handling and required controls." },

    { "id": "sec-design-review", "name": "Security review", "phase": "design", "owner": "security",
      "category": "approval", "waste": "approval-gate", "duration": { "current": 12, "optimal": 4 }, "predecessors": ["arch-design"],
            "description": "Security architecture reviews the design against control requirements.",
      "overrides": [
        { "when": "privacyReview", "duration": { "current": 18, "optimal": 6 }, "note": "A privacy review adds a second reviewer." }
      ] },

    { "id": "threat-model", "name": "Threat modeling & access review", "phase": "design", "owner": "security",
      "category": "value", "duration": { "current": 4, "optimal": 3 }, "predecessors": ["sec-design-review"],
      "when": "deepSecurity",
      "description": "Joint workshop with the development team to identify threats and mitigations." },

    { "id": "ai-use-case-review", "name": "AI use-case & model risk review", "phase": "design", "owner": "ai",
      "category": "approval", "waste": "approval-gate", "duration": { "current": 15, "optimal": 5 }, "predecessors": ["arch-design"],
      "when": "aiWorkload",
      "description": "AI governance reviews intended use, model risk tier and human oversight design." },

    { "id": "ai-data-access", "name": "Training / inference data access approval", "phase": "design", "owner": "data",
      "category": "approval", "waste": "approval-gate", "duration": { "current": 10, "optimal": 3 }, "predecessors": ["ai-use-case-review", "data-class"],
      "when": "aiWorkload",
      "description": "Data owners approve which data sets the model may use." },

    { "id": "model-eval", "name": "Model selection & evaluation", "phase": "design", "owner": "ai",
      "category": "value", "duration": { "current": 10, "optimal": 8 }, "predecessors": ["ai-data-access"],
      "when": "aiWorkload",
      "description": "Compare candidate models on the approved data; document evaluation results." },

    { "id": "responsible-ai-gate", "name": "Responsible AI sign-off", "phase": "design", "owner": "ai",
      "category": "approval", "waste": "approval-gate", "duration": { "current": 5, "optimal": 1 }, "predecessors": ["model-eval"],
      "when": "aiWorkload",
      "description": "Formal go / no-go on the model and its guardrails." },

    { "id": "dr-design", "name": "DR strategy & runbook design", "phase": "design", "owner": "resilience",
      "category": "value", "duration": { "current": 6, "optimal": 4 }, "predecessors": ["arch-design"],
      "when": "drRequired",
      "description": "Define RTO/RPO, failover approach and recovery runbook." },

    /* ---------------- Environment Provisioning: CLOUD ---------------- */
    { "id": "cloud-subscription", "name": "Subscription / account request", "phase": "provision", "owner": "cloud",
      "category": "enabling", "waste": "manual", "duration": { "current": 5, "optimal": 1 }, "predecessors": ["arb", "arb-rework"],
      "when": {"all": ["azure", "newFootprint"]},
      "description": "Ticket-driven request for a new subscription; created by hand from a template." },

    { "id": "cloud-landing-zone", "name": "Landing zone & policy assignment", "phase": "provision", "owner": "cloud",
      "category": "enabling", "duration": { "current": 3, "optimal": 1 }, "predecessors": ["cloud-subscription"],
      "when": {"all": ["azure", "newFootprint"]},
      "description": "Place the subscription in the management group hierarchy; apply guardrail policies and tags." },

    { "id": "gpu-quota", "name": "GPU quota / capacity request", "phase": "provision", "owner": "cloud",
      "category": "enabling", "waste": "external", "duration": { "current": 10, "optimal": 3 }, "predecessors": ["cloud-subscription"],
      "when": { "all": ["azure", "aiWorkload"] },
      "description": "Quota increase request to the cloud provider for GPU SKUs in the target region." },

    { "id": "cloud-network", "name": "Network connectivity (vNet, peering, DNS)", "phase": "provision", "owner": "network",
      "category": "enabling", "waste": "queue", "duration": { "current": 8, "optimal": 2 }, "predecessors": ["cloud-landing-zone"],
      "when": "cloud",
      "description": "Network team allocates address space, peers to the hub and registers DNS.",
      "notes": "Request sits in the network queue for about a week; the work is half a day." },

    { "id": "cloud-iam", "name": "Identity & access (RBAC, service principals)", "phase": "provision", "owner": "security",
      "category": "enabling", "waste": "manual", "duration": { "current": 6, "optimal": 1 }, "predecessors": ["cloud-landing-zone"],
      "when": {"all": ["azure", "newFootprint"]},
      "description": "Groups, role assignments and workload identities created through the IAM ticket process." },

    { "id": "cloud-iac", "name": "Infrastructure as code build (Terraform)", "phase": "provision", "owner": "cloud",
      "category": "value", "duration": { "current": 8, "optimal": 6 }, "predecessors": ["cloud-network", "cloud-iam"],
      "when": "cloud",
      "description": "Compose landing-zone modules into the workload's infrastructure code." },

    { "id": "cloud-cost-approval", "name": "Cloud cost / FinOps approval", "phase": "provision", "owner": "finance",
      "category": "approval", "waste": "approval-gate", "duration": { "current": 6, "optimal": 2 }, "predecessors": ["cloud-iac"],
      "when": "cloud",
      "description": "Forecast run-rate is reviewed against the approved business case." },

    { "id": "cloud-env-dev", "name": "Dev / test environment deployment", "phase": "provision", "owner": "cloud",
      "category": "value", "duration": { "current": 2, "optimal": 1 }, "predecessors": ["cloud-iac", "cloud-cost-approval"],
      "when": {"all": ["cloud", "notCapacity"]},
      "description": "Pipeline deploys the environment from code." },

    /* ---------------- Environment Provisioning: ON-PREMISES ---------------- */
    { "id": "hw-spec", "name": "Hardware specification & quote", "phase": "provision", "owner": "infra",
      "category": "enabling", "duration": { "current": 7, "optimal": 4 }, "predecessors": ["arb"],
      "when": "newHardware",
      "description": "Size servers, storage and (for AI) GPU nodes; obtain vendor quotes.",
      "overrides": [
        { "when": "aiWorkload", "duration": { "current": 12, "optimal": 6 }, "note": "GPU configurations require vendor sizing assistance." }
      ] },

    { "id": "hw-po", "name": "Purchase order approval", "phase": "provision", "owner": "procurement",
      "category": "approval", "waste": "approval-gate", "duration": { "current": 12, "optimal": 3 }, "predecessors": ["hw-spec"],
      "when": "newHardware",
      "description": "Three-quote rule, budget check and signature chain for the purchase order." },

    { "id": "hw-lead", "name": "Hardware lead time (vendor shipping)", "phase": "provision", "owner": "vendor",
      "category": "enabling", "waste": "procurement", "duration": { "current": 45, "optimal": 30 }, "predecessors": ["hw-po"],
      "when": "newHardware",
      "description": "Manufacturing and shipping lead time from the hardware vendor.",
      "overrides": [
        { "when": "aiWorkload", "duration": { "current": 70, "optimal": 45 }, "note": "GPU servers carry longer lead times." }
      ] },

    { "id": "hw-rack", "name": "Rack, cable & power", "phase": "provision", "owner": "infra",
      "category": "enabling", "duration": { "current": 5, "optimal": 3 }, "predecessors": ["hw-lead"],
      "when": "newHardware",
      "description": "Data center team receives, racks and cables the equipment." },

    { "id": "onprem-vm", "name": "Compute build (virtual machines)", "phase": "provision", "owner": "infra",
      "category": "enabling", "waste": "manual", "duration": { "current": 10, "optimal": 2 }, "predecessors": ["arb", "arb-rework", "hw-rack"],
      "when": "onPrem",
      "description": "VMs built from the request form by an engineer; naming, IPs and tags entered by hand." },

    { "id": "onprem-storage", "name": "Storage allocation", "phase": "provision", "owner": "infra",
      "category": "enabling", "waste": "queue", "duration": { "current": 8, "optimal": 1 }, "predecessors": ["onprem-vm"],
      "when": "onPrem",
      "description": "LUN / share request waits in the storage queue." },

    { "id": "onprem-network", "name": "Firewall & load balancer changes", "phase": "provision", "owner": "network",
      "category": "enabling", "waste": "queue", "duration": { "current": 12, "optimal": 3 }, "predecessors": ["onprem-vm"],
      "when": "onPrem",
      "description": "Firewall rule requests and VIP creation go through the weekly network change cycle." },

    { "id": "onprem-os", "name": "OS hardening & agent install", "phase": "provision", "owner": "ops",
      "category": "enabling", "waste": "manual", "duration": { "current": 5, "optimal": 1 }, "predecessors": ["onprem-storage", "onprem-network"],
      "when": "onPrem",
      "description": "Baseline hardening, monitoring and security agents installed by hand." },

    /* ---------------- Environment Provisioning: SHARED ---------------- */
    { "id": "dba-provision", "name": "Database provisioning", "phase": "provision", "owner": "dba",
      "category": "enabling", "waste": "manual", "duration": { "current": 7, "optimal": 2 }, "predecessors": ["cloud-env-dev", "onprem-os"],
      "description": "DBA team creates instances, databases and access from a ticket." },

    { "id": "ai-platform-onboard", "name": "AI platform onboarding (model gateway)", "phase": "provision", "owner": "ai",
      "category": "enabling", "waste": "manual", "duration": { "current": 5, "optimal": 2 }, "predecessors": ["cloud-env-dev", "onprem-os", "gpu-quota"],
      "when": "aiWorkload",
      "description": "Register the application with the model gateway, keys, rate limits and logging." },

    { "id": "dr-env-cloud", "name": "DR environment provisioning (cloud region)", "phase": "provision", "owner": "cloud",
      "category": "enabling", "duration": { "current": 4, "optimal": 2 }, "predecessors": ["cloud-iac", "dr-design"],
      "when": { "all": ["drRequired", "cloud"] },
      "description": "Deploy the secondary-region footprint from the same infrastructure code." },

    { "id": "dr-env-onprem", "name": "DR environment provisioning (secondary DC)", "phase": "provision", "owner": "infra",
      "category": "enabling", "waste": "manual", "duration": { "current": 20, "optimal": 10 }, "predecessors": ["onprem-os", "dr-design"],
      "when": { "all": ["drRequired", "onPrem"] },
      "description": "Repeat the compute, storage and network build in the secondary data center." },

    /* ---------------- Build & Test ---------------- */
    { "id": "dev-build", "name": "Application build & integration", "phase": "build", "owner": "dev",
      "category": "value", "duration": { "current": 30, "optimal": 25 }, "predecessors": ["dba-provision", "responsible-ai-gate", "ai-platform-onboard"],
      "when": "writesCode",
      "description": "Feature development, integration and unit testing." },

    { "id": "int-core-services", "name": "Core services integration", "phase": "build", "owner": "coreservices",
      "category": "enabling", "waste": "scheduling", "duration": { "current": 15, "optimal": 5 }, "predecessors": ["dev-build"],
      "when": { "integrations": { "includes": "core-services" } },
      "description": "Interface changes queue for the core services release window." },

    { "id": "int-api-gateway", "name": "API gateway onboarding & publication", "phase": "build", "owner": "cloud",
      "category": "enabling", "duration": { "current": 6, "optimal": 2 }, "predecessors": ["dev-build"],
      "when": { "integrations": { "includes": "api-gateway" } },
      "description": "Product and subscription setup, policy attachment, and publication to the API gateway." },

    { "id": "int-data-warehouse", "name": "Data warehouse feed onboarding", "phase": "build", "owner": "data",
      "category": "enabling", "duration": { "current": 8, "optimal": 4 }, "predecessors": ["dev-build"],
      "when": { "integrations": { "includes": "data-warehouse" } },
      "description": "Schema registration, pipeline setup and data quality checks for the new feed." },

    { "id": "int-sso", "name": "SSO integration", "phase": "build", "owner": "security",
      "category": "enabling", "waste": "manual", "duration": { "current": 5, "optimal": 1 }, "predecessors": ["dev-build"],
      "when": { "identity": { "includes": "sso-federation" } },
      "description": "App registration, claims mapping and group assignment via the IAM ticket process." },

    { "id": "int-internet", "name": "Internet exposure & WAF review", "phase": "build", "owner": "security",
      "category": "approval", "waste": "approval-gate", "duration": { "current": 9, "optimal": 3 }, "predecessors": ["dev-build"],
      "when": { "network": { "includes": "inbound-internet" } },
      "description": "External exposure review, WAF policy and public DNS. Anything reachable from the internet gets this." },

    { "id": "int-private-network", "name": "Private endpoint & internal DNS configuration", "phase": "build", "owner": "network",
      "category": "enabling", "duration": { "current": 5, "optimal": 2 }, "predecessors": ["dev-build"],
      "when": { "network": { "includes": "private-connectivity" } },
      "description": "Private endpoints, internal-only DNS records and route confirmation." },

    { "id": "int-web-proxy", "name": "Web proxy allowlisting", "phase": "build", "owner": "network",
      "category": "enabling", "waste": "queue", "duration": { "current": 7, "optimal": 1 }, "predecessors": ["dev-build"],
      "when": { "proxyAllowlisting": true },
      "description": "Outbound destinations raised as proxy requests and worked through the network queue." },

    { "id": "int-mft", "name": "Managed file transfer onboarding", "phase": "build", "owner": "infra",
      "category": "enabling", "waste": "manual", "duration": { "current": 10, "optimal": 3 }, "predecessors": ["dev-build"],
      "when": { "integrations": { "includes": "mft" } },
      "description": "Partner profile, key exchange, transfer schedule and a test file round trip." },

    { "id": "code-review", "name": "Peer code review", "phase": "build", "owner": "dev",
      "category": "value", "duration": { "current": 3, "optimal": 2 }, "predecessors": ["dev-build", "int-core-services", "int-api-gateway", "int-data-warehouse", "int-sso", "int-internet", "int-private-network", "int-web-proxy", "int-mft"],
      "when": "writesCode",
      "description": "Pull request review and merge." },

    { "id": "sast", "name": "SAST / DAST security scanning", "phase": "build", "owner": "security",
      "category": "enabling", "waste": "testing", "duration": { "current": 5, "optimal": 1 }, "predecessors": ["code-review"],
      "when": "writesCode",
      "description": "Scans are run by the security team on request and results are sent back by email.",
      "notes": "Optimal assumes scanning runs in the pipeline." },

    { "id": "sec-findings-rework", "name": "Security finding remediation", "phase": "build", "owner": "dev",
      "category": "enabling", "waste": "rework", "duration": { "current": 6, "optimal": 2 }, "predecessors": ["sast"],
      "when": "writesCode",
      "description": "Fix findings and re-scan. Late discovery makes fixes expensive." },

    { "id": "qa-env-wait", "name": "Wait for QA environment slot", "phase": "build", "owner": "qa",
      "category": "enabling", "waste": "queue", "duration": { "current": 7, "optimal": 0 }, "predecessors": ["sec-findings-rework"],
      "description": "Shared QA environments are booked; the team waits for the next free slot.",
      "notes": "Optimal is zero with on-demand ephemeral test environments." },

    { "id": "qa-test", "name": "System & integration testing", "phase": "build", "owner": "qa",
      "category": "value", "duration": { "current": 12, "optimal": 8 }, "predecessors": ["qa-env-wait"],
      "description": "Functional, integration and regression testing." },

    { "id": "perf-test", "name": "Performance testing", "phase": "build", "owner": "qa",
      "category": "enabling", "waste": "testing", "duration": { "current": 6, "optimal": 3 }, "predecessors": ["qa-test"],
      "description": "Load and soak tests; results reviewed with architecture." },

    { "id": "pen-test", "name": "Penetration test (external firm)", "phase": "build", "owner": "security",
      "category": "enabling", "waste": "external", "duration": { "current": 15, "optimal": 7 }, "predecessors": ["qa-test"],
      "when": "deepSecurity",
      "description": "Third-party test scheduled through the security team; report returned two weeks later." },

    { "id": "uat", "name": "User acceptance testing", "phase": "build", "owner": "sponsor",
      "category": "value", "duration": { "current": 10, "optimal": 5 }, "predecessors": ["qa-test"],
      "when": "notCapacity",
      "description": "Business users validate the solution against the acceptance criteria." },

    { "id": "defect-rework", "name": "Defect rework cycle", "phase": "build", "owner": "dev",
      "category": "enabling", "waste": "rework", "duration": { "current": 8, "optimal": 3 }, "predecessors": ["uat"],
      "when": "writesCode",
      "description": "Fix UAT defects, regression test and re-deliver." },

    { "id": "dr-test", "name": "DR failover test", "phase": "build", "owner": "resilience",
      "category": "enabling", "waste": "testing", "duration": { "current": 5, "optimal": 3 }, "predecessors": ["dr-env-cloud", "dr-env-onprem", "qa-test"],
      "when": "drRequired",
      "description": "Planned failover and failback with evidence for the resilience standard." },

    /* ---------------- Release & Handover ---------------- */
    { "id": "ops-readiness", "name": "Operational readiness review", "phase": "release", "owner": "ops",
      "category": "approval", "waste": "approval-gate", "duration": { "current": 8, "optimal": 3 }, "predecessors": ["uat"],
      "description": "Monitoring, runbooks, support model and on-call are confirmed." },

    { "id": "sec-attest", "name": "Security attestation / go-live sign-off", "phase": "release", "owner": "security",
      "category": "approval", "waste": "approval-gate", "duration": { "current": 5, "optimal": 1 }, "predecessors": ["pen-test", "sec-findings-rework", "ops-readiness"],
            "description": "Security confirms findings are closed or risk-accepted." },

    { "id": "privacy-signoff", "name": "Privacy sign-off", "phase": "release", "owner": "legal",
      "category": "approval", "waste": "approval-gate", "duration": { "current": 3, "optimal": 1 }, "predecessors": ["privacy-review", "uat"],
      "when": "privacyReview",
      "description": "Legal confirms the PIA actions are complete." },

    { "id": "cab", "name": "Change Advisory Board approval", "phase": "release", "owner": "cab",
      "category": "approval", "waste": "approval-gate", "duration": { "current": 7, "optimal": 1 }, "predecessors": ["ops-readiness", "sec-attest", "privacy-signoff", "dr-test", "defect-rework", "perf-test"],
      "description": "Change record is reviewed at the weekly CAB.",
      "notes": "Standard changes with automated evidence could be pre-approved." },

    { "id": "release-window", "name": "Wait for release window", "phase": "release", "owner": "ops",
      "category": "enabling", "waste": "scheduling", "duration": { "current": 5, "optimal": 1 }, "predecessors": ["cab"],
      "description": "Production deployments only happen in the Saturday window." },

    { "id": "deploy-prod", "name": "Production deployment", "phase": "release", "owner": "ops",
      "category": "value", "duration": { "current": 1, "optimal": 0.5 }, "predecessors": ["release-window"],
      "description": "Release executed and smoke-tested." },

    { "id": "go-live", "name": "Go-live", "phase": "release", "owner": "sponsor",
      "category": "approval", "milestone": true, "duration": { "current": 0, "optimal": 0 }, "predecessors": ["deploy-prod"],
      "description": "Service declared live to the business." },

    { "id": "hypercare", "name": "Hypercare & handover to run team", "phase": "release", "owner": "ops",
      "category": "value", "duration": { "current": 10, "optimal": 5 }, "predecessors": ["go-live"],
      "handoffs": ["go-live"],
      "description": "Project team supports production before the run team takes full ownership.",
      "notes": "Explicit handoff: ownership moves from the project team to the run team even though both are 'Operations'." }
  ]
});
