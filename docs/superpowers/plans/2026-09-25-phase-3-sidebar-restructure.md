# Phase 3: Sidebar Restructure — Six Sections, Twelve Groups — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The spec §4.1–4.5 sidebar: six collapsible sections with completion indicators, `ShownWhen` progressive disclosure, Yes/No segmented booleans, and the §8 vocabulary — hosting split past bare "Cloud", AI/GenAI split, sourcing expanded, identity separated from integrations, inbound/outbound internet split — with the shipped default map still row-for-row identical at 198 days.

**Architecture:** Sections are data (`section: 1..6` on each attribute, Phase 1's field); the sidebar renders section containers with ●/◐/○ from answer state; `ShownWhen` hides controls whose values are retained in state but neutralized in `effectiveScenario` (spec §4.5). The vocabulary change follows Phase 2's playbook: named-rule ids stay stable where activities reference them, new rules are added for the splits, presets carry the new facts, and derived defaults reproduce the shipped defaults. Old saved browser state survives via a vocabulary filter at `loadState` (Review Focus #5 — today only the linked-folder path filters).

**Spec:** `flowline_full_extraction.md` §4.1–4.5, §8.1–8.7, §5.10; roadmap Phase 3 charter.

## Global Constraints

Roadmap constraints plus:

- Default map identical before/after (assert node ids + 198 days, again).
- Every retired option value or attribute id must be inert when it arrives from old saved state or an old file — filtered or ignored, never evaluated into silent exclusions.
- Booleans render as Yes/No segmented controls everywhere (spec §4.3 bans bare switches); `single` stays segmented ≤6 options, dropdown above; `multi` keeps chip buttons.
- Hidden (`ShownWhen` false) controls keep their state values, contribute neutral values to evaluation (boolean `false`, multi `[]`, enum unchanged), and restore on re-show (spec §4.5).
- A new option that no activity reads is a control that lies — every new *bound* option below names its activity; options added purely as vocabulary carry `help` saying what phase binds them, and the plan says so here: `runtimeModel`, `deliveryOwnership`, `supportModel` and most `identity` options are vocabulary-first in this phase (their consumers are the fixture workbook's matrix and later admin-authored rules), and their help text says the sample binds only what it can demonstrate.

## Review Focus

1. **Old saved state after the vocabulary change** (`hosting: "cloud"`, `integrations: ["public-internet", "sso"]` in localStorage): must load with invalid enum values dropped to defaults and multi values filtered to surviving options — not evaluated as ghosts. Task 1.
2. **`ShownWhen`-hidden control with a non-default retained value** (genAI dependents toggled on, then genAI off): hidden values must not fire rules while hidden, must come back on re-show. Task 4.
3. **Hosting split misfire:** `hosting: "aws"` must keep generic cloud work and drop the Azure-specific rows (the exact failure §8.2 warns about). Task 2.
4. **Inbound/outbound split:** inbound alone triggers the WAF/exposure review and not the proxy; outbound alone the reverse (§8.6 "the important one"). Task 2.
5. **Section completion honesty:** `serviceTier = "Not yet determined"` with `required: true` must show its section as incomplete (◐), not complete. Task 4.

---

### Task 1: Startup state survives a vocabulary change (RF#1/#5)

**Files:** `js/app.js` (`loadState`), regression group using `appHarness`.

`loadState` today merges `saved.scenario` blindly; `applyLoadedData` already filters. Extract that filter into a shared `mergeScenario(attrs, saved)` used by both: keeps booleans that are booleans, enum values that are options, multi arrays filtered to options; everything else defaults. Test: harness with prefilled storage `{ scenario: { hosting: "cloud", integrations: ["public-internet", "sso"], aiWorkload: true } }` against the NEW data → `getState().scenario.hosting` is the default (not "cloud"), `integrations` keeps only surviving values, `aiWorkload` true survives. RED against current code by asserting the filter (fails: hosting stays "cloud").

### Task 2: Vocabulary v2 — hosting split, AI split, sourcing 12, identity, network split

**Files:** `data/scenario.data.js`, `data/process.data.js` (rewired `when`s + a few new sample activities, all excluded by default), `test/regressions.js` (one comprehensive group), `test/run-tests.js` (integration-options assertion updated for the moved chips).

**Data (sections in brackets):**
- [2] `hosting` options → `azure` (default), `aws`, `gcp`, `on-prem`, `saas-vendor`, `hybrid`, `existing-platform`. Rules: `cloud` (id kept) → `{ hosting: { in: ["azure", "aws", "gcp", "hybrid"] } }`; new `azure` → `{ hosting: "azure" }`; `onPrem` unchanged. Azure-specific activities (`cloud-subscription`, `cloud-landing-zone`, `cloud-iam`, `gpu-quota`) move to `azure`-based whens; generic cloud rows (`cloud-network`, `cloud-iac`, `cloud-cost-approval`, `cloud-env-dev`, `dr-env-cloud`) stay on `cloud`.
- [2] `runtimeModel` multi (`iaas`, `containers`, `paas` default, `serverless`, `data-platform`, `physical`, `vendor-hosted`, `shared-platform`) — vocabulary-first; feeds derived `privateEndpoint`.
- [2] `genAiWorkload` boolean + dependents `genAiMonthlyCostOver1k`, `azureOpenAiPolicyException` with `shownWhen: { genAiWorkload: true }` (§8.3). `aiWorkload` keeps its rule id.
- [5] Sourcing (§8.4): `thirdPartyInvolved` (parent), keep `newVendor`, add `existingApprovedVendor`, `softwareLicense`, `professionalServices`, `vendorNeedsOrgAccess`, `vendorHostsOrAccessesData`, `managedService`, `contractChangeRequired`, `soleSource`; keep `hardwareProcurement` (label "Hardware purchase"). New rule `thirdPartyRisk` → `{ all: [{ thirdPartyInvolved: true }, { any: [{ newVendor: true }, { vendorHostsOrAccessesData: true }, { vendorNeedsOrgAccess: true }] }] }`; `vendor-risk` moves to it; `vendor-onboard` → `{ any: [{ vendorNeedsOrgAccess: true }, { professionalServices: true }] }`; `vendor-contract` → `{ any: [{ contractChangeRequired: true }, "newVendor"] }`; `vendor-rfp` → `{ any: [{ productEvaluationRequired: true }, { rfpRequired: true }, { rfiRequired: true }] }` (finally consuming Phase 2's selection route). Presets `adopt-saas`/`deploy-cots` add `thirdPartyInvolved: true, vendorHostsOrAccessesData: true` (SaaS) / `thirdPartyInvolved: true, softwareLicense: true` (COTS) so their vendor chains still light up.
- [5] `identity` multi (§8 group 9): `workforce`, `customer-identity`, `partner-external`, `sso-federation`, `role-group-based`, `privileged`, `service-account`, `m2m-api`, `secrets-vaulting`, `access-certification`, `vendor-personnel`. `int-sso` moves to `{ identity: { includes: "sso-federation" } }`; `sso` leaves `integrations`.
- [5] `network` multi (§8 group 11): `inbound-internet`, `outbound-internet`, `private-connectivity`, `hybrid-connectivity`, `load-balancer`, `firewall-change`, `dns-ipam`, `certificate-pki`. `integrations` drops `public-internet`/`private-network`/`web-proxy`; `int-internet` → `{ network: { includes: "inbound-internet" } }`; `int-private-network` → `{ network: { includes: "private-connectivity" } }`; `int-web-proxy` → `{ proxyAllowlisting: true }` (derived); `deepSecurity`'s internet leg → `{ network: { includes: "inbound-internet" } }`.
- [derived] Add §5.10: `wafRequired` ← inbound; `proxyAllowlisting` ← outbound; `privateEndpoint` ← `runtimeModel INCLUDES paas`. Derived defaults again equal shipped-default derivations (`privateEndpoint` default true — no activity bound, chip only; others false).
- [6] `deliveryOwnership` enum (internal default, vendor, joint, managed-service, platform-self-service) and `supportModel` enum (stream-aligned default, platform-sre, central-ops, vendor, shared) — vocabulary-first; `vendor-onboard` also fires on `{ deliveryOwnership: { in: ["vendor", "joint"] } }` (an `any` with its existing rule).
- [1/4] Existing attrs get their `section` numbers; `serviceTier` and `dataScope` gain `required: true`.

**Tests (write first, watch the right ones fail):** default map identity (ids + 198d, third time); `hosting: "aws"` keeps `cloud-network`/`cloud-iac`/`cloud-cost-approval` and drops `cloud-subscription`/`cloud-landing-zone`/`cloud-iam`; `network: ["inbound-internet"]` includes `int-internet`, derives `wafRequired` true, excludes `int-web-proxy`; `network: ["outbound-internet"]` the reverse; sourcing: `thirdPartyInvolved + vendorNeedsOrgAccess` without `newVendor` gets `vendor-onboard` + `vendor-risk` but not `vendor-contract`'s newVendor leg (§8.4's "common real case"); saas preset still lights its vendor chain; run-tests' "every integration option drives at least one activity" updated to the surviving 5 integration chips + equivalent assertions for the two new bound network options and `identity: sso-federation`.

### Task 3: Booleans render as Yes/No segmented controls

**Files:** `js/app.js` (`buildScenarioControls` boolean branch), `css/app.css`. Spec §4.3. The forced-by-implication state renders the segmented pair disabled with the "Required by X" hint unchanged. Browser-verified in Task 5 (no fake-DOM coverage exists for control rendering; the VM harness still executes the code path, so a crash fails existing groups).

### Task 4: Six sections, completion dots, ShownWhen disclosure

**Files:** `js/app.js` (`buildScenarioControls` restructure + `effectiveScenario`), `css/app.css`, regression group for the evaluation semantics.

- Section titles (spec §4.2): 1 "What are you doing?" · 2 "Where and how will it run?" · 3 "Is it standard?" · 4 "What data and business risk?" · 5 "What external dependencies?" · 6 "Who builds and operates it?". Attributes without `section` fall into a trailing "Options" section (imported legacy data).
- Collapsible: header button (aria-expanded) + body; open state in `state.sections` (default: 1 and 2 open); persisted.
- Dots: ● every required attr in the section answered and at least one control differs from default OR section was opened; ◐ a required attr unanswered (`serviceTier === "tbd"`, required multi empty) while others answered; ○ untouched and never opened. Honest and cheap; the exact policy lives in one `sectionState()` function with a comment.
- `ShownWhen`: a control whose rule evaluates false against `state.scenario` is not rendered; `effectiveScenario` neutralizes it (boolean → `false`, multi → `[]`, enum → left) exactly like `enabledWhen`'s disabled path. Values retained in state; re-show restores (spec §4.5).
- **Engine-level regression:** attrs `[{genAI bool}, {costOver1k bool, shownWhen {genAI:true}}]`, activity keyed `{costOver1k:true}`: state has `costOver1k: true` but `genAI: false` → build via the harness's `effectiveScenario` path (drive through `appHarness` state + `rebuild`) excludes the activity; flip genAI on → included. RF#2 pinned.

### Task 5: Browser verification, docs, bundle

- Browser (localhost, synthetic events): six sections render with titles and dots; section 4 shows ◐ when tier is "Not yet determined" (set `required` sentinel), ● when answered; booleans are Yes/No pairs; genAI dependents appear only when genAI is Yes and remember their values; hosting dropdown (7 options > 6 → dropdown per §4.3); default map unchanged at 39 rows; both themes.
- `docs/UI-TOOLS.md` sidebar section rewritten for sections + facts; README sidebar sentence updated.
- Suites + `node tools/bundle.js`; commit.
