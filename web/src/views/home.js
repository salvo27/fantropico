import { h, pitchLogo } from "../dom.js";
import { footer, joinForm } from "./common.js";

export function renderHome(root, { navigate }) {
  root.append(
    h(
      "main",
      { class: "screen screen--home" },
      h(
        "div",
        { class: "brand" },
        h("div", { class: "brand__row" }, pitchLogo(), h("h1", { class: "brand__title" }, "Fantropico")),
        h("p", { class: "lead" }, "Fai domande sul regolamento della tua lega di fantacalcio."),
      ),
      joinForm({ navigate }),
      h(
        "section",
        { class: "card card--tight" },
        h("h2", { class: "card__title" }, "Gestisci una lega"),
        h("p", { class: "muted" }, "Carichi il regolamento, inserisci la tua chiave API e inviti gli altri con un link."),
        h("button", { type: "button", class: "btn btn--outline", on: { click: () => navigate("crea") } }, "Crea una lega"),
        h("button", { type: "button", class: "link-btn", on: { click: () => navigate("accesso-admin") } }, "Accedi come admin"),
      ),
      footer(),
    ),
  );
}
