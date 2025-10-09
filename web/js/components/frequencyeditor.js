/**
 * <frequency-editor> custom element.
 *
 * Dual-mode control for choosing a medication frequency either:
 *  1. From a preset catalog (e.g. OD, BD, TDS, QID etc.) – "preset" mode
 *  2. By manually specifying per-time-of-day fractional / numeric doses – "manual" mode
 *
 * Data model:
 *  - Value (string): if in preset mode, the chosen preset label; if in manual mode, a pattern string like
 *    "1-0-1" or variable-length forms (evening part optional depending on logic).
 *  - Internally stores multipliers in an object { morning, afternoon, evening, night } each a number (can be fractional like 0.5).
 *
 * Public Properties:
 *  - value {string}: current pattern or preset label; setting attempts to select appropriate mode automatically.
 *  - total {number}: either multiplier from the preset (parsed via parseFraction for presets) or
 *                    aggregated sum of all four multipliers from manual input.
 *  - mode {"preset"|"manual"}: active editing mode.
 *
 * Events:
 *  - 'frequency-change': Dispatched on any user-visible change. Detail payload: { value: string, total: number }
 *
 * Preset Source Structure (drug_frequencies.json expected format):
 *  [ { label: string, multiplier: string | number, ... } , ... ]
 *  - label: displayed & stored value
 *  - multiplier: aggregated dose (string fractions allowed)
 *
 * Accessibility / UX notes:
 *  - Manual inputs are simple text fields (allowing fractions like 1/2). They are shown/hidden based on mode.
 *  - Toggle button switches between modes while preserving underlying numeric multipliers.
 */

import { loadCatalog } from "../search_handler.js";
import { parseFraction, parseFrequency } from "../utils/prescription.js";

const PRESET_SOURCE = "data/drug_frequencies.json";

const edit_svg = `<svg xmlns="http://www.w3.org/2000/svg" class="icon" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M3 8.75A2.25 2.25 0 0 1 5.25 6.5h13.5a2.25 2.25 0 0 1 2.123 1.504L20.715 8h-.002c-.466 0-.932.1-1.365.297A.75.75 0 0 0 18.75 8H15.5v3.853l-1.5 1.5V8h-4v6h3.353l-.865.865a3.7 3.7 0 0 0-.508.635H5.25A2.25 2.25 0 0 1 3 13.25zM5.25 8a.75.75 0 0 0-.75.75v4.5c0 .414.336.75.75.75H8.5V8zm15.465 1h-.002c-.585 0-1.17.223-1.615.67l-5.902 5.902a2.7 2.7 0 0 0-.707 1.247l-.458 1.831a1.087 1.087 0 0 0 1.319 1.318l1.83-.457a2.7 2.7 0 0 0 1.248-.707l5.902-5.902A2.286 2.286 0 0 0 20.715 9"/></svg>`;

export class FrequencyEditor extends HTMLElement {
    constructor() {
        super();
        this._mode = "preset"; // 'preset' | 'manual'
        this._presets = [];
        this._value = "";
        this._multipliers = { morning: 0, afternoon: 0, evening: 0, night: 0 };
        
        /** @type {HTMLSelectElement} */
        this._select = document.createElement("select");
        this._select.className = "freq-select";

        /** @type {HTMLDivElement} */
        this._manualWrap = document.createElement("div");
        this._manualWrap.className = "freq-manual hidden";

        /** @type {HTMLButtonElement} */
        this._toggleBtn = document.createElement("button");
        this._toggleBtn.type = "button";
        this._toggleBtn.className = "freq-toggle";
        this._toggleBtn.title = "Edit";
        this._toggleBtn.innerHTML = edit_svg;

        /** Root container */
        this._root = document.createElement("div");
        this._root.className = "frequency-editor";
        this._root.appendChild(this._select);
        this._root.appendChild(this._manualWrap);
        this._root.appendChild(this._toggleBtn);
        this.appendChild(this._root);
        this._buildManualInputs();
    }

    connectedCallback() {
        this._wire();
        this._ensureLoaded();
        this._applyValueToUI();
    }

    /**
     * Lazy-load preset catalog if not yet loaded.
     * @private
     * @returns {Promise<void>}
     */
    async _ensureLoaded() {
        if (this._presets.length) return;
        try {
            this._presets = await loadCatalog(PRESET_SOURCE);
            this._populateSelect();
        } catch {
            /* silent */
        }
    }

    /**
     * Populate the select element with loaded preset options.
     * If no existing value, selects first preset and emits initial change.
     * @private
     */
    _populateSelect() {
        this._select.innerHTML = this._presets
            .map(
                (p) =>
                    `<option value="${p.label}">${p.label}</option>`
            )
            .join("");
        if (this._value)
            this._select.value = this._value;
        else if (this._presets.length) {
            this._select.selectedIndex = 0;
            this._value = this._presets[0].label;
            this._applyMultipliersFromText();
            this._emit();
        }
    }

    /**
     * Create the four manual dose input fields (morning/afternoon/evening/night).
     * Stored in this._manualInputs keyed by part name.
     * @private
     */
    _buildManualInputs() {
        const fields = ["morning", "afternoon", "evening", "night"];
        this._manualInputs = {};
        this._manualWrap.innerHTML = "";
        fields.forEach((f) => {
            const inp = document.createElement("input");
            inp.type = "text";
            inp.size = 2;
            inp.placeholder = f.charAt(0).toUpperCase() + f.slice(1);
            inp.dataset.part = f;
            this._manualInputs[f] = inp;
            this._manualWrap.appendChild(inp);
        });
    }

    /**
     * Wire all event handlers for select, toggle button, and manual inputs.
     * @private
     */
    _wire() {
        this._toggleBtn.addEventListener("click", () => {
            this.mode = this._mode === "preset" ? "manual" : "preset";
            this._emit();
        });
        this._select.addEventListener("change", () => {
            this._value = this._select.value;
            this._applyMultipliersFromText();
            this._emit();
        });
        Object.values(this._manualInputs || {}).forEach((inp) => {
            inp.addEventListener("input", () => {
                this._collectManual();
                this._value = this._patternFromManual();
                this._emit();
            });
        });
    }

    /**
     * Apply visual changes when switching modes and emit updated state.
     * @private
     */
    _applyMode() {
        if (this._mode === "manual") {
            this._toggleBtn.classList.add("active");
            this._select.classList.add("hidden");
            this._manualWrap.classList.remove("hidden");
            this._loadMultipliers();
        } else {
            this._toggleBtn.classList.remove("active");
            this._manualWrap.classList.add("hidden");
            this._select.classList.remove("hidden");
            this._value = this._select.value;
        }
        //this._emit();
    }

    /**
     * Push internal multipliers into manual input fields (after parsing value if needed).
     * @private
     */
    _loadMultipliers() {
        if (this._value) {
            this._applyMultipliersFromText();
        }
        Object.entries(this._multipliers).forEach(([k, v]) => {
            if (this._manualInputs[k])
                this._manualInputs[k].value = v ? String(v) : "";
        });
    }

    /**
     * Parse current value (preset label or manual pattern) into multiplier object.
     * Uses parseFrequency for robust decoding of standard codes.
     * @private
     */
    _applyMultipliersFromText() {
        if (!this._value || typeof this._value !== "string" || this._value.trim() === "") return;
        const code = (this._value || "").toUpperCase();
        const freq = parseFrequency(code);
        this._multipliers = { morning: freq.morning, afternoon: freq.afternoon, evening: freq.evening, night: freq.night };
    }

    /**
     * Read raw text from manual inputs and parse each part as a fraction / number.
     * @private
     */
    _collectManual() {
        this._multipliers = {
            morning: parseFraction(this._manualInputs.morning.value),
            afternoon: parseFraction(this._manualInputs.afternoon.value),
            evening: parseFraction(this._manualInputs.evening.value),
            night: parseFraction(this._manualInputs.night.value),
        };
    }

    /**
     * Build pattern string from current multipliers.
     * Example output: "1-1-1-1" (evening segment is included only if > 0, matching previous heuristic).
     * NOTE: Existing logic conditionally inserts evening component which may produce asymmetric patterns.
     * @returns {string}
     * @private
     */
    _patternFromManual() {
        return `${this._multipliers.morning}-${this._multipliers.afternoon}` +
            `${(this._multipliers.evening && this._multipliers.evening > 0) ? `-${this._multipliers.evening}` : ""}` +
            `-${this._multipliers.night}`;
    }

    _aggregate() {
        return (
            this._multipliers.morning +
            this._multipliers.afternoon +
            this._multipliers.evening +
            this._multipliers.night
        );
    }

    /**
     * Reflect the internal value into current UI mode (select or manual inputs).
     * @private
     */
    _applyValueToUI() {
        this._applyMultipliersFromText();
        if (this._mode === "preset") {
            this._select.value = this._value || "";
        } else {
            Object.entries(this._multipliers).forEach(([k, v]) => {
                if (this._manualInputs[k])
                    this._manualInputs[k].value = v ? String(v) : "";
            });
        }
    }

    /**
     * Dispatch change event with current value & total.
     * @private
     */
    _emit() {
        this.dispatchEvent(
            new CustomEvent("frequency-change", {
                detail: { value: this.value, total: this.total },
            })
        );
    }

    // Public API

    /**
     * Current value according to active mode.
     * @returns {string}
     */
    get value() {
        return this._mode === "preset"
            ? this._value
            : this._patternFromManual();
    }
    /**
     * Set current value, auto-detecting if it matches a known preset (switches mode accordingly).
     * @param {string} v
     */
    set value(v) {
        if (!v || typeof v !== "string" || v.trim() === "") return;
        this._value = v;
        if (this._presets.length && this._presets.find(p => p.label === this._value)) {
            this.mode = "preset";
        } else {
            this.mode = "manual";
        }
        this._applyValueToUI();
    }

    /**
     * Aggregated total dosage count (fraction-safe for presets).
     * @returns {number}
     */
    get total() {
        if (this._mode === "preset") {
            const val = this._presets.find(p => p.label === this._value)?.multiplier || 0;
            return parseFraction(val);
        }

        return this._aggregate();
    }

    /**
     * Current mode (preset/manual).
     * @returns {"preset"|"manual"}
     */
    get mode() {
        return this._mode;
    }
    /**
     * Switch mode explicitly (only if valid) and update UI.
     * @param {"preset"|"manual"} m
     */
    set mode(m) {
        if (m && (m === "preset" || m === "manual")) {
            this._mode = m;
            this._applyValueToUI();
            this._applyMode();
        }
    }
}

customElements.define("frequency-editor", FrequencyEditor);
