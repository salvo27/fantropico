import { api } from "../api.js";
import { errorBox, field, h } from "../dom.js";
import { saveSession } from "../session.js";
import { backBar, footer, submitting } from "./common.js";
import { invitePanel } from "./invite.js";
import { INACTIVITY_NOTICE } from "./admin.js";

export function renderCreate(root, { navigate }) {
  const leagueName = field({ id: "c-league", label: "Nome della lega", maxlength: "40", autocomplete: "off", required: true });
  const adminName = field({ id: "c-admin", label: "Il tuo nome", hint: "Sarai l'admin della lega.", maxlength: "24", autocomplete: "nickname", required: true });
  const password = field({
    id: "c-password",
    label: "Password admin",
    hint: "Almeno 12 caratteri, senza il nome della lega o il tuo nome. Ti serve per entrare come admin da un altro dispositivo.",
    type: "password",
    minlength: "12",
    maxlength: "128",
    autocomplete: "new-password",
    required: true,
  });
  const confirm = field({ id: "c-password2", label: "Ripeti la password", type: "password", maxlength: "128", autocomplete: "new-password", required: true });
  const apiKey = field({
    id: "c-key",
    label: "Chiave API Anthropic",
    hint: "La crei nella Console Anthropic. Viene salvata cifrata e non viene mai mostrata.",
    type: "password",
    maxlength: "300",
    autocomplete: "off",
    spellcheck: "false",
    required: true,
  });
  const errors = errorBox();
  const button = h("button", { type: "submit", class: "btn" }, "Crea la lega");
  const run = submitting(button, errors, "Controllo la chiave...");

  const form = h(
    "form",
    {
      class: "card",
      novalidate: true,
      on: {
        submit: (event) => {
          event.preventDefault();
          if (password.input.value !== confirm.input.value) {
            errors.show("Le due password non coincidono.");
            return;
          }
          run(async () => {
            const data = await api("/api/leagues", {
              method: "POST",
              auth: false,
              body: {
                leagueName: leagueName.input.value.trim(),
                adminName: adminName.input.value.trim(),
                adminPassword: password.input.value,
                apiKey: apiKey.input.value.trim(),
              },
            });
            // I segreti non restano nel modulo dopo l'invio
            password.input.value = "";
            confirm.input.value = "";
            apiKey.input.value = "";
            saveSession(data);
            showCreated(root, data, navigate);
          });
        },
      },
    },
    leagueName.el,
    adminName.el,
    password.el,
    confirm.el,
    apiKey.el,
    errors.el,
    button,
  );

  root.append(backBar("Crea una lega", null, () => navigate("")), h("main", { class: "screen" }, form, footer()));
}

function showCreated(root, data, navigate) {
  root.replaceChildren(
    h(
      "main",
      { class: "screen" },
      h("h1", { class: "brand__title" }, "Lega creata"),
      h("p", { class: "lead" }, "Ora carica il regolamento dal pannello admin, poi invita gli altri con il link o il codice."),
      invitePanel(data.league.joinCode),
      h("p", { class: "muted" }, INACTIVITY_NOTICE),
      h("button", { type: "button", class: "btn", on: { click: () => navigate("admin") } }, "Vai al pannello admin"),
      footer(),
    ),
  );
}
