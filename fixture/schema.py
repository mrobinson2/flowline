# -*- coding: utf-8 -*-
"""Synthetic fixture mirroring the source workbook schema.
   Invented task names and numbers; real column names, vocabularies and phase shape.
   UNKNOWN markers are the things I still need confirmed from Mike."""

PHASES = [
    ("1. Concept & Demand", 14, 926.0, 57.0, 189.5, 28.1),
    ("2. Discovery & Product Selection", 9, 1152.0, 208.0, 357.6, 124.8),
    ("3. Placement & Pattern Selection", 8, 272.0, 26.0, 78.4, 16.6),
    ("4. Requirements & Classification", 12, 448.0, 56.0, 150.0, 36.4),
    ("5. Architecture & Design", 16, 608.0, 84.0, 198.0, 51.2),
    ("6. Architecture Governance", 6, 400.0, 20.0, 82.0, 10.0),
    ("7. Procurement & Vendor", 5, 680.0, 38.0, 162.0, 19.0),
    ("8. Security & Privacy Approvals", 4, 360.0, 20.0, 74.0, 10.0),
    ("9. Provisioning (Pipeline / IaC)", 9, 412.0, 53.0, 135.6, 34.5),
    ("10. Platform & Middleware Integration", 12, 648.0, 54.0, 222.0, 34.2),
    ("11. Network & Connectivity", 5, 180.0, 12.0, 40.4, 5.8),
    ("12. Data", 3, 144.0, 27.0, 54.0, 18.3),
    ("13. Observability & Ops Readiness", 6, 208.0, 24.0, 59.6, 13.8),
    ("14. Test & Validation", 10, 588.0, 96.0, 161.4, 55.2),
    ("15. Resilience & DR", 4, 168.0, 22.0, 48.6, 12.2),
    ("16. Security Evidence & Signoff", 4, 224.0, 28.0, 53.6, 14.4),
    ("17. Production Readiness & Change", 8, 224.0, 24.0, 59.6, 13.9),
    ("18. Go-Live & Hypercare", 7, 130.0, 18.0, 38.5, 11.2),
    ("19. Post Go-Live & Decommission", 4, 220.0, 22.0, 79.0, 14.2),
]

STEP_TYPE = ["Value-Add", "Business Non-Value-Add (Type 1 Muda)", "Waste (Type 2 Muda)",
             "Approval Gate", "Handoff", "Rework Loop", "Milestone"]

DOWNTIME = ["Defects", "Overproduction", "Waiting", "Non-Utilized Talent",
            "Transportation", "Inventory", "Motion", "Extra-Processing", "-"]

TT_TYPE = ["Stream-Aligned", "Platform", "Enabling", "Complicated-Subsystem",
           "Governance Function (not a TT team)"]

INTERACTION = ["Collaboration", "X-as-a-Service", "Facilitating", "Handoff (TT anti-pattern)"]

LANE = ["All lanes", "Conditional", "Standard + Custom", "Custom only"]   # UNKNOWN: is this the full list?
HOURS_PER_DAY = 8   # CONFIRMED: every Edges earliest-finish lands on an exact eighth of a day

TEAMS = {  # team -> Team Topologies Type, as observed in the screenshots
    "Business / Product Owner": "Stream-Aligned", "Stream-Aligned Team": "Stream-Aligned",
    "Delivery Leadership": "Stream-Aligned", "GenAI Innovation Team": "Enabling",
    "Enabling Architecture": "Enabling", "Solution Architecture": "Enabling",
    "Platform Team": "Platform", "Cloud Ops / SRE": "Platform", "Platform Engineering": "Platform",
    "Cloud Platform": "Platform", "CMDB / Asset Mgmt": "Platform", "Cloud FinOps": "Platform",
    "Cybersecurity": "Complicated-Subsystem", "Network Engineering": "Complicated-Subsystem",
    "Network Security": "Complicated-Subsystem", "Data Privacy": "Complicated-Subsystem",
    "IAM": "Complicated-Subsystem", "Resilience Architecture": "Complicated-Subsystem",
    "Database Platforms": "Complicated-Subsystem", "Integration Platforms": "Complicated-Subsystem",
    "Architecture Governance": "Governance Function (not a TT team)",
    "Procurement": "Governance Function (not a TT team)",
    "Procurement / Legal": "Governance Function (not a TT team)",
    "PMO / Project Leadership": "Governance Function (not a TT team)",
    "PMO / Demand Mgmt": "Governance Function (not a TT team)",
    "Finance / PMO": "Governance Function (not a TT team)",
    "IT Change Management": "Governance Function (not a TT team)",
    "AI Governance": "Governance Function (not a TT team)",
    "AI Governance Board": "Governance Function (not a TT team)",
    "SLT": "Governance Function (not a TT team)",
    "Resource Management": "Governance Function (not a TT team)",
}

# Task List columns A..Y. CONFIRMED from the workbook's own column-title tab.
# R..X are a precomputed CPM schedule in DAYS (the hours columns L..O are the source).
TASK_COLUMNS = ["ID", "Phase", "Task", "Assigned Team", "Team Topologies Type",
                "Interaction Mode (\"Team Topologies\")", "Predecessor IDs", "Step Type (Lean)",
                "Waste Category (DOWNTIME)", "Lane Applicability", "Applies When",
                "Current Lead Time (hrs)", "Current Cycle Time (hrs)",
                "Optimized Lead Time (hrs)", "Optimized Cycle Time (hrs)",
                "%C&A", "Flow Efficiency", "Duration (days)",
                "Earliest Start (day)", "Earliest Finish (day)",
                "Latest Start (day)", "Latest Finish (day)",
                "Slack (days)", "Critical Path", "Notes"]

# CONFIRMED. Note the order: SUCCESSOR first, then predecessor.
EDGE_COLUMNS = ["Successor ID", "Predecessor ID", "Successor Task", "Predecessor Task",
                "Predecessor Earliest Finish", "Successor Earliest Start", "Zero-Slack Link"]

# UNKNOWN: real Assumptions layout. Reduction factors by step type, per the Read Me.
ASSUMPTION_COLUMNS = ["Step Type (Lean)", "Lead Time Reduction Factor", "Cycle Time Reduction Factor"]

# ---------------------------------------------------------------------------
# TAILORING. Proposed, not yet in Mike's workbook. A project is one PROFILE
# (what kind of work) plus any number of MODIFIERS (is there AI in it, is there
# a discovery phase). Profiles declare a subset of toggles and stay silent on
# the rest, which is what lets a modifier ride on top of any profile.
# ---------------------------------------------------------------------------
TOGGLE_COLUMNS = ["Toggle ID", "Group", "Label", "Type", "Options", "Default", "Implies", "Help"]

# id, group, label, type, options, default, implies, help
TOGGLES = [
    ("workType", "Work Type", "What kind of work is this", "choice",
     "Greenfield build;Lift and shift;COTS or SaaS adoption;Capacity extension;In-place upgrade;Decommission",
     "Greenfield build", "", "Sets the baseline task list. Exactly one."),
    ("discovery", "Scope", "Upfront discovery phase", "boolean", "", "No", "",
     "Kickoff, requirements gathering, peer review, stakeholder validation, ARB."),
    ("rfi", "Sourcing", "Request for Information", "boolean", "", "No", "discovery", ""),
    ("rfp", "Sourcing", "Request for Proposal", "boolean", "", "No", "discovery", ""),
    ("poc", "Sourcing", "Proof of concept or pilot", "boolean", "", "No", "discovery", ""),
    ("newVendor", "Sourcing", "New vendor to the organization", "boolean", "", "No", "", "Triggers TPRM and vendor onboarding."),
    ("hardware", "Sourcing", "Hardware purchase", "boolean", "", "No", "", ""),
    ("newLicense", "Sourcing", "New or expanded licensing", "boolean", "", "No", "", ""),
    ("genAI", "Technical", "AI or GenAI workload", "boolean", "", "No", "", "Adds the AI governance chain."),
    ("pavedRoad", "Technical", "Standard pattern from the catalog", "boolean", "", "No", "",
     "Pre-approved modules, so several reviews stop applying."),
    ("newService", "Technical", "Cloud service type not previously approved", "boolean", "", "No", "", ""),
    ("dataMigration", "Technical", "Data migration required", "boolean", "", "No", "", ""),
    ("tier", "Risk", "Service tier", "choice", "Tier 0;Tier 1;Tier 2;Tier 3;Tier 4", "Tier 3", "", ""),
    ("dataClass", "Risk", "Data classification", "choice", "Public;Internal;Confidential;Regulated", "Confidential", "", ""),
    ("internetFacing", "Risk", "Internet-facing", "boolean", "", "No", "", ""),
    ("drRequired", "Risk", "DR required", "boolean", "", "Yes", "", ""),
]

# Profiles declare only what they name. A blank means "leave it alone".
PROFILE_COLUMNS = ["Profile ID", "Label", "Description"]
PROFILES = [
    ("standard-paved", "Standard paved-road app",
     "Catalog pattern, internal data, no sourcing.",
     {"workType": "Greenfield build", "pavedRoad": "Yes", "discovery": "No",
      "rfi": "No", "rfp": "No", "poc": "No", "newVendor": "No", "hardware": "No",
      "newService": "No", "dataMigration": "No"}),
    ("lift-shift", "Lift and shift, existing vendor",
     "Move an existing app to cloud with no redesign.",
     {"workType": "Lift and shift", "pavedRoad": "No", "discovery": "No",
      "rfi": "No", "rfp": "No", "poc": "No", "newVendor": "No", "hardware": "No",
      "dataMigration": "Yes"}),
    ("cots-rfp", "COTS or SaaS purchase with RFP",
     "Evaluate and buy a product, then onboard the vendor.",
     {"workType": "COTS or SaaS adoption", "pavedRoad": "No", "discovery": "Yes",
      "rfi": "Yes", "rfp": "Yes", "poc": "Yes", "newVendor": "Yes", "newLicense": "Yes"}),
    ("capacity-add", "Regional capacity add",
     "One more server in an existing footprint. No new app.",
     {"workType": "Capacity extension", "pavedRoad": "Yes", "discovery": "No",
      "rfi": "No", "rfp": "No", "poc": "No", "newVendor": "No", "hardware": "Yes",
      "newService": "No", "dataMigration": "No"}),
    ("upgrade", "In-place upgrade",
     "OS, platform or software version uplift on what is already there.",
     {"workType": "In-place upgrade", "pavedRoad": "No", "discovery": "No",
      "rfi": "No", "rfp": "No", "poc": "No", "newVendor": "No", "hardware": "No",
      "newService": "No", "dataMigration": "No"}),
    ("greenfield-pioneer", "Greenfield pioneering",
     "New build using services we have not run before, with sourcing.",
     {"workType": "Greenfield build", "pavedRoad": "No", "discovery": "Yes",
      "rfi": "Yes", "rfp": "Yes", "poc": "Yes", "newVendor": "Yes", "hardware": "Yes",
      "newService": "Yes", "dataMigration": "No"}),
]

# Matrix columns: fixed three, then one per condition.
MATRIX_FIXED = ["Task ID", "Task", "Baseline"]
MATRIX_CONDITIONS = [
    "workType=Greenfield build", "workType=Lift and shift", "workType=COTS or SaaS adoption",
    "workType=Capacity extension", "workType=In-place upgrade", "workType=Decommission",
    "discovery", "rfi", "rfp", "poc", "newVendor", "hardware", "newLicense",
    "genAI", "pavedRoad", "newService", "dataMigration",
    "tier=Tier 0|Tier 1", "dataClass=Regulated", "internetFacing", "drRequired",
]
