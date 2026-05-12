import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

// ── System Prompt (generate variant) ───────────────────────────
const SYSTEM_PROMPT = `You are SQLForge, an AI-powered SQL Generation and Legacy SQL Conversion Agent for BigQuery. Your role is to:

1. Analyze user inputs (Jira stories, uploaded files, text context) to understand SQL requirements
2. Generate BigQuery-compatible SQL based on gathered requirements
3. Explain your reasoning and design decisions

When you need more information, ask specific questions about:
- Target BigQuery project ID and dataset
- Source and target table names
- Column mappings and transformations
- Business logic and filtering criteria
- Partitioning and clustering preferences
- Load patterns (full, incremental, CDC)

Always respond in a professional but conversational tone.

IMPORTANT: Based on all the information gathered, generate the final BigQuery SQL now. Include only the SQL in a \`\`\`sql code block, with brief explanation before and after.

If the task type is "legacy_sql_conversion", focus on converting legacy SQL (T-SQL, PL/SQL, etc.) to BigQuery syntax.
If the task type is "sql_generation", focus on creating new SQL based on business requirements.
If the task type is "auto_detect", infer the task type from the user's input.`

// ── Helpers ────────────────────────────────────────────────────
interface GenerateRequestBody {
  messages: Array<{ role: string; content: string }>
  sessionId: string
  taskType: string
  jiraInput?: { project: string; storyNumber: string }
  contextText?: string
}

/**
 * Extracts the first ```sql ... ``` block from the response content.
 * Returns the raw SQL (without the fenced markers) or null if not found.
 */
function extractSqlBlock(content: string): string | null {
  const match = content.match(/```sql\s*\n([\s\S]*?)```/i)
  return match ? match[1].trim() : null
}

/**
 * Splits the response into explanation-before and explanation-after sections
 * around the SQL code block.
 */
function extractExplanationAndSql(content: string): {
  sql: string
  explanation: string
} {
  const sqlBlock = extractSqlBlock(content)

  if (sqlBlock) {
    // Split around the SQL block
    const parts = content.split(/```sql[\s\S]*?```/i)
    const before = (parts[0] || '').trim()
    const after = (parts[1] || '').trim()
    const explanation = [before, after].filter(Boolean).join('\n\n')

    return { sql: sqlBlock, explanation }
  }

  // No SQL block found — return the whole content as explanation with empty SQL
  return {
    sql: '',
    explanation: content,
  }
}

// ── POST /api/generate ─────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body: GenerateRequestBody = await request.json()
    const { messages, sessionId, taskType, jiraInput, contextText } = body

    // Basic validation
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'messages array is required and must not be empty' },
        { status: 400 }
      )
    }

    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 }
      )
    }

    if (!taskType || typeof taskType !== 'string') {
      return NextResponse.json(
        { error: 'taskType is required' },
        { status: 400 }
      )
    }

    // Build the system prompt with task type context
    let systemContent = SYSTEM_PROMPT
    if (taskType && taskType !== 'auto_detect') {
      systemContent += `\n\nCurrent task type is: "${taskType}". Focus on generating BigQuery SQL for this task type.`
    } else {
      systemContent +=
        '\n\nTask type is set to "auto_detect". Infer the task type from the conversation and generate the appropriate SQL.'
    }

    // Enrich the first user message with Jira / context metadata
    const enrichedMessages = messages.map((msg, index) => {
      if (msg.role !== 'user') return msg

      let enriched = msg.content

      // Only prepend context to the first user message
      if (index === messages.findIndex((m) => m.role === 'user')) {
        const contextParts: string[] = []

        if (jiraInput) {
          contextParts.push(
            `[Jira Context — Project: ${jiraInput.project}, Story: ${jiraInput.storyNumber}]`
          )
        }

        if (contextText) {
          const truncated =
            contextText.length > 8000
              ? contextText.slice(0, 8000) + '\n\n[... context truncated for brevity ...]'
              : contextText
          contextParts.push(`[Additional Context]\n${truncated}`)
        }

        if (contextParts.length > 0) {
          enriched = `${contextParts.join('\n\n')}\n\n---\n\n${enriched}`
        }
      }

      return { role: msg.role, content: enriched }
    })

    // Build the full messages array for the LLM
    const llmMessages = [
      { role: 'system' as const, content: systemContent },
      ...enrichedMessages.map((m) => ({
        role: (m.role as 'user' | 'assistant'),
        content: m.content,
      })),
    ]

    // Call the LLM via z-ai-web-dev-sdk
    const zai = await ZAI.create()
    const response = await zai.chat.completions.create({
      messages: llmMessages,
      thinking: { type: 'disabled' },
    })

    // Extract the assistant's reply
    const rawContent =
      response?.choices?.[0]?.message?.content ??
      'I encountered an issue generating SQL. Please try again.'

    // Parse SQL and explanation from the response
    const { sql, explanation } = extractExplanationAndSql(rawContent)

    return NextResponse.json({
      sql,
      explanation,
      rawContent,
    })
  } catch (error) {
    console.error('[POST /api/generate] Error:', error)

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      )
    }

    const errorMessage =
      error instanceof Error ? error.message : 'Failed to generate SQL'

    return NextResponse.json(
      { error: `SQL generation error: ${errorMessage}` },
      { status: 500 }
    )
  }
}
