import { parseMCTM } from './mctm_parser.js';

export const MCTM_SPEC = {
  version: '1.0',
  meta: { required: ['template_id', 'title', 'version'], optional: ['logo', 'hospital', 'department', 'unit', 'pdf_header', 'pdf_footer'] },
  fieldTypes: {
    text: { required: ['id'], optional: ['label', 'placeholder', 'multiline', 'required', 'pattern', 'default', 'if'] },
    number: { required: ['id'], optional: ['label', 'placeholder', 'required', 'min', 'max', 'pattern', 'default', 'if'] },
    checkbox: { required: ['id'], optional: ['label', 'trueValue', 'falseValue', 'required', 'default', 'if'] },
    date: { required: ['id'], optional: ['label', 'required', 'default', 'if'] },
    select: { required: ['id'], optional: ['label', 'options', 'source', 'multiple', 'required', 'default', 'if'] },
    table: { required: ['id'], optional: ['label', 'columns', 'required', 'default', 'if'] },
    list: { required: ['id'], optional: ['label', 'placeholder', 'required', 'default', 'if'] },
    complaints: { required: ['id'], optional: ['label', 'placeholder', 'required', 'default', 'if'] },
    diagnosis: { required: ['id'], optional: ['label', 'placeholder', 'required', 'default', 'if'] },
    image: { required: ['id'], optional: ['label', 'mode', 'maxSizeKB', 'if'] },
    static: { required: [], optional: ['content'] },
    computed: { required: ['id', 'formula'], optional: ['label', 'format', 'if'] },
    hidden: { required: ['id'], optional: ['default'] },
    'comorbidities': { required: ['id'], optional: ['label', 'items'] },
    'personal-history': { required: ['id'], optional: ['label'] },
    'menstrual-history': { required: ['id'], optional: ['label', 'if'] },
    'general-exam': { required: ['id'], optional: ['label'] },
    'drug-treatment': { required: ['id'], optional: ['label'] },
    'investigations': { required: ['id'], optional: ['label'] },
    'opinions': { required: ['id'], optional: ['label'] },
    'followup': { required: ['id'], optional: ['label'] }
  }
};

export function lintMCTM({ source, ast, meta }) {
  const diagnostics = [];
  const lines = source.split(/\r?\n/);

  // 1. Meta required
  MCTM_SPEC.meta.required.forEach(key => {
    if (!meta[key]) diagnostics.push(err(`Missing required meta: ${key}`, findMetaLine(lines, key) || 1));
  });

  // 2. Duplicate IDs
  const idCount = new Map();
  walkFields(ast, node => {
    if (node.id) {
      const c = (idCount.get(node.id) || 0) + 1;
      idCount.set(node.id, c);
      if (c > 1) diagnostics.push(err(`Duplicate field id: ${node.id}`, node.line));
    }
  });

  // 3. Unknown field types from raw source fences
  const knownTypes = new Set(Object.keys(MCTM_SPEC.fieldTypes));
  lines.forEach((ln, idx) => {
    const f = /^@([a-z][a-z0-9-]*)/i.exec(ln.trim());
    if (f) {
      const t = f[1];
      if (t === 'mctm' && idx === 0) return;
      if (!knownTypes.has(t)) diagnostics.push(warn(`Unknown field type: ${t}`, idx + 1));
    }
  });

  // 4. Sections empty
  ast.filter(n => n.type === 'section').forEach(sec => {
    if (!sec.children.length) diagnostics.push(warn(`Empty section: ${sec.title}`, sec.line));
  });

  // 5. Required props per field
  walkFields(ast, node => {
    const spec = MCTM_SPEC.fieldTypes[node.fieldType];
    if (!spec) return; // already warned
    spec.required.forEach(r => { if (!Object.prototype.hasOwnProperty.call(node, r)) diagnostics.push(err(`Field ${node.id || '(no id)'} missing required prop '${r}'`, node.line)); });
    if (node.min !== undefined && node.max !== undefined) {
      const mn = parseFloat(node.min), mx = parseFloat(node.max);
      if (!isNaN(mn) && !isNaN(mx) && mn > mx) diagnostics.push(err(`min (${mn}) > max (${mx}) for field ${node.id}`, node.line));
    }
    if (!node.label && !['static', 'hidden', 'computed'].includes(node.fieldType)) diagnostics.push(warn(`Field ${node.id} missing label`, node.line));
    const allowed = new Set([...spec.required, ...spec.optional, 'fieldType', 'type', 'line']);
    Object.keys(node).forEach(k => { if (!allowed.has(k)) diagnostics.push(warn(`Property '${k}' not recognized for type ${node.fieldType}`, node.line)); });
    if (node.fieldType === 'computed') {
      if (node.formula) {
        try { new Function('ctx', `with(ctx){ return ${node.formula}; }`); } catch (e) { diagnostics.push(err(`Invalid formula for ${node.id}: ${e.message}`, node.line)); }
      }
    }
    const cond = node.if;
    if (cond) {
      const tokens = cond.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
      tokens.forEach(tok => {
        if (['true', 'false', 'null', 'and', 'or', 'not'].includes(tok)) return;
        if (idCount.has(tok) || tok === node.id) return;
        if (new RegExp(`['\"]${tok}['\"]`).test(cond)) return;
        diagnostics.push(warn(`Condition references unknown field '${tok}'`, node.line));
      });
    }
  });

  return diagnostics.sort((a, b) => (a.line - b.line) || severityRank(a) - severityRank(b));
}

export function parseAndLintMCTM(source) {
  const parsed = parseMCTM(source);
  const diagnostics = lintMCTM({ source, ast: parsed.ast, meta: parsed.meta });
  return { ...parsed, diagnostics };
}

function walkFields(ast, fn) {
  ast.forEach(node => {
    if (node.type === 'field') fn(node);
    else if (node.type === 'section') node.children.forEach(ch => { if (ch.type === 'field') fn(ch); });
  });
}

function findMetaLine(lines, key) {
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*---\s*$/.test(lines[i])) {
      for (let j = i + 1; j < lines.length && !/^\s*---\s*$/.test(lines[j]); j++) {
        if (new RegExp('^' + key + ':').test(lines[j])) return j + 1;
      }
    }
  }
  return null;
}

function err(message, line) { return { level: 'error', message, line }; }
function warn(message, line) { return { level: 'warning', message, line }; }
function severityRank(d) { return d.level === 'error' ? 0 : 1; }
