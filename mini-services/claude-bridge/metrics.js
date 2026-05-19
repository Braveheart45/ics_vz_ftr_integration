'use strict';

// ============================================================
// claude-bridge — runtime metrics
// ============================================================
//
// In-process counters, gauges, and bucketed histograms. Exposed via
// /metrics in JSON (Prometheus exposition format intentionally not used to
// avoid the dependency; the operator can scrape JSON or swap this module).
//
// Labels are kept simple: a single `labels` object is hashed into a stable
// string key per series. No cardinality explosion guards — callers are
// responsible for using bounded label sets (status codes, layer names, etc.,
// not free-form strings like SQL fragments).
// ============================================================

const counters = new Map();   // key → number
const gauges = new Map();     // key → number
const histograms = new Map(); // key → { buckets: Map<upperBoundMs, count>, sum, count }

const DEFAULT_BUCKETS_MS = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 120000, 300000];

/** @typedef {Object<string, string|number|boolean>} MetricLabels */

function labelsKey(labels) {
  if (!labels || typeof labels !== 'object') return '';
  const entries = Object.entries(labels)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${k}=${String(v).replace(/[|=]/g, '_')}`).join('|');
}

function seriesKey(name, labels) {
  const lk = labelsKey(labels);
  return lk ? `${name}|${lk}` : name;
}

/**
 * Increment a labelled counter.
 * @param {string} name
 * @param {MetricLabels} [labels]
 * @param {number} [by]
 */
function incr(name, labels, by = 1) {
  const key = seriesKey(name, labels);
  counters.set(key, (counters.get(key) || 0) + by);
}

/**
 * Set a labelled gauge to an absolute value.
 * @param {string} name
 * @param {MetricLabels} [labels]
 * @param {number} value
 */
function setGauge(name, labels, value) {
  const key = seriesKey(name, labels);
  gauges.set(key, value);
}

/**
 * Record one duration observation against a labelled histogram. Buckets are
 * fixed (50ms → 5min) at module level; matches what most production SLOs
 * for a long-running orchestrator want to monitor.
 * @param {string} name
 * @param {MetricLabels} [labels]
 * @param {number} valueMs
 */
function observe(name, labels, valueMs) {
  const key = seriesKey(name, labels);
  let h = histograms.get(key);
  if (!h) {
    h = { buckets: new Map(DEFAULT_BUCKETS_MS.map((b) => [b, 0])), sum: 0, count: 0 };
    histograms.set(key, h);
  }
  h.sum += valueMs;
  h.count += 1;
  for (const [bound] of h.buckets) {
    if (valueMs <= bound) {
      h.buckets.set(bound, h.buckets.get(bound) + 1);
    }
  }
}

/**
 * Return a serialisable snapshot of all in-process metrics. Used by the
 * /metrics HTTP endpoint.
 * @returns {{counters: object, gauges: object, histograms: object}}
 */
function snapshot() {
  const out = { counters: {}, gauges: {}, histograms: {} };
  for (const [key, value] of counters) out.counters[key] = value;
  for (const [key, value] of gauges) out.gauges[key] = value;
  for (const [key, h] of histograms) {
    out.histograms[key] = {
      buckets: Object.fromEntries([...h.buckets.entries()].map(([k, v]) => [String(k), v])),
      sum: h.sum,
      count: h.count,
      avg: h.count > 0 ? Math.round(h.sum / h.count) : 0,
    };
  }
  return out;
}

function reset() {
  counters.clear();
  gauges.clear();
  histograms.clear();
}

module.exports = { incr, setGauge, observe, snapshot, reset };
