// Sessione nel browser: solo il token firmato e i dati da mostrare, niente altro

const KEY = "fantropico.session";

export function loadSession() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data?.token !== "string" || data.token.length > 600) return null;
    if (data.role !== "admin" && data.role !== "member") return null;
    return data;
  } catch {
    return null;
  }
}

export function saveSession({ token, league, member }) {
  const data = { token, leagueName: league.name, memberName: member.name, role: member.role };
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
  if (current) saveSession({ token, league: { name: current.leagueName }, member: { name: current.memberName, role: current.role } });
}

export function clearSession() {
  memory = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // niente da fare
  }
}

let memory = null;

export function getSession() {
  return memory ?? (memory = loadSession());
}
