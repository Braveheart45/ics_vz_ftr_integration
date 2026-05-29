'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  decideSqlRelease,
  normalizeValidationStatus,
  combineValidationStatuses,
  deriveDryRunStatus,
} = require('../release-policy');

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

// ── normalizeValidationStatus ─────────────────────────────────
test('normalizeValidationStatus passes through allowed values', () => {
  for (const s of ['pass', 'warning', 'fail', 'not_run']) {
    assert.equal(normalizeValidationStatus(s), s);
  }
});

test('normalizeValidationStatus defaults unknown/empty to warning', () => {
  assert.equal(normalizeValidationStatus('banana'), 'warning');
  assert.equal(normalizeValidationStatus(undefined), 'warning');
  assert.equal(normalizeValidationStatus(null), 'warning');
  assert.equal(normalizeValidationStatus(''), 'warning');
});

test('normalizeValidationStatus is case-insensitive', () => {
  assert.equal(normalizeValidationStatus('PASS'), 'pass');
  assert.equal(normalizeValidationStatus('Fail'), 'fail');
});

// ── combineValidationStatuses (worst-wins) ────────────────────
test('combineValidationStatuses returns not_run for empty input', () => {
  assert.equal(combineValidationStatuses([]), 'not_run');
  assert.equal(combineValidationStatuses(undefined), 'not_run');
});

test('combineValidationStatuses returns pass only when all pass', () => {
  assert.equal(combineValidationStatuses(['pass', 'pass', 'pass']), 'pass');
});

test('combineValidationStatuses lets fail win over everything', () => {
  assert.equal(combineValidationStatuses(['pass', 'warning', 'fail']), 'fail');
  assert.equal(combineValidationStatuses(['fail', 'pass']), 'fail');
});

test('combineValidationStatuses lets warning win over not_run and pass', () => {
  assert.equal(combineValidationStatuses(['pass', 'warning', 'not_run']), 'warning');
});

test('combineValidationStatuses returns not_run when present without fail/warning', () => {
  assert.equal(combineValidationStatuses(['pass', 'not_run']), 'not_run');
});

test('combineValidationStatuses treats unknown section status as warning (so a bogus pass cannot sneak through)', () => {
  assert.equal(combineValidationStatuses(['pass', 'bogus']), 'warning');
});

// ── deriveDryRunStatus (deterministic backstop) ───────────────
test('deriveDryRunStatus returns not_run when no attempts were captured', () => {
  assert.equal(deriveDryRunStatus([]), 'not_run');
  assert.equal(deriveDryRunStatus(undefined), 'not_run');
  assert.equal(deriveDryRunStatus(null), 'not_run');
});

test('deriveDryRunStatus returns pass when the last attempt did not error', () => {
  assert.equal(deriveDryRunStatus([{ isError: true }, { isError: false }]), 'pass');
});

test('deriveDryRunStatus returns fail when the LAST attempt errored', () => {
  // earlier attempts may have passed; the last one is authoritative
  assert.equal(deriveDryRunStatus([{ isError: false }, { isError: true }]), 'fail');
  assert.equal(deriveDryRunStatus([{ isError: true }]), 'fail');
});

// ── Integration: the regression the refactor introduced ───────
test('a hallucinated sqlChecks=pass with NO real dry-run is downgraded and warned', () => {
  // Simulates the close-handler reconciliation: Claude claims pass, but the
  // bridge observed zero dry-run attempts → deterministic not_run wins.
  const deterministic = deriveDryRunStatus([]); // not_run
  const status = combineValidationStatuses(['pass', 'pass', deterministic]);
  assert.equal(status, 'not_run');
  const decision = decideSqlRelease({ hasSqlBlock: true, validationStatus: status });
  assert.equal(decision.surfacesSql, true);          // SQL still shown
  assert.equal(decision.validationPassed, false);    // but NOT marked validated
  assert.match(decision.warning, /unavailable/);
});

test('a real failing dry-run overrides a claimed pass and blocks validationPassed', () => {
  const deterministic = deriveDryRunStatus([{ isError: true }]); // fail
  const status = combineValidationStatuses(['pass', 'pass', deterministic]);
  assert.equal(status, 'fail');
  const decision = decideSqlRelease({ hasSqlBlock: true, validationStatus: status });
  assert.equal(decision.validationPassed, false);
  assert.match(decision.warning, /failure/);
});

test('a premature Jira write pulls an otherwise-clean run to warning', () => {
  const prematureJira = true;
  const status = combineValidationStatuses(['pass', 'pass', 'pass', prematureJira ? 'warning' : 'pass']);
  assert.equal(status, 'warning');
});
