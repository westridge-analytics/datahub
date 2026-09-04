# Expert QA checklist — IRS e-file ingestion

**For:** a reviewer who knows nonprofit financial reporting and Form 990 well.
**Purpose:** every item here is a judgement that testing cannot settle. The code is verified —
figures reconcile internally, paths resolve, conflicts behave as designed. What remains is whether
the numbers *mean* what we assumed, and whether the policy choices match how this data will be used.

Status of each item: `[ ]` open · `[x]` confirmed · `[!]` needs change

Last updated 2026-09-04, after the backfill. All build phases complete; 1,082,714 e-file rows loaded. Items are added as phases land.

---

## A. Does the mapping read the right lines?

The e-file XML offers several plausible sources for most columns. We chose one each. These are the
choices worth a second opinion.

### A1 `[ ]` Spot-check whole returns against the filed original
The single most valuable check. Pick 10–20 organizations you know, or can look up, and compare the
app's figures against the actual filed 990.

- In the app: `/institution/<EIN>`, or search the organization by name
- Source of truth: the organization's own 990 (its website, ProPublica Nonprofit Explorer, or the
  IRS TEOS search)
- Compare at minimum: total revenue, total expenses, total assets, total liabilities, net assets

Internal reconciliation is already strong — Part I revenue components sum to total revenue in
**7,180 of 7,180** returns tested, and balance sheets reconcile in 99.99% of 990s. So a discrepancy
here would most likely mean we picked the wrong *line*, not that we misread it.

### A2 `[ ]` Is `total_revenue` the right total?
We read **Part I line 12** (`CYTotalRevenueAmt`). Part VIII reports a total revenue figure too, and
for some filers they differ. Is Part I the figure a researcher expects?

### A3 `[ ]` Is the functional expense split usable as mapped?
`program_expenses` / `ga_expenses` / `fundraising_expenses` come from **Part IX column A** split
(`TotalFunctionalExpensesGrp`).

Measured across 7,180 returns: the three columns sum to the filer's own Part IX total in **93.8%**
of cases. The remaining 6% are filers whose own split does not add up. Part IX total agrees with
Part I total in 99.96%, so `total_expenses` is sound.

**Question:** should the ~6% inconsistent splits be stored as filed, flagged, or nulled? We
currently store them as filed.

### A4 `[ ]` Restricted net assets after the 2018 standard change
The e-file XML uses the post-ASU-2016-14 vocabulary: a single donor-restricted figure
(`DonorRestrictionNetAssetsGrp`) and a without-donor-restriction figure
(`NoDonorRestrictionNetAssetsGrp`). The older SOI extracts had *two* columns, temporarily and
permanently restricted, which our schema stores summed into `restr_net_assets`.

**Question:** is mapping the single donor-restricted figure onto `restr_net_assets` correct for
trend analysis that spans the 2018 change? It is the closest equivalent, but the concepts are not
identical, and a chart crossing 2018 will show a definitional break rather than a real one.

### A5 `[ ]` Form 990-PF: which column?
The PF layout has four columns — revenue and expenses per books, net investment income, adjusted net
income, and disbursements for charitable purposes. We read **per books**
(`*RevAndExpnssAmt`), as the figure comparable to a 990's totals.

**Question:** for foundation analysis, is per-books the right column, or would net investment income
be more useful?

### A6 `[ ]` Form 990-EZ: program expenses
We map `program_expenses` from `TotalProgramServiceExpensesAmt`. The EZ has no functional-expense
split at all, so `ga_expenses` and `fundraising_expenses` stay **null** for every EZ filer rather
than being set to zero.

**Question:** is null right, or should EZ filers be excluded from any analysis using those columns?

### A7 `[ ]` Derived `other_revenue`
For 990-EZ and 990-PF there is no "other revenue" line, so we compute it as
`total_revenue − contributions − program_revenue − investment_income`. The full 990 reports it
directly and is not derived.

**Question:** is a residual acceptable, or should it be null for those form types so it is never
mistaken for a reported figure?

---

## B. Policy choices about competing data

### B1 `[ ]` Should the SOI annual extract outrank the e-file XML?
Current rule: **yes, and field by field.** Where both cover the same organization and period, SOI
wins on any field it populates, and never blanks a field it leaves empty. The e-file data fills the
leading edge — roughly 18 months earlier than SOI — and fills gaps.

**Question:** is SOI's curation actually more trustworthy than the raw submission for research use?
If not, this inverts.

### B2 `[ ]` Amended returns: latest submission wins
When an organization files the same form more than once for a period, the most recent submission
populates the row. The supersession is logged to `ingest_audit` (which version replaced which, with
both submission dates), but the superseded *figures* are not retained.

**Question:** does research use ever need the originally-filed figures — for restatement analysis,
say — or is latest-filed always the right answer?

Context: about 3.6% of returns in a monthly archive carry an amended indicator.

### B3 `[ ]` Organizations with no BMF record
`filings` requires an organization record, and the SOI extracts carry no organization name. So a
filing whose EIN is absent from the BMF is **skipped and reported** — about 1% of a load
(3,570 rows on the last full run).

Note the e-file XML *does* carry the name and state, so e-file loads can create these organizations
themselves. This limitation is SOI-only.

**Question:** for SOI loads, is skipping right, or should a placeholder organization be created? A
placeholder would be unsearchable and render blank in the table.

### B4 `[x]` Form 990-T excluded
Confirmed by the client, 2026-09-03: 990-T data is not wanted. Those returns are filtered and
counted, nothing stored.

Also a correctness matter: 87% of 990-T returns share an `(EIN, tax period)` key with the
organization's real 990, which they would overwrite.

---

## C. Coverage and completeness

### C1 `[ ]` Are the null rates acceptable?
Detail columns are legitimately empty for many filers. Measured on one archive:

| Column | 990 | 990-EZ | 990-PF |
|---|---|---|---|
| total revenue / expenses / assets | 100% | 98% | 100% |
| program expenses | 95% | 85% | — |
| cash equivalents | 92% | 96% | 62% |
| short-term investments | 65% | — | — |
| long-term investments | 40% | — | — |
| property, plant & equipment | 72% | — | — |
| unrestricted net assets | 78% | — | — |
| restricted net assets | 33% | — | — |

**Question:** do any of these fall below what a given analysis needs? A 33% fill rate on restricted
net assets may not support a cohort comparison.

### C2 `[ ]` Foreign filers have no state
Twelve returns per archive use a foreign address (`ProvinceOrStateNm`, `CountryCd`) rather than a US
state, so `state` is null — e.g. Curtin University (Western Australia), University of Regina
(Saskatchewan). Deliberate: a US state filter should not match a Canadian province.

**Question:** should foreign filers be identifiable in the app some other way, or is null fine?

### C3 `[ ]` Tax year coverage after backfill
Before this work: complete through TY2023, TY2024 only ~12% populated, TY2025 absent. After
loading the 24 archives: TY2024 complete, TY2025 as complete as the IRS has published.

**Question:** confirm the resulting coverage matches what the research actually requires.

---

## D. Things to watch on the first real load

### D1 `[x]` Reconcile e-file against SOI on the *same* filing — DONE, and it passes
Run during the backfill against `2025_TEOS_XML_01A.zip`, using the audit trail to find the 1,551
keys where an e-file row lost to a stored SOI row, then re-mapping those returns and comparing
field by field.

| | agree | differ | match |
|---|---|---|---|
| all returns | 6,112 | 1,487 | 80.4% |
| **non-amended only** | **4,825** | **174** | **96.5%** |

88.3% of all disagreements are on returns flagged amended, where the two sources legitimately hold
different versions of the same filing — SOI has the original, the archive has the restatement.

Of the 174 non-amended differences, **156 (90%) are exactly 1**, concentrated in
`total_liabilities` (114 of 174). Only **16 differ by more than 1,000** — 0.2% of the 7,599 field
comparisons — and four of those are one organisation (EIN 30-0130780).

**Conclusion: the field mapping is sound.** 99.8% of comparisons are exact or within 1.

**Two questions this raises for you:**
- **The ±1 pattern.** SOI records `1` where the e-file XML records `0`, overwhelmingly on
  `total_liabilities`. Is 1 a sentinel or rounding convention in the SOI extracts? If so, is a
  stored `1` meaningfully different from `0` for analysis?
- **The 16 larger differences.** Not amended, not ±1. Worth a look at EIN 30-0130780 tax period
  2024-05 in particular, where revenue differs by 114,000 (SOI 109,979 vs e-file 223,801). Is that
  an SOI correction, an unflagged amendment, or something we are reading wrong?

### D2 `[ ]` Archive load throughput and responsiveness
Measured on the smallest archive (12,245 returns): **10.9 seconds** end to end, with a pure-JS
parser. The browser uses a faster native parser, so the largest archive (168,344 returns) should
land around 2–3 minutes per pass, and each load makes two passes — one to see what it will collide
with, one to load.

**To check on a large archive:** does the tab stay responsive, and does the log show batches
completing steadily? The reader yields to the browser every 250 returns rather than running in a
background thread; if a big archive still feels frozen, moving it to a Web Worker is a contained
change.

### D3 `[ ]` Skip counts by reason
Every load reports its skips: unsupported form, missing EIN, unusable tax period, malformed, unknown
EIN. A count that looks unexpectedly large is worth investigating before accepting the load.

Three separate bugs in this uploader presented as a clean-looking run that loaded nothing, so the
counts are deliberately explicit. Treat a suspiciously round or suspiciously zero number as
suspect.
