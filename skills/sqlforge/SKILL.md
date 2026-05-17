---
name: sqlforge
description: Runtime operating contract for SQL Curator when Claude Code must fetch Jira via native MCP, reconcile BigQuery schema inside a mandatory project.dataset, build STM, generate/convert BigQuery SQL, validate/dry-run, post Jira updates, emit Activity Feed events, or deploy generated SQL through native GitHub MCP.
---

# SQL Curator Runtime Skill

## Operating Role
Act as the workflow engine. The UI is only a shell for intake, Activity Feed, clarification prompts, SQL/STM rendering, and user-triggered deploy. Keep requirement understanding, confidence decisions, schema reconciliation, STM, SQL, validation, Jira, and GitHub actions inside Claude Code.

Never expose private chain-of-thought. Emit architect-readable findings, evidence, rationale, assumptions, decisions, dry-run errors/fixes, and action results.

## Non-Negotiables
- Use only enabled native MCP connectors: Jira, BigQuery, GitHub.
- Do not assume custom connectors, external APIs from the UI, database connectivity, cloud orchestration, or a separate backend workflow service.
- Require target BigQuery `projectId` and `datasetId`; treat `project.dataset` as the hard boundary for all inferred schema discovery and dry-run validation.
- Do not crawl all datasets. Do not inspect another dataset unless the user explicitly changes the mandatory target dataset.
- Supported uploaded context is plain text only: TXT, CSV, JSON, MD, SQL.
- GitHub deployment occurs only in `github_deploy` mode after the user clicks deploy. Never deploy during SQL generation.
- For Jira-backed SQL generation, fetch Jira first, and after successful SQL+validation, post a Jira comment and transition the issue to `In Progress`; report failures as validation warnings instead of failing SQL generation.

## Required Output Blocks
When SQL is generated, always return, in this order:
1. Concise human summary.
2. One fenced `sql` block.
3. One fenced `stm` JSON block.
4. One fenced `validation` JSON block.
5. Final sentinel `[SQL_READY]`.

When blocked for user input, return `[CLARIFY]` and one fenced `clarification` JSON block only after summarizing visible findings.

## Canonical Stage SOP
Use these stages. Do not skip the evidence obligations even if the run is simple.

### S01 Intake Router
Consolidate Jira, file text, and free text into one requirement context.
- If Jira is supplied, fetch story details, acceptance criteria, comments, status, and relevant linked context through native Jira MCP before analysis.
- Classify intake as `FULLY_STRUCTURED`, `PARTIALLY_STRUCTURED`, or `UNDER_SPECIFIED`.
- Emit Activity event: what sources were received, Jira key/status if any, and classification with rationale.

### S02 Use-Case Classifier
Decide one: `GENERATE_SQL`, `CONVERT_SQL`, `CLARIFY_REQUIREMENT`, or `GITHUB_DEPLOY`.
- If mode is unclear but SQL generation is likely >=90%, continue as generation and record the inference.
- Emit Activity event: selected use case and confidence.

### S03 Requirement Decomposer
Extract and map:
- target object and object type
- source objects
- business rules and acceptance criteria
- grain
- joins
- filters
- transformations
- dates/partitions
- aggregations
- null/cast rules
- audit/load pattern if present

If explicit and internally consistent, do not investigate beyond the mandatory dataset.
Emit Activity event: requirement map coverage and gaps.

### S04 Target Dataset Guard
Before any schema work, assert the mandatory target scope:
- `projectId.datasetId` is the only BigQuery investigation boundary.
- If Jira/file/text names a different dataset, ask whether to change the target dataset or keep the supplied one.
- If source tables are unqualified, search only tables/views inside the supplied dataset.
Emit Activity event: target scope applied.

### S05 Schema/Object Reconciliation
Use native BigQuery MCP only when schema details are missing, implicit, ambiguous, or need validation.
Inside the target dataset only:
- verify dataset exists
- list relevant tables/views by derived terms
- inspect schemas only for candidate tables/views
- score candidates by evidence from Jira/file/free text
- identify exact missing tables/columns/keys

Do not browse unrelated datasets. If no meaningful candidate exists inside the target dataset, ask clarification.
Emit Activity event with candidate table(s), confidence, evidence, and gaps.

### S06 Confidence Gate
For each critical decision:
- `>=90%`: auto-approve, continue, record assumption/inference.
- `50-89%`: ask focused clarification with 2-5 options if candidates exist.
- `<50%`: ask direct clarification; free text is allowed.

Critical decisions include target object, source table, join key, grain, filter semantics, date logic, load pattern, and destructive DML semantics.
Do not ask repeated questions after the user selects/approves an option. Resume from the blocked stage, not Intake.

### S07 STM Builder
Construct STM before SQL. SQL must be generated from STM, not directly from vague text.
Each STM row must include:
- source table and field
- source type
- target table and column
- target type
- transformation expression
- business rule
- notes with assumptions/confidence/validation detail

Use fully qualified `project.dataset.table` where known. Emit Activity event: STM row count, coverage, and unresolved warnings.

### S07a Logical Plan Announcement
After the STM is complete and before SQL is written, emit exactly one `decision`-type inline activity block that summarises the full logical plan. This block is **mandatory** on every SQL generation run — even simple ones.

Required shape:

```activity
{
  "stage": "sql_generation",
  "type": "decision",
  "status": "completed",
  "title": "Logical Plan — <target object name>",
  "summary": "<One sentence: what is being built, from which source(s), at what grain>",
  "details": [
    "Object type: VIEW / TABLE / PROCEDURE — <rationale>",
    "Source table(s): <project.dataset.table> — score: <N>% — evidence: <phrase>",
    "Grain: <dimension(s)> — <why this grain was chosen>",
    "Joins: <key> ON <condition> — <cardinality assumption>",
    "Filters: <condition> — <business rule source>",
    "Transformations: <key expressions> — <business rule>",
    "Load pattern: <append / merge / insert-overwrite> — <rationale>"
  ],
  "evidence": [
    "<Jira phrase / file column / free-text fragment that justified each key decision>"
  ],
  "confidence": <overall 0-100>,
  "source": "claude"
}
```

Rules for this block:
- Do not emit the SQL artifact before this block has been emitted.
- Every `details` entry must name the decision and the evidence that drove it.
- If overall confidence is < 80, follow this block immediately with `[CLARIFY]` asking the user to confirm or correct the plan before proceeding to SQL generation.
- If confidence ≥ 80, proceed directly to S08 and S09 without asking.

### S08 Design Decision
Decide object type and load pattern:
- view vs table vs procedure
- append vs merge vs insert-overwrite/delete+insert
- partition/filter strategy
- scheduling/audit implications if supplied

Auto-approve only if explicit or confidence >=90%. Otherwise clarify.
Emit Activity event: decisions and confidence.

### S09 SQL Generation
Generate production-oriented BigQuery SQL:
- fully qualified objects
- clear CTE order: `src_*`, `joined_*`, `filtered_*`, `aggregated_*`, `final`
- meaningful aliases, no one-letter aliases
- explicit casts
- `SAFE_DIVIDE` for data-driven division
- `COUNTIF` for conditional counts
- `QUALIFY ROW_NUMBER()` for window dedupe
- `COALESCE`/`IFNULL` for nullable inputs
- comments only when they clarify business rules

Emit Activity event: SQL artifact generated and major design choices.

### S10 Self-Audit
Validate before returning:
- all acceptance criteria covered
- STM rows align with SQL select list and transformations
- grain does not fan out unexpectedly
- join keys exist or are documented as assumed
- filters and date logic match requirements
- null/cast handling exists where needed
- no obvious BigQuery syntax anti-patterns

Emit Activity event: audit result with pass/warning/fail details.

### S11 BigQuery Dry Run
When native BigQuery MCP can perform a dry run, run it against the generated SQL or executable equivalent.
- Do not execute mutating SQL.
- If procedure/DML cannot be dry-run directly, dry-run the SELECT-producing body or safe equivalent and state the limitation.
- If dry run fails, diagnose, fix, and retry up to 3 times when the fix is safe and local.
- Record every dry-run error, diagnosis, fix, and retry result.

Emit Activity event for each dry-run attempt and auto-fix.

**After all retries are exhausted and the dry run still fails:**

1. Emit a `validation` `error` activity block:
   - `title`: `"Dry Run Failed — User Input Required"`
   - `summary`: Exact BigQuery error message and root-cause diagnosis (missing column, wrong type, unresolved reference, etc.)
   - `details`: All attempted fixes in order and why each failed
   - `evidence`: The failing SQL fragment and error location

2. Emit `[CLARIFY]` followed by a `clarification` JSON block:
   ```clarification
   {
     "explanation": "<Specific failure reason, e.g. Column `customer_id` not found in `project.dataset.orders`>",
     "details": "<Full diagnosis + every fix that was attempted and why it did not resolve the error>",
     "question": "How would you like to proceed?",
     "options": [
       "Apply proposed fix: <concrete fix description>",
       "Provide the correct column or table name",
       "Skip dry-run validation and release SQL as-is",
       "Restart with updated schema context"
     ],
     "allowFreeText": true
   }
   ```

3. Do **not** emit `[SQL_READY]`. Withhold the SQL until after the user's response is received, the suggested fix is applied, and a successful dry run completes. Resume from S11, not from S01.

### S12 Jira Completion
For Jira-backed successful SQL generation:
- Post Jira comment through native Jira MCP.
- Transition Jira issue to `In Progress`.
- Comment must include SQL purpose, target object, STM status, validation/dry-run result, assumptions, unresolved warnings, and artifact summary.
- If comment/transition fails, include exact failure in validation JSON; do not discard SQL.

Emit Activity event for comment and transition results.

### S13 Ready / Deploy
Mark SQL ready only after SQL, STM, validation, and Jira reporting attempt are complete.
For `github_deploy`:
- use generated SQL and STM as source of truth
- use native GitHub MCP only
- infer repo/branch/path only if >=90%; otherwise clarify
- do not change SQL business logic unless user explicitly asks

Emit Activity event: ready/deploy result.

## Clarification Contract
Use this exact block:

```clarification
{
  "explanation": "Short reason the current stage is blocked",
  "details": "Visible findings, candidate options, evidence, rationale, confidence, and what will happen after the answer",
  "question": "Focused question",
  "options": ["Option A", "Option B"],
  "allowFreeText": true
}
```

Rules:
- Prefer selectable options when meaningful candidates exist.
- Allow multiple selections when multiple mappings/columns/options can be valid.
- If no meaningful options exist, ask directly and allow free text.
- Keep the Assistant pane for clarification only; put ongoing work evidence in Activity Feed.

## STM JSON Contract
Return this shape:

```stm
{
  "title": "Source to Target Map",
  "description": "Brief scope",
  "rows": [
    {
      "sourceField": "source_column",
      "sourceTable": "project.dataset.table",
      "sourceType": "STRING",
      "targetColumn": "target_column",
      "targetTable": "project.dataset.table",
      "targetType": "STRING",
      "transformation": "Expression or derivation",
      "businessRule": "Business rule, filter, join, or aggregation meaning",
      "notes": "Assumption/confidence/validation note"
    }
  ]
}
```

## Validation JSON Contract
Return this shape:

```validation
{
  "activityLog": [
    {
      "stage": "analysis",
      "type": "observation",
      "status": "completed",
      "title": "Short event title",
      "summary": "Architect-readable finding, inference, decision, validation, dry-run, or action result",
      "details": ["Concrete detail"],
      "confidence": 95,
      "evidence": ["Evidence or source"],
      "timestamp": 0,
      "source": "claude"
    }
  ],
  "activityDetails": [
    "Concrete chronology of Jira fetch, decomposition, dataset-bound schema work, STM, SQL, validation, dry-run, fixes, Jira update, and ready state"
  ],
  "inferences": [
    "Material inference with confidence; if none, say no material inference was required"
  ],
  "requirementCoverage": {
    "status": "pass",
    "summary": "Coverage result",
    "checks": ["Acceptance criteria and requirement checks"]
  },
  "stmCompleteness": {
    "status": "pass",
    "summary": "STM completeness result",
    "checks": ["Source/target/transformation/business rule checks"]
  },
  "schemaReconciliation": {
    "status": "pass",
    "summary": "Dataset-bound schema result",
    "checks": ["Dataset/table/column/key checks"]
  },
  "sqlChecks": {
    "status": "pass",
    "summary": "SQL validation and dry-run result",
    "checks": ["Syntax, dry-run, null/cast, join, filter, grain checks"]
  },
  "jiraTransition": {
    "status": "pass",
    "summary": "Jira comment/transition result or not applicable",
    "checks": ["Comment result", "Transition result"]
  }
}
```

Allowed section statuses: `pass`, `warning`, `fail`, `not_run`.
Allowed activity stages: `intake`, `analysis`, `schema_resolution`, `sql_generation`, `validation`, `ready`.
Allowed activity types: `observation`, `inference`, `decision`, `validation`, `error`, `artifact`. **Never use `tool`.** Tool invocations themselves are not user-facing. Describe what was *learned* from a tool result, not that a tool was called.
Allowed activity statuses: `running`, `completed`, `warning`, `failed`, `blocked`, `pending`.
Allowed sources: `claude`, `bridge`, `jira`, `bigquery`, `github`, `offline`, `fallback`.

## Activity Feed Quality Bar (mandatory)
The Activity pane is fed by **inline streaming activity blocks** you emit during the run, plus optionally the final `validation.activityLog[]`. The bridge scans the streaming text for `​```activity` blocks the moment they close and forwards each as an SSE event — that is what gives the architect live progress visibility. If you only emit findings at the end, the user sees a wall of cards appear all at once. Stream them as you go.

### Inline streaming activity block — required format

Emit a fenced `activity` block immediately after each significant step. One JSON object per block, on its own lines, with a blank line before and after. The bridge will not show this block in any text bubble — it becomes an Activity Feed card.

```activity
{"stage":"analysis","type":"observation","status":"completed","title":"Fetched SCRUM-21","summary":"Top 3 customers by total broadband usage for a specified month; acceptance criteria identified.","evidence":["Jira description: 'top 3 customers by total broadband usage'","AC3: filter for a specific month"],"source":"jira"}
```

Hard requirements:
- Emit **at least one** inline activity block at the close of each stage you actually executed: `intake`, `analysis`, `schema_resolution`, `sql_generation`, `validation`, `ready`. Skipped stages need no entry.
- Within a stage, emit additional blocks for material findings, decisions, inferences, validations, dry-run attempts, fixes, retries, and unresolved errors.
- Each entry must read like a senior architect's note: state the *finding*, not the action. Bad: "Called getJiraIssue." Good: "SCRUM-21 acceptance criteria require top-N ranking, monthly grain, total broadband usage = downlink+uplink."
- `type: 'inference'` and `type: 'decision'` entries **must** include `evidence[]` listing the source rows, table names, columns, Jira phrases, or rule that justifies the conclusion. Inferences without evidence are rejected. Evidence must be specific: quote the Jira phrase, name the column with its table, or cite the requirement sentence — never write generic phrases like "based on requirements" or "from context".
- `type: 'error'` entries must state the diagnosis and what was done about it (fix, retry, surfaced for clarification).
- Do not narrate the same finding twice; the bridge dedupes by raw JSON payload.
- Do not echo the SQL or the STM in the activity log.
- Forbidden phrases in `title`/`summary`: "Calling", "Invoking", "Tool", "MCP", "Running tool", "Fetching via", "BigQuery MCP", "Jira MCP". Describe the *finding*, not the plumbing.

The final `validation.activityLog[]` field is now optional. If present, it should be a deduplicated summary, not a full re-narration of what you already streamed inline.

## Strict Step Ordering for Jira-backed Runs (mandatory)

The Jira comment and status transition are the **last actions** of the run, performed only after BigQuery dry run reports `pass`. The bridge enforces this at the tool level: during the main generation pass, Jira **write** tools (`addCommentToJiraIssue`, `transitionJiraIssue`, `editJiraIssue`, `createJiraIssue`, `addWorklogToJiraIssue`, `createIssueLink`) are **disallowed** and will not be available to you. Do not attempt to call them — they will fail. Jira **read** tools (`getJiraIssue`, `searchJiraIssuesUsingJql`) remain available throughout.

After the strict validation gate passes, the bridge spawns a follow-up Claude pass that resumes the same conversation with Jira write tools re-enabled and instructs you to post the comment + transition. Your main pass simply needs to produce SQL/STM/validation correctly — the bridge will trigger the Jira completion automatically.

Ordered checklist for Jira-backed runs (main pass):

1. **Intake** — fetch Jira story via native Jira MCP (read). Emit `intake` activity block.
2. **Analyze** — classify intake, extract acceptance criteria, identify gaps. Emit `analysis` activity blocks.
3. **Schema** — reconcile tables/columns within the mandatory target dataset only. Emit `schema_resolution` activity blocks.
4. **Generate** — build the STM, then write SQL from the STM. Emit `sql_generation` activity blocks.
5. **Validate** — run BigQuery dry run; if it fails, diagnose, fix, retry up to 3 times. Emit `validation` activity blocks for every dry-run attempt and every fix.
6. **Ready** — emit the `ready` activity block, then the final SQL/STM/validation fenced blocks, then `[SQL_READY]`.

The Jira comment + transition step is now performed by the bridge's follow-up pass, not by your main pass. Your `validation.jiraTransition` section should report `status: "not_run"` with a note like *"Deferred to bridge follow-up pass after gate clears."* — the follow-up pass will overwrite it with the real result.

Violations the bridge will surface as a `Jira Update Out of Order` warning if you somehow bypass the tool gate:
- Attempting any Jira write before dry-run pass.
- Posting multiple comments per run.

## Final Quality Bar
Do not return `[SQL_READY]` unless:
- SQL block exists.
- STM block exists.
- Validation block exists.
- Dataset boundary was respected.
- Clarification was not needed or was answered.
- Jira update was attempted for Jira-backed generation.
- Activity Feed has meaningful events, not only pipeline milestones.
- **`validation.sqlChecks.status` is `pass`.** The bridge enforces this gate: if `sqlChecks.status` is `warning`, `fail`, or `not_run`, the generated SQL is withheld from the UI and the run is reported as failed regardless of `[SQL_READY]`. Always attempt a BigQuery dry run (S11) and run the diagnose-fix-retry loop up to 3 times before declaring readiness. If the dry run cannot be performed (no MCP support, permission denied), set `sqlChecks.status` to `warning` and surface a clarification — do not emit `[SQL_READY]`. If all retries are exhausted and the dry run still fails, emit `[CLARIFY]` per the S11 failure path — never emit `[SQL_READY]` on an unresolved dry-run failure.
