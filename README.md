# DischarGen: The Discharge Template Generator

This project provides a platform for medical professionals or health care workers to create and maintain electrical medical records in a more flexible manner.

It renders input forms from templates (discharge summaries, notes, case sheets, etc.) defined in a markup language called **Medical Case Template Markup (MCTM)**.

Templates are stored in this repository as `.mctm` files in the `templates` folder. They can be selected and loaded as per user requirement from the client-side. Templates can be either complete or partial (extending other templates or filling default values).

Read [the spec](/MCTM_SPEC.md) for more details.

## Architecture Overview

The client is a pure front‑end (no build step) structured into the following logical layers:

| Layer | Purpose |
|-------|---------|
| `js/core` | Application state container (`state.js`) & future global coordination. |
| `js/services` | Cross‑cutting runtime services (theme, future persistence, analytics). |
| `js/utils` | Small DOM & general utility helpers kept framework‑agnostic. |
| `js/mctm` | Parsing & linting for MCTM templates. |
| `js/components` | Reusable interactive widgets (Autocomplete, DataEditor). |
| Root modules (`ui_renderer`, `pdf_renderer`) | Rendering to DOM / PDF. |

### Render Flow
1. Template text -> `parseMCTMResolved` -> AST & meta.
2. `lintMCTM` produces diagnostics (console grouped, non‑blocking).
3. `renderUI` walks AST, builds sections & fields, registering field references in `state.fieldRefs`.
4. User input triggers recomputation: `reevaluateConditions` (visibility) then `evaluateComputedAll` (formula fields).
5. Export: `collectData` assembles values + optional section map; `renderPDF` builds a pdfmake doc definition.

### Key Concepts
* Field refs: Each field stores either a DOM element or an accessor object exposing a `.value` property.
* Conditions: Simple binary expressions evaluated safely (no arbitrary code execution).
* Computed fields: Evaluated within a guarded `with` scope proxy exposing only known field ids.
* Autosave: Serialized snapshot in `localStorage` keyed by `state.autosaveKey`.

## Coding Guidelines
* Prefer early returns and small helpers over deeply nested blocks.
* Group related code blocks with `// #region` / `// #endregion` for editor folding.
* Keep renderer functions pure wrt parameters (side effects only on provided `wrapper` & `state`).
* When adding a new field type: register in `FIELD_RENDERERS` and ensure a value accessor is set.
* Avoid direct DOM queries inside tight loops; capture references once when possible.

## Adding a New Field Type
1. Define a renderer `(node, wrapper, state)` that appends inputs and registers `state.fieldRefs[node.id]`.
2. Add optional validation via `applyValidation`.
3. For PDF output, extend `renderFieldNode` in `pdf_renderer.js` (or leverage `buildFieldLine`).

## Template Linting
Diagnostics are emitted to the console in a collapsed group labelled `MCTM Lint Diagnostics`. Errors should be resolved before distributing templates, but the UI will still attempt to render.

## Development / Local Testing
Because there is no bundler, ensure any new module is referenced with a relative path and `.js` extension. Keep dependencies minimal to preserve an offline‑capable workflow.

## Future Enhancements (Roadmap)
* Pluggable persistence backends (IndexedDB, FHIR server sync).
* Richer condition grammar (logical AND/OR chaining) with static analysis.
* Accessibility audits & keyboard navigation improvements.
* Test harness (Jest + happy path DOM tests) once a build pipeline is introduced.

---
Refactor (2025-10) introduced modular structure & documentation. See commit history for detailed diff.
