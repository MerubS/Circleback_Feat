/** Lowercase, unify quotes and dashes, collapse whitespace. Used to match quotes. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—-]/g, " ")
    .replace(/[^a-z0-9%'"\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Rose" matches "Rose Lindgren"; "Marcus Chen" matches "marcus chen". */
export function namesMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.split(" ")[0] === nb.split(" ")[0] && (na.startsWith(nb) || nb.startsWith(na));
}

/** Circleback's placeholder when it couldn't identify someone. */
export function isGenericSpeaker(name: string): boolean {
  return /^(participant|speaker|guest|unknown)\s*\d*$/i.test(name.trim());
}
