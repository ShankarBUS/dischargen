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

/**
 * Utility: format a number into a compact fraction string when possible (¼, ½, ¾), else trim trailing zeros.
 * @param {number} n
 */
export function formatFraction(n) {
    if (n == null) return "";
    const num = Number(n);
    if (!isFinite(num)) return "";
    if (Number.isInteger(num)) return String(num);
    const m = Math.round(num * 4);
    if (m === 1) return "¼";
    if (m === 2) return "½";
    if (m === 3) return "¾";
    return String(+num.toFixed(2)).replace(/\.00$/, "");
}

/**
 * Format a frequency expression into a dosage-split string using base dosage and unit.
 * Example: base=2, unit="tablet", freq="1-0-1" => "2 tablet - 0 - 2 tablet"
 * If unit is falsy, omits unit in tokens.
 * @param {number} baseDose Numeric base dose (e.g., 2)
 * @param {string} unit Unit label (e.g., 'tablet')
 * @param {string} freqText Frequency text (e.g., '1-0-1', '1-0-1-0', 'BD')
 * @returns {string}
 */
export function formatFrequencySplit(baseDose, unit, freqText) {
    const parts = parseFrequency(String(freqText || "").toUpperCase());
    const values = (parts.evening || 0) !== 0
        ? [parts.morning || 0, parts.afternoon || 0, parts.evening || 0, parts.night || 0]
        : [parts.morning || 0, parts.afternoon || 0, parts.night || 0];
    const tokens = values.map((mult, i) => {
        const amount = (Number(baseDose) || 0) * (mult || 0);
        if (!amount) return "0";
        const amtStr = formatFraction(amount);
        return unit ? `${amtStr} ${unit}` : `${amtStr}`;
    });
    return tokens.join(" - ");
}

/**
 * Check if a frequency text is a known abbreviation we should display as-is.
 * @param {string} txt
 */
export function isAbbrevFrequency(txt) {
    return /^(OD|BD|TDS|QID|HS)$/i.test(txt || "");
}

/**
 * Coerce common value shapes to string (string|number|{label}|{value}).
 * @param {any} v
 * @returns {string}
 */
export function toTextLoose(v) {
    if (v == null) return "";
    if (typeof v === "string" || typeof v === "number") return String(v);
    if (typeof v === "object") {
        if (v.label != null) return String(v.label);
        if (typeof v.value !== "object" && v.value != null) return String(v.value);
    }
    return "";
}

export function getValue(num) {
    if (!num) return 0;
    if (typeof num === "number") return isFinite(num) ? num : 0;
    if (typeof num === "string") {
        const n = Number(num);
        return isFinite(n) ? n : 0;
    }
    const n = Number(num.value);
    return isFinite(n) ? n : 0;
}

export function getUnit(num) {
    if (!num) return "";
    if (typeof num === "object" && num.unit) return String(num.unit);
    return "";
}

export function formatQuantity(d) {
    if (!d) return "";
    if (typeof d === "string" || typeof d === "number") return String(d);
    const val = d.value != null ? String(d.value) : "";
    const unit = d.unit ? " " + d.unit : "";
    return (val + unit).trim();
}

/**
 * Build a unified display model for a medication entry.
 * Implements the standard-mode logic: name, dosage (hidden if split used),
 * frequency (either known abbreviation or split string using dosage), route, duration.
 * @param {any} med A medication item with possible fields: name, dosage, route, frequency, duration, quantity
 * @returns {{name:string,dose:string,route:string,duration:string,quantity:string,frequency:string,hideFreq:boolean}}
 */
export function computeMedicationDisplay(med) {
    const name = toTextLoose(med?.name);
    let dose = formatQuantity(med?.dosage);
    const route = toTextLoose(med?.route);
    const duration = formatQuantity(med?.duration);
    const quantity = formatQuantity(med?.quantity);
    const frequency = toTextLoose(med?.frequency);

    let hideFreq = false;
    if (frequency && !isAbbrevFrequency(frequency)) {
        const base = getValue(med?.dosage);
        const unit = getUnit(med?.dosage);
        const split = formatFrequencySplit(base, unit, frequency);
        if (split) {
            dose = split;
            hideFreq = true; // When split is used, hide inline frequency
        }
    }

    return { name, dose, route, duration, quantity, frequency, hideFreq };
}
