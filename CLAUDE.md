# SQL Curator — project guide for Claude Code

This repo is a BigQuery SQL generation agent. The agent's operating contract (its "brain") lives
under [`skills/`](skills/) and the artifact shapes it emits live under [`contracts/`](contracts/):

- `skills/sql-curator/SKILL.md` — the always-on orchestration spine (S01–S14).
- `skills/sql-curator/references/` — stage detail (confidence gate, schema reconciliation,
  BigQuery idioms, clarification).
- `skills/validator/SKILL.md` (+ `references/`) — the S11 validator persona.
- `contracts/*.schema.json` — STM / validation / activity shapes (the agent↔bridge interface).

At runtime the bridge composes these into the prompt via
`mini-services/claude-bridge/prompt-assembler.js` — the single composition seam. That assembler
is the one CLI-specific piece; the skills and contracts are the portable brain consumed unchanged
by the Claude Agent SDK on migration.

> Note: this file intentionally does **not** `@import` the spine. The bridge injects the brain
> itself, so importing it here too would double-load it. To read the contract, open
> `skills/sql-curator/SKILL.md` directly.
