'use strict';

// ============================================================
// claude-bridge — leveled logger (pino-backed)
// ============================================================
//
// Public surface preserved from the previous hand-rolled implementation:
//
//   createLogger(context)            → bound logger
//   logger.trace / debug / info /
//          warn / error / fatal(msg, meta)
//   logger.child(extra)              → bound child logger
//   setLevel(name)                   → adjust runtime threshold
//   root                             → module-scope logger for startup
//
// Backed by pino so logs are structured JSON suitable for shipping to any
// observability pipeline (Loki, Datadog, CloudWatch, OpenSearch, …).
// SQL_CURATOR_LOG_PRETTY=true switches to a human-readable single-line
// renderer for local development.
// ============================================================

const pino = require('pino');

const JSON_MODE_OFF = String(process.env.SQL_CURATOR_LOG_PRETTY || '').toLowerCase() === 'true';

const pinoOpts = {
  level: 'info',
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) { return { level: label }; },
  },
};

if (JSON_MODE_OFF) {
  // pino-pretty isn't a dependency by default; fall back to a minimal pretty
  // print if not available so the bridge still boots in dev environments.
  try {
    require.resolve('pino-pretty');
    pinoOpts.transport = { target: 'pino-pretty', options: { colorize: true, singleLine: true } };
  } catch { /* keep JSON output */ }
}

const rootPino = pino(pinoOpts);

function setLevel(name) {
  if (typeof name === 'string') {
    rootPino.level = name.toLowerCase();
  }
}

/**
 * Adapter around a pino logger that preserves the (msg, meta) shape the
 * bridge calls everywhere. pino's native API takes (mergeObject, msg) — we
 * normalise here so callers don't have to change.
 *
 * @param {import('pino').Logger} target
 * @returns {{
 *   trace:(msg:string, meta?:object)=>void,
 *   debug:(msg:string, meta?:object)=>void,
 *   info: (msg:string, meta?:object)=>void,
 *   warn: (msg:string, meta?:object)=>void,
 *   error:(msg:string, meta?:object)=>void,
 *   fatal:(msg:string, meta?:object)=>void,
 *   child:(extra:object)=>any,
 * }}
 */
function wrap(target) {
  const adapt = (level) => (msg, meta) => {
    if (meta && typeof meta === 'object') target[level](meta, String(msg));
    else target[level](String(msg));
  };
  return {
    trace: adapt('trace'),
    debug: adapt('debug'),
    info: adapt('info'),
    warn: adapt('warn'),
    error: adapt('error'),
    fatal: adapt('fatal'),
    child(extra) {
      return wrap(target.child(extra && typeof extra === 'object' ? extra : {}));
    },
  };
}

function createLogger(baseContext = {}) {
  const ctx = baseContext && typeof baseContext === 'object' ? baseContext : {};
  return wrap(rootPino.child(ctx));
}

const root = createLogger({ component: 'bridge' });

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

module.exports = { createLogger, setLevel, root, LEVELS };
