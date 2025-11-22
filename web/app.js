import { parseMCTMResolved } from "./js/mctm/mctm_parser.js";
import { lintMCTM } from "./js/mctm/mctm_linter.js";
import { validateAll } from "./js/validation.js";
import { renderUI, reevaluateConditions, evaluateComputedAll, getFieldValueFromRef } from "./js/ui_renderer.js";
import { renderPDF } from "./js/pdf_renderer.js";
import { loadDepartments } from "./js/search_handler.js";
import { state, resetStateForTemplate } from "./js/core/state.js";
import { initTheme } from "./js/services/theme.js";

// #region DOM References

const sectionNavList = document.getElementById("sectionNavList");

const formContainer = document.getElementById("formContainer");

const newDischargeBtn = document.getElementById("newDischargeBtn");
const jsonBtn = document.getElementById("jsonBtn");
const pdfBtn = document.getElementById("pdfBtn");

const settingsBtn = document.getElementById("settingsBtn");
const ghRepoBtn = document.getElementById("ghRepoBtn");
const ghProfileBtn = document.getElementById("ghProfileBtn");

const landingScreen = document.getElementById("landing");
const getStartedBtn = document.getElementById("getStartedBtn");
const landingSkipBtn = document.getElementById("landingSkipBtn");

const pinInput = document.getElementById("pinInput");
const stepPin = document.getElementById("stepPin");
const stepTemplate = document.getElementById("stepTemplate");
const templateFilterInput = document.getElementById("templateFilterInput");
const stepBackBtn = document.getElementById("stepBackButton");
const stepNextBtn = document.getElementById("stepNextButton");
const deptListEl = document.getElementById("deptList");
const templateListEl = document.getElementById("templateList");

const jsonPreview = document.getElementById("jsonPreview");
const copyJsonBtn = document.getElementById("copyJsonBtn");
const downloadJsonBtn = document.getElementById("downloadJsonBtn");

const pdfPreviewBtn = document.getElementById("pdfPreviewBtn");
const pdfPrintBtn = document.getElementById("pdfPrintBtn");
const pdfDownloadBtn = document.getElementById("pdfDownloadBtn");

// #endregion

// #region Template Registry & Loading

let templateRegistry = [];
let departments = [];

async function loadTemplateRegistry() {
    if (templateRegistry.length) return templateRegistry;
    try {
        const res = await fetch("templates/templates.json");
        templateRegistry = await res.json();
    } catch (e) {
        console.error("Failed to load template registry", e);
    }
    return templateRegistry;
}

async function loadTemplateById(id) {
    const entry = templateRegistry.find((t) => t.id === id);
    if (!entry) return;
    try {
        const path = `templates/${entry.file}`;
        const res = await fetch(path);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const txt = await res.text();
        await loadTemplateText(txt);
        applyPendingPin();
    } catch (e) {
        console.error("Failed to load template", id, e);
    }
}

function applyPendingPin() {
    if (!pendingPinValue) return;
    const ref = state.fieldRefs["patient_pin"] || state.fieldRefs["pin"];
    if (ref) {
        try {
            ref.value = pendingPinValue;
        } catch { }
    }
    pendingPinValue = null;
}

async function loadTemplateText(text) {
    formContainer.innerHTML = "";
    resetStateForTemplate();
    const parsed = await parseMCTMResolved(text, {
        onError: (msg) => console.warn("[include]", msg),
    });
    state.meta = parsed.meta || {};
    state.ast = parsed.ast || [];
    lintAndReport(text);
    renderUI(formContainer, state);
    buildSectionNavigationFromState();
    highlightActiveSection();
    restoreAutosave();
    reevaluateConditions(formContainer, state);
    evaluateComputedAll(state);
}

function lintAndReport(sourceText) {
    try {
        const diagnostics = lintMCTM({
            source: sourceText,
            ast: state.ast,
            meta: state.meta,
        });
        state.diagnostics = diagnostics;
        if (!diagnostics.length) return;
        console.groupCollapsed("MCTM Lint Diagnostics");
        diagnostics.forEach((d) => {
            const tag = d.level === "error" ? "error" : "warn";
            console[tag](`[${d.level.toUpperCase()}] line ${d.line}: ${d.message}`);
        });
        console.groupEnd();
    } catch (e) {
        console.error("Lint failed", e);
    }
}

// #endregion

// #region Form Handling

formContainer.addEventListener("input", (e) => {
    if (!e.target || !e.target.id) return;
    reevaluateConditions(formContainer, state);
    evaluateComputedAll(state);
    autosave();
});

function collectData() {
    const data = {};
    Object.entries(state.fieldRefs).forEach(([id, ref]) => {
        data[id] = getFieldValueFromRef(ref);
    });
    if (state.sectionOptionals) {
        const opt = {};
        Object.entries(state.sectionOptionals).forEach(([secId, cb]) => {
            opt[secId] = !!(cb && cb.checked);
        });
        data._sectionOptionals = opt;
    }
    if (state.meta) data._meta = state.meta;
    return data;
}

// #endregion

// #region Export

jsonBtn.addEventListener("click", () => {
    if (!validateAll(formContainer)) return alert("Validation errors present");
    jsonPreview.value = JSON.stringify(collectData(), null, 2);
    openDialog("jsonModal");
});

pdfBtn.addEventListener("click", async () => {
    if (!validateAll(formContainer)) return alert("Validation errors present");
    const data = collectData();
    latestPdf = {
        docDefinition: await renderPDF(state.meta, state.ast, data),
        filename: `${data.patient_pin || "patient"}_discharge_summary.pdf`.replace(
            /[^a-z0-9._-]/gi,
            "_"
        ),
    };
    if (!globalThis.pdfMake) return alert("PDF engine not loaded");
    openDialog("pdfModal");
});

function downloadFile(filename, content) {
    const a = document.createElement("a");
    a.href = "data:application/octet-stream," + encodeURIComponent(content);
    a.download = filename;
    a.click();
}

copyJsonBtn?.addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText(jsonPreview.value);
        alert("Copied to clipboard");
    } catch { }
});

downloadJsonBtn?.addEventListener("click", () => {
    downloadFile("discharge.json", jsonPreview.value || "{}");
});

let latestPdf = null;

pdfPreviewBtn?.addEventListener("click", () => {
    if (!latestPdf || !globalThis.pdfMake) return;
    globalThis.pdfMake.createPdf(latestPdf.docDefinition).open();
});

pdfPrintBtn?.addEventListener("click", () => {
    if (!latestPdf || !globalThis.pdfMake) return;
    globalThis.pdfMake.createPdf(latestPdf.docDefinition).print();
});

pdfDownloadBtn?.addEventListener("click", () => {
    if (!latestPdf || !globalThis.pdfMake) return;
    globalThis.pdfMake
        .createPdf(latestPdf.docDefinition)
        .download(latestPdf.filename);
});

// #endregion

// #region Modals

function openDialog(id) {
    const dlg = document.getElementById(id);
    if (dlg instanceof HTMLDialogElement && !dlg.open) dlg.showModal();
}

settingsBtn?.addEventListener("click", () => openDialog("settingsModal"));

newDischargeBtn?.addEventListener("click", startFreshDischarge);

let pendingPinValue = null;
let startingFresh = false; // indicates we should ignore previous autosave
let currentDeptId = null;
let templateFilter = "";
let currentStep = 0;
let currentTemplateId = null;

function showStartModal() {
    openDialog("startModal");
    currentStep = 0;
    stepPin.classList.remove("hidden");
    stepTemplate.classList.add("hidden");
    pinInput.value = "";
    pinInput?.focus();
    stepNextBtn.disabled = true;
    stepBackBtn.disabled = true;
}

function startFreshDischarge() {
    startingFresh = true;
    showStartModal();
}

pinInput?.addEventListener("input", () => {
    const val = pinInput.value.trim();
    stepNextBtn.disabled = !val;
});

pinInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !stepNextBtn.disabled) stepNextBtn.click();
});

stepNextBtn?.addEventListener("click", async () => {
    if (stepNextBtn.disabled) return;
    if (currentStep === 0) return await advanceFromPin();
    if (currentStep === 1) return confirmTemplateSelection();
});

async function advanceFromPin() {
    pendingPinValue = pinInput.value.trim();
    await ensureDepartmentLists();
    stepPin.classList.add("hidden");
    stepTemplate.classList.remove("hidden");
    templateFilterInput?.focus();
    currentStep = 1;
    stepBackBtn.disabled = false;
}

function confirmTemplateSelection() {
    loadTemplateById(currentTemplateId).then(() => {
        startingFresh = false; // allow autosave for subsequent edits
        const dlg = document.getElementById("startModal");
        if (dlg instanceof HTMLDialogElement && dlg.open) dlg.close();
    });
}

stepBackBtn?.addEventListener("click", () => {
    stepTemplate.classList.add("hidden");
    stepPin.classList.remove("hidden");
    pinInput?.focus();
    currentStep = 0;
    stepBackBtn.disabled = true;
});

templateFilterInput?.addEventListener("input", () => {
    templateFilter = templateFilterInput.value.trim().toLowerCase();
    renderTemplateList();
});

async function ensureDepartmentLists() {
    await loadTemplateRegistry();
    if (!currentDeptId) {
        const first = departments.find((d) =>
            templateRegistry.some(
                (t) => (t.department_id || "uncategorized") === d.id
            )
        );
        currentDeptId = first ? first.id : "uncategorized";
    }
    renderDeptList();
    if (!currentTemplateId) {
        const firstTemplate = templateRegistry.find(
            (t) => (t.department_id || "uncategorized") === currentDeptId
        );
        if (firstTemplate) currentTemplateId = firstTemplate.id;
    }
    renderTemplateList();
}

function resolveDepartmentName(id) {
    if (id === "uncategorized" || !id) return "Uncategorized";
    const d = departments.find((x) => x.id === id);
    return d ? d.label : id;
}

function renderDeptList() {
    if (!deptListEl) return;
    const bucketIds = new Set(
        templateRegistry.map((t) => t.department_id || "uncategorized")
    );
    const items = [...bucketIds]
        .map((id) => ({ id, label: resolveDepartmentName(id) }))
        .sort((a, b) => a.label.localeCompare(b.label));
    deptListEl.innerHTML = "";
    items.forEach((it) => {
        const li = document.createElement("li");
        li.textContent = it.label;
        li.setAttribute("data-dept-id", it.id);
        li.addEventListener("click", () => {
            currentDeptId = it.id;
            templateFilter = "";
            if (templateFilterInput) templateFilterInput.value = "";
            updateDeptList();
            renderTemplateList();
        });
        deptListEl.appendChild(li);
    });
    updateDeptList();
}

function updateDeptList() {
    if (!deptListEl) return;
    deptListEl.childNodes.forEach((li) => {
        const id = li.getAttribute("data-dept-id");
        li.classList.toggle("active", id === currentDeptId);
    });
}

function renderTemplateList() {
    if (!templateListEl) return;
    const list = templateRegistry
        .filter((t) => (t.department_id || "uncategorized") === currentDeptId)
        .filter(
            (t) =>
                !templateFilter ||
                (t.name || t.id).toLowerCase().includes(templateFilter)
        );
    list.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
    templateListEl.innerHTML = "";
    list.forEach((t) => {
        const li = document.createElement("li");
        li.textContent = t.name || t.id;
        li.setAttribute("data-template-id", t.id);
        if (t.default) {
            const pill = document.createElement("span");
            pill.className = "template-pill";
            pill.textContent = "Default";
            li.appendChild(pill);
        }
        li.addEventListener("click", () => {
            currentTemplateId = t.id;
            updateTemplateList();
        });
        templateListEl.appendChild(li);
    });
    if (!list.length) {
        const empty = document.createElement("li");
        empty.textContent = "No templates";
        empty.style.opacity = ".6";
        templateListEl.appendChild(empty);
    }
    updateTemplateList();
}

function updateTemplateList() {
    if (!templateListEl) return;
    templateListEl.childNodes.forEach((li) => {
        const id = li.getAttribute("data-template-id");
        li.classList.toggle("active", id === currentTemplateId);
    });
}

// #region Autosave

function autosave() {
    try {
        localStorage.setItem(state.autosaveKey, JSON.stringify(collectData()));
    } catch { }
}

function restoreAutosave() {
    if (startingFresh) return;
    try {
        const raw = localStorage.getItem(state.autosaveKey);
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data._sectionOptionals && state.sectionOptionals) {
            Object.entries(data._sectionOptionals).forEach(([secId, val]) => {
                const cb = state.sectionOptionals[secId];
                if (!cb) return;
                cb.checked = !!val;
                cb.dispatchEvent(new Event("change"));
            });
        }
        Object.entries(data).forEach(([id, val]) => {
            const ref = state.fieldRefs[id];
            if (!ref) return;
            if (ref instanceof HTMLElement) {
                if (ref.type === "checkbox") {
                    // Ensure any visibility sync tied to checkbox change is applied
                    ref.checked = !!val;
                    ref.dispatchEvent(new Event("change"));
                } else {
                    ref.value = val;
                }
            } else if (ref && "value" in ref) {
                try {
                    ref.value = val;
                } catch { }
            }
        });
        reevaluateConditions(formContainer, state);
    } catch { }
}

// #endregion

// #region Section navigation

function buildSectionNavigationFromState() {
    if (!sectionNavList) return;
    sectionNavList.innerHTML = "";
    if (!Array.isArray(state.sections)) return;
    state.sections.forEach((sec) => {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = "#" + sec.id;
        a.innerHTML = '<span class="dot" aria-hidden="true"></span>' + (sec.title || "Section");
        a.addEventListener("click", () => {
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
    const links = [...sectionNavList.querySelectorAll("a")];
    const mid = window.scrollY + window.innerHeight * 0.25;
    let best = null;
    let bestOffset = -Infinity;
    links.forEach((l) => {
        const id = l.getAttribute("href").slice(1);
        const sec = document.getElementById(id);
        if (!sec) return;
        const rect = sec.getBoundingClientRect();
        const topY = window.scrollY + rect.top;
        if (topY <= mid && topY > bestOffset) {
            best = l;
            bestOffset = topY;
        }
    });
    links.forEach((l) => l.classList.toggle("active", l === best));
}

window.addEventListener("scroll", () => {
    highlightActiveSection();
}, { passive: true });

const NAV_WIDE_BREAKPOINT = 1000; // px

function isWide() {
    return window.innerWidth >= NAV_WIDE_BREAKPOINT;
}

function updateNav() {
    const nav = document.getElementById("sectionNav");
    if (!nav) return;
    if (isWide()) nav.setAttribute("aria-hidden", "false");
    else
        nav.setAttribute(
            "aria-hidden",
            document.documentElement.classList.contains("nav-open") ? "false" : "true"
        );
}

function openNav() {
    if (!isWide()) document.documentElement.classList.add("nav-open");
    updateNav();
}

function closeNav() {
    if (!isWide()) document.documentElement.classList.remove("nav-open");
    updateNav();
}

function toggleNav() {
    if (isWide()) return;
    document.documentElement.classList.contains("nav-open")
        ? closeNav()
        : openNav();
}

document.addEventListener("click", (e) => {
    const target = e.target;
    if (!target) return;
    if (target.closest("#navMenuBtn")) return toggleNav();
    if (!isWide()) {
        if (target.closest("#navCloseBtn")) return closeNav();
        if (
            document.documentElement.classList.contains("nav-open") &&
            !target.closest("#sectionNav")
        )
            closeNav();
    }
});

window.addEventListener("keydown", (e) => {
    if (
        !isWide() &&
        e.key === "Escape" &&
        document.documentElement.classList.contains("nav-open")
    )
        closeNav();
});

const navSearchInput = document.getElementById("navSearchInput");
navSearchInput?.addEventListener("input", () => {
    const q = navSearchInput.value.trim().toLowerCase();
    const links = sectionNavList?.querySelectorAll("a") || [];
    links.forEach((l) => {
        const text = l.textContent.trim().toLowerCase();
        const match = !q || text.includes(q);
        l.parentElement.classList.toggle("hidden", !match);
    });
});

window.addEventListener("resize", () => {
    if (isWide()) document.documentElement.classList.remove("nav-open");
    updateNav();
    document.documentElement.style.scrollPaddingTop =
        (document.getElementById("header")?.offsetHeight || 0) + "px";
});

// #endregion

// #region Landing Screen

const FIRST_RUN_KEY = "dischargen_first_run";

function completeLanding() {
    try { localStorage.setItem(FIRST_RUN_KEY, "false"); } catch { }
    landingScreen?.classList.add("hidden");
}

getStartedBtn?.addEventListener("click", () => {
    startFreshDischarge();
    completeLanding();
});

landingSkipBtn?.addEventListener("click", () => {
    completeLanding();
});

// #endregion

ghRepoBtn?.addEventListener("click", () => {
    window.open("https://github.com/ShankarBUS/dischargen", "_blank");
});

ghProfileBtn?.addEventListener("click", () => {
    window.open("https://github.com/ShankarBUS", "_blank");
});

const LOAD_DEFAULT_TEMPLATE = true;

async function init() {
    initTheme();
    departments = await loadDepartments();
    updateNav();
    document.documentElement.style.scrollPaddingTop =
        (document.getElementById("header")?.offsetHeight || 0) + "px";

    if (localStorage.getItem(FIRST_RUN_KEY) !== "false") { landingScreen?.classList.remove("hidden"); }
    if (LOAD_DEFAULT_TEMPLATE)
        try {
            await loadTemplateRegistry();
            const chosen =
                templateRegistry.find((t) => t.default) || templateRegistry[0];
            if (!chosen) return console.warn("No templates available to auto-load");
            await loadTemplateById(chosen.id);
            landingScreen?.classList.add("hidden");
        } catch (e) {
            console.warn("Failed to auto-load template while landing UI disabled", e);
        }
}

init();
