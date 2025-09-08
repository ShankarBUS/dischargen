import { evaluateCondition } from './conditional.js';

let fontsLoaded = false;

async function ensurePdfMakeFonts() {
  if (fontsLoaded) return;
  if (!globalThis.pdfMake) { console.error('pdfMake not found on global scope. Ensure pdfmake is loaded before app modules.'); return; }
  const abs = (p) => new URL(p, document.baseURI).href;
  // Map fonts via URL as per pdfmake docs
  globalThis.pdfMake.fonts = {
    ...(globalThis.pdfMake.fonts || {}),
    // Poppins local files
    Poppins: {
      normal: abs('./fonts/Poppins-Regular.ttf'),
      bold: abs('./fonts/Poppins-Bold.ttf'),
      italics: abs('./fonts/Poppins-Italic.ttf'),
      bolditalics: abs('./fonts/Poppins-BoldItalic.ttf')
    },
    // Noto Sans Tamil (italic falls back to normal files)
    'Noto Sans Tamil': {
      normal: abs('./fonts/NotoSansTamil-Regular.ttf'),
      bold: abs('./fonts/NotoSansTamil-Bold.ttf'),
      italics: abs('./fonts/NotoSansTamil-Regular.ttf'),
      bolditalics: abs('./fonts/NotoSansTamil-Bold.ttf')
    },
  };

  fontsLoaded = true;
}

export async function renderPDF(meta = {}, ast = [], values = {}) {

  await ensurePdfMakeFonts();

  const content = [];

  // Header (logo + header text)
  const headerColumns = [];

  if (meta.logo) {
    try {
      const dataUrl = await loadImageAsDataUrl(meta.logo);
      headerColumns.push({ image: dataUrl, width: 80, alignment: 'left', margin: [0, 0, 0, 8] });
    } catch (e) { console.warn('Logo load failed', e); }
  }

  const headerTextColumn = [];
  if (meta.hospital) {
    headerTextColumn.push({ text: toRunsWithFonts(meta.hospital), width: '*', style: 'headerLine', alignment: 'center', margin: [0, 0, 0, 2] });
  }
  if (meta.department) {
    headerTextColumn.push({ text: toRunsWithFonts(meta.department), width: '*', style: 'headerLine', alignment: 'center', margin: [0, 0, 0, 2] });
  }
  if (meta.unit) {
    headerTextColumn.push({ text: toRunsWithFonts(meta.unit), width: '*', style: 'headerLine', alignment: 'center', margin: [0, 0, 0, 2] });
  }

  if (meta.pdf_header) {
    headerTextColumn.push({ text: toRunsWithFonts(meta.pdf_header), width: '*', style: 'headerLine', alignment: 'center', margin: [0, 0, 0, 6] });
  }

  if (headerColumns.length || headerTextColumn.length) {
    content.push({ columns: [...headerColumns, headerTextColumn], columnGap: 10 });
  }

  // Title
  content.push({ text: toRunsWithFonts(meta.title), style: 'title', alignment: 'center', margin: [0, 10, 0, 18] });

  // Helper to get a field value from the values map
  const getValue = (id) => values[id];

  const addParagraph = (text) => {
    content.push({ text: toRunsWithFonts(text), margin: [0, 0, 0, 4] });
  };

  const addMarkdown = (md) => {
    const blocks = markdownToPdfMakeBlocks(md);
    blocks.forEach(b => content.push(b));
  };

  const addTable = (label, headers, rows) => {
    if (label) content.push({ text: label, style: 'sectionLabel', margin: [0, 6, 0, 4] });
    content.push({
      table: {
        headerRows: 1,
        widths: headers.map(() => '*'),
        body: [headers, ...rows]
      },
      layout: 'lightHorizontalLines',
      fontSize: 10,
      margin: [0, 0, 0, 8]
    });
  };

  const renderSection = async (titleText, children, sectionNode) => {
    if (sectionNode && sectionNode.if && !safeEvalCondition(sectionNode.if, getValue)) return;
    if (titleText) content.push({ text: toRunsWithFonts(titleText), style: 'sectionTitle', margin: [0, 8, 0, 6] });
    for (const node of children) {
      if (!node) continue;
      if (node.type === 'group') { await renderGroup(node); continue; }
      if (!node || node.type !== 'field') continue;
      if (node.nooutput) continue; // honour opt-out from final output
      if (node.if && !safeEvalCondition(node.if, getValue)) continue;

      if (node.fieldType === 'static') {
        const md = String(node.content || '').trim();
        if (!md) continue;
        addMarkdown(md);
        continue;
      }

      if (node.fieldType === 'table') {
        const tableVal = (getValue(node.id) || []);
        const { headers, rows } = buildTableRows(node, tableVal);
        if (!headers.length) continue;
        const bodyRows = rows.map(r => r.map(c => ({ text: toRunsWithFonts(c) })));
        addTable(node.label || null, headers.map(h => ({ text: toRunsWithFonts(h), bold: true })), bodyRows);
        continue;
      }

      if (node.fieldType === 'text' && node.multiline) {
        const val = String(getValue(node.id) || '').trim();
        if (!val) continue;
        const label = node.label ? `${node.label}:\n` : '';
        addParagraph(label);
        addMarkdown(val);
        continue;
      }

      // Generic fields
      const line = buildFieldLine(node, getValue(node.id));
      if (!line) continue;
      addParagraph(line);
    }
  };

  for (const node of ast) {
    if (!node) continue;
  if (node.type === 'section') await renderSection(node.title, node.children || [], node);
    else if (node.type === 'group') await renderGroup(node);
    else if (node.type === 'field') await renderSection(null, [node]);
  }

  const dateStr = new Date().toLocaleString();

  const docDefinition = {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 60],
    content,
    defaultStyle: { font: 'Poppins', fontSize: 10 },
    styles: {
      headerLine: { fontSize: 14, bold: true },
      title: { fontSize: 14, bold: false },
      sectionTitle: { fontSize: 12, bold: true },
      sectionLabel: { fontSize: 10, bold: true }
    },
    footer: (currentPage, pageCount) => {
      return {
        columns: [
          { text: meta.footer ? toRunsWithFonts(meta.footer) : '', alignment: 'left', fontSize: 9, margin: [40, 0, 0, 0] },
          { text: toRunsWithFonts(`Generated ${dateStr}  |  Page ${currentPage} of ${pageCount}`), alignment: 'right', fontSize: 9, margin: [0, 0, 40, 0] }
        ]
      };
    }
  };

  return docDefinition;

  async function renderGroup(node) {
    if (!node) return;
    if (node.if && !safeEvalCondition(node.if, getValue)) return;
    const layout = String(node.layout || 'vstack');
    const blocks = [];
    const children = node.children || [];
    const pushChild = async (child) => {
      if (!child) return;
      if (child.type === 'group') { await renderGroup(child); return; }
      if (child.type !== 'field') return;
      if (child.nooutput) return;
      if (child.if && !safeEvalCondition(child.if, getValue)) return;
      if (child.fieldType === 'static') {
        const md = String(child.content || '').trim(); if (!md) return; const m = markdownToPdfMakeBlocks(md); blocks.push(...m); return;
      }
      if (child.fieldType === 'table') {
        const tableVal = (getValue(child.id) || []);
        const { headers, rows } = buildTableRows(child, tableVal);
        if (!headers.length) return;
        const bodyRows = rows.map(r => r.map(c => ({ text: toRunsWithFonts(c) })));
        if (child.label) blocks.push({ text: toRunsWithFonts(child.label), style: 'sectionLabel', margin: [0, 6, 0, 4] });
        blocks.push({ table: { headerRows: 1, widths: headers.map(() => '*'), body: [headers, ...bodyRows] }, layout: 'lightHorizontalLines', fontSize: 10, margin: [0, 0, 0, 8] });
        return;
      }
      const line = buildFieldLine(child, getValue(child.id)); if (line) blocks.push({ text: toRunsWithFonts(line), margin: [0, 0, 0, 4] });
    };
    for (const ch of children) { await pushChild(ch); }

    if (/^hstack$/i.test(layout)) {
      const cols = blocks.map(b => ({ stack: [b], width: '*' }));
      if (node.title) content.push({ text: toRunsWithFonts(node.title), style: 'sectionLabel', margin: [0, 6, 0, 4] });
      content.push({ columns: cols, columnGap: 10, margin: [0, 0, 0, 6] });
    } else if (/^vstack$/i.test(layout)) {
      if (node.title) content.push({ text: toRunsWithFonts(node.title), style: 'sectionLabel', margin: [0, 6, 0, 4] });
      blocks.forEach(b => content.push(b));
    } else {
      const m = /^columns-(\d+)$/i.exec(layout);
      if (m) {
        const count = Math.max(1, parseInt(m[1], 10) || 1);
        const cols = Array.from({ length: count }, () => []);
        blocks.forEach((b, idx) => cols[idx % count].push(b));
        const colDefs = cols.map(stack => ({ stack, width: '*' }));
        if (node.title) content.push({ text: toRunsWithFonts(node.title), style: 'sectionLabel', margin: [0, 6, 0, 4] });
        content.push({ columns: colDefs, columnGap: 10, margin: [0, 0, 0, 6] });
      } else {
        if (node.title) content.push({ text: toRunsWithFonts(node.title), style: 'sectionLabel', margin: [0, 6, 0, 4] });
        blocks.forEach(b => content.push(b));
      }
    }
  }
}

function buildTableRows(node, tableVal) {
  const headers = node.columns;
  const rows = Array.isArray(tableVal) ? tableVal : [];
  const body = rows.map(r => headers.map(h => str(r[h]))).filter(r => r.some(c => c && c.trim() !== ''));
  return { headers, rows: body };
}

function buildFieldLine(node, val) {
  if (node.fieldType === 'hidden') return null; // skip hidden in PDF
  const label = node.label ? `${node.label}: ` : '';
  let text = '';
  switch (node.fieldType) {
    case 'diagnosis': {
      const arr = Array.isArray(val) ? val : [];
      text = arr.map(o => (o && (o.description || o.label || o.name)) + (o && o.code ? ` (${o.code})` : '')).filter(Boolean).join('; ');
      break;
    }
    case 'complaints': {
      const arr = Array.isArray(val) ? val : [];
      text = arr.map(o => {
        if (!o || !o.complaint) return '';
        const dur = o.duration ? ` × ${o.duration}${o.unit ? ' ' + o.unit : ''}` : '';
        return `${o.complaint}${dur}`;
      }).filter(Boolean).join('; ');
      break;
    }
    case 'list': {
      const arr = Array.isArray(val) ? val : [];
      text = arr.join('; ');
      break;
    }
    case 'checkbox': {
      if (typeof val === 'boolean') text = val ? node.trueValue || '(+)' : node.falseValue || '(-)';
      break;
    }
    case 'static': { return null; }
    case 'table': { return null; }
    default: {
      text = str(val);
    }
  }

  text = (text || '').trim();
  if (!text) return null;
  return label + text;
}

function str(v) { if (v === undefined || v === null) return ''; return String(v); }

function safeEvalCondition(expr, getValue) {
  try { return evaluateCondition(expr, getValue); } catch { return false; }
}

async function loadImageAsDataUrl(url) {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error('Image load failed: ' + url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Helpers for font loading
// Font registration handled in ensurePdfMakeFonts

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000; // 32KB chunks to avoid call stack issues
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, sub);
  }
  return btoa(binary);
}

// Detects if a string contains characters from the Tamil Unicode block only
function containsIndic(text) {
  if (!text) return false;
  const regex = /[\u0B80-\u0BFF]/; // Tamil block only
  return regex.test(text);
}

// Build pdfmake text runs with per-grapheme font switching (Tamil only)
function toRunsWithFonts(text, opts = {}) {
  const clusters = segmentGraphemes(String(text));
  const runs = [];
  let currentFont = null; let buf = '';
  const flush = () => {
    if (!buf) return;
    const node = { text: buf };
    if (opts.bold) node.bold = true;
    if (opts.italic || opts.italics) node.italics = true;
    if (currentFont) node.font = currentFont;
    runs.push(node); buf = '';
  };
  for (const g of clusters) {
    const font = containsIndic(g) ? 'Noto Sans Tamil' : 'Poppins';
    if (currentFont === font) buf += g; else { flush(); currentFont = font; buf = g; }
  }
  flush();
  return runs;
}

function segmentGraphemes(str) {
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      return Array.from(seg.segment(str), s => s.segment);
    }
  } catch { }
  // Fallback: code points (not perfect for all scripts but acceptable fallback)
  return Array.from(str);
}

// Markdown to pdfmake blocks (basic: **bold**, *italic*, blank lines, simple ul/ol lists) ---
function markdownToPdfMakeBlocks(md) {
  const blocks = [];
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { blocks.push({ text: ' ', margin: [0, 0, 0, 4] }); i++; continue; }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const m = lines[i].match(/^\s*\d+\.\s+(.*)$/);
        items.push({ text: inlineMdToRuns(m[1]) });
        i++;
      }
      blocks.push({ ol: items, margin: [0, 0, 0, 6] });
      continue;
    }
    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const m = lines[i].match(/^\s*[-*]\s+(.*)$/);
        items.push({ text: inlineMdToRuns(m[1]) });
        i++;
      }
      blocks.push({ ul: items, margin: [0, 0, 0, 6] });
      continue;
    }
    // Paragraph (collect until blank or list)
    const para = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i])) {
      para.push(lines[i]); i++;
    }
    const text = para.join('\n');
    blocks.push({ text: inlineMdToRuns(text), margin: [0, 0, 0, 4] });
  }
  return blocks;
}

function parseInlineMarkdown(text) {
  const tokens = [];
  let i = 0; let bold = false, italic = false;
  while (i < text.length) {
    if (text.startsWith('**', i)) { bold = !bold; i += 2; continue; }
    if (text[i] === '*') { italic = !italic; i += 1; continue; }
    let j = i; while (j < text.length && !text.startsWith('**', j) && text[j] !== '*') j++;
    const chunk = text.slice(i, j); if (chunk) tokens.push({ text: chunk, bold, italic }); i = j;
  }
  return tokens;
}

function inlineMdToRuns(text) {
  const tokens = parseInlineMarkdown(text);
  const runs = [];
  for (const t of tokens) {
    const segs = toRunsWithFonts(t.text, { bold: t.bold, italics: t.italic });
    runs.push(...segs);
  }
  return runs;
}
