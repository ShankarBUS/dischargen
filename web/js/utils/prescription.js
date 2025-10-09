import { loadCatalog } from "../search_handler.js";

/**
 * Convert an arbitrary value into a safe number.
 * Empty values (undefined, null, empty string) and non–numeric inputs resolve to 0 instead of NaN.
 *
 * @param {unknown} v Any incoming value that should represent a number.
 * @returns {number} Parsed numeric value, or 0 when not a finite number.
 */
export function toNumberSafe(v) {
    if (v === undefined || v === null || v === "") return 0; // Treat blank-like inputs as zero
    const n = Number(v);
    return isNaN(n) ? 0 : n; // Collapse NaN to 0
}

/**
 * Parse a numeric or fractional string (e.g. "1", "2.5", "1/2") into a number.
 * Returns 0 for invalid / unrecognized inputs or division by zero.
 *
 * @param {string|undefined|null} str Raw string possibly representing a number or fraction.
 * @returns {number} The parsed value, or 0 on failure.
 */
export function parseFraction(str) {
    if (!str) return 0;
    str = str.trim();
    if (/^\d+(?:\.\d+)?$/.test(str)) return parseFloat(str); // Plain integer / float
    const m = str.match(/^(\d+)\/(\d+)$/); // Simple fraction pattern a/b
    if (m) {
        const a = parseFloat(m[1]);
        const b = parseFloat(m[2]);
        if (b) return a / b;
    }
    return 0;
}

/**
 * Convert a duration object to days. Recognizes units starting with:
 *   day, week (~7 days), month (~30 days), year (365 days). Unknown units return the numeric value unchanged.
 * Ignores / returns 0 for falsy or non-numeric values.
 *
 * @typedef {Object} Duration
 * @property {number|string} value Raw numeric value or numeric string.
 * @property {string} [unit] Unit label (e.g. 'days', 'weeks', 'months', 'years'). Case-insensitive, prefix match.
 *
 * @param {Duration|undefined|null} duration Duration-like object.
 * @returns {number} Equivalent number of days (approximate for months/years).
 */
export function durationToDays(duration) {
    if (!duration) return 0;
    const value = toNumberSafe(duration.value);
    const unit = (duration.unit || "").toLowerCase();
    if (!value) return 0;
    if (unit.startsWith("day")) return value;
    if (unit.startsWith("week")) return value * 7;
    if (unit.startsWith("month")) return value * 30; // Approximate month length
    if (unit.startsWith("year")) return value * 365; // Non-leap approximation
    return value; // Fall back: assume already in days
}

/**
 * Internal canonical mapping for common frequency abbreviations to dose presence across day parts.
 * Indices correspond to: morning, afternoon, evening, night.
 * @type {Record<string, [number, number, number, number]>}
 */
const freq_map = {
    OD: [1, 0, 0, 0],   // Once daily (morning)
    BD: [1, 0, 0, 1],   // Twice daily (morning, evening)
    TDS: [1, 1, 0, 1],  // Three times daily (morning, afternoon, night)
    QID: [1, 1, 1, 1],  // Four times daily
    HS: [0, 0, 0, 1],   // At night (hora somni)
};

/**
 * Parse a frequency expression into day-part dose counts.
 * Accepts several forms:
 *  - Abbreviations (OD, BD, TDS, QID, HS)
 *  - Single number ("2" => morning:2)
 *  - Hyphen-separated parts ("1-0-1", "1-0-1-0", "1-0.5-0-1/2") allowing whole, decimal, or fractional tokens
 *    Mapping by part count:
 *      1 => morning
 *      2 => morning, night
 *      3 => morning, afternoon, night (evening omitted)
 *      4 => morning, afternoon, evening, night
 * Any invalid / unrecognized pattern returns zeros for all day parts.
 *
 * @param {string|undefined|null} freq Raw frequency string.
 * @returns {{morning:number, afternoon:number, evening:number, night:number}} Structured frequency object.
 */
export function parseFrequency(freq) {
    if (!freq) return { morning: 0, afternoon: 0, evening: 0, night: 0 };
    freq = freq.trim();
    if (/^\d+(?:\.\d+)?$/.test(freq)) return { morning: parseFloat(freq) }; // Single numeric dose (assumed morning only)
    else if (freq_map[freq]) {
        const [m, a, e, n] = freq_map[freq];
        return { morning: m, afternoon: a, evening: e, night: n };
    }
    else if (/^[\d\-\/]+$/.test(freq)) { // pattern with digits, dashes, slashes (supports fractions)
        const parts = freq.split("-").map((p) => parseFraction(p));
        if (parts.length === 1) return { morning: parts[0] };
        if (parts.length === 2) return { morning: parts[0], night: parts[1] };
        if (parts.length === 3)
            return { morning: parts[0], afternoon: parts[1], night: parts[2] };
        if (parts.length === 4)
            return {
                morning: parts[0],
                afternoon: parts[1],
                evening: parts[2],
                night: parts[3],
            };
    }

    return { morning: 0, afternoon: 0, evening: 0, night: 0 }; // Fallback: unknown format
}
