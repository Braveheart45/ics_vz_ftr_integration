import { NextRequest } from 'next/server';
import { runAgent, SSEStream, type AgentRequest } from '@/lib/agent';
import { forwardToBridge, isBridgeEnabled } from '@/lib/bridge-forwarder';

// ── POST /api/generate ─────────────────────────────────────
// SSE streaming endpoint — focused on SQL generation.
// Shares bridge-forwarding with /api/chat.
// ────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as AgentRequest;
    const { messages, sessionId, taskType } = body;

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
    if (isBridgeEnabled()) {
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
    console.error('[POST /api/generate] Error:', error);

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to generate SQL',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
