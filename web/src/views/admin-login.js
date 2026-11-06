import { api } from "../api.js";
import { errorBox, field, h } from "../dom.js";
import { saveSession } from "../session.js";
import { backBar, footer, submitting } from "./common.js";

export function renderAdminLogin(root, { navigate }) {
  const code = field({
    id: "a-code",
    label: "Codice lega",
    class: "input input--code",
    maxlength: "8",
    autocomplete: "username",
    autocapitalize: "characters",
    spellcheck: "false",
    required: true,
  });
  const password = field({ id: "a-password", label: "Password admin", type: "password", maxlength: "128", autocomplete: "current-password", required: true });
  const errors = errorBox();
  const button = h("button", { type: "submit", class: "btn" }, "Accedi");
  const run = submitting(button, errors, "Accedo...");

  const form = h(
    "form",
    {
      class: "card",
      novalidate: true,
      on: {
        submit: (event) => {
          event.preventDefault();
          run(async () => {
            const data = await api("/api/admin/login", {
              method: "POST",
              auth: false,
              body: { code: code.input.value.trim(), password: password.input.value },
            });
            password.input.value = "";
            saveSession({ ...data, joinCode: code.input.value.trim().toUpperCase() });
            navigate("admin");
          });
        },
      },
    },
    h("p", { class: "muted" }, "Usa il codice della tua lega e la password che hai scelto quando l'hai creata."),
    code.el,
    password.el,
    errors.el,
    button,
  );

  root.append(backBar("Accesso admin", null, () => navigate("")), h("main", { class: "screen" }, form, footer()));
}
