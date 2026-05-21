# Report Rationalizer — Agent Guidance

## Philosophy: Agentic Soul, UI Skin

This application is an **agentic BI rationalization engine**. The LLM is the brain and the sole intelligence. Every act of understanding — file segmentation, SQL/LookML/Qlik reading, KPI identification, table extraction, lineage tracing, semantic comparison, source-to-target mapping, overlap computation, and disposition assignment — is performed by the LLM from raw text. The server does not parse, score, or interpret. The UI does not compute decisions. They are I/O.

The two layers are:
1. **Agent layer** — LLM running the 8-step methodology ([server/routes/rationalize.ts](server/routes/rationalize.ts)). This is the product.
2. **UI layer** — React frontend rendering agent output ([src/App.tsx](src/App.tsx)). This is the skin.

Every number, label, badge, score, decision, and narrative line shown in the UI must come from the LLM's structured response. Nothing is computed client-side except cosmetic formatting (rounding, colour mapping, time formatting).

---

## Purpose

Report Rationalizer is an enterprise report-rationalization workbench for a Frontier→Verizon BI modernization program. Verizon is the reference estate. Frontier/source reports are analyzed against Verizon/reference reports and each source report receives one disposition (Migrate, Consolidate, or Rationalize) determined entirely by the LLM agent.

---

## Non-Negotiables

- Runtime data must come from user-supplied source and reference paths through the Express API. Paths may be local directories or Git URLs.
- Do not reintroduce server-side extractors, regex parsers, or any deterministic SQL/LookML analysis. The server collects raw text; the LLM reads it.
- Do not add static report inventories, generated JSON payloads, mock metrics, or baked source/target counts.
- Do not reintroduce `public/data`, `load.json`, generated report JSON, `npm run generate-data`, or static dashboard totals.
- Dashboard metrics and scorecards are source-centric: one row and one disposition per Frontier/source report.
- Verizon/reference reports are comparison targets, not the primary dashboard counting grain.
- Keep the product title as `Report Rationalizer`.
- Keep UI copy enterprise-facing. Do not expose provider names, model names, secret names, or implementation jargon in the UI.
- The LLM is the only entity that computes overlap percentages, decisions, KPI matches, KPI gaps, mapping patterns, and confidence scores.
- UI narrative (Rationalization Trail events, panel notes, disposition rationale) must trace back to specific LLM output fields — never invented client-side.

---

## Runtime Architecture

```
server/
  routes/reports.ts              # POST /api/load-reports — resolves local paths or Git URLs, collects raw files
  routes/rationalize.ts          # POST /api/rationalize — multi-phase analysis stream
  lib/rawInventory.ts            # walks dirs, returns RawFileItem[] (paths, names, text content, no extraction)
  lib/reportPathResolver.ts      # local-vs-Git resolution (clones to temp with --depth 1, cleans up after)
  lib/{logger,errors}.ts         # infrastructure
  middleware/{requestId,errorHandler}.ts

src/
  types.ts                       # Shared report and decision interfaces
  dataLayer.ts                   # API client — loadReportInventoryFromPaths, streamRationalizationAnalysis
  App.tsx                        # Six-tab UI shell — renders agent output
  index.css                      # AWS-console-inspired production styling

(project root)
  CLAUDE.md                      # Guidance for Claude Code / AI devs working on THIS repo (NOT loaded at runtime)
  SKILLS.md                      # LLM agent capability spec — read by server at boot, appended to the SYSTEM_PROMPT on every analysis call
  EXAMPLES.md                    # LLM agent calibration examples — same loading mechanism
```

**Two-phase runtime:**

1. **Bundle phase** (≤ 1 s) — `server/lib/rawInventory.ts` walks the resolved source and reference directories and returns `RawFileItem[]`: path, name, extension, sizeBytes, raw text content (capped at 25 KB/file, 400 files/estate, 900 KB total). No extraction, no segmentation, no interpretation.
2. **Analysis phase** (streaming, typically 30–120 s) — `server/routes/rationalize.ts` runs a multi-phase analysis flow: segment source and reference file manifests, analyze each Verizon/reference report, then analyze each Frontier/source report against the completed Verizon catalog. Results stream through SSE as `phase`, `target`, `source`, and `decision` events. The server validates that BI artefact paths were accounted for, but it does not create report facts, parse SQL, score overlap, or invent fallback decisions.

---

## LLM Analysis Methodology

The LLM follows the 8-step methodology described in full in [SKILLS.md](SKILLS.md) and calibrated against [EXAMPLES.md](EXAMPLES.md). Both documents are read from disk at server boot and appended to the system prompt — they are functional, not dev-only references. The decision sequence is non-negotiable:

1. Ingest & Segment (the LLM identifies which raw files belong to which logical report)
2. Extract Metadata (business purpose, grain, filters, joins, aggregations — directly from raw SQL/LookML text)
3. Build Lineage (report-level, KPI-level, column-level)
4. Semantic & Business Logic Analysis
5. Source-to-Target Mapping (ONLY after steps 1–4)
6. KPI Overlap Calculation (ONLY after step 5)
7. Recommendation
8. Explainability

### Decision Bands (enforced in LLM output schema)

- `overlapPercent == 100` → `Rationalize`
- `overlapPercent 70–99` → `Consolidate`
- `overlapPercent < 70` → `Migrate`

### KPI Scoring Weights (Step 6)

| Dimension | Weight |
|---|---|
| Semantic meaning / business definition | 25% |
| Business logic / formula equivalence | 25% |
| Lineage / dependency match | 15% |
| Filter match | 10% |
| Aggregation method match | 10% |
| Dimension compatibility | 10% |
| Grain match | 5% |

### Mapping Patterns (Step 5)

The LLM classifies each source→target pair as: `1:1`, `1:many`, `many:1`, `many:many`, `partial`, or `none`. This classification is mandatory before overlap is computed.

---

## Decision Rules

- Decision bands are set by the LLM after validated KPI mapping, not by client-side formula.
- Overlap % reflects validated KPI coverage, not string similarity.
- The LLM must strip vendor table prefixes before comparing tables: `fact_`, `dim_`, `vz_`, `mkt_`, `fr_`, `stg_`, `rpt_`, `ref_`, `tgt_`, `src_`, `lkp_` are artefacts, not semantic differences.
- A name match without business logic validation must receive a very low KPI score (< 0.20).

---

## Production Expectations

- Treat static report data as a defect unless it is explicitly user-supplied at runtime.
- Keep the AWS dashboard feel: restrained colours, dense information hierarchy, clear tables, predictable governance actions.
- Avoid marketing-page patterns, decorative filler, and explanatory tutorial copy.
- Keep layouts responsive at zoom and across common desktop resolutions.
- Prefer focused changes in [src/App.tsx](src/App.tsx), [src/index.css](src/index.css), `server/lib/*`, `server/routes/*`.
- Run `npm run typecheck` and `npm run build` after all changes.
- When changing the LLM system prompt, update [SKILLS.md](SKILLS.md) and [EXAMPLES.md](EXAMPLES.md) — they are concatenated into the prompt at server boot.

---

## What Not To Add

- Server-side extractors, regex parsers, or deterministic SQL/LookML/Qlik analysis. The LLM does this.
- A `server/lib/parser.ts`, `server/lib/overlap.ts`, or any structural assembly module that computes facts about the report data.
- Static demo payloads or generated report inventories.
- Target-centric dashboard scorecards.
- Hardcoded report counts, static source/target totals, or placeholder decisions.
- Client-side secret entry fields or visible provider/model/key references.
- UI narrative invented in TypeScript (e.g. "alias 50% / column 30% / table 20% scoring", "fact_/dim_ prefix clusters detected"). Trail and panel notes must read LLM output fields.
- Separate legacy UI modules unless the application is intentionally refactored.

---

## Coding Discipline (Karpathy guidelines)

These four principles apply to every code change in this repo. They bias toward caution over speed — for trivial edits, use judgment.

### 1. Think Before Coding
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
- Ask: "would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes
- Touch only what you must. Clean up only your own mess.
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.
- When your changes orphan an import/variable/function, remove it. Don't remove pre-existing dead code unless asked.
- Test: every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution
- Transform tasks into verifiable goals:
  - "Add validation" → "Write tests for invalid inputs, then make them pass"
  - "Fix the bug" → "Write a test that reproduces it, then make it pass"
  - "Refactor X" → "Ensure tests pass before and after"
- For multi-step tasks, state a brief plan with verify steps per phase.
- Strong success criteria let you loop independently; weak criteria require constant clarification.

