import { NextRequest } from 'next/server';
import type { AgentRequest } from '@/lib/agent';
import { forwardToBridge } from '@/lib/bridge-forwarder';
import { validateAgentRequest, validationErrorResponse } from '@/lib/target-scope';

// Disable route timeout — SSE streams can run for 20+ minutes
// (only applies on Vercel; harmless in local dev)
export const maxDuration = 0;

// ── POST /api/chat ─────────────────────────────────────────
// Forwards the request to the Claude Code CLI bridge which
// handles all SQL generation via Claude's MCP tools.
// ────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as AgentRequest;
    const validation = validateAgentRequest(body);
    if (!validation.ok) return validationErrorResponse(validation.error || 'Invalid request');

    return forwardToBridge(body);
  } catch (error) {
    console.error('[POST /api/chat] Error:', error);

    if (error instanceof SyntaxError) {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to process request',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
