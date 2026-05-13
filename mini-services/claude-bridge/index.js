#!/usr/bin/env node
// ============================================================
// claude-bridge.js — Claude Code CLI → HTTP/SSE Bridge
// ============================================================
//
// A local HTTP proxy that spawns `claude` CLI with
// --output-format stream-json, converts JSON-Lines output
// to Server-Sent Events compatible with the SQLForge frontend.
//
// Architecture:
//   Browser → Next.js /api/chat → claude-bridge (port 3001)
//                                      ↓
//                               claude CLI (with MCP tools)
//                                      ↓
//                               Jira / BigQuery / GitHub
//
// Usage:
//   bun run dev          # Start with hot-reload (port 3001)
//   node index.js        # Start directly
//   BRIDGE_PORT=4001 bun run dev   # Custom port
//
// The claude CLI MUST have MCP servers configured in
// ~/.claude.json for this bridge to access Jira, BigQuery,
// and GitHub tools.
// ============================================================

'use strict';

const http = require('http');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ── Configuration ─────────────────────────────────────────────

const PORT = parseInt(process.env.BRIDGE_PORT || '3001', 10);
const CLAUDE_MAX_TURNS = parseInt(process.env.CLAUDE_MAX_TURNS || '15', 10);
const CLAUDE_TIMEOUT_MS = parseInt(process.env.CLAUDE_TIMEOUT_MS || '180000', 10);
const MAX_HISTORY_MESSAGES = parseInt(process.env.MAX_HISTORY_MESSAGES || '20', 10);
const MAX_CONCURRENT = parseInt(process.env.CLAUDE_MAX_CONCURRENT || '3', 10);

// ── In-memory session store ───────────────────────────────────
// Maps sessionId → { messages: [...], conversationId: string | null, lastActivity: Date }

const sessions = new Map();

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      messages: [],
      conversationId: null, // Claude's --resume conversation ID
      lastActivity: Date.now(),
    });
  }
  return sessions.get(sessionId);
}

function trimSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session && session.messages.length > MAX_HISTORY_MESSAGES) {
    session.messages = session.messages.slice(-MAX_HISTORY_MESSAGES);
  }
}

// Cleanup stale sessions every 5 minutes (30 min idle TTL)
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > 30 * 60 * 1000) {
      console.log(`  [cleanup] Session ${id.slice(0, 8)} expired`);
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

// ── Active request tracking (for concurrency limits) ──────────

let activeRequests = 0;

// ── Claude CLI availability check ─────────────────────────────

let claudePath = null;

function findClaude() {
  if (claudePath) return claudePath;

  const candidates = ['claude', 'claude-code'];
  for (const cmd of candidates) {
    try {
      const result = spawnSync(cmd, ['--version'], {
        timeout: 5000,
        shell: true,
      });
      if (result.status === 0) {
        claudePath = cmd;
        console.log(`  [init] Found Claude CLI: ${cmd}`);
        return cmd;
      }
    } catch { /* not found */ }
  }

  // Try common paths
  const paths = [
    path.join(os.homedir(), '.claude', 'local', 'claude'),
    '/usr/local/bin/claude',
    path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
    path.join(os.homedir(), 'node_modules', '.bin', 'claude'),
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      claudePath = p;
      console.log(`  [init] Found Claude CLI at: ${p}`);
      return p;
    }
  }

  return null;
}

// ── Prompt Builder ────────────────────────────────────────────

function buildPrompt(request) {
  const { messages, taskType, jiraInput, bqProjectId, contextText } = request;
  const parts = [];

  // System identity
  parts.push('You are SQLForge, an AI-powered SQL Generation and Legacy SQL Conversion Agent for Google BigQuery.');

  // Task type instruction
  const taskInstructions = {
    sql_generation: '## Task Type\nGenerate NEW BigQuery-compatible SQL based on the requirements.',
    legacy_sql_conversion: '## Task Type\nConvert legacy SQL (T-SQL, PL/SQL, Redshift, Teradata) to BigQuery syntax.',
    auto_detect: '## Task Type\nInfer whether to generate new SQL or convert legacy SQL. Analyze the input carefully.',
  };

  parts.push(taskInstructions[taskType] || taskInstructions.auto_detect);

  // BQ project
  if (bqProjectId) {
    parts.push(`## Target BigQuery Project\n\`${bqProjectId}\`\n\nUse your MCP BigQuery tool to explore schemas in this project before writing SQL.`);
  }

  // Jira context
  if (jiraInput?.project && jiraInput?.storyNumber) {
    parts.push(`## Jira Story\nFetch and analyze Jira story **${jiraInput.project}-${jiraInput.storyNumber}** using your MCP Jira tool.\n\nExtract:\n- Business requirements\n- Acceptance criteria\n- Any technical constraints from comments`);
  }

  // Context text
  if (contextText?.trim()) {
    parts.push(`## Additional Context\n${contextText.trim()}`);
  }

  // Conversation history (most recent messages)
  if (messages && messages.length > 0) {
    const recent = messages.slice(-MAX_HISTORY_MESSAGES);
    parts.push('## Conversation History');
    for (const msg of recent) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      parts.push(`**${role}:** ${msg.content}`);
    }
  }

  // Final instructions
  parts.push(`## Instructions
1. Use your MCP tools (Jira, BigQuery, GitHub) as needed to gather context.
2. If you need clarification, ask a clear, specific question. Do NOT generate SQL if requirements are unclear.
3. When requirements are clear, generate production-quality BigQuery SQL.
4. Always include the SQL in a \`\`\`sql code block.
5. Briefly explain your design decisions and any assumptions.
6. If converting legacy SQL, show the original and then the converted version.
7. End your response with: [SQL_READY] if SQL was generated, or [CLARIFY] if you need more information.`);

  return parts.join('\n\n---\n\n');
}

// ── SQL Extraction ────────────────────────────────────────────

function extractSql(content) {
  const match = content.match(/```sql\s*\n([\s\S]*?)```/i);
  return match ? match[1].trim() : null;
}

// ── Clarification Detection ───────────────────────────────────

function isClarificationRequest(content) {
  if (!content) return false;
  const indicators = [
    '[CLARIFY]',
    'I need more information',
    'Could you clarify',
    'Can you provide more details',
    'I have a few questions',
    'Before I proceed',
    'Please provide',
    'What is the expected',
    'Which table',
    'Could you specify',
    'Can you confirm',
    'unclear from the requirements',
    'need some clarification',
  ];
  const lower = content.toLowerCase();
  return indicators.some((ind) => lower.includes(ind.toLowerCase()));
}

// ── Pipeline Stage Mapping ────────────────────────────────────

function mapToolToStage(toolName) {
  const name = (toolName || '').toLowerCase();
  if (name.includes('jira')) return 'analysis';
  if (name.includes('bigquery') || name.includes('bq') || name.includes('dataset') || name.includes('table_schema')) return 'schema_resolution';
  if (name.includes('github') || name.includes('pr') || name.includes('commit')) return 'validation';
  if (name.includes('sql') || name.includes('query') || name.includes('dry_run')) return 'validation';
  return 'intake';
}

// ── Claude CLI Spawner ────────────────────────────────────────

async function runClaude(prompt, sessionId, onEvent) {
  const claudeBin = findClaude();
  if (!claudeBin) {
    throw new Error(
      'Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code\n' +
      'Ensure MCP servers are configured in ~/.claude.json'
    );
  }

  if (activeRequests >= MAX_CONCURRENT) {
    throw new Error(`Server busy. ${MAX_CONCURRENT} concurrent requests max. Please retry in a moment.`);
  }

  activeRequests++;
  console.log(`  [claude] Spawning for session ${sessionId.slice(0, 8)} (active: ${activeRequests}/${MAX_CONCURRENT})`);

  let proc = null;
  let timeoutId = null;
  let accumulatedText = '';
  let toolCalls = new Set();

  const cleanup = () => {
    clearTimeout(timeoutId);
    activeRequests--;
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* already dead */ } }, 3000);
    }
  };

  // Get session for conversation resumption
  const session = getSession(sessionId);

  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '-',
      '--output-format', 'stream-json',
      '--max-turns', String(CLAUDE_MAX_TURNS),
      '--verbose',
    ];

    // Resume conversation if we have a conversation ID
    if (session.conversationId) {
      args.push('--resume', session.conversationId);
    }

    proc = spawn(claudeBin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HOME: os.homedir(),
      },
    });

    // Timeout handler
    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`Claude CLI timed out after ${CLAUDE_TIMEOUT_MS / 1000}s`));
    }, CLAUDE_TIMEOUT_MS);

    let buffer = '';

    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        const result = parseClaudeLine(line, onEvent, toolCalls);
        if (result?.text) {
          accumulatedText = result.text;
        }
        if (result?.conversationId) {
          session.conversationId = result.conversationId;
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      // Log stderr but don't expose to client
      const text = chunk.toString('utf-8').trim();
      if (text) console.error(`  [claude stderr] ${text}`);
    });

    // Write prompt to stdin and close
    proc.stdin.write(prompt, (err) => {
      if (err) {
        cleanup();
        reject(new Error(`Failed to write to Claude stdin: ${err.message}`));
        return;
      }
      proc.stdin.end();
    });

    proc.on('close', (code) => {
      cleanup();
      console.log(`  [claude] Exited with code ${code} for session ${sessionId.slice(0, 8)}`);

      // Determine if this was a clarification request
      const isClarify = isClarificationRequest(accumulatedText);
      const hasSql = !!extractSql(accumulatedText);

      if (accumulatedText) {
        onEvent({ type: 'message', content: accumulatedText });
      }

      if (hasSql) {
        onEvent({ type: 'sql', sql: extractSql(accumulatedText), fileName: `generated_sql_${Date.now()}.sql` });
      }

      if (isClarify && !hasSql) {
        // Claude needs more information — emit clarification event
        onEvent({
          type: 'clarification',
          message: accumulatedText,
          needsInput: true,
        });
      }

      onEvent({ type: 'done', success: code === 0 || hasSql });

      resolve({
        success: code === 0 || hasSql,
        clarification: isClarify && !hasSql,
        assistantText: accumulatedText,
      });
    });

    proc.on('error', (err) => {
      cleanup();
      reject(new Error(`Failed to spawn Claude CLI: ${err.message}`));
    });
  }).catch((err) => {
    cleanup();
    throw err;
  });
}

// ── JSON-Lines Parser ─────────────────────────────────────────
// Handles the various event types from `claude --output-format stream-json`
// Reference: https://docs.anthropic.com/en/docs/claude-code/cli-reference

function parseClaudeLine(line, onEvent, toolCalls) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null; // Skip malformed lines
  }

  const type = parsed.type;

  // System init — ignore
  if (type === 'system') return null;

  // ── Tool use — Claude is calling an MCP tool ──────────
  if (type === 'tool_use' || (type === 'assistant' && parsed.message?.content?.some(c => c.type === 'tool_use'))) {
    const toolContent = type === 'tool_use'
      ? parsed
      : parsed.message.content.find(c => c.type === 'tool_use');

    const toolName = toolContent.name || toolContent.tool_name || 'unknown_tool';
    const toolInput = toolContent.input || toolContent.tool_input || {};

    if (!toolCalls.has(toolName)) {
      toolCalls.add(toolName);
      const stage = mapToolToStage(toolName);

      onEvent({
        type: 'status',
        stage,
        message: `Using tool: ${toolName}`,
      });
      onEvent({
        type: 'tool_call',
        tool: toolName,
        args: toolInput,
      });
    }
    return null;
  }

  // ── Tool result — MCP tool returned data ──────────────
  if (type === 'tool_result' || type === 'user' && parsed.message?.content?.some(c => c.type === 'tool_result')) {
    const toolContent = type === 'tool_result'
      ? parsed
      : parsed.message.content.find(c => c.type === 'tool_result');

    const toolName = toolContent.name || toolContent.tool_name || 'unknown_tool';
    const success = !toolContent.is_error;
    const content = typeof toolContent.content === 'string'
      ? toolContent.content
      : JSON.stringify(toolContent.content || '');

    const summary = content.length > 300
      ? content.slice(0, 300) + '...'
      : content;

    onEvent({
      type: 'tool_result',
      tool: toolName,
      success,
      summary,
    });
    return null;
  }

  // ── Content block delta — streaming text ──────────────
  if (type === 'content_block_delta') {
    const delta = parsed.delta;
    if (delta?.type === 'text_delta' && delta.text) {
      // Accumulate for final extraction but don't stream individual tokens
      // (keeps UI cleaner — final message sent on close)
      return { text: delta.text };
    }
    return null;
  }

  // ── Content block start ──────────────────────────────
  if (type === 'content_block_start') return null;

  // ── Content block stop ────────────────────────────────
  if (type === 'content_block_stop') return null;

  // ── Assistant message — full message chunk ────────────
  if (type === 'assistant' && parsed.message) {
    const textParts = (parsed.message.content || [])
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('');

    if (textParts) {
      return { text: textParts };
    }
    return null;
  }

  // ── Result — final result from claude ─────────────────
  if (type === 'result') {
    // Claude sometimes includes a conversation_id for resumption
    const conversationId = parsed.conversation_id || parsed.id || null;
    return { conversationId };
  }

  return null;
}

// ── HTTP Server ───────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // CORS headers (for local development)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── GET /health ─────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/health') {
    const claudeBin = findClaude();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: claudeBin ? 'ready' : 'claude_not_found',
      claude: claudeBin || 'not found',
      activeRequests,
      maxConcurrent: MAX_CONCURRENT,
      activeSessions: sessions.size,
      port: PORT,
      uptime: Math.floor(process.uptime()),
      mode: process.env.USE_CLAUDE_BRIDGE === 'true' ? 'claude_cli' : 'built_in_agent',
    }));
    return;
  }

  // ── DELETE /session/:id ────────────────────────────────
  if (req.method === 'DELETE' && req.url?.startsWith('/session/')) {
    const sessionId = req.url.split('/session/')[1];
    if (sessionId && sessions.has(sessionId)) {
      sessions.delete(sessionId);
      console.log(`  [session] Deleted session ${sessionId.slice(0, 8)}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ deleted: true }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found' }));
    }
    return;
  }

  // ── GET / ───────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      name: 'SQLForge Claude Bridge',
      version: '1.0.0',
      description: 'Claude Code CLI → SSE Proxy for SQLForge',
      claude: findClaude() ? 'detected' : 'NOT FOUND',
      endpoints: {
        'POST /chat': 'Send prompt to Claude CLI, returns SSE stream',
        'GET /health': 'Health check with Claude CLI status',
        'DELETE /session/:id': 'Clear session history',
      },
      mcpServers: 'Configured via ~/.claude.json',
    }));
    return;
  }

  // ── POST /chat ──────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/chat') {
    let body = '';

    req.on('data', (chunk) => { body += chunk; });

    req.on('end', async () => {
      let request;
      try {
        request = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
      }

      const { sessionId, messages, taskType, jiraInput, bqProjectId, contextText } = request;

      // Validate
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'messages array is required' }));
        return;
      }

      if (!sessionId || typeof sessionId !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'sessionId is required' }));
        return;
      }

      // Check claude availability
      if (!findClaude()) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Claude CLI not found',
          hint: 'Install with: npm install -g @anthropic-ai/claude-code',
          docs: 'https://docs.anthropic.com/en/docs/claude-code/overview',
        }));
        return;
      }

      // Set up SSE response
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const sseSend = (event, data) => {
        try {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        } catch {
          // Client disconnected
        }
      };

      // Update session history
      const session = getSession(sessionId);
      session.lastActivity = Date.now();
      trimSession(sessionId);

      // Pipeline progression
      sseSend('status', { stage: 'intake', message: 'Connecting to Claude Code...', timestamp: Date.now() });

      try {
        // Build prompt from request
        const prompt = buildPrompt(request);

        // Run claude CLI
        sseSend('status', { stage: 'analysis', message: 'Claude is analyzing your request...', timestamp: Date.now() });

        const eventHandler = (event) => {
          switch (event.type) {
            case 'status':
              sseSend('status', { ...event, timestamp: Date.now() });
              break;
            case 'tool_call':
              sseSend('tool_call', { ...event, timestamp: Date.now() });
              break;
            case 'tool_result':
              sseSend('tool_result', { ...event, timestamp: Date.now() });
              break;
            case 'message':
              sseSend('message', { ...event, timestamp: Date.now() });
              break;
            case 'clarification':
              sseSend('clarification', { ...event, timestamp: Date.now() });
              break;
            case 'sql':
              if (event.sql) {
                sseSend('sql', { ...event, timestamp: Date.now() });
              }
              break;
            case 'done':
              sseSend('done', { ...event, timestamp: Date.now() });
              break;
          }
        };

        const result = await runClaude(prompt, sessionId, eventHandler);

        // Store successful exchange in session
        const lastUserMsg = messages[messages.length - 1];
        if (lastUserMsg) {
          session.messages.push({ role: 'user', content: lastUserMsg.content });
        }

        if (result.assistantText) {
          session.messages.push({ role: 'assistant', content: result.assistantText });
        }

        // Trim session history
        trimSession(sessionId);

        console.log(`  [bridge] Session ${sessionId.slice(0, 8)}: ${result.success ? 'success' : 'completed'}${result.clarification ? ' (needs clarification)' : ''}`);

      } catch (err) {
        const message = err.message || 'Unknown error';
        console.error(`  [bridge] Error for session ${sessionId.slice(0, 8)}:`, message);

        sseSend('status', { stage: 'idle', message: 'Error occurred', timestamp: Date.now() });
        sseSend('error', { message, timestamp: Date.now() });
        sseSend('done', { success: false, timestamp: Date.now() });
      }

      res.end();
    });

    return;
  }

  // ── 404 ────────────────────────────────────────────────
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: 'Not found',
    endpoints: ['POST /chat', 'GET /health', 'DELETE /session/:id'],
  }));
});

// ── Start Server ──────────────────────────────────────────────

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║   SQLForge Claude Bridge v1.0                ║');
  console.log('  ║   Claude Code CLI → SSE Proxy                ║');
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log(`  ║   Port:          ${String(PORT).padEnd(27)}║`);
  console.log(`  ║   Claude CLI:    ${findClaude() ? 'detected ✓'.padEnd(27) : 'NOT FOUND ✗'.padEnd(27)}║`);
  console.log(`  ║   Max Turns:     ${String(CLAUDE_MAX_TURNS).padEnd(27)}║`);
  console.log(`  ║   Timeout:       ${String(CLAUDE_TIMEOUT_MS / 1000 + 's').padEnd(27)}║`);
  console.log(`  ║   Concurrency:   ${String(MAX_CONCURRENT).padEnd(27)}║`);
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log('  ║   Endpoints:                                    ║');
  console.log('  ║     POST /chat         Send prompt → Claude   ║');
  console.log('  ║     GET  /health       Health check           ║');
  console.log('  ║     DELETE /session/:id Clear session history ║');
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log('  ║   MCP Tools: Jira, BigQuery, GitHub            ║');
  console.log('  ║   Config:    ~/.claude.json                    ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');

  if (!findClaude()) {
    console.error('  ⚠  WARNING: Claude CLI not found on PATH!');
    console.error('     Install: npm install -g @anthropic-ai/claude-code');
    console.error('     Docs:   https://docs.anthropic.com/en/docs/claude-code/overview');
    console.error('     MCP:    https://modelcontextprotocol.io/docs/develop/connect-local-servers');
    console.error('');
  }
});

// ── Graceful Shutdown ─────────────────────────────────────────

function gracefulShutdown(signal) {
  console.log(`\n  Bridge shutting down (${signal})...`);
  // Kill any active Claude processes
  server.close(() => {
    console.log('  Bridge stopped.');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('  Forced shutdown after 5s timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors — don't crash the bridge
process.on('uncaughtException', (err) => {
  console.error('  [FATAL] Uncaught exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('  [FATAL] Unhandled rejection:', reason);
});
