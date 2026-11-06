import { api, ApiError } from "../api.js";
import { DISCLAIMER, errorBox, field, h, icon } from "../dom.js";
import { saveSession } from "../session.js";

export function footer() {
  return h("p", { class: "footer-note" }, DISCLAIMER);
}

export function backBar(title, subtitle, onBack) {
  return h(
    "header",
    { class: "topbar topbar--back" },
    h("button", { type: "button", class: "icon-btn", "aria-label": "Indietro", on: { click: onBack } }, icon("back")),
    h("div", { class: "topbar__titles" }, h("h1", { class: "topbar__title" }, title), subtitle ? h("span", { class: "topbar__subtitle" }, subtitle) : null),
  );
}

export function messageOf(error) {
  return error instanceof ApiError ? error.message : "Si è verificato un errore. Riprova più tardi.";
}

// Gestisce lo stato di invio di un modulo: bottone disattivato, errori mostrati, nessun doppio invio
export function submitting(button, errors, busyLabel) {
  const idle = button.textContent;
  return async (task) => {
    if (button.disabled) return;
    errors.clear();
    button.disabled = true;
    if (busyLabel) button.textContent = busyLabel;
    try {
      await task();
    } catch (error) {
      errors.show(messageOf(error));
    } finally {
      button.disabled = false;
      if (busyLabel) button.textContent = idle;
    }
  };
}

export function joinForm({ navigate, code = "", title = "Entra in una lega" }) {
  const codeField = field({
    id: "join-code",
    label: "Codice lega",
    placeholder: "Es. K7M2Q9XA",
    class: "input input--code",
    value: code,
    maxlength: "8",
    autocomplete: "off",
    autocapitalize: "characters",
    spellcheck: "false",
    required: true,
  });
  const nameField = field({
    id: "join-name",
    label: "Il tuo nome",
    placeholder: "Come ti vedranno gli altri",
    maxlength: "24",
    autocomplete: "nickname",
    required: true,
  });
  const errors = errorBox();
  const button = h("button", { type: "submit", class: "btn" }, "Entra");
  const run = submitting(button, errors, "Entro...");

  const form = h(
    "form",
    {
      class: "card",
      novalidate: true,
      on: {
        submit: (event) => {
          event.preventDefault();
          run(async () => {
            const data = await api("/api/join", {
              method: "POST",
              auth: false,
              body: { code: codeField.input.value.trim(), name: nameField.input.value.trim() },
            });
            saveSession(data);
            navigate("domande");
          });
        },
      },
    },
    h("h2", { class: "card__title" }, title),
    codeField.el,
    nameField.el,
    errors.el,
    button,
  );
  return form;
}
