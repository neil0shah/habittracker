// Learned corrections: category and sign fixes you make by hand, remembered
// independently of any uploaded statement. Stored under its own localStorage
// key so "Clear all data" (which only clears uploaded transactions) doesn't
// erase them, and so a correction made once applies automatically to every
// future statement — not just the transaction you fixed.
//
// Two kinds of rule:
//   - "exact": matches a transaction whose normalized description equals
//     `pattern` exactly. Created when you edit a single row — safe by
//     default, since it can only ever match that same recurring line item
//     (e.g. "NETFLIX.COM NETFLIX.COM CA" repeats verbatim every month).
//   - "keyword": matches any description containing `pattern` as a
//     substring. Created when you bulk-edit using the description search
//     box, since the search term you typed (e.g. "sweetgreen") is exactly
//     the generalization you intended.

const STORAGE_KEY = 'spendingAnalyzer.v1.rules';

/** @typedef {{
 *   id: string, matchType: 'exact'|'keyword', pattern: string,
 *   category?: string, flipSign?: boolean, createdAt: string
 * }} Rule */

export function normalizeDescription(description) {
  return (description || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

/** @returns {Rule[]} */
export function loadRules() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Failed to load learned corrections', e);
    return [];
  }
}

/** @param {Rule[]} rules */
export function saveRules(rules) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch (e) {
    console.error('Failed to save learned corrections', e);
  }
}

/**
 * Add or update a learned rule (mutates `rules` in place). Rules are
 * matched by (matchType, pattern); an existing rule with the same key has
 * its fields merged in rather than being duplicated, so re-correcting the
 * same merchant updates one rule instead of piling up duplicates.
 * @param {Rule[]} rules
 * @param {{matchType: 'exact'|'keyword', pattern: string, category?: string, flipSign?: boolean}} fields
 * @returns {Rule} the created or updated rule
 */
export function upsertRule(rules, fields) {
  const pattern = fields.matchType === 'keyword'
    ? fields.pattern.trim().toUpperCase()
    : normalizeDescription(fields.pattern);

  const existing = rules.find((r) => r.matchType === fields.matchType && r.pattern === pattern);
  if (existing) {
    if (fields.category !== undefined) existing.category = fields.category;
    if (fields.flipSign !== undefined) existing.flipSign = fields.flipSign;
    return existing;
  }

  const rule = {
    id: 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
    matchType: fields.matchType,
    pattern,
    category: fields.category,
    flipSign: fields.flipSign,
    createdAt: new Date().toISOString(),
  };
  rules.push(rule);
  return rule;
}

/**
 * Apply learned rules to a transaction's description/sign. An exact match
 * is more specific and wins over keyword matches; among keyword matches,
 * the most recently created one wins.
 * @param {Rule[]} rules
 * @param {string} description
 * @param {boolean} baseIsDebit
 * @returns {{isDebit: boolean, category: string|null}}
 */
export function applyRules(rules, description, baseIsDebit) {
  const norm = normalizeDescription(description);

  const exact = rules.find((r) => r.matchType === 'exact' && r.pattern === norm);
  if (exact) {
    return {
      isDebit: exact.flipSign ? !baseIsDebit : baseIsDebit,
      category: exact.category ?? null,
    };
  }

  let match = null;
  for (const r of rules) {
    if (r.matchType === 'keyword' && norm.includes(r.pattern)) match = r;
  }
  if (match) {
    return {
      isDebit: match.flipSign ? !baseIsDebit : baseIsDebit,
      category: match.category ?? null,
    };
  }

  return { isDebit: baseIsDebit, category: null };
}
