const STOPWORDS = new Set(
  "a an the and or but if to of in on for with by at from as is are was were be been it this that these those we you i he she they them our your my me us do does did so up out about into over then than can could should would will just also any all some get got".split(
    " ",
  ),
);

const NUMBER_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  twenty: "20", forty: "40", hundred: "100",
};

/** Lowercase, unify quotes and dashes, collapse whitespace. Used for quote matching. */
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

/** Very small stemmer: enough to match "illustrations" with "illustration". */
export function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export function tokens(s: string): string[] {
  return normalize(s)
    .replace(/'s\b/g, "")
    .split(" ")
    .map((w) => NUMBER_WORDS[w] ?? w)
    .filter((w) => w && !STOPWORDS.has(w))
    .map(stem);
}

export function namesMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // "Marcus" vs "Marcus Chen"
  const fa = na.split(" ")[0];
  const fb = nb.split(" ")[0];
  return fa === fb && (na.startsWith(nb) || nb.startsWith(na));
}

export function isGenericSpeaker(name: string): boolean {
  return /^(participant|speaker|guest|unknown)\s*\d*$/i.test(name.trim());
}
