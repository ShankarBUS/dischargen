/**
 * <quantity-unit> custom element.
 *
 * A paired number + unit selector that supports:
 *  - Free numeric entry ("value")
 *  - Unit selection from a provided list ("units", comma-separated or loaded via setSource)
 *  - Optional placeholder for the number part
 *
 * Attributes (all optional):
 *  - units: Comma separated list of unit strings. Example: "mg,mL,g"
 *  - value: Initial numeric value (string accepted; no parsing enforced here)
 *  - unit:  Initial unit selection
 *  - placeholder: Placeholder text for the number <input>
 *
 * Properties:
 *  - value {string}: current raw value from the number input (empty string if unset)
 *  - unit {string}: current selected unit value
 *  - units {string[]} (getter): current list of available unit values
 *  - units (setter): replaces the select options while attempting to preserve previously selected unit
 *
 * Methods:
 *  - setSource(path: string): asynchronously loads a JSON catalog (array) via loadCatalog and sets units
 *
 * Events:
 *  - 'change': Fired whenever either the numeric value or unit changes. Detail payload: { value: string, unit: string }
 */

import { loadCatalog } from "../search_handler.js";

export class QuantityUnitInput extends HTMLElement {
    static get observedAttributes() {
        return ["units", "value", "unit", "placeholder"];
    }

    constructor() {
        super();
        this.classList.add("quantity-unit");
        this._input = document.createElement("input");
        this._input.type = "number";
        this._select = document.createElement("select");
        this.appendChild(this._input);
        this.appendChild(this._select);
        this._input.addEventListener("input", () => this._emit());
        this._select.addEventListener("change", () => this._emit());
    }

    attributeChangedCallback(name, oldV, newV) {
        if (oldV === newV) return;
        if (name === "units") {
            this.units = (newV || "")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
        } else if (name === "value") {
            this.value = newV;
        } else if (name === "unit") {
            this.unit = newV;
        } else if (name === "placeholder") {
            this._input.placeholder = newV || "";
        }
    }

    /**
     * Current numeric value (raw string from input; may be empty).
     * @returns {string}
     */
    get value() {
        return this._input.value;
    }

    /**
     * Set numeric value (null / undefined clears input).
     * @param {string|number|null|undefined} v
     */
    set value(v) {
        this._input.value = v == null ? "" : v;
    }

    /**
     * Selected unit.
     * @returns {string}
     */
    get unit() {
        return this._select.value;
    }

    /**
     * Set selected unit if present in options (silently ignored if not).
     * @param {string} u
     */
    set unit(u) {
        if (u != null) {
            this._select.value = u;
            this._unit = u;
        }
    }

    /**
     * All available unit options.
     * @returns {string[]}
     */
    get units() {
        return Array.from(this._select.options).map((o) => o.value);
    }

    /**
     * Replace the list of units while attempting to preserve the currently selected unit if still present.
     * @param {string[]} arr
     */
    set units(arr) {
        this._select.innerHTML = "";
        (arr || []).forEach((u) => {
            const o = document.createElement("option");
            o.value = u;
            o.textContent = u;
            this._select.appendChild(o);
        });
        if (this._unit && arr && arr.includes(this._unit)) this.unit = this._unit;
    }

    /**
     * Focus the numeric input field.
     */
    focus() {
        this._input.focus();
    }

    /**
     * Load units from an external JSON catalog.
     * Expects the JSON to be an array of strings OR array of objects with a `label` field.
     * @param {string} path Relative or absolute path to catalog JSON.
     * @returns {Promise<void>}
     */
    async setSource(path) {
        const data = await loadCatalog(path);
        if (Array.isArray(data)) {
            if (data.length && typeof data[0] === "object" && data[0] && "label" in data[0]) {
                this.units = data.map((d) => String(d.label || "")).filter(Boolean);
            } else {
                this.units = data;
            }
        }
    }

    _emit() {
        this.dispatchEvent(
            new CustomEvent("change", {
                detail: { value: this.value, unit: this.unit },
                bubbles: true,
            })
        );
    }
}

if (!customElements.get("quantity-unit")) {
    customElements.define("quantity-unit", QuantityUnitInput);
}
