// Estrazione del testo del regolamento nel browser. Il file non lascia mai il dispositivo:
// al server arriva solo il testo, dopo che l'admin l'ha rivisto.

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_RULEBOOK_CHARS = 150_000;

export class ExtractError extends Error {}

function extensionOf(name) {
  const match = /\.([a-z0-9]{1,5})$/i.exec(name);
  return match ? match[1].toLowerCase() : "";
}

export async function extractText(file) {
  if (!(file instanceof File)) throw new ExtractError("Seleziona un file.");
  if (file.size === 0) throw new ExtractError("Il file è vuoto.");
  if (file.size > MAX_FILE_BYTES) throw new ExtractError("Il file è troppo grande: massimo 10 MB.");

  const ext = extensionOf(file.name);
  let text;
  try {
    if (ext === "pdf") text = await fromPdf(file);
    else if (ext === "docx") text = await fromDocx(file);
    else if (ext === "txt" || ext === "md" || ext === "markdown") text = await fromPlainText(file);
    else throw new ExtractError("Formato non supportato: usa PDF, DOCX, TXT o Markdown.");
  } catch (error) {
    if (error instanceof ExtractError) throw error;
    throw new ExtractError("Non riesco a leggere il file. Prova a esportarlo in un altro formato o incolla il testo.");
  }

  const cleaned = cleanText(text);
  if (cleaned.length === 0) throw new ExtractError("Non ho trovato testo nel file. Se è una scansione, incolla il testo a mano.");
  return cleaned;
}

// Prepara il testo per la revisione: a capo uniformi, niente caratteri di controllo, righe vuote ridotte
export function cleanText(text) {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F­‪-‮⁦-⁩﻿]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fromPlainText(file) {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // File salvati con codifiche vecchie di Windows
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

async function fromDocx(file) {
  const { default: mammoth } = await import("mammoth/mammoth.browser.js");
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}

async function fromPdf(file) {
  const [{ getDocument, GlobalWorkerOptions }, { default: workerUrl }] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  GlobalWorkerOptions.workerSrc = workerUrl;

  const task = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    useWasm: false,
    disableFontFace: true,
    isOffscreenCanvasSupported: false,
    enableXfa: false,
  });
  const pdf = await task.promise;
  try {
    const pages = [];
    let total = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      let pageText = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        pageText += item.str;
        pageText += item.hasEOL ? "\n" : " ";
      }
      pages.push(pageText);
      total += pageText.length;
      // Oltre il limite non serve continuare: l'admin dovrà accorciare comunque
      if (total > MAX_RULEBOOK_CHARS * 2) break;
    }
    return pages.join("\n\n");
  } finally {
    await pdf.destroy();
  }
}
