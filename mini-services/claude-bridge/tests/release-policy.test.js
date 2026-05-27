'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { decideSqlRelease } = require('../release-policy');

test('releases SQL without warning when validationStatus = pass', () => {
  const decision = decideSqlRelease({
    hasSqlBlock: true,
    validationStatus: 'pass',
  });

  assert.equal(decision.surfacesSql, true);
  assert.equal(decision.validationPassed, true);
  assert.equal(decision.warning, null);
});

test('releases SQL with warning when validationStatus = warning', () => {
  const decision = decideSqlRelease({
    hasSqlBlock: true,
    validationStatus: 'warning',
  });

  assert.equal(decision.surfacesSql, true);
  assert.equal(decision.validationPassed, false);
  assert.match(decision.warning, /validator flagged warnings/);
});

test('releases SQL with warning when validationStatus = fail', () => {
  const decision = decideSqlRelease({
    hasSqlBlock: true,
    validationStatus: 'fail',
  });

  assert.equal(decision.surfacesSql, true);
  assert.equal(decision.validationPassed, false);
  assert.match(decision.warning, /reported a failure/);
});

test('releases SQL with warning when validationStatus = not_run', () => {
  const decision = decideSqlRelease({
    hasSqlBlock: true,
    validationStatus: 'not_run',
  });

  assert.equal(decision.surfacesSql, true);
  assert.equal(decision.validationPassed, false);
  assert.match(decision.warning, /unavailable/);
});

test('treats unknown status as not_run', () => {
  const decision = decideSqlRelease({
    hasSqlBlock: true,
    validationStatus: 'banana',
  });

  assert.equal(decision.surfacesSql, true);
  assert.equal(decision.validationPassed, false);
  assert.match(decision.warning, /unavailable/);
});

test('does not release SQL when no fenced SQL block was returned', () => {
  const decision = decideSqlRelease({
    hasSqlBlock: false,
    validationStatus: 'pass',
  });

  assert.equal(decision.surfacesSql, false);
  assert.equal(decision.validationPassed, false);
  assert.equal(decision.warning, null);
});

test('does not release SQL during a clarification request', () => {
  const decision = decideSqlRelease({
    hasSqlBlock: true,
    isClarify: true,
    validationStatus: 'pass',
  });

  assert.equal(decision.surfacesSql, false);
  assert.equal(decision.validationPassed, false);
});

test('does not release SQL during a GitHub deploy request', () => {
  const decision = decideSqlRelease({
    hasSqlBlock: true,
    isGithubDeploy: true,
    validationStatus: 'pass',
  });

  assert.equal(decision.surfacesSql, false);
  assert.equal(decision.validationPassed, false);
});
