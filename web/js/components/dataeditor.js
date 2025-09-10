// DataEditor custom element
// Provides a tabular editor for an array of homogeneous objects based on a column schema.
// Features:
//  - Configurable columns (key, label, type, default, options, custom editor functions)
//  - Supported builtin types: text, number, select, date, checkbox, textarea
//  - Custom column type via createEditor(rowIndex, colDef, value, commit) returning HTMLElement
//    Optionally supply getValue(el) & setValue(el, value) on the column definition.
//  - Add row button (configurable label) & per-row remove button
//  - Dispatches 'items-changed' (bubbles) whenever data mutates (add/remove/change cell)
//  - Public API: columns (Array), items (Array), addItem(obj?), removeItem(index), clear()
//  - Value alias: value <-> items for convenience.
// Usage Example:
//   const editor = document.createElement('data-editor');
//   editor.columns = [
//     { key: 'name', label: 'Name', type: 'text', placeholder: 'Enter name' },
//     { key: 'qty', label: 'Qty', type: 'number', default: 1 },
//     { key: 'unit', label: 'Unit', type: 'select', options: ['mg','ml','tab'] },
//     { key: 'active', label: 'Active', type: 'checkbox', default: true },
//     { key: 'notes', label: 'Notes', type: 'textarea' },
//     { key: 'custom', label: 'Custom', type: 'custom', createEditor: (row, col, val, commit) => {
//          const b = document.createElement('button'); b.type = 'button'; b.textContent = val ? 'Yes' : 'No';
//          b.addEventListener('click', () => { b.textContent = b.textContent === 'Yes' ? 'No' : 'Yes'; commit(b.textContent === 'Yes'); });
//          return b; }, getValue: el => el.textContent === 'Yes', setValue: (el, v) => { el.textContent = v ? 'Yes':'No'; } }
//   ];
//   editor.items = [{ name:'Paracetamol', qty:1, unit:'tab', active:true, notes:'', custom:false }];
//   editor.addEventListener('items-changed', e => console.log('Changed', e.detail.items));
//   document.body.appendChild(editor);

export class DataEditor extends HTMLElement {
  static get observedAttributes() { return ['add-label']; }

  constructor() {
    super();
    this._columns = [];
    this._items = [];
    this._table = document.createElement('table');
    this._table.className = 'data-table';
    this._thead = document.createElement('thead');
    this._tbody = document.createElement('tbody');
    this._table.appendChild(this._thead);
    this._table.appendChild(this._tbody);
    this.classList.add('data-editor');

    const wrap = document.createElement('div');
    wrap.className = 'table-wrapper data-wrapper';
    wrap.appendChild(this._table);
    this._wrap = wrap;
    this.appendChild(wrap);

    this._addBtn = document.createElement('button');
    this._addBtn.type = 'button';
    this._addBtn.className = 'add-button';
    this._addBtn.textContent = this.getAttribute('add-label') || 'Add';
    this._addBtn.addEventListener('click', () => this.addItem());
    this.appendChild(this._addBtn);
  }

  // Public API
  get columns() { return this._columns.slice(); }
  set columns(cols) {
    if (!Array.isArray(cols)) cols = [];
    this._columns = cols.map(c => ({ ...c }));
    this._renderHeader();
    this._renderBody();
  }

  get items() { return this._items.map(it => ({ ...it })); }
  set items(arr) {
    if (!Array.isArray(arr)) arr = [];
    // Ensure each item has keys for columns; apply defaults
    this._items = arr.map(it => this._withDefaults(it));
    this._renderBody();
    this._emitChange();
  }

  get value() { return this.items; }
  set value(v) { this.items = v; }

  addItem(obj = {}) {
    const item = this._withDefaults(obj);
    this._items.push(item);
    this._appendRow(this._items.length - 1, item);
    this._emitChange();
    return item;
  }

  removeItem(index) {
    if (index < 0 || index >= this._items.length) return;
    this._items.splice(index, 1);
    this._renderBody();
    this._emitChange();
  }

  clear() { this._items = []; this._renderBody(); this._emitChange(); }

  attributeChangedCallback(name, oldVal, newVal) {
    if (name === 'add-label' && this._addBtn) {
      this._addBtn.textContent = newVal || 'Add';
    }
  }

  // Internal helpers
  _withDefaults(obj) {
    const out = { ...obj };
    this._columns.forEach(col => {
      if (!(col.key in out)) {
        if (typeof col.default === 'function') out[col.key] = col.default();
        else if (col.hasOwnProperty('default')) out[col.key] = col.default;
        else out[col.key] = this._defaultForType(col.type);
      }
    });
    return out;
  }

  _defaultForType(t) {
    switch (t) {
      case 'number': return 0;
      case 'checkbox': return false;
      default: return '';
    }
  }

  _renderHeader() {
    const tr = document.createElement('tr');
    this._columns.forEach(col => {
      const th = document.createElement('th');
      th.textContent = col.label || col.key;
      if (col.width) th.style.width = col.width;
      tr.appendChild(th);
    });
    const thRemove = document.createElement('th');
    thRemove.textContent = '';
    tr.appendChild(thRemove);
    this._thead.innerHTML = '';
    this._thead.appendChild(tr);
  }

  _renderBody() {
    this._tbody.innerHTML = '';
    this._items.forEach((item, idx) => this._appendRow(idx, item));
  }

  _appendRow(rowIndex, item) {
    const tr = document.createElement('tr');
    this._columns.forEach(col => {
      const td = document.createElement('td');
      const editor = this._createEditor(col, item[col.key], v => {
        this._commitCellChange(rowIndex, col, editor, v);
      }, rowIndex);
      editor.dataset.key = col.key;
      editor.dataset.row = String(rowIndex);
      td.appendChild(editor);
      tr.appendChild(td);
    });

    // Remove button
    const tdRemove = document.createElement('td');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'remove-button';
    btn.addEventListener('click', () => this.removeItem(rowIndex));
    tdRemove.appendChild(btn);
    tr.appendChild(tdRemove);
    this._tbody.appendChild(tr);
  }

  _createEditor(col, value, commit, rowIndex) {
    // Custom
    if (col.type === 'custom' && typeof col.createEditor === 'function') {
      const el = col.createEditor(rowIndex, col, value, val => commit(val));
      // Allow external later retrieval if they supply setValue
      if (col.setValue) {
        try { col.setValue(el, value); } catch { }
      }
      return el;
    }

    let el;
    switch (col.type) {
      case 'number': {
        el = document.createElement('input');
        el.type = 'number';
        el.value = value ?? '';
        break;
      }
      case 'select': {
        el = document.createElement('select');
        const opts = Array.isArray(col.options) ? col.options : [];
        opts.forEach(o => {
          const opt = document.createElement('option');
          if (typeof o === 'object') { opt.value = o.value ?? o.key ?? o.id ?? ''; opt.textContent = o.label ?? o.name ?? opt.value; }
          else { opt.value = String(o); opt.textContent = String(o); }
          el.appendChild(opt);
        });
        el.value = value ?? '';
        break;
      }
      case 'date': {
        el = document.createElement('input');
        el.type = 'date';
        el.value = value ?? '';
        break;
      }
      case 'checkbox': {
        el = document.createElement('input');
        el.type = 'checkbox';
        el.checked = !!value;
        break;
      }
      case 'textarea': {
        el = document.createElement('textarea');
        el.value = value ?? '';
        break;
      }
      default: {
        el = document.createElement('input');
        el.type = 'text';
        el.value = value ?? '';
      }
    }
    if (col.placeholder && 'placeholder' in el) el.placeholder = col.placeholder;
    el.classList.add('data-cell');
    // Event wiring
    if (col.type === 'checkbox') {
      el.addEventListener('change', () => commit(el.checked));
    } else if (col.type === 'number') {
      el.addEventListener('input', () => {
        const v = el.value.trim();
        commit(v === '' ? null : Number(v));
      });
    } else if (col.type === 'custom') {
      // custom editor is expected to call provided commit; optionally also listen for bubbling input events
    } else {
      const evtName = col.type === 'select' || col.type === 'date' ? 'change' : 'input';
      el.addEventListener(evtName, () => commit(el.value));
    }
    return el;
  }

  _commitCellChange(rowIndex, col, editorEl, newValue) {
    if (!this._items[rowIndex]) return; // row removed
    // If custom column has getValue defined and newValue is undefined, obtain value
    let val = newValue;
    if (col.type === 'custom' && val === undefined && typeof col.getValue === 'function') {
      try { val = col.getValue(editorEl); } catch { val = undefined; }
    }
    this._items[rowIndex][col.key] = val;
    this._emitChange();
  }

  _emitChange() {
    // Emit shallow copy to avoid external direct mutation without going through API
    this.dispatchEvent(new CustomEvent('items-changed', { detail: { items: this.items }, bubbles: true }));
  }
}

// Register new tag
if (!customElements.get('data-editor')) {
  customElements.define('data-editor', DataEditor);
}
