export function parseMCTM(source) {
  const lines = source.split(/\r?\n/);
  const ast = [];
  const meta = {};
  const overrides = [];
  let i = 0;
  let metaParsed = false;
  let overrideBlockActive = false;
  let currentSection = null;
  // A stack of containers to support nested groups. Each item is { container: Array }
  const containerStack = [];

  const versionDirective = /^@(mctm)\s+(\d+(?:\.(?:\d+)*)*)/i;
  if (lines[0] && versionDirective.test(lines[0])) {
    const m = lines[0].match(versionDirective);
    const ver = m[2];
    meta.mctmversion = ver;
    i = 1; // Skip version line
  }

  // The active container to push parsed nodes into (root or a section/group children)
  const getActiveContainer = () => {
    if (containerStack.length)
      return containerStack[containerStack.length - 1].container;
    if (currentSection) return currentSection.children;
    return ast;
  };

  while (i < lines.length) {
    let line = lines[i] ?? "";
    // Comments (start with //)
    if (/^\s*(\/\/)/.test(line)) {
      i++;
      continue;
    }

    // Overrides block start: #overrides (single or multiple allowed)
    if (/^\s*#overrides\b/i.test(line)) {
      overrideBlockActive = true;
      i++;
      continue;
    }

    // Overrides block end: #end
    if (overrideBlockActive && /^\s*#end\b/i.test(line)) {
      overrideBlockActive = false;
      i++;
      continue;
    }

    if (overrideBlockActive) {
      // Parse assignment lines: field[.prop[.sub]]: value  (allow multiline quoted strings)
      if (line.trim() === "") {
        i++;
        continue;
      }
      const assign = /^\s*([A-Za-z_][\w.-]*)\s*:\s*(.*)$/.exec(line);
      if (assign) {
        const target = assign[1].trim();
        let valRaw = assign[2];
        const ovLine = i + 1;
        // Multiline quoted string support
        if (/^['"]/.test(valRaw) && !/(['"])\s*$/.test(valRaw)) {
          const q = valRaw[0];
          // accumulate until closing quote
          while (++i < lines.length) {
            valRaw += "\n" + lines[i];
            if (
              new RegExp(`${q}\\s*$`).test(lines[i]) &&
              lines[i].slice(-1) === q
            )
              break;
          }
        }
        let value = valRaw.trim();
        // Remove surrounding quotes (may span lines)
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        // Array syntax like [a, b, c]
        if (value.startsWith("[") && value.endsWith("]")) {
          const inner = value.slice(1, -1).trim();
          if (inner) {
            value = inner.split(",").map((s) => stripQuotes(s.trim()));
          } else value = [];
        }
        overrides.push({ target, value, line: ovLine });
      }
      i++;
      continue;
    }

    // Metadata blocks (start and end with ---)
    if (!metaParsed && /^\s*---\s*$/.test(line)) {
      i++;
      while (i < lines.length && !/^\s*---\s*$/.test(lines[i])) {
        const mline = lines[i];
        const kv = /^(\w[\w.-]*):\s*(.*)$/.exec(mline);
        if (kv) {
          meta[kv[1]] = stripQuotes(kv[2].trim());
        }
        i++;
      }
      if (i < lines.length && /^\s*---\s*$/.test(lines[i])) i++;
      metaParsed = true;
      continue;
    }

    // Sections (> "Title" id:... if:...)
    const secMatch = /^>\s+(.+)$/.exec(line);
    if (secMatch && containerStack.length === 0) {
      // sections only at root level
      const startLine = i + 1;
      const { title, props } = parseTitleAndProps(secMatch[1]);
      const section = {
        type: "section",
        title,
        children: [],
        line: startLine,
        ...props,
      };
      if (!section.id && section.title)
        section.id = "section_" + slugify(section.title);
      // Ensure optional property is boolean if present
      if (section.optional !== undefined) section.optional = !!section.optional;
      ast.push(section);
      currentSection = section;
      i++;
      continue;
    }

    // Group start: { "Group Title" id:... layout:... if:...  (ends with a line containing only })
    const grpOpen = /^\s*\{\s*(.*)$/.exec(line);
    if (grpOpen) {
      const startLine = i + 1;
      const header = grpOpen[1] || "";
      const { title, props } = parseTitleAndProps(header);
      const group = {
        type: "group",
        title,
        children: [],
        line: startLine,
        ...props,
      };
      if (!group.id && group.title) group.id = "group_" + slugify(group.title);
      getActiveContainer().push(group);
      // Push this group's children container on the stack
      containerStack.push({ container: group.children });
      i++;
      // Consume subsequent empty header continuation lines if any (no special handling)
      continue;
    }

    // Group end
    if (/^\s*\}\s*$/.test(line)) {
      if (containerStack.length) containerStack.pop();
      i++;
      continue;
    }

    // Field blocks start and end with '@'
    const atFence = /^@([a-z][a-z0-9-]*)(.*)$/i.exec(line.trim());
    if (atFence) {
      const type = atFence[1];
      let inline = (atFence[2] || "").trim();
      const startLine = i + 1;
      const bodyLines = [];
      const inlineClose = /@\s*$/.test(line) && inline.length > 0;
      if (inlineClose) {
        inline = inline.replace(/@\s*$/, "").trim();
      }
      i++;
      if (!inlineClose) {
        while (i < lines.length && lines[i].trim() !== "@") {
          bodyLines.push(lines[i]);
          i++;
        }
        if (i < lines.length && lines[i].trim() === "@") {
          i++;
        }
      }
      const props = parseProps(inline);
      if (type === "static") {
        props.content = bodyLines.join("\n");
      } else if (bodyLines.length) {
        const extra = parseProps(bodyLines.join(" "));
        Object.assign(props, extra);
      }
      const node =
        type === "include"
          ? { type: "include", line: startLine, ...props }
          : { type: "field", fieldType: type, line: startLine, ...props };
      const container = getActiveContainer();
      container.push(node);
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
        !/^>\s+/.test(lines[i]) &&
        !/^@([a-z][a-z0-9-]*)/i.test(lines[i].trim()) &&
        !/^\s*(\/\/|%%)/.test(lines[i]) &&
        !/^\s*\}/.test(lines[i])
      ) {
        paraLines.push(lines[i]);
        i++;
      }
      const node = {
        type: "field",
        fieldType: "static",
        content: paraLines.join("\n"),
        line: startLine,
      };
      getActiveContainer().push(node);
      continue;
    }
    i++;
  }
  return { meta, overrides, ast };
}

function parseProps(chunk) {
  if (!chunk) return {};

  const obj = {};
  const tokens = tokenize(chunk);

  const nsTargets = new Set(["pdf", "ui"]);

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const colonIdx = t.indexOf(":");
    if (colonIdx === -1) {
      // Bare flag -> boolean true
      obj[t] = true;
      continue;
    }

    let key = t.slice(0, colonIdx).trim();
    let val = t.slice(colonIdx + 1).trim();
    if (val === "") val = true; // key:  (empty) treated as boolean

    // Normalize string value (strip quotes, then decode) when not boolean true
    if (val !== true) {
      val = stripQuotes(val);
      if (typeof val === "string" && /^(true|false)$/i.test(val)) {
        val = /^true$/i.test(val);
      } else if (
        typeof val === "string" &&
        val.length >= 2 &&
        val[0] === "[" &&
        val[val.length - 1] === "]"
      ) {
        // Array syntax: [a,b,c]  (no nested arrays expected)
        const inner = val.slice(1, -1).trim();
        if (inner) {
          // Split on commas with trimming;
          const parts = inner.split(",");
          const arr = new Array(parts.length);
          for (let j = 0; j < parts.length; j++) {
            const raw = stripQuotes(parts[j].trim());
            arr[j] = raw;
          }
          val = arr;
        } else {
          val = [];
        }
      }
    }

    // Inline namespace folding (e.g. pdf.hidden => obj.pdf.hidden = true)
    // Only fold one level (ns.prop).
    const dotPos = key.indexOf(".");
    if (dotPos > 0) {
      const ns = key.slice(0, dotPos);
      const prop = key.slice(dotPos + 1);
      if (prop && nsTargets.has(ns)) {
        const cur = obj[ns];
        if (!cur || typeof cur !== "object" || Array.isArray(cur)) {
          obj[ns] = {};
        }
        obj[ns][prop] = val;
        continue;
      }
    }

    obj[key] = val;
  }

  return obj;
}

function tokenize(s) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  let quoteChar = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === quoteChar && s[i - 1] !== "\\") {
        inQuotes = false;
        cur += c;
        continue;
      }
      cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      inQuotes = true;
      quoteChar = c;
      cur += c;
      continue;
    }
    if (/\s/.test(c)) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

function stripQuotes(v) {
  if (typeof v !== "string") return v;
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

// Utilities for new syntax
function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]/gi, "_")
    .replace(/_+/g, "_");
}

function parseTitleAndProps(rest) {
  let title = "";
  let propsStr = "";
  const trimmed = rest.trim();
  if (!trimmed) return { title: "", props: {} };
  if (trimmed[0] === '"' || trimmed[0] === "'") {
    // parse quoted title
    const quote = trimmed[0];
    let j = 1;
    let prev = "";
    while (j < trimmed.length) {
      const c = trimmed[j];
      if (c === quote && prev !== "\\") {
        j++;
        break;
      }
      prev = c;
      j++;
    }
    title = stripQuotes(trimmed.slice(0, j));
    propsStr = trimmed.slice(j).trim();
  } else {
    // find first key:value token occurrence to split title from props
    const m = /\s+([A-Za-z_][\w.-]*\s*:)/.exec(trimmed);
    if (m) {
      const idx = m.index;
      title = trimmed.slice(0, idx).trim();
      propsStr = trimmed.slice(idx).trim();
    } else {
      title = trimmed;
      propsStr = "";
    }
  }
  const props = parseProps(propsStr);
  return { title, props };
}

// ---- Include Expansion (Parse-Time) ----
// Expands @include nodes by fetching and parsing referenced templates before rendering.
// Options:
//   baseURL: string used to resolve relative include template paths
//   fetchImpl: custom fetch function (defaults to global fetch)
//   onError: (msg, node) => void for diagnostics
//   maxIncludeDepth: integer limit to prevent infinite recursion
// Returns Promise<{ meta, ast }>
export async function parseMCTMResolved(source, options = {}) {
  const {
    baseURL = typeof document !== "undefined" ? document.baseURI : "",
    fetchImpl = typeof fetch !== "undefined" ? fetch : null,
    onError,
    maxIncludeDepth = 64,
  } = options;
  const parsed = parseMCTM(source);
  if (!fetchImpl) return parsed;
  const cache = new Map(); // templateUrl -> { meta, ast }
  const activeStack = []; // array of { key, template, part }
  const activeSet = new Set(); // membership for cycle detection

  async function loadTemplate(url) {
    if (cache.has(url)) return cache.get(url);
    try {
      const res = await fetchImpl(resolveUrl(url));
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const txt = await res.text();
      const sub = parseMCTM(txt);
      cache.set(url, sub);
      return sub;
    } catch (e) {
      if (onError)
        onError(`Failed to load include template '${url}': ${e.message}`);
      return { meta: {}, ast: [] };
    }
  }

  function resolveUrl(tpl) {
    try {
      return new URL(tpl, baseURL).href;
    } catch {
      return tpl;
    }
  }

  async function expandIncludesInArray(arr, parentIsRoot) {
    for (let idx = 0; idx < arr.length; idx++) {
      const node = arr[idx];
      if (!node) continue;
      if (node.type === "include") {
        const templateRef = node.template;
        const partId = node.part || node.id;

        if (!templateRef || !partId) {
          if (onError) onError(`Include missing template or id/part`, node);
          arr.splice(idx, 1);
          idx--;
          continue;
        }

        const cycleKey = templateRef + "::" + partId;

        if (activeSet.has(cycleKey)) {
          const firstIdx = activeStack.findIndex((e) => e.key === cycleKey);
          const path = activeStack
            .slice(firstIdx)
            .map((e) => `${e.template}::${e.part}`);
          path.push(cycleKey);
          if (onError)
            onError(`Include cycle detected: ${path.join(" -> ")}`, node);
          arr.splice(idx, 1);
          idx--;
          continue;
        }
        if (activeStack.length >= maxIncludeDepth) {
          if (onError)
            onError(
              `Include depth limit (${maxIncludeDepth}) exceeded at ${cycleKey}`,
              node
            );
          arr.splice(idx, 1);
          idx--;
          continue;
        }
        activeStack.push({
          key: cycleKey,
          template: templateRef,
          part: partId,
        });
        activeSet.add(cycleKey);
        const tplParsed = await loadTemplate(templateRef);
        const popped = activeStack.pop();
        if (popped) activeSet.delete(popped.key);

        const part = findPartById(tplParsed.ast, partId);
        if (!part) {
          if (onError)
            onError(
              `Include part '${partId}' not found in '${templateRef}'`,
              node
            );
          arr.splice(idx, 1);
          idx--;
          continue;
        }

        const cloned = cloneNode(part);
        // If including a section inside non-root context: inline its children instead of nested section
        let replacement = [];
        if (cloned.type === "section" && !parentIsRoot) {
          replacement = (cloned.children || []).map((ch) => cloneNode(ch));
        } else if (
          cloned.type === "section" ||
          cloned.type === "group" ||
          cloned.type === "field"
        ) {
          replacement = [cloned];
        } else {
          replacement = []; // unknown type
        }
        // Recursively expand includes inside the replacement nodes
        for (const repNode of replacement) {
          if (repNode.type === "group" || repNode.type === "section") {
            await expandIncludesInArray([repNode], false); // treat repNode as root to expand nested includes
          }
        }
        // Replace include with replacement nodes
        arr.splice(idx, 1, ...replacement);
        idx += replacement.length - 1;
        continue;
      }

      // Recurse into children
      if (node.children && (node.type === "section" || node.type === "group")) {
        await expandIncludesInArray(node.children, false);
      }
    }
  }

  await expandIncludesInArray(parsed.ast, true);

  // Apply overrides
  if (parsed.overrides && parsed.overrides.length) {
    for (const ov of parsed.overrides) {
      if (!ov || !ov.target) continue;
      const parts = ov.target.split(".");
      const _id = parts.shift();
      const _node = findPartById(parsed.ast, _id);
      if (!_node || _node.type !== "field") continue;

      // Override field value (default/content)
      if (!parts.length) {
        if (_node.fieldType === "static") _node.content = ov.value;
        else _node.default = ov.value;
      } else {
        // property override (support one level namespacing like pdf.hidden)
        if (parts.length === 2 && (parts[0] === "pdf" || parts[0] === "ui")) {
          const ns = parts[0];
          const prop = parts[1];
          if (!_node[ns] || typeof _node[ns] !== "object") _node[ns] = {};
          _node[ns][prop] = ov.value;
        } else {
          const propName = parts.join(".");
          _node[propName] = ov.value;
        }
      }
    }
  }

  return parsed;
}

function cloneNode(node) {
  return JSON.parse(JSON.stringify(node));
}

function findPartById(ast, id) {
  const stack = [...(ast || [])];
  while (stack.length) {
    const n = stack.shift();
    if (!n) continue;
    if (
      (n.type === "section" || n.type === "group" || n.type === "field") &&
      n.id === id
    )
      return n;
    if (n.children && n.children.length) stack.push(...n.children);
  }
  return null;
}
