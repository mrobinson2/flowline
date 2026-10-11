# Built-in reference

Every id that ships with Flowline 1.6.4, with the name people see and what it means: the 37 sidebar questions, 15 derived values, 17 named rules, 7 presets, 112 activities, 6 phases, 20 teams, and the taxonomy.

**Generated from the data files** by `node tools/reference.js` - do not edit by hand; a regression fails when this file and the data disagree. Conditions are written in the expression language used by admin mode and the workbook's Include Expression column (see [ADMIN-MODE.md](ADMIN-MODE.md)); a named rule is referenced as `R_<id>`.

Contents: [Questions](#questions) · [Derived values](#derived-values) · [Named rules](#named-rules) · [Presets](#presets) · [Activities](#activities) · [Phases and stages](#phases-and-stages) · [Teams](#teams) · [Categories and waste types](#categories-and-waste-types)

## Questions

What the sidebar asks, in sidebar order. The **id** is what conditions, rules and the workbook's Toggles sheet use.

### Set by the preset (hidden)

| Id | Question | Type | Default | Shown / enabled when | Help |
|---|---|---|---|---|---|
| `workType` | Work type | one of | Build on Paved Road | hidden |  |

**`workType` options:** `saas` Adopt SaaS · `cots` Deploy COTS · `paved` Build on Paved Road · `custom` Build Custom / Non-Standard · `rehost` Rehost Existing App · `modernize` Modernize / Upgrade Existing App · `capacity` Expand Capacity

### Section 1

| Id | Question | Type | Default | Shown / enabled when | Help |
|---|---|---|---|---|---|
| `lifecycleStage` | Lifecycle stage *(Lifecycle)* | one of | New production service |  |  |
| `productionIncluded` | Production deployment included *(Lifecycle)* | yes / no | Yes |  | A PoC or pilot usually leaves this off - and with it goes DR design, the DR environment and the failover test. |

**`lifecycleStage` options:** `poc` Proof of concept · `pilot` Pilot · `new-prod` New production service · `change` Change to existing service · `capacity-exp` Capacity expansion · `migration` Migration / modernization · `retirement` Retirement

### Section 2

| Id | Question | Type | Default | Shown / enabled when | Help |
|---|---|---|---|---|---|
| `hosting` | Hosting target *(Platform)* | one of | Azure |  | Bare “Cloud” is deliberately not an option: it would fire Azure-specific landing-zone work for an AWS workload. |
| `runtimeModel` | Runtime / service model *(Platform)* | any of | PaaS / managed service |  | Each runtime brings its own platform onboarding step; PaaS brings private-endpoint networking (without PaaS the network build is lighter). |
| `aiWorkload` | AI / ML workload *(AI)* | yes / no | No |  |  |
| `genAiWorkload` | Generative AI workload *(AI)* | yes / no | No | implies `aiWorkload` | Generative AI is an AI/ML workload plus its own path: red-team and content-safety evaluation, and approvals for policy exceptions and run-rate. |
| `genAiMonthlyCostOver1k` | GenAI run-rate over $1k/month *(AI)* | yes / no | No | shown when `genAiWorkload` |  |
| `azureOpenAiPolicyException` | Model policy exception required *(AI)* | yes / no | No | shown when `genAiWorkload` |  |

**`hosting` options:** `azure` Azure · `aws` AWS · `gcp` GCP · `on-prem` On-Premises · `saas-vendor` SaaS / vendor-hosted · `hybrid` Hybrid / multi-environment · `existing-platform` Existing enterprise platform

**`runtimeModel` options:** `iaas` IaaS / virtual machines · `containers` Containers / Kubernetes · `paas` PaaS / managed service · `serverless` Serverless · `data-platform` Database / data platform · `physical` Physical infrastructure · `vendor-hosted` Vendor-hosted SaaS · `shared-platform` Existing shared platform

### Section 3

| Id | Question | Type | Default | Shown / enabled when | Help |
|---|---|---|---|---|---|
| `approvedPatternExists` | An approved pattern exists *(Pattern)* | yes / no | Yes |  |  |
| `patternConforms` | The design conforms to the pattern *(Pattern)* | yes / no | Yes | enabled when `approvedPatternExists` |  |
| `newTechnology` | New technology for the organization *(Pattern)* | yes / no | No |  |  |
| `newEnterprisePlatform` | New enterprise platform / shared service *(Pattern)* | yes / no | No |  |  |
| `architectureDeviation` | Deviation from architecture standards *(Pattern)* | yes / no | No |  |  |
| `requirementsUnderstood` | Requirements sufficiently understood *(Selection facts)* | yes / no | Yes |  |  |
| `vendorLandscapeKnown` | Vendor landscape known *(Selection facts)* | yes / no | Yes |  |  |
| `candidateProductCount` | Plausible candidate products *(Selection facts)* | one of | One clear candidate |  |  |
| `competitiveSourcing` | Competitive sourcing required *(Selection facts)* | yes / no | No |  |  |
| `unprovenTechnicalClaim` | An unproven technical claim must be tested *(Selection facts)* | yes / no | No |  |  |

**`candidateProductCount` options:** `1` One clear candidate · `2-3` Two or three · `4-6` Four to six · `unknown` Unknown

### Section 4

| Id | Question | Type | Default | Shown / enabled when | Help |
|---|---|---|---|---|---|
| `dataScope` | Data involved *(Data)* | any of | Customer / personal data |  | The shipped sample assumes customer personal data, which is what keeps the privacy work in the default map. Describe your own workload's data and the reviews follow. |
| `serviceTier` | Service tier *(Criticality)* | one of | Tier 3 |  | Tier 0 is the most critical. 'Not yet determined' leaves the tier-driven controls at their defaults - decide it before go-live. |

**`dataScope` options:** `no-business-data` No business data · `internal-business` Internal business data · `customer-personal` Customer / personal data · `employee` Employee data · `confidential-restricted` Confidential / restricted · `payment-cardholder` Payment / cardholder data · `sox` Financial reporting (SOX) · `glba` Regulated (GLBA or similar) · `residency` Data residency constraints · `retention` Records-management retention · `ai-training` AI training / grounding data

**`serviceTier` options:** `Tier 0` · `Tier 1` · `Tier 2` · `Tier 3` · `Tier 4` · `tbd` Not yet determined

### Section 5

| Id | Question | Type | Default | Shown / enabled when | Help |
|---|---|---|---|---|---|
| `thirdPartyInvolved` | A third party is involved *(Sourcing)* | yes / no | No |  |  |
| `newVendor` | New vendor to the organization *(Sourcing)* | yes / no | No |  |  |
| `existingApprovedVendor` | Existing approved vendor *(Sourcing)* | yes / no | No |  |  |
| `hardwareProcurement` | Hardware purchase *(Sourcing)* | yes / no | Yes | enabled when `hosting = on-prem` |  |
| `softwareLicense` | New or expanded software license *(Sourcing)* | yes / no | No |  |  |
| `professionalServices` | Professional services / SOW *(Sourcing)* | yes / no | No |  |  |
| `vendorNeedsOrgAccess` | Vendor people need internal access *(Sourcing)* | yes / no | No |  |  |
| `vendorHostsOrAccessesData` | Vendor hosts or accesses our data *(Sourcing)* | yes / no | No |  |  |
| `managedService` | Managed service *(Sourcing)* | yes / no | No |  |  |
| `contractChangeRequired` | Contract / MSA change required *(Sourcing)* | yes / no | No |  |  |
| `soleSource` | Sole-source route *(Sourcing)* | yes / no | No |  |  |
| `identity` | Identity & Access *(Identity & Access)* | any of | (none) |  | The sample binds SSO / federation; the rest describe the workload for exports and future rules. |
| `integrations` | Integrations *(Integrations)* | any of | (none) |  |  |
| `network` | Network & Exposure *(Network & Exposure)* | any of | (none) |  | Inbound exposure and outbound dependency are split on purpose: one earns the WAF and exposure review, the other earns proxy allowlisting. |

**`identity` options:** `workforce` Workforce user access · `customer-identity` Customer identity · `partner-external` Partner / external users · `sso-federation` SSO / federation · `role-group-based` Role / group-based access · `privileged` Privileged access · `service-account` Service account / machine identity · `m2m-api` M2M / API authentication · `secrets-vaulting` Secrets / key management · `access-certification` Access certification · `vendor-personnel` Vendor personnel access

**`integrations` options:** `core-services` Core systems integration · `api-gateway` API gateway · `data-warehouse` Data warehouse · `mft` Managed file transfer

**`network` options:** `inbound-internet` Public internet inbound · `outbound-internet` Public internet outbound · `private-connectivity` Private connectivity (internal only) · `hybrid-connectivity` Hybrid / on-premises connectivity · `load-balancer` Load balancer required · `firewall-change` Firewall rules required · `dns-ipam` DNS / IPAM required · `certificate-pki` Certificate / PKI required

### Section 6

| Id | Question | Type | Default | Shown / enabled when | Help |
|---|---|---|---|---|---|
| `deliveryOwnership` | Delivery ownership *(Delivery model)* | one of | Internal team delivered |  | Vendor or joint delivery pulls vendor onboarding in. |
| `supportModel` | Production support model *(Delivery model)* | one of | Stream-aligned team owns operations |  | Anything other than the stream-aligned team owning its own operations adds an operations handover - longest when it crosses to a separate central operations group. |

**`deliveryOwnership` options:** `internal` Internal team delivered · `vendor` Vendor delivered · `joint` Joint internal / vendor · `managed-service` Managed service · `self-service` Platform self-service

**`supportModel` options:** `stream-aligned` Stream-aligned team owns operations · `platform-sre` Platform / SRE-supported · `central-ops` Central operations · `vendor` Vendor-supported · `shared` Shared support model

## Derived values

Values the engine works out from the answers instead of asking. Each can be overridden in the sidebar (some require a reason). A choice derives from ordered cases, first match wins.

| Id | Name | Type | Derived as | Default |
|---|---|---|---|---|
| `regulatedData` | Privacy-relevant data | yes / no | `dataScope INTERSECTS [customer-personal, employee, confidential-restricted, payment-cardholder, sox, glba]` | Yes |
| `drRequired` | DR required | yes / no | `productionIncluded AND lifecycleStage NOT IN [poc, pilot] AND serviceTier IN ["Tier 0", "Tier 1", "Tier 2", "Tier 3"]` | Yes |
| `formalDrTestRequired` | Formal DR test before go-live | yes / no | `productionIncluded AND lifecycleStage NOT IN [poc, pilot] AND serviceTier IN ["Tier 0", "Tier 1", "Tier 2"]` | No |
| `highAvailability` | High availability required | yes / no | `serviceTier IN ["Tier 0", "Tier 1"]` | No |
| `support24x7` | 24x7 operational support | yes / no | `serviceTier IN ["Tier 0", "Tier 1"]` | No |
| `performanceValidationRequired` | Performance validation required | yes / no | `serviceTier IN ["Tier 0", "Tier 1", "Tier 2", "Tier 3"]` | Yes |
| `wafRequired` | WAF / exposure review required | yes / no | `network INCLUDES inbound-internet` | No |
| `proxyAllowlisting` | Proxy / egress allowlisting | yes / no | `network INCLUDES outbound-internet` | No |
| `privateEndpoint` | Private endpoint design | yes / no | `runtimeModel INCLUDES paas` | Yes |
| `architectureLane` | Architecture route | one of (fast = Fast Lane, standard = Standard Lane, custom = Custom Lane) | `custom WHEN workType = custom OR architectureDeviation OR newEnterprisePlatform OR newTechnology AND serviceTier IN ["Tier 0", "Tier 1"]; fast WHEN approvedPatternExists AND patternConforms AND serviceTier IN ["Tier 3", "Tier 4"]; ELSE standard` | Fast Lane |
| `selectionRoute` | Selection route | one of (none = No product selection, eval = Product evaluation only, eval-poc = Evaluation + PoC, rfp = RFP, rfp-poc = RFP + PoC, rfi-rfp = RFI then RFP, rfi-rfp-poc = RFI, RFP and PoC) | `none WHEN workType NOT IN [saas, cots]; rfi-rfp-poc WHEN (requirementsUnderstood = false OR vendorLandscapeKnown = false OR candidateProductCount IN [4-6, unknown]) AND unprovenTechnicalClaim; rfi-rfp WHEN requirementsUnderstood = false OR vendorLandscapeKnown = false OR candidateProductCount IN [4-6, unknown]; rfp-poc WHEN (competitiveSourcing OR candidateProductCount = 2-3) AND unprovenTechnicalClaim; rfp WHEN competitiveSourcing OR candidateProductCount = 2-3; eval-poc WHEN unprovenTechnicalClaim; ELSE eval` | No product selection |
| `productEvaluationRequired` | Product evaluation required | yes / no | `selectionRoute IN [eval, eval-poc]` | No |
| `rfiRequired` | RFI required | yes / no | `selectionRoute IN [rfi-rfp, rfi-rfp-poc]` | No |
| `rfpRequired` | RFP required | yes / no | `selectionRoute IN [rfp, rfp-poc, rfi-rfp, rfi-rfp-poc]` | No |
| `pocRequired` | Selection PoC required | yes / no | `selectionRoute IN [eval-poc, rfp-poc, rfi-rfp-poc]` | No |

## Named rules

Logic written once and referenced by name. In expressions a rule is `R_<id>`.

| Rule | Expression | Used by activities |
|---|---|---|
| `R_cloud` | `hosting IN [azure, aws, gcp, hybrid]` | cloud-network, cloud-iac, cloud-cost-approval, cloud-env-dev, dr-env-cloud |
| `R_azure` | `hosting = azure` | cloud-subscription, cloud-landing-zone, gpu-quota, cloud-iam |
| `R_onPrem` | `hosting = on-prem` | onprem-vm, onprem-storage, onprem-network, onprem-os, dr-env-onprem |
| `R_aiWorkload` | `aiWorkload` | ai-use-case-review, ai-data-access, model-eval, responsible-ai-gate, gpu-quota, ai-platform-onboard |
| `R_newVendor` | `newVendor` | vendor-contract |
| `R_newHardware` | `hosting = on-prem AND hardwareProcurement` | hw-spec, hw-po, hw-lead, hw-rack |
| `R_privacyReview` | `regulatedData` | privacy-review, privacy-signoff |
| `R_drRequired` | `drRequired` | dr-design, dr-env-cloud, dr-env-onprem, dr-test |
| `R_thirdPartyRisk` | `thirdPartyInvolved AND (newVendor OR vendorHostsOrAccessesData OR vendorNeedsOrgAccess)` | vendor-risk |
| `R_deepSecurity` | `R_aiWorkload OR R_privacyReview OR network INCLUDES inbound-internet` | threat-model, pen-test |
| `R_architectureReview` | `architectureLane IN [standard, custom]` | arb, arb-rework, sec-design-recheck |
| `R_netNew` | `workType IN [paved, custom]` |  |
| `R_acquired` | `workType IN [saas, cots]` |  |
| `R_existingApp` | `workType IN [rehost, modernize, capacity]` |  |
| `R_writesCode` | `workType NOT IN [saas, capacity, rehost]` | dev-build, code-review, sast, sec-findings-rework, defect-rework |
| `R_notCapacity` | `workType != capacity` | arch-design, data-class, cloud-env-dev, uat |
| `R_newFootprint` | `workType NOT IN [capacity, modernize]` | cloud-subscription, cloud-landing-zone, cloud-iam |

## Presets

The scenario dropdown. A preset sets only the answers it names; everything else keeps your choice.

| Id | Name | Sets | Description |
|---|---|---|---|
| `adopt-saas` | Adopt SaaS | `workType` = Adopt SaaS; `newVendor` = Yes; `hardwareProcurement` = No; `thirdPartyInvolved` = Yes; `vendorHostsOrAccessesData` = Yes; `approvedPatternExists` = No; `patternConforms` = No | Vendor-hosted service. No build, no environments of ours to stand up. |
| `deploy-cots` | Deploy COTS | `workType` = Deploy COTS; `newVendor` = Yes; `thirdPartyInvolved` = Yes; `softwareLicense` = Yes; `approvedPatternExists` = No; `patternConforms` = No | Buy the product, deploy and run it ourselves. |
| `build-paved` | Build on Paved Road | `workType` = Build on Paved Road; `newVendor` = No; `hardwareProcurement` = No; `thirdPartyInvolved` = No; `approvedPatternExists` = Yes; `patternConforms` = Yes; `architectureDeviation` = No | New build on a pre-approved pattern from the catalog. |
| `build-custom` | Build Custom / Non-Standard | `workType` = Build Custom / Non-Standard; `newVendor` = No; `approvedPatternExists` = No; `patternConforms` = No; `architectureDeviation` = Yes | New build off the paved road, so the design gets reviewed in full. |
| `rehost` | Rehost Existing App | `workType` = Rehost Existing App; `newVendor` = No; `hardwareProcurement` = No; `approvedPatternExists` = Yes; `patternConforms` = Yes | Lift and shift with no redesign. |
| `modernize` | Modernize / Upgrade Existing App | `workType` = Modernize / Upgrade Existing App; `newVendor` = No; `approvedPatternExists` = Yes; `patternConforms` = No | Version uplift or re-platform of something already running. |
| `expand-capacity` | Expand Capacity | `workType` = Expand Capacity; `newVendor` = No; `approvedPatternExists` = Yes; `patternConforms` = Yes | More of what is already there. No new app, no new design. |

## Activities

Every step in the register, by phase, in chart order. **Current / optimal** are business days. **Included when** is the condition that puts the step in a scenario (always = unconditional). **Can override**: `yes` may be forced in or out from the why drawer; `governed` may be added but never removed.

### Intake & Funding `intake`

| Id | Name | Owner | Kind | Current / optimal | Predecessors | Included when | Description |
|---|---|---|---|---|---|---|---|
| `intake` | Submit intake request | PMO / Project Management | Value-adding | 2 / 1 |  | always | Sponsor and PM complete the intake form describing the business need. |
| `intake-triage` | Intake triage & prioritization | PMO / Project Management | Necessary enabling · Queue / waiting | 10 / 2 | `intake` | always | Request waits for the bi-weekly demand review before anyone looks at it. |
| `biz-case` | Business case & funding approval | Finance | Approval gate · Approval / governance gate | 15 / 5 | `intake-triage` | always | Finance reviews the cost estimate and the sponsor obtains funding sign-off. |
| `sizing` | High-level solution sizing | Enterprise Architecture | Value-adding | 5 / 3 | `biz-case` | always | Architecture produces a T-shirt size, hosting recommendation and rough cost. |
| `kickoff` | Project kickoff & team assignment | PMO / Project Management | Necessary enabling · Scheduling delay | 8 / 2 | `sizing` | always | Waiting for named resources to free up and for a kickoff slot on everyone's calendar. |

### Vendor Onboarding `vendor`

| Id | Name | Owner | Kind | Current / optimal | Predecessors | Included when | Description |
|---|---|---|---|---|---|---|---|
| `prod-eval` | Product evaluation (demos & scoring) | Enterprise Architecture | Necessary enabling | 10 / 6 | `sizing` | `productEvaluationRequired` | Short-listed products are demonstrated and scored against the requirements - the light route when the need is understood and the field is small. |
| `vendor-rfi` | Request for information (RFI) | Procurement | Necessary enabling · External dependency | 15 / 7 | `sizing` | `rfiRequired` | Market sounding when requirements or the vendor landscape are not yet understood, or the field is wide. |
| `vendor-rfp` | Vendor RFP & evaluation | Procurement | Necessary enabling · External dependency | 30 / 15 | `vendor-rfi` | `rfpRequired` | Issue RFP, score responses, shortlist, run demos. |
| `vendor-poc` | Proof of concept | Enterprise Architecture | Value-adding | 15 / 10 | `prod-eval`, `vendor-rfp` | `pocRequired` | An unproven technical claim is tested hands-on before commitment. |
| `sole-source` | Sole-source justification approval | Procurement | Approval gate · Approval / governance gate | 5 / 2 | `sizing` | `soleSource` | Procurement approves skipping competition and records why. |
| `vendor-risk` | Third-party risk assessment | Cyber Security | Approval gate · Approval / governance gate | 20 / 7 | `vendor-rfp`, `prod-eval`, `vendor-poc` | `R_thirdPartyRisk`; ×0.5 when `existingApprovedVendor` (Existing approved vendor: a reassessment, not a full TPRM) | Security questionnaire, SOC 2 review, and risk rating for the vendor. |
| `vendor-dpa` | Data processing agreement (DPA) | Legal & Privacy | Approval gate · Approval / governance gate | 8 / 3 | `vendor-risk` | `vendorHostsOrAccessesData` | The vendor will hold or see our data, so a DPA with security and breach terms is negotiated. |
| `vendor-contract` | Contract negotiation & legal review | Legal & Privacy | Necessary enabling · External dependency | 25 / 10 | `vendor-risk`, `sole-source`, `vendor-dpa` | `contractChangeRequired OR R_newVendor` | MSA, DPA and order form redlines go back and forth with the vendor's counsel. |
| `vendor-onboard` | Vendor onboarding (accounts, NDA, access) | Procurement | Necessary enabling · Manual processing | 10 / 3 | `vendor-contract` | `vendorNeedsOrgAccess OR professionalServices OR deliveryOwnership IN [vendor, joint, managed-service] OR identity INCLUDES vendor-personnel`; ×0.5 when `existingApprovedVendor` (Existing approved vendor: accounts and NDA already in place) | Supplier record, NDA, badge and system access are set up by hand across four systems. |
| `license-procure` | License procurement & entitlement | Procurement | Necessary enabling · External dependency | 10 / 4 | `vendor-contract` | `softwareLicense` | Order, entitlement and license keys for new or expanded software. |

### Architecture & Design `design`

| Id | Name | Owner | Kind | Current / optimal | Predecessors | Included when | Description |
|---|---|---|---|---|---|---|---|
| `arch-design` | Solution architecture design | Enterprise Architecture | Value-adding | 10 / 8 | `kickoff`, `vendor-onboard` | `R_notCapacity` | Target architecture, integration design, hosting pattern selection. |
| `arb` | Architecture Review Board | Enterprise Architecture | Approval gate · Approval / governance gate | 12 / 3 | `arch-design` | `R_architectureReview` | The design waits for the next ARB slot, is presented, and receives a decision. |
| `arb-rework` | ARB rework & resubmission | Enterprise Architecture | Necessary enabling · Rework | 5 / 0 | `arb` | `R_architectureReview` | Roughly half of first submissions are sent back for changes and re-presented. |
| `sec-design-recheck` | Security re-review after ARB changes | Cyber Security | Approval gate · Duplicate review | 5 / 0 | `arb-rework` | `R_architectureReview` | Security reviews the design a second time because the ARB changes were not shared with them. |
| `arch-waiver` | Architecture waiver & exception approval | Enterprise Architecture | Approval gate · Approval / governance gate | 10 / 3 | `arb` | `architectureLane = custom` | Custom work departs from the standards on purpose; the departure is written up and approved as an exception. |
| `newtech-assess` | New-technology supportability assessment | IT Operations | Necessary enabling | 6 / 3 | `arch-design` | `newTechnology` | Operations confirms it can support technology the organization has not run before: skills, tooling, vendor support. |
| `data-class` | Data classification | Data Governance | Necessary enabling | 3 / 1 | `arch-design` | `R_notCapacity`; ×0.3 when `dataScope INCLUDES no-business-data AND regulatedData = false` (No business data: classification is a formality); ×0.6 when `dataScope INCLUDES internal-business AND regulatedData = false AND NOT dataScope INCLUDES no-business-data` (Internal business data only: a standard classification) | Data owner classifies the data sets the solution will hold. |
| `privacy-review` | Privacy impact assessment | Legal & Privacy | Approval gate · Approval / governance gate | 15 / 5 | `data-class` | `R_privacyReview` | Legal & Privacy assess personal data handling and required controls. |
| `ds-pci` | PCI DSS scoping & assessment | Cyber Security | Approval gate · Approval / governance gate · override: governed | 10 / 4 | `data-class` | `dataScope INCLUDES payment-cardholder` | Cardholder data brings the service into PCI scope. |
| `ds-compliance` | Regulatory compliance review (SOX / GLBA) | Legal & Privacy | Approval gate · Approval / governance gate · override: governed | 8 / 3 | `data-class` | `dataScope INTERSECTS [sox, glba]` | Financial-reporting or regulated financial data needs controls mapped before build. |
| `ds-residency` | Data residency & sovereignty review | Legal & Privacy | Approval gate · Approval / governance gate | 5 / 2 | `data-class` | `dataScope INCLUDES residency` | Where the data may live and be processed is confirmed against the constraints. |
| `ds-retention` | Records retention schedule | Data Governance | Necessary enabling · Manual processing | 3 / 1 | `data-class` | `dataScope INCLUDES retention` | Retention and disposal rules are agreed with records management. |
| `ds-ai-training` | AI training-data rights & consent review | Legal & Privacy | Approval gate · Approval / governance gate | 6 / 2 | `data-class` | `dataScope INCLUDES ai-training` | Data used to train or ground a model is checked for rights and consent. |
| `sec-design-review` | Security review | Cyber Security | Approval gate · Approval / governance gate | 12 / 4 | `arch-design` | always | Security architecture reviews the design against control requirements. |
| `threat-model` | Threat modeling & access review | Cyber Security | Value-adding | 4 / 3 | `sec-design-review` | `R_deepSecurity` | Joint workshop with the development team to identify threats and mitigations. |
| `sec-arch-deepdive` | Security architecture deep-dive | Cyber Security | Value-adding | 8 / 5 | `sec-design-review` | `architectureLane = custom` | Non-standard designs get a full security architecture review instead of the pattern checklist. |
| `ai-use-case-review` | AI use-case & model risk review | AI Platform & Governance | Approval gate · Approval / governance gate | 15 / 5 | `arch-design` | `R_aiWorkload` | AI governance reviews intended use, model risk tier and human oversight design. |
| `genai-policy-exception` | Model policy exception approval | AI Platform & Governance | Approval gate · Approval / governance gate | 10 / 3 | `ai-use-case-review` | `azureOpenAiPolicyException` | A model or usage outside the approved GenAI policy needs an explicit exception. |
| `ai-data-access` | Training / inference data access approval | Data Governance | Approval gate · Approval / governance gate | 10 / 3 | `ai-use-case-review`, `data-class` | `R_aiWorkload` | Data owners approve which data sets the model may use. |
| `model-eval` | Model selection & evaluation | AI Platform & Governance | Value-adding | 10 / 8 | `ai-data-access` | `R_aiWorkload` | Compare candidate models on the approved data; document evaluation results. |
| `genai-redteam` | GenAI red-team & content-safety evaluation | AI Platform & Governance | Necessary enabling · Testing / validation delay | 8 / 4 | `model-eval` | `genAiWorkload` | Prompt-injection, jailbreak and harmful-output testing; content filters tuned before sign-off. |
| `genai-finops` | GenAI run-rate FinOps approval | Finance | Approval gate · Approval / governance gate | 5 / 2 | `model-eval` | `genAiMonthlyCostOver1k` | Token and capacity spend above $1k a month is approved against a forecast. |
| `responsible-ai-gate` | Responsible AI sign-off | AI Platform & Governance | Approval gate · Approval / governance gate | 5 / 1 | `model-eval`, `genai-redteam`, `genai-policy-exception`, `genai-finops` | `R_aiWorkload` | Formal go / no-go on the model and its guardrails. |
| `dr-design` | DR strategy & runbook design | Resilience / BCP | Value-adding · override: yes | 6 / 4 | `arch-design` | `R_drRequired` | Define RTO/RPO, failover approach and recovery runbook. |
| `ha-design` | High-availability design & failover configuration | Cloud Platform | Value-adding | 5 / 3 | `arch-design` | `highAvailability` | Tier 0/1 services are designed for zone or region failover from the start. |

### Environment Provisioning `provision`

| Id | Name | Owner | Kind | Current / optimal | Predecessors | Included when | Description |
|---|---|---|---|---|---|---|---|
| `cloud-subscription` | Subscription / account request | Cloud Platform | Necessary enabling · Manual processing | 5 / 1 | `arb`, `arb-rework`, `arch-waiver` | `R_azure AND R_newFootprint` | Ticket-driven request for a new subscription; created by hand from a template. |
| `cloud-landing-zone` | Landing zone & policy assignment | Cloud Platform | Necessary enabling | 3 / 1 | `cloud-subscription` | `R_azure AND R_newFootprint` | Place the subscription in the management group hierarchy; apply guardrail policies and tags. |
| `gpu-quota` | GPU quota / capacity request | Cloud Platform | Necessary enabling · External dependency | 10 / 3 | `cloud-subscription` | `R_azure AND R_aiWorkload` | Quota increase request to the cloud provider for GPU SKUs in the target region. |
| `cloud-network` | Network connectivity (vNet, peering, DNS) | Network Engineering | Necessary enabling · Queue / waiting | 8 / 2 | `cloud-landing-zone` | `R_cloud`; ×0.6 when `privateEndpoint = false` (No PaaS private endpoints: no private DNS zones or endpoint approvals) | Network team allocates address space, peers to the hub and registers DNS. |
| `cloud-iam` | Identity & access (RBAC, service principals) | Cyber Security | Necessary enabling · Manual processing | 6 / 1 | `cloud-landing-zone` | `R_azure AND R_newFootprint` | Groups, role assignments and workload identities created through the IAM ticket process. |
| `cloud-iac` | Infrastructure as code build (Terraform) | Cloud Platform | Value-adding | 8 / 6 | `cloud-network`, `cloud-iam` | `R_cloud`; ×0.5 when `deliveryOwnership = self-service` (Platform self-service: templates do most of the build) | Compose landing-zone modules into the workload's infrastructure code. |
| `cloud-cost-approval` | Cloud cost / FinOps approval | Finance | Approval gate · Approval / governance gate | 6 / 2 | `cloud-iac` | `R_cloud` | Forecast run-rate is reviewed against the approved business case. |
| `cloud-env-dev` | Dev / test environment deployment | Cloud Platform | Value-adding | 2 / 1 | `cloud-iac`, `cloud-cost-approval` | `R_cloud AND R_notCapacity` | Pipeline deploys the environment from code. |
| `hw-spec` | Hardware specification & quote | Infrastructure Operations | Necessary enabling | 7 / 4 | `arb`, `arch-waiver` | `R_newHardware` | Size servers, storage and (for AI) GPU nodes; obtain vendor quotes. |
| `hw-po` | Purchase order approval | Procurement | Approval gate · Approval / governance gate | 12 / 3 | `hw-spec` | `R_newHardware` | Three-quote rule, budget check and signature chain for the purchase order. |
| `hw-lead` | Hardware lead time (vendor shipping) | External Vendor | Necessary enabling · Procurement delay | 45 / 30 | `hw-po` | `R_newHardware` | Manufacturing and shipping lead time from the hardware vendor. |
| `hw-rack` | Rack, cable & power | Infrastructure Operations | Necessary enabling | 5 / 3 | `hw-lead` | `R_newHardware` | Data center team receives, racks and cables the equipment. |
| `onprem-vm` | Compute build (virtual machines) | Infrastructure Operations | Necessary enabling · Manual processing | 10 / 2 | `arb`, `arb-rework`, `hw-rack`, `arch-waiver` | `R_onPrem` | VMs built from the request form by an engineer; naming, IPs and tags entered by hand. |
| `onprem-storage` | Storage allocation | Infrastructure Operations | Necessary enabling · Queue / waiting | 8 / 1 | `onprem-vm` | `R_onPrem` | LUN / share request waits in the storage queue. |
| `onprem-network` | Firewall & load balancer changes | Network Engineering | Necessary enabling · Queue / waiting | 12 / 3 | `onprem-vm` | `R_onPrem` | Firewall rule requests and VIP creation go through the weekly network change cycle. |
| `onprem-os` | OS hardening & agent install | IT Operations | Necessary enabling · Manual processing | 5 / 1 | `onprem-storage`, `onprem-network` | `R_onPrem` | Baseline hardening, monitoring and security agents installed by hand. |
| `dba-provision` | Database provisioning | Database Services | Necessary enabling · Manual processing | 7 / 2 | `cloud-env-dev`, `onprem-os` | always | DBA team creates instances, databases and access from a ticket. |
| `ai-platform-onboard` | AI platform onboarding (model gateway) | AI Platform & Governance | Necessary enabling · Manual processing | 5 / 2 | `cloud-env-dev`, `onprem-os`, `gpu-quota` | `R_aiWorkload` | Register the application with the model gateway, keys, rate limits and logging. |
| `rt-iaas` | VM image hardening & patch-baseline onboarding | IT Operations | Necessary enabling · Manual processing | 5 / 2 | `cloud-env-dev`, `onprem-os` | `runtimeModel INCLUDES iaas` | Virtual machines join the hardened image, patching and backup baselines. |
| `rt-containers` | Container platform onboarding (namespace, registry, policies) | Cloud Platform | Necessary enabling · Queue / waiting | 6 / 2 | `cloud-env-dev`, `onprem-os` | `runtimeModel INCLUDES containers` | Namespace, registry access and admission policies requested from the container platform team. |
| `rt-serverless` | Serverless security & event-trigger review | Cyber Security | Approval gate · Approval / governance gate | 4 / 1 | `cloud-env-dev`, `onprem-os` | `runtimeModel INCLUDES serverless` | Function identities, triggers and outbound calls are reviewed. |
| `rt-data-platform` | Data platform onboarding (workspace, catalog, lineage) | Data Governance | Necessary enabling · Queue / waiting | 8 / 3 | `cloud-env-dev`, `onprem-os` | `runtimeModel INCLUDES data-platform` | Workspace, catalog registration and lineage capture on the data platform. |
| `rt-physical` | Physical asset registration (CMDB, labels) | Infrastructure Operations | Necessary enabling · Manual processing | 3 / 1 | `cloud-env-dev`, `onprem-os` | `runtimeModel INCLUDES physical` | Physical assets are registered, labelled and added to monitoring. |
| `rt-vendor-hosted` | SaaS tenant configuration | External Vendor | Necessary enabling · External dependency | 5 / 2 | `cloud-env-dev`, `onprem-os` | `runtimeModel INCLUDES vendor-hosted` | The vendor's tenant is configured for our users, data and integrations. |
| `rt-shared-platform` | Shared platform onboarding request | Cloud Platform | Necessary enabling · Queue / waiting | 5 / 1 | `cloud-env-dev`, `onprem-os` | `runtimeModel INCLUDES shared-platform` | A request to the owning team to onboard onto an existing shared platform. |
| `dr-env-cloud` | DR environment provisioning (cloud region) | Cloud Platform | Necessary enabling · override: yes | 4 / 2 | `cloud-iac`, `dr-design` | `R_drRequired AND R_cloud` | Deploy the secondary-region footprint from the same infrastructure code. |
| `dr-env-onprem` | DR environment provisioning (secondary DC) | Infrastructure Operations | Necessary enabling · Manual processing · override: yes | 20 / 10 | `onprem-os`, `dr-design` | `R_drRequired AND R_onPrem` | Repeat the compute, storage and network build in the secondary data center. |

### Build & Test `build`

| Id | Name | Owner | Kind | Current / optimal | Predecessors | Included when | Description |
|---|---|---|---|---|---|---|---|
| `dev-build` | Application build & integration | Application Development | Value-adding | 30 / 25 | `dba-provision`, `responsible-ai-gate`, `ai-platform-onboard`, `rt-iaas`, `rt-containers`, `rt-serverless`, `rt-data-platform`, `rt-physical`, `rt-vendor-hosted`, `rt-shared-platform`, `sec-arch-deepdive`, `ha-design`, `license-procure` | `R_writesCode`; ×0.6 when `lifecycleStage = change` (Change to an existing service: a smaller build) | Feature development, integration and unit testing. |
| `int-core-services` | Core services integration | Core Services | Necessary enabling · Scheduling delay | 15 / 5 | `dev-build` | `integrations INCLUDES core-services` | Interface changes queue for the core services release window. |
| `int-api-gateway` | API gateway onboarding & publication | Cloud Platform | Necessary enabling | 6 / 2 | `dev-build` | `integrations INCLUDES api-gateway` | Product and subscription setup, policy attachment, and publication to the API gateway. |
| `int-data-warehouse` | Data warehouse feed onboarding | Data Governance | Necessary enabling | 8 / 4 | `dev-build` | `integrations INCLUDES data-warehouse` | Schema registration, pipeline setup and data quality checks for the new feed. |
| `int-sso` | SSO integration | Cyber Security | Necessary enabling · Manual processing | 5 / 1 | `dev-build` | `identity INCLUDES sso-federation` | App registration, claims mapping and group assignment via the IAM ticket process. |
| `int-internet` | Internet exposure & WAF review | Cyber Security | Approval gate · Approval / governance gate | 9 / 3 | `dev-build` | `wafRequired` | External exposure review, WAF policy and public DNS. Anything reachable from the internet gets this. |
| `int-private-network` | Private endpoint & internal DNS configuration | Network Engineering | Necessary enabling | 5 / 2 | `dev-build` | `network INCLUDES private-connectivity` | Private endpoints, internal-only DNS records and route confirmation. |
| `int-web-proxy` | Web proxy allowlisting | Network Engineering | Necessary enabling · Queue / waiting | 7 / 1 | `dev-build` | `proxyAllowlisting` | Outbound destinations raised as proxy requests and worked through the network queue. |
| `int-mft` | Managed file transfer onboarding | Infrastructure Operations | Necessary enabling · Manual processing | 10 / 3 | `dev-build` | `integrations INCLUDES mft` | Partner profile, key exchange, transfer schedule and a test file round trip. |
| `id-access` | Access group & role provisioning | Cyber Security | Necessary enabling · Manual processing | 3 / 1 | `dev-build` | `identity INTERSECTS [workforce, role-group-based]` | Groups and roles created and mapped to the application. |
| `id-ciam` | Customer identity (CIAM) integration | Cyber Security | Necessary enabling | 8 / 4 | `dev-build` | `identity INCLUDES customer-identity` | Customer sign-up, sign-in and consent on the customer identity platform. |
| `id-b2b` | External / B2B access approval | Cyber Security | Approval gate · Approval / governance gate | 5 / 2 | `dev-build` | `identity INCLUDES partner-external` | Guest and partner access is approved and time-bound. |
| `id-pam` | Privileged access (PAM) onboarding & approval | Cyber Security | Approval gate · Approval / governance gate | 5 / 2 | `dev-build` | `identity INCLUDES privileged` | Admin accounts vaulted, just-in-time elevation configured and approved. |
| `id-service` | Service identity & API authentication setup | Cyber Security | Necessary enabling · Manual processing | 3 / 1 | `dev-build` | `identity INTERSECTS [service-account, m2m-api]` | Service principals, managed identities and API auth flows. |
| `id-secrets` | Secrets & key vault setup | Cloud Platform | Necessary enabling | 2 / 1 | `dev-build` | `identity INCLUDES secrets-vaulting` | Vault, keys and rotation for application secrets. |
| `id-cert` | Access certification enrolment | Cyber Security | Necessary enabling · Manual processing | 2 / 1 | `dev-build` | `identity INCLUDES access-certification` | The application joins the periodic access review. |
| `net-hybrid` | Hybrid connectivity change (ExpressRoute / VPN) | Network Engineering | Necessary enabling · External dependency | 15 / 5 | `dev-build` | `network INCLUDES hybrid-connectivity` | Carrier and on-premises routing changes for hybrid connectivity. |
| `net-lb` | Load balancer configuration | Network Engineering | Necessary enabling · Queue / waiting | 4 / 1 | `dev-build` | `network INCLUDES load-balancer` | Virtual server, health probes and certificates on the load balancer. |
| `net-fw` | Firewall rule change request | Network Engineering | Necessary enabling · Queue / waiting | 6 / 1 | `dev-build` | `network INCLUDES firewall-change` | Rules raised, reviewed and implemented in the next firewall change window. |
| `net-dns` | DNS & IP address allocation | Network Engineering | Necessary enabling · Queue / waiting | 3 / 1 | `dev-build` | `network INCLUDES dns-ipam` | Names and addresses allocated in IPAM and published in DNS. |
| `net-cert` | TLS certificate issuance (PKI) | Cyber Security | Necessary enabling · Queue / waiting | 4 / 1 | `dev-build` | `network INCLUDES certificate-pki` | Certificates requested from the PKI team and installed. |
| `code-review` | Peer code review | Application Development | Value-adding | 3 / 2 | `dev-build`, `int-core-services`, `int-api-gateway`, `int-data-warehouse`, `int-sso`, `int-internet`, `int-private-network`, `int-web-proxy`, `int-mft`, `id-access`, `id-ciam`, `id-b2b`, `id-pam`, `id-service`, `id-secrets`, `id-cert`, `net-hybrid`, `net-lb`, `net-fw`, `net-dns`, `net-cert` | `R_writesCode` | Pull request review and merge. |
| `sast` | SAST / DAST security scanning | Cyber Security | Necessary enabling · Testing / validation delay | 5 / 1 | `code-review` | `R_writesCode` | Scans are run by the security team on request and results are sent back by email. |
| `sec-findings-rework` | Security finding remediation | Application Development | Necessary enabling · Rework | 6 / 2 | `sast` | `R_writesCode` | Fix findings and re-scan. Late discovery makes fixes expensive. |
| `qa-env-wait` | Wait for QA environment slot | QA / Testing | Necessary enabling · Queue / waiting | 7 / 0 | `sec-findings-rework` | always | Shared QA environments are booked; the team waits for the next free slot. |
| `qa-test` | System & integration testing | QA / Testing | Value-adding | 12 / 8 | `qa-env-wait` | always; ×0.6 when `lifecycleStage = change` (Change to an existing service: regression-focused testing) | Functional, integration and regression testing. |
| `perf-test` | Performance testing | QA / Testing | Necessary enabling · Testing / validation delay | 6 / 3 | `qa-test` | `performanceValidationRequired`; ×1.5 when `lifecycleStage = capacity-exp` (Capacity expansion: performance re-baselined at the new scale) | Load and soak tests; results reviewed with architecture. |
| `migration-cutover` | Data migration & cutover rehearsal | Database Services | Value-adding | 10 / 6 | `qa-test` | `lifecycleStage = migration` | Data moved and the cutover rehearsed end to end before the real one. |
| `pen-test` | Penetration test (external firm) | Cyber Security | Necessary enabling · External dependency | 15 / 7 | `qa-test` | `R_deepSecurity` | Third-party test scheduled through the security team; report returned two weeks later. |
| `uat` | User acceptance testing | Business Sponsor | Value-adding | 10 / 5 | `qa-test` | `R_notCapacity` | Business users validate the solution against the acceptance criteria. |
| `defect-rework` | Defect rework cycle | Application Development | Necessary enabling · Rework | 8 / 3 | `uat` | `R_writesCode` | Fix UAT defects, regression test and re-deliver. |
| `dr-test` | DR failover test | Resilience / BCP | Necessary enabling · Testing / validation delay · override: yes | 5 / 3 | `dr-env-cloud`, `dr-env-onprem`, `qa-test` | `R_drRequired`; ×2 when `formalDrTestRequired` (Formal, witnessed failover test before go-live) | Planned failover and failback with evidence for the resilience standard. |

### Release & Handover `release`

| Id | Name | Owner | Kind | Current / optimal | Predecessors | Included when | Description |
|---|---|---|---|---|---|---|---|
| `ops-handover` | Operations handover & support onboarding | IT Operations | Necessary enabling · Queue / waiting | 5 / 2 | `uat` | `supportModel NOT IN [stream-aligned]`; ×1.6 when `supportModel = central-ops` (Central operations: a cross-organization handover); ×1.4 when `supportModel = vendor` (Vendor support: contract and escalation path set up); ×1.2 when `supportModel = shared` (Shared support: a RACI to agree) | The team that will run the service is not the team that built it, so knowledge, runbooks and alerts are handed over. |
| `oncall-247` | 24x7 on-call & runbook onboarding | IT Operations | Necessary enabling | 5 / 2 | `uat` | `support24x7` | Round-the-clock rota, paging and runbooks for a Tier 0/1 service. |
| `managed-sla` | Managed service SLA & onboarding | External Vendor | Necessary enabling · External dependency | 8 / 3 | `vendor-contract` | `managedService OR deliveryOwnership = managed-service` | Service levels, reporting and the operating interface with the managed-service provider. |
| `ops-readiness` | Operational readiness review | IT Operations | Approval gate · Approval / governance gate | 8 / 3 | `uat`, `newtech-assess`, `ops-handover`, `oncall-247`, `managed-sla` | always | Monitoring, runbooks, support model and on-call are confirmed. |
| `sec-attest` | Security attestation / go-live sign-off | Cyber Security | Approval gate · Approval / governance gate · override: governed | 5 / 1 | `pen-test`, `sec-findings-rework`, `ops-readiness` | always | Security confirms findings are closed or risk-accepted. |
| `privacy-signoff` | Privacy sign-off | Legal & Privacy | Approval gate · Approval / governance gate | 3 / 1 | `privacy-review`, `uat` | `R_privacyReview` | Legal confirms the PIA actions are complete. |
| `cab` | Change Advisory Board approval | Change Advisory Board | Approval gate · Approval / governance gate · override: governed | 7 / 1 | `ops-readiness`, `sec-attest`, `privacy-signoff`, `dr-test`, `defect-rework`, `perf-test`, `migration-cutover`, `ds-pci`, `ds-compliance`, `ds-residency`, `ds-retention`, `ds-ai-training` | always | Change record is reviewed at the weekly CAB. |
| `release-window` | Wait for release window | IT Operations | Necessary enabling · Scheduling delay | 5 / 1 | `cab` | always | Production deployments only happen in the Saturday window. |
| `deploy-prod` | Production deployment | IT Operations | Value-adding | 1 / 0.5 | `release-window` | always | Release executed and smoke-tested. |
| `go-live` | Go-live | Business Sponsor | Approval gate · milestone | 0 / 0 | `deploy-prod` | always | Service declared live to the business. |
| `pilot-exit` | PoC / pilot exit review | Business Sponsor | Approval gate · Approval / governance gate | 5 / 2 | `go-live` | `lifecycleStage IN [poc, pilot]` | Success criteria are checked and the decision taken: proceed to production, iterate, or stop. |
| `hypercare` | Hypercare & handover to run team | IT Operations | Value-adding | 10 / 5 | `go-live` | `lifecycleStage NOT IN [poc, pilot]` | Project team supports production before the run team takes full ownership. |
| `decommission` | Decommission & records-retention sign-off | Legal & Privacy | Approval gate · Approval / governance gate | 8 / 3 | `go-live` | `lifecycleStage = retirement` | The retired service's data is archived or destroyed under the retention schedule and signed off. |

## Phases and stages

| Phase id | Phase | Short | Stage |
|---|---|---|---|
| `intake` | Intake & Funding | Intake | Define `define` |
| `vendor` | Vendor Onboarding | Vendor | Source `source` |
| `design` | Architecture & Design | Design | Deliver `deliver` |
| `provision` | Environment Provisioning | Provision | Deliver `deliver` |
| `build` | Build & Test | Build | Deliver `deliver` |
| `release` | Release & Handover | Release | Launch `launch` |

| Stage id | Stage | Short |
|---|---|---|
| `define` | Define | Define |
| `source` | Source | Source |
| `deliver` | Deliver | Deliver |
| `launch` | Launch | Launch |

## Teams

A change of owning team between a step and its predecessor is counted as a handoff; a change of organization (Team Topologies type) as a cross-org handoff.

| Team id | Team | Short name | Organization |
|---|---|---|---|
| `pmo` | PMO / Project Management | PMO | Business |
| `sponsor` | Business Sponsor | Sponsor | Business |
| `finance` | Finance | Finance | Finance |
| `procurement` | Procurement | Procurement | Finance |
| `legal` | Legal & Privacy | Legal | Legal |
| `ea` | Enterprise Architecture | Architecture | Technology |
| `cloud` | Cloud Platform | Cloud | Technology |
| `infra` | Infrastructure Operations | Infra Ops | Technology |
| `network` | Network Engineering | Network | Technology |
| `dba` | Database Services | Database | Technology |
| `dev` | Application Development | App Dev | Technology |
| `qa` | QA / Testing | QA | Technology |
| `ops` | IT Operations | IT Ops | Technology |
| `coreservices` | Core Services | Core Svcs | Technology |
| `security` | Cyber Security | Security | Security |
| `cab` | Change Advisory Board | CAB | Governance |
| `resilience` | Resilience / BCP | Resilience | Governance |
| `data` | Data Governance | Data Gov | Data & AI |
| `ai` | AI Platform & Governance | AI Platform | Data & AI |
| `vendor` | External Vendor | Vendor | External |

## Categories and waste types

| Category id | Category | Family |
|---|---|---|
| `value` | Value-adding | value |
| `enabling` | Necessary enabling | enabling |
| `approval` | Approval gate | approval |

| Waste id | Waste type | Description |
|---|---|---|
| `handoff` | Handoff | Work changes ownership; context is lost or re-explained. DERIVED: counted from the ownership changes the scheduler detects, not from a tag on an activity, so it always matches the rings drawn on the chart. |
| `approval-gate` | Approval / governance gate | A decision or control point. Optimal = minimum decision time; excess = queueing for the meeting, re-presenting, chasing signatures. |
| `queue` | Queue / waiting | Work sits idle waiting for capacity, a slot, or a response. |
| `rework` | Rework | Repeating work because of defects, missed requirements, or late feedback. |
| `manual` | Manual processing | Hand-performed steps that could be automated or self-service. |
| `procurement` | Procurement delay | Buying, PO, shipping and lead-time delays. |
| `external` | External dependency | Waiting on a party outside the delivery team's control (vendor, third party, another business unit). |
| `testing` | Testing / validation delay | Delay caused by test environments, test cycles, or validation backlogs. |
| `scheduling` | Scheduling delay | Waiting for a calendar slot: release window, board meeting, change freeze. |
| `duplicate` | Duplicate review | Reviewing something that has already been reviewed elsewhere. |
