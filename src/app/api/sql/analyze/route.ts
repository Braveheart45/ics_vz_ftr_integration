import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

interface AnalysisResponse {
  requirements: Array<{ description: string; type: string; confidence: number }>
  tables: Array<{ name: string; alias?: string; type: 'primary' | 'joined' | 'subquery' }>
  columns: Array<{ name: string; expression: string; sourceTable?: string }>
  complexity: 'simple' | 'moderate' | 'complex' | 'very_complex'
  operations: string[]
  estimatedCost: 'low' | 'medium' | 'high'
}

// POST /api/sql/analyze — Analyze SQL to extract requirements, tables, columns, and complexity
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { sql } = body

    if (!sql || typeof sql !== 'string') {
      return NextResponse.json(
        { error: 'SQL string is required' },
        { status: 400 }
      )
    }

    if (sql.trim().length === 0) {
      return NextResponse.json(
        { error: 'SQL string cannot be empty' },
        { status: 400 }
      )
    }

    const normalizedSql = sql.trim()

    // ---- Extract table names from FROM/JOIN clauses ----
    const tables: AnalysisResponse['tables'] = []

    // FROM clause extraction
    const fromPattern = /FROM\s+`?(\w+(?:\.\w+(?:\.\w+)?)?)`?(?:\s+(?:AS\s+)?(\w+))?/gi
    let match: RegExpExecArray | null
    while ((match = fromPattern.exec(normalizedSql)) !== null) {
      const tableName = match[1]
      const alias = match[2]
      if (tableName && !tables.some((t) => t.name === tableName)) {
        tables.push({ name: tableName, alias: alias || undefined, type: 'primary' })
      }
    }

    // JOIN clause extraction
    const joinPattern = /(?:LEFT|RIGHT|INNER|OUTER|FULL|CROSS|INNER)?\s*JOIN\s+`?(\w+(?:\.\w+(?:\.\w+)?)?)`?(?:\s+(?:AS\s+)?(\w+))?/gi
    while ((match = joinPattern.exec(normalizedSql)) !== null) {
      const tableName = match[1]
      const alias = match[2]
      if (tableName && !tables.some((t) => t.name === tableName)) {
        tables.push({ name: tableName, alias: alias || undefined, type: 'joined' })
      }
    }

    // Subquery detection (simplified)
    const subqueryPattern = /FROM\s*\(\s*SELECT\b/gi
    const subqueryCount = (normalizedSql.match(subqueryPattern) || []).length
    if (subqueryCount > 0) {
      for (let i = 0; i < subqueryCount; i++) {
        const subqueryAlias = normalizedSql.match(new RegExp(`FROM\\s*\\(\\s*SELECT.*?\\)\\s+(?:AS\\s+)?(\\w+)`, 'is'))
        if (subqueryAlias) {
          tables.push({ name: `subquery_${i + 1}`, alias: subqueryAlias[1], type: 'subquery' })
        } else {
          tables.push({ name: `subquery_${i + 1}`, type: 'subquery' })
        }
      }
    }

    // ---- Extract column names from SELECT clause ----
    const columns: AnalysisResponse['columns'] = []

    // Extract SELECT columns (simplified — handles basic cases)
    // First, find the SELECT ... FROM block
    const selectFromMatch = normalizedSql.match(/SELECT\s+(.*?)\s+FROM\s/i)
    if (selectFromMatch) {
      const selectClause = selectFromMatch[1]
      // Split by comma, but be careful with nested functions
      const colParts = splitTopLevel(selectClause, ',')

      for (const colPart of colParts) {
        const trimmed = colPart.trim()
        if (!trimmed || trimmed === '*') continue

        // Check for alias: expression AS alias
        const aliasMatch = trimmed.match(/(?:AS\s+)?(\w+)\s*$/i)
        const funcMatch = trimmed.match(/(\w+)\s*\(/i)

        let columnName: string
        let expression: string = trimmed

        if (aliasMatch) {
          columnName = aliasMatch[1].toUpperCase()
        } else if (funcMatch) {
          columnName = `${funcMatch[1].toUpperCase()}_RESULT`
        } else {
          // Remove table prefix if present (table.column)
          const parts = trimmed.split('.')
          columnName = parts[parts.length - 1].replace(/`/g, '').toUpperCase()
        }

        // Try to determine source table
        let sourceTable: string | undefined
        const tableRefMatch = trimmed.match(/`?(\w+)`?\.`?(\w+)`?/i)
        if (tableRefMatch && tables.some((t) => t.name === tableRefMatch[1] || t.alias === tableRefMatch[1])) {
          sourceTable = tableRefMatch[1]
        }

        columns.push({ name: columnName, expression: trimmed, sourceTable })
      }
    }

    // ---- Detect SQL operations ----
    const operations: string[] = []
    const operationPatterns: Array<{ pattern: RegExp; name: string }> = [
      { pattern: /\bGROUP\s+BY\b/i, name: 'GROUP BY (Aggregation)' },
      { pattern: /\bHAVING\b/i, name: 'HAVING (Post-aggregation Filter)' },
      { pattern: /\bORDER\s+BY\b/i, name: 'ORDER BY (Sorting)' },
      { pattern: /\bLIMIT\b/i, name: 'LIMIT (Row Restriction)' },
      { pattern: /\bUNION\b/i, name: 'UNION (Set Operation)' },
      { pattern: /\bINTERSECT\b/i, name: 'INTERSECT (Set Operation)' },
      { pattern: /\bEXCEPT\b/i, name: 'EXCEPT (Set Operation)' },
      { pattern: /\bWINDOW\b/i, name: 'WINDOW (Named Window)' },
      { pattern: /\bOVER\s*\(/i, name: 'Window Function' },
      { pattern: /\bCASE\b/i, name: 'Conditional Logic (CASE)' },
      { pattern: /\bJOIN\b/i, name: 'Table Join' },
      { pattern: /\bLEFT\s+JOIN\b/i, name: 'Left Join' },
      { pattern: /\bRIGHT\s+JOIN\b/i, name: 'Right Join' },
      { pattern: /\bFULL\s+(?:OUTER\s+)?JOIN\b/i, name: 'Full Outer Join' },
      { pattern: /\bCROSS\s+JOIN\b/i, name: 'Cross Join' },
      { pattern: /\bSUBSTRING\b|\bREGEXP_CONTAINS\b|\bSPLIT\b/i, name: 'String Manipulation' },
      { pattern: /\bCAST\b|\bSAFE_CAST\b|\bPARSE_\w+\b/i, name: 'Type Casting' },
      { pattern: /\bARRAY_AGG\b|\bSTRUCT\b|\bUNNEST\b/i, name: 'Array/Struct Operation' },
      { pattern: /\bCOUNT\s*\(/i, name: 'COUNT Aggregation' },
      { pattern: /\bSUM\s*\(/i, name: 'SUM Aggregation' },
      { pattern: /\bAVG\s*\(/i, name: 'AVG Aggregation' },
      { pattern: /\bMAX\s*\(/i, name: 'MAX Aggregation' },
      { pattern: /\bMIN\s*\(/i, name: 'MIN Aggregation' },
      { pattern: /\bDISTINCT\b/i, name: 'DISTINCT Deduplication' },
      { pattern: /\bCOALESCE\b|\bIFNULL\b/i, name: 'Null Handling' },
      { pattern: /\bDATE_DIFF\b|\bTIMESTAMP_DIFF\b|\bDATE_ADD\b/i, name: 'Date/Time Calculation' },
      { pattern: /\bPARTITION\s+BY\b/i, name: 'Window Partitioning' },
      { pattern: /\bQUALIFY\b/i, name: 'QUALIFY Filter' },
      { pattern: /\bWITH\s+\w+\s+AS\b/i, name: 'CTE (Common Table Expression)' },
    ]

    for (const { pattern, name } of operationPatterns) {
      if (pattern.test(normalizedSql)) {
        operations.push(name)
      }
    }

    // ---- Determine complexity ----
    const complexityScore = calculateComplexity(normalizedSql, tables.length, columns.length, operations.length, subqueryCount)
    let complexity: AnalysisResponse['complexity']
    if (complexityScore <= 3) {
      complexity = 'simple'
    } else if (complexityScore <= 7) {
      complexity = 'moderate'
    } else if (complexityScore <= 12) {
      complexity = 'complex'
    } else {
      complexity = 'very_complex'
    }

    // ---- Extract requirements (inferred from SQL analysis) ----
    const requirements: AnalysisResponse['requirements'] = []

    if (tables.length > 0) {
      requirements.push({
        description: `Query accesses ${tables.length} table(s): ${tables.map((t) => t.name).join(', ')}`,
        type: 'data_access',
        confidence: 0.95,
      })
    }

    if (operations.some((op) => op.includes('Aggregation'))) {
      requirements.push({
        description: 'Aggregation operations detected — output will be summarized/grouped data.',
        type: 'aggregation',
        confidence: 0.9,
      })
    }

    if (operations.some((op) => op.includes('Join'))) {
      requirements.push({
        description: 'Multi-table join logic required — ensure join conditions are correct.',
        type: 'join',
        confidence: 0.9,
      })
    }

    if (operations.some((op) => op.includes('Window Function') || op.includes('Window Partitioning'))) {
      requirements.push({
        description: 'Window functions used — verify PARTITION BY and ORDER BY within OVER() clauses.',
        type: 'window_function',
        confidence: 0.85,
      })
    }

    if (operations.some((op) => op.includes('Conditional Logic'))) {
      requirements.push({
        description: 'Conditional logic (CASE) present — verify all branches are covered.',
        type: 'conditional_logic',
        confidence: 0.85,
      })
    }

    if (operations.some((op) => op.includes('Null Handling'))) {
      requirements.push({
        description: 'Null handling (COALESCE/IFNULL) detected.',
        type: 'null_handling',
        confidence: 0.9,
      })
    }

    if (operations.some((op) => op.includes('Type Casting'))) {
      requirements.push({
        description: 'Type casting detected — ensure target types match expected schema.',
        type: 'type_conversion',
        confidence: 0.9,
      })
    }

    if (operations.some((op) => op.includes('CTE'))) {
      requirements.push({
        description: 'CTE(s) used for query organization — verify each CTE produces expected intermediate results.',
        type: 'query_structure',
        confidence: 0.85,
      })
    }

    if (columns.length > 0) {
      requirements.push({
        description: `Query selects ${columns.length} column(s)/expression(s).`,
        type: 'output_schema',
        confidence: 0.95,
      })
    }

    if (normalizedSql.includes('QUALIFY')) {
      requirements.push({
        description: 'QUALIFY clause detected (BigQuery-specific) — filters on window function results.',
        type: 'bigquery_specific',
        confidence: 0.9,
      })
    }

    if (!operations.some((op) => op.includes('Row Restriction')) && tables.length > 0) {
      requirements.push({
        description: 'No LIMIT clause — query may return large result sets.',
        type: 'performance',
        confidence: 0.7,
      })
    }

    // ---- Estimated cost ----
    const estimatedCost: AnalysisResponse['estimatedCost'] =
      complexity === 'simple' || complexity === 'moderate'
        ? operations.some((op) => op.includes('Array/Struct')) ? 'medium' : 'low'
        : operations.some((op) => op.includes('Cross Join') || op.includes('Full Outer Join'))
          ? 'high'
          : 'medium'

    return NextResponse.json({
      requirements,
      tables,
      columns,
      complexity,
      operations: [...new Set(operations)], // deduplicate
      estimatedCost,
    })
  } catch (error) {
    console.error('[POST /api/sql/analyze] Error:', error)

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to analyze SQL' },
      { status: 500 }
    )
  }
}

// ---- Helper functions ----

/**
 * Split a string by delimiter, respecting parentheses nesting.
 */
function splitTopLevel(input: string, delimiter: string): string[] {
  const result: string[] = []
  let depth = 0
  let current = ''

  for (const ch of input) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === delimiter && depth === 0) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }

  if (current.trim()) {
    result.push(current.trim())
  }

  return result
}

/**
 * Calculate a complexity score based on various SQL characteristics.
 */
function calculateComplexity(
  sql: string,
  tableCount: number,
  columnCount: number,
  operationCount: number,
  subqueryCount: number
): number {
  let score = 0

  // Base complexity from tables
  score += tableCount * 1.5

  // Columns contribute to complexity
  score += columnCount * 0.3

  // Operations add complexity
  score += operationCount * 0.8

  // Subqueries are complex
  score += subqueryCount * 2

  // SQL length indicates complexity
  if (sql.length > 500) score += 1
  if (sql.length > 1000) score += 1
  if (sql.length > 2000) score += 2

  // Nested parentheses depth
  let maxDepth = 0
  let currentDepth = 0
  for (const ch of sql) {
    if (ch === '(') {
      currentDepth++
      if (currentDepth > maxDepth) maxDepth = currentDepth
    }
    if (ch === ')') currentDepth--
  }
  score += maxDepth * 0.5

  // CTE count
  const cteMatches = sql.match(/\bWITH\s+\w+\s+AS\b/gi)
  if (cteMatches) score += cteMatches.length * 1.5

  return Math.round(score)
}
