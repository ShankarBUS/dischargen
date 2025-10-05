// AutoCompleteBox custom element
// Usage:
//   const ac = new AutoCompleteBox();
//   ac.placeholder = 'Search...';
//   ac.fetcher = async (q) => [/* array of items (strings or objects) */];
//   ac.getItemLabel = (item) => /* string label */;
//   ac.getItemSecondary = (item) => /* optional secondary string */;
//   ac.addEventListener('text-changed', (e) => console.debug(e.detail.value));
//   ac.addEventListener('commit', (e) => console.log(e.detail));

export class AutoCompleteBox extends HTMLElement {
    static get observedAttributes() { return ['placeholder']; }

    constructor() {
        super();

        this.fetcher = null;
        this.getItemLabel = (item) => typeof item === 'string' ? item : (item && (item.label || item.description || item.name || item.value || item.code)) || '';
        this.getItemSecondary = (item) => null;
        this.debounceMs = 250;

        this._timer = null;
        this._results = [];
        this._activeIndex = -1;
        this._lastQuery = '';

        this.classList.add('autocomplete');
        this._input = document.createElement('input');
        this._input.type = 'text';
        this._input.autocomplete = 'off';
        this._resultsBox = document.createElement('div');
        this._resultsBox.className = 'ac-popover';
        this._resultsBox.setAttribute('popover', 'auto');
        // anchor: set via ID for input
        this._input.id = this._input.id || ('ac_' + Math.random().toString(36).slice(2));
        // this._resultsBox.setAttribute('anchor', this._input.id);
        this._input.style.setProperty('anchor-name', '--' + this._input.id);
        this._resultsBox.style.setProperty('position-anchor', '--' + this._input.id);

        this.appendChild(this._input);
        this.appendChild(this._resultsBox);
        this.tabIndex = -1;

        this._onInput = this._onInput.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onMouseDown = this._onMouseDown.bind(this);
        this._onFocus = this._onFocus.bind(this);
    }

    connectedCallback() {
        this._input.addEventListener('input', this._onInput);
        this._input.addEventListener('keydown', this._onKeyDown);
        this._resultsBox.addEventListener('mousedown', this._onMouseDown);
        this.addEventListener('focus', this._onFocus);

        if (this.hasAttribute('placeholder')) {
            this._input.placeholder = this.getAttribute('placeholder') || '';
        }
    }

    disconnectedCallback() {
        this._input.removeEventListener('input', this._onInput);
        this._input.removeEventListener('keydown', this._onKeyDown);
        this._resultsBox.removeEventListener('mousedown', this._onMouseDown);
        this.removeEventListener('focus', this._onFocus);
        if (this._timer) clearTimeout(this._timer);
    }

    attributeChangedCallback(name, oldVal, newVal) {
        if (name === 'placeholder' && this._input) {
            this._input.placeholder = newVal || '';
        }
    }

    get value() { return this._input.value; }
    set value(v) { this._input.value = v || ''; }
    get placeholder() { return this._input ? this._input.placeholder : (this.getAttribute('placeholder') || ''); }
    set placeholder(v) { this.setAttribute('placeholder', v || ''); }
    focus() { this._input.focus(); }
    clear() { this.value = ''; this._hideResults(); }

    _onFocus() {
        if (this._input) this._input.focus();
    }

    _onInput() {
        const q = (this._input.value || '').trim();
        this._lastQuery = q;
        this.dispatchEvent(new CustomEvent('text-changed', { detail: { value: q }, bubbles: true }));
        if (this._timer) clearTimeout(this._timer);
        if (!q) { this._hideResults(); return; }
        // Show immediate custom option (Add: q) before fetch completes
        this._renderResults(true); // pending state
        this._timer = setTimeout(async () => {
            try {
                const fetchQuery = this._lastQuery;
                let results = [];
                if (typeof this.fetcher === 'function') {
                    results = await this.fetcher(fetchQuery);
                }
                // Ignore if query changed meanwhile
                if (fetchQuery !== this._lastQuery) return;
                this._results = Array.isArray(results) ? results : [];
                this._renderResults(false);
            } catch { }
        }, this.debounceMs);
    }

    // Render results list.
    // if the results are pending, then only show the Add option (custom entry) while fetch in progress.
    _renderResults(pending = false) {
        const q = this._lastQuery;
        if (!q) { this._hideResults(); return; }
        let html = `<div data-idx='-1' class='ac-add-option'>Add: ${_escape(q)}</div>`;
        if (!pending && this._results.length) {
            // Avoid duplicating the same label as custom add option
            const qLower = q.toLowerCase();
            const filtered = this._results.filter(it => (this.getItemLabel(it) || '').trim().toLowerCase() !== qLower);
            html += filtered.map((it, i) => {
                const label = _escape(this.getItemLabel(it) || '');
                const secondary = _escape(this.getItemSecondary(it) || '');
                return secondary ? `<div data-idx='${i}'><span>${label}</span><span>${secondary}</span></div>` : `<div data-idx='${i}'>${label}</div>`;
            }).join('');
            // Re-index mapping still works because we use original i for data-idx; filtered keeps order.
        }
        this._resultsBox.innerHTML = html;
        this._activeIndex = 0;
        this._highlight();
        this._showPopover();
    }

    _highlight() {
        [...this._resultsBox.children].forEach((el, idx) => {
            el.classList.toggle('active', idx === this._activeIndex);
        });
    }

    _onKeyDown(e) {
        const visible = this._resultsBox.matches(':popover-open');
        if (!visible) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); this._activeIndex = Math.min(this._activeIndex + 1, this._resultsBox.children.length - 1); this._highlight(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); this._activeIndex = Math.max(this._activeIndex - 1, 0); this._highlight(); }
        else if (e.key === 'Enter') { e.preventDefault(); this._commitSelection(); }
        else if (e.key === 'Escape') { this._hideResults(); }
    }

    _onMouseDown(e) {
        const div = e.target.closest('div[data-idx]');
        if (!div) return;
        this._activeIndex = [...this._resultsBox.children].indexOf(div);
        this._commitSelection();
    }

    _commitSelection() {
        const nodes = [...this._resultsBox.children];
        let fromSuggestion = false;
        let item = null;
        if ((nodes.length === 0 || this._activeIndex === -1) && this._lastQuery) {
            this.value = this._lastQuery;
        } else {
            const node = nodes[this._activeIndex];
            if (!node) return;
            const idx = parseInt(node.getAttribute('data-idx'), 10);
            if (idx > -1) {
                item = this._results[idx];
                fromSuggestion = true;
                const label = this.getItemLabel(item);
                this.value = label || '';
            } else {
                this.value = this._lastQuery;
            }
        }
        const detail = { value: this.value, item, fromSuggestion };
        this.dispatchEvent(new CustomEvent('commit', { detail, bubbles: true }));
        this._hideResults();
        this._results = [];
        this._activeIndex = -1;
        if (this._timer) clearTimeout(this._timer);
    }

    _hideResults() {
        if (this._resultsBox.matches(':popover-open')) {
            this._resultsBox.hidePopover();
        }
        this._resultsBox.innerHTML = '';
    }

    _showPopover() {
        try {
            if (!this._resultsBox.matches(':popover-open')) {
                this._resultsBox.showPopover();
            }
        } catch { /* browser unsupported */ }
    }
}

function _escape(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
};

// Define with a valid custom element name (must contain a hyphen)
if (!customElements.get('auto-complete-box')) {
    customElements.define('auto-complete-box', AutoCompleteBox);
}
