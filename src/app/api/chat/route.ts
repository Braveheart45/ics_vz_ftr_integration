import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

// ── System Prompt ──────────────────────────────────────────────
const SYSTEM_PROMPT = `You are SQLForge, an AI-powered SQL Generation and Legacy SQL Conversion Agent for BigQuery. Your role is to:

1. Analyze user inputs (Jira stories, uploaded files, text context) to understand SQL requirements
2. Ask clarifying questions when information is incomplete or ambiguous
3. Generate BigQuery-compatible SQL based on gathered requirements
4. Explain your reasoning and design decisions

When you need more information, ask specific questions about:
- Target BigQuery project ID and dataset
- Source and target table names
- Column mappings and transformations
- Business logic and filtering criteria
- Partitioning and clustering preferences
- Load patterns (full, incremental, CDC)

Always respond in a professional but conversational tone. When you have enough information to generate SQL, include it in a fenced code block with \`\`\`sql ... \`\`\` markers.

If the task type is "legacy_sql_conversion", focus on converting legacy SQL (T-SQL, PL/SQL, etc.) to BigQuery syntax.
If the task type is "sql_generation", focus on creating new SQL based on business requirements.
If the task type is "auto_detect", infer the task type from the user's input.`

// ── Helpers ────────────────────────────────────────────────────
interface ChatRequestBody {
  messages: Array<{ role: string; content: string }>
  sessionId: string
  taskType: string
  jiraInput?: { project: string; storyNumber: string }
  contextText?: string
}

function detectSqlInResponse(content: string): boolean {
  return /```sql[\s\S]*?```/i.test(content)
}

function extractDetectedTaskType(content: string, taskType: string): string | undefined {
  // If already explicitly set (not auto_detect), no need to infer
  if (taskType !== 'auto_detect') return undefined

  const lower = content.toLowerCase()

  // Heuristic: look for conversion-related keywords
  const conversionKeywords = [
    'convert',
    'migration',
    'legacy',
    't-sql',
    'tsql',
    'pl/sql',
    'plsql',
    'transact-sql',
    'oracle',
    'sql server',
    'redshift',
    'teradata',
    'migrate',
    'rewriting',
    'rewrite',
    'porting',
    'port ',
  ]

  const generationKeywords = [
    'create table',
    'generate sql',
    'new sql',
    'build a query',
    'write a query',
    'create a query',
    'ctas',
    'create or replace',
    'insert into',
    'merge into',
  ]

  const conversionScore = conversionKeywords.filter((kw) => lower.includes(kw)).length
  const generationScore = generationKeywords.filter((kw) => lower.includes(kw)).length

  if (conversionScore > generationScore && conversionScore > 0) return 'legacy_sql_conversion'
  if (generationScore > conversionScore && generationScore > 0) return 'sql_generation'

  return undefined
}

// ── POST /api/chat ─────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body: ChatRequestBody = await request.json()
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
      systemContent += `\n\nCurrent task type is: "${taskType}". Focus on this task type.`
    } else {
      systemContent += '\n\nTask type is set to "auto_detect". Please infer the task type from the user input.'
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
          // Truncate very large context to keep token budget reasonable
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
    const content =
      response?.choices?.[0]?.message?.content ??
      'I encountered an issue generating a response. Please try again.'

    // Detect if SQL was generated
    const hasSql = detectSqlInResponse(content)
    const detectedTaskType = extractDetectedTaskType(content, taskType)

    return NextResponse.json({
      content,
      hasSql,
      detectedTaskType,
    })
  } catch (error) {
    console.error('[POST /api/chat] Error:', error)

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      )
    }

    // Handle z-ai-web-dev-sdk errors
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to generate AI response'

    return NextResponse.json(
      { error: `AI chat error: ${errorMessage}` },
      { status: 500 }
    )
  }
}
