import { parseMCTMResolved } from './js/mctm/mctm_parser.js';
import { lintMCTM } from './js/mctm/mctm_linter.js';
import { validateAll } from './js/validation.js';
import { renderAST, reevaluateConditions, evaluateComputedAll, getFieldValueFromRef } from './js/ui_renderer.js';
import { renderPDF } from './js/pdf_renderer.js';

const formContainer = document.getElementById('formContainer');
const templateSelect = document.getElementById('templateSelect');
const exportJsonBtn = document.getElementById('exportJsonBtn');
const exportPdfBtn = document.getElementById('exportPdfBtn');

// Lab report fetch helper (POST) – returns parsed JSON (or raw text if not JSON).
// NOTE: Expose ticket & params via UI / config; do NOT hardcode secrets.
export async function fetchLabReport({
  ticket, // varSSOTicketGrantingTicket value
  userAgent = navigator.userAgent,
  crNo,
  startDate, // format: DD-MMM-YYYY e.g. 05-Sep-2020
  endDate
}) {
  if (!ticket || !crNo || !startDate || !endDate) {
    throw new Error('Missing required parameters (ticket, crNo, startDate, endDate)');
  }
  const url = 'https://tnhmis.dmer.tn.gov.in/HISInvestigationServicesApi/LabHTMLReportPrinting/getLabReportByCrNo';
  const bodyParams = new URLSearchParams({
    varSSOTicketGrantingTicket: ticket,
    userAgent,
    crNo,
    startDate,
    endDate
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Accept': 'application/json, text/plain, */*'
    },
    body: bodyParams.toString()
  });
  if (!res.ok) {
    throw new Error(`Lab report request failed: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

const state = { meta: {}, ast: [], fieldRefs: {}, catalogsCache: {}, autosaveKey: 'discharge_autosave_v1', computed: [] };

// Template registry handling
let templateRegistry = [];
async function loadTemplateRegistry() {
  try {
    const res = await fetch('templates/templates.json');
    templateRegistry = await res.json();
    renderTemplateOptions();
    // Auto load default template
    const def = templateRegistry.find(t => t.default) || templateRegistry[0];
    if (def) {
      templateSelect.value = def.id;
      await loadTemplateById(def.id);
    }
  } catch (e) {
    console.error('Failed to load template registry', e);
  }
}

function renderTemplateOptions() {
  templateSelect.innerHTML = '';
  templateRegistry.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name || t.id;
    templateSelect.appendChild(opt);
  });
}

templateSelect?.addEventListener('change', async () => {
  const id = templateSelect.value;
  if (id) await loadTemplateById(id);
});

async function loadTemplateById(id) {
  const entry = templateRegistry.find(t => t.id === id);
  if (!entry) return;
  try {
    const path = `templates/${entry.file}`;
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const txt = await res.text();
    await loadTemplate(txt);
  } catch (e) {
    console.error('Failed to load template', id, e);
  }
}

async function loadTemplate(text) {
  formContainer.innerHTML = '';
  state.fieldRefs = {};
  state.computed = [];
  const parsed = await parseMCTMResolved(text, { onError: (msg) => console.warn('[include]', msg) });
  state.meta = parsed.meta || {};
  state.ast = parsed.ast || [];
  // Lint
  try {
    const diagnostics = lintMCTM({ source: text, ast: state.ast, meta: state.meta });
    state.diagnostics = diagnostics;
    if (diagnostics.length) {
      console.groupCollapsed('MCTM Lint Diagnostics');
      diagnostics.forEach(d => { const tag = d.level === 'error' ? 'error' : 'warn'; console[tag](`[${d.level.toUpperCase()}] line ${d.line}: ${d.message}`); });
      console.groupEnd();
    }
  } catch (e) { console.error('Lint failed', e); }
  await renderAST(formContainer, state);
  try { updateLangBadge(state.meta); } catch {}
  restoreAutosave();
  reevaluateConditions(formContainer, state);
  evaluateComputedAll(state);
}

formContainer.addEventListener('input', e => {
  const id = e.target.id;
  if (id) {
    reevaluateConditions(formContainer, state);
    evaluateComputedAll(state);
    autosave();
  }
});

function collectData() {
  const obj = {};
  Object.entries(state.fieldRefs).forEach(([id, ref]) => {
    obj[id] = getFieldValueFromRef(ref);
  });
  // Capture optional section states (checkboxes) if present
  if (state.sectionOptionals) {
    const map = {};
    Object.entries(state.sectionOptionals).forEach(([secId, cb]) => {
      map[secId] = !!(cb && cb.checked);
    });
    obj._sectionOptionals = map;
  }
  if (state.meta) obj._meta = state.meta;
  return obj;
}

exportJsonBtn.addEventListener('click', () => {
  if (!validateAll(formContainer)) { alert('Validation errors present'); return; }
  const data = collectData();
  downloadFile('discharge.json', JSON.stringify(data, null, 2));
});

exportPdfBtn.addEventListener('click', async () => {
  if (!validateAll(formContainer)) { alert('Validation errors present'); return; }
  const data = collectData();
  const meta = state.meta || {};
  const docDefinition = await renderPDF(state.meta, state.ast, data);
  const filename =  `${data.patient_pin}_discharge_summary.pdf`.replace(/[^a-z0-9._-]/gi, '_');
  if (!globalThis.pdfMake) { alert('PDF engine not loaded'); return; }
  globalThis.pdfMake.createPdf(docDefinition).open() //(filename);
});

function downloadFile(filename, content) {
  const a = document.createElement('a');
  a.href = 'data:application/octet-stream,' + encodeURIComponent(content);
  a.download = filename; a.click();
}

// Autosave
function autosave() {
  const data = collectData();
  try { localStorage.setItem(state.autosaveKey, JSON.stringify(data)); } catch (e) { }
}

function restoreAutosave() {
  try {
    const raw = localStorage.getItem(state.autosaveKey); if (!raw) return;
    const data = JSON.parse(raw);
    // Restore optional section checkbox states first (so dependent visibility correct)
    if (data._sectionOptionals && state.sectionOptionals) {
      Object.entries(data._sectionOptionals).forEach(([secId, val]) => {
        const cb = state.sectionOptionals[secId];
        if (cb) {
          cb.checked = !!val;
          // Trigger body hide/show
          cb.dispatchEvent(new Event('change'));
        }
      });
    }
    Object.entries(data).forEach(([id, val]) => {
      const ref = state.fieldRefs[id];
      if (!ref) return;
      if (ref instanceof HTMLElement) {
        if (ref.type === 'checkbox') ref.checked = !!val; else ref.value = val;
      } else if (ref && 'value' in ref) {
        // For custom refs that expose a value setter
        try { ref.value = val; } catch (e) { /* read-only or unsupported */ }
      }
    });
    reevaluateConditions(formContainer, state);
  } catch (e) { }
}

// initial load via registry
loadTemplateRegistry();
