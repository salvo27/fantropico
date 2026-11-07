import "./styles.css";
import { getSession } from "./session.js";
import { renderHome } from "./views/home.js";
import { renderJoin } from "./views/join.js";
import { renderCreate } from "./views/create.js";
import { renderAdminLogin } from "./views/admin-login.js";
import { renderChat } from "./views/chat.js";
import { renderCheck } from "./views/check.js";
import { renderAdmin } from "./views/admin.js";

const app = document.getElementById("app");

const ROUTES = {
  "": { view: renderHome, guest: true },
  entra: { view: renderJoin, guest: true },
  crea: { view: renderCreate, guest: true },
  "accesso-admin": { view: renderAdminLogin, guest: true },
  domande: { view: renderChat, auth: true },
  verifica: { view: renderCheck, auth: true },
  admin: { view: renderAdmin, auth: true, admin: true },
};

// Hash del tipo #/entra?codice=XXXX: il codice resta nel browser e non arriva ai log del server
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?", 2);
  return { path: path ?? "", params: new URLSearchParams(query) };
}

export function navigate(path) {
  const target = `#/${path}`;
  if (location.hash === target) render();
  else location.hash = target;
}

let renderToken = 0;
let pendingInvite = null;

function render() {
  const { path, params } = parseHash();
  const route = ROUTES[path] ?? ROUTES[""];
  const session = getSession();
  // Il codice dell'invito serve solo al controllo della sessione subito dopo il reindirizzamento
  if (path !== "domande") pendingInvite = null;

  if (route.auth && !session) return navigate("");
  if (route.admin && session?.role !== "admin") return navigate("domande");
  if (route.guest && session && path !== "accesso-admin" && path !== "entra") return navigate("domande");
  // Link d'invito della lega in cui si è già dentro: se poi la sessione risulta revocata, si torna al modulo con il codice
  if (path === "entra" && session?.joinCode && (params.get("codice") ?? "").trim().toUpperCase() === session.joinCode) {
    pendingInvite = session.joinCode;
    return navigate("domande");
  }

  const token = ++renderToken;
  const isCurrent = () => token === renderToken;
  app.replaceChildren();
  window.scrollTo(0, 0);
  route.view(app, { params, navigate, isCurrent });
}

window.addEventListener("hashchange", render);
window.addEventListener("fantropico:session-ok", () => (pendingInvite = null));
window.addEventListener("fantropico:logout", () => {
  const code = pendingInvite;
  pendingInvite = null;
  navigate(code ? `entra?codice=${code}` : "");
});
render();
