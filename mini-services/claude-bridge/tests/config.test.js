'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadConfig } = require('../config');

test('loadConfig accepts an empty env and uses defaults', () => {
  const cfg = loadConfig({});
  assert.equal(cfg.port, 3001);
  assert.equal(cfg.claude.maxTurns, 50);
  assert.equal(cfg.claude.maxConcurrent, 3);
  assert.equal(cfg.features.offlineDryRunEnabled, false);
  assert.equal(cfg.logLevel, 'info');
});

test('loadConfig parses integer ranges and rejects out-of-range values', () => {
  assert.throws(() => loadConfig({ BRIDGE_PORT: '99999' }), /BRIDGE_PORT/);
  assert.throws(() => loadConfig({ BRIDGE_PORT: '0' }), /BRIDGE_PORT/);
  assert.throws(() => loadConfig({ CLAUDE_MAX_CONCURRENT: '1000' }), /CLAUDE_MAX_CONCURRENT/);
});

test('loadConfig rejects non-numeric integers', () => {
  assert.throws(() => loadConfig({ CLAUDE_MAX_TURNS: 'twenty' }), /CLAUDE_MAX_TURNS/);
});

test('loadConfig rejects invalid log level', () => {
  assert.throws(() => loadConfig({ SQL_CURATOR_LOG_LEVEL: 'verbose' }), /SQL_CURATOR_LOG_LEVEL/);
});

test('loadConfig accepts valid log levels', () => {
  for (const lvl of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
    const cfg = loadConfig({ SQL_CURATOR_LOG_LEVEL: lvl });
    assert.equal(cfg.logLevel, lvl);
  }
});

test('loadConfig returns frozen objects', () => {
  const cfg = loadConfig({});
  assert.throws(() => { cfg.port = 4000; });
  assert.throws(() => { cfg.claude.maxTurns = 100; });
});

test('loadConfig parses boolean feature flags', () => {
  const enabled = loadConfig({ SQL_CURATOR_ENABLE_OFFLINE_DRY_RUN: 'true' });
  assert.equal(enabled.features.offlineDryRunEnabled, true);

  const disabled = loadConfig({ SQL_CURATOR_ENABLE_OFFLINE_DRY_RUN: 'false' });
  assert.equal(disabled.features.offlineDryRunEnabled, false);
});

test('loadConfig aggregates multiple errors at once', () => {
  try {
    loadConfig({
      BRIDGE_PORT: 'nope',
      CLAUDE_MAX_TURNS: '0',
      SQL_CURATOR_LOG_LEVEL: 'bogus',
    });
    assert.fail('should have thrown');
  } catch (err) {
    // The error message should mention all three problems.
    assert.match(err.message, /BRIDGE_PORT/);
    assert.match(err.message, /CLAUDE_MAX_TURNS/);
    assert.match(err.message, /SQL_CURATOR_LOG_LEVEL/);
  }
});
