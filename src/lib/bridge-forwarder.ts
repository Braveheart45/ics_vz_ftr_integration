// ============================================================
// SQLForge — Shared Bridge Forwarder
// Used by /api/chat and /api/generate routes.
// ============================================================

import type { AgentRequest } from '@/lib/agent';

const BRIDGE_PORT = process.env.BRIDGE_PORT || '3001';

export async function forwardToBridge(body: AgentRequest): Promise<Response> {
  // Check bridge health first
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const healthRes = await fetch(`/health?XTransformPort=${BRIDGE_PORT}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!healthRes.ok) {
      const health = await healthRes.json().catch(() => ({}));
      return new Response(
        JSON.stringify({
          error: `Claude Bridge not ready: ${JSON.stringify(health)}`,
          hint: 'Start the Claude Bridge: cd mini-services/claude-bridge && node index.js',
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch {
    return new Response(
      JSON.stringify({
        error: 'Claude Bridge is not running',
        hint: 'Start it with: cd mini-services/claude-bridge && node index.js',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Forward to bridge and stream SSE back
  const bridgeRes = await fetch(`/chat?XTransformPort=${BRIDGE_PORT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!bridgeRes.ok) {
    const err = await bridgeRes.json().catch(() => ({ error: 'Bridge error' }));
    return new Response(JSON.stringify(err), {
      status: bridgeRes.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Pipe the SSE stream from bridge → client
  if (bridgeRes.body) {
    return new Response(bridgeRes.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  return new Response(
    JSON.stringify({ error: 'Empty response from bridge' }),
    { status: 502, headers: { 'Content-Type': 'application/json' } }
  );
}

export function isBridgeEnabled(): boolean {
  return process.env.USE_CLAUDE_BRIDGE === 'true';
}
