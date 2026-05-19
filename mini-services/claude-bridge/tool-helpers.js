'use strict';

// ============================================================
// claude-bridge — generic helpers for parsing MCP tool I/O
// ============================================================
// Pure utility module. No side effects, no cross-module imports.
// ============================================================

/**
 * Stringify any value to JSON without throwing.
 * @param {unknown} value
 * @returns {string}
 */
function safeJsonStringify(value) {
  try { return JSON.stringify(value); } catch { return String(value); }
}

/**
 * Parse a JSON string without throwing. Returns null for non-JSON.
 * Only attempts parse when the trimmed input begins with { or [ — protects
 * against expensive failed parses on plain prose tool_result text.
 * @param {string} text
 * @returns {object|Array|null}
 */
function tryParseJson(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return null;
  try { return JSON.parse(trimmed); } catch { return null; }
}

/**
 * Same as tryParseJson but accepts already-parsed values transparently.
 * @param {unknown} text
 * @returns {object|Array|null}
 */
function safeJsonParse(text) {
  if (text === null || text === undefined) return null;
  if (typeof text === 'object') return text;
  if (typeof text !== 'string') return null;
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * Pick up to `limit` strings out of an array. Accepts plain strings or
 * objects from which one of `fields` is selected. Used to build evidence
 * lists from MCP responses with varying schemas.
 * @param {Array} arr
 * @param {string[]} fields
 * @param {number} [limit]
 * @returns {string[]}
 */
function pickStrings(arr, fields, limit = 8) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const item of arr) {
    if (typeof item === 'string') {
      out.push(item);
    } else if (item && typeof item === 'object') {
      for (const f of fields) {
        if (typeof item[f] === 'string' && item[f].trim()) { out.push(item[f]); break; }
      }
    }
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Collapse whitespace and clip a string to a max length suitable for an
 * Activity Feed card summary or evidence line.
 * @param {unknown} text
 * @param {number} [max]
 * @returns {string}
 */
function clipForActivity(text, max = 220) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Canonicalise an MCP tool_result content into a structured object when
 * possible. Different MCP servers wrap their responses differently:
 *
 *   • Raw JSON string:           "{ \"statistics\": ... }"
 *   • Already-parsed object:     { statistics: ... }
 *   • Anthropic content array:   [{ type: "text", text: "{...}" }, ...]
 *   • Plain text summary:        "Query valid. Estimated 1.2 GB."
 *
 * @param {unknown} content
 * @returns {{ json: object|Array|null, text: string }}
 */
function canonicaliseToolResultContent(content) {
  if (content === null || content === undefined) return { json: null, text: '' };

  // Pre-parsed object — try to use directly.
  if (typeof content === 'object' && !Array.isArray(content)) {
    return { json: content, text: safeJsonStringify(content) };
  }

  // Anthropic content array — concatenate text blocks.
  if (Array.isArray(content)) {
    const textParts = [];
    for (const block of content) {
      if (block && typeof block === 'object' && typeof block.text === 'string') {
        textParts.push(block.text);
      } else if (typeof block === 'string') {
        textParts.push(block);
      }
    }
    const joined = textParts.join('\n');
    const json = tryParseJson(joined);
    return { json, text: joined };
  }

  if (typeof content === 'string') {
    const json = tryParseJson(content);
    return { json, text: content };
  }

  return { json: null, text: String(content) };
}

module.exports = {
  safeJsonStringify,
  safeJsonParse,
  tryParseJson,
  pickStrings,
  clipForActivity,
  canonicaliseToolResultContent,
};
