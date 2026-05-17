import { NextRequest } from 'next/server';
import type { AgentRequest } from '@/lib/agent';
import { forwardToBridge } from '@/lib/bridge-forwarder';
import { validateAgentRequest, validationErrorResponse } from '@/lib/target-scope';

export const maxDuration = 0;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as AgentRequest;
    const validation = validateAgentRequest({ ...body, taskType: 'github_deploy' });
    if (!validation.ok) return validationErrorResponse(validation.error || 'Invalid request');

    return forwardToBridge({ ...body, taskType: 'github_deploy' });
  } catch (error) {
    console.error('[POST /api/deploy] Error:', error);

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to deploy SQL through Claude Code',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
