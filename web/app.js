import { parseMCTMResolved } from './js/mctm/mctm_parser.js';
import { lintMCTM } from './js/mctm/mctm_linter.js';
import { validateAll } from './js/validation.js';
import { renderAST, reevaluateConditions, evaluateComputedAll, getFieldValueFromRef } from './js/ui_renderer.js';
import { renderPDF } from './js/pdf_renderer.js';

const formContainer = document.getElementById('formContainer');
const jsonBtn = document.getElementById('jsonBtn');
const pdfBtn = document.getElementById('pdfBtn');
const templatesBtn = document.getElementById('templatesBtn');
const settingsBtn = document.getElementById('settingsBtn');

const jsonPreview = document.getElementById('jsonPreview');
const copyJsonBtn = document.getElementById('copyJsonBtn');
const downloadJsonBtn = document.getElementById('downloadJsonBtn');
const pdfPreviewBtn = document.getElementById('pdfPreviewBtn');
const pdfPrintBtn = document.getElementById('pdfPrintBtn');
const pdfDownloadBtn = document.getElementById('pdfDownloadBtn');
const templatesTree = document.getElementById('templatesTree');

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

// ----- Theme handling -----
const THEME_STORAGE_KEY = 'dischargen_theme_v1';
const prefersDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : { matches: false, addEventListener: () => { } };

function applyTheme(mode) {
  const root = document.documentElement;
  root.classList.remove('theme-dark', 'theme-light');
  if (mode === 'dark') root.classList.add('theme-dark');
  else if (mode === 'light') root.classList.add('theme-light');
  else {
    // system
    if (prefersDark.matches) root.classList.add('theme-dark');
    // else no explicit class to allow light defaults
  }
}

function initTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY) || 'system';
  applyTheme(saved);
  // reflect in settings modal radios
  const radios = document.querySelectorAll('input[name="themeMode"]');
  radios.forEach(r => { r.checked = (r.value === saved); });
  if (prefersDark.addEventListener) {
    prefersDark.addEventListener('change', () => {
      const current = localStorage.getItem(THEME_STORAGE_KEY) || 'system';
      if (current === 'system') applyTheme('system');
    });
  }
}

document.addEventListener('change', (e) => {
  if (e.target && e.target.name === 'themeMode') {
    const mode = e.target.value;
    try { localStorage.setItem(THEME_STORAGE_KEY, mode); } catch { }
    applyTheme(mode);
  }
});

// Template registry handling
let templateRegistry = [];
let departments = [];
async function loadTemplateRegistry() {
  try {
    const res = await fetch('templates/templates.json');
    templateRegistry = await res.json();
    // Load departments catalog (for tree grouping)
    try {
      const dres = await fetch('data/departments.json');
      departments = await dres.json();
    } catch { }
    // Auto load default template
    const def = templateRegistry.find(t => t.default) || templateRegistry[0];
    if (def) await loadTemplateById(def.id);
  } catch (e) {
    console.error('Failed to load template registry', e);
  }
}

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
  renderAST(formContainer, state);
  try { updateLangBadge(state.meta); } catch { }
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

jsonBtn.addEventListener('click', () => {
  if (!validateAll(formContainer)) { alert('Validation errors present'); return; }
  const data = collectData();
  // Show JSON modal with content and offer copy/download
  jsonPreview.value = JSON.stringify(data, null, 2);
  openModal('jsonModal');
});

pdfBtn.addEventListener('click', async () => {
  if (!validateAll(formContainer)) { alert('Validation errors present'); return; }
  const data = collectData();
  const meta = state.meta || {};
  latestPdf = {
    docDefinition: await renderPDF(state.meta, state.ast, data),
    filename: `${data.patient_pin || 'patient'}_discharge_summary.pdf`.replace(/[^a-z0-9._-]/gi, '_')
  };
  if (!globalThis.pdfMake) { alert('PDF engine not loaded'); return; }
  openModal('pdfModal');
});

function downloadFile(filename, content) {
  const a = document.createElement('a');
  a.href = 'data:application/octet-stream,' + encodeURIComponent(content);
  a.download = filename; a.click();
}

// Modal helpers
function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('hidden');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('hidden');
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-close]');
  if (btn) {
    closeModal(btn.getAttribute('data-close'));
  }
  // click outside to close
  const modal = e.target.closest('.modal-content');
  if (!modal && e.target.classList && e.target.classList.contains('modal')) {
    e.target.classList.add('hidden');
  }
});

copyJsonBtn?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(jsonPreview.value);
    alert('Copied to clipboard');
  } catch { }
});

downloadJsonBtn?.addEventListener('click', () => {
  downloadFile('discharge.json', jsonPreview.value || '{}');
});

let latestPdf = null;

pdfPreviewBtn?.addEventListener('click', () => {
  if (!latestPdf || !globalThis.pdfMake) return;
  globalThis.pdfMake.createPdf(latestPdf.docDefinition).open();
});

pdfPrintBtn?.addEventListener('click', () => {
  if (!latestPdf || !globalThis.pdfMake) return;
  globalThis.pdfMake.createPdf(latestPdf.docDefinition).print();
});

pdfDownloadBtn?.addEventListener('click', () => {
  if (!latestPdf || !globalThis.pdfMake) return;
  globalThis.pdfMake.createPdf(latestPdf.docDefinition).download(latestPdf.filename);
});

settingsBtn?.addEventListener('click', () => openModal('settingsModal'));

templatesBtn?.addEventListener('click', () => {
  buildTemplatesTree();
  openModal('templatesModal');
});

function buildTemplatesTree() {
  if (!templatesTree) return;
  // Build map deptId -> {label, items: []}
  const deptById = new Map();
  departments.forEach(d => deptById.set(d.id, { label: d.label, id: d.id }));
  const buckets = new Map();
  templateRegistry.forEach(t => {
    const depId = t.department_id || 'uncat';
    if (!buckets.has(depId)) {
      const d = deptById.get(depId);
      buckets.set(depId, { label: d ? d.label : 'Uncategorized', id: depId, items: [] });
    }
    buckets.get(depId).items.push(t);
  });

  // Render
  templatesTree.innerHTML = '';
  [...buckets.values()].sort((a, b) => a.label.localeCompare(b.label)).forEach(bucket => {
    const section = document.createElement('div');
    section.className = 'tree-section';
    const h = document.createElement('div'); h.className = 'tree-section-title';
    h.textContent = bucket.label;
    section.appendChild(h);
    const ul = document.createElement('ul');
    ul.className = 'tree-list';
    bucket.items.forEach(item => {
      const li = document.createElement('li');
      li.className = 'tree-item';
      const name = document.createElement('span');
      name.textContent = item.name || item.id;
      name.className = 'tree-item-name';
      const actions = document.createElement('span');
      actions.className = 'tree-item-actions';
      const loadBtn = document.createElement('button');
      loadBtn.className = 'icon-button';
      loadBtn.title = 'Load Template';
      loadBtn.innerHTML =
        `<svg class="icon" xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 24 24">
          <path fill="currentColor"
            d="M18.5 20a.5.5 0 0 1-.5.5h-5.732A6.5 6.5 0 0 1 11.19 22H18a2 2 0 0 0 2-2V9.828a2 2 0 0 0-.586-1.414l-5.829-5.828l-.049-.04l-.036-.03a2 2 0 0 0-.219-.18a1 1 0 0 0-.08-.044l-.048-.024l-.05-.029c-.054-.031-.109-.063-.166-.087a2 2 0 0 0-.624-.138q-.03-.002-.059-.007L12.172 2H6a2 2 0 0 0-2 2v7.498a6.5 6.5 0 0 1 1.5-.422V4a.5.5 0 0 1 .5-.5h6V8a2 2 0 0 0 2 2h4.5zm-5-15.379L17.378 8.5H14a.5.5 0 0 1-.5-.5z"/><path d="M12 17.5a5.5 5.5 0 1 1-11 0a5.5 5.5 0 0 1 11 0m-2.146-2.354a.5.5 0 0 0-.708 0L5.5 18.793l-1.646-1.647a.5.5 0 0 0-.708.708l2 2a.5.5 0 0 0 .708 0l4-4a.5.5 0 0 0 0-.708"/>
        </svg>`;
      loadBtn.addEventListener('click', async () => { await loadTemplateById(item.id); closeModal('templatesModal'); });
      const dlBtn = document.createElement('button');
      dlBtn.className = 'icon-button';
      dlBtn.title = 'Download Template';
      dlBtn.innerHTML =
        `<svg class="icon" xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 24 24">
          <path fill="currentColor"
            d="M6 2a2 2 0 0 0-2 2v7.498a6.5 6.5 0 0 1 1.5-.422V4a.5.5 0 0 1 .5-.5h6V8a2 2 0 0 0 2 2h4.5v10a.5.5 0 0 1-.5.5h-5.732A6.5 6.5 0 0 1 11.19 22H18a2 2 0 0 0 2-2V9.828a2 2 0 0 0-.586-1.414l-5.828-5.828A2 2 0 0 0 12.172 2zm11.38 6.5H14a.5.5 0 0 1-.5-.5V4.62zm-5.38 9a5.5 5.5 0 1 1-11 0a5.5 5.5 0 0 1 11 0m-5-3a.5.5 0 0 0-1 0v4.793l-1.646-1.647a.5.5 0 0 0-.708.708l2.5 2.5a.5.5 0 0 0 .708 0l2.5-2.5a.5.5 0 0 0-.708-.708L7 19.293z" />
        </svg>`;
      dlBtn.addEventListener('click', async () => {
        try {
          const res = await fetch(`templates/${item.file}`);
          const txt = await res.text();
          downloadFile(item.file || (item.id + '.mctm'), txt);
        } catch { }
      });
      actions.appendChild(loadBtn); actions.appendChild(dlBtn);
      li.appendChild(name); li.appendChild(actions); ul.appendChild(li);
    });
    section.appendChild(ul);
    templatesTree.appendChild(section);
  });
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

initTheme();
// initial load via registry
loadTemplateRegistry();
