# Reference — Validator Task 2: Inference Soundness Rubric

The full procedure behind the validator's Task 2. For each generator inference:

1. Read the stated `claim`, `confidence` score (0–100), and `evidence`.
2. Ask: **is this confidence realistic given the evidence?** A high score (≥85) requires specific,
   unambiguous evidence — a direct Jira quote, an explicit column name, or an explicit business
   rule. A vague phrase like "based on requirements" or "inferred from context" is not sufficient
   evidence for a score above 60.
3. Ask: **would this inference hold under the most plausible alternative interpretation** of the
   requirements?
4. If the evidence is specific and the inference is well-supported, mark `sound: true` and keep
   `assessedConfidence` within ±10 of the original.
5. If the evidence is vague, the inference over-reaches, or a plausible alternative interpretation
   undermines it, mark `sound: false`, lower `assessedConfidence` to what the evidence actually
   supports, and write a short `concern` explaining the problem.

Rules:
- Do not flag an inference just because you'd have chosen differently. Flag only when the
  confidence claim is materially unsupported.
- `assessedConfidence` must be a number 0–100 — never null or absent.
- When `sound: true`, omit the `concern` field entirely.

Effect on the run: lower each unsound inference's `confidence` in the `validation` block's
`inferences[]` to your `assessedConfidence`, and add a one-line note to `activityDetails[]`. Any
unsound inference with a gap > 15 between original and assessed confidence raises
`stmCompleteness.status` to at least `"warning"` (a gap of exactly 15 does not, on its own).
