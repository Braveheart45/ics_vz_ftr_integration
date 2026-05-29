# SQL Curator Codex Instructions

## Project Intent
SQL Curator is a minimalist local UI over Claude Code for BigQuery SQL generation and conversion. The UI is a presentation shell. Claude Code is the workflow engine.

## Non-Negotiables
- Keep business logic, requirement inference, clarification decisions, SQL generation, schema reconciliation, validation, Jira updates, and GitHub deployment decisions out of the UI.
- Do not add external APIs, custom Jira/BigQuery/GitHub connectors, backend orchestration services, database connectivity, or cloud services for this POC.
- Use the existing Claude bridge and native Claude Code MCP connector flow.
- Target BigQuery project ID and target dataset ID remain mandatory.
- Schema reconciliation and inference must stay within the supplied target dataset; do not crawl all datasets.
- Supported file inputs remain plain text only: TXT, CSV, JSON, MD, and SQL.
- Do not claim support for PDF, DOCX, XLSX, or PPTX unless real extraction is implemented.

## Runtime Contract
- The app runtime skill is the spine `skills/sql-curator/SKILL.md` plus its `references/` and the `contracts/` shapes; the S11 validator persona is `skills/validator/SKILL.md`.
- The bridge composes these into the Claude Code prompt on each request via `mini-services/claude-bridge/prompt-assembler.js` (the single composition seam) — it does not paraphrase skill content.
- Keep the skill files focused on Claude runtime behavior, not React/UI implementation details. Add a stage's detail to a `references/` file, not the spine; add a new warehouse dialect as a new `references/<dialect>-idioms.md`.
- For Jira-backed SQL generation, Claude Code must fetch the Jira story, generate SQL from STM, validate, post a Jira comment, transition Jira to `In Progress`, and report results in the structured validation payload.

## UI Rules
- UI components should collect input, stream/render Claude Code state, show clarification prompts, display SQL, display STM downloads, display validation summary, and trigger explicit user actions such as GitHub deploy.
- UI must not decide whether requirements are sufficient, which schema to inspect, what SQL to generate, or whether confidence is high enough.
- If changing UI, preserve the existing card-based visual system unless the user explicitly asks for visual redesign.
- The SQL Curator Assistant panel is for Claude clarification prompts and user clarification responses, not general app-side business logic.

## Bridge Rules
- `mini-services/claude-bridge/index.js` is the local Claude Code/SSE bridge.
- Keep bridge logic limited to prompt assembly, local session handling, SSE event translation, artifact extraction, fallback normalization, and user-facing activity messages.
- Do not expose raw MCP tool names as primary user-facing activity text.
- Preserve streamed Claude text when the CLI emits `content_block_delta`.
- If Claude omits structured validation, bridge fallbacks must still populate meaningful validation sections.

## Validation Contract
Generated SQL responses must support:
- SQL fenced block.
- STM fenced JSON block.
- Structured validation fenced JSON block with:
  - `requirementCoverage`
  - `stmCompleteness`
  - `schemaReconciliation`
  - `sqlChecks`
  - `jiraTransition`
- Jira comment and transition results must appear in `jiraTransition` when Jira input is supplied.

## Implementation Standards
- Make focused changes only; do not refactor unrelated files.
- Prefer root-cause fixes over cosmetic patches.
- Keep TypeScript types explicit for shared event/data contracts.
- Keep runtime behavior backward-compatible with existing SSE clients where practical.
- Do not add new dependencies unless necessary and approved by the user.
- Do not commit or create branches unless explicitly requested.

## Validation Commands
Use these after code changes when relevant:
- `npm.cmd run lint`
- `npm.cmd run build`
- `node --check mini-services\claude-bridge\index.js`

For local dry-run validation without Claude Code, use the existing offline dry-run mode only with `SQL_CURATOR_ENABLE_OFFLINE_DRY_RUN=true`.
