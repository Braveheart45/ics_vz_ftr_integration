# Reference — Logical Plan, Design Decision & BigQuery SQL Idioms (S07a / S08 / S09)

Loaded for the generation stages. This is the **dialect-specific** reference — when adding a new
warehouse, fork this file (e.g. `snowflake-idioms.md`) and have the prompt assembler select it by
dialect; the spine and the other references stay unchanged.

## S07a — Logical Plan Announcement (mandatory, every run)

After the STM and before any SQL, emit exactly one `decision`-type activity block summarising the
full logical plan. Do not emit the SQL artifact before this block.

```activity
{
  "stage": "sql_generation",
  "type": "decision",
  "status": "completed",
  "title": "Logical Plan — <target object name>",
  "summary": "<One sentence: what is built, from which source(s), at what grain>",
  "details": [
    "Object type: VIEW / TABLE / PROCEDURE — <rationale>",
    "Source table(s): <project.dataset.table> — score: <N>% — evidence: <phrase>",
    "Grain: <dimension(s)> — <why this grain>",
    "Joins: <key> ON <condition> — <cardinality assumption>",
    "Filters: <condition> — <business rule source>",
    "Transformations: <key expressions> — <business rule>",
    "Load pattern: <append / merge / insert-overwrite> — <rationale>"
  ],
  "evidence": ["<Jira phrase / file column / free-text fragment that justified each key decision>"],
  "confidence": <overall 0-100>,
  "source": "claude"
}
```

Rules: every `details` entry names the decision and its evidence. **Alignment with S06:** if S06
already emitted a `[CLARIFY]` for a critical gap, do not emit a second one here. If S06
auto-approved all critical inferences (each ≥50%) but overall confidence is < 50, follow this
block immediately with `[CLARIFY]` to confirm the plan before generating SQL. If overall
confidence ≥ 50, proceed to S08/S09. Respect S06's per-inference thresholds — do not invent an 80%
gate here.

## S08 — Design Decision

Decide and record: object type (view vs table vs procedure); load pattern (append vs merge vs
insert-overwrite / delete+insert); partition/filter strategy; scheduling/audit implications if
supplied. Auto-approve only if explicit or ≥90% confidence; otherwise clarify. Emit an activity
event with the decisions and confidence.

## S09 — BigQuery SQL generation rules

Generate production-oriented BigQuery SQL:
- fully qualified objects (`project.dataset.table`)
- clear CTE order: `src_*`, `joined_*`, `filtered_*`, `aggregated_*`, `final`
- meaningful aliases, no one-letter aliases
- explicit casts
- `SAFE_DIVIDE` for data-driven division
- `COUNTIF` for conditional counts
- `QUALIFY ROW_NUMBER()` for window dedupe
- `COALESCE` / `IFNULL` for nullable inputs
- comments only when they clarify business rules

### Explicit `AS alias` on every SELECT expression (mandatory)

Every expression in the outermost SELECT list — or the `final` CTE that feeds it — MUST carry an
explicit `AS column_alias` clause, and the alias MUST exactly match the `targetColumn` name from
the corresponding STM row. No exceptions: direct column references, arithmetic (`a - b`),
`CASE WHEN`, window functions, and aggregates all require an explicit `AS alias`. Expressions
without an alias fail the bridge's deterministic STM↔SQL check even if the SQL is otherwise
correct, because the column cannot be matched back to its STM target.

Emit an activity event: SQL artifact generated and the major design choices behind it.
