import { icdSearchWithCache, snomedSearchWithCache } from './search_handler.js';
import { AutoCompleteBox } from './components/autocompletebox.js';
import { evaluateCondition } from './conditional.js';
import { applyValidation } from './validation.js';

export function renderAST(root, state) {
    const renderNodes = (nodes, parent) => {
        for (const node of nodes) {
            if (!node || node.type === 'include') continue; // includes already expanded parse-time
            if (node.type === 'section') {
                const sectionEl = document.createElement('div');
                sectionEl.className = 'section';
                if (node.if) sectionEl.dataset.condition = node.if;
                const h = document.createElement('h1');
                h.textContent = node.title;
                h.addEventListener('click', () => sectionEl.classList.toggle('collapsed'));
                sectionEl.appendChild(h);
                const body = document.createElement('div');
                renderNodes(node.children || [], body);
                sectionEl.appendChild(body);
                parent.appendChild(sectionEl);
            } else if (node.type === 'group') {
                const groupEl = renderGroup(node, state);
                if (groupEl) parent.appendChild(groupEl);
            } else if (node.type === 'field') {
                const fieldEl = renderField(node, state); if (fieldEl) parent.appendChild(fieldEl);
            }
        }
    };
    renderNodes(state.ast || [], root);
}

function renderGroup(node, state) {
    const wrapper = document.createElement('div');
    wrapper.className = 'group';
    wrapper.dataset.groupId = node.id || '';
    if (node.if) wrapper.dataset.condition = node.if;
    if (node.title) {
        const h = document.createElement('h2');
        h.textContent = node.title;
        wrapper.appendChild(h);
    }
    const layout = String(node.layout || 'vstack');
    const body = document.createElement('div');
    body.className = 'group-body';
    if (/^hstack$/i.test(layout)) body.classList.add('layout-hstack');
    else if (/^vstack$/i.test(layout)) body.classList.add('layout-vstack');
    else {
        const m = /^columns-(\d+)$/i.exec(layout);
        if (m) body.classList.add('layout-columns', `cols-${m[1]}`);
        else body.classList.add('layout-vstack');
    }
    (node.children || []).forEach(ch => {
        if (!ch || ch.type === 'include') return;
        if (ch.type === 'group') { const el = renderGroup(ch, state); if (el) body.appendChild(el); }
        else if (ch.type === 'field') { const el = renderField(ch, state); if (el) body.appendChild(el); }
    });
    wrapper.appendChild(body);
    return wrapper;
}

function renderField(node, state) {
    const wrapper = document.createElement('div');
    wrapper.className = 'form-row inline';
    wrapper.dataset.fieldId = node.id;
    if (node.if) wrapper.dataset.condition = node.if;
    if (node.label) {
        const label = document.createElement('label');
        label.textContent = node.label;
        label.htmlFor = node.id;
        wrapper.appendChild(label);
    }

    if ((node.fieldType === 'text' && node.multiline !== true) || node.fieldType === 'number' ||
        node.fieldType === 'checkbox' || node.fieldType === 'date') {
        renderInputField(node, wrapper, state);
    } else if (node.fieldType === 'text' && node.multiline === true) {
        renderMultiLineTextField(node, wrapper, state);
    } else if (node.fieldType === 'select') {
        renderSelectField(node, wrapper, state);
    } else if (node.fieldType === 'table') {
        renderTableField(node, wrapper, state);
    } else if (node.fieldType === 'diagnosis') {
        renderDiagnosisField(node, wrapper, state);
    } else if (node.fieldType === 'complaints') {
        renderComplaintsField(node, wrapper, state);
    } else if (node.fieldType === 'list') {
        renderListField(node, wrapper, state);
    } else if (node.fieldType === 'static') {
        wrapper.classList.remove('inline');
        wrapper.classList.add('static-block');
        const div = document.createElement('div');
        div.innerHTML = renderMarkdownBasic(node.content || '');
        wrapper.appendChild(div);
        state.fieldRefs[node.id || ('static_' + Math.random().toString(36).slice(2))] = { value: node.content };
    } else if (node.fieldType === 'computed') {
        const span = document.createElement('span');
        span.id = node.id;
        span.className = 'computed-value';
        wrapper.appendChild(span);
        state.fieldRefs[node.id] = { get value() { return span.textContent; }, set value(v) { span.textContent = v; } };
        state.computed.push(node);
    } else if (node.fieldType === 'hidden') {
        renderHiddenInput(node, wrapper, state);
    }
    // else if (node.fieldType === 'image') {
    //     const label = document.createElement('label'); label.textContent = node.label || node.id; wrapper.appendChild(label);
    //     const holder = document.createElement('div'); holder.className = 'field-input';
    //     const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; if (node.mode === 'capture') input.setAttribute('capture', 'environment');
    //     const preview = document.createElement('img'); preview.style.maxWidth = '150px'; preview.style.display = 'none';
    //     input.addEventListener('change', () => { const file = input.files && input.files[0]; if (!file) return; const maxKB = parseInt(node.maxSizeKB || '0', 10); const reader = new FileReader(); reader.onload = () => { let dataUrl = reader.result; if (maxKB && dataUrl.length / 1024 > maxKB) { alert('Image exceeds max size'); return; } preview.src = dataUrl; preview.style.display = 'block'; state.fieldRefs[node.id]._data = { name: file.name, dataUrl }; }; reader.readAsDataURL(file); });
    //     holder.appendChild(input); holder.appendChild(preview); wrapper.appendChild(holder);
    //     state.fieldRefs[node.id] = { _data: null, get value() { return this._data; } };
    // }
    //  else if (node.fieldType === 'comorbidities') {
    //     // Checkboxes with duration and treatment
    //     wrapper.classList.remove('inline');
    //     const title = document.createElement('label'); title.textContent = node.label || 'Comorbidities'; wrapper.appendChild(title);
    //     const holder = document.createElement('div'); holder.className = 'field-input';
    //     const list = (node.items || 'diabetes,hypertension,TB,asthma,CAD,CKD,DCLD,Epilepsy,thyroid').split(',').map(s => s.trim()).filter(Boolean);
    //     list.forEach(name => {
    //         const row = document.createElement('div'); row.className = 'combo-row';
    //         const id = `${node.id}_${name}`;
    //         const cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = id; cb.name = id; const lbl = document.createElement('label'); lbl.textContent = name; lbl.htmlFor = id; const dur = document.createElement('input'); dur.type = 'text'; dur.placeholder = 'Duration'; dur.className = 'small'; const tx = document.createElement('input'); tx.type = 'text'; tx.placeholder = 'Treatment'; tx.className = 'small';
    //         row.appendChild(cb); row.appendChild(lbl); row.appendChild(dur); row.appendChild(tx); holder.appendChild(row);
    //     });
    //     wrapper.appendChild(holder);
    //     state.fieldRefs[node.id] = { get value() { return [...holder.querySelectorAll('.combo-row')].filter(r => r.querySelector('input[type=checkbox]').checked).map(r => ({ name: r.querySelector('label').textContent, duration: r.querySelector('input[placeholder=Duration]').value, treatment: r.querySelector('input[placeholder=Treatment]').value })); } };
    // } else if (node.fieldType === 'personal-history') {
    //     wrapper.classList.remove('inline');
    //     const title = document.createElement('label'); title.textContent = node.label || 'Personal History'; wrapper.appendChild(title);
    //     const holder = document.createElement('div'); holder.className = 'field-input';
    //     holder.innerHTML = `<div class='ph-grid'>
    //   <div><span>Sleep</span><select data-key='sleep'><option value=''>--</option><option>Normal</option><option>Disturbed</option></select></div>
    //   <div><span>Appetite</span><select data-key='appetite'><option value=''>--</option><option>Normal</option><option>Reduced</option><option>Increased</option></select></div>
    //   <div><span>Bowel</span><input data-key='bowel' placeholder='Habits'/></div>
    //   <div><span>Bladder</span><input data-key='bladder' placeholder='Habits'/></div>
    //   <div><span>Diet</span><select data-key='diet'><option value=''>--</option><option>Veg</option><option>Non-Veg</option><option>Mixed</option></select></div>
    //   <div><span>Alcohol</span><input data-key='alcohol' placeholder='Amount & duration'/></div>
    //   <div><span>Smoking</span><input data-key='smoking' placeholder='Amount & duration'/></div>
    // </div>`;
    //     wrapper.appendChild(holder);
    //     state.fieldRefs[node.id] = { get value() { const obj = {}; holder.querySelectorAll('[data-key]').forEach(el => { obj[el.dataset.key] = el.value; }); return obj; } };
    // } else if (node.fieldType === 'menstrual-history') {
    //     wrapper.classList.remove('inline');
    //     const title = document.createElement('label'); title.textContent = node.label || 'Menstrual History'; wrapper.appendChild(title);
    //     const holder = document.createElement('div'); holder.className = 'field-input';
    //     holder.innerHTML = `<div class='mh-grid'>
    //   <div><span>Menarche Age</span><input type='number' min='8' max='25' data-key='menarche_age'/></div>
    //   <div><span>Cycle Regularity</span><select data-key='regularity'><option>Regular</option><option>Irregular</option></select></div>
    //   <div><span>Cycle Length (days)</span><input type='number' min='10' max='60' data-key='cycle_len'/></div>
    //   <div><span>Bleed Duration (days)</span><input type='number' min='1' max='15' data-key='bleed_len'/></div>
    //   <div><span>Flow</span><select data-key='flow'><option>Normal</option><option>Light</option><option>Heavy</option></select></div>
    //   <div><span>Pain/Clots</span><input data-key='pain_clots' placeholder='Pain, clots'/></div>
    // </div>`;
    //     wrapper.appendChild(holder);
    //     state.fieldRefs[node.id] = { get value() { const obj = {}; holder.querySelectorAll('[data-key]').forEach(el => { obj[el.dataset.key] = el.value; }); return obj; } };
    // } else if (node.fieldType === 'general-exam') {
    //     wrapper.classList.remove('inline');
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
    // } else if (node.fieldType === 'drug-treatment') {
    //     // uses local drug json catalogs
    //     wrapper.classList.remove('inline');
    //     const label = document.createElement('label'); label.textContent = node.label || 'Treatment'; wrapper.appendChild(label);
    //     const holder = document.createElement('div'); holder.className = 'field-input';
    //     const table = document.createElement('table'); table.className = 'drug-table'; table.innerHTML = '<thead><tr><th>Drug</th><th>Dose</th><th>Frequency</th><th>Route</th><th>Duration</th><th></th></tr></thead><tbody></tbody>';
    //     const tbody = table.querySelector('tbody');
    //     const addBtn = document.createElement('button'); addBtn.type = 'button'; addBtn.textContent = 'Add Drug';
    //     addBtn.addEventListener('click', () => addRow());
    //     holder.appendChild(table); holder.appendChild(addBtn); wrapper.appendChild(holder);
    //     const drugCache = {};
    //     async function loadCatalogLocal(path) { if (drugCache[path]) return drugCache[path]; const res = await fetch(path); const json = await res.json(); drugCache[path] = json; return json; }
    //     let drugList = [], doseList = [], freqList = [], routeList = [];
    //     Promise.all([
    //         loadCatalogLocal('data/drugs.json'),
    //         loadCatalogLocal('data/drug-dosages.json'),
    //         loadCatalogLocal('data/drug-frequency.json'),
    //         loadCatalogLocal('data/drug-routes.json')
    //     ]).then(([a, b, c, d]) => { drugList = a; doseList = b; freqList = c; routeList = d; });
    //     function buildSelect(options) { const s = document.createElement('select'); const blank = document.createElement('option'); blank.value = ''; blank.textContent = '--'; s.appendChild(blank); options.forEach(o => { const opt = document.createElement('option'); if (typeof o === 'string') { opt.value = o; opt.textContent = o; } else { opt.value = o.value || o.name || o.code || o; opt.textContent = o.label || o.name || o.value || o; } s.appendChild(opt); }); return s; }
    //     function addRow(rowData = {}) {
    //         const tr = document.createElement('tr');
    //         const drugTd = document.createElement('td'); const drugSel = buildSelect(drugList); drugSel.value = rowData.drug || ''; drugTd.appendChild(drugSel); tr.appendChild(drugTd);
    //         const doseTd = document.createElement('td'); const doseSel = buildSelect(doseList); doseSel.value = rowData.dose || ''; doseTd.appendChild(doseSel); tr.appendChild(doseTd);
    //         const freqTd = document.createElement('td'); const freqSel = buildSelect(freqList); freqSel.value = rowData.frequency || ''; freqTd.appendChild(freqSel); tr.appendChild(freqTd);
    //         const routeTd = document.createElement('td'); const routeSel = buildSelect(routeList); routeSel.value = rowData.route || ''; routeTd.appendChild(routeSel); tr.appendChild(routeTd);
    //         const durTd = document.createElement('td'); const dur = document.createElement('input'); dur.type = 'text'; dur.placeholder = 'e.g. 5 days'; dur.value = rowData.duration || ''; durTd.appendChild(dur); tr.appendChild(durTd);
    //         const action = document.createElement('td'); const rm = document.createElement('button'); rm.type = 'button'; rm.textContent = '×'; rm.addEventListener('click', () => tr.remove()); action.appendChild(rm); tr.appendChild(action);
    //         tbody.appendChild(tr);
    //     }
    //     state.fieldRefs[node.id] = { get value() { return [...tbody.querySelectorAll('tr')].map(tr => { const tds = tr.querySelectorAll('td'); return { drug: tds[0].querySelector('select').value, dose: tds[1].querySelector('select').value, frequency: tds[2].querySelector('select').value, route: tds[3].querySelector('select').value, duration: tds[4].querySelector('input').value }; }).filter(r => r.drug); } };
    // } else if (node.fieldType === 'investigations') {
    //     wrapper.classList.remove('inline');
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
    //     wrapper.classList.remove('inline');
    //     const label = document.createElement('label'); label.textContent = node.label || 'Opinions Obtained'; wrapper.appendChild(label);
    //     const holder = document.createElement('div'); holder.className = 'field-input'; const table = document.createElement('table'); table.innerHTML = '<thead><tr><th>Date</th><th>Department</th><th>Impression</th><th>Suggestions</th><th></th></tr></thead><tbody></tbody>';
    //     const tbody = table.querySelector('tbody'); const addBtn = document.createElement('button'); addBtn.type = 'button'; addBtn.textContent = 'Add Opinion'; addBtn.addEventListener('click', () => addRow()); holder.appendChild(table); holder.appendChild(addBtn); wrapper.appendChild(holder);
    //     function addRow(data = {}) { const tr = document.createElement('tr');['date', 'text', 'text', 'text'].forEach((t, i) => { const td = document.createElement('td'); const el = document.createElement('input'); el.type = t; el.value = [data.date, data.department, data.impression, data.suggestions][i] || ''; td.appendChild(el); tr.appendChild(td); }); const act = document.createElement('td'); const rm = document.createElement('button'); rm.type = 'button'; rm.textContent = '×'; rm.addEventListener('click', () => tr.remove()); act.appendChild(rm); tr.appendChild(act); tbody.appendChild(tr); }
    //     state.fieldRefs[node.id] = { get value() { return [...tbody.querySelectorAll('tr')].map(tr => { const [d, dep, imp, sug] = [...tr.querySelectorAll('input')].map(i => i.value); return { date: d, department: dep, impression: imp, suggestions: sug }; }).filter(r => r.date || r.department); } };
    // } else if (node.fieldType === 'followup') {
    //     wrapper.classList.remove('inline');
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

function renderComplaintsField(node, wrapper, state) {
    wrapper.classList.remove('inline');
    const list = document.createElement('div');
    list.className = 'complaints-wrapper';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = 'Add Complaint';
    addBtn.addEventListener('click', () => addEntry('', ''));
    wrapper.appendChild(list);
    wrapper.appendChild(addBtn);

    function addEntry(complaint, duration, unit = 'days') {
        const row = document.createElement('div');
        row.className = 'complaint-row';
    const cAc = new AutoCompleteBox();
        cAc.setAttribute('placeholder', node.placeholder || '');
        cAc.value = complaint || '';
        cAc.fetcher = snomedSearchWithCache;
        cAc.getItemLabel = (item) => item || '';
        const d = document.createElement('input');
        d.type = 'number';
        d.min = '1';
        d.placeholder = 'Duration';
        d.value = duration;

        const u = document.createElement('select');
        u.className = 'duration-unit';
        const options = ['days', 'weeks', 'months', 'years'];
        options.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt;
            option.textContent = opt;
            u.appendChild(option);
        });
        u.value = options.includes(unit) ? unit : 'days';

        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'remove-button';
        rm.addEventListener('click', () => row.remove());
        row.appendChild(cAc);
        row.appendChild(d);
        row.appendChild(u);
        row.appendChild(rm);
        list.appendChild(row);
    }

    state.fieldRefs[node.id] = {
        get value() {
            return [...list.querySelectorAll('.complaint-row')].map(r => {
                const c = r.querySelector('auto-complete-box')?.value || '';
                const d = r.querySelector('input[type=number]').value;
                const u = r.querySelector('select.duration-unit').value;
                return { complaint: c, duration: d, unit: u };
            }).filter(e => e.complaint);
        },
        set value(v) {
            list.innerHTML = '';
            if (Array.isArray(v)) v.forEach(e => addEntry(e.complaint || '', e.duration || '', e.unit || 'days'));
        }
    };
}

function renderDiagnosisField(node, wrapper, state) {
    const baseId = (node && node.id) ? String(node.id) : `diagnosis-${Math.random().toString(36).slice(2)}`;
    const ac = new AutoCompleteBox();
    ac.setAttribute('placeholder', node.placeholder || '');
    ac.id = baseId;
    ac.fetcher = async (q) => icdSearchWithCache(q);
    ac.getItemLabel = (item) => (item && (item.description || item.label || item.name || item.value || item.code)) || '';
    ac.getItemSecondary = (item) => (item && item.code) ? String(item.code) : '';

    const tagList = document.createElement('div');
    tagList.className = 'tag-list';

    if (!Array.isArray(state.diagnosis)) state.diagnosis = [];

    function renderTags() {
        tagList.innerHTML = '';
        state.diagnosis.forEach((entry, idx) => {
            const tag = document.createElement('span');
            tag.className = 'tag';
            tag.textContent = `${entry.description}` + (entry.code ? ` (${entry.code})` : '');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'remove-button';
            btn.addEventListener('click', () => {
                state.diagnosis.splice(idx, 1);
                renderTags();
            });
            tag.appendChild(btn);
            tagList.appendChild(tag);
        });
    }

    ac.addEventListener('commit', (e) => {
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
        get value() { return state.diagnosis; },
        set value(v) {
            state.diagnosis = Array.isArray(v) ? v : [];
            renderTags();
        }
    };
}

function renderInputField(node, wrapper, state) {
    const input = document.createElement('input');
    input.id = node.id;
    input.name = node.id;
    input.type = node.fieldType;
    if (node.placeholder) input.placeholder = node.placeholder;
    if (node.min) input.min = node.min;
    if (node.max) input.max = node.max;
    if (node.pattern) input.pattern = node.pattern;
    if (node.default !== undefined) input.value = node.default;
    wrapper.appendChild(input);
    state.fieldRefs[node.id] = input;
    if (node.required || node.min || node.max || node.pattern) {
        applyValidation(input, { required: node.required, min: node.min, max: node.max, pattern: node.pattern });
    }
}

function renderMultiLineTextField(node, wrapper, state) {
    const ta = document.createElement('textarea');
    ta.id = node.id;
    ta.name = node.id;
    wrapper.appendChild(ta);
    state.fieldRefs[node.id] = ta;
    if (node.default) ta.value = node.default;
    if (node.required) { applyValidation(ta, { required: true }); }
}

function renderSelectField(node, wrapper, state) {
    const select = document.createElement('select');
    select.id = node.id;
    select.name = node.id;
    wrapper.appendChild(select);
    state.fieldRefs[node.id] = select;
    if (node.default) select.value = node.default;
    if (node.required) applyValidation(select, { required: true });
    if (node.multiple) select.multiple = true;

    loadSelectOptions(select, node, state).catch(console.error);
}

async function loadSelectOptions(selectEl, node, state) {
    if (node.source) {
        const data = await loadCatalog(node.source, state);
        data.forEach(opt => { const o = document.createElement('option'); o.value = opt.value || opt.code || opt.id || opt; o.textContent = opt.label || opt.value || opt.code || opt; selectEl.appendChild(o); });
    } else if (node.options) {
        const arr = Array.isArray(node.options) ? node.options : String(node.options).split(',').map(o => o.trim());
        arr.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; selectEl.appendChild(o); });
    }
}

async function loadCatalog(path, state) {
    if (state.catalogsCache[path]) return state.catalogsCache[path];
    const res = await fetch(path);
    if (!res.ok) throw new Error('Catalog load failed: ' + path);
    const json = await res.json();
    state.catalogsCache[path] = json;
    return json;
}

function renderTableField(node, wrapper, state) {
    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'table-wrapper';
    const table = document.createElement('table');
    const cols = node.columns;
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr>';
    const tbody = document.createElement('tbody');
    table.appendChild(thead);
    table.appendChild(tbody);
    tableWrapper.appendChild(table);
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = 'Add Row';
    addBtn.className = 'add-row-btn';
    function addRow(values = {}) {
        const tr = document.createElement('tr');
        cols.forEach(col => {
            const td = document.createElement('td');
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.dataset.col = col;
            inp.value = values[col] || '';
            td.appendChild(inp);
            tr.appendChild(td);
        });
        const removeRow = document.createElement('td');
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'remove-button';
        rm.addEventListener('click', () => tbody.removeChild(tr));
        removeRow.appendChild(rm);
        tr.appendChild(removeRow);
        tbody.appendChild(tr);
    }
    addBtn.addEventListener('click', () => addRow());
    tableWrapper.appendChild(addBtn);
    wrapper.appendChild(tableWrapper);

    state.fieldRefs[node.id] = {
        get value() {
            return [...tbody.querySelectorAll('tr')].map(tr => {
                const obj = {};
                cols.forEach(col => {
                    const inp = tr.querySelector(`input[data-col="${col}"]`);
                    obj[col] = inp.value;
                });
                return obj;
            });
        },
        set value(v) {
            if (!Array.isArray(v)) return;
            tbody.innerHTML = '';
            v.forEach(row => addRow(row));
        }
    };
}

function renderListField(node, wrapper, state) {
    const listWrapper = document.createElement('div');
    listWrapper.className = 'list-wrapper';
    const ul = document.createElement('ul');
    ul.className = 'list-field';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = 'Add';
    addBtn.addEventListener('click', () => addItem(''));
    listWrapper.appendChild(ul);
    listWrapper.appendChild(addBtn);
    wrapper.appendChild(listWrapper);
    function addItem(val) {
        const li = document.createElement('li');
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.value = val || '';
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'remove-button';
        rm.addEventListener('click', () => li.remove());
        li.appendChild(inp);
        li.appendChild(rm);
        ul.appendChild(li);
    }
    state.fieldRefs[node.id] = {
        get value() {
            return [...ul.querySelectorAll('li input')].map(i => i.value).filter(v => v.trim() !== '');
        },
        set value(v) {
            if (!Array.isArray(v)) return;
            ul.innerHTML = '';
            v.forEach(item => addItem(item));
        }
    };
}

function renderHiddenInput(node, wrapper, state) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.id = node.id;
    input.name = node.id;
    if (node.default) input.value = node.default;
    wrapper.style.display = 'none';
    wrapper.appendChild(input);
    state.fieldRefs[node.id] = input;
}

export function reevaluateConditions(root, state) {
    const rows = root.querySelectorAll('[data-condition]');
    rows.forEach(row => {
        const expr = row.dataset.condition;
        const visible = evaluateCondition(expr, id => getFieldValue(id, state));
        row.classList.toggle('hidden', !visible);
    });
}

export function getFieldValueFromRef(ref) {
    if (!ref) return undefined;
    if (ref instanceof HTMLElement) {
        if (ref.type === 'checkbox') return ref.checked;
    }
    return ref && 'value' in ref ? ref.value : undefined;
}

export function getFieldValue(id, state) {
    const ref = state.fieldRefs[id];
    return getFieldValueFromRef(ref);
}

export function evaluateComputedAll(state) {
    if (!state.computed.length) return;
    state.computed.forEach(node => {
        const formula = node.formula; if (!formula) return;
        try {
            // Use a Proxy that cooperates with `with(ctx)` lookup rules:
            // - `has` must return true for known field ids so identifiers bind here
            // - return false for others so globals like Math/Date stay accessible
            const ctx = new Proxy({}, {
                has(_, prop) {
                    if (typeof prop === 'symbol') return false;
                    return Object.prototype.hasOwnProperty.call(state.fieldRefs, prop);
                },
                get(_, prop) {
                    if (typeof prop === 'symbol') return undefined;
                    return getFieldValue(prop, state);
                }
            });

            const fn = new Function('ctx', `with(ctx){ return ${formula}; }`);
            let val = fn(ctx);
            if (node.format && /^decimal\(\d+\)$/.test(node.format)) {
                const d = parseInt(node.format.match(/decimal\((\d+)\)/)[1], 10); if (typeof val === 'number') val = val.toFixed(d);
            }
            state.fieldRefs[node.id].value = (val ?? '').toString();
        } catch (e) { /* ignore */ }
    });
}

export function renderMarkdownBasic(md) {
    if (!md) return '';
    const text = String(md).replace(/\r\n?/g, '\n');
    const lines = text.split('\n');

    const out = [];
    let para = [];
    let inUL = false;
    let inOL = false;

    const escapeHtml = (s) => s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;');

    const applyInline = (s) => {
        // Escape first, then transform inline markdown
        let t = escapeHtml(s);
        t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        t = t.replace(/\*(.+?)\*/g, '<em>$1</em>');
        return t;
    };

    const flushPara = () => {
        if (para.length) {
            out.push('<p>' + para.join('<br/>') + '</p>');
            para = [];
        }
    };

    const closeLists = () => {
        if (inUL) { out.push('</ul>'); inUL = false; }
        if (inOL) { out.push('</ol>'); inOL = false; }
    };

    for (const raw of lines) {
        const line = raw.replace(/\s+$/,'');
        const trimmed = line.trim();

        // Blank line => paragraph/list boundary
        if (!trimmed) {
            flushPara();
            closeLists();
            continue;
        }

        // Unordered list item "- " or "* "
        let m = /^\s*[-*]\s+(.+)$/.exec(line);
        if (m) {
            flushPara();
            if (!inUL) { closeLists(); out.push('<ul>'); inUL = true; }
            out.push('<li>' + applyInline(m[1].trim()) + '</li>');
            continue;
        }

        // Ordered list item "1. ", "2. ", ...
        m = /^\s*\d+\.\s+(.+)$/.exec(line);
        if (m) {
            flushPara();
            if (!inOL) { closeLists(); out.push('<ol>'); inOL = true; }
            out.push('<li>' + applyInline(m[1].trim()) + '</li>');
            continue;
        }

        // Regular paragraph text (keep single newlines as <br/>)
        para.push(applyInline(line));
    }

    flushPara();
    closeLists();
    return out.join('');
}
