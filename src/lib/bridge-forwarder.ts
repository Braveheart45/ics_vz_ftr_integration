// ============================================================
// SQL Curator — Claude Code CLI Bridge Forwarder
// All SQL generation goes through the local claude-bridge
// service (mini-services/claude-bridge/index.js).
// Uses direct localhost URL so this works in both local dev
// and deployed environments where bridge runs on same host.
// ============================================================

import type { AgentRequest } from '@/lib/agent';

const BRIDGE_PORT = process.env.BRIDGE_PORT || '3001';
const BRIDGE_URL = process.env.BRIDGE_URL || `http://127.0.0.1:${BRIDGE_PORT}`;
const BRIDGE_HEALTH_TIMEOUT_MS = Number.parseInt(process.env.BRIDGE_HEALTH_TIMEOUT_MS || '3000', 10);
const BRIDGE_REQUEST_TIMEOUT_MS = Number.parseInt(process.env.BRIDGE_REQUEST_TIMEOUT_MS || '1260000', 10);

// ── SSE error stream ─────────────────────────────────────────
// Returns a proper SSE response carrying an error+done event
// so processSSEStream handles cleanup correctly on the client.

function sseErrorStream(message: string, hint?: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const errorPayload = JSON.stringify({ message, hint });
      const donePayload  = JSON.stringify({ success: false });
      controller.enqueue(encoder.encode(`event: error\ndata: ${errorPayload}\n\n`));
      controller.enqueue(encoder.encode(`event: done\ndata: ${donePayload}\n\n`));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection:      'keep-alive',
    },
  });
}

// ── Main forwarder ───────────────────────────────────────────

export async function forwardToBridge(body: AgentRequest): Promise<Response> {
  // ── 1. Health-check the bridge ───────────────────────────
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BRIDGE_HEALTH_TIMEOUT_MS);

    const healthRes = await fetch(`${BRIDGE_URL}/health`, {
      signal: controller.signal,
      cache:  'no-store',
    });
    clearTimeout(timeout);

    if (!healthRes.ok) {
      const health = await healthRes.json().catch(() => ({}));
      return sseErrorStream(
        `Claude Bridge not ready: ${(health as Record<string, string>).status ?? 'unknown'}`,
        'Start the bridge: cd mini-services/claude-bridge && node index.js',
      );
    }
  } catch {
    return sseErrorStream(
      'Claude Bridge is not running. Start it with: cd mini-services/claude-bridge && node index.js',
    );
  }

  // ── 2. Forward the chat request ──────────────────────────
  try {
    // signal: AbortSignal.timeout(1_260_000) = 21 minutes
    // Gives the bridge 20 minutes (1200s timeout) plus 60s slack.
    // Without this, Node's undici fetch closes the body stream after 300s idle.
    const bridgeRes = await fetch(`${BRIDGE_URL}/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(BRIDGE_REQUEST_TIMEOUT_MS),
      cache:   'no-store',
    });

    if (!bridgeRes.ok) {
      const err = await bridgeRes.json().catch(() => ({ error: 'Bridge error' })) as Record<string, string>;
      return sseErrorStream(err.error ?? `Bridge returned HTTP ${bridgeRes.status}`);
    }

    if (bridgeRes.body) {
      // Manually pump the bridge stream so each chunk is enqueued downstream
      // as soon as it arrives. Returning `bridgeRes.body` directly works in
      // theory, but the Node runtime can buffer larger chunks before yielding
      // them to the client. Explicit pumping with a TransformStream-like
      // ReadableStream prevents that and surfaces server-sent events live.
      const sourceReader = bridgeRes.body.getReader();
      const passthrough = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const { done, value } = await sourceReader.read();
            if (done) {
              controller.close();
              return;
            }
            controller.enqueue(value);
          } catch (err) {
            controller.error(err);
          }
        },
        cancel(reason) {
          sourceReader.cancel(reason).catch(() => {});
        },
      });
      return new Response(passthrough, {
        headers: {
          'Content-Type':    'text/event-stream',
          'Cache-Control':   'no-cache, no-transform',
          Connection:        'keep-alive',
          'X-Accel-Buffering': 'no',
          'Transfer-Encoding': 'chunked',
        },
      });
    }

    return sseErrorStream('Empty response from bridge');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Bridge connection failed';
    return sseErrorStream(msg);
  }
}
