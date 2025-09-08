# MCTM (Medical Case Template Markup) - Specification v1.0

This document specifies the syntax, semantics, and validation rules for MCTM templates used to author structured clinical documents (e.g., discharge summaries, case sheets, notes). The specification is aligned with the current reference parser and renderer in this repository.

## 1. Purpose and Scope

- Define a human-readable, text-based format for clinical templates.
- Describe the file structure, tokens, grammar, and behavior.
- Establish validation and diagnostics expectations.
- Clarify rendering and export (PDF) inclusion behavior.

Out of scope: UI layout specifics, theming, or PDF engine details.

## 2. Document Structure at a Glance

An MCTM document consists of (in order):
1) An optional version directive line: `@mctm 1.0`.
2) A Metadata Block delimited by lines containing only `---`.
3) Zero or more Sections (lines starting with `# `).
4) Field blocks (fenced with `@ ... @`) and/or static paragraphs.

Blank lines are ignored. Comment lines start with `//` and are ignored.

## 3. Terminology

- Template: A single `.mctm` document authored using this spec.
- Field block: A fenced block starting with `@<fieldType> ...` and closing with a line containing only `@` (or inlined close on the same line).
- Static paragraph: Non-empty text not part of a field/section/metadata; preserved as display content.
- Property token: A token within a field fence of the form `key:value` or a bare flag `flagName`.

## 4. Version Directive

Syntax (optional, first line only):

`@mctm <major>.<minor>`

Parsers SHOULD record the declared version. When absent, parsers MAY assume the highest compatible version they support.

## 5. Metadata Block

Delimited by lines containing only `---`.

Inside the block, each non-empty line MUST be a `key: value` pair:

```
key: value
```

Constraints:
- Key MUST match: `[A-Za-z0-9_][A-Za-z0-9_.-]*`
- Value MAY be unquoted or quoted with single or double quotes; quotes are removed.

Required metadata keys:
- `template_id`
- `title`
- `version` (integer or string)

Recommended keys:
- `logo`, `hospital`, `department`, `unit`, `pdf_header`, `pdf_footer`

Unknown metadata keys MAY be present and SHOULD be preserved by tooling.

## 6. Sections

Section heading syntax:

`# <Section Title>`

All subsequent blocks belong to the current section until the next heading or end of file. Sections are OPTIONAL.

## 7. Field Blocks

Opening fence (general form):

`@<fieldType> <prop1>:<value1> <prop2>:<value2> <flag> ...`

Closing fence: either inline (`@... @`) or with a closing line that contains exactly `@`.

Body lines between the opening and closing fences are OPTIONAL. For `static` blocks, the body is preserved verbatim as `content`. For other field types, body text (if any) is tokenized as additional properties and merged with the opening fence properties.

### 7.1 Property Token Syntax

Within a field fence (opening and non-static body):
- Tokens are separated by whitespace unless within quotes.
- `key:value` becomes a property. The value MAY be:
  - Quoted string: `'...'` or `"..."` (quotes removed)
  - Array literal: `[a, b, c]` → parsed into an array of strings
  - Empty (`key:`) → boolean `true`
- A bare token without `:` becomes a boolean flag: `{ token: true }`.

Values MAY contain URL-encoded sequences (e.g., `%2C`); tools MAY decode them during parsing.

### 7.2 Common Field Properties

Unless otherwise noted, all field types MAY accept:
- `label:<string>` — label to display in UI/output.
- `required` — boolean flag; UI validation SHOULD enforce.
- `default:<value>` — default value for the field.
- `if:<expr>` — conditional visibility (see §9).
- `nooutput` — include in UI but omit from PDF/export (see §12).

### 7.3 Supported Field Types

The following types are recognized by this spec. Unknown types SHOULD be tolerated by tooling (emit warnings rather than errors) for forward compatibility.

| Type | Required | Common Optional | Notes |
|------|----------|------------------|-------|
| text | id | label, placeholder, multiline, pattern, required, default, if, nooutput | Single/multi-line text input |
| number | id | label, placeholder, min, max, pattern, required, default, if, nooutput | Numeric input |
| checkbox | id | label, trueValue, falseValue, required, default, if, nooutput | Boolean input |
| date | id | label, required, default, if, nooutput | Date string |
| select | id | label, options, source, multiple, required, default, if, nooutput | Inline `options:[A,B,C]` or external `source:<path>` |
| table | id | label, columns, required, default, if, nooutput | Dynamic rows per column |
| list | id | label, placeholder, required, default, if, nooutput | Simple repeating free-text list |
| complaints | id | label, required, default, if, nooutput | Complaints widget |
| diagnosis | id | label, placeholder, required, default, if, nooutput | ICD search/entry |
| image | id | label, mode, maxSizeKB, if, nooutput | Image capture/upload |
| static | (none) | if, nooutput | Body preserved as `content` |
| computed | id, formula | label, format, if, nooutput | Expression evaluated at runtime |
| hidden | id | default, nooutput | Hidden value (always omitted from PDF) |

Notes:
- `select.options` and `table.columns` MAY be specified as `options:[A,B,C]` (without spaces) or as a quoted array string `options:"[A, B, C]"`. Both parse equivalently.

## 8. Static Paragraphs


Any non-empty line not part of a field fence, metadata block, or section heading starts a paragraph captured as a `static` node. Lines are aggregated until a blank line or the next special construct.

## 9. Conditional Visibility (`if:`)

Use `if:` to conditionally include a field in the UI and output. The expression is a single binary comparison:

Supported operators: `==`, `!=`, `>`, `<`, `>=`, `<=`

Right-hand-side value types:
- Booleans: `true`, `false`
- Strings: quoted (e.g., `"Female"`) or unquoted single-token identifiers (e.g., `Female`)
- Numbers: `18`, `3.5`
- Dates: ISO-like strings (e.g., `2025-01-01`), compared chronologically

Examples:
- `if:patient_sex==Female`
- `if:has_diabetes!=true`
- `if:age>=18`
- `if:date_discharge>="2025-01-01"`

Limitations:
- Only a single comparison is supported (no logical `and`/`or`).
- For relational operators, numbers and ISO-like dates are compared numerically/chronologically; other values fall back to case-insensitive string comparison.

## 10. Computed Fields

`@computed` fields MUST provide `id` and `formula`.

- `formula:<jsExpr>` — a JavaScript expression evaluated with a proxy mapping field IDs to their values.
- `format:decimal(n)` MAY be specified to round numeric results to `n` decimal places.

Security note: See §14 regarding evaluation.

## 11. Validation and Diagnostics

Implementations SHOULD provide validation and surface diagnostics as follows.

Errors (template is considered invalid):
- Duplicate field `id`.
- Missing required metadata key (`template_id`, `title`, `version`).
- Unknown or malformed field fence (e.g., `@` without type).
- Unclosed fence (EOF before closing `@`).
- `computed` without `formula`.
- For numeric fields, `min` > `max`.
- Invalid array literal syntax.

Warnings (template MAY still render):
- Section with no fields.
- Field missing `label` (except `static`, `hidden`, `computed`).
- Unknown property for a field type.
- Formula evaluation failure.
- `if:` expression referencing an unknown field.

### 11.1 Diagnostic Shape

```
{
  level: 'error' | 'warning',
  message: string,
  line: number  // 1-based
}
```

## 12. Output and Export Behavior

This section clarifies how fields are rendered in the UI and included in the final exported PDF.

Visibility:
- `if:` conditions are evaluated at render/export time; when false, a field is hidden in both UI and PDF.
- `nooutput` flag: when present, the field is visible in the UI but omitted from the PDF. This applies to all field types, including `static`.
- `hidden` fields are always omitted from the PDF.

PDF inclusion guidelines:
- `static`: emitted as paragraphs with simple markdown (bold/italic, lists, line breaks). Use `nooutput` to suppress.
- `text` (when `multiline:true`): label printed as a heading line followed by markdown-rendered content.
- `table`: printed with column headers from `columns` and body from captured values.
- `list`: printed as a single line with items joined by `; `.
- `diagnosis`: printed as `label: description (code)` joined by `; `.
- `complaints`: printed as `complaint × duration unit` joined by `; `.
- `checkbox`: printed as `label: (+)` or `(-)` unless `trueValue`/`falseValue` provided.
- `computed`: printed as `label: value`.
- `hidden`: skipped.
- Others: printed as `label: value` when non-empty.

Markdown support in PDF (baseline): bold `**text**`, italic `*text*`, simple unordered/ordered lists, blank-line paragraph breaks.

## 13. Grammar (EBNF, informative)

```
MCTM            := VersionDirective? MetaBlock SectionsOrFields*
VersionDirective:= '@mctm' WS Version NL
MetaBlock       := '---' NL MetaLine* '---' NL?
MetaLine        := Key ':' WS? Value NL
SectionsOrFields:= Section | FieldBlock | Paragraph
Section         := '#' WS Title NL (FieldBlock | Paragraph)*
FieldBlock      := '@' FieldType (WS PropertyToken)* NL FieldBody? '@' NL?
FieldBody       := ( (LineNotFence NL)* )   // For static => raw, else concatenated and tokenized
Paragraph       := ParagraphLine+ NL?

FieldType       := /[a-z][a-z0-9-]*/
PropertyToken   := ( Key ':' (Value | Array | /*empty*/ ) ) | Flag
Array           := '[' (Value (',' Value)*)? ']'
Flag            := Key
Key             := /[A-Za-z_][A-Za-z0-9_\.-]*/
Value           := Quoted | Unquoted
Quoted          := '"' .*? '"' | "'" .*? "'"
Unquoted        := /[^\s\]]+/
```

## 14. Security Considerations

Computed `formula` values MAY be evaluated using JavaScript `Function` or similar mechanisms. Implementations SHOULD:
- Restrict the evaluation context to field values only.
- Avoid evaluating untrusted templates without sandboxing.
- Consider timeouts and error handling for long-running or failing formulas.

## 15. Versioning and Extensibility

- Breaking syntax changes MUST increment the major version in the `@mctm <major.minor>` directive.
- Parsers SHOULD accept documents without a version directive by assuming the highest compatible version.
- New field types MAY be introduced; unknown types SHOULD produce a linter warning but MUST NOT halt parsing.

## 16. Minimal Example

```
@mctm 1.0
---
template_id: discharge_base
title: "Discharge Summary"
version: 1
department: General Medicine
pdf_header: "Hospital Name — Discharge Summary"
pdf_footer: "For clinical use"
---

# Demographics
@text id:patient_name label:"Name" required @
@number id:patient_age label:"Age" min:0 max:120 @
@select id:patient_sex label:"Sex" options:[Male,Female,Other] required @

# Hospital Stay
@date id:date_admission label:"Admission Date" @
@date id:date_discharge label:"Discharge Date" @
@computed id:stay_days label:"Duration of Stay (days)" formula:"( (new Date(date_discharge) - new Date(date_admission)) / (1000*60*60*24) )" format:decimal(0) @

# Notes
@static if:patient_sex==Female
This note only shows for female patients.
@

@text id:internal_note label:"Internal Note" multiline nooutput @
```

## 17. Appendix: Field Type Quick Reference (informative)

- text: general-purpose single/multi-line input; supports `multiline`.
- number: numeric input with optional `min`/`max`.
- checkbox: boolean state; `trueValue`/`falseValue` customize display.
- date: date selection/input.
- select: enumerated choice(s); `multiple` for multi-select.
- table: repeating rows; `columns` lists headers.
- list: free-text list; typically rendered as delimited string.
- complaints: complaint + duration/unit entries.
- diagnosis: ICD or free-text diagnosis entries.
- image: image capture/upload; `mode` and `maxSizeKB` MAY constrain capture.
- static: display-only text; body preserved as-is.
- computed: expression-derived value; not user-editable.
- hidden: non-UI value; always omitted from PDF.
