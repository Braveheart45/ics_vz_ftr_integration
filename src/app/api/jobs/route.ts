import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/jobs — Return all jobs (currently returns empty array; frontend uses Zustand store)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const stage = searchParams.get('stage')
    const status = searchParams.get('status')

    // For now, the frontend uses Zustand store with mock data.
    // This endpoint is ready for future database integration.
    // TODO: Replace with Prisma queries when DB schema is defined.
    const jobs: unknown[] = []

    // Filter support (will be applied to DB query in the future)
    let filteredJobs = jobs
    if (stage) {
      filteredJobs = filteredJobs.filter((job: Record<string, unknown>) => job.currentStage === stage)
    }
    if (status) {
      filteredJobs = filteredJobs.filter((job: Record<string, unknown>) => job.status === status)
    }

    return NextResponse.json(filteredJobs)
  } catch (error) {
    console.error('[GET /api/jobs] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch jobs' },
      { status: 500 }
    )
  }
}

// POST /api/jobs — Create a new job
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { title, description, inputMode, reference, priority } = body

    // Basic validation
    if (!title || typeof title !== 'string') {
      return NextResponse.json(
        { error: 'Title is required' },
        { status: 400 }
      )
    }

    if (!inputMode || !['jira', 'stm', 'legacy_sql'].includes(inputMode)) {
      return NextResponse.json(
        { error: 'inputMode must be one of: jira, stm, legacy_sql' },
        { status: 400 }
      )
    }

    if (priority && !['low', 'medium', 'high', 'critical'].includes(priority)) {
      return NextResponse.json(
        { error: 'priority must be one of: low, medium, high, critical' },
        { status: 400 }
      )
    }

    // Generate a random ID for the mock response
    const id = `job-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

    // For now, return mock success response.
    // TODO: Replace with Prisma create when DB schema is defined.
    // await db.job.create({ data: { id, title, description, inputMode, reference, priority } })

    return NextResponse.json(
      { success: true, id },
      { status: 201 }
    )
  } catch (error) {
    console.error('[POST /api/jobs] Error:', error)

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to create job' },
      { status: 500 }
    )
  }
}
