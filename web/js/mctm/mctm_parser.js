export function parseMCTM(source) {
  const lines = source.split(/\r?\n/);
  const ast = [];
  const meta = {};
  let i = 0; let currentSection = null; let metaParsed = false;
  const versionDirective = /^@(mctm)\s+(\d+(?:\.\d+)*)/i;
  if (lines[0] && versionDirective.test(lines[0])) {
    const m = lines[0].match(versionDirective);
    const ver = m[2];
    meta.mctmversion = ver;
    i = 1; // Skip version line
  }
  while (i < lines.length) {
    let line = lines[i] ?? '';
    // Comments (start with //)
    if (/^\s*(\/\/)/.test(line)) { i++; continue; }
    // Metadata blocks (start and end with ---)
    if (!metaParsed && /^\s*---\s*$/.test(line)) {
      i++;
      while (i < lines.length && !/^\s*---\s*$/.test(lines[i])) {
        const mline = lines[i];
        const kv = /^(\w[\w.-]*):\s*(.*)$/.exec(mline);
        if (kv) { meta[kv[1]] = stripQuotes(kv[2].trim()); }
        i++;
      }
      if (i < lines.length && /^\s*---\s*$/.test(lines[i])) i++;
      metaParsed = true; continue;
    }

    // Sections (start with #)
    const headingMatch = /^#\s+(.+)$/.exec(line);
    if (headingMatch) {
      currentSection = { type: 'section', title: headingMatch[1].trim(), children: [], line: i + 1 };
      ast.push(currentSection); i++; continue;
    }
    // Field blocks start and end with '@'
    const atFence = /^@([a-z][a-z0-9-]*)(.*)$/i.exec(line.trim());
    if (atFence) {
      const type = atFence[1];
      let inline = (atFence[2] || '').trim();
      const startLine = i + 1;
      const bodyLines = [];
      const inlineClose = /@\s*$/.test(line) && inline.length > 0;
      if (inlineClose) {
        inline = inline.replace(/@\s*$/, '').trim();
      }
      i++;
      if (!inlineClose) {
        while (i < lines.length && lines[i].trim() !== '@') { bodyLines.push(lines[i]); i++; }
        if (i < lines.length && lines[i].trim() === '@') { i++; }
      }
      const props = parseProps(inline);
      if (type === 'static') {
        props.content = bodyLines.join('\n');
      } else if (bodyLines.length) {
        const extra = parseProps(bodyLines.join(' '));
        Object.assign(props, extra);
      }
      const node = { type: 'field', fieldType: type, line: startLine, ...props };
      if (!currentSection) { ast.push(node); } else { currentSection.children.push(node); }
      continue;
    }
    // Static paragraph capture
    if (line.trim()) {
      const paraLines = [line];
      const startLine = i + 1;
      i++;
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^#\s+/.test(lines[i]) &&
        !/^@([a-z][a-z0-9-]*)/i.test(lines[i].trim()) &&
        !/^\s*(\/\/|%%)/.test(lines[i])
      ) { paraLines.push(lines[i]); i++; }
      const node = { type: 'field', fieldType: 'static', content: paraLines.join('\n'), line: startLine };
      if (!currentSection) { ast.push(node); } else { currentSection.children.push(node); }
      continue;
    }
    i++;
  }
  return { meta, ast };
}

function parseProps(chunk) {
  const obj = {};
  if (!chunk) return obj;
  const tokens = tokenize(chunk);
  for (const t of tokens) {
    if (t.includes(':')) {
      const idx = t.indexOf(':');
      const key = t.slice(0, idx).trim();
      let val = t.slice(idx + 1).trim();
      if (val === '') val = true;
      val = stripQuotes(val);
      if (/^\[.*\]$/.test(val)) {
        const inner = val.slice(1, -1).trim();
        obj[key] = inner ? inner.split(/\s*,\s*/).map(v => decodeURIComponent(stripQuotes(v).trim())) : [];
      } else {
        obj[key] = decodeURIComponent(val);
      }
    } else {
      obj[t] = true;
    }
  }
  return obj;
}

function tokenize(s) {
  const out = []; let cur = ''; let inQuotes = false; let quoteChar = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === quoteChar && s[i - 1] !== "\\") { inQuotes = false; cur += c; continue; }
      cur += c; continue;
    }
    if (c === '"' || c === "'") { inQuotes = true; quoteChar = c; cur += c; continue; }
    if (/\s/.test(c)) { if (cur) { out.push(cur); cur = ''; } continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

function stripQuotes(v) {
  if (typeof v !== 'string') return v;
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}
