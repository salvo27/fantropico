// Lettura dei secret del Worker: se mancano o sono deboli il Worker si ferma (fail closed)

export class ConfigError extends Error {
  constructor(readonly setting: string) {
    super(`Invalid configuration: ${setting}`);
    this.name = "ConfigError";
  }
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function decodeBase64Secret(raw: unknown, setting: string, minBytes: number): Uint8Array<ArrayBuffer> {
  if (typeof raw !== "string" || raw.length > 1024) throw new ConfigError(setting);
  const value = raw.trim();
  if (!BASE64.test(value) || value.length % 4 !== 0) throw new ConfigError(setting);
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  if (bytes.length < minBytes) throw new ConfigError(setting);
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> | null {
  if (!BASE64.test(value) || value.length % 4 !== 0) return null;
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
