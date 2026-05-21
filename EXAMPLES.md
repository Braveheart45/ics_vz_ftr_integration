# Analysis Reference Examples
## Report Migration Intelligence Analyzer

These examples define the quality bar for the LLM agent. Each example shows what correct LLM analysis looks like when reading raw SQL/LookML text. The anti-pattern section shows reasoning errors that must never happen.

The server delivers raw file content; there is no parser. Every "extraction" below is something the LLM does itself while reading the artefact.

---

## Example 1 — Complex SQL KPI Reading

**Input SQL:**
```sql
SELECT
    t.category,
    COUNT(DISTINCT csat.survey_id) AS response_count,
    AVG(csat.satisfaction_score) AS avg_csat,
    SUM(CASE WHEN csat.satisfaction_score >= 4 THEN 1 ELSE 0 END) AS positive_count,
    SUM(CASE WHEN csat.satisfaction_score <= 2 THEN 1 ELSE 0 END) AS negative_count
FROM support.csat_surveys csat
JOIN support.tickets t ON csat.ticket_id = t.ticket_id
GROUP BY t.category;
```

**Correct LLM reading:**

KPIs (4 total — never miss CASE WHEN expressions):
| Alias | Formula | Base Column | Aggregation | Meaning |
|---|---|---|---|---|
| response_count | COUNT(DISTINCT csat.survey_id) | csat.survey_id | COUNT DISTINCT | Unique survey responses per category |
| avg_csat | AVG(csat.satisfaction_score) | csat.satisfaction_score | AVG | Average satisfaction score per category |
| positive_count | SUM(CASE WHEN satisfaction_score >= 4 THEN 1 ELSE 0 END) | csat.satisfaction_score | Conditional SUM | Count of positive ratings (score ≥ 4) |
| negative_count | SUM(CASE WHEN satisfaction_score <= 2 THEN 1 ELSE 0 END) | csat.satisfaction_score | Conditional SUM | Count of negative ratings (score ≤ 2) |

Tables (2 total):
| Physical Table | Alias | Role |
|---|---|---|
| support.csat_surveys | csat | Primary — satisfaction survey responses |
| support.tickets | t | Joined — category dimension source |

Join: `csat.ticket_id = t.ticket_id` (INNER JOIN — only tickets with surveys)
Grain: per `t.category`
Filters: none explicit — all tickets with matching surveys

**Business purpose:** Customer satisfaction monitoring by support category. Reports raw response volume, average CSAT, and directional sentiment counts (positive vs. negative) to enable category-level quality review.

**Wrong LLM reading (do not do this):**
```
KPIs: response_count, avg_csat   ← only 2 out of 4 — CASE WHEN expressions missed
Tables: support.csat_surveys     ← only 1 out of 2 — JOIN tables missed
```

---

## Example 2 — LKML Derived Table Reading

**Input LKML:**
```lookml
view: case_handling_kpis {
  derived_table: {
    sql:
      SELECT
          t.category,
          COUNT(DISTINCT t.ticket_id) AS ticket_count,
          AVG(DATEDIFF(hour, t.created_date, t.resolved_date)) AS avg_resolution_hours,
          SUM(CASE WHEN t.sla_met = 1 THEN 1 ELSE 0 END) AS sla_met_count
      FROM support.tickets t
      GROUP BY t.category
    ;;
  }

  measure: row_count {
    type: count
  }

  dimension: category {
    type: string
    sql: ${TABLE}.category ;;
  }
}
```

**Correct LLM reading:**

Tables (read the derived_table SQL block carefully):
| Physical Table | Alias |
|---|---|
| support.tickets | t |

KPIs — from BOTH the derived_table SQL aliases AND the measure blocks:
| Source | Name | Formula | Type |
|---|---|---|---|
| derived_table SQL | ticket_count | COUNT(DISTINCT t.ticket_id) | COUNT DISTINCT |
| derived_table SQL | avg_resolution_hours | AVG(DATEDIFF(hour, t.created_date, t.resolved_date)) | AVG of duration |
| derived_table SQL | sla_met_count | SUM(CASE WHEN t.sla_met = 1 THEN 1 ELSE 0 END) | Conditional SUM |
| measure block | row_count | COUNT(*) | COUNT |

Dimensions: `category`
Grain: per `t.category`

**Business purpose:** Support ticket handling KPIs — case volume, average resolution time, and SLA compliance count per ticket category.

**Wrong LLM reading (do not do this):**
```
Tables: (none)   ← derived_table SQL not read — WRONG
KPIs: row_count  ← only measure blocks considered, derived_table SQL aliases missed — WRONG
```

---

## Example 3 — Semantic Equivalence: Same Concept, Different Names

**Source KPI:**
```sql
COUNT(DISTINCT csat.survey_id) AS response_count
-- Table: support.csat_surveys
-- Business meaning: number of unique survey responses received
```

**Target KPI:**
```lookml
measure: survey_responses {
  type: count_distinct
  sql: ${csat_surveys.survey_id} ;;
  -- Table: csat_surveys (same as support.csat_surveys after schema normalization)
  -- Business meaning: count of distinct survey responses
}
```

**Correct analysis:**
- Names differ (`response_count` vs `survey_responses`) — but name is the weakest signal
- Both: COUNT DISTINCT of `survey_id` from `csat_surveys`
- Both: measure unique survey response volume
- Table: same physical entity (support.csat_surveys = csat_surveys after schema strip)
- Aggregation: COUNT DISTINCT in both
- Business meaning: identical

**Scoring:**
| Dimension | Score | Rationale |
|---|---|---|
| Semantic meaning | 1.00 | Both count unique survey responses |
| Business logic | 0.95 | Identical aggregation, same base column |
| Lineage | 0.95 | Same source table, same column |
| Filter | 1.00 | No filters in either |
| Aggregation | 1.00 | COUNT DISTINCT in both |
| Dimension | 0.90 | Both support category slicing |
| Grain | 1.00 | Per-ticket/category grain compatible |

**Overall score: 0.97 → status: matched**

**WRONG analysis:**
```
response_count vs survey_responses — different names → NOT matched
```
This is the anti-pattern. Name difference alone is never grounds for marking as gap.

---

## Example 4 — Semantic Non-Equivalence: Same Name, Different Meaning

**Source KPI:**
```sql
SUM(CASE WHEN satisfaction_score >= 4 THEN 1 ELSE 0 END) AS positive_count
-- Counts surveys with score >= 4 (positive sentiment threshold)
-- Population: all survey responses
```

**Target KPI:**
```sql
COUNT(DISTINCT ticket_id) AS positive_count
-- Counts tickets (not surveys)
-- Population: resolved tickets only (WHERE status = 'resolved')
```

**Correct analysis:**
- Names are identical (`positive_count`) — but name is the weakest signal
- Source: conditional aggregation on satisfaction score
- Target: distinct ticket count filtered to resolved status
- Source measures sentiment volume; target measures resolution volume
- These are fundamentally different business metrics despite identical names

**Scoring:**
| Dimension | Score | Rationale |
|---|---|---|
| Semantic meaning | 0.00 | Completely different business questions |
| Business logic | 0.00 | Conditional SUM on score vs COUNT DISTINCT of tickets |
| Lineage | 0.00 | survey_id lineage vs ticket_id lineage |
| Filter | 0.00 | Source: no filter. Target: WHERE status='resolved' |
| Aggregation | 0.00 | SUM vs COUNT DISTINCT |
| Dimension | 0.20 | Both relate to support domain |
| Grain | 0.50 | Both per-category |

**Overall score: 0.04 → status: gap**

**WRONG analysis:**
```
positive_count → positive_count (same name) → matched ✓
```
Name match without formula validation is the most common and damaging error. Always validate.

---

## Example 5 — Complete Source-to-Target Analysis

**Source report: CSAT Score Monitoring**
```sql
SELECT
    t.category,
    COUNT(DISTINCT csat.survey_id) AS response_count,
    AVG(csat.satisfaction_score) AS avg_csat,
    SUM(CASE WHEN csat.satisfaction_score >= 4 THEN 1 ELSE 0 END) AS positive_count,
    SUM(CASE WHEN csat.satisfaction_score <= 2 THEN 1 ELSE 0 END) AS negative_count
FROM support.csat_surveys csat
JOIN support.tickets t ON csat.ticket_id = t.ticket_id
GROUP BY t.category;
```

**Target report catalog:**

*Target A: Case Handling KPIs*
```lookml
view: case_handling_kpis {
  derived_table: { sql:
    SELECT t.category,
      COUNT(DISTINCT t.ticket_id) AS ticket_count,
      AVG(DATEDIFF(hour, t.created_date, t.resolved_date)) AS avg_resolution_hours,
      SUM(CASE WHEN t.sla_met = 1 THEN 1 ELSE 0 END) AS sla_met_count
    FROM support.tickets t GROUP BY t.category ;;
  }
  measure: row_count { type: count }
}
```

*Target B: Customer Satisfaction Dashboard*
```sql
SELECT
    t.category,
    COUNT(DISTINCT s.survey_id) AS survey_count,
    AVG(s.satisfaction_score) AS mean_csat,
    COUNT(CASE WHEN s.satisfaction_score >= 4 THEN 1 END) AS promoter_count
FROM vz_support.surveys s
JOIN vz_support.tickets t ON s.ticket_id = t.ticket_id
GROUP BY t.category;
```

---

**Step 1 — Ingest & Segment**

Source: 1 query, 4 KPIs (response_count, avg_csat, positive_count, negative_count), 2 tables (support.csat_surveys, support.tickets), 1 JOIN, GROUP BY category.

Target A: 1 derived table, 4 KPIs (ticket_count, avg_resolution_hours, sla_met_count, row_count), 1 table (support.tickets), GROUP BY category.

Target B: 1 query, 3 KPIs (survey_count, mean_csat, promoter_count), 2 tables (vz_support.surveys, vz_support.tickets), 1 JOIN, GROUP BY category.

---

**Step 2 — Metadata**

Source:
- Purpose: CSAT satisfaction monitoring by support category
- Domain: Customer Service
- Grain: per category
- Primary source: support.csat_surveys (satisfaction data)
- Secondary source: support.tickets (category dimension)
- Filters: implicit INNER JOIN filter (only surveyed tickets)

Target A:
- Purpose: Ticket handling performance (volume, resolution time, SLA compliance)
- Domain: Customer Service
- Grain: per category
- Source: support.tickets only (no survey data)

Target B:
- Purpose: Customer satisfaction monitoring by category
- Domain: Customer Service
- Grain: per category
- Primary source: vz_support.surveys (= support.csat_surveys after prefix strip)
- Secondary source: vz_support.tickets (= support.tickets after prefix strip)

---

**Step 3 — Lineage**

Source KPI lineage:
```
response_count ← COUNT DISTINCT ← csat_surveys.survey_id
avg_csat ← AVG ← csat_surveys.satisfaction_score
positive_count ← Conditional SUM ← csat_surveys.satisfaction_score (filter: >= 4)
negative_count ← Conditional SUM ← csat_surveys.satisfaction_score (filter: <= 2)
```

Target B KPI lineage:
```
survey_count ← COUNT DISTINCT ← vz_support.surveys.survey_id  (≡ support.csat_surveys)
mean_csat ← AVG ← vz_support.surveys.satisfaction_score       (≡ support.csat_surveys)
promoter_count ← Conditional COUNT ← satisfaction_score >= 4  (≡ source positive_count pattern)
```

---

**Step 4 — Semantic Analysis**

Target A covers ticket performance (resolution time, SLA). Source covers CSAT satisfaction scores. These are fundamentally different domains despite sharing the same grain and base table (tickets). Target A does NOT have satisfaction_score data.

Target B covers satisfaction monitoring with survey data. Source tables (support.csat_surveys, support.tickets) and Target B tables (vz_support.surveys, vz_support.tickets) are the same entities after vendor prefix normalization. Business purpose: identical.

---

**Step 5 — Mapping**

Source → Target A: mapping = `none` (different primary data — no survey data in Target A)
Source → Target B: mapping = `1:1` (same purpose, same data sources, same grain, same domain)

Best match: Target B.

---

**Step 6 — KPI Overlap (Source vs Target B)**

| Source KPI | Target KPI | Semantic | Logic | Lineage | Filters | Agg | Dim | Grain | Overall | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| response_count | survey_count | 1.00 | 0.95 | 0.95 | 1.00 | 1.00 | 1.00 | 1.00 | **0.98** | matched |
| avg_csat | mean_csat | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | **1.00** | matched |
| positive_count | promoter_count | 0.90 | 0.80 | 0.95 | 0.95 | 0.70 | 1.00 | 1.00 | **0.87** | matched |
| negative_count | (none) | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | **0.00** | gap |

Notes on positive_count vs promoter_count:
- Both: conditional aggregation on satisfaction_score >= 4
- Source: `SUM(CASE WHEN score >= 4 THEN 1 ELSE 0 END)` — includes all zeros
- Target: `COUNT(CASE WHEN score >= 4 THEN 1 END)` — excludes zeros (NULL-based)
- Result is identical numerically. Minor formula variation. Score 0.80 on logic.

Notes on negative_count:
- No equivalent in Target B. This is a genuine KPI gap.
- Target B tracks promoters (>=4) but not detractors (<=2) separately.

Overlap calculation:
- Matched KPIs (score ≥ 0.80): response_count, avg_csat, positive_count = 3
- Total source KPIs: 4
- overlapPercent = 3/4 × 100 = 75%
- Decision: Consolidate (70–99% band)

Recommendation: Extend Target B (Customer Satisfaction Dashboard) to add a `detractor_count` measure tracking satisfaction_score <= 2. Estimated effort: 0.5 engineer-days (one new measure, existing data source, no new table joins). Retire source CSAT Score Monitoring after parallel-run validation.

---

## Anti-Pattern Catalog

### Anti-pattern 1: Name-based matching

```
WRONG:
Source KPI: positive_count
Target KPI: positive_count
Match: ✓ (name matches)
```
Always validate formula, aggregation type, and base columns before declaring a match.

### Anti-pattern 2: Missing CASE WHEN KPIs

```
Wrong LLM reading:
SELECT COUNT(DISTINCT x) AS a, AVG(y) AS b, SUM(CASE WHEN z > 0 THEN 1 ELSE 0 END) AS c
Identified KPIs: a, b   ← c was skipped because it uses CASE WHEN
```
CASE WHEN expressions inside SUM/COUNT/AVG are always KPIs. Read the full SELECT list character by character — never skip an aliased expression just because the formula is complex.

### Anti-pattern 3: Missing JOIN tables

```
Wrong LLM reading:
FROM table_a a JOIN table_b b ON a.id = b.id
Identified tables: table_a   ← table_b missed
```
Every table in FROM and every JOIN must appear in your table inventory. Schema-qualified names (`schema.table`) count as the full qualified name, not just the table portion.

### Anti-pattern 4: LKML derived table ignored

```
Wrong LLM reading:
view: my_view { derived_table: { sql: SELECT ... FROM support.tickets ... ;; } }
Identified tables: (none)   ← derived_table SQL not read
```
The `sql:` block inside `derived_table` is SQL. Read it the same way you read any SQL file — for tables, joins, filters, and aliased KPI expressions. Measure blocks AND derived-table-SQL aliases are both KPIs.

### Anti-pattern 5: Overlap before mapping

```
Wrong sequencing:
Step 1: Compute overlap against every target by name similarity
Step 2: Pick the target with the highest score as the mapping
```
Mapping must precede overlap. Map first by business purpose, lineage, and domain. Then compute overlap dimensions only against the mapped target.

### Anti-pattern 6: Shallow rationale

```
WRONG:
"The source report has 0% overlap with all target reports because no KPI names match."

This is unacceptable. The agent must:
1. List every source KPI and explain specifically why it has no match in any target
2. State whether the absence is a genuine gap or a naming convention difference
3. Verify table lineage before declaring no match
```

### Anti-pattern 7: Generic confidence

```
WRONG: confidenceScore: 0.65  (no explanation)

CORRECT: confidenceScore: 0.65 because SQL is complete but two KPI names are
cryptic (positive_count could refer to multiple business concepts without 
column-level lineage confirmation from the source schema documentation)
```

---

## Reference: Table Prefix Normalization

Strip these prefixes when comparing table names:

| Prefix | Meaning |
|---|---|
| `fact_` | Fact table (DW convention) |
| `dim_` | Dimension table (DW convention) |
| `ref_` | Reference / lookup table |
| `tgt_` | Target schema artefact |
| `vz_` | Verizon-prefixed table |
| `mkt_` | Marketing domain prefix |
| `fr_` | Frontier-prefixed table |
| `stg_` | Staging area |
| `rpt_` | Reporting layer |
| `src_` | Source layer |
| `lkp_` | Lookup table |

After stripping, `fact_sales`, `vz_sales`, `fr_sales`, and `sales` are all the same entity. Schema differences (`schema_a.sales` vs `schema_b.sales`) are noted but treated as likely same entity unless domain context suggests otherwise.
