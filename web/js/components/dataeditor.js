import { loadCatalog } from "../search_handler.js";

const quickAddSvg = `<svg xmlns="http://www.w3.org/2000/svg" class="icon" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M10.788 3.102c.495-1.003 1.926-1.003 2.421 0l2.358 4.778l5.273.766c1.107.16 1.549 1.522.748 2.303l-.905.882a6.5 6.5 0 0 0-1.517-.616l1.157-1.128l-5.05-.734a1.35 1.35 0 0 1-1.016-.739L11.998 4.04L9.74 8.614a1.35 1.35 0 0 1-1.016.739l-5.05.734l3.654 3.562c.318.31.463.757.388 1.195l-.862 5.029l4.149-2.181c.015.542.098 1.067.238 1.569l-3.958 2.081c-.99.52-2.148-.32-1.96-1.423l.901-5.251l-3.815-3.72c-.801-.78-.359-2.141.748-2.302L8.43 7.88zM23 17.5a5.5 5.5 0 1 0-11 0a5.5 5.5 0 0 0 11 0m-5 .5l.001 2.503a.5.5 0 1 1-1 0V18h-2.505a.5.5 0 0 1 0-1H17v-2.501a.5.5 0 0 1 1 0v2.5h2.497a.5.5 0 0 1 0 1z"/></svg>`;

/**
 * <data-editor> Web Component
 * Lightweight, dependency‑free tabular editor for an array of homogeneous objects.
 *
 * TYPEDEFS --------------------------------------------------------------------
 * 
 * @typedef {Object} DataEditorColumn
 * @property {string} key             Unique property name for the column (required)
 * @property {string} [label]         Header text (defaults to key)
 * @property {('text'|'number'|'select'|'date'|'checkbox'|'textarea'|'custom'|'computed')} [type='text'] Input / render type
 * @property {any|(()=>any)} [default] Default value (or factory) applied when item lacks the key
 * @property {Array<any|Object>} [options] Options for select (primitive or objects: {value,label|name|id|key})
 * @property {string} [width]         CSS width applied to header (and indirectly cells)
 * @property {string} [placeholder]   Placeholder text for textual inputs
 * @property {(rowIndex:number, col:DataEditorColumn, value:any, commit:(val:any)=>void)=>HTMLElement} [createEditor] Custom editor factory for type==='custom'
 * @property {(el:HTMLElement)=>any} [getValue] Retrieve value for custom editors on commit (fallback to provided commit arg)
 * @property {(el:HTMLElement, value:any)=>void} [setValue] Programmatically set custom editor value (used on initial render)
 * @property {(row:Object, rowIndex:number, items:Object[])=>any} [compute] For type==='computed': derive value. Returning undefined leaves previous value.
 * @property {'number'|'text'} [inputType] Optional hint for computed input type.
 *
 * @typedef {Object} DataEditorQuickAddConfig
 * @property {string[]} items                         Labels to show as quick-add buttons
 * @property {(currentItems:Object[], label:string)=>boolean} [matchItem] Custom duplicate detection
 * @property {(label:string)=>Object} [onAdd]         Factory returning a new item skeleton given label
 *
 * @typedef {{items:Object[]}} ItemsChangedDetail Event detail payload for 'items-changed'.
 *
 * EVENTS ----------------------------------------------------------------------
 * 
 * @fires DataEditor#items-changed  When underlying item array mutates (addition, removal, edit or reorder)
 *
 * PUBLIC API -----------------------------------------------------------------
 * 
 * @property {DataEditorColumn[]} columns  Column definition list (shallow cloned internally)
 * @property {Object[]}           items    Current row objects (cloned on get to avoid external mutation)
 * @property {Object[]}           value    Alias for items
 * @property {DataEditorQuickAddConfig|string[]} [quickAdd] Quick-add configuration or simple array of labels
 * @method addItem Adds a new row (applying defaults) and returns the created item
 * @method removeItem Removes row at index (no-op if out of range)
 * @method clear Removes all rows
 *
 * COLUMN TYPES ----------------------------------------------------------------
 * 
 *  text / number / date / textarea / checkbox / select: native inputs
 *  custom: user provides createEditor (and optionally getValue/setValue)
 *  computed: behaves like text/number input; value maintained by compute(). User override: manual typing sets overridden flag until cleared.
 *
 * EXAMPLE --------------------------------------------------------------------
 * 
 *  const editor = document.createElement('data-editor');
 *  editor.columns = [ { key:'name', label:'Name' }, { key:'qty', type:'number', default:1 } ];
 *  editor.items = [{ name:'Paracetamol', qty:1 }];
 *  editor.addEventListener('items-changed', e => console.log(e.detail.items));
 *  document.body.appendChild(editor);
 */

export class DataEditor extends HTMLElement {
  static get observedAttributes() {
    return ["add-label"];
  }

  /**
   * Create component internals & basic DOM scaffolding (table wrapper, add button, quick-add area).
   */
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

    // symbol to store per-row computed meta (override & pending flags)
    this._COMPUTED_META = Symbol('computedMeta');
  }

  // Public API -------------------------------------------------------------
  /**
   * Get a shallow copy of current column definitions. (Mutating the returned array or its objects will NOT affect the component.)
   * @returns {DataEditorColumn[]}
   */
  get columns() {
    return this._columnDefs.slice();
  }
  /**
   * Replace column definitions, re-render header & body.
   * @param {DataEditorColumn[]} cols
   */
  set columns(cols) {
    if (!Array.isArray(cols)) cols = [];
    this._columnDefs = cols.map((c) => ({ ...c }));
    this._renderHeader();
    this._renderBody();
  }

  /**
   * Get a deep-ish copy (shallow per row) of row items to avoid accidental external mutation.
   * @returns {Object[]}
   */
  get items() {
    return this._cloneItems();
  }
  set items(arr) {
    if (!Array.isArray(arr)) arr = [];
    this._rowData = arr.map((it) => this._applyColumnDefaults(it));
    this._renderBody();
    // initial recompute for computed columns after full body render
    this._rowData.forEach((_, i) => this._recomputeRow(i, null, true));
    this._emitItemsChanged();
  }

  // Quick add API ---------------------------------------------------------
  /**
   * Quick-add configuration (or null when disabled).
   * @returns {DataEditorQuickAddConfig|null}
   */
  get quickAdd() {
    return this._quickAddConfig;
  }
  /**
   * Set quick-add configuration. Supports passing string array directly which is normalized.
   * @param {DataEditorQuickAddConfig|string[]|null} cfg
   */
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

  /**
   * Append a new row applying column defaults.
   * @param {Object} [obj={}] Seed object (partial row)
   * @returns {Object} Newly appended item (live reference)
   */
  addItem(obj = {}) {
    const item = this._applyColumnDefaults(obj);
    this._rowData.push(item);
    this._appendRow(this._rowData.length - 1, item);
    this._emitItemsChanged();
    return item;
  }

  /**
   * Remove row at index (ignored if out of bounds).
   * @param {number} index
   */
  removeItem(index) {
    if (index < 0 || index >= this._rowData.length) return;
    this._rowData.splice(index, 1);
    this._renderBody();
    this._emitItemsChanged();
  }

  /**
   * Remove all rows.
   */
  clear() {
    this._rowData = [];
    this._renderBody();
    this._emitItemsChanged();
  }

  /**
   * Observe attribute changes (currently only add-label for the add button text).
   * @param {string} name
   * @param {string|null} oldVal
   * @param {string|null} newVal
   */
  attributeChangedCallback(name, oldVal, newVal) {
    if (name === "add-label" && this._addButtonEl) {
      this._addButtonEl.textContent = newVal || "Add";
    }
  }

  // Internal helpers
  /**
   * Apply per-column defaults to a seed object. Factories (function defaults) executed lazily.
   * @param {Object} obj
   * @returns {Object}
   * @private
   */
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

  /**
   * Shallow clone each row (1-level) for external consumption.
   * @returns {Object[]}
   * @private
   */
  _cloneItems() {
    return this._rowData.map((r) => ({ ...r }));
  }

  /**
   * Basic default fallback per declared type.
   * @param {string} t
   * @returns {any}
   * @private
   */
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

  /**
   * Render table header including drag handle and remove-column stub.
   * @private
   */
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

  /** Hide quick-add UI (remove content & class). @private */
  _hideQuickAdd() {
    this._quickAddContainerEl.innerHTML = "";
    this.classList.remove("has-quickadd");
  }

  /** Render quick-add button cluster if config & items exist. @private */
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

  /**
   * (Re)build tbody from current row data.
   * @private
   */
  _renderBody() {
    this._tbodyEl.innerHTML = "";
    this._rowData.forEach((item, idx) => this._appendRow(idx, item));
  }

  /**
   * Append a single <tr> for a row index.
   * @param {number} rowIndex
   * @param {Object} item
   * @private
   */
  _appendRow(rowIndex, item) {
    const tr = document.createElement("tr");
    tr.dataset.index = String(rowIndex);
    // tr.draggable = true; // entire row draggable

    // Drag handle cell
    const tdHandle = document.createElement("td");
    tdHandle.className = "drag-handle-cell";
    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.setAttribute("aria-label", "Drag to reorder");
    handle.textContent = "⋮⋮";
    tdHandle.appendChild(handle);
    tdHandle.draggable = true;
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

    // After creating row editors perform initial compute for computed columns
    this._recomputeRow(rowIndex, null, true);
  }

  /**
   * Create the editor element for a cell based on column definition.
   * @param {DataEditorColumn} col
   * @param {any} value
   * @param {(val:any)=>void} commit Callback to persist value into model
   * @param {number} rowIndex
   * @returns {HTMLElement}
   * @private
   */
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

    // Computed column: behaves like text/number input but auto-derived
    if (col.type === 'computed') {
      const el = document.createElement('input');
      el.type = (col.inputType === 'number') ? 'number' : 'text';
      el.classList.add('data-cell', 'computed-cell');
      // initial value (may be overridden later by recompute)
      el.value = value ?? '';
      if (col.placeholder) el.placeholder = col.placeholder;
      // user input => manual override logic
      el.addEventListener('input', () => {
        const row = this._rowData[rowIndex];
        if (!row) return;
        const meta = this._ensureComputedMeta(row, col.key);
        const raw = el.value;
        if (raw === '') {
          // cleared -> remove override & set pending recompute on next other-cell change
          meta.overridden = false;
          meta.awaitingRecalc = true;
          commit('');
          el.classList.add('computed-cell');
        } else {
          meta.overridden = true;
          meta.awaitingRecalc = false;
          el.classList.remove('computed-cell');
          commit((col.inputType === 'number') ? Number(raw) : raw);
        }
      });
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
                // Prefer explicit value; fallback to key/id/label so defaults can match
                opt.value = item.value ?? item.key ?? item.id ?? item.label ?? "";
                // Prefer human-readable description/name; fallback to label then value
                opt.textContent = item.description ?? item.label ?? item.name ?? opt.value;
                el.appendChild(opt);
              });
            }
            // Set initial value or first option
            el.value = value != null ? value : (el.options[0] && el.options[0].value) || "";
          });
        } else if (col.options && Array.isArray(col.options)) {
          const opts = Array.isArray(col.options) ? col.options : [];
          opts.forEach((o) => {
            const opt = document.createElement("option");
            if (typeof o === "object") {
              opt.value = o.value ?? o.key ?? o.id ?? o.label;
              opt.textContent = o.description ?? o.label ?? o.name ?? opt.value;
            } else {
              opt.value = String(o);
              opt.textContent = String(o);
            }
            el.appendChild(opt);
          });
          el.value = value != null ? value : (el.options[0] && el.options[0].value) || "";
        }
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

  /**
   * Commit a cell edit to internal data, triggering recomputation & event emission as needed.
   * @param {number} rowIndex
   * @param {DataEditorColumn} col
   * @param {HTMLElement} editorEl
   * @param {any} newValue
   * @private
   */
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
    const row = this._rowData[rowIndex];
    const oldVal = row[col.key];
    row[col.key] = val;

    // If a non-computed column changed OR a computed override was cleared, recompute dependent computed columns
    let recomputed = false;
    if (col.type !== 'computed') {
      recomputed = this._recomputeRow(rowIndex, col.key, false);
    }
    if (oldVal !== val || recomputed) this._emitItemsChanged();
  }

  /** Dispatch 'items-changed' custom event with cloned items. @private */
  _emitItemsChanged() {
    this.dispatchEvent(
      new CustomEvent("items-changed", {
        detail: { items: this.items },
        bubbles: true,
      })
    );
  }

  // --- Drag & Drop Implementation ---
  /** Install drag & drop listeners on tbody for row reordering. @private */
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

  /** Remove transient drag-over CSS classes. @private */
  _clearDragVisuals() {
    Array.from(
      this._tbodyEl.querySelectorAll(
        ".drag-over-before, .drag-over-after, .dragging"
      )
    ).forEach((tr) => {
      tr.classList.remove("drag-over-before", "drag-over-after", "dragging");
    });
  }

  /** Ensure metadata bucket for computed column state exists. @private */
  _ensureComputedMeta(row, key) {
    if (!row[this._COMPUTED_META]) row[this._COMPUTED_META] = {};
    if (!row[this._COMPUTED_META][key]) row[this._COMPUTED_META][key] = { overridden: false, awaitingRecalc: false };
    return row[this._COMPUTED_META][key];
  }

  /**
   * Recalculate all computed columns for a row unless overridden.
   * @param {number} rowIndex
   * @param {string|null} changedKey Key that triggered recompute (optimizations / awaiting recalculation logic)
   * @param {boolean} initial Whether this is the initial population pass
   * @returns {boolean} true if any value changed
   * @private
   */
  _recomputeRow(rowIndex, changedKey = null, initial = false) {
    const row = this._rowData[rowIndex];
    if (!row) return false;
    let anyChange = false;
    this._columnDefs.forEach(col => {
      if (col.type !== 'computed' || typeof col.compute !== 'function') return;
      const meta = this._ensureComputedMeta(row, col.key);
      // Skip if overridden
      if (meta.overridden) return;
      // If awaitingRecalc and the changed key is this same computed column key, skip (will get new trigger later)
      if (meta.awaitingRecalc && (changedKey === null || changedKey === col.key)) return;
      if (meta.awaitingRecalc && changedKey && changedKey !== col.key) {
        // now allowed to recompute
        meta.awaitingRecalc = false;
      }
      try {
        const newVal = col.compute(row, rowIndex, this._rowData);
        if (newVal !== row[col.key]) {
          row[col.key] = newVal;
          // update DOM cell
          const tr = this._tbodyEl.querySelector(`tr[data-index="${rowIndex}"]`);
          if (tr) {
            const cellEditor = tr.querySelector(`[data-key="${col.key}"]`);
            if (cellEditor && cellEditor !== document.activeElement) {
              // Avoid clobbering user typing when active
              if (cellEditor.tagName === 'INPUT' || cellEditor.tagName === 'TEXTAREA') {
                cellEditor.value = newVal ?? '';
              } else if ('textContent' in cellEditor) {
                cellEditor.textContent = newVal ?? '';
              }
            }
          }
          anyChange = true;
        }
      } catch { /* silent compute error */ }
    });
    return anyChange;
  }
}

// Register new tag
if (!customElements.get("data-editor")) {
  customElements.define("data-editor", DataEditor);
}
