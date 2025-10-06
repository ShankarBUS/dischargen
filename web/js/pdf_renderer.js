import { evaluateCondition } from "./conditional.js";
import { parseMarkdown } from "./md_parser.js";
import { getKnownChronicDiseases } from "./defaults.js";
import { getDepartmentById } from "./search_handler.js";

let fontsLoaded = false;
async function ensurePdfMakeFonts() {
    if (fontsLoaded) return;
    if (!globalThis.pdfMake) {
        console.error(
            "pdfMake not found on global scope. Ensure pdfmake is loaded before app modules."
        );
        return;
    }
    const abs = (p) => new URL(p, document.baseURI).href;
    globalThis.pdfMake.fonts = {
        ...(globalThis.pdfMake.fonts || {}),
        Poppins: {
            normal: abs("./fonts/Poppins-Regular.ttf"),
            bold: abs("./fonts/Poppins-Bold.ttf"),
            italics: abs("./fonts/Poppins-Italic.ttf"),
            bolditalics: abs("./fonts/Poppins-BoldItalic.ttf"),
        },
        "Noto Sans Tamil": {
            normal: abs("./fonts/NotoSansTamil-Regular.ttf"),
            bold: abs("./fonts/NotoSansTamil-Bold.ttf"),
            italics: abs("./fonts/NotoSansTamil-Regular.ttf"),
            bolditalics: abs("./fonts/NotoSansTamil-Bold.ttf"),
        },
    };
    fontsLoaded = true;
}

function createPdfContext(meta, ast, values) {
    return {
        meta,
        ast,
        values,
        getValue: (id) => values[id],
    };
}

function nodeVisible(node, ctx) {
    if (!node) return false;
    if (node.pdf && node.pdf.hidden) return false;
    if (node.if && !safeEvalCondition(node.if, ctx.getValue)) return false;
    return true;
}

async function buildHeader(meta) {
    const blocks = [];
    const headerColumns = [];
    if (meta.logo) {
        try {
            const dataUrl = await loadImageAsDataUrl(meta.logo);
            headerColumns.push({
                image: dataUrl,
                width: 80,
                alignment: "left",
                margin: [0, 0, 0, 8],
            });
        } catch (e) {
            console.warn("Logo load failed", e);
        }
    }
    const headerTextColumn = [];
    const addHeaderLine = (line) => {
        if (line)
            headerTextColumn.push({
                text: toRunsWithFonts(line),
                width: "*",
                style: "headerLine",
                alignment: "center",
                margin: [0, 0, 0, 2],
            });
    };
    ["hospital", "department", "unit", "pdf_header"].forEach((k) => {
        if (!meta[k]) return;
        if (k === "department") {
            const dept = getDepartmentById(meta.department);
            addHeaderLine(
                dept ? "Department of " + dept.label : meta.department
            );
        } else addHeaderLine(meta[k]);
    });
    if (headerColumns.length || headerTextColumn.length)
        blocks.push({
            columns: [...headerColumns, headerTextColumn],
            columnGap: 10,
        });
    blocks.push({
        text: toRunsWithFonts(meta.title || ""),
        style: "title",
        alignment: "center",
        margin: [0, 10, 0, 18],
    });
    return blocks;
}

function renderFieldNode(node, ctx) {
    if (!nodeVisible(node, ctx) || node.type !== "field") return [];
    const getValue = ctx.getValue;
    if (node.fieldType === "static") {
        const md = String(node.content || "").trim();
        if (!md) return [];
        return markdownAstToPdfBlocks(parseMarkdown(md));
    }
    if (node.fieldType === "table") {
        const tableVal = getValue(node.id) || [];
        const { headers, rows } = buildTableRows(node, tableVal);
        if (!headers.length || !rows.length) return [];
        const bodyRows = rows.map((r) =>
            r.map((c) => ({ text: toRunsWithFonts(c) }))
        );
        const arr = [];
        if (node.label)
            arr.push({
                text: toRunsWithFonts(node.label),
                style: "sectionLabel",
                margin: [0, 6, 0, 4],
            });
        arr.push({
            table: {
                headerRows: 1,
                widths: headers.map(() => "*"),
                body: [
                    headers.map((h) => ({
                        text: toRunsWithFonts(h),
                        bold: true,
                    })),
                    ...bodyRows,
                ],
            },
            layout: "lightHorizontalLines",
            fontSize: 10,
            margin: [0, 0, 0, 8],
        });
        return arr;
    }
    if (node.fieldType === "text" && node.multiline) {
        const val = String(getValue(node.id) || "").trim();
        if (!val) return [];
        const arr = [];
        if (node.label)
            arr.push({
                text: toRunsWithFonts(node.label + ":"),
                style: "sectionLabel",
                margin: [0, 6, 0, 2],
            });
        arr.push(...markdownAstToPdfBlocks(parseMarkdown(val)));
        return arr;
    }
    if (node.fieldType === "complaints") {
        const raw = getValue(node.id);
        const list = Array.isArray(raw) ? raw : [];
        const items = list
            .map((o) => {
                if (!o || !o.complaint) return null;
                const dur = o.duration
                    ? `× ${o.duration}${o.unit ? " " + o.unit : ""}`
                    : "";
                return `${o.complaint}${dur ? " " + dur : ""}`.trim();
            })
            .filter(Boolean);
        if (!items.length) return [];
        const blocks = [];
        if (node.label)
            blocks.push({
                text: toRunsWithFonts(node.label + ":"),
                style: "sectionLabel",
                margin: [0, 6, 0, 2],
            });
        blocks.push({
            ul: items.map((t) => ({ text: toRunsWithFonts(t) })),
            margin: [0, 0, 0, 4],
        });
        return blocks;
    }
    if (node.fieldType === "chronicdiseases") {
        const val = getValue(node.id);
        const arr = Array.isArray(val) ? val.filter((o) => o && o.disease) : [];
        if (!arr.length) return [];
        const known = getKnownChronicDiseases();
        const items = arr.map((o) => {
            const dur = o.duration
                ? `× ${o.duration} ${o.unit || ""}`.replace(/\s+/g, " ").trim()
                : "";
            const trx = o.treatment ? `- ${o.treatment}` : "";
            return `K/C/O ${o.disease} ${dur} ${trx}`
                .replace(/\s+/g, " ")
                .trim();
        });
        if (
            node.shownegatives &&
            node.shownegatives !== false &&
            known.length
        ) {
            const presentLower = new Set(
                arr.map((o) => o.disease.toLowerCase())
            );
            const negatives = known.filter(
                (k) => !presentLower.has(k.toLowerCase())
            );
            if (negatives.length) items.push(`N/K/C/O ${negatives.join("/")}`);
        }
        return [
            {
                ul: items.map((t) => ({ text: toRunsWithFonts(t) })),
                margin: [0, 0, 0, 4],
            },
        ];
    }
    if (node.fieldType === "pastevents") {
        const val = getValue(node.id);
        const arr = Array.isArray(val) ? val : [];
        if (!arr.length) return [];
        const items = arr
            .map((o) => {
                if (!o || !o.event) return null;
                const det = o.details ? `- ${o.details}` : "";
                return `H/O ${o.event} ${det}`.trim();
            })
            .filter(Boolean);
        if (!items.length) return [];
        return [
            {
                ul: items.map((t) => ({ text: toRunsWithFonts(t) })),
                margin: [0, 0, 0, 4],
            },
        ];
    }
    if (node.fieldType === "medications") {
        const raw = getValue(node.id);
        const list = Array.isArray(raw) ? raw : [];
        const items = list
            .map((o) => {
                if (!o || !o.name) return null;
                const dose = o.dosage
                    ? ` ${o.dosage.value}${o.dosage.unit ? " " + o.dosage.unit : ""}`
                    : "";
                const route = o.route ? ` ${o.route}` : "";
                const freq = o.frequency ? ` ${o.frequency}` : "";
                const dur = o.duration
                    ? ` × ${o.duration.value}${o.duration.unit ? " " + o.duration.unit : ""}`
                    : "";
                return `${o.name}${dose}${route}${freq}${dur}`.trim();
            })
            .filter(Boolean);
        if (!items.length) return [];
        const blocks = [];
        if (node.label)
            blocks.push({
                text: toRunsWithFonts(node.label + ":"),
                style: "sectionLabel",
                margin: [0, 6, 0, 2],
            });
        blocks.push({
            ul: items.map((t) => ({ text: toRunsWithFonts(t) })),
            margin: [0, 0, 0, 4],
        });
        return blocks;
    }
    const line = buildFieldLine(node, getValue(node.id));
    if (!line) return [];
    return [{ text: toRunsWithFonts(line), margin: [0, 0, 0, 4] }];
}

async function renderGroupNode(node, ctx) {
    if (!nodeVisible(node, ctx)) return [];
    const layout = String(node.layout || "vstack").toLowerCase();
    const children = node.children || [];
    const childBlocks = [];
    for (const ch of children) {
        if (!ch) continue;
        if (ch.type === "group") {
            const nested = await renderGroupNode(ch, ctx);
            if (nested.length) childBlocks.push(nested);
            continue;
        }
        if (ch.type === "field") {
            const frags = renderFieldNode(ch, ctx);
            if (frags.length) childBlocks.push(frags);
        }
    }
    const out = [];
    const titleNode = node.title
        ? {
            text: toRunsWithFonts(node.title),
            style: "sectionLabel",
            margin: [0, 6, 0, 4],
        }
        : null;
    const normalizeFirst = (arr) => {
        if (!arr.length) return arr;
        const f = arr[0];
        if (f.margin)
            arr[0] = {
                ...f,
                margin: [
                    f.margin[0] || 0,
                    0,
                    f.margin[2] || 0,
                    f.margin[3] || 0,
                ],
            };
        return arr;
    };
    if (layout === "hstack") {
        const cols = childBlocks.map((cb) => ({
            stack: normalizeFirst(cb.slice()),
            width: "auto",
        }));
        if (titleNode) out.push(titleNode);
        out.push({ columns: cols, columnGap: 10, margin: [0, 0, 0, 6] });
    } else if (layout === "vstack") {
        if (titleNode) out.push(titleNode);
        childBlocks.forEach((cb) => cb.forEach((n) => out.push(n)));
    } else if (/^columns-(\d+)$/.test(layout)) {
        const n = Math.max(1, parseInt(layout.split("-")[1], 10) || 1);
        const buckets = Array.from({ length: n }, () => []);
        childBlocks.forEach((cb, i) => buckets[i % n].push(...cb));
        const cols = buckets.map((b) => ({
            stack: normalizeFirst(b),
            width: "*",
        }));
        if (titleNode) out.push(titleNode);
        out.push({ columns: cols, columnGap: 10, margin: [0, 0, 0, 6] });
    } else {
        if (titleNode) out.push(titleNode);
        childBlocks.forEach((cb) => cb.forEach((n) => out.push(n)));
    }
    return out;
}

async function renderSectionNode(section, ctx) {
    if (!nodeVisible(section, ctx)) return [];
    if (section.optional === true) {
        const optMap = ctx.values && ctx.values._sectionOptionals;
        if (optMap && section.id && optMap[section.id] === false) return []; // unchecked
    }
    const nodes = [];
    if (section.title)
        nodes.push({
            text: toRunsWithFonts(section.title),
            style: "sectionTitle",
            margin: [0, 8, 0, 6],
        });
    for (const ch of section.children || []) {
        if (!ch) continue;
        if (ch.type === "group") {
            (await renderGroupNode(ch, ctx)).forEach((n) => nodes.push(n));
            continue;
        }
        if (ch.type === "field")
            renderFieldNode(ch, ctx).forEach((n) => nodes.push(n));
    }
    return nodes;
}

/**
 * Build pdfmake document definition from template AST + values.
 * @param {Object} meta
 * @param {Array} ast
 * @param {Object} values
 */
export async function renderPDF(meta = {}, ast = [], values = {}) {
    await ensurePdfMakeFonts();
    const ctx = createPdfContext(meta, ast, values);
    const content = [];
    content.push(...(await buildHeader(meta)));
    for (const node of ast) {
        if (!node) continue;
        if (node.type === "section")
            content.push(...(await renderSectionNode(node, ctx)));
        else if (node.type === "group")
            content.push(...(await renderGroupNode(node, ctx)));
        else if (node.type === "field")
            content.push(...renderFieldNode(node, ctx));
    }
    const dateStr = new Date().toLocaleString("en-IN", { dateStyle: "short" });
    return {
        pageSize: "A4",
        pageMargins: [40, 40, 40, 40],
        content,
        defaultStyle: { font: "Poppins", fontSize: 10 },
        styles: {
            headerLine: { fontSize: 14, bold: true },
            title: { fontSize: 14 },
            sectionTitle: { fontSize: 12, bold: true },
            sectionLabel: { fontSize: 10, bold: true },
        },
        footer: (currentPage, pageCount) => ({
            columns: [
                {
                    text: meta.pdf_footer
                        ? toRunsWithFonts(meta.pdf_footer)
                        : "",
                    alignment: "left",
                    fontSize: 9,
                    margin: [40, 0, 0, 0],
                },
                {
                    text: toRunsWithFonts(
                        `Generated ${dateStr} | Page ${currentPage} of ${pageCount}`
                    ),
                    alignment: "right",
                    fontSize: 9,
                    margin: [0, 0, 40, 0],
                },
            ],
        }),
        background: (currentPage, pageSize) => ({
            canvas: [
                {
                    type: "rect",
                    x: 20,
                    y: 20,
                    w: pageSize.width - 40,
                    h: pageSize.height - 40,
                    r: 10,
                    lineColor: "black",
                },
            ],
        }),
    };
}

function buildTableRows(node, tableVal) {
    const headers = node.columns;
    const rows = Array.isArray(tableVal) ? tableVal : [];
    const body = rows
        .map((r) => headers.map((h) => str(r[h])))
        .filter((r) => r.some((c) => c && c.trim() !== ""));
    return { headers, rows: body };
}

function buildFieldLine(node, val) {
    if (node.fieldType === "hidden") return null; // skip hidden in PDF
    const label = node.label ? `${node.label}: ` : "";
    let text = "";
    switch (node.fieldType) {
        case "diagnosis": {
            const arr = Array.isArray(val) ? val : [];
            text = arr
                .map(
                    (o) =>
                        (o && (o.description || o.label || o.name)) +
                        (o && o.code ? ` (${o.code})` : "")
                )
                .filter(Boolean)
                .join("; ");
            break;
        }
        case "list": {
            const arr = Array.isArray(val) ? val : [];
            text = arr.join("; ");
            break;
        }
        case "checkbox": {
            if (typeof val === "boolean")
                text = val ? node.truevalue || "(+)" : node.falsevalue || "(-)";
            break;
        }
        case "computed": {
            if (val !== undefined && val !== null && val !== 0 && val !== "0")
                text = str(val);
            break;
        }
        case "date": {
            if (typeof val === "string" && val) {
                const dt = new Date(val);
                if (!isNaN(dt.getTime()))
                    text = dt.toLocaleDateString("en-IN", {
                        dateStyle: "short",
                    });
                break;
            }
        }
        default: {
            text = str(val);
        }
    }

    text = (text || "").trim();
    if (!text) return null;
    return label + text;
}

function str(v) {
    if (v === undefined || v === null) return "";
    return String(v);
}

function safeEvalCondition(expr, getValue) {
    try {
        return evaluateCondition(expr, getValue);
    } catch {
        return false;
    }
}

async function loadImageAsDataUrl(url) {
    const res = await fetch("assets/" + url, { mode: "cors" });
    if (!res.ok) throw new Error("Image load failed: " + url);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// Detect Tamil graphemes
function containsTamil(text) {
    if (!text) return false;
    const regex = /[\u0B80-\u0BFF]/;
    return regex.test(text);
}

// Build pdfmake text runs with per-grapheme font switching (Tamil only)
function toRunsWithFonts(text, opts = {}) {
    const clusters = segmentGraphemes(String(text));
    const runs = [];
    let currentFont = null;
    let buf = "";
    const flush = () => {
        if (!buf) return;
        const node = { text: buf };
        if (opts.bold) node.bold = true;
        if (opts.italic || opts.italics) node.italics = true;
        if (currentFont) node.font = currentFont;
        runs.push(node);
        buf = "";
    };
    for (const g of clusters) {
        const font = containsTamil(g) ? "Noto Sans Tamil" : "Poppins";
        if (currentFont === font) buf += g;
        else {
            flush();
            currentFont = font;
            buf = g;
        }
    }
    flush();
    return runs;
}

function segmentGraphemes(str) {
    try {
        if (typeof Intl !== "undefined" && Intl.Segmenter) {
            const seg = new Intl.Segmenter(undefined, {
                granularity: "grapheme",
            });
            return Array.from(seg.segment(str), (s) => s.segment);
        }
    } catch { }
    // Fallback: code points (not perfect for all scripts but acceptable fallback)
    return Array.from(str);
}

// Convert Markdown AST (from md_parser) into pdfmake blocks
function markdownAstToPdfBlocks(astBlocks) {
    const out = [];

    for (const b of astBlocks) {
        if (b.type === "paragraph") {
            const runs = b.runs.map((r) =>
                toRunsWithFonts(r.text, { bold: r.bold, italics: r.italic })
            );
            out.push({ text: runs.flat(), margin: [0, 0, 0, 4] });
        } else if (b.type === "list") {
            const listKey = b.ordered ? "ol" : "ul";
            const items = b.items.map((it) => listItemToPdf(it));
            const node = { [listKey]: items, margin: [0, 0, 0, 6] };
            out.push(node);
        }
    }

    return out;

    function listItemToPdf(item) {
        // If only one paragraph, collapse to text; else stack
        if (item.blocks.length === 1 && item.blocks[0].type === "paragraph") {
            return {
                text: item.blocks[0].runs
                    .map((r) =>
                        toRunsWithFonts(r.text, {
                            bold: r.bold,
                            italics: r.italic,
                        })
                    )
                    .flat(),
            };
        }

        const stack = [];
        for (const b of item.blocks) {
            if (b.type === "paragraph")
                stack.push({
                    text: b.runs
                        .map((r) =>
                            toRunsWithFonts(r.text, {
                                bold: r.bold,
                                italics: r.italic,
                            })
                        )
                        .flat(),
                    margin: [0, 0, 0, 2],
                });
            else if (b.type === "list") {
                const key = b.ordered ? "ol" : "ul";
                stack.push({ [key]: b.items.map((it2) => listItemToPdf(it2)) });
            }
        }
        return { stack };
    }
}
