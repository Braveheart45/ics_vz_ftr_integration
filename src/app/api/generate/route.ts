import { NextRequest } from 'next/server';
import type { AgentRequest } from '@/lib/agent';
import { forwardToBridge } from '@/lib/bridge-forwarder';
import { validateAgentRequest, validationErrorResponse } from '@/lib/target-scope';

// ── POST /api/generate ─────────────────────────────────────
// SQL regeneration endpoint — same bridge path as /api/chat.
// ────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as AgentRequest;
    const validation = validateAgentRequest(body);
    if (!validation.ok) return validationErrorResponse(validation.error || 'Invalid request');

    return forwardToBridge(body);
  } catch (error) {
    console.error('[POST /api/generate] Error:', error);

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to generate SQL',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
