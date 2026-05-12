import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

interface ValidationResponse {
  valid: boolean
  errors: Array<{ code: string; message: string; severity: string; suggestion?: string }>
  warnings: Array<{ code: string; message: string; severity: string; suggestion?: string }>
}

// POST /api/sql/validate — Validate BigQuery SQL using basic regex checks
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

    const errors: ValidationResponse['errors'] = []
    const warnings: ValidationResponse['warnings'] = []

    const normalizedSql = sql.trim().toUpperCase()

    // ---- Basic structure checks ----

    // Check for SELECT keyword
    if (!normalizedSql.includes('SELECT')) {
      errors.push({
        code: 'MISSING_SELECT',
        message: 'SQL must contain a SELECT statement.',
        severity: 'error',
        suggestion: 'Add a SELECT clause to specify the columns you want to retrieve.',
      })
    }

    // Check for FROM keyword (unless it's a SELECT without FROM like SELECT 1)
    if (!normalizedSql.includes('FROM') && normalizedSql.includes('SELECT')) {
      // Allow queries like SELECT 1 or SELECT CURRENT_TIMESTAMP
      const afterSelect = normalizedSql.replace(/^.*?SELECT\s*/i, '').trim()
      if (!/^\d+$/.test(afterSelect) && !afterSelect.includes('CURRENT_') && !afterSelect.includes('NOW')) {
        warnings.push({
          code: 'MISSING_FROM',
          message: 'No FROM clause detected. Ensure this is intentional.',
          severity: 'warning',
          suggestion: 'If querying a table or view, add a FROM clause.',
        })
      }
    }

    // ---- BigQuery anti-pattern checks ----

    // SELECT * check
    const selectStarPattern = /SELECT\s+\*/i
    if (selectStarPattern.test(sql)) {
      warnings.push({
        code: 'SELECT_STAR',
        message: 'SELECT * is used. This can cause performance issues and break when schemas change.',
        severity: 'warning',
        suggestion: 'Explicitly list only the columns you need.',
      })
    }

    // Missing WHERE clause (for non-trivial queries)
    const hasFrom = /FROM\s+\S+/i.test(sql)
    const hasWhere = /WHERE\s+/i.test(sql)
    const hasGroupBy = /GROUP\s+BY/i.test(sql)
    const hasHaving = /HAVING\s+/i.test(sql)
    const isSubquery = /^\s*\(?\s*SELECT/i.test(sql)

    if (hasFrom && !hasWhere && !hasGroupBy && !isSubquery) {
      // Check if it looks like a full table scan (more than a simple query)
      const lineCount = sql.split('\n').length
      if (lineCount > 2) {
        warnings.push({
          code: 'MISSING_WHERE',
          message: 'No WHERE clause detected. This may result in a full table scan.',
          severity: 'warning',
          suggestion: 'Add a WHERE clause to filter data and reduce query cost.',
        })
      }
    }

    // Check for implicit type casting issues (common in BigQuery migrations)
    const implicitCastPattern = /WHERE\s+\w+\s*=\s*['"]?\d+['"]?/i
    if (implicitCastPattern.test(sql)) {
      warnings.push({
        code: 'IMPLICIT_CAST',
        message: 'Possible implicit type casting in WHERE clause. String literals compared with numeric values.',
        severity: 'info',
        suggestion: 'Use explicit CAST() or SAFE_CAST() for type conversions in BigQuery.',
      })
    }

    // Check for LIMIT clause on large queries
    if (hasFrom && !hasGroupBy && !normalizedSql.includes('LIMIT') && !normalizedSql.includes('CREATE') && !normalizedSql.includes('INSERT')) {
      // Only warn for SELECT queries without GROUP BY or LIMIT
      if (lineCount > 3 || sql.length > 200) {
        warnings.push({
          code: 'MISSING_LIMIT',
          message: 'No LIMIT clause detected on a potentially large result set.',
          severity: 'info',
          suggestion: 'Consider adding a LIMIT clause during development to control costs.',
        })
      }
    }

    // Check for legacy/unsupported syntax patterns
    const legacyPatterns = [
      { pattern: /IFNULL\s*\(/i, code: 'LEGACY_IFNULL', message: 'Consider using COALESCE instead of IFNULL for better readability.', severity: 'info' as const },
      { pattern: /DATE_ADD\s*\(/i, code: 'LEGACY_DATE_ADD', message: 'Consider using DATE_ADD with interval syntax or TIMESTAMP_ADD for clarity.', severity: 'info' as const },
      { pattern: /ROW_NUMBER\s*\(\s*\)\s*OVER/i, code: 'CHECK_PARTITION', message: 'Window function detected. Ensure PARTITION BY is specified for correct results.', severity: 'info' as const },
    ]

    for (const { pattern, code, message, severity } of legacyPatterns) {
      if (pattern.test(sql)) {
        warnings.push({ code, message, severity })
      }
    }

    // Check for unquoted reserved words used as identifiers
    const reservedWords = ['ORDER', 'GROUP', 'SELECT', 'FROM', 'WHERE', 'JOIN', 'ON', 'AND', 'OR', 'NOT', 'NULL', 'AS']
    // This is a simplified check — in production, use a proper SQL parser
    const unquotedReserved = /(?:FROM|JOIN)\s+(order|group|select|from|where|join|on|and|or|not)\b(?!\s*\()/i
    if (unquotedReserved.test(sql)) {
      errors.push({
        code: 'UNQUOTED_RESERVED',
        message: 'A SQL reserved word appears to be used as an unquoted identifier.',
        severity: 'error',
        suggestion: 'Wrap reserved words in backticks, e.g., `order` or `group`.',
      })
    }

    // Check for balanced parentheses
    let parenCount = 0
    let inString = false
    let stringChar = ''
    for (let i = 0; i < sql.length; i++) {
      const ch = sql[i]
      if (inString) {
        if (ch === stringChar && sql[i - 1] !== '\\') {
          inString = false
        }
      } else {
        if (ch === "'" || ch === '"') {
          inString = true
          stringChar = ch
        } else if (ch === '(') {
          parenCount++
        } else if (ch === ')') {
          parenCount--
          if (parenCount < 0) {
            errors.push({
              code: 'UNBALANCED_PARENS',
              message: 'Unbalanced parentheses detected — extra closing parenthesis.',
              severity: 'error',
              suggestion: 'Check for missing or extra parentheses in your SQL.',
            })
            break
          }
        }
      }
    }
    if (parenCount > 0) {
      errors.push({
        code: 'UNBALANCED_PARENS',
        message: 'Unbalanced parentheses detected — missing closing parenthesis.',
        severity: 'error',
        suggestion: 'Check for missing closing parentheses in your SQL.',
      })
    }

    const isValid = errors.length === 0

    return NextResponse.json({
      valid: isValid,
      errors,
      warnings,
    })
  } catch (error) {
    console.error('[POST /api/sql/validate] Error:', error)

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to validate SQL' },
      { status: 500 }
    )
  }
}
