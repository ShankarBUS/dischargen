import { parseMCTM } from "./mctm_parser.js";

export const MCTM_SPEC = {
  version: "1.0",
  meta: {
    required: ["template_id", "version"],
    optional: [
      "title",
      "hospital",
      "department",
      "unit",
      "pdf_header",
      "pdf_footer",
      "logo",
    ],
  },
  fieldTypes: {
    text: {
      required: ["id"],
      optional: [
        "label",
        "placeholder",
        "multiline",
        "pattern",
        "required",
        "default",
        "if",
        "pdf",
        "ui",
      ],
    },
    number: {
      required: ["id"],
      optional: [
        "label",
        "placeholder",
        "min",
        "max",
        "pattern",
        "required",
        "default",
        "unit",
        "if",
        "pdf",
        "ui",
      ],
    },
    checkbox: {
      required: ["id"],
      optional: [
        "label",
        "trueValue",
        "falseValue",
        "required",
        "default",
        "if",
        "pdf",
        "ui",
      ],
    },
    date: {
      required: ["id"],
      optional: ["label", "required", "default", "if", "pdf", "ui"],
    },
    select: {
      required: ["id"],
      optional: [
        "label",
        "options",
        "source",
        "multiple",
        "required",
        "default",
        "if",
        "pdf",
        "ui",
      ],
    },
    table: {
      required: ["id"],
      optional: ["label", "columns", "required", "default", "if", "pdf", "ui"],
    },
    list: {
      required: ["id"],
      optional: [
        "label",
        "placeholder",
        "required",
        "default",
        "if",
        "pdf",
        "ui",
      ],
    },
    complaints: {
      required: ["id"],
      optional: [
        "label",
        "placeholder",
        "suggestions",
        "required",
        "default",
        "if",
        "pdf",
        "ui",
      ],
    },
    diagnosis: {
      required: ["id"],
      optional: [
        "label",
        "placeholder",
        "required",
        "default",
        "if",
        "pdf",
        "ui",
      ],
    },
    chronicdiseases: {
      required: ["id"],
      optional: [
        "label",
        "suggestions",
        "shownegatives",
        "required",
        "default",
        "if",
        "pdf",
        "ui",
      ],
    },
    pastevents: {
      required: ["id"],
      optional: [
        "label",
        "suggestions",
        "required",
        "default",
        "if",
        "pdf",
        "ui",
      ],
    },
    static: { required: [], optional: ["content", "if", "pdf", "ui"] },
    computed: {
      required: ["id", "formula"],
      optional: ["label", "format", "unit", "if", "pdf", "ui"],
    },
    hidden: { required: ["id"], optional: ["default", "pdf", "ui"] },
  },
};

export function lintMCTM({ source, ast, meta, overrides = [] }) {
  const diagnostics = [];
  const lines = source.split(/\r?\n/);

  // 1. Meta required
  MCTM_SPEC.meta.required.forEach((key) => {
    if (!meta[key])
      diagnostics.push(
        err(`Missing required meta: ${key}`, findMetaLine(lines, key) || 1)
      );
  });

  // 2. Overrides
  if (overrides && overrides.length) {
    overrides.forEach((ov) => {
      if (!ov || !ov.target) return;
      const parts = ov.target.split(".");
      const id = parts.shift();
      const fieldNode = findFieldById(ast, id);
      if (!fieldNode) {
        diagnostics.push(
          warn(`Override references unknown field '${id}'`, ov.line || 1)
        );
        return;
      }
      if (fieldNode.type !== "field") {
        diagnostics.push(
          warn(
            `Override target '${id}' is not a field`,
            ov.line || fieldNode.line
          )
        );
        return;
      }
    });
  }

  // 3. Duplicate IDs (fields only for now)
  const idCount = new Map();
  walkNodes(ast, (node) => {
    if (node && node.type === "field" && node.id) {
      const c = (idCount.get(node.id) || 0) + 1;
      idCount.set(node.id, c);
      if (c > 1)
        diagnostics.push(err(`Duplicate field id: ${node.id}`, node.line));
    }
  });

  // 4. Unknown field types from raw source fences
  const knownTypes = new Set([...Object.keys(MCTM_SPEC.fieldTypes), "include"]);
  lines.forEach((ln, idx) => {
    const f = /^@([a-z][a-z0-9-]*)/i.exec(ln.trim());
    if (f) {
      const t = f[1];
      if (t === "mctm" && idx === 0) return;
      if (!knownTypes.has(t))
        diagnostics.push(warn(`Unknown field type: ${t}`, idx + 1));
    }
  });

  // 5. Sections/groups basic checks
  ast
    .filter((n) => n.type === "section")
    .forEach((sec) => {
      if (!sec.children.length)
        diagnostics.push(warn(`Empty section: ${sec.title}`, sec.line));
      if (sec.if) validateConditionRefs(sec, idCount, diagnostics);
    });
  walkNodes(ast, (node) => {
    if (node && node.type === "group") {
      if (!node.children || !node.children.length)
        diagnostics.push(
          warn(`Empty group: ${node.title || node.id}`, node.line)
        );
      if (
        node.layout &&
        !/^vstack$|^hstack$|^columns-\d+$/i.test(String(node.layout))
      )
        diagnostics.push(
          warn(`Unknown group layout '${node.layout}'`, node.line)
        );
      if (node.if) validateConditionRefs(node, idCount, diagnostics);
      // Toggle group sanity
      if (node.toggle === true || String(node.toggle).toLowerCase() === "true") {
        if (!node.id)
          diagnostics.push(
            warn(
              `Toggle group should have an 'id' so its state can be referenced and exported`,
              node.line
            )
          );
      }
    }
  });

  // 6. Required props per field
  walkNodes(ast, (node) => {
    if (!node || node.type !== "field") return;
    const spec = MCTM_SPEC.fieldTypes[node.fieldType];
    if (!spec) return; // already warned
    spec.required.forEach((r) => {
      if (!Object.prototype.hasOwnProperty.call(node, r))
        diagnostics.push(
          err(
            `Field ${node.id || "(no id)"} missing required prop '${r}'`,
            node.line
          )
        );
    });
    if (node.min !== undefined && node.max !== undefined) {
      const mn = parseFloat(node.min),
        mx = parseFloat(node.max);
      if (!isNaN(mn) && !isNaN(mx) && mn > mx)
        diagnostics.push(
          err(`min (${mn}) > max (${mx}) for field ${node.id}`, node.line)
        );
    }
    if (
      !node.label &&
      !["static", "hidden", "computed"].includes(node.fieldType)
    )
      diagnostics.push(warn(`Field ${node.id} missing label`, node.line));
    const allowed = new Set([
      ...spec.required,
      ...spec.optional,
      "fieldType",
      "type",
      "line",
    ]);
    Object.keys(node).forEach((k) => {
      if (k === "pdf" || k === "ui") return; // handled below
      if (!allowed.has(k))
        diagnostics.push(
          warn(
            `Property '${k}' not recognized for type ${node.fieldType}`,
            node.line
          )
        );
    });

    // Validate namespaced visibility objects
    ["pdf", "ui"].forEach((ns) => {
      const val = node[ns];
      if (val == null) return;
      if (typeof val !== "object" || Array.isArray(val)) {
        diagnostics.push(
          warn(`${ns} should be an object (e.g., { hidden: true })`, node.line)
        );
        return;
      }
      const allowedSub = new Set(["hidden"]);
      Object.keys(val).forEach((sub) => {
        if (!allowedSub.has(sub))
          diagnostics.push(
            warn(`Unknown ${ns}.* property '${sub}'`, node.line)
          );
        else if (sub === "hidden" && typeof val[sub] !== "boolean")
          diagnostics.push(warn(`${ns}.hidden should be boolean`, node.line));
      });
    });

    if (node.fieldType === "computed") {
      if (node.formula) {
        try {
          new Function("ctx", `with(ctx){ return ${node.formula}; }`);
        } catch (e) {
          diagnostics.push(
            err(`Invalid formula for ${node.id}: ${e.message}`, node.line)
          );
        }
      }
    }
    if (node.if) validateConditionRefs(node, idCount, diagnostics);
  });

  // 7. Includes sanity
  walkNodes(ast, (node) => {
    if (node && node.type === "include") {
      if (!node.template)
        diagnostics.push(err(`include missing 'template' property`, node.line));
      if (!node.id && !node.part)
        diagnostics.push(
          err(
            `include requires 'id' (or 'part') of the referenced section/group/field`,
            node.line
          )
        );
    }
  });

  return diagnostics.sort(
    (a, b) => a.line - b.line || severityRank(a) - severityRank(b)
  );
}

export function parseAndLintMCTM(source) {
  const parsed = parseMCTM(source);
  const diagnostics = lintMCTM({
    source,
    ast: parsed.ast,
    meta: parsed.meta,
    overrides: parsed.overrides,
  });
  return { ...parsed, diagnostics };
}

function walkNodes(ast, fn) {
  const walk = (node) => {
    if (!node) return;
    fn(node);
    if (node.type === "section" || node.type === "group") {
      (node.children || []).forEach(walk);
    }
  };
  (ast || []).forEach(walk);
}

function findMetaLine(lines, key) {
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*---\s*$/.test(lines[i])) {
      for (
        let j = i + 1;
        j < lines.length && !/^\s*---\s*$/.test(lines[j]);
        j++
      ) {
        if (new RegExp("^" + key + ":").test(lines[j])) return j + 1;
      }
    }
  }
  return null;
}

function err(message, line) {
  return { level: "error", message, line };
}
function warn(message, line) {
  return { level: "warning", message, line };
}
function severityRank(d) {
  return d.level === "error" ? 0 : 1;
}

function findFieldById(ast, id) {
  let found = null;
  walkNodes(ast, (node) => {
    if (!found && node.type === "field" && node.id === id) found = node;
  });
  return found;
}

function validateConditionRefs(node, idCount, diagnostics) {
  const cond = node.if;
  if (!cond) return;
  const tokens = cond.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
  tokens.forEach((tok) => {
    if (["true", "false", "null", "and", "or", "not"].includes(tok)) return;
    if (idCount.has(tok)) return;
    if (new RegExp(`[\'\"]${tok}[\'\"]`).test(cond)) return;
    diagnostics.push(
      warn(`Condition references unknown field '${tok}'`, node.line)
    );
  });
}
