import { api } from "../api.js";
import { DISCLAIMER, errorBox, field, h } from "../dom.js";
import { backBar, submitting } from "./common.js";

// Solo link https verso fantacalcio.it: il server li filtra già, qui si ricontrolla prima di mostrarli
function trustedUrl(raw) {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const trusted = host === "fantacalcio.it" || host.endsWith(".fantacalcio.it");
    return url.protocol === "https:" && trusted && !url.username && !url.password && !url.port ? url : null;
  } catch {
    return null;
  }
}

function sourcesList(sources) {
  const items = [];
  for (const source of sources) {
    const url = trustedUrl(source.url);
    if (!url) continue;
    items.push(
      h(
        "div",
        { class: "source" },
        h("a", { class: "source__link", href: url.href, target: "_blank", rel: "noopener noreferrer" }, source.title || url.hostname),
        h("span", { class: "source__host" }, url.hostname.replace(/^www\./, "")),
      ),
    );
  }
  if (items.length === 0) return null;
  return h("div", { class: "sources" }, h("h3", { class: "sources__title" }, "Fonti"), items);
}

function opinionCard(answer) {
  return h(
    "article",
    { class: "opinion" },
    h(
      "div",
      { class: "opinion__head" },
      h("h2", { class: "opinion__label" }, "Parere indicativo"),
      h("p", { class: "opinion__text" }, answer.text),
    ),
    h(
      "div",
      { class: "opinion__body" },
      sourcesList(answer.sources),
      h("p", { class: "muted" }, `Controllo del ${answer.checkedOn}`),
      h("p", { class: "answer__note" }, answer.note),
    ),
  );
}

export function renderCheck(root, { navigate }) {
  const injured = field({ id: "v-injured", label: "Giocatore infortunato", maxlength: "40", autocomplete: "off", spellcheck: "false", required: true });
  const replacement = field({ id: "v-replacement", label: "Sostituto", maxlength: "40", autocomplete: "off", spellcheck: "false", required: true });
  const errors = errorBox();
  const button = h("button", { type: "submit", class: "btn" }, "Verifica");
  const result = h("div", { "aria-live": "polite" });
  const remaining = h("span", {});
  const run = submitting(button, errors, "Controllo su fantacalcio.it...");

  const form = h(
    "form",
    {
      class: "card card--tight",
      novalidate: true,
      on: {
        submit: (event) => {
          event.preventDefault();
          run(async () => {
            result.replaceChildren();
            try {
              const data = await api("/api/injury-checks", {
                method: "POST",
                body: { injured: injured.input.value.trim(), replacement: replacement.input.value.trim() },
              });
              result.replaceChildren(opinionCard(data.answer));
              remaining.textContent = `${data.remainingToday} domande rimaste oggi`;
            } catch (error) {
              if (error?.code === "injury_check_disabled") navigate("domande");
              throw error;
            }
          });
        },
      },
    },
    injured.el,
    replacement.el,
    errors.el,
    button,
  );

  root.append(
    backBar("Verifica sostituzione", null, () => navigate("domande")),
    h(
      "main",
      { class: "screen" },
      h("p", { class: "muted" }, "Controllo su fantacalcio.it i tempi di recupero e le quotazioni, poi applico la regola della lega. La ricerca può richiedere fino a un minuto."),
      form,
      result,
      h("p", { class: "row-between" }, h("span", {}, DISCLAIMER), remaining),
    ),
  );
}
