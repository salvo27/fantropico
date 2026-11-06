import { api } from "../api.js";
import { DISCLAIMER, h, icon } from "../dom.js";
import { clearSession, getSession } from "../session.js";
import { messageOf } from "./common.js";

const MAX_QUESTION = 600;
let outsideClick = null;

// Barra in alto con nome lega e menu, condivisa da domande e verifica
export function leagueBar({ me, navigate, current }) {
  const session = getSession();
  const menu = h("div", { class: "menu", id: "main-menu", hidden: true });
  const toggle = h("button", { type: "button", class: "icon-btn", "aria-label": "Menu", "aria-expanded": "false", "aria-controls": "main-menu" }, icon("menu"));
  const close = () => {
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  };
  toggle.addEventListener("click", () => {
    menu.hidden = !menu.hidden;
    toggle.setAttribute("aria-expanded", String(!menu.hidden));
  });
  if (outsideClick) document.removeEventListener("click", outsideClick);
  outsideClick = (event) => {
    if (!menu.hidden && !menu.contains(event.target) && !toggle.contains(event.target)) close();
  };
  document.addEventListener("click", outsideClick);

  const item = (label, action) => h("button", { type: "button", class: "menu__item", on: { click: () => (close(), action()) } }, label);
  if (current !== "domande") menu.append(item("Domande sul regolamento", () => navigate("domande")));
  if (me?.league.injuryCheckEnabled && current !== "verifica") menu.append(item("Verifica sostituzione", () => navigate("verifica")));
  if (session?.role === "admin") menu.append(item("Pannello admin", () => navigate("admin")));
  menu.append(
    item("Esci", () => {
      clearSession();
      navigate("");
    }),
  );

  return h(
    "header",
    { class: "topbar" },
    h(
      "div",
      { class: "topbar__titles" },
      h("h1", { class: "topbar__title" }, me?.league.name ?? session?.leagueName ?? "Fantropico"),
      h("span", { class: "topbar__subtitle" }, `Entrato come ${me?.member.name ?? session?.memberName ?? ""}`),
    ),
    toggle,
    menu,
  );
}

export function remainingText(remaining, limit) {
  return `Domande rimaste oggi: ${remaining} su ${limit}`;
}

function answerCard(answer) {
  const covered = answer.status === "answered";
  return h(
    "article",
    { class: "answer" },
    h("p", { class: covered ? "answer__text" : "answer__text answer__text--muted" }, answer.text),
    covered && answer.articles.length > 0 ? h("div", { class: "chips", "aria-label": "Articoli citati" }, answer.articles.map((a) => h("span", { class: "chip" }, a))) : null,
    answer.note ? h("p", { class: "answer__note" }, answer.note) : null,
  );
}

export async function renderChat(root, { navigate, isCurrent }) {
  let me;
  try {
    me = await api("/api/me");
  } catch (error) {
    if (!isCurrent()) return;
    root.append(h("main", { class: "screen" }, h("p", { class: "alert alert--error", role: "alert" }, messageOf(error))));
    return;
  }
  if (!isCurrent()) return;

  const counter = h("p", { class: "counter", "aria-live": "polite" }, remainingText(me.usage.remainingToday, me.usage.dailyLimit));
  const thread = h("section", { class: "thread", "aria-live": "polite", "aria-label": "Domande e risposte" });
  const empty = h("p", { class: "empty" }, "Scrivi una domanda sul regolamento della lega. Ti rispondo citando l'articolo.");
  thread.append(empty);

  const textarea = h("textarea", { id: "question", class: "textarea textarea--question", rows: "2", maxlength: String(MAX_QUESTION), placeholder: "Scrivi qui" });
  const length = h("span", {}, `0/${MAX_QUESTION}`);
  const send = h("button", { type: "submit", class: "btn btn--send", "aria-label": "Invia" }, icon("send"));
  const updateLength = () => (length.textContent = `${textarea.value.length}/${MAX_QUESTION}`);
  textarea.addEventListener("input", updateLength);
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) form.requestSubmit();
  });

  const form = h(
    "form",
    {
      class: "composer__row",
      novalidate: true,
      on: {
        submit: async (event) => {
          event.preventDefault();
          const question = textarea.value.trim();
          if (send.disabled || question.length < 3) return;
          send.disabled = true;
          textarea.value = "";
          updateLength();
          empty.remove();
          thread.append(h("div", { class: "bubble" }, question));
          const pending = h("article", { class: "answer" }, h("p", { class: "answer__text answer__text--muted" }, "Cerco nel regolamento..."));
          thread.append(pending);
          pending.scrollIntoView({ behavior: "smooth", block: "end" });
          try {
            const data = await api("/api/questions", { method: "POST", body: { question } });
            pending.replaceWith(answerCard(data.answer));
            counter.textContent = remainingText(data.remainingToday, me.usage.dailyLimit);
          } catch (error) {
            pending.replaceWith(h("p", { class: "alert alert--error", role: "alert" }, messageOf(error)));
            // Se la domanda non è andata, torna nel campo (salvo che nel frattempo ne sia stata scritta un'altra)
            if (textarea.value === "") {
              textarea.value = question;
              updateLength();
            }
          } finally {
            send.disabled = false;
          }
        },
      },
    },
    h("div", { class: "composer__field" }, h("label", { class: "composer__label", for: "question" }, "La tua domanda"), textarea),
    send,
  );

  const noRulebook = !me.league.hasRulebook
    ? h(
        "div",
        { class: "alert alert--info" },
        h("p", {}, "L'admin non ha ancora caricato il regolamento."),
        me.member.role === "admin" ? h("button", { type: "button", class: "link-btn", on: { click: () => navigate("admin") } }, "Caricalo ora") : null,
      )
    : null;

  root.append(
    leagueBar({ me, navigate, current: "domande" }),
    h(
      "main",
      { class: "screen" },
      counter,
      noRulebook,
      thread,
      h(
        "div",
        { class: "composer" },
        me.league.injuryCheckEnabled
          ? h("button", { type: "button", class: "btn btn--outline", on: { click: () => navigate("verifica") } }, "Verifica sostituzione infortunato")
          : null,
        form,
        h("p", { class: "row-between" }, h("span", {}, DISCLAIMER), length),
      ),
    ),
  );
}
