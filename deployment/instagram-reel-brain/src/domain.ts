export type InstagramReaction = string;

export type ResourceMedia = {
  hero_image_url?: string | null;
  hero_image_alt?: string | null;
  spotify_url?: string | null;
  youtube_candidates?: Array<{
    title: string;
    channel: string;
    url: string;
    confidence: "high" | "medium" | "low";
    match_reason: string;
  }>;
  article_links?: Array<{
    title: string;
    publisher: string;
    url: string;
  }>;
};

const YOUTUBE_NON_NATIVE_TITLE = /\b(?:trailer|teaser|tv spot|movie clip|film clip|deleted scene|official audio|official music video|lyric video|soundtrack|full movie|full film)\b/i;

export function isYoutubeNativeCandidate(input: {
  artifactType?: string | null;
  resourceName?: string | null;
  candidateTitle?: string | null;
  matchReason?: string | null;
}): boolean {
  if (String(input.artifactType || "").trim()) return false;
  return !YOUTUBE_NON_NATIVE_TITLE.test(`${input.resourceName || ""} ${input.candidateTitle || ""} ${input.matchReason || ""}`);
}

function youtubeBrandIcon(): string {
  return `<img src="https://www.gstatic.com/youtube/img/branding/favicon/favicon_144x144.png" alt="" loading="lazy" referrerpolicy="no-referrer">`;
}

type MediaLinkResource = ResourceMedia & {
  name: string;
  kind?: string | null;
  canonical_url?: string | null;
};

export function applyMediaLinkFallbacks(resource: MediaLinkResource, artifactType: ArtifactType | null): ResourceMedia {
  const canonicalUrl = safeHttpUrl(resource.canonical_url);
  const canonicalYoutubeId = youtubeVideoId(canonicalUrl);
  const youtubeCandidates = (resource.youtube_candidates || []).slice(0, 3);
  if (!youtubeCandidates.length && canonicalYoutubeId && canonicalUrl) {
    youtubeCandidates.push({
      title: resource.name,
      channel: "Channel not recorded",
      url: canonicalUrl,
      confidence: "high",
      match_reason: "The researched canonical URL is an exact YouTube video URL.",
    });
  }
  const firstYoutubeId = youtubeCandidates.map((candidate) => youtubeVideoId(candidate.url)).find(Boolean) || null;
  const canonicalSpotify = canonicalUrl && /^https:\/\/open\.spotify\.com\/(track|album|episode|show)\//i.test(canonicalUrl)
    ? canonicalUrl
    : null;
  const spotifyUrl = safeHttpUrl(resource.spotify_url)
    || canonicalSpotify
    || (artifactType === "music" ? `https://open.spotify.com/search/${encodeURIComponent(resource.name)}` : null);
  const articleLinks = [...(resource.article_links || [])];
  const canonicalIsArticle = canonicalUrl
    && !canonicalYoutubeId
    && !/^https:\/\/(?:open\.)?spotify\.com\//i.test(canonicalUrl)
    && !/^https:\/\/(?:www\.)?instagram\.com\//i.test(canonicalUrl)
    && normalizeResourceKind(resource.kind, resource.name, "") === "reference";
  if (canonicalIsArticle && !articleLinks.some((article) => safeHttpUrl(article.url) === canonicalUrl)) {
    let publisher = "Source publication";
    try { publisher = new URL(canonicalUrl).hostname.replace(/^www\./, ""); } catch { /* already validated */ }
    articleLinks.unshift({ title: resource.name, publisher, url: canonicalUrl });
  }
  return {
    hero_image_url: safeHttpUrl(resource.hero_image_url)
      || (firstYoutubeId ? `https://i.ytimg.com/vi/${firstYoutubeId}/hqdefault.jpg` : null),
    hero_image_alt: resource.hero_image_alt || (firstYoutubeId ? `${resource.name} YouTube thumbnail` : null),
    spotify_url: spotifyUrl,
    youtube_candidates: youtubeCandidates,
    article_links: articleLinks,
  };
}

export type InstagramMediaClassification = {
  mediaType: "carousel" | "reel" | "post" | "unknown";
  itemCount: number;
};

export type InstagramDirectCarousel = {
  itemId: string;
  shortcode: string;
  sourceUrl: string;
  timestampMs: number;
  senderId: string;
  instructions: string;
  mediaPayload: { items: Array<Record<string, unknown>> };
  itemCount: number;
};

export function classifyInstagramMediaPayload(payload: unknown): InstagramMediaClassification {
  if (!payload || typeof payload !== "object") return { mediaType: "unknown", itemCount: 0 };
  const root = payload as { items?: unknown[] };
  const item = Array.isArray(root.items) && root.items[0] && typeof root.items[0] === "object"
    ? root.items[0] as Record<string, unknown>
    : payload as Record<string, unknown>;
  const carousel = Array.isArray(item.carousel_media) ? item.carousel_media : [];
  const mediaType = Number(item.media_type);
  if (carousel.length > 1 || mediaType === 8) {
    return { mediaType: "carousel", itemCount: Math.max(carousel.length, 2) };
  }
  if (mediaType === 2 || String(item.media_product_type || "").toLowerCase() === "clips") {
    return { mediaType: "reel", itemCount: 1 };
  }
  if (mediaType === 1) return { mediaType: "post", itemCount: 1 };
  return { mediaType: "unknown", itemCount: 0 };
}

export type EmojiSetting = { display: string; reaction: InstagramReaction };

export const DEFAULT_STAGE_REACTIONS: Record<string, EmojiSetting> = {
  queued: { display: "⬇️", reaction: "⬇️" },
  downloading: { display: "📥", reaction: "📥" },
  synthesizing: { display: "💬", reaction: "💬" },
  complete: { display: "✅", reaction: "✅" },
  error_auth: { display: "🔐", reaction: "🔐" },
  error_restricted: { display: "🔞", reaction: "🔞" },
  error_download: { display: "⛔", reaction: "⛔" },
  error_media: { display: "🎞️", reaction: "🎞️" },
  error_transcript: { display: "🎙️", reaction: "🎙️" },
  error_research: { display: "🔎", reaction: "🔎" },
  error_archive: { display: "💾", reaction: "💾" },
  error_unknown: { display: "❓", reaction: "❓" },
};

export function shouldReactToStage(stage: string): boolean {
  return Object.hasOwn(DEFAULT_STAGE_REACTIONS, stage);
}

export function isValidInstagramReaction(value: string): boolean {
  const reaction = String(value || "").trim();
  return Boolean(reaction) && !/\s/.test(reaction) && Array.from(reaction).length <= 8;
}

export function formatProcessingDuration(seconds?: number | null): string {
  if (seconds == null || !Number.isFinite(Number(seconds)) || Number(seconds) < 0) return "Not measured";
  const rounded = Math.round(Number(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  if (hours) return `${hours}h ${minutes}m ${remainingSeconds}s`;
  if (minutes) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

export function normalizeInstagramReaction(value: string): InstagramReaction | null {
  const raw = value.trim();
  const normalized = raw.toLowerCase().replace(/\ufe0f/g, "");
  const aliases: Record<string, InstagramReaction> = {
    love: "❤️", heart: "❤️", "❤": "❤️", "♥": "❤️",
    "speech balloon": "💬", speech: "💬", synthesise: "💬", synthesising: "💬",
  };
  return aliases[normalized] || (isValidInstagramReaction(raw) ? raw : null);
}

export type MessageCommand =
  | { intent: "emoji"; stage: string; display: string }
  | { intent: "note"; body: string }
  | { intent: "retrieval"; query: string; delivery: "reel" | "video_file" }
  | { intent: "status" }
  | { intent: "help" }
  | { intent: "unknown"; text: string };

export const LIVE_ADJACENT_INSTRUCTION_WINDOW_MINUTES = 5;
export const LIVE_INSTRUCTION_GRACE_DELAY_SECONDS = 12;

export type AdjacentPairingTargetState = {
  job?: { status: string; stage: string } | null;
  carousel?: { status: string } | null;
};

export function shouldCreateLiveInstructionTarget(input: {
  mode: string;
  hasShare: boolean;
  instructions: string;
}): boolean {
  return input.mode === "live" && input.hasShare && !input.instructions.trim();
}

export function shouldStoreLiveInstructionCandidate(input: {
  mode: string;
  hasShare: boolean;
  emptyMessage: boolean;
  commandIntent?: MessageCommand["intent"] | null;
}): boolean {
  return input.mode === "live"
    && !input.hasShare
    && !input.emptyMessage
    && input.commandIntent === "unknown";
}

export function pendingPartIsTest(input: { mode: string; kind: "share" | "instruction" | "unsupported_share" }): boolean {
  return input.mode === "test_only";
}

export function queueDelaySecondsForAdjacentInstruction(mode: string): number {
  return mode === "live" ? LIVE_INSTRUCTION_GRACE_DELAY_SECONDS : 0;
}

export function instagramWebhookSkipReason(input: {
  senderAllowed: boolean;
  duplicateCommand: boolean;
}): "sender_not_allowed" | "duplicate_command" | null {
  if (!input.senderAllowed) return "sender_not_allowed";
  if (input.duplicateCommand) return "duplicate_command";
  return null;
}

export function adjacentInstructionApplication(input: AdjacentPairingTargetState): {
  late: boolean;
  correctiveAction: "explicit_resynthesis_required" | null;
} {
  const job = input.job || null;
  const carousel = input.carousel || null;
  const canApplyToJob = Boolean(job && job.status === "queued" && job.stage === "queued");
  const canApplyBeforeCarouselJob = Boolean(!job && (!carousel || carousel.status === "queued"));
  const late = Boolean((job && !canApplyToJob) || (carousel && !canApplyBeforeCarouselJob));
  return { late, correctiveAction: late ? "explicit_resynthesis_required" : null };
}

export type CapturedComment = {
  id?: string;
  author?: string;
  text: string;
  like_count?: number | null;
  timestamp?: string | number | null;
};

export const RESOURCE_KINDS = [
  "recipe", "software", "product", "service", "organization", "person",
  "place", "technique", "learning", "media", "reference", "other",
] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const ARTIFACT_TYPES = [
  "font", "quote", "film", "tv_show", "recipe", "book", "music", "podcast",
] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export type SynthesisListItem = {
  position: number;
  label: string;
  description: string;
  resource_name: string;
};

export type SynthesisList = {
  title: string;
  summary: string;
  items: SynthesisListItem[];
};

export const ARTIFACT_COLLECTION_DEFINITIONS: Record<ArtifactType, {
  folder: string;
  title: string;
  singular: string;
  description: string;
}> = {
  font: { folder: "fonts", title: "Fonts", singular: "Font", description: "Typefaces identified across synthesised Instagram research." },
  quote: { folder: "quotes", title: "Quotes", singular: "Quote", description: "Reusable quotations with their speaker, source, context, and verification." },
  film: { folder: "films", title: "Films", singular: "Film", description: "Films mentioned or shown in synthesised posts, with viewing and research context." },
  tv_show: { folder: "tv-shows", title: "TV shows", singular: "TV show", description: "Television programmes and series mentioned or shown in synthesised posts." },
  recipe: { folder: "recipes", title: "Recipes", singular: "Recipe", description: "Researched recipes with ingredients, method, timing, substitutions, and provenance." },
  book: { folder: "books", title: "Books", singular: "Book", description: "Books and written works collected from synthesised posts." },
  music: { folder: "music", title: "Music", singular: "Music", description: "Songs, albums, and recordings identified in synthesised posts." },
  podcast: { folder: "podcasts", title: "Podcasts", singular: "Podcast", description: "Podcast programmes and episodes collected from synthesised posts." },
};

export const RESOURCE_KIND_DEFINITIONS: Record<ResourceKind, {
  folder: string;
  label: string;
  rules: string[];
}> = {
  recipe: { folder: "recipes", label: "Recipe", rules: ["List ingredients and quantities", "Record yield, timing, and ordered method", "Note substitutions, dietary flags, food safety, and the original source"] },
  software: { folder: "software-tools", label: "Software or tool", rules: ["Record official link, platform, licence, and price", "Give setup and first-use steps", "Note limitations, privacy or security concerns, and credible alternatives"] },
  product: { folder: "products", label: "Product", rules: ["Identify maker and exact model where possible", "Record key specifications, price region and date, and availability", "Compare credible alternatives and disclose uncertain claims"] },
  service: { folder: "services", label: "Service", rules: ["Record provider, coverage, pricing basis, and official terms", "Explain the practical use case and onboarding", "Note constraints, cancellation, privacy, and alternatives"] },
  organization: { folder: "organisations", label: "Organisation", rules: ["Record purpose, ownership or governance, and official links", "Separate verified facts from promotional claims", "Explain why the organisation is relevant to the Reel"] },
  person: { folder: "people", label: "Person", rules: ["Verify identity, role, and relevant expertise", "Use official or primary profiles where possible", "Avoid private details, speculation, and unsupported credibility claims"] },
  place: { folder: "places", label: "Place", rules: ["Record location and official contact or booking link", "Check access, hours, cost, and date-sensitive details", "Note practical constraints and accessibility where relevant"] },
  technique: { folder: "techniques", label: "Technique", rules: ["Explain prerequisites and ordered steps", "Record expected result, failure modes, and safety concerns", "Link to primary or expert instruction"] },
  learning: { folder: "learning-resources", label: "Learning resource", rules: ["Record author, audience, prerequisites, format, and cost", "Summarise coverage and a practical study path", "Assess currency and authority without inventing endorsements"] },
  media: { folder: "media", label: "Media", rules: ["Record creator, publisher, date, and where to access it", "Summarise the relevant content without reproducing it", "Separate the work's claims from external verification"] },
  reference: { folder: "references", label: "Reference", rules: ["Identify author, publisher, and publication date", "Explain what claim or decision it supports", "Prefer primary sources and flag age, conflicts, or weak evidence"] },
  other: { folder: "other-resources", label: "Other resource", rules: ["State what it is and why it matters", "Provide a practical next step and canonical link", "Record provenance and uncertainty explicitly"] },
};

const RESOURCE_KIND_ALIASES: Record<ResourceKind, string[]> = {
  recipe: ["recipe", "food", "meal", "dish", "drink", "cocktail", "baking"],
  software: ["software", "tool", "app", "application", "library", "framework", "plugin", "platform", "website", "repository", "api"],
  product: ["product", "device", "hardware", "equipment", "gadget"],
  service: ["service", "subscription", "provider"],
  organization: ["organization", "company", "business", "brand", "nonprofit", "agency", "community"],
  person: ["person", "creator", "expert", "author", "researcher"],
  place: ["place", "location", "venue", "restaurant", "hotel", "destination", "store"],
  technique: ["technique", "method", "workflow", "process", "practice", "strategy"],
  learning: ["learning", "course", "tutorial", "guide", "documentation", "training"],
  media: ["media", "book", "paper", "article", "video", "podcast", "newsletter"],
  reference: ["reference", "source", "standard", "dataset", "report", "study"],
  other: ["other", "resource", "unknown"],
};

export function normalizeResourceKind(kind?: string | null, name = "", summary = ""): ResourceKind {
  const normalized = slugify(kind || "");
  for (const candidate of RESOURCE_KINDS) {
    if (candidate === normalized || RESOURCE_KIND_ALIASES[candidate].includes(normalized)) return candidate;
  }
  const context = `${kind || ""} ${name} ${summary}`.toLowerCase();
  const inferred: Array<[ResourceKind, RegExp]> = [
    ["recipe", /\b(recipe|ingredients?|serves?|cook(?:ing)?|bake|meal|dish)\b/],
    ["software", /\b(software|app|plugin|framework|library|repository|github|api|website)\b/],
    ["product", /\b(product|device|hardware|equipment|model)\b/],
    ["place", /\b(place|venue|restaurant|hotel|destination|address)\b/],
    ["person", /\b(person|creator|author|researcher|expert)\b/],
    ["learning", /\b(course|tutorial|training|curriculum|documentation)\b/],
    ["technique", /\b(technique|method|workflow|process|practice|strategy)\b/],
    ["media", /\b(book|article|paper|podcast|newsletter|documentary)\b/],
    ["organization", /\b(company|organization|business|brand|agency|nonprofit)\b/],
    ["service", /\b(service|subscription|provider|consulting)\b/],
    ["reference", /\b(reference|dataset|standard|report|study|source)\b/],
  ];
  return inferred.find(([, pattern]) => pattern.test(context))?.[0] || "other";
}

export function normalizeArtifactType(
  artifactType?: string | null,
  resourceKind?: string | null,
  name = "",
  summary = "",
): ArtifactType | null {
  const explicit = String(artifactType || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if ((ARTIFACT_TYPES as readonly string[]).includes(explicit)) return explicit as ArtifactType;
  const kind = normalizeResourceKind(resourceKind, name, summary);
  if (kind === "recipe") return "recipe";
  const context = `${name} ${summary}`.toLowerCase();
  const fontEvidence = /\b(typeface|font family|serif family|sans[- ]serif family|display serif|display sans[- ]serif)\b/.test(context)
    || (kind === "product" && /\b(font|serif|sans[- ]serif)\b/.test(summary.toLowerCase()));
  if (fontEvidence) return "font";
  if (kind !== "media" && kind !== "reference") return null;
  const inferred: Array<[ArtifactType, RegExp]> = [
    ["tv_show", /\b(tv|television)\s+(show|series|programme)|\bstreaming series\b/],
    ["film", /\b(film|movie|motion picture|feature film|documentary film)\b/],
    ["book", /\b(book|novel|memoir|biography|textbook)\b/],
    ["podcast", /\bpodcast(?: episode| series| show)?\b/],
    ["music", /\b(song|album|music|track|recording|single|soundtrack)\b/],
    ["quote", /\b(quote|quotation|quoted saying|aphorism)\b/],
  ];
  return inferred.find(([, pattern]) => pattern.test(context))?.[0] || null;
}

export function canonicalizeInstagramUrl(value: string): { url: string; shortcode: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "instagram.com") return null;
  const match = parsed.pathname.match(/^\/(?:[^/]+\/)?(reel|p|tv)\/([A-Za-z0-9_-]+)\/?/i)
    || parsed.pathname.match(/^\/(reel|p|tv)\/([A-Za-z0-9_-]+)\/?/i);
  if (!match) return null;
  const mediaPath = match[1].toLowerCase() === "p" ? "p" : "reel";
  return { url: `https://www.instagram.com/${mediaPath}/${match[2]}/`, shortcode: match[2] };
}

export function instagramDedupeKey(value: string): string | null {
  const canonical = canonicalizeInstagramUrl(value);
  return canonical ? `instagram:${canonical.shortcode}` : null;
}

export function instagramPostUrlFromCdnUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (!host.endsWith(".cdninstagram.com") && !host.endsWith(".fbcdn.net")) return null;
  const cacheKey = parsed.searchParams.get("ig_cache_key") || "";
  if (!cacheKey) return null;
  let decoded: string;
  try {
    decoded = atob(cacheKey.split(".")[0]);
  } catch {
    return null;
  }
  const mediaId = decoded.match(/^([0-9]+)/)?.[1];
  if (!mediaId) return null;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let numeric = BigInt(mediaId);
  let shortcode = "";
  do {
    shortcode = alphabet[Number(numeric % 64n)] + shortcode;
    numeric /= 64n;
  } while (numeric > 0n);
  return `https://www.instagram.com/p/${shortcode}/`;
}

export type InstagramDirectLookup = {
  mediaId: string;
  title?: string | null;
  timestampMs?: number | null;
};

export type InstagramDirectPermalinkMatch = {
  sourceUrl: string;
  score: number;
  matchedBy: string[];
  itemType: string | null;
  mediaPayload: { items: Array<Record<string, unknown>> } | null;
};

function directTimestampMs(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  if (numeric > 10_000_000_000_000) return Math.round(numeric / 1000);
  if (numeric > 10_000_000_000) return Math.round(numeric);
  return Math.round(numeric * 1000);
}

function directComparableText(value: unknown): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function directItemTextValues(value: unknown, path: string[] = [], found = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    const key = path.at(-1)?.toLowerCase() || "";
    const isTextField = /(?:^|_)(?:text|title|subtitle|caption|description|message)(?:$|_)/i.test(key);
    if (isTextField && !/^https?:\/\//i.test(value)) {
      const comparable = directComparableText(value);
      if (comparable.length >= 12) found.add(comparable);
    }
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) directItemTextValues(item, path, found);
    return found;
  }
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    directItemTextValues(child, [...path, key], found);
  }
  return found;
}

function directTextMatch(title: string, texts: Set<string>): "exact" | "partial" | null {
  if (title.length < 12) return null;
  for (const text of texts) {
    if (text === title || text.includes(title)) return "exact";
  }
  const titleTokens = new Set(title.split(" ").filter((token) => token.length >= 3));
  for (const text of texts) {
    const shorterLength = Math.min(title.length, text.length);
    if (shorterLength >= 24 && (title.startsWith(text) || text.startsWith(title))) return "partial";
    const textTokens = new Set(text.split(" ").filter((token) => token.length >= 3));
    const smaller = Math.min(titleTokens.size, textTokens.size);
    if (smaller < 4) continue;
    let shared = 0;
    for (const token of titleTokens) if (textTokens.has(token)) shared += 1;
    const smallerCoverage = shared / smaller;
    const largerCoverage = shared / Math.max(titleTokens.size, textTokens.size);
    if (shared >= 4 && smallerCoverage >= 0.8 && largerCoverage >= 0.25) return "partial";
  }
  return null;
}

function directItemTimestamp(item: Record<string, unknown>): number | null {
  for (const key of ["timestamp", "taken_at", "created_at", "client_context_timestamp"]) {
    const timestamp = directTimestampMs(item[key]);
    if (timestamp) return timestamp;
  }
  return null;
}

function directItemPermalinks(value: unknown, path: string[] = [], found = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    const canonical = canonicalizeInstagramUrl(value);
    if (canonical) found.add(canonical.url);
    const key = path.at(-1)?.toLowerCase() || "";
    const inMediaShare = path.some((part) => /(?:media|xma|clip|reel|post|share)/i.test(part));
    if (inMediaShare && ["code", "shortcode"].includes(key) && /^[A-Za-z0-9_-]{5,30}$/.test(value)) {
      found.add(`https://www.instagram.com/p/${value}/`);
    }
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) directItemPermalinks(item, path, found);
    return found;
  }
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    directItemPermalinks(child, [...path, key], found);
  }
  return found;
}

function looksLikeDirectItem(value: Record<string, unknown>, parentKey: string): boolean {
  if (parentKey === "items") return true;
  return ["item_id", "item_type", "media_share", "xma_media_share", "clip", "felix_share"]
    .some((key) => Object.hasOwn(value, key));
}

export function findInstagramCarouselMediaPayload(value: unknown): { items: Array<Record<string, unknown>> } | null {
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findInstagramCarouselMediaPayload(child);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.carousel_media) && record.carousel_media.length > 1) return { items: [record] };
  const sidecar = record.edge_sidecar_to_children as { edges?: unknown[] } | undefined;
  if (Array.isArray(sidecar?.edges) && sidecar.edges.length > 1) {
    const carouselMedia = sidecar.edges.map((edge, index) => {
      const node = edge && typeof edge === "object" && (edge as Record<string, unknown>).node
        ? (edge as Record<string, unknown>).node as Record<string, unknown>
        : {};
      const videoUrl = typeof node.video_url === "string" ? node.video_url : "";
      const imageUrl = typeof node.display_url === "string"
        ? node.display_url
        : typeof node.thumbnail_src === "string" ? node.thumbnail_src : "";
      return videoUrl
        ? { pk: String(node.id || index + 1), video_versions: [{ url: videoUrl }] }
        : { pk: String(node.id || index + 1), image_versions2: { candidates: imageUrl ? [{ url: imageUrl }] : [] } };
    });
    const captionEdges = (record.edge_media_to_caption as { edges?: Array<{ node?: { text?: unknown } }> } | undefined)?.edges;
    const owner = record.owner && typeof record.owner === "object" ? record.owner as Record<string, unknown> : {};
    return { items: [{
      code: String(record.shortcode || record.code || ""),
      caption: { text: String(captionEdges?.[0]?.node?.text || "") },
      user: { username: String(owner.username || "unknown"), pk: String(owner.id || "") },
      carousel_media: carouselMedia,
    }] };
  }
  for (const child of Object.values(record)) {
    const found = findInstagramCarouselMediaPayload(child);
    if (found) return found;
  }
  return null;
}

export function instagramDirectCarousels(payload: unknown): InstagramDirectCarousel[] {
  const found: InstagramDirectCarousel[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const itemId = String(record.item_id || "").trim();
    if (itemId) {
      const mediaPayload = findInstagramCarouselMediaPayload(record);
      const media = mediaPayload?.items?.[0];
      const shortcode = String(media?.code || media?.shortcode || "").trim();
      const itemCount = Array.isArray(media?.carousel_media) ? media.carousel_media.length : 0;
      if (mediaPayload && itemCount > 1 && /^[A-Za-z0-9_-]{5,30}$/.test(shortcode)) {
        found.push({
          itemId,
          shortcode,
          sourceUrl: `https://www.instagram.com/p/${shortcode}/`,
          timestampMs: directItemTimestamp(record) || 0,
          senderId: String(record.user_id || record.sender_id || "").trim(),
          instructions: String(record.text || "").trim().slice(0, 3000),
          mediaPayload,
          itemCount,
        });
        return;
      }
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(payload);
  const unique = new Map<string, InstagramDirectCarousel>();
  for (const item of found) if (!unique.has(item.itemId)) unique.set(item.itemId, item);
  return [...unique.values()].sort((left, right) => right.timestampMs - left.timestampMs);
}

/**
 * Finds a permalink only when it belongs to the same Direct item that matches
 * the webhook attachment. It deliberately fails closed instead of selecting an
 * arbitrary recent post from the inbox.
 */
export function findInstagramDirectPermalink(
  payload: unknown,
  lookup: InstagramDirectLookup,
): InstagramDirectPermalinkMatch | null {
  const candidates: InstagramDirectPermalinkMatch[] = [];
  const mediaId = String(lookup.mediaId || "").trim();
  const title = directComparableText(lookup.title);

  const visit = (value: unknown, parentKey = ""): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child, parentKey);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (looksLikeDirectItem(record, parentKey)) {
      const permalinks = [...directItemPermalinks(record)];
      if (permalinks.length) {
        const serialised = JSON.stringify(record);
        let score = 0;
        const matchedBy: string[] = [];
        if (mediaId && serialised.includes(mediaId)) {
          score += 100;
          matchedBy.push("media_id");
        }
        const textMatch = directTextMatch(title, directItemTextValues(record));
        if (textMatch === "exact") {
          score += 55;
          matchedBy.push("title_exact");
        } else if (textMatch === "partial") {
          score += 40;
          matchedBy.push("title_partial");
        }
        const itemTimestamp = directItemTimestamp(record);
        let closeTimestamp = false;
        if (lookup.timestampMs && itemTimestamp) {
          const distance = Math.abs(lookup.timestampMs - itemTimestamp);
          if (distance <= 15_000) {
            score += 40;
            closeTimestamp = true;
            matchedBy.push("timestamp_15s");
          } else if (distance <= 60_000) {
            score += 35;
            closeTimestamp = true;
            matchedBy.push("timestamp_1m");
          } else if (distance <= 10 * 60_000) {
            score += 30;
            closeTimestamp = true;
            matchedBy.push("timestamp_10m");
          } else if (distance <= 60 * 60_000) {
            score += 15;
            matchedBy.push("timestamp_1h");
          } else if (distance <= 24 * 60 * 60_000) {
            score += 5;
            matchedBy.push("timestamp_24h");
          }
        }
        const strongIdentity = matchedBy.includes("media_id")
          || (matchedBy.includes("title_exact") && matchedBy.some((reason) => reason.startsWith("timestamp_")))
          || (matchedBy.includes("title_partial") && closeTimestamp);
        if (strongIdentity) {
          const mediaPayload = findInstagramCarouselMediaPayload(record);
          candidates.push({
            sourceUrl: permalinks[0],
            score,
            matchedBy,
            itemType: typeof record.item_type === "string" ? record.item_type : null,
            mediaPayload,
          });
        }
      }
      return;
    }
    for (const [key, child] of Object.entries(record)) visit(child, key);
  };

  visit(payload);
  candidates.sort((left, right) => right.score - left.score);
  if (!candidates.length || candidates[0].score < 60) return null;
  if (candidates[1] && candidates[1].score === candidates[0].score && candidates[1].sourceUrl !== candidates[0].sourceUrl) return null;
  return candidates[0];
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "resource";
}

export function canonicalArtifactKey(artifactType: ArtifactType, name: string): string {
  return `${artifactType}:${slugify(name)}`;
}

export function parseEmojiCommand(value: string): { stage: string; display: string } | null {
  const text = value.trim();
  const match = text.match(/^change\s+(?:the\s+)?(?:emoji|icon)\s+for\s+([a-z0-9 _-]+?)\s+to\s+(.+)$/i)
    || text.match(/^change\s+([a-z0-9 _-]+?)\s+(?:emoji|icon)\s+to\s+(.+)$/i);
  if (!match) return null;
  const compact = match[1].trim().toLowerCase().replace(/[\s_-]+/g, "");
  const aliases: Record<string, string> = {
    queue: "queued", queued: "queued",
    download: "downloading", downloading: "downloading",
    synthesis: "synthesizing", synthesise: "synthesizing", synthesising: "synthesizing",
    synthesize: "synthesizing", synthesizing: "synthesizing",
    complete: "complete", completed: "complete", done: "complete",
    restricted: "error_restricted", restrictedaudience: "error_restricted", adult: "error_restricted", "18plus": "error_restricted",
  };
  const stage = aliases[compact] || match[1].trim().toLowerCase().replace(/[\s-]+/g, "_");
  return { stage, display: match[2].trim() };
}

export function parseMessageCommand(value: string): MessageCommand {
  const text = value.trim();
  const emoji = parseEmojiCommand(text);
  if (emoji) return { intent: "emoji", ...emoji };
  if (/^(?:system\s+)?(?:status|health|health\s+check)\s*[?.!]*$/i.test(text)) return { intent: "status" };
  if (/^(?:help|commands|what can (?:you|this) do)\s*[?.!]*$/i.test(text)) return { intent: "help" };
  const note = text.match(/^(?:note|remember|save\s+(?:a\s+)?note|add\s+(?:a\s+)?note)\s*:?\s+([\s\S]+)$/i);
  if (note?.[1]?.trim()) return { intent: "note", body: note[1].trim() };
  const retrieval = text.match(/^(?:please\s+)?(?:send(?:\s+me)?|find(?:\s+me)?|show(?:\s+me)?|get(?:\s+me)?|retrieve)\s+(?:the\s+|a\s+)?(?:video|reel)?\s*(?:about|of|where|that|with|mentioning)?\s*(?:the\s+|a\s+)?([\s\S]+)$/i);
  const delivery = /\b(?:video\s+file|mp4|archive(?:d)?\s+(?:video|copy|file)|backup\s+(?:video|copy|file)|download(?:ed)?\s+(?:video|file)|taken\s+down|made\s+private|deleted|removed|unavailable)\b/i.test(text)
    ? "video_file" as const
    : "reel" as const;
  if (retrieval?.[1]?.trim()) return { intent: "retrieval", query: retrieval[1].trim(), delivery };
  if (/\b(?:video|reel)\b/i.test(text) && text.length > 5) return { intent: "retrieval", query: text, delivery };
  return text ? { intent: "unknown", text } : { intent: "help" };
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] || character);
}

function safeHttpUrl(value: unknown): string {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function spotifyUriFromUrl(value: unknown): string {
  const url = safeHttpUrl(value);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== "open.spotify.com") return "";
    const match = parsed.pathname.match(/^\/(track|album|episode|show|playlist|artist)\/([A-Za-z0-9]+)\/?$/i);
    return match ? `spotify:${match[1].toLowerCase()}:${match[2]}` : "";
  } catch {
    return "";
  }
}

export function highResolutionSpotifyArtworkUrl(value: unknown): string {
  const url = safeHttpUrl(value);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host !== "i.scdn.co" && !host.endsWith(".spotifycdn.com")) return url;
    const imageId = parsed.pathname.match(/^\/image\/(ab6761(?:6d|61|63)[A-Za-z0-9]+)$/i)?.[1] || "";
    if (!imageId) return url;
    const highResolutionId = imageId
      .replace(/^ab67616d0000(?:4851|1e02)/i, "ab67616d0000b273")
      .replace(/^ab6761610000(?:f178|5174)/i, "ab6761610000e5eb")
      .replace(/^ab6765630000(?:f68d|5f1f)/i, "ab6765630000ba8a");
    parsed.pathname = `/image/${highResolutionId}`;
    return parsed.toString();
  } catch {
    return url;
  }
}

export function highResolutionMusicArtworkUrl(value: unknown): string {
  const spotifyArtwork = highResolutionSpotifyArtworkUrl(value);
  if (!spotifyArtwork) return "";
  try {
    const parsed = new URL(spotifyArtwork);
    if (parsed.hostname.toLowerCase().endsWith(".bcbits.com")) {
      parsed.pathname = parsed.pathname.replace(/_1x1_120\.(jpe?g|png|webp)$/i, "_10.$1");
    }
    return parsed.toString();
  } catch {
    return spotifyArtwork;
  }
}

export function youtubeVideoId(value: unknown): string {
  const url = safeHttpUrl(value);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    let id = "";
    if (host === "youtu.be") id = parsed.pathname.split("/").filter(Boolean)[0] || "";
    if (["youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) {
      id = parsed.searchParams.get("v") || parsed.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/)?.[1] || "";
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
  } catch {
    return "";
  }
}

function formatCommentTimestamp(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric)
    : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function australianiseSpelling(value: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/\bsynthesizing\b/gi, "synthesising"],
    [/\bsynthesized\b/gi, "synthesised"],
    [/\bsynthesize\b/gi, "synthesise"],
    [/\borganizations\b/gi, "organisations"],
    [/\borganization\b/gi, "organisation"],
    [/\borganized\b/gi, "organised"],
    [/\borganizing\b/gi, "organising"],
    [/\borganize\b/gi, "organise"],
    [/\banalyzed\b/gi, "analysed"],
    [/\banalyzing\b/gi, "analysing"],
    [/\banalyze\b/gi, "analyse"],
    [/\bsummarized\b/gi, "summarised"],
    [/\bsummarizing\b/gi, "summarising"],
    [/\bsummarize\b/gi, "summarise"],
    [/\bbehavior\b/gi, "behaviour"],
    [/\blicense\b/gi, "licence"],
  ];
  return replacements.reduce((text, [pattern, replacement]) => text.replace(
    pattern,
    (match) => match[0] === match[0].toUpperCase() ? `${replacement[0].toUpperCase()}${replacement.slice(1)}` : replacement,
  ), value);
}

function renderProse(value: unknown, fallback = "Not recorded.", preserveSpelling = false): string {
  const raw = String(value || "").trim();
  const text = preserveSpelling ? raw : australianiseSpelling(raw);
  if (!text) return `<p>${escapeHtml(fallback)}</p>`;
  return text.split(/\n{2,}/).map((block) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length && lines.every((line) => /^[-*]\s+/.test(line))) {
      return `<ul>${lines.map((line) => `<li>${escapeHtml(line.replace(/^[-*]\s+/, ""))}</li>`).join("")}</ul>`;
    }
    return `<p>${lines.map(escapeHtml).join("<br>")}</p>`;
  }).join("");
}

export function renderRootHtml(input: {
  id: string;
  canonicalUrl: string;
  title: string;
  author: string;
  description: string;
  transcript: string;
  summary: string;
  visualSummary: string;
  instructions?: string | null;
  rootPath: string;
  resources: Array<{ name: string; slug: string; summary: string; libraryPath: string; kind?: string | null }>;
  lists?: Array<{ title: string; summary: string; libraryPath: string; itemCount: number }>;
  claims: Array<{ claim: string; confidence: string; evidence: string[] }>;
  comments?: CapturedComment[];
  reportedCommentCount?: number | null;
  audioAvailable?: boolean;
  audioTitle?: string | null;
  audioArtist?: string | null;
  audioSourceUrl?: string | null;
  audioIdentificationMethod?: string | null;
  mediaType?: "reel" | "carousel" | "post" | null;
  carouselItemCount?: number | null;
  tokenUsage?: {
    input_tokens?: number | null;
    cached_input_tokens?: number | null;
    output_tokens?: number | null;
    reasoning_output_tokens?: number | null;
    total_tokens?: number | null;
  } | null;
  processingSeconds?: number | null;
  createdAt: string;
}): string {
  const isCarousel = input.mediaType === "carousel" || Number(input.carouselItemCount || 0) > 1;
  const sourceLabel = isCarousel ? "Instagram carousel" : input.mediaType === "post" ? "Instagram post" : "Instagram Reel";
  const openLabel = isCarousel || input.mediaType === "post" ? "Open original post" : "Open original Reel";
  const visualLabel = isCarousel ? "What the carousel shows" : input.mediaType === "post" ? "What the post shows" : "What the Reel shows";
  const sourceUrl = safeHttpUrl(input.canonicalUrl);
  const audioSourceUrl = safeHttpUrl(input.audioSourceUrl);
  const audioIdentity = [input.audioTitle, input.audioArtist].filter(Boolean).join(" — ");
  const resourceItems = input.resources.length
    ? input.resources.map((resource) => {
      const definition = RESOURCE_KIND_DEFINITIONS[normalizeResourceKind(resource.kind, resource.name, resource.summary)];
      return `<li><span class="resource-type">${escapeHtml(definition.label)}</span><a href="#${encodeURIComponent(resource.libraryPath)}" data-library-path="${escapeHtml(resource.libraryPath)}">${escapeHtml(resource.name)}</a><p>${escapeHtml(resource.summary)}</p></li>`;
    }).join("")
    : "<li>No external resources identified.</li>";
  const listItems = (input.lists || []).map((list) => `<li><a href="#${encodeURIComponent(list.libraryPath)}" data-library-path="${escapeHtml(list.libraryPath)}">${escapeHtml(list.title)}</a><p>${escapeHtml(list.summary)}</p><span>${escapeHtml(list.itemCount)} ordered entr${list.itemCount === 1 ? "y" : "ies"}</span></li>`).join("");
  const claimItems = input.claims.length
    ? input.claims.map((claim) => `<li><strong>${escapeHtml(claim.claim)}</strong><span class="confidence">${escapeHtml(claim.confidence)}</span>${claim.evidence?.length ? `<ul>${claim.evidence.map((evidence) => `<li>${escapeHtml(evidence)}</li>`).join("")}</ul>` : ""}</li>`).join("")
    : "<li>No claims extracted.</li>";
  const comments = (input.comments || []).filter((comment) => String(comment.text || "").trim());
  const commentItems = comments.length
    ? comments.map((comment) => {
      const author = String(comment.author || "Instagram user").trim();
      const likeCount = typeof comment.like_count === "number" ? `${comment.like_count} like${comment.like_count === 1 ? "" : "s"}` : "";
      const timestamp = formatCommentTimestamp(comment.timestamp);
      const meta = [likeCount, timestamp].filter(Boolean).join(" · ");
      return `<li class="captured-comment"><header><strong>${escapeHtml(author.startsWith("@") ? author : `@${author}`)}</strong>${meta ? `<span>${escapeHtml(meta)}</span>` : ""}</header>${renderProse(comment.text, "Not recorded.", true)}</li>`;
    }).join("")
    : `<li class="captured-comment empty-comment"><p>No public comments were captured for this Reel.</p></li>`;
  const reportedCommentCount = typeof input.reportedCommentCount === "number" ? input.reportedCommentCount : "";
  return `<article class="reel-document" data-document-kind="reel" data-job-id="${escapeHtml(input.id)}">
  <header class="document-header">
    <p class="document-kicker">${sourceLabel}</p>
    <h1>${escapeHtml(input.title)}</h1>
    <div class="document-actions">
      <button type="button" data-gallery-action>Back to gallery</button>
      ${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">${openLabel}</a>` : ""}
    </div>
    <dl class="document-meta"><div><dt>Captured</dt><dd>${escapeHtml(input.createdAt)}</dd></div><div><dt>Archive ID</dt><dd>${escapeHtml(input.id)}</dd></div>${isCarousel ? `<div><dt>Archived slides</dt><dd>${escapeHtml(input.carouselItemCount || 0)}</dd></div>` : ""}<div data-processing-time><dt>Processing time</dt><dd>${escapeHtml(formatProcessingDuration(input.processingSeconds))}</dd></div>${input.tokenUsage?.total_tokens != null ? `<div data-token-usage><dt>Codex tokens</dt><dd>${escapeHtml(Number(input.tokenUsage.total_tokens).toLocaleString("en-AU"))} total · ${escapeHtml(Number(input.tokenUsage.input_tokens || 0).toLocaleString("en-AU"))} input · ${escapeHtml(Number(input.tokenUsage.output_tokens || 0).toLocaleString("en-AU"))} output</dd></div>` : ""}</dl>
  </header>
  <aside class="reel-sidecar-data" data-reel-sidecar data-media-type="${escapeHtml(isCarousel ? "carousel" : input.mediaType || "reel")}" data-carousel-item-count="${escapeHtml(input.carouselItemCount || 0)}" hidden>
    <p data-sidecar-username>@${escapeHtml(input.author)}</p>
    <div data-sidecar-description>${renderProse(input.description, "No creator description was captured.", true)}</div>
    <div data-sidecar-comments data-reported-comment-count="${escapeHtml(reportedCommentCount)}"><ol>${commentItems}</ol></div>
  </aside>
  ${input.audioAvailable ? `<section class="reel-audio-card" data-reel-audio data-audio-available="true">
    <h2>Audio archive</h2>
    ${audioIdentity ? `<p class="audio-identity">${escapeHtml(audioIdentity)}</p>` : ""}
    <audio controls preload="metadata" data-audio-player></audio>
    <div class="audio-actions">${audioSourceUrl ? `<a href="${escapeHtml(audioSourceUrl)}" target="_blank" rel="noopener noreferrer">Open identified audio</a>` : ""}<a href="#" data-audio-download>Download MP3</a></div>
  </section>` : ""}
  <section><h2>${visualLabel}</h2>${renderProse(input.visualSummary, "No visual summary returned.")}</section>
  <section><h2>Synthesis</h2>${renderProse(input.summary)}</section>
  ${listItems ? `<section><h2>Recreated lists</h2><ul class="list-index-list">${listItems}</ul></section>` : ""}
  <section><h2>Research files</h2><ul class="resource-list">${resourceItems}</ul></section>
  <section><h2>Claims and evidence</h2><ul class="claim-list">${claimItems}</ul></section>
  <section><h2>Transcript</h2><div class="transcript">${renderProse(input.transcript, "No speech transcript was available.", true)}</div></section>
  <section><h2>Handling instructions</h2>${renderProse(input.instructions, "Default research profile.", true)}</section>
</article>`;
}

export function renderListHtml(input: {
  id: string;
  title: string;
  summary: string;
  rootPath: string;
  author: string;
  description: string;
  mediaType?: "reel" | "carousel" | "post" | null;
  carouselItemCount?: number | null;
  comments?: CapturedComment[];
  reportedCommentCount?: number | null;
  items: Array<{ position: number; label: string; description: string; resourcePath: string }>;
}): string {
  const comments = (input.comments || []).filter((comment) => String(comment.text || "").trim());
  const commentItems = comments.length
    ? comments.map((comment) => {
      const author = String(comment.author || "Instagram user").trim();
      const likeCount = typeof comment.like_count === "number" ? `${comment.like_count} like${comment.like_count === 1 ? "" : "s"}` : "";
      const timestamp = formatCommentTimestamp(comment.timestamp);
      const meta = [likeCount, timestamp].filter(Boolean).join(" · ");
      return `<li class="captured-comment"><header><strong>${escapeHtml(author.startsWith("@") ? author : `@${author}`)}</strong>${meta ? `<span>${escapeHtml(meta)}</span>` : ""}</header>${renderProse(comment.text, "Not recorded.", true)}</li>`;
    }).join("")
    : `<li class="captured-comment empty-comment"><p>No public comments were captured for this Reel.</p></li>`;
  const reportedCommentCount = typeof input.reportedCommentCount === "number" ? input.reportedCommentCount : "";
  const mediaType = input.mediaType || "reel";
  const entries = input.items.map((item) => `<li value="${escapeHtml(item.position)}"><a href="#${encodeURIComponent(item.resourcePath)}" data-library-path="${escapeHtml(item.resourcePath)}">${escapeHtml(item.label)}</a>${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}</li>`).join("");
  return `<article class="reel-document list-document" data-document-kind="list" data-reel-preview="true" data-job-id="${escapeHtml(input.id)}">
  <header class="document-header">
    <p class="document-kicker">Recreated list · lists/</p>
    <h1>${escapeHtml(input.title)}</h1>
    <p>${escapeHtml(input.summary)}</p>
    <div class="document-actions"><button type="button" data-gallery-action>Back to gallery</button><a href="#${encodeURIComponent(input.rootPath)}" data-library-path="${escapeHtml(input.rootPath)}">Source Reel</a><a href="#${encodeURIComponent("lists/index.html")}" data-library-path="lists/index.html">View all lists</a></div>
  </header>
  <aside class="reel-sidecar-data" data-reel-sidecar data-media-type="${escapeHtml(mediaType)}" data-carousel-item-count="${escapeHtml(input.carouselItemCount || 0)}" hidden>
    <p data-sidecar-username>@${escapeHtml(String(input.author || "unknown").replace(/^@/, ""))}</p>
    <div data-sidecar-description>${renderProse(input.description, "No creator description was captured.", true)}</div>
    <div data-sidecar-comments data-reported-comment-count="${escapeHtml(reportedCommentCount)}"><ol>${commentItems}</ol></div>
  </aside>
  <section><h2>${escapeHtml(input.items.length)} entries, in source order</h2><ol class="recreated-list">${entries}</ol></section>
</article>`;
}

export function renderListCollectionHtml(input: {
  items: Array<{ title: string; libraryPath: string; summary?: string; author?: string; itemCount?: number }>;
}): string {
  const items = input.items.length
    ? input.items.map((item) => `<li><a href="#${encodeURIComponent(item.libraryPath)}" data-library-path="${escapeHtml(item.libraryPath)}">${escapeHtml(item.title)}</a>${item.summary ? `<p>${escapeHtml(item.summary)}</p>` : ""}<div class="artifact-source"><span>${escapeHtml(item.itemCount || 0)} entries</span>${item.author ? `<span>@${escapeHtml(String(item.author).replace(/^@/, ""))}</span>` : ""}</div></li>`).join("")
    : `<li class="empty-artifact"><p>No lists have been recorded yet.</p></li>`;
  return `<article class="reel-document list-index-document" data-document-kind="list-index">
  <header class="document-header"><p class="document-kicker">Central collection</p><h1>Lists</h1><p>Ordered lists recreated from synthesised Reels and carousels. Every entry opens its researched profile.</p><div class="document-actions"><button type="button" data-gallery-action>Back to gallery</button></div></header>
  <section><h2>${escapeHtml(input.items.length)} saved list${input.items.length === 1 ? "" : "s"}</h2><ul class="artifact-index-list list-index-list">${items}</ul></section>
</article>`;
}

export function renderResourceHtml(input: {
  rootId: string;
  rootPath: string;
  name: string;
  kind?: string | null;
  canonicalUrl?: string | null;
  summary: string;
  whyUseful: string;
  guide: string;
  sources: string[];
  media?: ResourceMedia | null;
  artifactType?: string | null;
  sourceReels?: Array<{
    jobId: string;
    rootPath: string;
    title: string;
    author: string;
    mediaType?: "reel" | "carousel" | "post";
  }>;
}): string {
  const resourceKind = normalizeResourceKind(input.kind, input.name, input.summary);
  const definition = RESOURCE_KIND_DEFINITIONS[resourceKind];
  const artifactType = normalizeArtifactType(input.artifactType, resourceKind, input.name, input.summary);
  const artifactCollection = artifactType ? ARTIFACT_COLLECTION_DEFINITIONS[artifactType] : null;
  const collectionPath = artifactCollection ? `${artifactCollection.folder}/index.html` : "";
  const canonicalUrl = safeHttpUrl(input.canonicalUrl);
  const heroImageUrl = safeHttpUrl(input.media?.hero_image_url);
  const spotifyUrl = safeHttpUrl(input.media?.spotify_url);
  const spotifyUri = spotifyUriFromUrl(spotifyUrl);
  const youtubeCandidates = (input.media?.youtube_candidates || []).slice(0, 3).flatMap((candidate) => {
    const id = youtubeVideoId(candidate.url);
    const url = safeHttpUrl(candidate.url);
    return id && url ? [{ ...candidate, id, url }] : [];
  });
  const youtubeNativeIds = new Set(youtubeCandidates.filter((candidate) => isYoutubeNativeCandidate({
    artifactType,
    resourceName: input.name,
    candidateTitle: candidate.title,
    matchReason: candidate.match_reason,
  })).map((candidate) => candidate.id));
  const visibleYoutubeCandidates = artifactType === "film" || artifactType === "tv_show"
    ? []
    : youtubeCandidates.filter((candidate) => !YOUTUBE_NON_NATIVE_TITLE.test(`${candidate.title} ${candidate.match_reason}`));
  const youtubeMatches = visibleYoutubeCandidates.length
    ? `<section class="resource-media-section"><h2>${visibleYoutubeCandidates.length === 1 ? "YouTube video" : "Possible YouTube matches"}</h2>${visibleYoutubeCandidates.length > 1 ? "<p>The source was ambiguous. Expand a candidate to preview it and choose the correct video.</p>" : ""}<div class="youtube-match-grid">${visibleYoutubeCandidates.map((candidate, index) => `<details class="youtube-match"${visibleYoutubeCandidates.length === 1 ? " open" : ""}><summary><img src="https://i.ytimg.com/vi/${escapeHtml(candidate.id)}/hqdefault.jpg" alt="${escapeHtml(candidate.title)} thumbnail" loading="lazy" referrerpolicy="no-referrer"><span><small>${escapeHtml(candidate.confidence)} confidence${visibleYoutubeCandidates.length > 1 ? ` · candidate ${index + 1}` : ""}</small><strong>${escapeHtml(candidate.title)}</strong><span>${escapeHtml(candidate.channel)}</span></span></summary><div class="youtube-match-detail"><p>${escapeHtml(candidate.match_reason)}</p><div class="youtube-embed"><iframe src="https://www.youtube.com/embed/${escapeHtml(candidate.id)}" title="${escapeHtml(candidate.title)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div><div class="youtube-match-actions">${youtubeNativeIds.has(candidate.id) ? `<a href="#${encodeURIComponent(`youtube/${candidate.id}.html`)}" data-library-path="${escapeHtml(`youtube/${candidate.id}.html`)}">Saved video profile</a>` : ""}<a class="youtube-brand-link" href="${escapeHtml(candidate.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(candidate.title)} in YouTube" title="Open in YouTube">${youtubeBrandIcon()}</a></div></div></details>`).join("")}</div></section>`
    : "";
  const articleLinks = (input.media?.article_links || []).flatMap((article) => {
    const url = safeHttpUrl(article.url);
    return url ? [{ ...article, url }] : [];
  });
  const articles = articleLinks.length
    ? `<section class="resource-media-section"><h2>Mentioned articles</h2><ul class="article-link-list">${articleLinks.map((article) => `<li><a href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.title)}</a><span>${escapeHtml(article.publisher)}</span></li>`).join("")}</ul></section>`
    : "";
  const sources = input.sources.length
    ? input.sources.map((source) => {
      const url = safeHttpUrl(source);
      return `<li>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>` : escapeHtml(source)}</li>`;
    }).join("")
    : "<li>No external source recorded.</li>";
  const sourceReels = input.sourceReels || [];
  const sourceReelCards = sourceReels.length
    ? `<div class="artifact-reel-grid">${sourceReels.map((reel) => `<button class="artifact-reel-card" type="button" data-library-path="${escapeHtml(reel.rootPath)}" data-thumbnail-job-id="${escapeHtml(reel.jobId)}"><img alt="" loading="lazy"><span class="reel-card-shade" aria-hidden="true"></span><span class="reel-card-copy"><small>${escapeHtml(reel.mediaType === "carousel" ? "Carousel" : reel.mediaType === "post" ? "Post" : "Reel")}</small><strong>${escapeHtml(reel.title || "Untitled Instagram research")}</strong><span>@${escapeHtml(String(reel.author || "unknown").replace(/^@/, ""))}</span></span></button>`).join("")}</div>`
    : "<p>No source Reels recorded.</p>";
  const backToReel = input.rootPath && !sourceReels.length
    ? `<a href="#${encodeURIComponent(input.rootPath)}" data-library-path="${escapeHtml(input.rootPath)}">Back to Reel</a>`
    : "";
  return `<article class="reel-document resource-document" data-document-kind="resource" data-job-id="${escapeHtml(input.rootId)}">
  <header class="document-header">
    <p class="document-kicker">${escapeHtml(definition.label)} · ${escapeHtml(definition.folder)}/</p>
    <h1>${escapeHtml(input.name)}</h1>
    <div class="document-actions"><button type="button" data-gallery-action>Back to gallery</button>${collectionPath ? `<a href="#${encodeURIComponent(collectionPath)}" data-library-path="${escapeHtml(collectionPath)}">View all ${escapeHtml(artifactCollection!.title.toLowerCase())}</a>` : ""}${youtubeNativeIds.size ? `<a href="#${encodeURIComponent("youtube/index.html")}" data-library-path="youtube/index.html">View all YouTube videos</a>` : ""}${backToReel}${canonicalUrl ? `<a href="${escapeHtml(canonicalUrl)}" target="_blank" rel="noopener noreferrer">Official or canonical link</a>` : ""}${spotifyUrl ? `<a class="spotify-brand-link" href="${escapeHtml(spotifyUrl)}"${spotifyUri ? ` data-spotify-uri="${escapeHtml(spotifyUri)}"` : ""} aria-label="Open ${escapeHtml(input.name)} in Spotify" title="Open in Spotify"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="12"></circle><path d="M6.4 8.6c3.7-1.1 8.2-.8 11.4 1a1 1 0 0 1-.9 1.8c-2.8-1.6-6.7-1.9-9.9-.9a1 1 0 1 1-.6-1.9Zm.5 3.2c3.1-.9 6.9-.6 9.6.9a.84.84 0 0 1-.8 1.5c-2.3-1.3-5.6-1.6-8.3-.8a.84.84 0 1 1-.5-1.6Zm.5 2.9c2.7-.7 5.8-.5 8.1.8a.7.7 0 0 1-.7 1.3c-1.9-1.1-4.7-1.3-7-.7a.7.7 0 1 1-.4-1.4Z"></path></svg></a>` : ""}</div>
  </header>
  ${heroImageUrl ? `<figure class="resource-hero"><img src="${escapeHtml(heroImageUrl)}" alt="${escapeHtml(input.media?.hero_image_alt || `${input.name} artwork`)}" loading="lazy" referrerpolicy="no-referrer"><figcaption>${escapeHtml(input.media?.hero_image_alt || input.name)}</figcaption></figure>` : ""}
  <section><h2>Profile</h2>${renderProse(input.summary)}</section>
  <section><h2>Why it is useful</h2>${renderProse(input.whyUseful)}</section>
  <section><h2>Practical guide</h2>${renderProse(input.guide)}</section>
  <section><h2>Research standard</h2><ul>${definition.rules.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")}</ul></section>
  <section><h2>Research sources</h2><ul class="source-list">${sources}</ul></section>
  ${youtubeMatches}
  ${articles}
  ${artifactType ? `<section><h2>Source Reels</h2>${sourceReelCards}</section>` : ""}
</article>`;
}

export function renderArtifactCollectionHtml(input: {
  artifactType: ArtifactType;
  items: Array<{
    name: string;
    libraryPath: string;
    rootPath: string;
    summary?: string;
    author?: string;
    sourceCount?: number;
  }>;
}): string {
  const definition = ARTIFACT_COLLECTION_DEFINITIONS[input.artifactType];
  const items = input.items.length
    ? input.items.map((item) => `<li><a href="#${encodeURIComponent(item.libraryPath)}" data-library-path="${escapeHtml(item.libraryPath)}">${escapeHtml(item.name)}</a>${item.summary ? `<p>${escapeHtml(item.summary)}</p>` : ""}<div class="artifact-source"><span>${escapeHtml(item.sourceCount || 1)} source Reel${(item.sourceCount || 1) === 1 ? "" : "s"}</span></div></li>`).join("")
    : `<li class="empty-artifact"><p>No ${escapeHtml(definition.title.toLowerCase())} have been recorded yet.</p></li>`;
  return `<article class="reel-document artifact-index-document" data-document-kind="artifact-index" data-artifact-type="${escapeHtml(input.artifactType)}">
  <header class="document-header">
    <p class="document-kicker">Central artifact collection</p>
    <h1>${escapeHtml(definition.title)}</h1>
    <p>${escapeHtml(definition.description)}</p>
    <div class="document-actions"><button type="button" data-gallery-action>Back to gallery</button></div>
  </header>
  <section><h2>${escapeHtml(definition.title)}</h2><ul class="artifact-index-list">${items}</ul></section>
</article>`;
}

export type YoutubeVideoProfile = {
  id: string;
  title: string;
  channel: string;
  url: string;
  confidence: "high" | "medium" | "low";
  matchReason: string;
  sources: Array<{
    resourceName: string;
    resourcePath: string;
    reelTitle: string;
    reelPath: string;
    author: string;
  }>;
};

function youtubeLogoLink(video: YoutubeVideoProfile): string {
  return `<a class="youtube-brand-link" href="${escapeHtml(video.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(video.title)} in YouTube" title="Open in YouTube">${youtubeBrandIcon()}</a>`;
}

export function renderYoutubeVideoHtml(video: YoutubeVideoProfile): string {
  const sourceItems = video.sources.length
    ? video.sources.map((source) => `<li><a href="#${encodeURIComponent(source.resourcePath)}" data-library-path="${escapeHtml(source.resourcePath)}">${escapeHtml(source.resourceName)}</a><span>from <a href="#${encodeURIComponent(source.reelPath)}" data-library-path="${escapeHtml(source.reelPath)}">${escapeHtml(source.reelTitle)}</a> · @${escapeHtml(String(source.author || "unknown").replace(/^@/, ""))}</span></li>`).join("")
    : "<li>No source profile recorded.</li>";
  return `<article class="reel-document youtube-video-document" data-document-kind="youtube-video" data-youtube-id="${escapeHtml(video.id)}">
  <header class="document-header">
    <p class="document-kicker">YouTube video · youtube/</p>
    <h1>${escapeHtml(video.title)}</h1>
    <p>${escapeHtml(video.channel || "Channel not recorded")}</p>
    <div class="document-actions"><button type="button" data-gallery-action>Back to gallery</button><a href="#${encodeURIComponent("youtube/index.html")}" data-library-path="youtube/index.html">View all YouTube videos</a>${youtubeLogoLink(video)}</div>
  </header>
  <div class="youtube-profile-embed"><iframe src="https://www.youtube.com/embed/${escapeHtml(video.id)}" title="${escapeHtml(video.title)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>
  <section><h2>Why this match was stored</h2><p>${escapeHtml(video.matchReason || "Stored as a verified YouTube candidate.")}</p><p><strong>${escapeHtml(video.confidence)} confidence</strong></p></section>
  <section><h2>Referenced by</h2><ul class="youtube-source-list">${sourceItems}</ul></section>
</article>`;
}

export function renderYoutubeCollectionHtml(videos: YoutubeVideoProfile[]): string {
  const cards = videos.length
    ? `<div class="youtube-library-grid">${videos.map((video) => `<button class="youtube-library-card" type="button" data-library-path="youtube/${escapeHtml(video.id)}.html"><img src="https://i.ytimg.com/vi/${escapeHtml(video.id)}/hqdefault.jpg" alt="" loading="lazy" referrerpolicy="no-referrer"><span class="reel-card-shade" aria-hidden="true"></span><span class="reel-card-copy"><small>YouTube</small><strong>${escapeHtml(video.title)}</strong><span>${escapeHtml(video.channel || "Channel not recorded")}</span></span></button>`).join("")}</div>`
    : "<p>No YouTube videos have been recorded yet.</p>";
  return `<article class="reel-document youtube-index-document" data-document-kind="youtube-index">
  <header class="document-header"><p class="document-kicker">Creator-made video collection</p><h1>YouTube</h1><p>Standalone work created and released for YouTube. Films, television, trailers, clips, and music stay in their own collections.</p><div class="document-actions"><button type="button" data-gallery-action>Back to gallery</button></div></header>
  <section><h2>${videos.length} saved video${videos.length === 1 ? "" : "s"}</h2>${cards}</section>
</article>`;
}

export function renderRootMarkdown(input: {
  id: string;
  canonicalUrl: string;
  title: string;
  author: string;
  description: string;
  transcript: string;
  summary: string;
  visualSummary: string;
  instructions?: string | null;
  resources: Array<{ name: string; slug: string; summary: string; canonical_url?: string | null }>;
  claims: Array<{ claim: string; confidence: string; evidence: string[] }>;
  createdAt: string;
}): string {
  const resourceLines = input.resources.length
    ? input.resources.map((r) => `- [[resources/${input.id}/${r.slug}|${r.name}]] — ${r.summary}`).join("\n")
    : "- No external resources identified.";
  const claimLines = input.claims.length
    ? input.claims.map((c) => `- **${c.claim}** (${c.confidence})\n  - Evidence: ${c.evidence.join("; ") || "not recorded"}`).join("\n")
    : "- No claims extracted.";
  return `---\n` +
    `type: instagram-reel\n` +
    `id: ${input.id}\n` +
    `source: ${JSON.stringify(input.canonicalUrl)}\n` +
    `author: ${JSON.stringify(input.author)}\n` +
    `created: ${input.createdAt}\n` +
    `status: synthesised\n` +
    `---\n\n` +
    `# ${input.title}\n\n` +
    `> [!info] Source\n> Posted by [@${input.author}](https://www.instagram.com/${input.author}/) · [Open Reel](${input.canonicalUrl})\n\n` +
    `## What the Reel shows\n\n${input.visualSummary}\n\n` +
    `## Creator description\n\n${input.description || "No description captured."}\n\n` +
    `## Synthesis\n\n${input.summary}\n\n` +
    `## Research tree\n\n${resourceLines}\n\n` +
    `## Claims and evidence\n\n${claimLines}\n\n` +
    `## Transcript\n\n${input.transcript || "No speech transcript was available."}\n\n` +
    `## Handling instructions\n\n${input.instructions || "Default research profile."}\n`;
}

export function renderResourceMarkdown(input: {
  rootId: string;
  name: string;
  slug: string;
  kind?: string | null;
  canonicalUrl?: string | null;
  summary: string;
  whyUseful: string;
  guide: string;
  sources: string[];
}): string {
  const sources = input.sources.length ? input.sources.map((s) => `- ${s}`).join("\n") : "- No external source recorded.";
  return `---\n` +
    `type: reel-resource\n` +
    `name: ${JSON.stringify(input.name)}\n` +
    `kind: ${JSON.stringify(input.kind || "resource")}\n` +
    `source_reel: ${JSON.stringify(input.rootId)}\n` +
    `---\n\n` +
    `# ${input.name}\n\n` +
    `Parent: [[../${input.rootId}|Reel ${input.rootId}]]\n\n` +
    `${input.canonicalUrl ? `[Official or canonical link](${input.canonicalUrl})\n\n` : ""}` +
    `## Profile\n\n${input.summary}\n\n` +
    `## Why it is useful\n\n${input.whyUseful}\n\n` +
    `## Practical guide\n\n${input.guide}\n\n` +
    `## Sources\n\n${sources}\n`;
}
