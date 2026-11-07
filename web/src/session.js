// Sessione nel browser: solo il token firmato e i dati da mostrare, niente altro

const KEY = "fantropico.session";
export const JOIN_CODE_FORMAT = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

// Il codice lega serve solo a riconoscere il link d'invito della propria lega
function validCode(code) {
  return typeof code === "string" && JOIN_CODE_FORMAT.test(code) ? code : null;
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data?.token !== "string" || data.token.length > 600) return null;
    if (data.role !== "admin" && data.role !== "member") return null;
    data.joinCode = validCode(data.joinCode);
    return data;
  } catch {
    return null;
  }
}

export function saveSession({ token, league, member, joinCode }) {
  const data = { token, leagueName: league.name, memberName: member.name, role: member.role, joinCode: validCode(league.joinCode ?? joinCode) };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Archiviazione non disponibile (navigazione privata): la sessione dura finché la pagina resta aperta
  }
  memory = data;
  return data;
}

export function updateToken(token) {
  const current = getSession();
  if (current) saveSession({ token, league: { name: current.leagueName }, member: { name: current.memberName, role: current.role }, joinCode: current.joinCode });
}

export function updateJoinCode(joinCode) {
  const current = getSession();
  if (current && current.joinCode !== joinCode) {
    saveSession({ token: current.token, league: { name: current.leagueName }, member: { name: current.memberName, role: current.role }, joinCode });
  }
}

// Con `token` cancella solo se la sessione salvata è ancora quella: un'altra scheda può averne già salvata una nuova
export function clearSession(token) {
  memory = null;
  try {
    if (token && loadSession()?.token !== token) return;
    localStorage.removeItem(KEY);
  } catch {
    // niente da fare
  }
}

let memory = null;

export function getSession() {
  return memory ?? (memory = loadSession());
}
