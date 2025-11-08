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
1) Optional version directive line: `@mctm <major>.<minor>`.
2) Metadata Block delimited by lines containing only `---`.
3) Zero or more Sections: `> "Title" id:... if:... optional default:false`.
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
- `version` (integer or string)

Recommended keys:
- `title`, `hospital`, `department`, `unit`, `pdf_header`, `pdf_footer`, `logo`

Unknown metadata keys MAY be present and SHOULD be preserved by tooling.

## 6. Sections

Syntax:
```
> "Section Title" id:custom_id if:patient_sex==Female optional default:false
```

Rules:
- Extended syntax can include quoted title, optional `id:` (auto-generated from title if omitted), optional `if:` condition, and optional flags/properties `optional` and `default:false`.
- `optional` (boolean flag): When present (true), the section is user-toggleable in the UI via a checkbox. If unchecked the section body is hidden in UI and omitted from export logic that honors `_sectionOptionals` state.
- `default:false` together with `optional` makes the checkbox initially unchecked (default is checked when `optional` is true and `default:false` not provided).
- Sections only appear at the root level (not nested inside groups or other sections). Included sections nested via `@include` are flattened (their children inlined) when included inside a non-root container.
- Auto ID Generation: Title slugified to lowercase, non `[a-z0-9._-]` replaced with `_`, consecutive `_` collapsed.
- Conditions (`if:`) on sections control visibility of all contained descendants and are evaluated before optional logic; a hidden section by `if:` is not shown even if optional.

Example:
```
> "Menstrual History" if:patient_sex==Female optional
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
|------|----------|------------------------------------------------------------|-------|
| text | id | label, placeholder, multiline, pattern, required, default, if, pdf.hidden, ui.hidden | Single/multi-line text input |
| number | id | label, placeholder, min, max, pattern, required, default, unit, if, pdf.hidden, ui.hidden | Numeric input (supports unit suffix) |
| checkbox | id | label, trueValue, falseValue, required, default, if, pdf.hidden, ui.hidden | Boolean input |
| date | id | label, required, default, if, pdf.hidden, ui.hidden | Date string |
| select | id | label, placeholder, options, source, multiple, required, default, if, pdf.hidden, ui.hidden | Inline `options:[A,B,C]` or external `source:<path>` |
| table | id | label, columns, required, default, if, pdf.hidden, ui.hidden | Dynamic rows per column |
| list | id | label, placeholder, required, default, if, pdf.hidden, ui.hidden | Simple repeating free-text list |
| complaints | id | label, placeholder, suggestions, required, default, if, pdf.hidden, ui.hidden | Complaints widget |
| diagnosis | id | label, placeholder, required, default, if, pdf.hidden, ui.hidden | ICD search/entry |
| chronicdiseases | id | label, suggestions, shownegatives, required, default, if, pdf.hidden, ui.hidden | Structured chronic disease list (disease, duration, unit, treatment) |
| pastevents | id | label, suggestions, required, default, if, pdf.hidden, ui.hidden | Past medical/surgical events list |
| static | (none) | content, if, pdf.hidden, ui.hidden | Body preserved as `content` (content shown when present) |
| computed | id, formula | label, format, unit, if, pdf.hidden, ui.hidden | Expression evaluated at runtime (supports unit suffix) |
| hidden | id | default, pdf.hidden (implicit), ui.hidden | Hidden value (always omitted from PDF) |

Notes:
- Array based properties MAY be specified as `prop:[A,B,C]` (without spaces) or as a quoted array string `prop:"[A, B, C]"`. Both parse equivalently.

## 8. Include Directive (Parse-Time Expansion)

Includes allow re-use of parts (section / group / field) defined in another template.

Syntax (fenced like any field):
```
@include template:"templates/common.mctm" id:shared_section @
```

Properties:
- `template` (required): path/URL to external `.mctm` file (resolved against document base URL).
- `id` or `part`: identifier of the part (section/group/field) to import from the referenced template (the parser accepts either; `part` is an alias).

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

## 9. Overrides Block

The overrides block lets a template (or a template that includes another) modify existing field properties or defaults without redefining the field. This is applied AFTER include expansion so imported fields can be customized.

Syntax delimiters use hash-prefixed directives (line-oriented):

```
#overrides
field_id: "New default value"               // Overrides a field's default (or content for static fields)
field_id.suggestions: [A, B, C]             // Replace suggestions array
field_id.label: "Alternate Label"           // Replace simple property
field_id.pdf.hidden: true                   // Namespaced property override (pdf/ui currently supported)
another_field: """Multi-line
text value"""                               // Multi-line quoted string (closing quote ends capture)
#end
```

Rules:
1. Each non-empty line between `#overrides` and `#end` must be an assignment `target: value`.
2. `target` forms:
  - `field_id` -> sets `default` (or `content` for `static` fields).
  - `field_id.prop` -> sets direct property `prop`.
  - `field_id.ns.prop` -> sets namespaced property (currently `pdf` or `ui`).
3. Array literal: `[a, b, c]` becomes an array of strings (whitespace around commas ignored).
4. Quoted strings may span multiple lines until a matching closing quote character.
5. Overrides referencing unknown field ids emit a linter WARNING (not an error).
6. Later overrides for the same target replace earlier ones (last-wins ordering).
7. Values are not type-coerced beyond array and boolean (`true`/`false`) detection consistent with general property parsing.

Linter behavior:
- Warns on unknown field ids: `Override references unknown field 'foo'`.
- Warns if the target id resolves to a non-field node (e.g., a section/group).

Example (customizing an included complaints field):
```
#overrides
chief_complaints.suggestions: [Fever, Cough with expectoration, Wheeze]
#end
```

After parsing this will replace the `suggestions` property for the `chief_complaints` field; UI components reading that property will reflect the new list.

## 10. Groups

Groups provide structural & layout control inside sections or other groups.

Syntax:
```
{ "Group Title" id:optional_id layout:<layout> if:<expr> toggle default:false truevalue:"(+)" falsevalue:"(-)"
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
- `toggle` (flag): when present (boolean true), the group becomes user-toggleable via a checkbox rendered in the UI alongside its title. Toggling enables/disables (hides grays out) all descendant fields in the interactive UI and controls PDF/export inclusion.
  - When `toggle` is set and the group has an `id`, a synthetic boolean field reference is exposed under that `id` so `if:` conditions and computed formulas MAY reference the toggle state (checked -> true, unchecked -> false).
  - `default:false` MAY be supplied to start the toggle unchecked (default is checked when omitted). The `default` property is only meaningful when `toggle` is present.
  - `truevalue:"(+)"` and `falsevalue:"(-)"` (optional) customize how the toggle state is displayed in PDF when the group itself prints a summary line (see below). If omitted, defaults used are `(+)` when checked and `(-)` when unchecked.
  - PDF behavior: If unchecked the group emits no child content. If a `falsevalue` is provided, a single summary line of the form `Group Title: <falsevalue>` MAY appear; otherwise the entire group is omitted. When checked, the title MAY append the `truevalue` token (defaults to `(+)`).

Behavior:
- Groups can nest arbitrarily.
- Hidden (`if:` false or `pdf.hidden:true` / `ui.hidden:true`) groups hide all descendants in their respective channels.
- Layout influences both UI rendering and PDF arrangement (see §12).
- Toggle groups with missing `id` still function visually but the linter emits a WARNING because their state cannot be referenced or exported reliably.

Diagnostics:
- Unknown layout -> warning (treated as `vstack`).
- Empty group -> warning.
- Toggle group without `id` -> warning (`Toggle group should have an 'id' ...`).

## 11. Static Paragraphs

Any non-empty line not part of a field fence, metadata block, or section heading starts a paragraph captured as a `static` node. Lines are aggregated until a blank line or the next special construct.

## 12. Conditional Visibility (`if:`)

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

## 13. Computed Fields

`@computed` fields MUST provide `id` and `formula`.

- `formula:<jsExpr>` - a JavaScript expression evaluated with a proxy mapping field IDs to their values.
- `format:decimal(n)` MAY be specified to round numeric results to `n` decimal places.
- `unit:<string>` OPTIONAL: When present, the unit string is appended for display in both UI labels (parenthetical) and in PDF output after the computed value (e.g., `BMI: 24.1 kg/m^2`). The parser treats `unit:` as a simple string; no automatic conversions are performed.

Security note: See §17 regarding evaluation.

## 14. Validation and Diagnostics

Implementations SHOULD provide validation and surface diagnostics as follows.

Errors (template is considered invalid):
- Duplicate field `id`.
- Missing required metadata key (`template_id`, `version`).
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

### 14.1 Diagnostic Shape

```
{
  level: 'error' | 'warning',
  message: string,
  line: number  // 1-based
}
```

## 15. Output and Export Behavior

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
- `chronicdiseases`: each entry printed in list form as `K/C/O <Disease> × <duration> <unit> - <treatment>` (treatment part omitted if empty). If `shownegatives:true`, known chronic diseases absent from the list may produce an additional negative summary (e.g., `N/K/C/O ...`).
- `pastevents`: each entry printed prefixed with `H/O` (e.g., `H/O Surgery - Appendicectomy 2015`).
- `checkbox`: printed as `label: (+)` or `(-)` unless `trueValue`/`falseValue` provided.
- `number`/`computed`: printed as `label: value <unit>` when non-empty; when `unit` is provided it is appended after the value (e.g., `Pulse: 96 bpm`).
- `hidden`: skipped.
- `group` (vstack): children appear sequentially.
- `group` (hstack): children arranged as parallel columns (each child becomes a column stack).
- `group` (columns-N): children distributed across N columns in row-major order.
- Others: printed as `label: value` when non-empty.

Markdown support in PDF (baseline): bold `**text**`, italic `*text*`, simple unordered/ordered lists, blank-line paragraph breaks.

## 16. Grammar (EBNF)

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
// * Sections may have 'optional' flag and optional 'default:false'
// * 'part:' is accepted as an alias of 'id:' within include blocks
```

## 17. Security Considerations

Computed `formula` values MAY be evaluated using JavaScript `Function` or similar mechanisms. Implementations SHOULD:
- Restrict the evaluation context to field values only.
- Avoid evaluating untrusted templates without sandboxing.
- Consider timeouts and error handling for long-running or failing formulas.

## 18. Versioning and Extensibility

- Breaking syntax changes MUST increment the major version in the `@mctm <major.minor>` directive.
- Parsers SHOULD accept documents without a version directive by assuming the highest compatible version.
- New field types MAY be introduced; unknown types SHOULD produce a linter warning but MUST NOT halt parsing.

## 19. Appendix: Field Type & Structural Quick Reference (informative)

- text: general-purpose single/multi-line input; supports `multiline`.
- number: numeric input with optional `min`/`max`; supports `unit` suffix for display/print.
- checkbox: boolean state; `trueValue`/`falseValue` customize display.
- date: date selection/input.
- select: enumerated choice(s); `multiple` for multi-select.
- table: repeating rows; `columns` lists headers.
- list: free-text list; typically rendered as delimited string.
- complaints: complaint + duration/unit entries.
- diagnosis: ICD or free-text diagnosis entries.
- chronicdiseases: Structured chronic disease list (disease, duration, unit, treatment) with optional negatives (`shownegatives:true`).
- pastevents: Past events (event + details) list.
- static: display-only text; body preserved as-is.
- computed: expression-derived value; supports `unit` suffix for display/print; not user-editable.
- hidden: non-UI value; always omitted from PDF.
- group: structural container with layout control (vstack, hstack, columns-N); supports `toggle` with optional `default:false`, `truevalue`, `falsevalue`.
- include: (meta directive) import part from external template (removed post-parse).
