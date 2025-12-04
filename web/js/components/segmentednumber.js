/**
 * <segmented-number> custom element.
 * A compact multi-part numeric input that collects 2+ numeric segments and outputs
 * a formatted composite string.
 *
 * Use cases: BP (systolic/diastolic), dimensions (L x W x H), ranges (min–max), ratios.
 *
 * Attributes:
 *  - segments: Comma separated segment keys (e.g. "systolic,diastolic")
 *  - separator: String placed between segments when no explicit format is provided (default: '/')
 *  - format: Optional template with placeholders like "{systolic}/{diastolic}" or "{L} x {W} x {H}".
 *  - values: Optional initial values as comma separated numbers (e.g. "120,80") matching segment order.
 *  - placeholder: Optional placeholder for each empty segment (shown inside each input if provided).
 *  - required: If present (boolean), adds basic required validation (checks all segments non-empty).
 *
 * Properties:
 *  - value {string}: formatted output string (read/write). Setting parses and updates segments if possible.
 *  - segments {object}: map of segmentKey -> string numeric value.
 *  - segmentKeys {string[]} (getter): ordered list of segment keys.
 *  - rawValues {string[]} (getter): ordered raw segment input values.
 *
 * Events:
 *  - 'change': Fired whenever any segment value changes. detail: { value: string, segments: {..}, valid: boolean }
 *
 * Methods:
 *  - focusFirst(): focuses the first input.
 *  - clear(): empties all inputs.
 *
 * Parsing notes:
 *  - If format is supplied and value is set programmatically, the component attempts to extract
 *    values by matching placeholders greedily; if that fails it falls back to splitting by separator.
 *  - Empty segments are represented by '' and omitted from validation success.
 */

export class SegmentedNumber extends HTMLElement {
    static get observedAttributes() {
        return ["segments", "separator", "format", "values", "placeholder", "required"];
    }

    constructor() {
        super();
        this.classList.add("segmented-number");
        this._segmentKeys = ["a", "b"]; // default two segments
        this._separator = "/";
        this._format = null; // null => use separator join
        this._inputs = [];
        this._placeholder = "";
        this._required = false;
    this._build();
    }

    attributeChangedCallback(name, oldV, newV) {
        if (oldV === newV) return;
        if (name === "segments") {
            const list = (newV || "")
                .split(",")
                .map(s => s.trim())
                .filter(Boolean);
            if (list.length >= 2) {
                this._segmentKeys = list;
                this._rebuildInputs();
            }
        } else if (name === "separator") {
            this._separator = newV || "/";
            this._rebuildInputs();
            this._emit();
        } else if (name === "format") {
            this._format = newV && newV.trim() ? newV.trim() : null;
            this._rebuildInputs();
            this._emit();
        } else if (name === "values") {
            this._applyValuesString(newV || "");
        } else if (name === "placeholder") {
            this._placeholder = newV || "";
            this._inputs.forEach(inp => inp.placeholder = this._placeholder);
        } else if (name === "required") {
            this._required = newV !== null;
            this._validate();
        }
    }

    // DOM build
    _build() {
        this._container = document.createElement("div");
        this._container.className = "seg-wrap";
        this.appendChild(this._container);
        this._rebuildInputs();
    }

    _rebuildInputs() {
        this._container.innerHTML = "";
        this._inputs = [];
        this._segmentKeys.forEach((key, idx) => {
            const inp = document.createElement("input");
            inp.type = "number";
            inp.inputMode = "decimal";
            inp.dataset.key = key;
            if (this._placeholder) inp.placeholder = this._placeholder;
            inp.addEventListener("input", () => this._emit());
            this._inputs.push(inp);
            this._container.appendChild(inp);
            if (idx < this._segmentKeys.length - 1) {
                const sepSpan = document.createElement("span");
                sepSpan.className = "seg-sep";
                sepSpan.textContent = this._format ? this._guessInlineSeparator(idx) : this._separator;
                this._container.appendChild(sepSpan);
            }
        });
        this._emit();
    }

    _guessInlineSeparator(idx) {
        // Heuristic: in format string, look between placeholders {key} occurrences
        if (!this._format) return this._separator;
        const pattern = this._segmentKeys.map(k => `{${k}}`).join("(.+?)");
        const re = new RegExp(pattern);
        const m = re.exec(this._format);
        if (m && m[idx + 1]) return m[idx + 1].trim();

        return this._separator;
    }

    _applyValuesString(str) {
        const parts = str.split(",").map(s => s.trim());
        this._segmentKeys.forEach((k, i) => {
            if (this._inputs[i]) this._inputs[i].value = parts[i] || "";
        });
        this._emit();
    }

    _validate() {
        if (!this._required) {
            this.removeAttribute("aria-invalid");
            return true;
        }
        const allFilled = this._inputs.every(inp => inp.value.trim() !== "");
        if (!allFilled) this.setAttribute("aria-invalid", "true");
        else this.removeAttribute("aria-invalid");
        return allFilled;
    }

    _emit() {
        const detail = { value: this.value, segments: this.segments, valid: this._validate() };
        this.dispatchEvent(new CustomEvent("change", { detail, bubbles: true }));
    }

    connectedCallback() {
        // Basic accessibility wiring
        if (!this.hasAttribute('role')) this.setAttribute('role', 'group');
        if (!this.getAttribute('aria-label')) {
            // Attempt constructing a label from segment keys if host doesn't provide one.
            this.setAttribute('aria-label', this._segmentKeys.join(' '));
        }
    }

    // Public API --------------------------------------------------------------
    get segmentKeys() { return this._segmentKeys.slice(); }

    get segments() {
        const obj = {};
        this._segmentKeys.forEach((k, i) => { obj[k] = this._inputs[i] ? this._inputs[i].value : ""; });
        return obj;
    }

    get rawValues() { return this._inputs.map(inp => inp.value); }

    get value() {
        const vals = this.rawValues.filter(v => v !== "");
        if (vals.length === 0) return "";
        if (this._format) {
            // Fill placeholders; leave missing as empty
            let out = this._format;
            this._segmentKeys.forEach((k, i) => {
                out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), this._inputs[i].value || "");
            });
            return out.replace(/\{[^}]+\}/g, "").trim();
        }
        return this._segmentKeys.map((k, i) => this._inputs[i].value || "").join(this._separator);
    }

    set value(v) {
        if (typeof v !== "string") v = String(v ?? "");
        // Try format-based parse first (robust regex based on format)
        if (this._format) {
            const parsed = this._parseValueWithFormat(v);
            if (parsed) {
                this._segmentKeys.forEach((k, i) => {
                    if (this._inputs[i]) this._inputs[i].value = parsed[k] || "";
                });
                this._emit();
                return;
            }
        }
        // Fallback: split by separator
        const parts = v.split(this._separator).map(s => s.trim());
        this._segmentKeys.forEach((k, i) => { if (this._inputs[i]) this._inputs[i].value = parts[i] || ""; });
        this._emit();
    }

    focusFirst() {
        if (this._inputs[0]) this._inputs[0].focus();
    }

    clear() {
        this._inputs.forEach(inp => inp.value = "");
        this._emit();
    }

    _buildRegexFromFormat() {
        if (!this._format) return null;
        const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const tokenPattern = /\{([^}]+)\}/g;
        let lastIndex = 0;
        let source = '^\\s*';
        let m;
        const keysInOrder = [];
        while ((m = tokenPattern.exec(this._format)) !== null) {
            const before = this._format.slice(lastIndex, m.index);
            if (before) source += esc(before).replace(/\s+/g, '\\s*');
            const key = m[1].trim();
            keysInOrder.push(key);
            source += `(?<${key}>[-+]?\\d*\\.?\\d+)`;
            lastIndex = tokenPattern.lastIndex;
        }
        const after = this._format.slice(lastIndex);
        if (after) source += esc(after).replace(/\s+/g, '\\s*');
        source += '\\s*$';
        try {
            const re = new RegExp(source);
            return { re, keysInOrder };
        } catch {
            return null;
        }
    }

    _parseValueWithFormat(v) {
        const built = this._buildRegexFromFormat();
        if (!built) return null;
        const { re, keysInOrder } = built;
        const m = re.exec(v);
        if (!m) return null;
        const out = {};
        keysInOrder.forEach((k) => {
            out[k] = (m.groups && m.groups[k]) ? m.groups[k] : '';
        });
        this._segmentKeys.forEach(k => { if (!(k in out)) out[k] = ''; });
        return out;
    }
}

if (!customElements.get("segmented-number")) {
    customElements.define("segmented-number", SegmentedNumber);
}
