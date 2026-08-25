export const RETRIEVAL_DOCUMENT_VERSION = 1;
export const RETRIEVAL_REINDEX_CONFIRMATION = "REINDEX COMPLETED REEL SEARCH DOCUMENTS";

export type RetrievalDocument = {
  job_id: string;
  document_version: number;
  title_text: string;
  author_text: string;
  description_text: string;
  instructions_text: string;
  summary_text: string;
  visual_text: string;
  transcript_text: string;
  comments_text: string;
  resource_names_text: string;
  resource_details_text: string;
  claims_text: string;
};

export type RetrievalCandidate = RetrievalDocument & {
  id: string;
  title: string | null;
  author_username: string | null;
  description: string | null;
  canonical_url: string | null;
  status: string;
  status_emoji: string | null;
  original_video_key: string | null;
  markdown_key: string | null;
  resource_count: number;
  completed_at: string | null;
};

export type RankedRetrievalCandidate = RetrievalCandidate & {
  score: number;
  matched_terms: string[];
  matched_term_count: number;
  query_term_count: number;
  coverage: number;
  matched_fields: Record<string, string[]>;
  exact_phrase: boolean;
};

export type RetrievalDecision = {
  decision: "match" | "ambiguous" | "no_match";
  terms: string[];
  expanded_terms: string[];
  reason: string;
  matches: RankedRetrievalCandidate[];
};

export function retrievalMatchView(match: RankedRetrievalCandidate) {
  return {
    id: match.id,
    title: match.title,
    author_username: match.author_username,
    description: match.description,
    canonical_url: match.canonical_url,
    status: match.status,
    status_emoji: match.status_emoji,
    original_video_key: match.original_video_key,
    markdown_key: match.markdown_key,
    resource_count: match.resource_count,
    completed_at: match.completed_at,
    score: match.score,
    matched_terms: match.matched_terms,
    matched_term_count: match.matched_term_count,
    query_term_count: match.query_term_count,
    coverage: match.coverage,
    matched_fields: match.matched_fields,
    exact_phrase: match.exact_phrase,
  };
}

export function selectRetrievalMatch<T>(decision: RetrievalDecision["decision"] | undefined, matches: T[] | undefined): T | undefined {
  return decision === "match" ? matches?.[0] : undefined;
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "but", "by",
  "called", "could", "did", "do", "does", "find", "for", "from", "get", "had",
  "has", "have", "he", "her", "hers", "him", "his", "i", "in", "into", "is",
  "it", "its", "me", "mention", "mentioned", "mentioning", "my", "of", "on", "or",
  "please", "reel", "reels", "retrieve", "send", "she", "show", "that", "the", "their",
  "them", "there", "these", "they", "this", "those", "titled", "to", "us", "video",
  "videos", "was", "we", "were", "what", "when", "where", "which", "who", "with",
  "would", "you", "your",
]);

const IRREGULAR_STEMS: Record<string, string> = {
  films: "film",
  movies: "movie",
  people: "person",
  recipes: "recipe",
  series: "series",
  shows: "show",
  songs: "song",
  tvs: "tv",
};

const QUERY_ALIASES: Record<string, string[]> = {
  app: ["application", "software", "tool"],
  application: ["app", "software", "tool"],
  book: ["novel"],
  cinema: ["film", "movie"],
  dish: ["recipe"],
  film: ["movie", "cinema"],
  font: ["typeface"],
  movie: ["film", "cinema"],
  music: ["song", "audio"],
  novel: ["book"],
  recipe: ["dish"],
  samurai: ["swordsman", "warrior"],
  software: ["app", "application", "tool"],
  song: ["music", "audio"],
  swordsman: ["samurai", "warrior"],
  television: ["tv"],
  typeface: ["font"],
  tv: ["television"],
  warrior: ["samurai", "swordsman"],
};

const FIELD_WEIGHTS: Array<[keyof RetrievalDocument, number]> = [
  ["title_text", 15],
  ["resource_names_text", 14],
  ["visual_text", 10],
  ["summary_text", 9],
  ["resource_details_text", 8],
  ["claims_text", 7],
  ["description_text", 6],
  ["author_text", 6],
  ["transcript_text", 5],
  ["instructions_text", 4],
  ["comments_text", 2],
];

function cleanText(value: unknown, limit: number): string {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, limit);
}

function stemToken(token: string): string {
  if (IRREGULAR_STEMS[token]) return IRREGULAR_STEMS[token];
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ied")) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

export function retrievalTokens(value: unknown): string[] {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-AU");
  const raw = normalized.match(/[\p{L}\p{N}]+/gu) || [];
  const output: string[] = [];
  for (const item of raw) {
    if (item.length < 2 || STOP_WORDS.has(item)) continue;
    const stemmed = stemToken(item);
    if (stemmed.length < 2 || STOP_WORDS.has(stemmed)) continue;
    output.push(stemmed);
  }
  return output;
}

export function retrievalQueryGroups(query: string): Array<{ term: string; alternatives: string[] }> {
  const terms = [...new Set(retrievalTokens(query))].slice(0, 12);
  return terms.map((term) => ({
    term,
    alternatives: [...new Set([term, ...(QUERY_ALIASES[term] || []).map(stemToken)])],
  }));
}

export function retrievalExpandedTerms(query: string): string[] {
  return [...new Set(retrievalQueryGroups(query).flatMap((group) => group.alternatives))].slice(0, 36);
}

export function buildRetrievalDocument(input: {
  jobId: string;
  title?: unknown;
  author?: unknown;
  description?: unknown;
  instructions?: unknown;
  summary?: unknown;
  visualSummary?: unknown;
  transcript?: unknown;
  comments?: Array<{ author?: unknown; text?: unknown }>;
  resources?: Array<{ name?: unknown; kind?: unknown; artifact_type?: unknown; summary?: unknown; why_useful?: unknown; guide?: unknown }>;
  claims?: Array<{ claim?: unknown; confidence?: unknown; evidence?: unknown[] }>;
}): RetrievalDocument {
  return {
    job_id: cleanText(input.jobId, 100),
    document_version: RETRIEVAL_DOCUMENT_VERSION,
    title_text: cleanText(input.title, 10_000),
    author_text: cleanText(input.author, 2_000),
    description_text: cleanText(input.description, 20_000),
    instructions_text: cleanText(input.instructions, 10_000),
    summary_text: cleanText(input.summary, 30_000),
    visual_text: cleanText(input.visualSummary, 30_000),
    transcript_text: cleanText(input.transcript, 120_000),
    comments_text: cleanText((input.comments || []).map((comment) => `${comment.author || ""} ${comment.text || ""}`).join("\n"), 60_000),
    resource_names_text: cleanText((input.resources || []).map((resource) => `${resource.name || ""} ${resource.kind || ""} ${resource.artifact_type || ""}`).join("\n"), 40_000),
    resource_details_text: cleanText((input.resources || []).map((resource) => `${resource.summary || ""} ${resource.why_useful || ""} ${resource.guide || ""}`).join("\n"), 120_000),
    claims_text: cleanText((input.claims || []).map((claim) => `${claim.claim || ""} ${claim.confidence || ""} ${(claim.evidence || []).join(" ")}`).join("\n"), 40_000),
  };
}

export function retrievalDocumentTerms(document: RetrievalDocument): string[] {
  const orderedFields: Array<keyof RetrievalDocument> = [
    "title_text", "resource_names_text", "author_text", "summary_text", "visual_text",
    "resource_details_text", "claims_text", "description_text", "transcript_text",
    "instructions_text", "comments_text",
  ];
  const terms = new Set<string>();
  for (const field of orderedFields) {
    for (const term of retrievalTokens(document[field])) {
      terms.add(term);
      if (terms.size >= 2_000) return [...terms];
    }
  }
  return [...terms];
}

function normalizedPhrase(value: unknown): string {
  return retrievalTokens(value).join(" ");
}

export function rankRetrievalCandidates(query: string, candidates: RetrievalCandidate[], limit = 10): RetrievalDecision {
  const groups = retrievalQueryGroups(query);
  const terms = groups.map((group) => group.term);
  const expandedTerms = [...new Set(groups.flatMap((group) => group.alternatives))];
  if (!groups.length) return { decision: "no_match", terms, expanded_terms: expandedTerms, reason: "no_distinctive_terms", matches: [] };

  const phrase = terms.join(" ");
  const ranked = candidates.map((candidate): RankedRetrievalCandidate => {
    const fieldSets = new Map<keyof RetrievalDocument, Set<string>>();
    const fieldPhrases = new Map<keyof RetrievalDocument, string>();
    for (const [field] of FIELD_WEIGHTS) {
      fieldSets.set(field, new Set(retrievalTokens(candidate[field])));
      fieldPhrases.set(field, normalizedPhrase(candidate[field]));
    }
    let score = 0;
    const matchedTerms: string[] = [];
    const matchedFields: Record<string, string[]> = {};
    for (const group of groups) {
      let bestWeight = 0;
      const fields: string[] = [];
      for (const [field, weight] of FIELD_WEIGHTS) {
        const tokens = fieldSets.get(field)!;
        if (!group.alternatives.some((alternative) => tokens.has(alternative))) continue;
        bestWeight = Math.max(bestWeight, weight);
        fields.push(field.replace(/_text$/, ""));
      }
      if (!bestWeight) continue;
      matchedTerms.push(group.term);
      matchedFields[group.term] = fields;
      score += bestWeight + Math.min(3, Math.max(0, fields.length - 1));
    }
    const exactPhrase = terms.length > 1 && [...fieldPhrases.values()].some((field) => field.includes(phrase));
    if (exactPhrase) score += 16;
    const coverage = matchedTerms.length / groups.length;
    return {
      ...candidate,
      score,
      matched_terms: matchedTerms,
      matched_term_count: matchedTerms.length,
      query_term_count: groups.length,
      coverage: Number(coverage.toFixed(4)),
      matched_fields: matchedFields,
      exact_phrase: exactPhrase,
    };
  }).filter((candidate) => candidate.matched_term_count > 0)
    .sort((left, right) => right.score - left.score
      || right.coverage - left.coverage
      || String(right.completed_at || "").localeCompare(String(left.completed_at || ""))
      || left.id.localeCompare(right.id));

  if (!ranked.length) return { decision: "no_match", terms, expanded_terms: expandedTerms, reason: "no_indexed_term_match", matches: [] };
  const top = ranked[0];
  const second = ranked[1];
  const minimumCoverage = groups.length === 1 ? 1 : groups.length === 2 ? 0.5 : 0.5;
  const strongEnough = top.score >= 12 && top.coverage >= minimumCoverage;
  const clearMargin = !second
    || top.score - second.score >= 5
    || top.coverage - second.coverage >= 0.25
    || top.score >= second.score * 1.35;
  const decision = strongEnough && clearMargin ? "match" : "ambiguous";
  return {
    decision,
    terms,
    expanded_terms: expandedTerms,
    reason: !strongEnough ? "low_confidence" : clearMargin ? "clear_ranked_match" : "insufficient_score_margin",
    matches: ranked.slice(0, Math.min(Math.max(limit, 1), 25)),
  };
}
