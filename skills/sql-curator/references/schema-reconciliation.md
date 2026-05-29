# Reference — S05 Schema/Object Reconciliation

Loaded for S04–S05. **BigQuery MCP is mandatory whenever source table or column names are not
explicitly provided in the requirements.** Naming-convention guesses ("the dataset is called
`telecom_analytics` so the table must be `broadband_usage`") are NOT acceptable as a substitute
for actually calling the tool. The user supplied the dataset specifically so you can inspect it.

**Tool-name adaptation:** the canonical names below (`list_table_ids`, `get_table_info`,
`get_table_schema`, `execute_sql_readonly`) are illustrative — use the exact names exposed by the
native BigQuery MCP connector in your environment.

## Term-Extraction-First protocol — follow this exact sequence, never skip steps

**Step 1 — Extract search terms before any BigQuery call.** Pull entity nouns and domain keywords
from all context: Jira title, description, acceptance criteria, comments, file headings, free
text. Good terms: `customer`, `broadband`, `usage`, `orders`, `monthly`, `revenue`. Do this in
your head — no BigQuery call yet.

**Step 2 — Use the supplied dataset as the boundary.** Do not list datasets. Treat the supplied
`projectId.datasetId` as the only schema boundary. Verify access only through target-dataset
table/schema calls. If those calls show the dataset is inaccessible or empty for the requested
work, ask a focused clarification — do not crawl other datasets.

**Step 3 — Filter table names by extracted terms (one target-dataset call).** Call
`list_table_ids` for the target dataset. Do NOT inspect schemas yet. Filter the returned list
client-side: keep only names containing at least one extracted term (case-insensitive substring
or word match). O(terms) string matching — fast and free.

**Step 4 — Score and rank candidates (no BigQuery call).** Score each candidate by the count of
distinct extracted terms in its name. Rank descending. Keep the top-3 (or all that passed if
fewer). If zero pass, widen to prefix matching on the first meaningful noun, or clarify.

**Mandatory: Step 4 Rationale Activity Block.** Whenever source tables are NOT explicitly named,
emit a `decision`-type block right after Step 4 so the user can see *why* you picked these tables:

```activity
{
  "stage": "schema_resolution",
  "type": "decision",
  "status": "completed",
  "title": "Candidate Source Tables Shortlisted",
  "summary": "Top <N> tables from <dataset> selected by term-overlap scoring. <X> of <Y> total tables in dataset matched at least one extracted term.",
  "details": [
    "Extracted terms: <term1>, <term2>, <term3>, ...",
    "Top candidate 1: <table_name> — score: <N> — matched terms: <terms>",
    "Top candidate 2: <table_name> — score: <N> — matched terms: <terms>",
    "Top candidate 3: <table_name> — score: <N> — matched terms: <terms>",
    "Rejected (score = 0): <comma-separated non-matching tables, truncated to 10 with '+N more'>"
  ],
  "evidence": [
    "Term source: Jira description / free-text sentence / file heading (quote the phrase that produced each term)",
    "Tables listed via list_table_ids in <project>.<dataset>"
  ],
  "confidence": <0-100 reflecting confidence the top candidate is correct>,
  "source": "claude"
}
```

**Step 5 — Inspect schemas for top-3 candidates only.** Call `get_table_info`/`get_table_schema`
for each of the top-3 only — never the full list. Identify exact columns, types, join keys,
partition fields.

**Step 6 — Score columns against requirements.** Map extracted terms to column names within the
top-3. Identify the best source table(s) by column overlap. Record confidence and evidence.

**Mandatory: Step 6 Rationale Activity Block.** After inspecting schemas, emit a second
`decision`-type block stating which candidate(s) you chose and why, with column-overlap evidence:

```activity
{
  "stage": "schema_resolution",
  "type": "decision",
  "status": "completed",
  "title": "Source Table(s) Selected",
  "summary": "<table(s)> chosen as source. <other candidate> rejected because <reason>.",
  "details": [
    "Chosen: <project.dataset.table> — column overlap with requirements: <columns>",
    "Rejected candidate: <project.dataset.table> — reason: <e.g. missing usage_date column>",
    "Join key inferred: <column> — present in both <table_a> and <table_b>"
  ],
  "evidence": [
    "Columns in chosen table: <list>",
    "Requirement phrases that drove the match: <quoted phrases>"
  ],
  "confidence": <0-100>,
  "source": "claude"
}
```

## Rules
- Never call schema inspection tools on more than 3 tables per resolution pass.
- Never list or inspect tables outside the mandatory target dataset.
- If no candidate scores above 0 after Step 3, emit one clarification asking the user to name the
  source table(s) — do not broaden to a full dataset scan.
- Both rationale blocks are mandatory whenever source tables were inferred. Skipping them means
  the user cannot audit your selection.
