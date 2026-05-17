# SQL Curator

AI-powered BigQuery SQL generation and legacy SQL conversion. Powered by Claude Code CLI with native MCP connectors for Jira, BigQuery, and GitHub.

## What it does

- Reads a Jira story (or free-text requirement) and generates production-ready BigQuery SQL
- Reconciles schema inside a mandatory target `project.dataset` boundary
- Builds a Source-to-Target Map (STM) before generating SQL
- Runs a BigQuery dry-run validation before releasing the SQL
- Posts a Jira comment and transitions the issue to In Progress on success
- Streams live progress to an Activity Feed with architect-readable findings and evidence

## Prerequisites

Each user needs:

| Requirement | Details |
|---|---|
| **Claude Code CLI** | `npm install -g @anthropic-ai/claude-code` then `claude login` (Claude Pro/Max required) |
| **Bun** | [bun.sh](https://bun.sh) — used as the package manager and dev server |
| **Node.js 20+** | For the bridge service |
| **MCP servers** | Atlassian Rovo (Jira), Google Cloud BigQuery — configured in `~/.claude.json` |

## Quick start

```bash
# 1. Install dependencies
bun install

# 2. Copy environment file
cp .env.example .env

# 3. Terminal 1 — start the Claude bridge (port 3001)
npm run bridge

# 4. Terminal 2 — start the UI (port 3000)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## LAN access for colleagues

```bash
# Bind the UI to all network interfaces so colleagues on the same network can connect
npm run dev:public
```

Share `http://<your-machine-IP>:3000` with colleagues. Each person must have Claude Code CLI installed and authenticated with their own account.

## Environment variables

See `.env.example` for all available options.

## Architecture

```
Browser → Next.js (port 3000) → /api/chat → claude-bridge (port 3001) → Claude Code CLI
                                                      ↕
                                          MCP: Jira · BigQuery · GitHub
```

The UI is a presentation shell. All SQL generation, schema reconciliation, validation, and Jira updates happen inside Claude Code via native MCP connectors.

## Key files

| Path | Purpose |
|---|---|
| `mini-services/claude-bridge/index.js` | HTTP/SSE bridge — spawns Claude Code CLI |
| `skills/sqlforge/SKILL.md` | Runtime operating contract loaded into every Claude session |
| `src/stores/use-app-store.ts` | Zustand state for pipeline, activity feed, clarification |
| `src/lib/sse-client.ts` | SSE stream parser and event dispatcher |
| `AGENTS.md` | Coding-agent instructions for this repo |
| `RUNBOOK.md` | Operational runbook and architecture reference |
