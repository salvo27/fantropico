import { h } from "../dom.js";
import { getSession, JOIN_CODE_FORMAT } from "../session.js";
import { backBar, footer, joinForm } from "./common.js";

// Chi è già dentro una lega e apre un altro link d'invito
function alreadyIn(session, navigate) {
  return h(
    "div",
    { class: "alert alert--info" },
    h("p", {}, `Sei già entrato in ${session.leagueName} come ${session.memberName}.`),
    h("button", { type: "button", class: "btn", on: { click: () => navigate("domande") } }, "Vai alle domande"),
    h("p", { class: "muted small" }, "Se entri in un'altra lega con il modulo qui sotto, su questo dispositivo esci da questa."),
  );
}

// Pagina del link d'invito: il codice arriva già compilato se ha il formato giusto
export function renderJoin(root, { params, navigate }) {
  const raw = (params.get("codice") ?? "").trim().toUpperCase();
  const code = JOIN_CODE_FORMAT.test(raw) ? raw : "";
  const session = getSession();
  root.append(
    backBar("Entra in una lega", null, () => navigate("")),
    h(
      "main",
      { class: "screen" },
      session ? alreadyIn(session, navigate) : null,
      !session && code ? h("p", { class: "alert alert--info" }, "Ti hanno invitato in una lega. Scegli il nome con cui ti vedranno gli altri.") : null,
      joinForm({ navigate, code, title: session ? "Entra in un'altra lega" : code ? "Scegli il tuo nome" : "Entra in una lega" }),
      footer(),
    ),
  );
  if (code && !session) document.getElementById("join-name")?.focus();
}
