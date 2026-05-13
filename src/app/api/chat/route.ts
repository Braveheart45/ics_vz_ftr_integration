import { NextRequest } from 'next/server';
import { runAgent, SSEStream, type AgentRequest } from '@/lib/agent';

// ── Configuration ─────────────────────────────────────────────
// Set USE_CLAUDE_BRIDGE=true to forward requests to the local
// Claude Code CLI bridge (claude-bridge.js) on port 3001.
// Falls back to the built-in agent (z-ai-web-dev-sdk) when disabled.
// ────────────────────────────────────────────────────────────────

const USE_BRIDGE = process.env.USE_CLAUDE_BRIDGE === 'true';
const BRIDGE_PORT = process.env.BRIDGE_PORT || '3001';

// ── Bridge Forwarder ───────────────────────────────────────────
// Forwards the request to claude-bridge.js and pipes the SSE
// stream back to the Next.js client.
// ────────────────────────────────────────────────────────────────

async function forwardToBridge(body: AgentRequest): Promise<Response> {
  // Check bridge health first
  try {
    const healthRes = await fetch(`/health?XTransformPort=${BRIDGE_PORT}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!healthRes.ok) {
      const health = await healthRes.json().catch(() => ({}));
      return new Response(
        JSON.stringify({
          error: `Claude Bridge not ready: ${JSON.stringify(health)}`,
          hint: 'Run: node claude-bridge.js',
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch {
    return new Response(
      JSON.stringify({
        error: 'Claude Bridge is not running',
        hint: 'Start it with: node claude-bridge.js',
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

// ── POST /api/chat ─────────────────────────────────────────
// SSE streaming endpoint.
//   - USE_CLAUDE_BRIDGE=true  → forwards to claude-bridge.js
//   - USE_CLAUDE_BRIDGE=false → uses built-in agent (z-ai-web-dev-sdk)
// ────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as AgentRequest;
    const { messages, sessionId, taskType } = body;

    // Validate required fields
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'messages array is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!sessionId || typeof sessionId !== 'string') {
      return new Response(
        JSON.stringify({ error: 'sessionId is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!taskType || typeof taskType !== 'string') {
      return new Response(
        JSON.stringify({ error: 'taskType is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ── Bridge Mode ────────────────────────────────────────
    if (USE_BRIDGE) {
      return forwardToBridge(body);
    }

    // ── Direct Agent Mode (fallback) ───────────────────────
    const stream = new ReadableStream({
      async start(controller) {
        const sse = new SSEStream(controller);
        await runAgent(body, sse);
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
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
