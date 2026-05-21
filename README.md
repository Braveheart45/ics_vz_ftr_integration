# Report Rationalizer

An agentic BI rationalization workbench for the Frontier → Verizon modernization program. Frontier/source reports (Power BI SQL) are analyzed against a Verizon reference catalog (Looker LookML, Qlik scripts) and each source receives one disposition: **Migrate**, **Consolidate**, or **Rationalize**.

The LLM is the brain. The server collects raw artefact files; the LLM performs every act of understanding — segmentation, KPI extraction, lineage tracing, semantic mapping, overlap computation, and disposition assignment. The UI renders agent output and computes nothing.

## Setup

```bash
npm install
```

Create a `.env` file at the project root:

```
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1            # or gpt-4.1-mini for ~5× cheaper runs
```

## Run

```bash
npm run dev          # Express server on :3001 + Vite UI on :5173
npm run typecheck    # tsc on both client and server projects
npm run build        # production build
```

Open `http://localhost:5173`, enter source and reference folder paths (local directories or Git URLs), click **Load reports**.

## How a run works

```
Bundle phase (≤ 1 s, no LLM)
  server/lib/rawInventory.ts          walks the supplied paths, returns RawFileItem[]
  server/lib/reportPathResolver.ts    accepts local dirs or Git URLs (cloned to a temp dir)

Analysis phase (LLM, streaming via SSE)
  Phase 1 — Segmentation
    Two parallel LLM calls (source + target) group raw paths into logical reports.
    Server validates that every artefact file is accounted for.
  Phase 2 — Reference catalog
    One LLM call per target report (parallel, concurrency 3).
    Each returns full lineage, KPIs, tables for that target.
  Phase 3 — Per-source analysis
    One LLM call per source report (parallel, concurrency 1).
    Each evaluates the source against every target and picks the best match,
    produces an auditable scoring matrix and a disposition.
  SSE events: phase, target, source, decision, source_error, complete
```

Wall-clock expectation: roughly **5 minutes** with `gpt-4.1` (concurrency 3–4), **~20 minutes** with `gpt-4.1-mini` (concurrency 1 to respect 200K TPM).

## Configuration knobs

| Env var | Default | Effect |
|---|---|---|
| `OPENAI_API_KEY` | — | Required. Without it `/api/rationalize` returns a not-configured SSE event. |
| `OPENAI_MODEL` | `gpt-4.1` | Use `gpt-4.1-mini` for cheap runs. Concurrency is hardcoded to safe values for the chosen model's TPM ceiling. |
| `PORT` | `3001` | Express port. |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed Vite origin. |

## Key files

| File | Role |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Guidance for AI/human developers working on this repo. Not loaded at runtime. |
| [SKILLS.md](SKILLS.md) | Agent capability spec. Read at server boot and appended to the SYSTEM_PROMPT. |
| [EXAMPLES.md](EXAMPLES.md) | Agent calibration examples. Same loading mechanism. |
| [server/routes/rationalize.ts](server/routes/rationalize.ts) | Three-phase analysis pipeline and SSE stream. |
| [server/routes/reports.ts](server/routes/reports.ts) | Bundle-phase endpoint. |
| [src/App.tsx](src/App.tsx) | Six-tab React workbench. |

## Decision rules

The agent applies these bands after computing KPI overlap:

| Overlap | Disposition |
|---|---|
| 100 % | Rationalize |
| 70 – 99 % | Consolidate |
| < 70 % | Migrate |

KPI scoring uses seven weighted dimensions (semantic 25 % · business logic 25 % · lineage 15 % · filter 10 % · aggregation 10 % · dimension 10 % · grain 5 %), enforced through the prompt and validated server-side against the audit invariant `bestMatchTargetId === topCandidates[0].id`.

## Costs

Per full-estate run, rough estimates:

| Model | Cost | Wall-clock | Concurrency |
|---|---|---|---|
| `gpt-4.1` | ~$5 | ~5 min | 3–4 |
| `gpt-4.1-mini` | ~$1 | ~20 min | 1–3 |

OpenAI prompt caching is engaged on the per-source call (catalog precedes source in payload), cutting roughly 40 % off input tokens after the first source.
