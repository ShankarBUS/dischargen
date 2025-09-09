# MCTM (Medical Case Template Markup) - Specification v1.1

This document specifies the syntax, semantics, and validation rules for MCTM templates used to author structured clinical documents (e.g., discharge summaries, case sheets, notes). The specification is aligned with the current reference parser and renderer in this repository.

## 1. Purpose and Scope

- Define a human-readable, text-based format for clinical templates.
- Describe the file structure, tokens, grammar, and behavior.
- Establish validation and diagnostics expectations.
- Clarify rendering and export (PDF) inclusion behavior.

Out of scope: UI layout specifics, theming, or PDF engine details.

## 2. Document Structure at a Glance

An MCTM document consists of (in order):
1) Optional version directive line: `@mctm <major>.<minor>`.
2) Metadata Block delimited by lines containing only `---`.
3) Zero or more Sections: `> "Title" id:... if:...`.
4) Within sections (or at root if no sections): Groups ( `{ "Group Title" ... }` ), Field blocks (`@...` fences), nested groups, and/or static paragraphs.
5) Optional include directives resolved at parse-time via `@include template:"path/to.tpl.mctm" id:part_id @`.

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

Syntax:
```
> "Section Title" id:custom_id if:patient_sex==Female
```

Rules:
- Extended syntax can include quoted title, optional `id:` (auto-generated from title if omitted), and optional `if:` condition.
- Sections only appear at the root level (not nested inside groups or other sections).
- Auto ID Generation: Title slugified to lowercase, non `[a-z0-9._-]` replaced with `_`, consecutive `_` collapsed.
- Conditions (`if:`) on sections control visibility of all contained descendants.

Example:
```
> "Menstrual History" if:patient_sex==Female
```

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
  - Array literal: `[a, b, c]` is parsed into an array of strings
  - Empty (`key:`) becomes a boolean flag: `{ key: true }`
- A bare token without `:` becomes a boolean flag: `{ token: true }`.

Values MAY contain URL-encoded sequences (e.g., `%2C`); tools MAY decode them during parsing.

### 7.2 Common Field & Container Properties

Unified channel-scoped visibility flags use namespaced object-style properties via dot notation (parser folds `pdf.hidden:true` into `{ pdf: { hidden: true } }`):

- `label:<string>` - label to display in UI/output.
- `required` - boolean flag; UI validation SHOULD enforce.
- `default:<value>` - default value for the field.
- `if:<expr>` - conditional visibility (see §9).
- `pdf.hidden:true` - omit this node (and for containers, its descendants) from PDF/export while still showing it in UI (unless also `ui.hidden:true`).
- `ui.hidden:true` - hide this node in the interactive UI while still allowing it to appear in PDF/export (unless also `pdf.hidden:true`).

Containers (sections, groups) accept the same flags; descendant inheritance for `pdf.hidden:true` is structural (a hidden container removes all children from export). `ui.hidden:true` likewise hides all descendant UI.

### 7.3 Supported Field Types

The following types are recognized by this spec. Unknown types SHOULD be tolerated by tooling (emit warnings rather than errors) for forward compatibility.

| Type | Required | Common Optional | Notes |
|------|----------|------------------|-------|
| text | id | label, placeholder, multiline, pattern, required, default, if, pdf.hidden, ui.hidden | Single/multi-line text input |
| number | id | label, placeholder, min, max, pattern, required, default, if, pdf.hidden, ui.hidden | Numeric input |
| checkbox | id | label, trueValue, falseValue, required, default, if, pdf.hidden, ui.hidden | Boolean input |
| date | id | label, required, default, if, pdf.hidden, ui.hidden | Date string |
| select | id | label, options, source, multiple, required, default, if, pdf.hidden, ui.hidden | Inline `options:[A,B,C]` or external `source:<path>` |
| table | id | label, columns, required, default, if, pdf.hidden, ui.hidden | Dynamic rows per column |
| list | id | label, placeholder, required, default, if, pdf.hidden, ui.hidden | Simple repeating free-text list |
| complaints | id | label, required, default, if, pdf.hidden, ui.hidden | Complaints widget |
| diagnosis | id | label, placeholder, required, default, if, pdf.hidden, ui.hidden | ICD search/entry |
| image | id | label, mode, maxSizeKB, if, pdf.hidden, ui.hidden | Image capture/upload |
| static | (none) | if, pdf.hidden, ui.hidden | Body preserved as `content` |
| computed | id, formula | label, format, if, pdf.hidden, ui.hidden | Expression evaluated at runtime |
| hidden | id | default, pdf.hidden (implicit), ui.hidden | Hidden value (always omitted from PDF) |

### 7.4 Include Directive (Parse-Time Expansion)

Includes allow re-use of parts (section / group / field) defined in another template.

Syntax (fenced like any field):
```
@include template:"templates/common.mctm" id:shared_section @
```

Properties:
- `template` (required): path/URL to external `.mctm` file (resolved against document base URL).
- `id`: identifier of the part (section/group/field) to import from the referenced template.

Expansion Rules:
- Resolved during parse (not at render) – resulting AST has no `include` nodes.
- If the referenced part is a `section` and the include occurs inside another structure (non-root context), the section *children* are inlined (no nested section wrapper) to avoid illegal nested sections.
- Nested includes inside imported content are expanded recursively.
- Cycle Detection: If expansion re-enters the same `(template, part)` pair already on the active stack, the include is skipped and a cycle diagnostic is reported.
- Depth Limit: Default maximum include depth = 64 (configurable) – exceeding it aborts the include with a diagnostic.

Diagnostics:
- Missing `template` or `id` -> error (include removed).
- Part not found -> error (include removed).
- Cycle detected or depth exceeded -> error (include removed).

Identifiers within included parts are NOT auto-namespaced; collisions manifest as duplicate ID errors/warnings in subsequent linting.

Example group re-use:
```
@include template:"templates/vitals.mctm" id:vitals_group @
```

### 7.5 Groups

Groups provide structural & layout control inside sections or other groups.

Syntax:
```
{ "Group Title" id:optional_id layout:<layout> if:<expr>
  @text id:bp label:"Blood Pressure" @
  { "Nested" layout:hstack
    @number id:pulse label:"Pulse" @
    @number id:rr label:"Resp Rate" @
  }
}
```

Properties:
- `id:` optional (auto from title if omitted)
- `layout:` one of:
  - `vstack` (default) vertical stacking
  - `hstack` horizontal columns (one per child)
  - `columns-N` grid with N columns (e.g., `columns-2`, `columns-3`, ...)
- `if:` conditional visibility (same semantics as for fields/sections)

Behavior:
- Groups can nest arbitrarily.
- Hidden groups hide all descendants.
- Layout influences both UI rendering and PDF arrangement (see §12).

Diagnostics:
- Unknown layout -> warning (treated as `vstack`).
- Empty group -> warning.

Notes:
- `select.options` and `table.columns` MAY be specified as `options:[A,B,C]` (without spaces) or as a quoted array string `options:"[A, B, C]"`. Both parse equivalently.

## 8. Static Paragraphs


Any non-empty line not part of a field fence, metadata block, or section heading starts a paragraph captured as a `static` node. Lines are aggregated until a blank line or the next special construct.

## 9. Conditional Visibility (`if:`)

Use `if:` to conditionally include a section, group, or field. The expression is a single binary comparison:

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

- `formula:<jsExpr>` - a JavaScript expression evaluated with a proxy mapping field IDs to their values.
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
- `if:` condition false -> node excluded from both channels.
- `pdf.hidden:true` -> suppress from PDF/export (containers remove subtree from export).
- `ui.hidden:true` -> hide in UI (containers hide subtree in UI) but still available for export unless also `pdf.hidden:true`.
- `hidden` field type -> always omitted from PDF regardless of flags; treated like having `pdf.hidden:true`.

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
- `group` (vstack): children appear sequentially.
- `group` (hstack): children arranged as parallel columns (each child becomes a column stack).
- `group` (columns-N): children distributed across N columns in row-major order.
- Others: printed as `label: value` when non-empty.

Markdown support in PDF (baseline): bold `**text**`, italic `*text*`, simple unordered/ordered lists, blank-line paragraph breaks.

## 13. Grammar (EBNF, informative, updated v1.1 additions marked *)

```
MCTM              := VersionDirective? MetaBlock Node*
VersionDirective  := '@mctm' WS Version NL
MetaBlock         := '---' NL MetaLine* '---' NL?
MetaLine          := Key ':' WS? Value NL
Node              := Section | Group | FieldBlock | Paragraph

Section           := '>' WS SectionHeader NL Node*
SectionHeader     := QuotedTitle (WS PropToken)*
Group             := '{' WS GroupHeader NL? Node* '}'
GroupHeader       := QuotedTitle? (WS PropToken)*
FieldBlock        := '@' FieldType (WS PropToken)* ( InlineBodyClose | NL FieldBody '@' )
FieldBody         := (LineNotFence NL)*
Paragraph         := ParagraphLine+ NL?

QuotedTitle       := '"' .*? '"' | "'" .*? "'"
FieldType         := /[a-z][a-z0-9-]*/
PropToken         := Key ':' (Value | Array | /*empty*/ ) | Flag
Array             := '[' (Value (',' Value)*)? ']'
Flag              := Key
Key               := /[A-Za-z_][A-Za-z0-9_\.-]*/
Value             := Quoted | Unquoted
Quoted            := '"' .*? '"' | "'" .*? "'"
Unquoted          := /[^\s\]]+/

// * Include is syntactically a FieldBlock with FieldType 'include'
// * Layout options appear as PropToken: layout:vstack|hstack|columns-N
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

## 16. Minimal Example (v1.1 features)

```
@mctm 1.0
---
template_id: discharge_base
title: "Discharge Summary"
version: 1
department: General Medicine
pdf_header: "Hospital Name - Discharge Summary"
pdf_footer: "For clinical use"
---

> "Demographics"
@text id:patient_name label:"Name" required @
@number id:patient_age label:"Age" min:0 max:120 @
@select id:patient_sex label:"Sex" options:[Male,Female,Other] required @

> "Vitals & Stay"
{ "Vitals" id:vitals layout:columns-2
  @number id:pulse label:"Pulse (/min)" @
  @text id:bp label:"BP (mmHg)" @
  @number id:rr label:"Resp Rate" @
}
@date id:date_admission label:"Admission Date" @
@date id:date_discharge label:"Discharge Date" @
@computed id:stay_days label:"Duration of Stay (days)" formula:"((new Date(date_discharge)-new Date(date_admission))/(1000*60*60*24))" format:decimal(0) @

> "Menstrual History" if:patient_sex==Female
@static
Applies only to female patients.
@

@text id:internal_note label:"Internal Note" multiline pdf.hidden:true @

@include template:"templates/common.mctm" id:discharge_advice @
```

## 17. Appendix: Field Type & Structural Quick Reference (informative)

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
- group: structural container with layout control (vstack, hstack, columns-N).
- include: (meta directive) import part from external template (removed post-parse).
