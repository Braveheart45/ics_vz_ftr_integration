#!/usr/bin/env node
// ============================================================
// claude-bridge.js — Claude Code CLI → HTTP/SSE Bridge
// ============================================================
//
// Spawns `claude` CLI with --output-format stream-json,
// converts its JSON-Lines output to Server-Sent Events
// compatible with the SQLForge frontend.
//
// Usage:
//   node claude-bridge.js              # Start on port 3001
//   node claude-bridge.js --port 4001  # Custom port
//   CLAUDE_MAX_TURNS=20 node claude-bridge.js
//
// The claude CLI MUST have MCP servers configured in
// ~/.claude.json for this bridge to access Jira, BigQuery,
// and GitHub tools.
// ============================================================

'use strict';

const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ── Configuration ─────────────────────────────────────────────

const PORT = parseInt(process.env.BRIDGE_PORT || process.argv.find(a => a === '--port') && process.argv[process.argv.indexOf('--port') + 1] || '3001', 10);
const CLAUDE_MAX_TURNS = parseInt(process.env.CLAUDE_MAX_TURNS || '15', 10);
const CLAUDE_TIMEOUT_MS = parseInt(process.env.CLAUDE_TIMEOUT_MS || '180000', 10); // 3 min
const MAX_HISTORY_MESSAGES = parseInt(process.env.MAX_HISTORY_MESSAGES || '20', 10);
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '3', 10);

// ── In-memory session store ───────────────────────────────────
// Maps sessionId → { messages: [...], lastActivity: Date }

const sessions = new Map();

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { messages: [], lastActivity: Date.now() });
  }
  return sessions.get(sessionId);
}

function trimSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session && session.messages.length > MAX_HISTORY_MESSAGES) {
    session.messages = session.messages.slice(-MAX_HISTORY_MESSAGES);
  }
}

// Cleanup stale sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > 30 * 60 * 1000) { // 30 min idle
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
      const result = require('child_process').spawnSync(cmd, ['--version'], {
        timeout: 5000,
        shell: true,
      });
      if (result.status === 0) {
        claudePath = cmd;
        return cmd;
      }
    } catch { /* not found */ }
  }

  // Try common paths
  const paths = [
    path.join(os.homedir(), '.claude', 'local', 'claude'),
    '/usr/local/bin/claude',
    path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      claudePath = p;
      return p;
    }
  }

  return null;
}

// ── Prompt Builder ────────────────────────────────────────────

function buildPrompt(request) {
  const { messages, taskType, jiraInput, bqProjectId, contextText } = request;
  const parts = [];

  // Task type instruction
  const taskInstructions = {
    sql_generation: 'Generate NEW BigQuery-compatible SQL based on the requirements.',
    legacy_sql_conversion: 'Convert legacy SQL (T-SQL, PL/SQL, Redshift, Teradata) to BigQuery syntax.',
    auto_detect: 'Infer whether to generate new SQL or convert legacy SQL. Analyze the input carefully.',
  };

  parts.push(`## Task Type\n${taskInstructions[taskType] || taskInstructions.auto_detect}`);

  // BQ project
  if (bqProjectId) {
    parts.push(`## Target BigQuery Project\n\`${bqProjectId}\`\n\nUse your MCP BigQuery tool to explore schemas in this project.`);
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

  // Final instruction
  parts.push(`## Instructions\n1. Use your MCP tools to fetch Jira story details and BigQuery schema information as needed.\n2. Generate production-quality BigQuery SQL.\n3. Include the SQL in a \`\`\`sql code block.\n4. Briefly explain your design decisions and any assumptions.\n5. If the task is to convert legacy SQL, first show the original and then the converted version.`);

  return parts.join('\n\n---\n\n');
}

// ── SQL Extraction ────────────────────────────────────────────

function extractSql(content) {
  const match = content.match(/```sql\s*\n([\s\S]*?)```/i);
  return match ? match[1].trim() : null;
}

// ── Pipeline Stage Mapping ────────────────────────────────────

function mapToolToStage(toolName) {
  if (toolName.toLowerCase().includes('jira')) return 'analysis';
  if (toolName.toLowerCase().includes('bigquery') || toolName.toLowerCase().includes('bq')) return 'schema_resolution';
  if (toolName.toLowerCase().includes('github') || toolName.toLowerCase().includes('pr')) return 'validation';
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
    throw new Error(`Server busy. ${MAX_CONCURRENT} concurrent requests max. Please try again.`);
  }

  activeRequests++;

  // Write prompt to temp file (avoids shell argument length limits)
  const tmpFile = path.join(os.tmpdir(), `claude-prompt-${sessionId}-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, prompt, 'utf-8');

  let proc = null;
  let timeoutId = null;
  let accumulatedText = '';
  let toolCalls = new Set();
  let resultReceived = false;

  const cleanup = () => {
    clearTimeout(timeoutId);
    activeRequests--;
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* already dead */ } }, 3000);
    }
  };

  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '-',
      '--output-format', 'stream-json',
      '--max-turns', String(CLAUDE_MAX_TURNS),
      '--verbose',
    ];

    proc = spawn(claudeBin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Ensure claude uses the user's config
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
        parseAndEmit(line, onEvent, (text) => { accumulatedText = text; }, toolCalls);
      }
    });

    proc.stderr.on('data', (chunk) => {
      // Log stderr but don't expose to client
      const text = chunk.toString('utf-8').trim();
      if (text) console.error(`[claude stderr] ${text}`);
    });

    // Write prompt to stdin and close
    proc.stdin.write(prompt);
    proc.stdin.end();

    proc.on('close', (code) => {
      cleanup();

      if (code !== 0 && !resultReceived) {
        // Process exited with error
        const errorMsg = code === null
          ? 'Claude CLI process was killed'
          : `Claude CLI exited with code ${code}`;

        // Send what we have accumulated if any
        if (accumulatedText) {
          onEvent({ type: 'message', content: accumulatedText });
        }
        onEvent({ type: 'sql', sql: extractSql(accumulatedText), fileName: `generated_sql_${Date.now()}.sql` });
        onEvent({ type: 'done' });
        resolve({ success: false, error: errorMsg });
      } else {
        // Success — send final message if not already sent
        if (accumulatedText) {
          onEvent({ type: 'message', content: accumulatedText });
        }
        onEvent({ type: 'sql', sql: extractSql(accumulatedText), fileName: `generated_sql_${Date.now()}.sql` });
        onEvent({ type: 'done' });
        resolve({ success: true });
      }
    });

    proc.on('error', (err) => {
      cleanup();
      reject(new Error(`Failed to spawn Claude CLI: ${err.message}`));
    });

    // Send the prompt via stdin
    proc.stdin.write(prompt, (err) => {
      if (err) {
        cleanup();
        reject(new Error(`Failed to write to Claude stdin: ${err.message}`));
      }
    });
    proc.stdin.end();
  }).catch((err) => {
    cleanup();
    throw err;
  }).finally(() => {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  });
}

// ── JSON-Lines Parser ─────────────────────────────────────────
// Handles the various event types from `claude --output-format stream-json`

function parseAndEmit(line, onEvent, setText, toolCalls) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return; // Skip malformed lines
  }

  const type = parsed.type;

  // System init — ignore
  if (type === 'system') return;

  // Tool use — Claude is calling an MCP tool
  if (type === 'tool_use' || (type === 'assistant' && parsed.message?.content?.some(c => c.type === 'tool_use'))) {
    const toolContent = type === 'tool_use'
      ? parsed
      : parsed.message.content.find(c => c.type === 'tool_use');

    const toolName = toolContent.tool_name || toolContent.name || 'unknown_tool';
    const toolInput = toolContent.tool_input || toolContent.input || {};

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
    return;
  }

  // Tool result — MCP tool returned data
  if (type === 'tool_result') {
    const toolName = parsed.tool_name || 'unknown_tool';
    const success = !parsed.is_error;
    const content = typeof parsed.content === 'string'
      ? parsed.content
      : JSON.stringify(parsed.content || '');

    // Summarize long tool results
    const summary = content.length > 200
      ? content.slice(0, 200) + '...'
      : content;

    onEvent({
      type: 'tool_result',
      tool: toolName,
      success,
      summary,
    });
    return;
  }

  // Content block start
  if (type === 'content_block_start') {
    // Could track block types here
    return;
  }

  // Content block delta — streaming text
  if (type === 'content_block_delta') {
    const delta = parsed.delta;
    if (delta?.type === 'text_delta' && delta.text) {
      setText(delta.text);
      // Optionally stream individual tokens (commented out to batch at end)
      // onEvent({ type: 'text_delta', content: delta.text });
    }
    return;
  }

  // Content block stop
  if (type === 'content_block_stop') return;

  // Assistant message — full message chunk
  if (type === 'assistant' && parsed.message) {
    const textParts = (parsed.message.content || [])
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('');

    if (textParts) {
      setText(textParts);
    }
    return;
  }

  // Result — final result from claude
  if (type === 'result') {
    // resultReceived = true; // handled by caller
    return;
  }
}

// ── HTTP Server ───────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // CORS headers (for local development)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
      port: PORT,
      uptime: process.uptime(),
    }));
    return;
  }

  // ── GET / ───────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('SQLForge Claude Bridge — Claude Code CLI → SSE Proxy\n');
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
          error: 'Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code',
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
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // Update session history
      const session = getSession(sessionId);
      session.lastActivity = Date.now();

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
            case 'text_delta':
              sseSend('text_delta', event);
              break;
            case 'message':
              sseSend('message', event);
              break;
            case 'sql':
              if (event.sql) {
                sseSend('sql', { ...event, timestamp: Date.now() });
              }
              break;
            case 'done':
              sseSend('done', { timestamp: Date.now() });
              break;
          }
        };

        await runClaude(prompt, sessionId, eventHandler);

        // Store successful exchange in session
        const lastUserMsg = messages[messages.length - 1];
        if (lastUserMsg) {
          session.messages.push({ role: 'user', content: lastUserMsg.content });
        }

      } catch (err) {
        const message = err.message || 'Unknown error';
        console.error(`[bridge] Error for session ${sessionId}:`, message);

        sseSend('status', { stage: 'idle', message: 'Error occurred', timestamp: Date.now() });
        sseSend('error', { message, timestamp: Date.now() });
        sseSend('done', { timestamp: Date.now() });
      }

      res.end();
    });

    return;
  }

  // ── 404 ────────────────────────────────────────────────
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found. Available endpoints: POST /chat, GET /health' }));
});

// ── Start Server ──────────────────────────────────────────────

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║   SQLForge Claude Bridge                   ║');
  console.log('  ║   Claude Code CLI → SSE Proxy               ║');
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log(`  ║   Port:        ${String(PORT).padEnd(29)}║`);
  console.log(`  ║   Claude:      ${findClaude() ? 'detected'.padEnd(29) : 'NOT FOUND'.padEnd(29)}║`);
  console.log(`  ║   Max Turns:   ${String(CLAUDE_MAX_TURNS).padEnd(29)}║`);
  console.log(`  ║   Timeout:     ${String(CLAUDE_TIMEOUT_MS / 1000 + 's').padEnd(29)}║`);
  console.log(`  ║   Concurrency:  ${String(MAX_CONCURRENT).padEnd(29)}║`);
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log('  ║   Endpoints:                                   ║');
  console.log('  ║     POST /chat    — Send prompt to Claude      ║');
  console.log('  ║     GET  /health  — Health check               ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');

  if (!findClaude()) {
    console.error('  ⚠️  WARNING: Claude CLI not found on PATH!');
    console.error('     Install with: npm install -g @anthropic-ai/claude-code');
    console.error('     Ensure MCP servers are configured in ~/.claude.json');
    console.error('');
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n  Bridge shutting down (SIGTERM)...');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
});

process.on('SIGINT', () => {
  console.log('\n  Bridge shutting down (SIGINT)...');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
});

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('  [FATAL] Uncaught exception:', err.message);
  // Don't exit — keep serving
});

process.on('unhandledRejection', (reason) => {
  console.error('  [FATAL] Unhandled rejection:', reason);
});
