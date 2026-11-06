import { api } from "../api.js";
import { DISCLAIMER, errorBox, field, formatDate, formatNumber, h } from "../dom.js";
import { extractText, ExtractError, MAX_RULEBOOK_CHARS } from "../extract.js";
import { updateJoinCode, updateToken } from "../session.js";
import { backBar, messageOf, submitting } from "./common.js";
import { invitePanel } from "./invite.js";

const RULEBOOK_MIN = 200;
export const INACTIVITY_NOTICE = "Se nessuno usa la lega per 60 giorni, viene cancellata con tutti i suoi dati.";

function status() {
  const el = h("p", { class: "muted", role: "status", hidden: true });
  return {
    el,
    show(text) {
      el.textContent = text;
      el.hidden = false;
    },
    clear() {
      el.hidden = true;
    },
  };
}

function rulebookMeta(rulebook) {
  if (!rulebook) return "Non ancora caricato.";
  return `Versione ${rulebook.version}, aggiornato il ${formatDate(rulebook.updatedAt)}`;
}

function rulebookSection(overview) {
  const meta = h("p", { class: "muted" }, rulebookMeta(overview.rulebook));
  const fileInput = h("input", { type: "file", id: "rb-file", class: "file-input", accept: ".pdf,.docx,.txt,.md,.markdown,application/pdf,text/plain,text/markdown" });
  const pick = h("button", { type: "button", class: "btn btn--outline", on: { click: () => fileInput.click() } }, "Carica file (PDF, DOCX, TXT, MD)");
  const textarea = h("textarea", { id: "rb-text", class: "textarea", rows: "10", placeholder: "Carica un file o incolla qui il testo del regolamento." });
  const count = h("span", { class: "small muted" });
  const errors = errorBox();
  const saved = status();
  const save = h("button", { type: "button", class: "btn" }, "Salva regolamento");

  const updateCount = () => {
    const n = textarea.value.trim().length;
    count.textContent = `${formatNumber(n)} caratteri su ${formatNumber(MAX_RULEBOOK_CHARS)}`;
  };
  textarea.addEventListener("input", () => {
    updateCount();
    saved.clear();
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    errors.clear();
    saved.clear();
    pick.disabled = true;
    pick.textContent = "Leggo il file...";
    try {
      textarea.value = await extractText(file);
      updateCount();
      saved.show("Testo estratto. Controllalo e correggilo prima di salvare.");
      textarea.focus();
    } catch (error) {
      errors.show(error instanceof ExtractError ? error.message : "Non riesco a leggere il file.");
    } finally {
      pick.disabled = false;
      pick.textContent = "Carica file (PDF, DOCX, TXT, MD)";
    }
  });

  const run = submitting(save, errors, "Salvo...");
  save.addEventListener("click", () => {
    const text = textarea.value.trim();
    if (text.length < RULEBOOK_MIN) return errors.show("Il regolamento è troppo corto: servono almeno 200 caratteri.");
    if (text.length > MAX_RULEBOOK_CHARS) return errors.show("Il regolamento è troppo lungo: massimo 150.000 caratteri. Togli le parti che non servono.");
    run(async () => {
      const { version } = await api("/api/admin/rulebook", { method: "PUT", body: { text } });
      meta.textContent = rulebookMeta({ version, updatedAt: new Date().toISOString() });
      saved.show("Regolamento salvato.");
    });
  });

  // Il testo attuale si scarica solo quando serve, non con la panoramica
  if (overview.rulebook) {
    textarea.placeholder = "Carico il testo attuale...";
    api("/api/admin/rulebook")
      .then((data) => {
        if (typeof data.text === "string" && textarea.value === "") textarea.value = data.text;
        textarea.placeholder = "Carica un file o incolla qui il testo del regolamento.";
        updateCount();
      })
      .catch((error) => errors.show(messageOf(error)));
  }
  updateCount();

  return h(
    "section",
    { class: "card card--tight" },
    h("h2", { class: "section-title" }, "Regolamento"),
    meta,
    pick,
    fileInput,
    h("label", { class: "field__label", for: "rb-text" }, "Testo del regolamento, controllalo prima di salvare"),
    textarea,
    h("div", { class: "row-between" }, h("span", {}), count),
    errors.el,
    saved.el,
    save,
  );
}

function inviteSection(overview) {
  let code = overview.league.joinCode;
  const holder = h("div", {});
  const errors = errorBox();
  const regenerate = async (askFirst = true) => {
    if (askFirst && !confirm("Rigenerare il codice? Il vecchio codice e il vecchio link smetteranno di funzionare. Chi è già nella lega resta dentro.")) return;
    errors.clear();
    try {
      ({ joinCode: code } = await api("/api/admin/join-code", { method: "POST" }));
      updateJoinCode(code);
      draw();
    } catch (error) {
      errors.show(messageOf(error));
    }
  };
  const draw = () => {
    holder.replaceChildren(
      invitePanel(code, h("div", { class: "field" }, errors.el, h("button", { type: "button", class: "btn btn--danger-text", on: { click: () => regenerate() } }, "Rigenera codice"))),
    );
  };
  draw();
  return { el: holder, regenerate };
}

function membersSection(overview, invite) {
  const list = h("div", { class: "member-list" });
  const title = h("h2", { class: "section-title" });
  const errors = errorBox();
  let members = overview.members;

  const draw = () => {
    title.textContent = `Membri (${members.length})`;
    list.replaceChildren(
      ...members.map((member) =>
        h(
          "div",
          { class: "member" },
          h(
            "div",
            {},
            h("span", {}, member.name),
            h("p", { class: "muted small" }, `Domande: ${formatNumber(member.questionsToday)} oggi, ${formatNumber(member.questionsThisMonth)} questo mese`),
          ),
          member.role === "admin"
            ? h("span", { class: "muted" }, "admin")
            : h("button", { type: "button", class: "btn btn--danger-text", "aria-label": `Rimuovi ${member.name}`, on: { click: () => remove(member) } }, "Rimuovi"),
        ),
      ),
    );
  };

  const remove = async (member) => {
    if (!confirm(`Rimuovere ${member.name} dalla lega? Perderà subito l'accesso.`)) return;
    errors.clear();
    try {
      await api(`/api/admin/members/${encodeURIComponent(member.id)}`, { method: "DELETE" });
      members = members.filter((m) => m.id !== member.id);
      draw();
      if (confirm("Vuoi rigenerare anche il codice lega? Così chi è stato rimosso non può rientrare con un altro nome.")) {
        await invite.regenerate(false);
      }
    } catch (error) {
      errors.show(messageOf(error));
    }
  };

  draw();
  return h("section", { class: "card card--tight" }, title, errors.el, list);
}

function settingsSection(overview) {
  let limit = overview.league.dailyLimit;
  let injury = overview.league.injuryCheckEnabled;
  const errors = errorBox();
  const saved = status();
  const input = h("input", { id: "set-limit", class: "stepper__input", type: "number", inputmode: "numeric", min: "1", max: "100", value: String(limit) });
  const switchBtn = h(
    "button",
    { type: "button", class: "switch", role: "switch", "aria-checked": String(injury), "aria-labelledby": "set-injury" },
    h("span", { class: "switch__knob" }),
  );

  const patch = async (body) => {
    errors.clear();
    saved.clear();
    const data = await api("/api/admin/settings", { method: "PATCH", body });
    limit = data.dailyLimit;
    injury = data.injuryCheckEnabled;
    input.value = String(limit);
    switchBtn.setAttribute("aria-checked", String(injury));
    saved.show("Impostazioni salvate.");
  };

  let timer = null;
  const scheduleLimit = (value) => {
    input.value = String(value);
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const next = Number(input.value);
      if (!Number.isInteger(next) || next < 1 || next > 100) {
        errors.show("Il limite deve essere un numero intero da 1 a 100.");
        input.value = String(limit);
        return;
      }
      if (next === limit) return;
      try {
        await patch({ dailyLimit: next });
      } catch (error) {
        input.value = String(limit);
        errors.show(messageOf(error));
      }
    }, 600);
  };
  const step = (delta) => scheduleLimit(Math.min(100, Math.max(1, (Number(input.value) || limit) + delta)));
  input.addEventListener("change", () => scheduleLimit(input.value));

  switchBtn.addEventListener("click", async () => {
    switchBtn.disabled = true;
    try {
      await patch({ injuryCheckEnabled: !injury });
    } catch (error) {
      errors.show(messageOf(error));
    } finally {
      switchBtn.disabled = false;
    }
  });

  return h(
    "section",
    { class: "card card--tight" },
    h("h2", { class: "section-title" }, "Impostazioni"),
    h(
      "div",
      { class: "setting" },
      h("label", { for: "set-limit" }, "Domande al giorno per persona"),
      h(
        "div",
        { class: "stepper" },
        h("button", { type: "button", class: "stepper__btn", "aria-label": "Diminuisci", on: { click: () => step(-1) } }, "−"),
        input,
        h("button", { type: "button", class: "stepper__btn", "aria-label": "Aumenta", on: { click: () => step(1) } }, "+"),
      ),
    ),
    h(
      "div",
      { class: "setting" },
      h("div", {}, h("span", { id: "set-injury" }, "Verifica infortuni"), h("p", { class: "muted small" }, "Ricerca su fantacalcio.it, costa di più di una domanda normale.")),
      switchBtn,
    ),
    errors.el,
    saved.el,
  );
}

function keySection(overview) {
  const info = h("p", { class: "muted" }, `Impostata il ${formatDate(overview.apiKeyUpdatedAt)}. Non viene mai mostrata.`);
  const area = h("div", { class: "field" });

  const keyForm = () => {
    const key = field({ id: "k-new", label: "Nuova chiave API", type: "password", maxlength: "300", autocomplete: "off", spellcheck: "false" });
    const errors = errorBox();
    const button = h("button", { type: "submit", class: "btn" }, "Salva chiave");
    const run = submitting(button, errors, "Controllo la chiave...");
    return h(
      "form",
      {
        class: "field",
        novalidate: true,
        on: {
          submit: (event) => {
            event.preventDefault();
            run(async () => {
              const { apiKeyUpdatedAt } = await api("/api/admin/api-key", { method: "PUT", body: { apiKey: key.input.value.trim() } });
              key.input.value = "";
              info.textContent = `Impostata il ${formatDate(apiKeyUpdatedAt)}. Non viene mai mostrata.`;
              area.replaceChildren(h("p", { class: "alert alert--info", role: "status" }, "Chiave aggiornata."));
            });
          },
        },
      },
      key.el,
      errors.el,
      button,
    );
  };

  const passwordForm = () => {
    const current = field({ id: "p-current", label: "Password attuale", type: "password", maxlength: "128", autocomplete: "current-password" });
    const next = field({ id: "p-new", label: "Nuova password", hint: "Almeno 12 caratteri.", type: "password", maxlength: "128", autocomplete: "new-password" });
    const again = field({ id: "p-again", label: "Ripeti la nuova password", type: "password", maxlength: "128", autocomplete: "new-password" });
    const errors = errorBox();
    const button = h("button", { type: "submit", class: "btn" }, "Cambia password");
    const run = submitting(button, errors, "Salvo...");
    return h(
      "form",
      {
        class: "field",
        novalidate: true,
        on: {
          submit: (event) => {
            event.preventDefault();
            if (next.input.value !== again.input.value) return errors.show("Le due password non coincidono.");
            run(async () => {
              const { token } = await api("/api/admin/password", {
                method: "PUT",
                body: { currentPassword: current.input.value, newPassword: next.input.value },
              });
              updateToken(token);
              area.replaceChildren(h("p", { class: "alert alert--info", role: "status" }, "Password cambiata. Le altre sessioni admin sono state chiuse."));
            });
          },
        },
      },
      current.el,
      next.el,
      again.el,
      errors.el,
      button,
    );
  };

  return h(
    "section",
    { class: "card card--tight" },
    h("h2", { class: "section-title" }, "Chiave API Anthropic"),
    info,
    h("button", { type: "button", class: "btn btn--neutral", on: { click: () => area.replaceChildren(keyForm()) } }, "Sostituisci chiave"),
    h("button", { type: "button", class: "btn btn--neutral", on: { click: () => area.replaceChildren(passwordForm()) } }, "Cambia password admin"),
    area,
  );
}

export async function renderAdmin(root, { navigate, isCurrent }) {
  let overview;
  try {
    overview = await api("/api/admin/league");
  } catch (error) {
    if (!isCurrent()) return;
    root.append(backBar("Pannello admin", null, () => navigate("domande")), h("main", { class: "screen" }, h("p", { class: "alert alert--error", role: "alert" }, messageOf(error))));
    return;
  }
  if (!isCurrent()) return;
  updateJoinCode(overview.league.joinCode);

  const invite = inviteSection(overview);
  root.append(
    backBar("Pannello admin", overview.league.name, () => navigate("domande")),
    h(
      "main",
      { class: "screen" },
      h("section", { class: "stat" }, h("h2", { class: "stat__label" }, "Domande questo mese"), h("span", { class: "stat__value" }, formatNumber(overview.monthlyQuestions))),
      h("p", { class: "muted" }, INACTIVITY_NOTICE),
      rulebookSection(overview),
      invite.el,
      membersSection(overview, invite),
      settingsSection(overview),
      keySection(overview),
      h("p", { class: "footer-note" }, DISCLAIMER),
    ),
  );
}
