import { loadCatalog } from "../search_handler.js";

const quickAddSvg = `<svg xmlns="http://www.w3.org/2000/svg" class="icon" width="128" height="128" viewBox="0 0 24 24"><path fill="currentColor" d="M10.788 3.102c.495-1.003 1.926-1.003 2.421 0l2.358 4.778l5.273.766c1.107.16 1.549 1.522.748 2.303l-.905.882a6.5 6.5 0 0 0-1.517-.616l1.157-1.128l-5.05-.734a1.35 1.35 0 0 1-1.016-.739L11.998 4.04L9.74 8.614a1.35 1.35 0 0 1-1.016.739l-5.05.734l3.654 3.562c.318.31.463.757.388 1.195l-.862 5.029l4.149-2.181c.015.542.098 1.067.238 1.569l-3.958 2.081c-.99.52-2.148-.32-1.96-1.423l.901-5.251l-3.815-3.72c-.801-.78-.359-2.141.748-2.302L8.43 7.88zM23 17.5a5.5 5.5 0 1 0-11 0a5.5 5.5 0 0 0 11 0m-5 .5l.001 2.503a.5.5 0 1 1-1 0V18h-2.505a.5.5 0 0 1 0-1H17v-2.501a.5.5 0 0 1 1 0v2.5h2.497a.5.5 0 0 1 0 1z"/></svg>`;

/**
 * <data-editor> Web Component
 * Lightweight, dependency‑free tabular editor for an array of homogeneous objects.
 *
 * COLUMN DEFINITIONS (public input via .columns):
 *  key        : string (property name on each item) [required]
 *  label      : string (header text; falls back to key)
 *  type       : 'text' | 'number' | 'select' | 'date' | 'checkbox' | 'textarea' | 'custom'
 *  default    : any | () => any  (applied when missing on item)
 *  options    : Array (for select) – values or objects ({ value,label|name })
 *  width      : CSS width for column header/cells
 *  placeholder: string (inputs / textarea)
 *  createEditor(rowIndex, colDef, value, commit) => HTMLElement   (for type==='custom')
 *  getValue(el) => any  (optional for custom)
 *  setValue(el, value)  (optional for custom)
 *
 * QUICK ADD (optional via .quickAdd):
 *  Accepts either: string[] OR { items:string[], matchItem(currentItems, label) -> boolean, onAdd(label)->object }
 *  Supplied buttons create new rows unless duplication detected.
 *
 * EVENTS:
 *  'items-changed' (bubbles): detail = { items: clonedItems }
 *
 * PUBLIC API:
 *  .columns  (get/set array)
 *  .items    (get/set array)
 *  .value    (alias of items)
 *  addItem(obj?) -> item
 *  removeItem(index)
 *  clear()
 *
 * EXAMPLE:
 *  const editor = document.createElement('data-editor');
 *  editor.columns = [
 *    { key:'name', label:'Name', type:'text', placeholder:'Enter name' },
 *    { key:'qty',  label:'Qty',  type:'number', default:1 },
 *    { key:'unit', label:'Unit', type:'select', options:['mg','ml','tab'] },
 *    { key:'active', label:'Active', type:'checkbox', default:true },
 *    { key:'notes', label:'Notes', type:'textarea' },
 *    { key:'custom', label:'Custom', type:'custom', createEditor:(row, col, val, commit) => {
 *        const btn = document.createElement('button');
 *        btn.type='button';
 *        btn.textContent = val ? 'Yes':'No';
 *        btn.addEventListener('click', () => { btn.textContent = btn.textContent==='Yes' ? 'No':'Yes'; commit(btn.textContent==='Yes'); });
 *        return btn;
 *      }, getValue: el => el.textContent==='Yes', setValue:(el,v)=>{ el.textContent = v?'Yes':'No'; } }
 *  ];
 *  editor.items = [{ name:'Paracetamol', qty:1, unit:'tab', active:true, notes:'', custom:false }];
 *  editor.addEventListener('items-changed', e => console.log(e.detail.items));
 *  document.body.appendChild(editor);
 */

export class DataEditor extends HTMLElement {
  static get observedAttributes() {
    return ["add-label"];
  }

  constructor() {
    super();
    // Data state
    this._columnDefs = [];
    this._rowData = [];
    this._quickAddConfig = null;

    // Table structure
    this._tableEl = document.createElement("table");
    this._tableEl.className = "data-table";
    this._theadEl = document.createElement("thead");
    this._tbodyEl = document.createElement("tbody");
    this._tableEl.appendChild(this._theadEl);
    this._tableEl.appendChild(this._tbodyEl);
    this.classList.add("data-editor");

    this._containerEl = document.createElement("div");
    this._containerEl.className = "table-wrapper data-wrapper";
    this._containerEl.appendChild(this._tableEl);
    this.appendChild(this._containerEl);

    // Add row button
    this._addButtonEl = document.createElement("button");
    this._addButtonEl.type = "button";
    this._addButtonEl.className = "add-button";
    this._addButtonEl.textContent = this.getAttribute("add-label") || "Add";
    this._addButtonEl.addEventListener("click", () => this.addItem());
    this.appendChild(this._addButtonEl);

    // Quick-add host
    this._quickAddContainerEl = document.createElement("div");
    this._quickAddContainerEl.className = "data-editor-quickadd";
    this.insertBefore(this._quickAddContainerEl, this._containerEl);

    // Drag & drop indices
    this._dragFromIndex = null;
    this._dragToIndex = null;
    this._installDnD();
    this._ensureDnDStyles();
  }

  // Public API
  /** @returns {Array} shallow copy of column definitions */
  get columns() {
    return this._columnDefs.slice();
  }
  /** @param {Array} cols */
  set columns(cols) {
    if (!Array.isArray(cols)) cols = [];
    this._columnDefs = cols.map((c) => ({ ...c }));
    this._renderHeader();
    this._renderBody();
  }

  get items() {
    return this._cloneItems();
  }
  set items(arr) {
    if (!Array.isArray(arr)) arr = [];
    this._rowData = arr.map((it) => this._applyColumnDefaults(it));
    this._renderBody();
    this._emitItemsChanged();
  }

  // Quick add API
  // Accepts either an array of strings or an object: { items:[], matchItem(fn), onAdd(fn) }
  get quickAdd() {
    return this._quickAddConfig;
  }
  set quickAdd(cfg) {
    if (Array.isArray(cfg)) cfg = { items: cfg };
    this._quickAddConfig = cfg || null;
    this._renderQuickAdd();
  }

  get value() {
    return this.items;
  }
  set value(v) {
    this.items = v;
  }

  addItem(obj = {}) {
    const item = this._applyColumnDefaults(obj);
    this._rowData.push(item);
    this._appendRow(this._rowData.length - 1, item);
    this._emitItemsChanged();
    return item;
  }

  removeItem(index) {
    if (index < 0 || index >= this._rowData.length) return;
    this._rowData.splice(index, 1);
    this._renderBody();
    this._emitItemsChanged();
  }

  clear() {
    this._rowData = [];
    this._renderBody();
    this._emitItemsChanged();
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (name === "add-label" && this._addButtonEl) {
      this._addButtonEl.textContent = newVal || "Add";
    }
  }

  // Internal helpers
  _applyColumnDefaults(obj) {
    const out = { ...obj };
    this._columnDefs.forEach((col) => {
      if (!(col.key in out)) {
        if (typeof col.default === "function") out[col.key] = col.default();
        else if (Object.prototype.hasOwnProperty.call(col, "default"))
          out[col.key] = col.default;
        else out[col.key] = this._defaultForType(col.type);
      }
    });
    return out;
  }

  _cloneItems() {
    return this._rowData.map((r) => ({ ...r }));
  }

  _defaultForType(t) {
    switch (t) {
      case "number":
        return 0;
      case "checkbox":
        return false;
      default:
        return "";
    }
  }

  _renderHeader() {
    const tr = document.createElement("tr");
    // Drag handle column (blank header)
    const thDrag = document.createElement("th");
    thDrag.className = "drag-col";
    tr.appendChild(thDrag);
    this._columnDefs.forEach((col) => {
      const th = document.createElement("th");
      th.textContent = col.label || col.key;
      if (col.width) th.style.width = col.width;
      tr.appendChild(th);
    });
    const thRemove = document.createElement("th");
    thRemove.textContent = "";
    tr.appendChild(thRemove);
    this._theadEl.innerHTML = "";
    this._theadEl.appendChild(tr);
  }

  _hideQuickAdd() {
    this._quickAddContainerEl.innerHTML = "";
    this.classList.remove("has-quickadd");
  }

  _renderQuickAdd() {
    this._quickAddContainerEl.innerHTML = "";
    const cfg = this._quickAddConfig;
    if (!cfg) {
      this._hideQuickAdd();
      return;
    }
    const items = Array.isArray(cfg.items) ? cfg.items : [];
    if (!items.length) {
      this._hideQuickAdd();
      return;
    }
    this.classList.add("has-quickadd");
    // SVG icon
    this._quickAddContainerEl.appendChild(
      document.createRange().createContextualFragment(quickAddSvg)
    );
    // Quick Add buttons
    items.forEach((name) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = name;
      btn.addEventListener("click", () => {
        const current = this.items;
        const duplicate =
          typeof cfg.matchItem === "function"
            ? cfg.matchItem(current, name)
            : current.some((it) =>
              Object.values(it).some(
                (v) =>
                  (v || "").toString().toLowerCase() === name.toLowerCase()
              )
            );
        if (duplicate) return;
        let obj;
        if (typeof cfg.onAdd === "function") obj = cfg.onAdd(name);
        else {
          const key =
            (this._columnDefs[0] && this._columnDefs[0].key) || "value";
          obj = { [key]: name };
        }
        this.addItem(obj || {});
      });
      this._quickAddContainerEl.appendChild(btn);
    });
  }

  _renderBody() {
    this._tbodyEl.innerHTML = "";
    this._rowData.forEach((item, idx) => this._appendRow(idx, item));
  }

  _appendRow(rowIndex, item) {
    const tr = document.createElement("tr");
    tr.dataset.index = String(rowIndex);
    tr.draggable = true; // entire row draggable

    // Drag handle cell
    const tdHandle = document.createElement("td");
    tdHandle.className = "drag-handle-cell";
    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.setAttribute("aria-label", "Drag to reorder");
    handle.textContent = "⋮⋮";
    tdHandle.appendChild(handle);
    tr.appendChild(tdHandle);

    this._columnDefs.forEach((col) => {
      const td = document.createElement("td");
      const editor = this._createEditor(
        col,
        item[col.key],
        (v) => {
          this._commitCellChange(rowIndex, col, editor, v);
        },
        rowIndex
      );
      editor.dataset.key = col.key;
      editor.dataset.row = String(rowIndex);
      td.appendChild(editor);
      tr.appendChild(td);
    });

    // Remove button
    const tdRemove = document.createElement("td");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "remove-button";
    btn.addEventListener("click", () => this.removeItem(rowIndex));
    tdRemove.appendChild(btn);
    tr.appendChild(tdRemove);
    this._tbodyEl.appendChild(tr);
  }

  _createEditor(col, value, commit, rowIndex) {
    // Custom
    if (col.type === "custom" && typeof col.createEditor === "function") {
      const el = col.createEditor(rowIndex, col, value, (val) => commit(val));
      // Allow external later retrieval if they supply setValue
      if (col.setValue) {
        try {
          col.setValue(el, value);
        } catch { }
      }
      return el;
    }

    let el;
    switch (col.type) {
      case "number": {
        el = document.createElement("input");
        el.type = "number";
        el.value = value ?? "";
        break;
      }
      case "select": {
        el = document.createElement("select");
        if (col.source && typeof col.source === "string") {
          loadCatalog(col.source).then((data) => {
            if (Array.isArray(data)) {
              data.forEach((item) => {
                const opt = document.createElement("option");
                opt.value = item.value ?? item.key ?? item.id ?? "";
                opt.textContent = item.label ?? item.name ?? opt.value;
                el.appendChild(opt);
              });
            }
          });
        } else if (col.options && Array.isArray(col.options)) {
          const opts = Array.isArray(col.options) ? col.options : [];
          opts.forEach((o) => {
            const opt = document.createElement("option");
            if (typeof o === "object") {
              opt.value = o.value ?? o.key ?? o.id ?? o.label;
              opt.textContent = o.label ?? o.name ?? opt.value;
            } else {
              opt.value = String(o);
              opt.textContent = String(o);
            }
            el.appendChild(opt);
          });
        }
        el.value = value ?? "";
        break;
      }
      case "date": {
        el = document.createElement("input");
        el.type = "date";
        el.value = value ?? "";
        break;
      }
      case "checkbox": {
        el = document.createElement("input");
        el.type = "checkbox";
        el.checked = !!value;
        break;
      }
      case "textarea": {
        el = document.createElement("textarea");
        el.value = value ?? "";
        break;
      }
      default: {
        el = document.createElement("input");
        el.type = "text";
        el.value = value ?? "";
      }
    }
    if (col.placeholder && "placeholder" in el)
      el.placeholder = col.placeholder;
    el.classList.add("data-cell");

    if (col.type === "checkbox") {
      el.addEventListener("change", () => commit(el.checked));
    } else if (col.type === "number" || col.type === "text" || col.type === "textarea") {
      el.addEventListener("input", () => {
        const v = el.value.trim();
        commit(v === "" ? null : col.type === "number" ? Number(v) : v);
      });
    } else if (col.type === "select") {
      el.addEventListener("change", () => commit(el.value || el.selectedOptions[0]?.textContent || ""));
    } else if (col.type === "date") {
      el.addEventListener("input", () => commit(el.value));
    }

    return el;
  }

  _commitCellChange(rowIndex, col, editorEl, newValue) {
    if (!this._rowData[rowIndex]) return; // row removed
    // If custom column has getValue defined and newValue is undefined, obtain value
    let val = newValue;
    if (
      col.type === "custom" &&
      val === undefined &&
      typeof col.getValue === "function"
    ) {
      try {
        val = col.getValue(editorEl);
      } catch {
        val = undefined;
      }
    }
    this._rowData[rowIndex][col.key] = val;
    this._emitItemsChanged();
  }

  _emitItemsChanged() {
    this.dispatchEvent(
      new CustomEvent("items-changed", {
        detail: { items: this.items },
        bubbles: true,
      })
    );
  }

  // --- Drag & Drop Implementation ---
  _installDnD() {
    // Use event delegation on tbody
    this._tbodyEl.addEventListener("dragstart", (e) => {
      const tr = e.target.closest("tr");
      if (!tr || tr.parentElement !== this._tbodyEl) return;
      this._dragFromIndex = Array.from(this._tbodyEl.children).indexOf(tr);
      e.dataTransfer.effectAllowed = "move";
      try {
        e.dataTransfer.setData("text/plain", String(this._dragFromIndex));
      } catch { }
      tr.classList.add("dragging");
    });
    this._tbodyEl.addEventListener("dragend", () => {
      this._clearDragVisuals();
      this._dragFromIndex = null;
      this._dragToIndex = null;
    });
    this._tbodyEl.addEventListener("dragover", (e) => {
      if (this._dragFromIndex == null) return;
      e.preventDefault();
      const tr = e.target.closest("tr");
      if (!tr || tr.parentElement !== this._tbodyEl) return;
      const rect = tr.getBoundingClientRect();
      const overIndex = Array.from(this._tbodyEl.children).indexOf(tr);
      const before = e.clientY - rect.top < rect.height / 2;
      // Compute insertion index semantics: dropTargetIndex is where item will be inserted
      let insertionIndex = overIndex + (before ? 0 : 1);
      if (
        insertionIndex === this._dragFromIndex ||
        insertionIndex === this._dragFromIndex + 1
      ) {
        // No movement; just clear visuals to reduce flicker
        this._clearDragVisuals();
        return;
      }
      this._dragToIndex = insertionIndex;
      this._clearDragVisuals();
      tr.classList.add(before ? "drag-over-before" : "drag-over-after");
    });
    this._tbodyEl.addEventListener("drop", (e) => {
      if (this._dragFromIndex == null || this._dragToIndex == null) return;
      e.preventDefault();
      let from = this._dragFromIndex;
      let to = this._dragToIndex;
      if (to > this._rowData.length) to = this._rowData.length;
      if (to > from) to--; // adjust for removal
      if (from !== to) {
        const moved = this._rowData.splice(from, 1)[0];
        this._rowData.splice(to, 0, moved);
        this._renderBody();
        this._emitItemsChanged();
      }
      this._clearDragVisuals();
      this._dragFromIndex = null;
      this._dragToIndex = null;
    });
  }

  _clearDragVisuals() {
    Array.from(
      this._tbodyEl.querySelectorAll(
        ".drag-over-before, .drag-over-after, .dragging"
      )
    ).forEach((tr) => {
      tr.classList.remove("drag-over-before", "drag-over-after", "dragging");
    });
  }

  _ensureDnDStyles() {
    const css = `
      .data-editor .drag-handle { cursor: grab; user-select: none; font-size: 14px; line-height: 1; display:inline-block; padding:2px 4px; }
      .data-editor .drag-handle:active { cursor: grabbing; }
      .data-editor tr.dragging { opacity: 0.55; }
      /* Previous thin inset lines kept as fallback */
      .data-editor tr.drag-over-before { box-shadow: 0 -3px 0 #1a73e8 inset; position: relative; }
      .data-editor tr.drag-over-after { box-shadow: 0 3px 0 #1a73e8 inset; position: relative; }
      /* Stronger indicators using pseudo elements for better visibility across themes */
      .data-editor tr.drag-over-before::before, .data-editor tr.drag-over-after::after { content:""; position:absolute; left:0; right:0; height:3px; background:#1a73e8; pointer-events:none; }
      .data-editor tr.drag-over-before::before { top:0; }
      .data-editor tr.drag-over-after::after { bottom:0; }
      .data-editor .drag-handle-cell { width: 24px; text-align: center; }
      .data-editor th.drag-col { width:24px; }
      /* Focus & keyboard accessibility (future enhancement support) */
      .data-editor .drag-handle:focus { outline:2px solid #1a73e8; outline-offset:2px; }
    `;
    let style = document.getElementById("data-editor-dnd-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "data-editor-dnd-style";
      document.head.appendChild(style);
    }
    style.textContent = css;
  }
}

// Register new tag
if (!customElements.get("data-editor")) {
  customElements.define("data-editor", DataEditor);
}
