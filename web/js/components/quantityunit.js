// QuantityUnitInput Web Component
// <quantity-unit> with attributes: units (comma separated optional), placeholder, value, unit
// API: properties .value (number or string), .unit (string), .units (array), dispatches 'change' event on modifications

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

    get value() {
        return this._input.value;
    }

    set value(v) {
        this._input.value = v == null ? "" : v;
    }

    get unit() {
        return this._select.value;
    }

    set unit(u) {
        if (u != null) this._select.value = u;
    }

    get units() {
        return Array.from(this._select.options).map((o) => o.value);
    }

    set units(arr) {
        const prev = this.unit;
        this._select.innerHTML = "";
        (arr || []).forEach((u) => {
            const o = document.createElement("option");
            o.value = u;
            o.textContent = u;
            this._select.appendChild(o);
        });
        if (prev && arr && arr.includes(prev)) this.unit = prev;
    }

    focus() {
        this._input.focus();
    }

    async setSource(path) {
        const data = await loadCatalog(path);
        if (Array.isArray(data)) this.units = data;
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
