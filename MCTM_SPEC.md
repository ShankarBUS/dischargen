# MCTM (Medical Case Template Markup) Specification v1.0

This document defines the syntax, semantics, and validation / linting rules for MCTM templates (formerly DTM). The syntax remains compatible; only the preferred directive and naming are updated.

## 1. Goals

MCTM provides a concise, readable, text-based format to define structured clinical forms (discharge summaries, case sheets, notes) with sections and fields, plus associated metadata controlling rendering & export.

## 2. File Structure

Ordering (recommended):
1. Optional version directive: `@mctm 1.0` (preferred) or `@dtm 1.0` (legacy).
2. Metadata Block starting with a line of `---` and ending with a line of `---`.
3. Sections are defined by `#` followed by the section title.
4. Field blocks (fenced) or static markdown paragraphs inside sections or at root level.

Blank lines and comments are ignored. A comment line starts with `//`.

## 3. Metadata Block

Fence start: `---`  (no extra arguments)

Inside the fence each non-empty line MUST be a key/value pair:

```
key: value
```

Rules:
- Key: `[A-Za-z0-9_][A-Za-z0-9_.-]*`
- Value: raw string, optionally quoted with single or double quotes.
- Required keys: `template_id`, `title`, `version`.
- Recommended keys:  `logo`, `hospital`, `department`, `unit`, `pdf_header`, `pdf_footer`.

## 4. Sections

Syntax:
```
# Section Title
```
Everything until the next section heading belongs to that section.

## 5. Field Blocks

General form:
```
@<fieldType> <prop1>:<value1> <prop2>:<value2> flagProp ...
```
Body lines (between opening and closing `@`) are optional. For most field types, additional lines are parsed as more properties (concatenated & tokenized). For `static` blocks the body is preserved verbatim as `content`.

Closing: a line containing exactly `@`

### 5.1 Supported Field Types & Properties

| Type | Required Props | Common Optional Props | Notes |
|------|----------------|-----------------------|-------|
| text | id | label, placeholder, multiline, pattern, required, default, if | Text input |
| number | id | label, placeholder, min, max, pattern, required, default, if | Numeric input |
| checkbox | id | label, trueValue, falseValue, required, default, if | Boolean |
| date | id | label, required, default, if | Date string |
| select | id | label, options, source, multiple, required, default, if | `options:[A, B, C]` inline OR `source:path/to.json` |
| table | id | label, columns, required, default, if | Dynamic rows of text per column |
| list | id | label, placeholder, required, default, if | Simple repeating free-text list |
| complaints | id | label, required, default, if | Custom complaints widget |
| diagnosis | id | label, placeholder, required, default, if | ICD search UI |
| image | id | label, mode, maxSizeKB, if | Image capture/upload |
| static | (none) | (content produced from body) | Pure display block |
| computed | id, formula | label, format, if | JS expression evaluated with field ids in scope |
| hidden | id | default | Hidden field |
| comorbidities | id | label, items | Multi checkbox + details |
| personal-history | id | label | Structured grid |
| menstrual-history | id | label, if | Structured grid |
| general-exam | id | label | Exam grid |
| drug-treatment | id | label | Complex drug rows |
| investigations | id | label | Investigation list |
| opinions | id | label | Opinions table |
| followup | id | label | Follow-up table |

All field types accept conditional visibility via `if:` (expression using other field IDs, javascript-like operators, e.g. `if:patient_sex==Female`).

### 5.2 Property Syntax

Tokenization rules for the opening fence (and body lines except `static`):
- Tokens separated by whitespace unless inside single or double quotes.
- A token `key:value` becomes a property. Value may be:
  - Quoted string `'...'` or `"..."` (quotes removed)
  - Array shorthand `[a, b, c]` producing a JS array of decoded (URL-decoding) strings.
  - Empty (`key:`) -> boolean true flag.
- A lone token without `:` becomes `{ token: true }`.

### 5.3 Computed Fields
`formula:` holds a JavaScript expression evaluated with a proxy that maps identifiers to field values. Optional `format:decimal(n)` rounds numeric results.

## 6. Static Markdown Paragraphs

Any non-empty line not part of a field fence, metadata block, or section heading starts a paragraph captured as a `static` field node (content aggregated until a blank line or next special construct).

## 7. Grammar (Informal EBNF)

```
MCTM         := VersionDirective? MetaBlock SectionsOrFields*
VersionDirective := '@mctm' WS VersionNumber NL | '@dtm' WS VersionNumber NL
MetaBlock   := '---' NL MetaLine* '---' NL?
MetaLine    := Key ':' WS? Value NL
SectionsOrFields := Section | FieldBlock | Paragraph
Section     := '#' WS Title NL (FieldBlock | Paragraph)*
FieldBlock  := '@' FieldType (WS PropertyToken)* NL FieldBody? '@' NL?
FieldBody   := ( (LineNotFence NL)* )   // For static => raw, else concatenated and tokenized
Paragraph   := ParagraphLine+ NL?

FieldType   := /[a-z][a-z0-9-]*/
PropertyToken := ( Key ':' (Value | Array | /*empty*/ ) ) | Flag
Array       := '[' (Value (',' Value)*)? ']'
Flag        := Key
Key         := /[A-Za-z_][A-Za-z0-9_\.-]*/
Value       := Quoted | Unquoted
Quoted      := '"' .*? '"' | "'" .*? "'"
Unquoted    := /[^\s\]]+/
```

## 8. Validation Rules

Errors:
- Duplicate field `id`.
- Missing required metadata key.
- Unknown field type fence.
- Unclosed fence (EOF before closing @).
- `computed` without `formula`.
- `min` > `max` for numeric fields.
- Invalid array literal syntax.

Warnings:
- Section with no fields.
- Field missing `label` (except static/hidden/computed).
- Unknown property for a field type.
- Formula evaluation failure.
- Conditional expression referencing unknown field.

## 9. Lint Diagnostics Object

Each diagnostic:
```
{
  level: 'error' | 'warning',
  message: string,
  line: number   // 1-based
}
```

## 10. Versioning

Future breaking syntax changes will increment major version in `@mctm <major.minor>` directive. Parsers should default to the highest compatible version when directive is absent.

## 11. Security Considerations

`computed` formulas are evaluated with `new Function` and access to other field values only (via proxy). Avoid injecting untrusted templates unless sandboxing is applied.

## 12. Extensibility

New field types may be appended; unknown future types SHOULD trigger a linter warning but not halt parsing.
