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

function incr(name, labels, by = 1) {
  const key = seriesKey(name, labels);
  counters.set(key, (counters.get(key) || 0) + by);
}

function setGauge(name, labels, value) {
  const key = seriesKey(name, labels);
  gauges.set(key, value);
}

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
