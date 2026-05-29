# Reference — Clarification Contract

When a stage is blocked and you emit `[CLARIFY]`, include exactly this fenced block:

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
- Prefer selectable options when meaningful candidates exist; use 2–5 options.
- Allow multiple selections when multiple mappings/columns/options can validly apply.
- If no meaningful options exist, ask directly and set `allowFreeText: true` with `options: []`.
- Put investigation findings, candidates, and confidence in `details` so the Assistant pane shows
  the user exactly what you found before they answer. Keep the Assistant pane for clarification
  only; ongoing work evidence belongs in the Activity Feed.
- Ask about one gap at a time (see `confidence-gate.md`). After the user answers, resume from the
  blocked stage — do not restart at Intake.
