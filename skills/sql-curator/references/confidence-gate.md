# Reference — S06 Confidence Gate & Vague-Input Policy

Loaded for S02–S08 (any stage that makes a critical inference). The spine names the three
thresholds; this file is the full rule set.

## Two-tier vague-input policy

"Vague" is allowed only when there is *some* business signal to be vague about (a Jira
description, a free-text sentence, an uploaded file). It is NOT a license to invent everything
from a bare Jira key.

- **Tier-1 gate (intake — S01):** if Jira fails AND there is no free text AND no files, you
  have ZERO business context. STOP — emit a `blocked` intake card + `[CLARIFY]` for one
  sentence. "The dataset is named `telecom_analytics`, therefore this must be a monthly
  broadband-usage view" is NOT acceptable inference.
- **Tier-2 gate (per-decision — S06):** once you have at least one business sentence, apply the
  per-decision confidence gate below.

## Per-decision thresholds

For each critical decision — target object, source table, join key, grain, filter semantics,
date logic, load pattern, destructive DML semantics:

- **`≥ 90%`** — auto-approve, record the inference with evidence, continue immediately.
- **`50–89%`** — emit one focused clarification for **that specific gap only**: 2–5 ranked
  options; pause only for that decision.
- **`< 50%`** — emit one direct, open question for **that specific gap only**; allow free text.

## Per-inference activity blocks (mandatory)

Every inference or assumption — whether or not it triggers a clarification — is emitted as its
own individual `activity` block the moment it is made. Use `type: "inference"` and set
`confidence` to a score specific to that inference (0–100). One inference = one card = one
confidence score. Never bundle multiple inferences into one card.

```activity
{"stage":"analysis","type":"inference","status":"completed","title":"Grain assumed: one row per customer per month","summary":"No explicit grain stated. Monthly rollup inferred from AC phrase 'monthly broadband usage'.","confidence":82,"evidence":["Jira AC2: 'monthly broadband usage for each customer'"],"source":"claude"}
```

Evidence must be specific: quote the Jira phrase, name the column with its table, or cite the
requirement sentence — never "based on requirements" or "from context", and never a naming
convention in place of an inspected schema.

## Rules

- Ask about **one gap at a time** — the single highest-impact unknown. Do not ask for everything
  before starting.
- If multiple gaps exist but each is independently inferable at ≥50%, auto-approve all with
  explicit notes and generate. Only block when a single critical dimension cannot clear 50%.
- **Never refuse to generate because Jira failed or input is sparse** (provided Tier-1 is
  satisfied). If grain + source table + core business rule are each ≥50%, generate with
  assumption notes.
- Do not re-ask after the user selects/approves an option. Resume from the blocked stage, not
  Intake. User feedback (clarification answers, regeneration reasons, prior turns) is binding
  context — never discard it and never re-ask what was answered.
