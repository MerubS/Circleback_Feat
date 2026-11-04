/**
 * Lowercase, unify quotes, drop punctuation, collapse whitespace. Used to match quotes.
 * Keeps letters, accents and digits from every script (Unicode classes), not just a-z.
 */
export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[^\p{L}\p{M}\p{N}'%\s]/gu, " ")
    .replace(/(^|\s)'+|'+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Scripts written without spaces between words, where one "word" can be a whole sentence. */
const NO_SPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/**
 * Long enough to prove something: two or more words, or 4+ characters in a script without spaces.
 * A one-word fragment ("yeah", "ok") of a longer line could come from anywhere.
 */
export function isSubstantial(normalized: string): boolean {
  if (!normalized) return false;
  if (normalized.split(" ").length >= 2) return true;
  return NO_SPACES.test(normalized) && [...normalized].length >= 4;
}

/** Normalized quote appears in the normalized line on word boundaries ("ill fix" can't match inside "will fixate"). */
export function containsQuote(line: string, quote: string): boolean {
  if (!quote) return false;
  if (` ${line} `.includes(` ${quote} `)) return true;
  return NO_SPACES.test(quote) && line.includes(quote);
}

/**
 * How much of a quote appears in a line when it isn't word for word (0 to 1):
 * the share of the quote's words found in the best window of the line the same length.
 * shortcut: word-based, so scripts without spaces score 0 here (exact matching still works for them).
 */
export function fuzzyScore(quote: string, line: string): number {
  const q = normalize(quote).split(" ").filter(Boolean);
  const l = normalize(line).split(" ").filter(Boolean);
  if (q.length < 3 || !l.length) return 0;
  const w = Math.min(l.length, q.length);
  let best = 0;
  for (let i = 0; i + w <= l.length; i++) {
    const bag = new Map<string, number>();
    for (const t of l.slice(i, i + w)) bag.set(t, (bag.get(t) ?? 0) + 1);
    let hit = 0;
    for (const t of q) {
      const n = bag.get(t) ?? 0;
      if (n) {
        hit++;
        bag.set(t, n - 1);
      }
    }
    best = Math.max(best, hit / q.length);
  }
  return best;
}

/** Circleback's placeholder when it couldn't identify someone. */
export function isGenericSpeaker(name: string): boolean {
  return /^(participant|speaker|guest|unknown)\s*\d*$/i.test(name.trim());
}

/**
 * Same person? "Dan" matches "Daniel Kim", "Rose" matches "Rose Lindgren", "Dan K" matches "Daniel Kim".
 * First names match if equal or one starts with the other (3+ letters). Last names, when both
 * have one, must agree the same way. Placeholders ("Participant 1") must match exactly.
 */
export function namesMatch(a: string, b: string): boolean {
  if (isGenericSpeaker(a) || isGenericSpeaker(b)) return normalize(a) === normalize(b);
  const [fa, ...ra] = normalize(a).split(" ");
  const [fb, ...rb] = normalize(b).split(" ");
  if (!fa || !fb) return false;
  const prefix = (x: string, y: string, min: number) => x === y || (Math.min(x.length, y.length) >= min && (x.startsWith(y) || y.startsWith(x)));
  if (!prefix(fa, fb, 3)) return false;
  const la = ra.at(-1);
  const lb = rb.at(-1);
  return !la || !lb || prefix(la, lb, 1);
}

/** Position of a first name among a line's words (possessive "'s" ignored), or -1. */
export function wordIndex(line: string, name: string): number {
  const first = normalize(name).split(" ")[0];
  if (!first) return -1;
  return normalize(line)
    .split(" ")
    .findIndex((w) => w.replace(/'s$/, "") === first);
}

/**
 * Position of a first name within the sentence that contains it, or -1.
 * "...introduce myself. My name is Elima" -> 3; "...so to keep moving, Steph, your part..." -> 12.
 */
export function sentenceWordIndex(line: string, name: string): number {
  for (const sentence of line.split(/[.!?。！？]+/)) {
    const i = wordIndex(sentence, name);
    if (i >= 0) return i;
  }
  return -1;
}
