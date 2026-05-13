import { NextResponse } from 'next/server';

const USE_BRIDGE = process.env.USE_CLAUDE_BRIDGE === 'true';
const BRIDGE_PORT = process.env.BRIDGE_PORT || '3001';

function fetchWithTimeout(url: string, timeoutMs: number = 35000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout));
}

export async function GET() {
  if (!USE_BRIDGE) {
    return NextResponse.json(
      { projects: [], error: 'Claude Bridge is not enabled' },
      { status: 503 }
    );
  }

  try {
    const res = await fetchWithTimeout(`/discover/jira-projects?XTransformPort=${BRIDGE_PORT}`);

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
      { projects: [], error: error instanceof Error ? error.message : 'Failed to fetch Jira projects' },
      { status: 503 }
    );
  }
}
