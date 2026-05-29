# Contracts

Machine-checkable shapes for the artifacts the agent emits and the bridge parses. These files are
the **single source of truth for the agent↔bridge interface**: the skill references describe them
in prose for the model, and `mini-services/claude-bridge/` parses them in code. When the two
drift, runs fail silently — so the field names and enums here are locked by a test.

| Contract | Emitted as | Parsed by | Documented for the model in |
|---|---|---|---|
| `stm.schema.json` | fenced ` ```stm ` JSON | `output-parsers.js` `extractStm()` | `skills/sql-curator/SKILL.md` (S07) |
| `validation.schema.json` | fenced ` ```validation ` JSON | `index.js` `normalizeValidationSummary()` + `release-policy.js` | `skills/sql-curator/SKILL.md` + `skills/validator/SKILL.md` |
| `activity.schema.json` | streamed ` ```activity ` blocks | `index.js` `processInlineActivities()` → `activity.js` `makeActivityEvent()` | `skills/sql-curator/SKILL.md` + references |

## Agreement test

`mini-services/claude-bridge/tests/contract-agreement.test.js` loads these schemas and asserts:
- the `activity.schema.json` enums equal `ACTIVITY_TYPES` / `ACTIVITY_STATUSES` / `ACTIVITY_SOURCES`
  exported by `activity.js`;
- the `stm.schema.json` row properties equal the keys `extractStm()` returns;
- the `validation.schema.json` section keys equal the sections the bridge reads.

No runtime JSON-Schema validator is bundled (the bridge depends only on `pino`); parsing stays
lenient at runtime and the test is what locks the interface. If you add a field, update: (1) the
schema here, (2) the parser, (3) the skill reference, (4) the agreement test.

## Versioning

These are draft contracts for the POC. When the platform stabilises, stamp each with a `version`
and treat a breaking change (renamed/removed field, narrowed enum) as a major bump that requires a
coordinated parser + skill update. Additive fields (new optional property) are minor.

## Portability note

The skills under `skills/` and these contracts are the portable brain. The Claude Code CLI today
and the Claude Agent SDK tomorrow both consume the same files; only the composition seam
(`mini-services/claude-bridge/prompt-assembler.js`) and the process spawn are CLI-specific. A
migration replaces the assembler + spawn and leaves `skills/` and `contracts/` untouched.
