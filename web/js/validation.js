/* Validation utilities */

export function applyValidation(input, config) {
  input.dataset.validation = JSON.stringify(config);
  input.addEventListener("input", () => validateField(input));
  input.addEventListener("blur", () => validateField(input));
}

export function validateField(input) {
  const cfg = JSON.parse(input.dataset.validation || "{}");
  let valid = true;
  let msg = "";
  const v = input.type === "checkbox" ? input.checked : input.value.trim();

  if (cfg.required) {
    if ((input.type === "checkbox" && !input.checked) || v === "") {
      valid = false;
      msg = "Required";
    }
  }

  if (valid && cfg.min !== undefined && input.type === "number") {
    if (parseFloat(v) < parseFloat(cfg.min)) {
      valid = false;
      msg = `Min ${cfg.min}`;
    }
  }

  if (valid && cfg.max !== undefined && input.type === "number") {
    if (parseFloat(v) > parseFloat(cfg.max)) {
      valid = false;
      msg = `Max ${cfg.max}`;
    }
  }

  if (valid && cfg.pattern) {
    try {
      const r = new RegExp(cfg.pattern);
      if (!r.test(v)) {
        valid = false;
        msg = "Invalid format";
      }
    } catch (e) {
      /* ignore */
    }
  }

  setValidityPresentation(input, valid, msg);
  return valid;
}

export function validateAll(container) {
  const inputs = container.querySelectorAll("[data-validation]");
  let all = true;
  inputs.forEach((inp) => {
    if (!validateField(inp)) all = false;
  });
  return all;
}

function setValidityPresentation(input, ok, msg) {
  input.setAttribute("aria-invalid", String(!ok));
  let msgEl = input.parentElement.querySelector(".error-msg");
  if (!ok) {
    if (!msgEl) {
      msgEl = document.createElement("div");
      msgEl.className = "error-msg";
      input.parentElement.appendChild(msgEl);
    }
    msgEl.textContent = msg;
  } else if (msgEl) {
    msgEl.remove();
  }
}
