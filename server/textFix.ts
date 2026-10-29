/** Normaliza e corrige texto corrompido (mojibake / replacement char). */

const REPL = "\uFFFD";

export function foldKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function repairLatin1(s: string): string {
  if (!/Ã.|Â./.test(s)) return s;
  try {
    const bytes = Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
    const decoded = new TextDecoder("utf-8").decode(bytes);
    if (decoded && !decoded.includes(REPL) && decoded.length <= s.length + 2) return decoded;
  } catch {
    /* keep */
  }
  return s;
}

/** Corrige padrões comuns UTF-8 quebrado / �. */
export function repairMojibake(raw: string): string {
  if (!raw) return raw;
  let s = repairLatin1(raw);

  // Qualquer char entre "funcion" e "rio" / "Ecommt" e "bil" (inclui � e ?).
  s = s.replace(/funcion.rio/gi, "funcionário");
  s = s.replace(/Ecommt.bil/gi, "Ecommtábil");
  s = s.replace(/Ecommt\?bil/gi, "Ecommtábil");
  s = s.replace(/rela..o comercial/gi, "relação comercial");
  if (s.includes(REPL)) s = s.replaceAll(REPL, "");
  return s;
}

export function preferCanonicalOrgName(names: string[]): string {
  const repaired = names.map(repairMojibake);
  if (repaired.some((n) => foldKey(n) === "ecommtabil")) return "Ecommtábil";
  return repaired.find((n) => n.trim()) || names[0] || "Empresa";
}
