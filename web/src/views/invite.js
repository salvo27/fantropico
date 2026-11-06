import { h } from "../dom.js";

export function inviteLink(code) {
  return `${location.origin}/#/entra?codice=${encodeURIComponent(code)}`;
}

async function copy(text, button) {
  const idle = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copiato";
  } catch {
    button.textContent = "Copia non riuscita";
  }
  setTimeout(() => (button.textContent = idle), 2000);
}

// Codice e link d'invito, con condivisione nativa sul telefono quando c'è
export function invitePanel(code, extra = null) {
  const link = inviteLink(code);
  const codeEl = h("span", { class: "code" }, code);
  const linkEl = h("p", { class: "muted break" }, link.replace(/^https?:\/\//, ""));
  const copyButton = h("button", { type: "button", class: "btn btn--neutral", on: { click: () => copy(link, copyButton) } }, "Copia");
  const canShare = typeof navigator.share === "function";
  const shareButton = h(
    "button",
    {
      type: "button",
      class: "btn",
      on: {
        click: async () => {
          try {
            await navigator.share({ title: "Fantropico", text: "Entra nella nostra lega su Fantropico", url: link });
          } catch {
            // condivisione annullata dall'utente
          }
        },
      },
    },
    "Condividi link",
  );

  return h(
    "section",
    { class: "card card--tight" },
    h("h2", { class: "section-title" }, "Invita i partecipanti"),
    h("div", { class: "field" }, h("span", { class: "field__hint" }, "Codice lega"), codeEl),
    linkEl,
    canShare ? h("div", { class: "grid-2" }, shareButton, copyButton) : copyButton,
    extra,
  );
}
