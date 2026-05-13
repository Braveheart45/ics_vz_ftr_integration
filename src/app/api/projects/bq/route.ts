import { NextResponse } from 'next/server';

const USE_BRIDGE = process.env.USE_CLAUDE_BRIDGE === 'true';
const BRIDGE_PORT = process.env.BRIDGE_PORT || '3001';

export async function GET() {
  if (!USE_BRIDGE) {
    return NextResponse.json(
      { projects: [], error: 'Claude Bridge is not enabled' },
      { status: 503 }
    );
  }

  try {
    const res = await fetch(`/discover/bq-projects?XTransformPort=${BRIDGE_PORT}`, {
      signal: AbortSignal.timeout(35000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Bridge request failed' }));
      return NextResponse.json(
        { projects: [], error: err.error || `Bridge returned ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { projects: [], error: error instanceof Error ? error.message : 'Failed to fetch BQ projects' },
      { status: 503 }
    );
  }
}
