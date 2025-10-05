import { parseMCTMResolved } from './js/mctm/mctm_parser.js';
import { lintMCTM } from './js/mctm/mctm_linter.js';
import { validateAll } from './js/validation.js';
import { renderUI, reevaluateConditions, evaluateComputedAll, getFieldValueFromRef } from './js/ui_renderer.js';
import { renderPDF } from './js/pdf_renderer.js';
import { loadDepartments } from './js/search_handler.js';

const formContainer = document.getElementById('formContainer');
const jsonBtn = document.getElementById('jsonBtn');
const pdfBtn = document.getElementById('pdfBtn');
const headerNewDischargeBtn = document.getElementById('headerNewDischargeBtn');

const landingScreen = document.getElementById('landing');
const newDischargeBtn = document.getElementById('newDischargeBtn');
const pinInput = document.getElementById('pinInput');
const stepPin = document.getElementById('stepPin');
const stepTemplate = document.getElementById('stepTemplate');
const templateFilterInput = document.getElementById('templateFilterInput');
const stepBackBtn = document.getElementById('stepBackButton');
const stepNextBtn = document.getElementById('stepNextButton');
const deptListEl = document.getElementById('deptList');
const templateListEl = document.getElementById('templateList');

const settingsBtn = document.getElementById('settingsBtn');
const sectionNavList = document.getElementById('sectionNavList');

const jsonPreview = document.getElementById('jsonPreview');
const copyJsonBtn = document.getElementById('copyJsonBtn');
const downloadJsonBtn = document.getElementById('downloadJsonBtn');
const pdfPreviewBtn = document.getElementById('pdfPreviewBtn');
const pdfPrintBtn = document.getElementById('pdfPrintBtn');
const pdfDownloadBtn = document.getElementById('pdfDownloadBtn');

const state = { meta: {}, ast: [], fieldRefs: {}, catalogsCache: {}, autosaveKey: 'dischargen_autosave_v1', computed: [] };

// Feature flags / temporary toggles
const DISABLE_LANDING_UI = true; // Temporarily bypass landing/start flow and load a default template directly

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
  radios.forEach(r => {
    r.checked = (r.value === saved);
    r.addEventListener('change', () => {
      if (r.checked) {
        try { localStorage.setItem(THEME_STORAGE_KEY, r.value); } catch { }
        applyTheme(r.value);
      }
    })
  });
  if (prefersDark.addEventListener) {
    prefersDark.addEventListener('change', () => {
      const current = localStorage.getItem(THEME_STORAGE_KEY) || 'system';
      if (current === 'system') applyTheme('system');
    });
  }
}

// Template registry handling
let templateRegistry = [];
let departments = [];
async function loadTemplateRegistry() {
  if (templateRegistry.length) return templateRegistry;
  try {
    const res = await fetch('templates/templates.json');
    templateRegistry = await res.json();
  } catch (e) {
    console.error('Failed to load template registry', e);
  }
  return templateRegistry;
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
    // Set initial PIN if provided via start flow
    if (pendingPinValue) {
      const ref = state.fieldRefs['patient_pin'] || state.fieldRefs['pin'];
      if (ref) {
        try { ref.value = pendingPinValue; } catch { }
      }
      pendingPinValue = null;
    }
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
  renderUI(formContainer, state);
  buildSectionNavigationFromState();
  highlightActiveSection();
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
    highlightActiveSection();
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
  jsonPreview.value = JSON.stringify(data, null, 2);
  openDialog('jsonModal');
});

pdfBtn.addEventListener('click', async () => {
  if (!validateAll(formContainer)) { alert('Validation errors present'); return; }
  const data = collectData();
  latestPdf = {
    docDefinition: await renderPDF(state.meta, state.ast, data),
    filename: `${data.patient_pin || 'patient'}_discharge_summary.pdf`.replace(/[^a-z0-9._-]/gi, '_')
  };
  if (!globalThis.pdfMake) { alert('PDF engine not loaded'); return; }
  openDialog('pdfModal');
});

function downloadFile(filename, content) {
  const a = document.createElement('a');
  a.href = 'data:application/octet-stream,' + encodeURIComponent(content);
  a.download = filename; a.click();
}

// Dialog helpers
function openDialog(id) {
  const dlg = document.getElementById(id);
  if (dlg instanceof HTMLDialogElement && !dlg.open) dlg.showModal();
}

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

settingsBtn?.addEventListener('click', () => openDialog('settingsModal'));

headerNewDischargeBtn?.addEventListener('click', () => {
  startFreshDischarge();
});

let pendingPinValue = null;
let startingFresh = false; // indicates we should ignore previous autosave
let currentDeptId = null;
let templateFilter = '';
let currentStep = 0;
let currentTemplateId = null;

function showStartModal() {
  openDialog('startModal');
  currentStep = 0;
  stepPin.classList.remove('hidden');
  stepTemplate.classList.add('hidden');
  pinInput.value = '';
  pinInput?.focus();
  stepNextBtn.disabled = true;
  stepBackBtn.disabled = true;
}

function startFreshDischarge() {
  startingFresh = true;
  showStartModal();
}

pinInput?.addEventListener('input', () => {
  const val = pinInput.value.trim();
  stepNextBtn.disabled = !val;
});

stepNextBtn?.addEventListener('click', async () => {
  if (stepNextBtn.disabled) return;

  if (currentStep == 0) {
    pendingPinValue = pinInput.value.trim();
    await ensureDepartmentLists();
    stepPin.classList.add('hidden');
    stepTemplate.classList.remove('hidden');
    templateFilterInput?.focus();
    currentStep = 1;
    stepBackBtn.disabled = false;
  } else if (currentStep == 1) {
    loadTemplateById(currentTemplateId).then(() => {
      startingFresh = false; // allow autosave for subsequent edits
      const dlg = document.getElementById('startModal');
      if (dlg instanceof HTMLDialogElement && dlg.open) dlg.close();
      landingScreen?.classList.add('hidden');
    });
  }
});

stepBackBtn?.addEventListener('click', () => {
  stepTemplate.classList.add('hidden');
  stepPin.classList.remove('hidden');
  pinInput?.focus();
  currentStep = 0;
  stepBackBtn.disabled = true;
});

newDischargeBtn?.addEventListener('click', () => { startFreshDischarge(); });

templateFilterInput?.addEventListener('input', () => {
  templateFilter = templateFilterInput.value.trim().toLowerCase();
  renderTemplateList();
});

async function ensureDepartmentLists() {
  await loadTemplateRegistry();
  if (!currentDeptId) {
    // pick first existing department or fallback to uncategorized
    const first = departments.find(d => templateRegistry.some(t => (t.department_id || 'uncategorized') === d.id));
    currentDeptId = first ? first.id : 'uncategorized';
  }
  renderDeptList();

  if (!currentTemplateId) {
    // pick first template in current department if any
    const firstTemplate = templateRegistry.find(t => (t.department_id || 'uncategorized') === currentDeptId);
    if (firstTemplate) currentTemplateId = firstTemplate.id;
  }
  renderTemplateList();
}

function resolveDepartmentName(id) {
  if (id === 'uncategorized' || !id) return 'Uncategorized';
  const d = departments.find(x => x.id === id);
  return d ? d.label : id;
}

function renderDeptList() {
  if (!deptListEl) return;
  const bucketIds = new Set(templateRegistry.map(t => t.department_id || 'uncategorized'));
  const items = [...bucketIds].map(id => ({ id, label: resolveDepartmentName(id) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  deptListEl.innerHTML = '';
  items.forEach(it => {
    const li = document.createElement('li');
    li.textContent = it.label;
    li.setAttribute('data-dept-id', it.id);
    li.addEventListener('click', () => {
      currentDeptId = it.id;
      templateFilter = '';
      if (templateFilterInput) templateFilterInput.value = '';
      updateDeptList();
      renderTemplateList();
    });
    deptListEl.appendChild(li);
  });
  updateDeptList();
}

function updateDeptList() {
  if (!deptListEl) return;
  deptListEl.childNodes.forEach(li => {
    const id = li.getAttribute('data-dept-id');
    li.classList.toggle('active', id === currentDeptId);
  });
}

function renderTemplateList() {
  if (!templateListEl) return;
  const list = templateRegistry
    .filter(t => (t.department_id || 'uncategorized') === currentDeptId)
    .filter(t => !templateFilter || (t.name || t.id).toLowerCase().includes(templateFilter));
  list.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  templateListEl.innerHTML = '';
  list.forEach(t => {
    const li = document.createElement('li');
    li.textContent = t.name || t.id;
    li.setAttribute('data-template-id', t.id);
    if (t.default) {
      const pill = document.createElement('span');
      pill.className = 'template-pill';
      pill.textContent = 'Default';
      li.appendChild(pill);
    }
    li.addEventListener('click', () => {
      currentTemplateId = t.id;
      updateTemplateList();
    });
    templateListEl.appendChild(li);
  });
  if (!list.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No templates';
    empty.style.opacity = '.6';
    templateListEl.appendChild(empty);
  }
  updateTemplateList();
}

function updateTemplateList() {
  if (!templateListEl) return;
  templateListEl.childNodes.forEach(li => {
    const id = li.getAttribute('data-template-id');
    li.classList.toggle('active', id === currentTemplateId);
  });
}

// Autosave
function autosave() {
  const data = collectData();
  try { localStorage.setItem(state.autosaveKey, JSON.stringify(data)); } catch (e) { }
}

function restoreAutosave() {
  if (startingFresh) return; // skip if starting a new discharge
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

function buildSectionNavigationFromState() {
  if (!sectionNavList) return;
  sectionNavList.innerHTML = '';
  if (!Array.isArray(state.sections)) return;
  state.sections.forEach(sec => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '#' + sec.id;
    a.innerHTML = '<span class="dot" aria-hidden="true"></span>' + (sec.title || 'Section');
    a.addEventListener('click', () => {
      closeNav();
      setTimeout(() => highlightActiveSection(), 80);
    });
    li.appendChild(a);
    sectionNavList.appendChild(li);
  });
}

// Active section highlighting based on scroll position
function highlightActiveSection() {
  if (!sectionNavList) return;
  const links = [...sectionNavList.querySelectorAll('a')];
  const mid = window.scrollY + window.innerHeight * 0.25; // focus near top quarter
  let best = null; let bestOffset = -Infinity;
  links.forEach(l => {
    const id = l.getAttribute('href').slice(1);
    const sec = document.getElementById(id);
    if (!sec) return;
    const rect = sec.getBoundingClientRect();
    const topY = window.scrollY + rect.top;
    if (topY <= mid && topY > bestOffset) { best = l; bestOffset = topY; }
  });
  links.forEach(l => l.classList.toggle('active', l === best));
}
window.addEventListener('scroll', () => { highlightActiveSection(); }, { passive: true });

const NAV_WIDE_BREAKPOINT = 1000; // px (sync with CSS media query)

function isWide() {
  return window.innerWidth >= NAV_WIDE_BREAKPOINT;
}

function updateNav() {
  const nav = document.getElementById('sectionNav');
  if (!nav) return;
  if (isWide()) {
    nav.setAttribute('aria-hidden', 'false');
  } else {
    const open = document.documentElement.classList.contains('nav-open');
    nav.setAttribute('aria-hidden', open ? 'false' : 'true');
  }
}

function openNav() {
  if (isWide()) { updateNav(); return; }
  document.documentElement.classList.add('nav-open');
  updateNav();
}

function closeNav() {
  if (isWide()) { updateNav(); return; }
  document.documentElement.classList.remove('nav-open');
  updateNav();
}

function toggleNav() {
  if (isWide()) { return; }
  if (document.documentElement.classList.contains('nav-open')) closeNav(); else openNav();
}

document.addEventListener('click', (e) => {
  const target = e.target;
  if (!target) return;
  if (target.closest('#navMenuBtn')) { toggleNav(); return; }
  if (!isWide()) {
    if (target.closest('#navCloseBtn')) { closeNav(); return; }
    // Click outside nav closes only when drawer is open
    if (document.documentElement.classList.contains('nav-open') && !target.closest('#sectionNav')) {
      closeNav();
    }
  }
});

window.addEventListener('keydown', (e) => {
  if (!isWide() && e.key === 'Escape' && document.documentElement.classList.contains('nav-open')) closeNav();
});

const navSearchInput = document.getElementById('navSearchInput');
navSearchInput?.addEventListener('input', () => {
  const q = navSearchInput.value.trim().toLowerCase();
  const links = sectionNavList?.querySelectorAll('a') || [];
  links.forEach(l => {
    const text = l.textContent.trim().toLowerCase();
    const match = !q || text.includes(q);
    l.parentElement.classList.toggle('hidden', !match);
  });
});

window.addEventListener('resize', () => {
  if (isWide()) {
    document.documentElement.classList.remove('nav-open');
  }
  updateNav();
  document.documentElement.style.scrollPaddingTop = (document.getElementById('header')?.offsetHeight || 0) + 'px';
});


async function init() {
  initTheme();
  departments = await loadDepartments();
  updateNav();
  document.documentElement.style.scrollPaddingTop = (document.getElementById('header')?.offsetHeight || 0) + 'px';
  if (DISABLE_LANDING_UI) {
    try {
      await loadTemplateRegistry();
      // Prefer a template marked as default, else first available
      const chosen = templateRegistry.find(t => t.default) || templateRegistry[0];
      if (chosen) {
        await loadTemplateById(chosen.id);
        landingScreen?.classList.add('hidden');
      } else {
        console.warn('No templates available to auto-load');
      }
    } catch (e) {
      console.warn('Failed to auto-load template while landing UI disabled', e);
    }
  }
}

init();