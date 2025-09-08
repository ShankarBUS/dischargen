/* Conditional evaluator */
// Supports simple binary expressions like: patient_sex=="Female", has_diabetes!=true, age>18, date<="2025-01-01"
export function evaluateCondition(expr, getValue) {
  if (!expr) return true;
  try {
    // tiny parser: split by supported operators (order matters to catch 2-char ops first)
    const m = /(.*?)\s*(==|!=|>=|<=|>|<)\s*(.*)/.exec(expr);
    if (!m) return true;
    let left = m[1].trim();
    const op = m[2];
    let right = m[3].trim();
    // Parse right-hand literal for booleans and quoted strings; keep numbers as-is for ==/!= compatibility
    let rightLiteral = right;
    if (right.toLowerCase() === 'true' || right.toLowerCase() === 'false') rightLiteral = right === 'true'; // boolean
    else if (/^".*"$|^'.*'$/.test(right)) rightLiteral = right.slice(1, -1); // strip quotes

    const currentRaw = getValue(left);
    const current = normalizeValue(currentRaw);
    const cmpTarget = normalizeValue(rightLiteral);

    // Equality operators preserve historical strict compare semantics
    if (op === '==') return current === cmpTarget;
    if (op === '!=') return current !== cmpTarget;

    // Relational operators: try number, then date, else string lexicographic
    const a = toComparable(currentRaw);
    const b = toComparable(parseUnquoted(right));
    if (a === undefined || b === undefined) return false;
    if (typeof a === 'number' && typeof b === 'number') {
      if (op === '>') return a > b;
      if (op === '<') return a < b;
      if (op === '>=') return a >= b;
      if (op === '<=') return a <= b;
    }
    if (a instanceof Date && b instanceof Date) {
      const at = a.getTime(); const bt = b.getTime();
      if (isNaN(at) || isNaN(bt)) return false;
      if (op === '>') return at > bt;
      if (op === '<') return at < bt;
      if (op === '>=') return at >= bt;
      if (op === '<=') return at <= bt;
    }

    // Fallback to string comparison (case-insensitive)
    const as = String(current).toLowerCase();
    const bs = String(cmpTarget).toLowerCase();
    if (op === '>') return as > bs;
    if (op === '<') return as < bs;
    if (op === '>=') return as >= bs;
    if (op === '<=') return as <= bs;

    return false;
  } catch (e) {
    console.warn('Condition error', e); return false;
  }
}

function normalizeValue(v) {
  if (typeof v === 'string') return v.trim();
  if (v === undefined) return '';
  return v;
}

// Turn a string literal (possibly quoted) into a JS value without forcing numbers for ==/!=
function parseUnquoted(s) {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^".*"$|^'.*'$/.test(s)) return s.slice(1, -1);
  // try number
  if (isNumericString(s)) return Number(s);
  // try date
  const d = tryParseDate(s);
  if (d) return d;
  return s;
}

function toComparable(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v;
  if (typeof v === 'boolean') return v ? 1 : 0; // allow boolean ordering if used
  const s = String(v).trim();
  if (isNumericString(s)) return Number(s);
  const d = tryParseDate(s);
  if (d) return d;
  return s;
}

function isNumericString(s) { return /^-?\d+(?:\.\d+)?$/.test(s); }
function tryParseDate(s) { const t = Date.parse(s); return isNaN(t) ? null : new Date(t); }
