import https from "node:https";
import type { SkeletonFile } from "./types.js";

export interface SymbolVector {
  file: string;
  symbol: string;
  kind: string;
  terms: Record<string, number>;
  norm: number;
}

export interface EmbeddingSearchResult {
  file: string;
  symbol: string;
  kind: string;
  score: number;
}

export interface EmbeddingOptions {
  apiKey?: string;
  model?: string;
}

// ─── Tokenize ─────────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .replace(/([A-Z])/g, " $1")
    .replace(/[_\-().:<>{}[\],]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 1);
}

// ─── TF-IDF vectors ───────────────────────────────────────────────────────────

export function buildTfIdfVectors(skeletons: SkeletonFile[]): SymbolVector[] {
  type Doc = { file: string; symbol: string; kind: string; tokens: string[] };
  const docs: Doc[] = [];

  for (const skel of skeletons) {
    for (const sym of skel.symbols) {
      const text = [sym.name, sym.signature ?? "", sym.kind].join(" ");
      docs.push({ file: skel.file, symbol: sym.name, kind: sym.kind, tokens: tokenize(text) });
    }
  }

  if (docs.length === 0) return [];

  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set(doc.tokens)) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  const N = docs.length;
  const vectors: SymbolVector[] = [];

  for (const doc of docs) {
    const tf = new Map<string, number>();
    for (const term of doc.tokens) tf.set(term, (tf.get(term) ?? 0) + 1);

    const terms: Record<string, number> = {};
    for (const [term, count] of tf.entries()) {
      const idf = Math.log(N / (df.get(term) ?? 1));
      terms[term] = (count / doc.tokens.length) * idf;
    }

    const norm = Math.sqrt(Object.values(terms).reduce((s, v) => s + v * v, 0));
    vectors.push({ file: doc.file, symbol: doc.symbol, kind: doc.kind, terms, norm });
  }

  return vectors;
}

// ─── Cosine search ────────────────────────────────────────────────────────────

export function cosineSearch(
  vectors: SymbolVector[],
  query: string,
  limit = 20,
): EmbeddingSearchResult[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];

  const qTf = new Map<string, number>();
  for (const t of qTokens) qTf.set(t, (qTf.get(t) ?? 0) + 1);

  const qNorm = Math.sqrt([...qTf.values()].reduce((s, v) => s + (v / qTokens.length) ** 2, 0));
  if (qNorm === 0) return [];

  const scores: EmbeddingSearchResult[] = [];
  for (const vec of vectors) {
    if (vec.norm === 0) continue;
    let dot = 0;
    for (const [term, qCount] of qTf.entries()) {
      const qTfidf = qCount / qTokens.length;
      const dTfidf = vec.terms[term] ?? 0;
      dot += qTfidf * dTfidf;
    }
    const score = dot / (qNorm * vec.norm);
    if (score > 0) scores.push({ file: vec.file, symbol: vec.symbol, kind: vec.kind, score });
  }

  return scores.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ─── Claude re-ranking ────────────────────────────────────────────────────────

export async function rerankWithClaude(
  matches: EmbeddingSearchResult[],
  query: string,
  opts: EmbeddingOptions = {},
): Promise<EmbeddingSearchResult[]> {
  if (matches.length === 0) return matches;

  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return matches;

  const list = matches.map((m, i) => `${i + 1}. ${m.symbol} (${m.kind}) in ${m.file}`).join("\n");
  const prompt = `You are helping re-rank code search results for the query: "${query}"

Results:
${list}

Re-rank these by relevance to the query. Respond ONLY with a JSON array of 1-based indices in order of relevance, e.g. [3, 1, 5, 2, 4].`;

  const body = JSON.stringify({
    model: opts.model ?? "claude-sonnet-4-6",
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });

  try {
    const raw = await new Promise<string>((resolve, reject) => {
      const req = https.request(
        {
          hostname: "api.anthropic.com",
          path: "/v1/messages",
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-length": Buffer.byteLength(body),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            try {
              const parsed = JSON.parse(text) as { content?: Array<{ text: string }> };
              resolve(parsed.content?.[0]?.text ?? "");
            } catch { resolve(""); }
          });
        },
      );
      req.on("error", reject);
      req.write(body);
      req.end();
    });

    const arrMatch = raw.match(/\[[\d,\s]+\]/);
    if (arrMatch) {
      const indices = JSON.parse(arrMatch[0]) as number[];
      const reranked = indices
        .filter(i => i >= 1 && i <= matches.length)
        .map(i => matches[i - 1]);
      const covered = new Set(indices);
      for (let i = 1; i <= matches.length; i++) {
        if (!covered.has(i)) reranked.push(matches[i - 1]);
      }
      return reranked;
    }
  } catch { /* fall through */ }

  return matches;
}
