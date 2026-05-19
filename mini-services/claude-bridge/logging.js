'use strict';

// ============================================================
// claude-bridge — leveled logger
// ============================================================
//
// A lightweight, dependency-free logger that:
//   • respects a runtime log level (trace < debug < info < warn < error < fatal)
//   • prepends a stable context prefix (requestId, sessionId, etc.) to every
//     line so a single run can be traced end-to-end across grep
//   • writes structured JSON to stdout/stderr when SQL_CURATOR_LOG_JSON=true,
//     otherwise pretty-prints with a short timestamp
//
// The interface deliberately mirrors pino so a future swap to pino is a
// one-file change.
// ============================================================

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

const JSON_MODE = String(process.env.SQL_CURATOR_LOG_JSON || '').toLowerCase() === 'true';

let activeThreshold = LEVELS.info;

function setLevel(name) {
  const lvl = LEVELS[String(name || '').toLowerCase()];
  if (lvl) activeThreshold = lvl;
}

function shortTime() {
  const d = new Date();
  return d.toISOString().slice(11, 23); // HH:MM:SS.sss
}

function contextString(ctx) {
  if (!ctx || typeof ctx !== 'object') return '';
  const parts = [];
  if (ctx.requestId) parts.push(`req=${ctx.requestId}`);
  if (ctx.sessionId) parts.push(`sess=${String(ctx.sessionId).slice(0, 8)}`);
  if (ctx.component) parts.push(ctx.component);
  if (ctx.phase) parts.push(`phase=${ctx.phase}`);
  return parts.length > 0 ? `[${parts.join(' ')}] ` : '';
}

function emit(level, ctx, msg, meta) {
  if (LEVELS[level] < activeThreshold) return;
  const stream = LEVELS[level] >= LEVELS.warn ? process.stderr : process.stdout;
  if (JSON_MODE) {
    const payload = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...((ctx && typeof ctx === 'object') ? ctx : {}),
      ...(meta && typeof meta === 'object' ? meta : {}),
    };
    try {
      stream.write(JSON.stringify(payload) + '\n');
    } catch {
      // Fallback: best-effort plain write
      stream.write(`${level} ${msg}\n`);
    }
    return;
  }
  const prefix = `${shortTime()} ${level.toUpperCase().padEnd(5)} ${contextString(ctx)}`;
  let line = `${prefix}${msg}`;
  if (meta && typeof meta === 'object') {
    try {
      const compact = JSON.stringify(meta);
      if (compact && compact !== '{}') line += ` ${compact}`;
    } catch { /* ignore */ }
  }
  stream.write(line + '\n');
}

/**
 * Create a logger bound to a context. Returned logger has `.child(extra)` to
 * extend the context for sub-operations.
 *
 * Example:
 *   const log = createLogger({ requestId, sessionId });
 *   log.info('Claude session started', { turns: 25 });
 *   const subLog = log.child({ phase: 'l3-coverage' });
 *   subLog.warn('Cold session timed out');
 */
function createLogger(baseContext = {}) {
  const ctx = { ...baseContext };
  return {
    trace: (msg, meta) => emit('trace', ctx, msg, meta),
    debug: (msg, meta) => emit('debug', ctx, msg, meta),
    info: (msg, meta) => emit('info', ctx, msg, meta),
    warn: (msg, meta) => emit('warn', ctx, msg, meta),
    error: (msg, meta) => emit('error', ctx, msg, meta),
    fatal: (msg, meta) => emit('fatal', ctx, msg, meta),
    child(extra) {
      return createLogger({ ...ctx, ...(extra || {}) });
    },
  };
}

// Root logger for module-level / startup events that have no request context.
const root = createLogger({ component: 'bridge' });

module.exports = { createLogger, setLevel, root, LEVELS };
