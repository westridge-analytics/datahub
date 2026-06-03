# Handoff: Westridge 990 Research App

## Overview

Internal research workstation for exploring U.S. nonprofit 990 tax filing data. Supports institution-level financial analysis, peer group (cohort) construction, multi-year trend visualization, and ThinkCell / XLSX export workflows.

## About the Design Files

`990 Research App.html` is a **low-fidelity interactive wireframe** — it shows structure, navigation flow, component layout, and data shape, but is not pixel-perfect production UI. The developer's task is to recreate these screens in the target codebase using its established framework, component library, and design system.

The wireframe is fully interactive: click through all five screens, drill from Main Data into Institution Analysis, and interact with the Visualization tabs. Use it as a functional spec, not a style guide.

**Fidelity: Low-fi / Wireframe.** Colors, typography, and spacing in the HTML are directional only. The design tokens section below describes the intended direction, but the developer should apply the codebase's own component library where one exists.

---

## Screens / Views

### 1. Overview
The app's home screen. Shows:
- A summary card grid linking to each of the four main sections (Main Data, Institution Analysis, Visualization, Cohorts)
- The core data flow diagram (see Architecture below)
- UX Principles, Design Direction, and Ingestion Notes reference cards

### 2. Main Data
A dense, sortable, filterable table of all organizations × all fiscal years.

**Toolbar (top):**
- Page title + row count
- Search input (by org name or EIN)
- Active filter chips (dismissible); "+ Add Filter" button
- "Saved views" dropdown (placeholder)
- Column picker dropdown — grouped by Identity / Income / Balance Sheet / Cash Methods
- "Tag N selected →" button (appears when rows are checked)
- "Export ↓" button

**Table:**
- Sticky dark header row with sortable columns (click to toggle asc/desc)
- Checkbox column for multi-select
- Default visible columns: EIN, Organization, Year, Sector, State, Cohort, Revenue, Expenses, Net Income, Total Assets, Net Assets
- Addable columns: Liabilities, Cash & Equiv., Unrestricted Cash M1/M2/M3
- "Analyze →" action button per row → navigates to Institution Analysis for that EIN + year
- Negative Net Income shown in red
- Cohort column shown in accent color
- Row click = toggle selection; checkbox = same

**Footer:** row count, selection count, data source label.

### 3. Institution Analysis
Deep-dive view for a single organization across years.

**Header:**
- Organization selector (dropdown of all orgs)
- EIN display
- Reconciliation status badge ("✓ Reconciled" or "⚠ Exception — Review Required")
- "Export ↓" and "Source 990 ↗" (links to `pdf_url` from filing data) buttons

**Year strip:** one button per available fiscal year, showing year + total revenue. Selected year is highlighted. Amber dot on years with reconciliation exceptions.

**5-Year Trend Chart:** SVG line chart, Revenue (solid) vs. Expenses (dashed). Click data points to change selected year.

**Unrestricted Cash — Three Methods:** three cards side by side:
- M1: `Cash × (Unrestricted NA / Total NA)` — confidence: High
- M2: M1 + unrestricted short-term investments — confidence: Medium
- M3: M2 + board-designated estimate — confidence: Estimated

**Exception Banner:** amber warning bar (shown only when reconciliation flag is set), with link to source 990 PDF.

**Two-column financial statements:**
- Left: Income Statement (contributions, program revenue, investment income, other revenue → Total Revenue; program expenses, G&A, fundraising → Total Expenses; Net Income)
- Right: Balance Sheet (cash, ST investments, LT investments, PP&E, other assets → Total Assets; current liabilities, LT debt, other liabilities → Total Liabilities; unrestricted NA, restricted NA → Total Net Assets)
- Every line item shows a Part/Line reference (e.g. "Pt VIII L1") linking back to the 990 form

### 4. Visualization
Three chart views toggled via a tab bar. Period selector (start/end year dropdowns) and Export button in header.

**A — Multi-Institution Trend:**
- Left panel: checkbox list of organizations (max 10 selected), metric selector dropdown
- Right panel: multi-line SVG chart, one line per selected org, legend in header

**B — Revenue Volatility Cohorts:**
- Box-and-whisker chart, one box per volatility cohort (Very Stable → Very Volatile, defined by CV range)
- Click a cohort box → member table appears below showing org names, CV, revenue
- Member table has Export button

**C — Revenue Growth Cohorts:**
- Indexed line chart (2019 = 100 baseline), one line per growth cohort (Shrinking → High Growth, defined by CAGR range)
- Same click-to-member-table interaction as B

### 5. Cohorts & Tags
*(Placeholder in wireframe — not yet fully specced)*
User-defined peer groups. Tags can be assigned to any organization and reused as filters across all sections. CRUD operations: create, rename, delete cohorts; assign/remove orgs.

---

## Architecture & Data Sources

### Recommendation: Use IRS SOI CSVs as the primary financial data source

The repo at `westridge-analytics/datahub` (docs/990_data/file_data/) contains IRS Statistics of Income annual extract files covering **FY 2010–2023**. These are the same underlying files that power the ProPublica Nonprofit Explorer API — the API is just a hosted query layer on top of a subset of them (roughly FY 2011–2018). **Do not use the ProPublica API for financial data.** The CSVs are more complete, more current, and avoid rate limits.

```
IRS SOI CSVs (py12–24)           IRS EO BMF (or ProPublica /search.json)
  All financial data                Org metadata: name, NTEE, address, state
  FY 2010–2023                      Free IRS download or API query
        │                                         │
        └──────────────────┬──────────────────────┘
                           │ Join on EIN
                           ▼
                    Unified internal DB
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
      Main Data     Institution Viz     Visualization
                           │
                           ▼
                    Export (XLSX / CSV / ThinkCell)
```

**Org metadata options — pick one:**
- **IRS EO BMF download** (fully offline, free): https://www.irs.gov/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf
- **ProPublica /search.json** (convenient, rate-limited): `GET https://projects.propublica.org/nonprofits/api/v2/search.json?q=<name>`

---

## Data Model

### Organization fields (from EO BMF or ProPublica /search)

| App field | Source field | Notes |
|-----------|-------------|-------|
| `ein` | `ein` (integer) / `strein` (XX-XXXXXXX) | Use `strein` format for display |
| `name` | `name` | Organization name as filed with IRS |
| `state` | `state` | Two-letter postal abbreviation |
| `sector` | `ntee_code` → decode to label | e.g. "A20" → "Arts & Culture". Needs NTEE lookup table (10 major groups) |
| `subseccd` | `subseccd` | 501(c)(\_\_\_) type, integer |
| `cohort` | Internal app state only | User-defined; not in any external source |

### Filing / financial fields (from IRS SOI CSVs)

The CSV files use IRS element names. Convenience aliases (available in the ProPublica API but NOT in the raw CSVs) are mapped below.

**Top-level totals (always present):**

| App field | IRS element name | Form 990 reference |
|-----------|-----------------|-------------------|
| `totalRevenue` | `TOTREVNUE` | Part VIII, Line 12 |
| `totalExpenses` | `TOTFUNCEXPNS` | Part IX, Line 25 |
| `totalAssets` | `TOTASSETSEND` | Part X, Line 16 |
| `totalLiab` | `TOTLIABEND` | Part X, Line 26 |
| `totalNA` | `TOTNETASSETSEND` | Part X, Line 33 |

**Revenue breakdown (Form 990 only — check `FORMTYPE = 0`):**

| App field | IRS element name | Form 990 reference |
|-----------|-----------------|-------------------|
| `contributions` | `TOTCNTRBGFTS` | Part VIII, Line 1h |
| `programRevenue` | `TOTPRGMREVNUE` | Part VIII, Line 2g |
| `investmentIncome` | `INVSTMNTINC` | Part VIII, Line 3 |
| `otherRevenue` | Derived: `TOTREVNUE - TOTCNTRBGFTS - TOTPRGMREVNUE - INVSTMNTINC` | Part VIII, Line 11e |

**Expense breakdown (Form 990 only):**

| App field | IRS element name | Form 990 reference |
|-----------|-----------------|-------------------|
| `programExpenses` | `TOTPRGMRVNUEEXPNS` | Part IX, Line 25a |
| `gaExpenses` | `TOTGENERALEXPNS` | Part IX, Line 25c |
| `fundraisingExpenses` | `TOTFUNDRSNG` | Part IX, Line 25d |

**Balance sheet (Form 990 only):**

| App field | IRS element name | Form 990 reference |
|-----------|-----------------|-------------------|
| `cashEquiv` | `CASHNONSAVED` | Part X, Line 1 |
| `stInv` | `SVNGSTEMPINVST` | Part X, Line 2 |
| `ltInv` | `INVSTMNTSPUBLICLY` + `INVSTMNTSOTHRSEC` | Part X, Lines 5+6 |
| `ppe` | `LNDBLDGSEQUIP` | Part X, Line 10c |
| `unaNA` | `UNRSTRCTDNETASSTSEND` | Part X, Line 27 |
| `resNA` | `TEMPRSTRCTDNETASSTSEND` + `PERMRSTRCTDNETASSTSEND` | Part X, Lines 28+29 |

**Derived fields (not in source, must be calculated):**

| App field | Calculation |
|-----------|------------|
| `netIncome` | `TOTREVNUE − TOTFUNCEXPNS` |
| `unrestrCashM1` | `CASHNONSAVED × (UNRSTRCTDNETASSTSEND / TOTNETASSETSEND)` |
| `unrestrCashM2` | `unrestrCashM1 + (SVNGSTEMPINVST × unrestricted ratio)` |
| `unrestrCashM3` | `unrestrCashM2 + board-designated portion of net assets` (approximation) |

> **Note on form type variation:** The detailed line-item fields above are only reliably present for `FORMTYPE = 0` (Form 990). Form 990-EZ (`FORMTYPE = 1`) and Form 990-PF (`FORMTYPE = 2`) have different field sets. The top-level totals (`TOTREVNUE`, `TOTFUNCEXPNS`, `TOTASSETSEND`, `TOTLIABEND`) are consistent across all three. The Institution Analysis detail view should check form type and gracefully degrade to totals-only for EZ/PF filers.

---

## Ingestion Notes

> ⚠️ These are critical for the data pipeline — flag for the backend/data engineer.

1. **Two file formats:** Files py12–py17 (`*.dat`) are **pipe-delimited**. Files py18–py24 (`*.csv`) are **comma-separated**. The ingestion layer must detect format by filename and parse accordingly.

2. **Processing year ≠ fiscal year:** The filename (e.g. `24eoextract990.csv`) is the IRS *processing* year, not the organization's fiscal year. Always use the `TAX_PRD` field (format: `YYYYMM`, the month the fiscal year ended) as the authoritative period. A single processing-year file may contain filings from multiple fiscal years.

3. **EIN format:** The IRS SOI files store EIN as an integer (leading zeros stripped). Normalize to the `XX-XXXXXXX` display format (zero-pad to 9 digits, insert hyphen after position 2) for display and for joining against EO BMF.

4. **Duplicate filings:** An organization may appear more than once in a single file (amended returns). Deduplicate on `(EIN, TAX_PRD)` keeping the most recent record by processing date.

5. **ProPublica API pagination:** If using ProPublica `/search.json` for org metadata, note it returns **25 results per page** (zero-indexed `page` parameter). The `/organizations/:ein.json` endpoint returns all filings for a given EIN and does not paginate.

---

## Design Tokens (Directional)

```
Background canvas:   #F2F4F1
Surface (cards):     #FFFFFF
Surface alt:         #F2F4F1
Left nav:            #203E46
Nav text:            #7AAEBB
Nav active text:     #F2F4F1

Text primary:        #10232B
Text secondary:      #3D5A63
Text tertiary:       #7A9AA4

Accent:              #6F99CC
Accent mid:          #5580B0
Accent light:        #E4EEF8
Accent border:       #AECAE0

Warning:             #7A5C3A
Warning light:       #F3EAE0
Warning border:      #C4A882

Error:               #B83228
Error light:         #FAEBE9

Section header bg:   #D7E8EE
Border:              #BDD3DC

Chart palette:       #203E46, #6F99CC, #A78B70, #4A8A6A, #8A5A8A

Typography:          Avenir Next LT Pro — Regular / Medium / Demi
Table font size:     12px
Body font size:      13px
Table numerics:      font-variant-numeric: tabular-nums
```

---

## Files in This Package

| File | Purpose |
|------|---------|
| `README.md` | This document — implementation spec and data model reference |
| `990 Research App.html` | Interactive wireframe — open in browser to explore all screens |

---

## Key Open Questions for Dev Team

1. **EO BMF vs. ProPublica API for org metadata** — EO BMF is a bulk download (fully offline, no rate limits); ProPublica `/search.json` is easier to query ad-hoc but rate-limited and slightly stale. Decide based on expected query volume and whether offline operation is required.

2. **Form type handling** — Will the app support 990-EZ and 990-PF filers, or filter to Form 990 only? Affects how much of the Institution Analysis detail view can be populated.

3. **Cohort persistence** — Where are user-defined cohorts stored? Local file, database, user profile service?

4. **ThinkCell export format** — ThinkCell accepts JSON via its API. Confirm the exact chart types and data structure expected before implementing the export layer.
