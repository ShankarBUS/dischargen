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
        this._resultsBox.className = 'ac-results hidden';

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
        this._timer = setTimeout(async () => {
            try {
                let results = [];
                if (typeof this.fetcher === 'function') {
                    results = await this.fetcher(q);
                }
                this._results = Array.isArray(results) ? results : [];
                this._renderResults();
            } catch { }
        }, this.debounceMs);
    }

    _renderResults() {
        const q = this._lastQuery;
        const items = this._results;
        if (!items.length) {
            this._resultsBox.innerHTML = `<div data-idx='-1'>Add: ${_escape(q)}</div>`;
            this._activeIndex = -1;
        } else {
            this._resultsBox.innerHTML = items.map((it, i) => {
                const label = _escape(this.getItemLabel(it) || '');
                const secondary = _escape(this.getItemSecondary(it) || '');
                return secondary ? `<div data-idx='${i}'><span>${label}</span><span>${secondary}</span></div>` : `<div data-idx='${i}'>${label}</div>`;
            }).join('');
            this._activeIndex = 0;
        }
        this._highlight();
        this._resultsBox.classList.remove('hidden');
    }

    _highlight() {
        [...this._resultsBox.children].forEach((el, idx) => {
            el.classList.toggle('active', idx === this._activeIndex);
        });
    }

    _onKeyDown(e) {
        const visible = !this._resultsBox.classList.contains('hidden');
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
    }

    _hideResults() {
        this._resultsBox.classList.add('hidden');
        this._resultsBox.innerHTML = '';
    }
}

function _escape(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
};

// Define with a valid custom element name (must contain a hyphen)
if (!customElements.get('auto-complete-box')) {
    customElements.define('auto-complete-box', AutoCompleteBox);
}
