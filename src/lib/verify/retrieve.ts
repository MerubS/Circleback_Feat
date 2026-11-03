import type { Segment } from "@/lib/types";
import { tokens } from "./text";

export type Scored = {
  segment: Segment;
  score: number;
  coverage: number; // share of query words in the segment plus neighbours
  ownCoverage: number; // share of query words in the segment alone
};

/**
 * BM25 over transcript segments, where each segment's text is joined with its
 * neighbours so a commitment like "Yep, I'll take that" still matches the topic
 * named one line earlier.
 */
export function retrieve(query: string, transcript: Segment[], k = 6, window = 1): Scored[] {
  const q = Array.from(new Set(tokens(query)));
  if (q.length === 0 || transcript.length === 0) return [];

  const docs = transcript.map((_, i) => {
    const lo = Math.max(0, i - window);
    const hi = Math.min(transcript.length - 1, i + window);
    const own = tokens(transcript[i].text);
    const ctx: string[] = [];
    for (let j = lo; j <= hi; j++) if (j !== i) ctx.push(...tokens(transcript[j].text));
    return { own, all: [...own, ...ctx] };
  });

  const N = docs.length;
  const avgdl = docs.reduce((s, d) => s + d.all.length, 0) / N;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d.all)) df.set(t, (df.get(t) ?? 0) + 1);

  const k1 = 1.4;
  const b = 0.75;
  return docs
    .map((d, i) => {
      const tf = new Map<string, number>();
      for (const t of d.own) tf.set(t, (tf.get(t) ?? 0) + 2); // own text counts double
      for (const t of d.all) tf.set(t, (tf.get(t) ?? 0) + 1);
      let score = 0;
      let hits = 0;
      const own = new Set(d.own);
      const ownHits = q.filter((t) => own.has(t)).length;
      for (const t of q) {
        const f = tf.get(t) ?? 0;
        if (!f) continue;
        hits++;
        const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
        score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.all.length) / avgdl));
      }
      return { segment: transcript[i], score, coverage: hits / q.length, ownCoverage: ownHits / q.length };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
