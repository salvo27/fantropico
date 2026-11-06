import { h } from "../dom.js";
import { backBar, footer, joinForm } from "./common.js";

const CODE_FORMAT = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

// Pagina del link d'invito: il codice arriva già compilato se ha il formato giusto
export function renderJoin(root, { params, navigate }) {
  const raw = (params.get("codice") ?? "").trim().toUpperCase();
  const code = CODE_FORMAT.test(raw) ? raw : "";
  root.append(
    backBar("Entra in una lega", null, () => navigate("")),
    h(
      "main",
      { class: "screen" },
      code ? h("p", { class: "alert alert--info" }, "Ti hanno invitato in una lega. Scegli il nome con cui ti vedranno gli altri.") : null,
      joinForm({ navigate, code, title: code ? "Scegli il tuo nome" : "Entra in una lega" }),
      footer(),
    ),
  );
  if (code) document.getElementById("join-name")?.focus();
}
