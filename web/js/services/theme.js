// Theme management service
const THEME_STORAGE_KEY = "dischargen_theme_mode";

const prefersDark = window.matchMedia
  ? window.matchMedia("(prefers-color-scheme: dark)")
  : { matches: false, addEventListener: () => { } };

export function applyTheme(mode) {
  const root = document.documentElement;
  root.classList.remove("theme-dark", "theme-light");
  if (mode === "dark") root.classList.add("theme-dark");
  else if (mode === "light") root.classList.add("theme-light");
  else if (prefersDark.matches) root.classList.add("theme-dark");
}

export function initTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY) || "system";
  applyTheme(saved);
  const radios = document.querySelectorAll('input[name="themeMode"]');
  radios.forEach((r) => {
    r.checked = r.value === saved;
    r.addEventListener("change", () => {
      if (r.checked) {
        try {
          localStorage.setItem(THEME_STORAGE_KEY, r.value);
        } catch { }
        applyTheme(r.value);
      }
    });
  });
  if (prefersDark.addEventListener) {
    prefersDark.addEventListener("change", () => {
      const current = localStorage.getItem(THEME_STORAGE_KEY) || "system";
      if (current === "system") applyTheme("system");
    });
  }
}
