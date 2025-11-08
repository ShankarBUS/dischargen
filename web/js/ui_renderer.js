import {
    getDepartmentById,
    searchDepartments,
    icdSearchWithCache,
    snomedSearchWithCache,
    searchDrugs,
    searchDrugRoutes,
    loadCatalog,
} from "./search_handler.js";
import { AutoCompleteBox } from "./components/autocompletebox.js";
import { DataEditor } from "./components/dataeditor.js";
import "./components/quantityunit.js";
import { evaluateCondition } from "./conditional.js";
import { applyValidation } from "./validation.js";
import { parseMarkdown, escapeHtml } from "./md_parser.js";
import { getKnownChronicDiseases, getKnownPastEvents } from "./defaults.js";
import { QuantityUnitInput } from "./components/quantityunit.js";
import { toNumberSafe, durationToDays } from "./utils/prescription.js";
import "./components/frequencyeditor.js";
import { FrequencyEditor } from "./components/frequencyeditor.js";

/**
 * Render the full UI given parsed AST + meta.
 * @param {HTMLElement} root
 * @param {object} state
 */
export function renderUI(root, state) {
    if (!state.sectionOptionals) state.sectionOptionals = {};
    state.sections = [];
    state._usedSectionIds = new Set();
    try {
        if (state && state.meta) {
            const metaNode = {
                type: "section",
                title: "Metadata",
                id: "__meta__",
                optional: false,
            };
            const metaSection = renderSection(metaNode, state, {
                customBodyBuilder: (body) => buildMetaEditorBody(body, state),
            });
            if (metaSection) root.appendChild(metaSection);
        }
    } catch { }
    renderNodes(state.ast || [], root, state, true);
}

// Registry for modular field renderers. Each renderer receives (node, wrapper, state)
// and must attach appropriate elements to wrapper and register value access in state.fieldRefs.
const FIELD_RENDERERS = {
    text(node, wrapper, state) {
        if (node.multiline)
            return renderMultiLineTextField(node, wrapper, state);
        node.fieldType = "text"; // ensure base type
        return renderInputField(node, wrapper, state);
    },
    number: renderInputField,
    checkbox: renderInputField,
    date: renderInputField,
    select: renderSelectField,
    table: renderTableField,
    diagnosis: renderDiagnosisField,
    complaints: renderComplaintsField,
    list: renderListField,
    static(node, wrapper, state) {
        wrapper.classList.add("static-block");
        const div = document.createElement("div");
        div.innerHTML = renderMarkdownHtml(parseMarkdown(node.content || ""));
        wrapper.appendChild(div);
        state.fieldRefs[
            node.id || "static_" + Math.random().toString(36).slice(2)
        ] = { value: node.content };
    },
    computed(node, wrapper, state) {
        const span = document.createElement("span");
        span.id = node.id;
        span.className = "computed-value";
        wrapper.appendChild(span);
        state.fieldRefs[node.id] = {
            get value() {
                return span.textContent;
            },
            set value(v) {
                span.textContent = v;
            },
        };
        state.computed.push(node);
    },
    hidden: renderHiddenInput,
    chronicdiseases: renderChronicDiseasesField,
    pastevents: renderPastEventsField,
    medications: renderMedicationsField,
};

function renderNodes(nodes, parent, state, renderUI = true) {
    for (const node of nodes) {
        if (!node || node.type === "include") continue;
        const hideUI = (node.ui && node.ui.hidden) === true;
        const nodeRenderUI = renderUI && !hideUI;

        if (node.type === "section") {
            if (nodeRenderUI) {
                const sectionEl = renderSection(node, state, {
                    hideUI,
                    renderChildrenUI: nodeRenderUI,
                });
                if (sectionEl) parent.appendChild(sectionEl);
            } else {
                if (
                    node.optional === true &&
                    state.sectionOptionals[node.id] &&
                    !state.sectionOptionals[node.id].checked
                ) {
                    continue; // skip entirely
                }
                // Render children without wrapper
                renderNodes(node.children || [], parent, state, false);
            }
        } else if (node.type === "group") {
            if (nodeRenderUI) {
                const groupEl = renderGroup(node, state, (childNodes, p, ui) =>
                    renderNodes(childNodes, p, state, ui)
                );
                if (groupEl) parent.appendChild(groupEl);
            } else {
                (node.children || []).forEach((ch) => {
                    if (!ch) return;
                    if (ch.type === "field") registerHiddenUIField(ch, state);
                    else if (ch.type === "group" || ch.type === "section")
                        renderNodes([ch], parent, state, false);
                });
            }
        } else if (node.type === "field") {
            if (hideUI) {
                registerHiddenUIField(node, state);
                continue;
            }
            const fieldEl = renderField(node, state);
            if (fieldEl && nodeRenderUI) parent.appendChild(fieldEl);
        }
    }
}

function renderSection(
    node,
    state,
    { hideUI = false, renderChildrenUI = true, customBodyBuilder } = {}
) {
    const sectionEl = document.createElement("div");
    sectionEl.className =
        "section" + (node.id === "__meta__" ? " meta-editor" : "");
    if (node.if) sectionEl.dataset.condition = node.if;
    if (node.pdf && node.pdf.hidden) sectionEl.dataset.pdfHidden = "true";
    if (hideUI) sectionEl.dataset.uiHidden = "true";

    let baseTitle =
        node.title || (node.id === "__meta__" ? "Metadata" : "Section");
    const explicit = node.id && node.id !== "__meta__" ? node.id : null;
    const slugFrom = explicit || baseTitle;
    let slug =
        String(slugFrom)
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 50) || "section";
    if (slug === "__meta__") slug = "metadata";
    let unique = slug;
    let i = 2;
    while (state._usedSectionIds.has(unique)) {
        unique = slug + "-" + i++;
    }
    state._usedSectionIds.add(unique);
    sectionEl.id = unique;

    // Track for navigation (exclude hidden UI sections)
    if (!hideUI) {
        state.sections.push({
            id: unique,
            title: baseTitle,
            optional: !!node.optional,
        });
    }

    const headerRow = document.createElement("div");
    headerRow.className = "section-header-row";

    let checkbox = null;
    if (node.optional === true) {
        checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "section-optional-checkbox";
        const prev = node.id && state.sectionOptionals[node.id];
        const initial = prev
            ? prev.checked
            : node.default === false
                ? false
                : true;
        checkbox.checked = initial;
        headerRow.appendChild(checkbox);

        const syncBody = () => {
            sectionEl.classList.toggle("disabled", !checkbox.checked);
        };
        checkbox.addEventListener("change", syncBody);
        syncBody();
        if (node.id) state.sectionOptionals[node.id] = checkbox;
    }

    const h = document.createElement("h1");
    h.textContent = node.title || "";
    h.addEventListener("click", () => sectionEl.classList.toggle("collapsed"));
    headerRow.appendChild(h);

    sectionEl.appendChild(headerRow);

    const body = document.createElement("div");
    body.className = "section-body";
    if (customBodyBuilder) {
        customBodyBuilder(body);
    } else if (renderChildrenUI) {
        renderNodes(node.children || [], body, state, true);
    }
    sectionEl.appendChild(body);

    return sectionEl;
}

function buildMetaEditorBody(body, state) {
    const meta = state.meta || (state.meta = {});

    const defaultKeys = {
        title: "",
        hospital: "",
        department: "",
        unit: "",
        pdf_header: "",
        pdf_footer: "",
    };
    Object.keys(defaultKeys).forEach((k) => {
        if (meta[k] === undefined) meta[k] = defaultKeys[k];
    });

    const form = document.createElement("div");
    form.className = "meta-form";
    body.appendChild(form);

    function addTextRow(labelText, key, multiline = false, placeholder = "") {
        const row = document.createElement("div");
        row.className = "meta-row";
        const label = document.createElement("label");
        label.textContent = labelText;
        label.htmlFor = "meta_" + key;
        row.appendChild(label);
        let input;
        if (multiline) {
            input = document.createElement("textarea");
            input.rows = 2;
        } else {
            input = document.createElement("input");
            input.type = "text";
        }
        input.id = "meta_" + key;
        input.value = meta[key] || "";
        if (placeholder) input.placeholder = placeholder;
        input.addEventListener("input", () => {
            meta[key] = input.value;
        });
        row.appendChild(input);
        form.appendChild(row);
    }

    function addDepartmentRow() {
        const row = document.createElement("div");
        row.className = "meta-row";
        const label = document.createElement("label");
        label.textContent = "Department";
        label.htmlFor = "meta_department";
        row.appendChild(label);
        const ac = new AutoCompleteBox();
        ac.id = "meta_department";
        ac.setAttribute("placeholder", "Start typing department...");
        ac.toggleAttribute("empty-shows-all", true);

        ac.fetcher = searchDepartments;
        ac.getItemLabel = (item) => (item && item.label) || "";

        const dept = getDepartmentById(meta.department);
        ac.value = dept ? dept.label : "";

        ac.addEventListener("commit", (e) => {
            const { item, value, fromSuggestion } = e.detail || {};
            if (fromSuggestion && item) meta.department = item.id || "";
            else if (value) meta.department = value;
        });

        row.appendChild(ac);
        form.appendChild(row);
    }

    addTextRow("Title", "title", false, "Title");
    addTextRow("Hospital Name", "hospital", false, "Hospital");
    addDepartmentRow();
    addTextRow("Unit", "unit", false, "e.g. Unit I");
    addTextRow("PDF Header", "pdf_header", true, "Extra header line");
    addTextRow("PDF Footer", "pdf_footer", true, "Footer line");
}

function registerHiddenUIField(node, state) {
    if (!node || !node.id) return;
    if (state.fieldRefs[node.id]) return;
    state.fieldRefs[node.id] = {
        value: node.default !== undefined ? node.default : "",
    };
    if (node.fieldType === "computed") state.computed.push(node);
}

function renderGroup(node, state, renderNodes) {
    const wrapper = document.createElement("div");
    wrapper.className = "group";
    wrapper.dataset.groupId = node.id || "";
    if (node.if) wrapper.dataset.condition = node.if;
    if (node.pdf && node.pdf.hidden) wrapper.dataset.pdfHidden = "true";
    if (node.ui && node.ui.hidden) wrapper.dataset.uiHidden = "true";
    const isToggle = node.toggle === true || String(node.toggle).toLowerCase() === "true";
    let headerRow = null;
    let toggleCb = null;
    if (node.title || isToggle) {
        headerRow = document.createElement("div");
        headerRow.className = "group-header";
        if (isToggle) {
            toggleCb = document.createElement("input");
            toggleCb.type = "checkbox";
            // default: checked unless default === false
            toggleCb.checked = node.default === false ? false : true;
            headerRow.appendChild(toggleCb);
            if (node.id) {
                // Expose group toggle as a field ref so conditions can depend on it
                state.fieldRefs[node.id] = toggleCb;
            }
        }
        if (node.title) {
            const h = document.createElement("h2");
            h.textContent = node.title;
            headerRow.appendChild(h);
        }
        wrapper.appendChild(headerRow);
    }

    const layout = String(node.layout || "vstack");
    const body = document.createElement("div");
    body.className = "group-body";
    if (/^hstack$/i.test(layout)) body.classList.add("layout-hstack");
    else if (/^vstack$/i.test(layout)) body.classList.add("layout-vstack");
    else {
        const m = /^columns-(\d+)$/i.exec(layout);
        if (m) body.classList.add("layout-columns", `cols-${m[1]}`);
        else body.classList.add("layout-vstack");
    }

    const syncBodyVisibility = () => {
        if (!isToggle) return;
        const on = !!(toggleCb && toggleCb.checked);
        wrapper.classList.toggle("disabled", !on);
        body.style.display = on ? "" : "none";
    };

    (node.children || []).forEach((ch) => {
        if (!ch || ch.type === "include") return;
        if (ch.type === "group") {
            if (ch.ui && ch.ui.hidden) renderNodes([ch], body, false);
            else {
                const el = renderGroup(ch, state, renderNodes);
                if (el) body.appendChild(el);
            }
        } else if (ch.type === "field") {
            if (ch.ui && ch.ui.hidden) {
                registerHiddenUIField(ch, state);
                return;
            }
            const el = renderField(ch, state);
            if (el) body.appendChild(el);
        }
    });
    wrapper.appendChild(body);
    if (toggleCb) {
        toggleCb.addEventListener("change", () => {
            syncBodyVisibility();
        });
        // initialize
        syncBodyVisibility();
    }
    return wrapper;
}

function renderField(node, state) {
    const wrapper = document.createElement("div");
    wrapper.className = "form-row";
    wrapper.dataset.fieldId = node.id;
    wrapper.dataset.fieldType = node.fieldType;
    if (node.if) wrapper.dataset.condition = node.if;
    if (node.label) {
        const label = document.createElement("label");
        label.textContent = node.label;
        if ((node.fieldType === "number" || node.fieldType === "computed") && node.unit)
            label.textContent += ` (${node.unit})`;
        label.htmlFor = node.id;
        if (node.required) label.classList.add("required");
        wrapper.appendChild(label);
    }

    // Choose renderer
    const type = node.fieldType;
    const renderer = FIELD_RENDERERS[type];
    if (renderer) renderer(node, wrapper, state);
    else {
        // Fallback to basic text input to avoid losing data unexpectedly
        renderInputField({ ...node, fieldType: "text" }, wrapper, state);
    }
    // Legacy commented block preserved for reference
    // else if (node.fieldType === 'general-exam') {
    //     const title = document.createElement('label'); title.textContent = node.label || 'General Examination'; wrapper.appendChild(title);
    //     const holder = document.createElement('div'); holder.className = 'field-input';
    //     holder.innerHTML = `<div class='ge-grid'>
    //   <div><span>Consciousness</span><select data-key='consciousness'><option value=''>--</option><option>Alert</option><option>Drowsy</option><option>Unconscious</option></select></div>
    //   <div><span>Orientation</span><select data-key='orientation'><option value=''>--</option><option>Oriented</option><option>Disoriented</option></select></div>
    //   <div><span>Hydration</span><select data-key='hydration'><option>Fair</option><option>Dehydrated</option></select></div>
    //   <div class='vitals'><strong>Vitals</strong>
    //     <input data-key='pulse' placeholder='Pulse /min' type='number' min='0'>
    //     <input data-key='bp' placeholder='BP mmHg'>
    //     <input data-key='spo2' placeholder='SpO2 %' type='number' min='0' max='100'>
    //     <input data-key='rr' placeholder='RR /min' type='number' min='0'>
    //     <input data-key='temp' placeholder='Temp' type='number' step='0.1'>
    //   </div>
    //   <div class='anthro'><strong>Anthropometry</strong>
    //     <input data-key='height_cm' placeholder='Height cm' type='number' step='0.1'>
    //     <input data-key='weight_kg' placeholder='Weight kg' type='number' step='0.1'>
    //   </div>
    //   <div class='signs'><strong>Signs</strong>
    //     ${['Pallor', 'Icterus', 'Cyanosis', 'Clubbing', 'Lymphadenopathy', 'Edema'].map(s => `<label><input type='checkbox' data-sign='${s}'> ${s}</label>`).join(' ')}
    //   </div>
    //   <textarea data-key='additional' rows='3' placeholder='Additional notes'></textarea>
    // </div>`;
    //     wrapper.appendChild(holder);
    //     state.fieldRefs[node.id] = { get value() { const obj = {}; holder.querySelectorAll('[data-key]').forEach(el => { obj[el.dataset.key] = el.value; }); obj.signs = [...holder.querySelectorAll('[data-sign]')].filter(c => c.checked).map(c => c.dataset.sign); return obj; } };
    // } else if (node.fieldType === 'investigations') {
    //     const label = document.createElement('label'); label.textContent = node.label || 'Investigations'; wrapper.appendChild(label);
    //     const holder = document.createElement('div'); holder.className = 'field-input';
    //     const addBtn = document.createElement('button'); addBtn.type = 'button'; addBtn.textContent = 'Add Investigation';
    //     const list = document.createElement('div'); list.className = 'invest-list'; holder.appendChild(list); holder.appendChild(addBtn); wrapper.appendChild(holder);
    //     let invCache = []; fetch('data/investigations.json').then(r => r.json()).then(j => invCache = j);
    //     function addRow(data = {}) {
    //         const row = document.createElement('div'); row.className = 'invest-row';
    //         const name = document.createElement('input'); name.type = 'text'; name.placeholder = 'Investigation'; name.value = data.name || ''; const val = document.createElement('input'); val.type = 'text'; val.placeholder = 'Value'; val.value = data.value || ''; const date = document.createElement('input'); date.type = 'date'; date.value = data.date || ''; const rm = document.createElement('button'); rm.type = 'button'; rm.textContent = '×'; rm.addEventListener('click', () => row.remove());
    //         // simple datalist
    //         const dlId = 'dl_' + node.id; if (!document.getElementById(dlId)) { const dl = document.createElement('datalist'); dl.id = dlId; invCache.slice(0, 200).forEach(i => { const o = document.createElement('option'); o.value = i; dl.appendChild(o); }); document.body.appendChild(dl); }
    //         name.setAttribute('list', dlId);
    //         row.appendChild(name); row.appendChild(val); row.appendChild(date); row.appendChild(rm); list.appendChild(row);
    //     }
    //     addBtn.addEventListener('click', () => addRow());
    //     state.fieldRefs[node.id] = { get value() { return [...list.querySelectorAll('.invest-row')].map(r => { const [n, v, d] = r.querySelectorAll('input'); return { name: n.value, value: v.value, date: d.value }; }).filter(r => r.name); } };
    // } else if (node.fieldType === 'opinions') {
    //     const label = document.createElement('label'); label.textContent = node.label || 'Opinions Obtained'; wrapper.appendChild(label);
    //     const holder = document.createElement('div'); holder.className = 'field-input'; const table = document.createElement('table'); table.innerHTML = '<thead><tr><th>Date</th><th>Department</th><th>Impression</th><th>Suggestions</th><th></th></tr></thead><tbody></tbody>';
    //     const tbody = table.querySelector('tbody'); const addBtn = document.createElement('button'); addBtn.type = 'button'; addBtn.textContent = 'Add Opinion'; addBtn.addEventListener('click', () => addRow()); holder.appendChild(table); holder.appendChild(addBtn); wrapper.appendChild(holder);
    //     function addRow(data = {}) { const tr = document.createElement('tr');['date', 'text', 'text', 'text'].forEach((t, i) => { const td = document.createElement('td'); const el = document.createElement('input'); el.type = t; el.value = [data.date, data.department, data.impression, data.suggestions][i] || ''; td.appendChild(el); tr.appendChild(td); }); const act = document.createElement('td'); const rm = document.createElement('button'); rm.type = 'button'; rm.textContent = '×'; rm.addEventListener('click', () => tr.remove()); act.appendChild(rm); tr.appendChild(act); tbody.appendChild(tr); }
    //     state.fieldRefs[node.id] = { get value() { return [...tbody.querySelectorAll('tr')].map(tr => { const [d, dep, imp, sug] = [...tr.querySelectorAll('input')].map(i => i.value); return { date: d, department: dep, impression: imp, suggestions: sug }; }).filter(r => r.date || r.department); } };
    // } else if (node.fieldType === 'followup') {
    //     const label = document.createElement('label'); label.textContent = node.label || 'Follow Up Advice'; wrapper.appendChild(label);
    //     const holder = document.createElement('div'); holder.className = 'field-input'; const table = document.createElement('table'); table.innerHTML = '<thead><tr><th>Department</th><th>Location/OPD</th><th>Date</th><th>Time</th><th>Advice</th><th></th></tr></thead><tbody></tbody>';
    //     const tbody = table.querySelector('tbody'); const addBtn = document.createElement('button'); addBtn.type = 'button'; addBtn.textContent = 'Add Follow Up'; addBtn.addEventListener('click', () => addRow()); holder.appendChild(table); holder.appendChild(addBtn); wrapper.appendChild(holder);
    //     function addRow(data = {}) { const tr = document.createElement('tr');['text', 'text', 'date', 'time', 'text'].forEach((t, i) => { const td = document.createElement('td'); const el = document.createElement('input'); el.type = t; el.value = [data.department, data.location, data.date, data.time, data.advice][i] || ''; td.appendChild(el); tr.appendChild(td); }); const act = document.createElement('td'); const rm = document.createElement('button'); rm.type = 'button'; rm.textContent = '×'; rm.addEventListener('click', () => tr.remove()); act.appendChild(rm); tr.appendChild(act); tbody.appendChild(tr); }
    //     state.fieldRefs[node.id] = { get value() { return [...tbody.querySelectorAll('tr')].map(tr => { const [dep, loc, dt, tm, adv] = [...tr.querySelectorAll('input')].map(i => i.value); return { department: dep, location: loc, date: dt, time: tm, advice: adv }; }).filter(r => r.department); } };
    // } else {
    //     return null;
    // }
    return wrapper;
}

function renderDiagnosisField(node, wrapper, state) {
    const baseId =
        node && node.id
            ? String(node.id)
            : `diagnosis-${Math.random().toString(36).slice(2)}`;
    const ac = new AutoCompleteBox();
    ac.setAttribute("placeholder", node.placeholder || "");
    ac.id = baseId;
    ac.fetcher = icdSearchWithCache;
    ac.getItemLabel = (item) =>
        (item &&
            (item.description ||
                item.label ||
                item.name ||
                item.value ||
                item.code)) ||
        "";
    ac.getItemSecondary = (item) =>
        item && item.code ? String(item.code) : "";

    const tagList = document.createElement("div");
    tagList.className = "tag-list";

    if (!Array.isArray(state.diagnosis)) state.diagnosis = [];

    function renderTags() {
        tagList.innerHTML = "";
        if (state.diagnosis.length === 0) {
            tagList.style.display = "none";
            return;
        }

        state.diagnosis.forEach((entry, idx) => {
            const tag = document.createElement("div");
            tag.className = "tag";
            tag.textContent =
                `${entry.description}` + (entry.code ? ` (${entry.code})` : "");
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "remove-button";
            btn.addEventListener("click", () => {
                state.diagnosis.splice(idx, 1);
                renderTags();
            });
            tag.appendChild(btn);
            tagList.appendChild(tag);
        });
        tagList.style.display = "flex";
    }

    ac.addEventListener("commit", (e) => {
        const { item, value, fromSuggestion } = e.detail || {};
        if (fromSuggestion && item) {
            state.diagnosis.push(item);
        } else if (value) {
            state.diagnosis.push({ description: value });
        }
        renderTags();
        ac.clear();
    });

    wrapper.appendChild(ac);
    wrapper.appendChild(tagList);

    state.fieldRefs[node.id] = {
        get value() {
            return state.diagnosis;
        },
        set value(v) {
            state.diagnosis = Array.isArray(v) ? v : [];
            renderTags();
        },
    };
}

const _durationUnits = ["days", "weeks", "months", "years"];

function renderComplaintsField(node, wrapper, state) {
    const knownList = [];
    if (node.suggestions) {
        const arr = [];
        if (Array.isArray(node.suggestions)) arr.push(...node.suggestions);
        else if (typeof node.suggestions === "string")
            arr.push(...node.suggestions.split(",").map((s) => s.trim()));
        knownList.push(...arr);
    }
    const editor = new DataEditor();
    editor.setAttribute("add-label", "Add Complaint");
    editor.columns = [
        {
            key: "complaint",
            label: "Complaint",
            type: "custom",
            placeholder: node.placeholder || "Complaint",
            width: "*",
            createEditor: (rowIndex, col, value, commit) => {
                const ac = new AutoCompleteBox();
                ac.placeholder = col.placeholder || "";
                ac.fetcher = snomedSearchWithCache;
                ac.getItemLabel = (item) => item || "";
                ac.addEventListener("commit", (e) => commit(e.detail.value));
                ac.addEventListener("text-changed", () => commit(ac.value));
                return ac;
            },
            getValue: (el) => el.value,
            setValue: (el, v) => {
                el.value = v || "";
            },
        },
        {
            key: "duration",
            label: "Duration",
            type: "custom",
            width: "30%",
            createEditor: (rowIndex, col, value, commit) => {
                const q = new QuantityUnitInput();
                q.dataset.role = "duration";
                q.units = _durationUnits;
                q.addEventListener("change", () =>
                    commit({ value: q.value, unit: q.unit })
                );
                return q;
            },
            getValue: (el) => ({ value: el.value, unit: el.unit }),
            setValue: (el, v) => {
                if (v && typeof v === "object") {
                    el.value = v.value || "";
                    el.unit = v.unit || "days";
                } else if (typeof v === "string") {
                    const m = v.match(/^(\d+)\s*(\w+)/);
                    if (m) {
                        el.value = m[1];
                        el.unit = m[2];
                    } else el.value = v;
                } else {
                    el.value = "";
                    el.unit = "days";
                }
            },
        },
    ];

    editor.quickAdd = {
        items: knownList,
        onAdd: (name) => ({ complaint: name, duration: { value: "", unit: "days" } }),
        matchItem: (items, name) =>
            items.some(
                (it) =>
                    (it.complaint || "").toLowerCase() === name.toLowerCase()
            ),
    };

    wrapper.appendChild(editor);

    state.fieldRefs[node.id] = {
        get value() {
            return (editor.items || [])
                .map((it) => {
                    const durationObj =
                        it.duration && typeof it.duration === "object"
                            ? it.duration
                            : { value: it.duration || "", unit: it.unit || "days" };
                    return {
                        complaint: it.complaint || "",
                        duration: durationObj,
                    };
                })
                .filter((it) => it.complaint);
        },
        set value(v) {
            if (Array.isArray(v)) {
                editor.items = v.map((it) => {
                    const durationObj =
                        it.duration && typeof it.duration === "object"
                            ? it.duration
                            : { value: it.duration || "", unit: it.unit || "days" };
                    return {
                        complaint: it.complaint || it.name || "",
                        duration: durationObj,
                    };
                });
            } else {
                editor.items = [];
            }
        },
    };
}

function renderChronicDiseasesField(node, wrapper, state) {
    const knownList = getKnownChronicDiseases();
    if (node.suggestions) {
        const arr = [];
        if (Array.isArray(node.suggestions)) arr.push(...node.suggestions);
        else if (typeof node.suggestions === "string")
            arr.push(...node.suggestions.split(",").map((s) => s.trim()));
        knownList.push(...arr);
    }
    const editor = new DataEditor();
    editor.setAttribute("add-label", "Add Chronic Disease");
    editor.columns = [
        {
            key: "disease",
            label: "Chronic Disease",
            type: "text",
            placeholder: "e.g. Diabetes Mellitus",
            width: "*",
        },
        {
            key: "duration",
            label: "Duration",
            type: "custom",
            width: "auto",
            createEditor: (rowIndex, col, value, commit) => {
                const q = new QuantityUnitInput();
                q.dataset.role = "duration";
                q.units = _durationUnits;
                q.addEventListener("change", () =>
                    commit({ value: q.value, unit: q.unit })
                );
                return q;
            },
            getValue: (el) => ({ value: el.value, unit: el.unit }),
            setValue: (el, v) => {
                if (v && typeof v === "object") {
                    el.value = v.value || "";
                    el.unit = v.unit || "years";
                } else if (typeof v === "string") {
                    const m = v.match(/^(\d+)\s*(\w+)/);
                    if (m) {
                        el.value = m[1];
                        el.unit = m[2];
                    } else el.value = v;
                } else {
                    el.value = "";
                    el.unit = "years";
                }
            },
        },
        {
            key: "treatment",
            label: "Treatment",
            type: "text",
            placeholder: "e.g. Metformin",
            width: "auto",
        },
    ];

    editor.quickAdd = {
        items: knownList,
        onAdd: (name) => ({
            disease: name,
            duration: { value: "", unit: "years" },
            treatment: "",
        }),
        matchItem: (items, name) =>
            items.some(
                (it) => (it.disease || "").toLowerCase() === name.toLowerCase()
            ),
    };

    wrapper.appendChild(editor);

    state.fieldRefs[node.id] = {
        get value() {
            return (editor.items || [])
                .map((it) => {
                    const durationObj =
                        it.duration && typeof it.duration === "object"
                            ? it.duration
                            : { value: it.duration || "", unit: it.unit || "years" };
                    return {
                        disease: it.disease,
                        duration: durationObj,
                        treatment: it.treatment,
                    };
                })
                .filter((it) => it.disease);
        },
        set value(v) {
            if (Array.isArray(v)) {
                const mapped = v
                    .map((it) => {
                        if (typeof it === "string")
                            return {
                                disease: it,
                                duration: { value: "", unit: "years" },
                                treatment: "",
                            };
                        const durationObj =
                            it.duration && typeof it.duration === "object"
                                ? it.duration
                                : { value: it.duration || "", unit: it.unit || "years" };
                        return {
                            disease: it.disease || it.name || "",
                            duration: durationObj,
                            treatment: it.treatment || "",
                        };
                    })
                    .filter((it) => it.disease);
                editor.items = mapped;
            } else {
                editor.items = [];
            }
        },
    };
}

function renderPastEventsField(node, wrapper, state) {
    const knownList = getKnownPastEvents();
    if (node.suggestions) {
        const arr = [];
        if (Array.isArray(node.suggestions)) arr.push(...node.suggestions);
        else if (typeof node.suggestions === "string")
            arr.push(...node.suggestions.split(",").map((s) => s.trim()));
        knownList.push(...arr);
    }
    const editor = new DataEditor();
    editor.setAttribute("add-label", "Add Past Event");
    editor.columns = [
        {
            key: "event",
            label: "Event",
            type: "text",
            placeholder: "e.g. Surgery, Hospitalization, etc.",
            width: "40%",
        },
        {
            key: "details",
            label: "Details",
            type: "text",
            placeholder: "e.g. Appendicectomy in 2015",
            width: "60%",
        },
    ];
    editor.quickAdd = {
        items: knownList,
        onAdd: (name) => ({ event: name, details: "" }),
        matchItem: (items, name) =>
            items.some(
                (it) => (it.event || "").toLowerCase() === name.toLowerCase()
            ),
    };

    wrapper.appendChild(editor);

    state.fieldRefs[node.id] = {
        get value() {
            return (editor.items || []).filter((it) => it.event);
        },
        set value(v) {
            if (Array.isArray(v)) {
                const mapped = v
                    .map((it) => {
                        if (typeof it === "string")
                            return { event: it, details: "" };
                        return {
                            event: it.event || "",
                            details: it.details || "",
                        };
                    })
                    .filter((it) => it.event);
                editor.items = mapped;
            } else {
                editor.items = [];
            }
        },
    };
}

function renderMedicationsField(node, wrapper, state) {
    const knownList = [];
    if (node.suggestions) {
        const arr = [];
        if (Array.isArray(node.suggestions)) arr.push(...node.suggestions);
        else if (typeof node.suggestions === "string")
            arr.push(...node.suggestions.split(",").map((s) => s.trim()));
        knownList.push(...arr);
    }
    const editor = new DataEditor();
    editor.setAttribute("add-label", "Add Medication");

    let isPrescription = /^(prescription|rx)$/i.test(node.mode || "");

    const baseColumns = [
        {
            key: "name",
            label: "Name",
            type: "custom",
            width: "30%",
            placeholder: "Name",
            createEditor: (rowIndex, col, value, commit) => {
                const ac = new AutoCompleteBox();
                ac.placeholder = col.placeholder;
                ac.fetcher = searchDrugs;
                ac.getItemLabel = (item) => item || "";
                ac.addEventListener("commit", (e) => commit(e.detail.value));
                ac.addEventListener("text-changed", () => commit(ac.value));
                return ac;
            },
            getValue: (el) => el.value,
            setValue: (el, v) => {
                el.value = v || "";
            },
        },
        {
            key: "dosage",
            label: "Dosage",
            type: "custom",
            width: "20%",
            createEditor: (rowIndex, col, value, commit) => {
                const q = new QuantityUnitInput();
                q.dataset.role = "dosage";
                q.setAttribute("placeholder", "Dose");
                q.setSource("data/drug_dosages.json");
                q.addEventListener("change", () => {
                    commit({ value: q.value, unit: q.unit });
                });
                return q;
            },
            getValue: (el) => ({ value: el.value, unit: el.unit }),
            setValue: (el, v) => {
                if (v && typeof v === "object") {
                    el.value = v.value || "";
                    el.unit = String(v.unit || "");
                } else if (typeof v === "string") {
                    const m = v.match(/^(\S+)\s+(.*)$/);
                    if (m) {
                        el.value = m[1];
                        el.unit = m[2];
                    } else el.value = v;
                }
            },
        },
        {
            key: "route",
            label: "Route",
            type: "custom",
            width: "10%",
            placeholder: "Type route (PO, Oral, IV...)",
            createEditor: (rowIndex, col, value, commit) => {
                const ac = new AutoCompleteBox();
                ac.placeholder = col.placeholder || "Route";
                ac.toggleAttribute("empty-shows-all", true);
                ac.fetcher = searchDrugRoutes;
                ac.getItemLabel = (it) => it.label;
                ac.getItemSecondary = (it) => it.description;
                ac.addEventListener("commit", (e) => {
                    const { item, value, fromSuggestion } = e.detail || {};
                    if (fromSuggestion && item && item.label) commit(item.label);
                    else if (value) commit(value);
                });
                ac.addEventListener("text-changed", () => commit(ac.value));
                ac.value = value || "";
                return ac;
            },
            getValue: (el) => el.value,
            setValue: (el, v) => {
                el.value = v || "";
            },
        },
        {
            key: "frequency",
            label: "Frequency",
            type: "custom",
            width: "20%",
            createEditor: (rowIndex, col, value, commit) => {
                const fe = new FrequencyEditor();
                fe.addEventListener("frequency-change", (e) => {
                    if (!e.detail || typeof e.detail.value === "undefined")
                        return;
                    const detail = e.detail;
                    commit({ value: detail.value, total: detail.total });
                });
                return fe;
            },
            getValue: (el) => ({ value: el.value, total: el.total }),
            setValue: (el, v) => {
                if (v && typeof v === "object") {
                    el.value = v.value || "";
                } else if (typeof v === "string") el.value = v;
            },
        },
        {
            key: "duration",
            label: "Duration",
            type: "custom",
            width: "15%",
            createEditor: (rowIndex, col, value, commit) => {
                const q = new QuantityUnitInput();
                q.dataset.role = "duration";
                q.units = _durationUnits;
                q.addEventListener("change", () =>
                    commit({ value: q.value, unit: q.unit })
                );
                return q;
            },
            getValue: (el) => ({ value: el.value, unit: el.unit }),
            setValue: (el, v) => {
                if (v && typeof v === "object") {
                    el.value = v.value || "";
                    el.unit = v.unit || "days";
                } else if (typeof v === "string") {
                    const m = v.match(/^(\d+)\s*(\w+)/);
                    if (m) {
                        el.value = m[1];
                        el.unit = m[2];
                    } else el.value = v;
                }
            },
        },
    ];

    const quantityColumn = {
        key: "quantity",
        label: "Quantity",
        type: "computed",
        width: "10%",
        placeholder: "",
        inputType: "number",
        compute: (row) => {
            const _dose = toNumberSafe(row.dosage.value);
            if (!_dose) return "";
            let _totalperday =
                row.frequency && typeof row.frequency === "object"
                    ? toNumberSafe(row.frequency.total)
                    : 0;
            const days = durationToDays(row.duration);
            if (!_totalperday || !days) return "";
            const total = _dose * _totalperday * days;
            if (!isFinite(total) || total <= 0) return "";
            return String(Math.ceil(total));
        },
    };

    editor.columns = isPrescription
        ? baseColumns.concat(quantityColumn)
        : baseColumns;

    editor.quickAdd = {
        items: knownList,
        onAdd: (name) => ({ name: name }),
        matchItem: (items, name) =>
            items.some(
                (it) => (it.name || "").toLowerCase() === name.toLowerCase()
            ),
    };

    wrapper.appendChild(editor);

    state.fieldRefs[node.id] = {
        get value() {
            return (editor.items || [])
                .map((it) => {
                    const dosageObj =
                        it.dosage && typeof it.dosage === "object"
                            ? it.dosage
                            : { value: "", unit: "" };
                    const durationObj =
                        it.duration && typeof it.duration === "object"
                            ? it.duration
                            : { value: "", unit: "days" };
                    const base = {
                        name: it.name || "",
                        dosage: dosageObj,
                        route: it.route || "",
                        frequency: it.frequency || "",
                        duration: durationObj,
                        quantity: it.quantity || "",
                    };
                    return base;
                })
                .filter((it) => it.name);
        },
        set value(v) {
            if (Array.isArray(v)) {
                const mapped = v
                    .map((it) => {
                        if (typeof it === "string")
                            return {
                                name: it,
                                dosage: { value: "", unit: "" },
                                route: "",
                                frequency: "",
                                duration: { value: "", unit: "days" },
                            };

                        const dosageObj =
                            it.dosage && typeof it.dosage === "object"
                                ? it.dosage
                                : { value: "", unit: "" };
                        const durationObj =
                            it.duration && typeof it.duration === "object"
                                ? it.duration
                                : { value: "", unit: "days" };
                        const base = {
                            name: it.name || "",
                            dosage: dosageObj,
                            route: it.route || "",
                            frequency: it.frequency || "",
                            duration: durationObj,
                            quantity: it.quantity || "",
                        };
                        return base;
                    })
                    .filter((it) => it.name);
                editor.items = mapped;
            } else {
                editor.items = [];
            }
        },
    };
}

function renderInputField(node, wrapper, state) {
    const input = document.createElement("input");
    input.id = node.id;
    input.name = node.id;
    input.type = node.fieldType;
    if (input.type === "checkbox") wrapper.classList.add("inline", "reverse");
    if (node.placeholder) input.placeholder = node.placeholder;
    if (node.min) input.min = node.min;
    if (node.max) input.max = node.max;
    if (node.pattern) input.pattern = node.pattern;
    if (node.default !== undefined) input.value = node.default;
    wrapper.appendChild(input);
    state.fieldRefs[node.id] = input;
    if (node.required || node.min || node.max || node.pattern) {
        applyValidation(input, {
            required: node.required,
            min: node.min,
            max: node.max,
            pattern: node.pattern,
        });
    }
}

function renderMultiLineTextField(node, wrapper, state) {
    const ta = document.createElement("textarea");
    ta.id = node.id;
    ta.name = node.id;
    wrapper.appendChild(ta);
    state.fieldRefs[node.id] = ta;
    if (node.default) ta.value = node.default;
    if (node.required) {
        applyValidation(ta, { required: true });
    }
}

function renderSelectField(node, wrapper, state) {
    const select = document.createElement("select");
    select.id = node.id;
    select.name = node.id;
    wrapper.appendChild(select);
    state.fieldRefs[node.id] = select;
    if (node.default) select.value = node.default;
    if (node.required) applyValidation(select, { required: true });
    if (node.multiple) select.multiple = true;

    loadSelectOptions(select, node).catch(console.error);
}

async function loadSelectOptions(selectEl, node) {
    if (node.source) {
        const data = await loadCatalog(node.source);
        data.forEach((opt) => {
            const o = document.createElement("option");
            // Prefer explicit value; fall back to key/id/label
            o.value = opt.value || opt.code || opt.id || opt.label || opt;
            // Prefer human-readable description/name; fallback to label then value
            o.textContent = opt.description || opt.label || opt.value || opt.code || opt;
            selectEl.appendChild(o);
        });
    } else if (node.options) {
        const arr = Array.isArray(node.options)
            ? node.options
            : String(node.options)
                .split(",")
                .map((o) => o.trim());
        arr.forEach((v) => {
            const o = document.createElement("option");
            const isPlaceholder = v === "_";
            o.value = isPlaceholder ? null : v;
            o.textContent = isPlaceholder ? node.placeholder ?? "Select an option" : v;
            o.style.display = isPlaceholder ? "none" : "block";
            selectEl.appendChild(o);
        });
    }
    selectEl.selectedIndex = -1;
}

function renderTableField(node, wrapper, state) {
    const tableWrapper = document.createElement("div");
    tableWrapper.className = "table-wrapper";
    const table = document.createElement("table");
    const cols = node.columns;
    const thead = document.createElement("thead");
    thead.innerHTML =
        "<tr>" + cols.map((c) => `<th>${c}</th>`).join("") + "</tr>";
    const tbody = document.createElement("tbody");
    table.appendChild(thead);
    table.appendChild(tbody);
    tableWrapper.appendChild(table);
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.textContent = "Add Row";
    addBtn.className = "add-button";
    function addRow(values = {}) {
        const tr = document.createElement("tr");
        cols.forEach((col) => {
            const td = document.createElement("td");
            const inp = document.createElement("input");
            inp.type = "text";
            inp.dataset.col = col;
            inp.value = values[col] || "";
            td.appendChild(inp);
            tr.appendChild(td);
        });
        const removeRow = document.createElement("td");
        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "remove-button";
        rm.addEventListener("click", () => tbody.removeChild(tr));
        removeRow.appendChild(rm);
        tr.appendChild(removeRow);
        tbody.appendChild(tr);
    }
    addBtn.addEventListener("click", () => addRow());
    wrapper.appendChild(tableWrapper);
    wrapper.appendChild(addBtn);

    state.fieldRefs[node.id] = {
        get value() {
            return [...tbody.querySelectorAll("tr")].map((tr) => {
                const obj = {};
                cols.forEach((col) => {
                    const inp = tr.querySelector(`input[data-col="${col}"]`);
                    obj[col] = inp.value;
                });
                return obj;
            });
        },
        set value(v) {
            if (!Array.isArray(v)) return;
            tbody.innerHTML = "";
            v.forEach((row) => addRow(row));
        },
    };
}

function renderListField(node, wrapper, state) {
    const listWrapper = document.createElement("div");
    listWrapper.className = "list-wrapper";
    const ul = document.createElement("ul");
    ul.className = "list-field";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.textContent = "Add";
    addBtn.addEventListener("click", () => addItem(""));
    listWrapper.appendChild(ul);
    listWrapper.appendChild(addBtn);
    wrapper.appendChild(listWrapper);
    function addItem(val) {
        const li = document.createElement("li");
        const inp = document.createElement("input");
        inp.type = "text";
        inp.value = val || "";
        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "remove-button";
        rm.addEventListener("click", () => li.remove());
        li.appendChild(inp);
        li.appendChild(rm);
        ul.appendChild(li);
    }
    state.fieldRefs[node.id] = {
        get value() {
            return [...ul.querySelectorAll("li input")]
                .map((i) => i.value)
                .filter((v) => v.trim() !== "");
        },
        set value(v) {
            if (!Array.isArray(v)) return;
            ul.innerHTML = "";
            v.forEach((item) => addItem(item));
        },
    };
}

function renderHiddenInput(node, wrapper, state) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.id = node.id;
    input.name = node.id;
    if (node.default) input.value = node.default;
    wrapper.style.display = "none";
    wrapper.appendChild(input);
    state.fieldRefs[node.id] = input;
}

export function reevaluateConditions(root, state) {
    const rows = root.querySelectorAll("[data-condition]");
    rows.forEach((row) => {
        const expr = row.dataset.condition;
        const visible = evaluateCondition(expr, (id) =>
            getFieldValue(id, state)
        );
        row.classList.toggle("hidden", !visible);
    });
}

export function getFieldValueFromRef(ref) {
    if (!ref) return undefined;
    if (ref instanceof HTMLElement) {
        if (ref.type === "checkbox") return ref.checked;
    }
    return ref && "value" in ref ? ref.value : undefined;
}

export function getFieldValue(id, state) {
    const ref = state.fieldRefs[id];
    return getFieldValueFromRef(ref);
}

export function evaluateComputedAll(state) {
    if (!state.computed.length) return;
    state.computed.forEach((node) => {
        const formula = node.formula;
        if (!formula) return;
        try {
            // Use a Proxy that cooperates with `with(ctx)` lookup rules:
            // - `has` must return true for known field ids so identifiers bind here
            // - return false for others so globals like Math/Date stay accessible
            const ctx = new Proxy(
                {},
                {
                    has(_, prop) {
                        if (typeof prop === "symbol") return false;
                        return Object.prototype.hasOwnProperty.call(
                            state.fieldRefs,
                            prop
                        );
                    },
                    get(_, prop) {
                        if (typeof prop === "symbol") return undefined;
                        return getFieldValue(prop, state);
                    },
                }
            );

            const fn = new Function("ctx", `with(ctx){ return ${formula}; }`);
            let val = fn(ctx);
            if (node.format && /^decimal\(\d+\)$/.test(node.format)) {
                const d = parseInt(
                    node.format.match(/decimal\((\d+)\)/)[1],
                    10
                );
                if (typeof val === "number") val = val.toFixed(d);
            }
            state.fieldRefs[node.id].value = (val ?? "").toString();
        } catch (e) {
            /* ignore */
        }
    });
}

// Render parsed markdown AST into HTML (safe, no raw HTML passthrough)
export function renderMarkdownHtml(ast) {
    function runsToHtml(runs) {
        return runs
            .map((r) => {
                let t = escapeHtml(r.text);
                if (r.bold) t = `<strong>${t}</strong>`;
                if (r.italic) t = `<em>${t}</em>`;
                return t;
            })
            .join("");
    }

    function renderBlocks(blocks) {
        return blocks
            .map((b) => {
                if (b.type === "paragraph")
                    return `<p>${runsToHtml(b.runs).replace(
                        /\n/g,
                        "<br/>"
                    )}</p>`;
                if (b.type === "list") {
                    const tag = b.ordered ? "ol" : "ul";
                    const items = b.items
                        .map((it) => `<li>${renderListItem(it)}</li>`)
                        .join("");
                    return `<${tag}>${items}</${tag}>`;
                }
                return "";
            })
            .join("");
    }

    function renderListItem(item) {
        // If only one paragraph block return inline, else concatenate rendered blocks
        if (item.blocks.length === 1 && item.blocks[0].type === "paragraph") {
            return runsToHtml(item.blocks[0].runs).replace(/\n/g, "<br/>");
        }
        return renderBlocks(item.blocks);
    }
    return renderBlocks(ast);
}
