export const state = {
  meta: {},
  ast: [],
  fieldRefs: {},
  catalogsCache: {},
  autosaveKey: "dischargen_autosave_v1",
  computed: [],
  sections: [],
  sectionOptionals: {},
  diagnostics: [],
};

export function resetStateForTemplate() {
  state.ast = [];
  state.fieldRefs = {};
  state.computed = [];
  state.sections = [];
  state.sectionOptionals = {};
  state.diagnostics = [];
}
