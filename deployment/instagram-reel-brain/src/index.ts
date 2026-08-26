import { Container, getContainer } from "@cloudflare/containers";
import puppeteer, { type BrowserWorker, type Cookie } from "@cloudflare/puppeteer";
import {
  pairLiveInstructionWithPendingShare,
  sendQueueMessageWithAdjacentInstructionDelay,
  takePendingInstructionForShare,
} from "./adjacent-pairing";
import { correctiveClaimApplied, correctivelyResynthesiseOne } from "./corrective-resynthesis";
import {
  decodePhase4Cursor,
  phase4DeltaQuery,
  phase4MirrorAllowsMethod,
  phase4MirrorScopeForToken,
  phase4NextCursor,
  phase4ObjectAccessQuery,
  phase4Tables,
  phase4WatermarkAllowed,
  parsePhase4Limit,
  parsePhase4Watermark,
  isPhase4MirrorTable,
  type Phase4MirrorScope,
} from "./phase4-mirror";
import {
  PHASE5_CANCEL_ARM_CONFIRMATION,
  PHASE5_MIN_EXPLICIT_JOB_CREATED_AT,
  PHASE5_RENEW_CONFIRMATION,
  PHASE5_START_CONFIRMATION,
  PHASE5_FINALIZE_CONFIRMATION,
  PHASE5_ABORT_CONFIRMATION,
  isPhase5ActiveFenceStatus,
  phase5FenceActive,
  phase5ArmCanCaptureShare,
  validatePhase5PreintakeArmRequest,
  validatePhase5PreintakeCancelRequest,
  validatePhase5FenceRequest,
  validatePhase5RenewRequest,
  validatePhase5StartRequest,
  validatePhase5FinalizeRequest,
  validatePhase5AbortRequest,
  validatePhase5RollbackRequest,
  phase5StartRecoveryDecision,
  phase5FinalizeRecoveryDecision,
  phase5AbortRecoveryDecision,
  type Phase5PreintakeArmRow,
  type Phase5FenceRow,
} from "./phase5-pilot";
import {
  PHASE6_CLAIM_CONFIRMATION,
  PHASE6_CLOUD_CONFIRMATION,
  PHASE6_LOCAL_CONFIRMATION,
  PHASE6_LOCAL_CONCURRENCY,
  PHASE6_RELEASE_CONFIRMATION,
  PHASE6_RETRY_CONFIRMATION,
  PHASE6_TRANSITION_CONFIRMATION,
  phase6AuthorityAllowsCloudClaims,
  phase6AuthorityAllowsLocalClaims,
  phase6LeaseOwnerAllowed,
  phase6PilotKey,
  phase6ShouldFenceNewJob,
  validatePhase6AuthorityRequest,
  validatePhase6ClaimRequest,
  validatePhase6FailureRequest,
  type Phase6AuthoritySnapshot,
} from "./phase6-authority";
import {
  buildRetrievalDocument,
  rankRetrievalCandidates,
  RETRIEVAL_REINDEX_CONFIRMATION,
  retrievalDocumentTerms,
  retrievalExpandedTerms,
  retrievalMatchView,
  selectRetrievalMatch,
  type RetrievalCandidate,
  type RetrievalDocument,
} from "./retrieval";
import {
  DEFAULT_STAGE_REACTIONS,
  applyMediaLinkFallbacks,
  canonicalArtifactKey,
  canonicalizeInstagramUrl,
  classifyInstagramMediaPayload,
  findInstagramCarouselMediaPayload,
  findInstagramDirectPermalink,
  pendingPartIsTest,
  instagramDedupeKey,
  instagramDirectCarousels,
  instagramPostUrlFromCdnUrl,
  highResolutionMusicArtworkUrl,
  isValidInstagramReaction,
  isYoutubeNativeCandidate,
  normalizeArtifactType,
  normalizeInstagramReaction,
  normalizeResourceKind,
  parseMessageCommand,
  ARTIFACT_COLLECTION_DEFINITIONS,
  RESOURCE_KIND_DEFINITIONS,
  renderArtifactCollectionHtml,
  renderListCollectionHtml,
  renderListHtml,
  renderYoutubeCollectionHtml,
  renderYoutubeVideoHtml,
  renderResourceHtml,
  renderResourceMarkdown,
  renderRootHtml,
  renderRootMarkdown,
  shouldCreateLiveInstructionTarget,
  shouldStoreLiveInstructionCandidate,
  formatProcessingDuration,
  instagramWebhookSkipReason,
  shouldReactToStage,
  slugify,
  youtubeVideoId,
  type EmojiSetting,
  type InstagramReaction,
  type CapturedComment,
  type ArtifactType,
  type ResourceKind,
  type ResourceMedia,
  type SynthesisList,
  type YoutubeVideoProfile,
} from "./domain";

type ReelJobMessage = { jobId: string } | { type: "carousel_resolve"; sourceMessageId: string };

class JobProcessingError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryDelaySeconds: number,
  ) {
    super(message);
    this.name = "JobProcessingError";
  }
}

type JobRow = {
  id: string;
  source_url: string;
  canonical_url: string | null;
  shortcode: string | null;
  dedupe_key: string | null;
  pilot_run_id: string | null;
  sender_id: string | null;
  source_message_id: string | null;
  source_media_json: string | null;
  instructions: string | null;
  title: string | null;
  author_username: string | null;
  description: string | null;
  status: string;
  stage: string;
  attempts: number;
  status_emoji: string;
  error_code: string | null;
  error_message: string | null;
  upload_token_hash: string | null;
  upload_token_expires_at: string | null;
  original_video_key: string | null;
  audio_key: string | null;
  audio_title: string | null;
  audio_artist: string | null;
  audio_source_url: string | null;
  audio_identification_method: string | null;
  audio_confidence: string | null;
  html_key: string | null;
  library_path: string | null;
  markdown_key: string | null;
  transcript_key: string | null;
  synthesis_json_key: string | null;
  codex_input_tokens: number | null;
  codex_cached_input_tokens: number | null;
  codex_output_tokens: number | null;
  codex_reasoning_output_tokens: number | null;
  codex_total_tokens: number | null;
  processing_seconds: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

type SynthesisResource = {
  name: string;
  kind?: string | null;
  artifact_type?: string | null;
  canonical_url?: string | null;
  summary: string;
  why_useful: string;
  guide: string;
  sources?: string[];
  hero_image_url?: string | null;
  hero_image_alt?: string | null;
  spotify_url?: string | null;
  youtube_candidates?: ResourceMedia["youtube_candidates"];
  article_links?: ResourceMedia["article_links"];
};

type RoutedSynthesisResource = SynthesisResource & {
  slug: string;
  kind: ResourceKind;
  artifactType: ArtifactType | null;
  canonicalKey: string | null;
  documentSlug: string;
};

type WikipediaPageImage = {
  title?: string;
  missing?: boolean;
  original?: { source?: string };
  thumbnail?: { source?: string };
  images?: Array<{ title?: string }>;
  imageinfo?: Array<{ thumburl?: string; url?: string }>;
};

type SynthesisPayload = {
  metadata: {
    canonical_url: string;
    shortcode: string;
    title: string;
    author_username: string;
    description: string;
    media_type?: "reel" | "carousel" | "post";
    carousel_item_count?: number | null;
  };
  transcript: string;
  summary: string;
  visual_summary: string;
  claims: Array<{ claim: string; confidence: string; evidence: string[] }>;
  resources: SynthesisResource[];
  lists?: SynthesisList[];
  comments?: CapturedComment[];
  reported_comment_count?: number | null;
  audio?: {
    title: string | null;
    artist: string | null;
    source_url: string | null;
    identification_method: "instagram_metadata" | "transcript_research" | "unidentified";
    confidence: "high" | "medium" | "low" | "unverified";
  };
  raw_model_output?: string;
  codex_usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
    reasoning_output_tokens?: number;
    total_tokens?: number;
  };
};

export interface Env {
  BROWSER?: BrowserWorker;
  REEL_CONTAINER: DurableObjectNamespace<ReelBrainContainer>;
  REEL_DB: D1Database;
  REEL_ARCHIVE: R2Bucket;
  REEL_LIBRARY_KV?: KVNamespace;
  SECOND_BRAIN_KV?: KVNamespace;
  REEL_QUEUE: Queue<ReelJobMessage>;
  AI: Ai;
  INGEST_MODE?: "disabled" | "test_only" | "live";
  PUBLIC_BASE_URL?: string;
  ADMIN_TOKEN?: string;
  PHASE5_CONTROL_TOKEN?: string;
  PHASE4_MIRROR_TOKEN?: string;
  PHASE4_REPLAY_TOKEN?: string;
  CALLBACK_SIGNING_KEY?: string;
  DOWNLOAD_SIGNING_KEY?: string;
  CODEX_AUTH_JSON?: string;
  CODEX_AUTH_STATE_KEY?: string;
  CODEX_RESEARCH_MODEL?: string;
  CODEX_RESEARCH_REASONING_EFFORT?: string;
  INSTAGRAM_ACCESS_TOKEN?: string;
  INSTAGRAM_USER_ID?: string;
  INSTAGRAM_GRAPH_VERSION?: string;
  INSTAGRAM_ALLOWED_SENDER_IDS?: string;
  META_APP_SECRET?: string;
  META_WEBHOOK_VERIFY_TOKEN?: string;
  REEL_LIBRARY_SHARED_TOKEN?: string;
  PHASE7_ORIGIN_URL?: string;
  PHASE7_ORIGIN_TOKEN?: string;
  REEL_ORIGIN?: Fetcher;
}

const ARTIFACT_KINDS = new Set([
  "video",
  "audio",
  "metadata",
  "comments",
  "transcript",
  "frame",
  "synthesis",
  "markdown",
  "resource_markdown",
  "carousel_item",
  "carousel_manifest",
]);

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value, null, 2), {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers || {}) },
  });
}

function tokenUsageFromPayload(payload: SynthesisPayload | null | undefined) {
  const raw = payload?.codex_usage;
  const value = (key: keyof NonNullable<SynthesisPayload["codex_usage"]>) => {
    const item = Number(raw?.[key]);
    return Number.isFinite(item) && item >= 0 ? Math.trunc(item) : null;
  };
  const input = value("input_tokens");
  const output = value("output_tokens");
  const total = value("total_tokens") ?? (input !== null || output !== null ? (input || 0) + (output || 0) : null);
  return {
    input_tokens: input,
    cached_input_tokens: value("cached_input_tokens"),
    output_tokens: output,
    reasoning_output_tokens: value("reasoning_output_tokens"),
    total_tokens: total,
  };
}

function tokenUsageFromJob(job: Partial<JobRow>) {
  return {
    input_tokens: job.codex_input_tokens ?? null,
    cached_input_tokens: job.codex_cached_input_tokens ?? null,
    output_tokens: job.codex_output_tokens ?? null,
    reasoning_output_tokens: job.codex_reasoning_output_tokens ?? null,
    total_tokens: job.codex_total_tokens ?? null,
  };
}

async function loadJobTokenUsage(env: Env, job: Partial<JobRow>) {
  const stored = tokenUsageFromJob(job);
  if (stored.total_tokens !== null || !job.synthesis_json_key) return stored;
  const object = await env.REEL_ARCHIVE.get(job.synthesis_json_key).catch(() => null);
  if (!object) return stored;
  const payload = await object.json<SynthesisPayload>().catch(() => null);
  return tokenUsageFromPayload(payload);
}

function databaseTimestampMs(value: string | null | undefined): number | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalised = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)
    ? `${raw.replace(" ", "T")}Z`
    : raw;
  const timestamp = Date.parse(normalised);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function processingSecondsSince(createdAt: string, completedAtMs = Date.now()): number {
  const createdAtMs = databaseTimestampMs(createdAt);
  if (createdAtMs === null) return 0;
  return Math.max(0, Math.round(((completedAtMs - createdAtMs) / 1000) * 10) / 10);
}

function bearer(request: Request): string {
  const header = request.headers.get("authorization") || "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let different = 0;
  for (let index = 0; index < left.length; index += 1) different |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return different === 0;
}

function collectStrings(value: unknown, output: string[] = [], depth = 0): string[] {
  if (depth > 8 || output.length >= 80 || value == null) return output;
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim().slice(0, 3000);
    if (text && !output.includes(text)) output.push(text);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output, depth + 1);
    return output;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectStrings(item, output, depth + 1);
  }
  return output;
}

function instagramUrls(values: string[]): string[] {
  const matches = values.join("\n").match(/https?:\/\/(?:www\.)?instagram\.com\/(?:[A-Za-z0-9_.-]+\/)?(?:reel|p|tv)\/[A-Za-z0-9_-]+\/?(?:\?[^\s<>"']*)?/gi) || [];
  return [...new Set(matches.map((url) => url.replace(/[),.;]+$/, "")))];
}

type DirectMessageEvent = {
  senderId: string;
  messageId: string;
  text: string;
  urls: string[];
  hasShareAttachment: boolean;
  raw: unknown;
};

function attachmentItems(...values: unknown[]): unknown[] {
  const output: unknown[] = [];
  for (const value of values) {
    if (Array.isArray(value)) output.push(...value);
    else if (value && typeof value === "object") output.push(value);
  }
  return output;
}

function looksLikeShareAttachment(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const strings = collectStrings(value);
  const typeValues = strings.map((item) => item.toLowerCase());
  if (typeValues.some((item) => ["share", "reel", "ig_reel", "ig_post", "video", "image", "carousel", "post"].includes(item))) return true;
  if (instagramUrls(strings).length || strings.some((item) => instagramPostUrlFromCdnUrl(item))) return true;
  const keys = Object.keys(value as Record<string, unknown>).map((key) => key.toLowerCase());
  return keys.some((key) => ["attachment", "attachments", "share", "shares", "media", "carousel"].includes(key));
}

function directMessageEvents(payload: unknown): DirectMessageEvent[] {
  const root = payload as { entry?: unknown[] };
  const events: DirectMessageEvent[] = [];
  for (const rawEntry of Array.isArray(root?.entry) ? root.entry : []) {
    const entry = rawEntry as { messaging?: unknown[]; changes?: unknown[] };
    const candidates = [
      ...(Array.isArray(entry.messaging) ? entry.messaging : []),
      ...(Array.isArray(entry.changes)
        ? entry.changes.map((change) => (change as { value?: unknown }).value).filter(Boolean)
        : []),
    ];
    for (const raw of candidates) {
      const item = raw as {
        sender?: { id?: unknown };
        message?: { mid?: unknown; text?: unknown; attachments?: unknown; shares?: unknown };
        attachments?: unknown;
        shares?: unknown;
        mid?: unknown;
        text?: unknown;
      };
      const strings = collectStrings(raw);
      const senderId = String(item.sender?.id || "").trim();
      const messageId = String(item.message?.mid || item.mid || "").trim();
      const messageText = String(item.message?.text || item.text || "").trim().slice(0, 3000);
      const urls = [...new Set([
        ...instagramUrls([messageText, ...strings]),
        ...strings.map(instagramPostUrlFromCdnUrl).filter((value): value is string => Boolean(value)),
      ])];
      const attachments = attachmentItems(item.message?.attachments, item.message?.shares, item.attachments, item.shares);
      const hasShareAttachment = attachments.some(looksLikeShareAttachment);
      if (senderId || messageId || messageText || urls.length || hasShareAttachment) {
        events.push({ senderId, messageId, text: messageText, urls, hasShareAttachment, raw });
      }
    }
  }
  return events;
}

function instagramSourceFromPayload(payload: unknown): { sourceUrl: string | null; hasShareAttachment: boolean } {
  const strings = collectStrings(payload);
  const urls = [...new Set([
    ...instagramUrls(strings),
    ...strings.map(instagramPostUrlFromCdnUrl).filter((value): value is string => Boolean(value)),
  ])];
  const sourceUrl = urls.find((candidate) => canonicalizeInstagramUrl(candidate)) || null;
  return { sourceUrl, hasShareAttachment: looksLikeShareAttachment(payload) };
}

function instagramMediaIdsFromPayload(value: unknown, output: string[] = [], depth = 0): string[] {
  if (depth > 8 || output.length >= 12 || value == null) return output;
  if (Array.isArray(value)) {
    for (const item of value) instagramMediaIdsFromPayload(item, output, depth + 1);
    return output;
  }
  if (typeof value !== "object") return output;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const normalisedKey = key.toLowerCase();
    if (["ig_post_media_id", "reel_video_id", "media_id", "asset_id"].includes(normalisedKey)) {
      const candidate = String(item || "").trim();
      if (/^\d{8,30}$/.test(candidate) && !output.includes(candidate)) output.push(candidate);
    }
    if (normalisedKey === "url" && typeof item === "string") {
      try {
        const candidate = new URL(item).searchParams.get("asset_id") || "";
        if (/^\d{8,30}$/.test(candidate) && !output.includes(candidate)) output.push(candidate);
      } catch {
        // Not a URL; recurse below in case the value is structured data.
      }
    }
    instagramMediaIdsFromPayload(item, output, depth + 1);
  }
  return output;
}

async function resolveInstagramMediaIds(
  env: Env,
  payload: unknown,
): Promise<{ sourceUrl: string | null; diagnostics: Array<Record<string, unknown>> }> {
  if (!env.INSTAGRAM_ACCESS_TOKEN) return { sourceUrl: null, diagnostics: [{ error: "INSTAGRAM_ACCESS_TOKEN unavailable" }] };
  const version = env.INSTAGRAM_GRAPH_VERSION || "v24.0";
  const headers = { authorization: `Bearer ${env.INSTAGRAM_ACCESS_TOKEN}` };
  const diagnostics: Array<Record<string, unknown>> = [];
  for (const mediaId of instagramMediaIdsFromPayload(payload)) {
    for (const host of ["graph.instagram.com", "graph.facebook.com"]) {
      const url = new URL(`https://${host}/${version}/${encodeURIComponent(mediaId)}`);
      url.searchParams.set("fields", "id,permalink,shortcode,media_type,media_product_type");
      const response = await fetch(url.toString(), { headers }).catch(() => null);
      if (!response) {
        diagnostics.push({ media_id: mediaId, host, error: "network_failure" });
        continue;
      }
      const body: Record<string, unknown> = await response.json<Record<string, unknown>>()
        .catch(async () => ({ detail: (await response.text()).slice(0, 500) }));
      const permalink = typeof body.permalink === "string" ? body.permalink : null;
      const shortcode = typeof body.shortcode === "string" ? body.shortcode : null;
      const candidate = permalink || (shortcode ? `https://www.instagram.com/p/${shortcode}/` : null);
      const canonical = candidate ? canonicalizeInstagramUrl(candidate) : null;
      diagnostics.push({ media_id: mediaId, host, http_status: response.status, body });
      if (canonical) return { sourceUrl: canonical.url, diagnostics };
    }
  }
  return { sourceUrl: null, diagnostics };
}

async function recoverInstagramMessage(
  env: Env,
  messageId: string,
  initialPayload?: unknown,
): Promise<{ sourceUrl: string | null; hasShareAttachment: boolean; payload: unknown } | null> {
  if (!env.INSTAGRAM_ACCESS_TOKEN || !env.INSTAGRAM_USER_ID || !messageId) return null;
  const version = env.INSTAGRAM_GRAPH_VERSION || "v24.0";
  const headers = { authorization: `Bearer ${env.INSTAGRAM_ACCESS_TOKEN}` };
  let capturedShareAttachment = false;
  const accumulatedMediaDiagnostics: Array<Record<string, unknown>> = [];
  if (initialPayload) {
    const initialSource = instagramSourceFromPayload(initialPayload);
    capturedShareAttachment = initialSource.hasShareAttachment;
    if (initialSource.sourceUrl) return { ...initialSource, payload: initialPayload };
    const mediaResolution = await resolveInstagramMediaIds(env, initialPayload);
    accumulatedMediaDiagnostics.push(...mediaResolution.diagnostics);
    if (mediaResolution.sourceUrl) {
      return {
        sourceUrl: mediaResolution.sourceUrl,
        hasShareAttachment: initialSource.hasShareAttachment,
        payload: { message: initialPayload, media_resolution: accumulatedMediaDiagnostics },
      };
    }
  }
  const directUrl = new URL(`https://graph.instagram.com/${version}/${encodeURIComponent(messageId)}`);
  directUrl.searchParams.set("fields", "id,created_time,from,to,message,attachments,shares");
  const direct = await fetch(directUrl.toString(), { headers }).catch(() => null);
  if (direct?.ok) {
    const payload = await direct.json<unknown>().catch(() => null);
    const source = instagramSourceFromPayload(payload);
    if (source.sourceUrl) return { ...source, payload };
    const mediaResolution = await resolveInstagramMediaIds(env, payload);
    accumulatedMediaDiagnostics.push(...mediaResolution.diagnostics);
    if (mediaResolution.sourceUrl) return { sourceUrl: mediaResolution.sourceUrl, hasShareAttachment: source.hasShareAttachment || capturedShareAttachment, payload: { captured: initialPayload, message: payload, media_resolution: accumulatedMediaDiagnostics } };
    if (source.hasShareAttachment) return { ...source, hasShareAttachment: true, payload: { captured: initialPayload, message: payload, media_resolution: accumulatedMediaDiagnostics } };
  }

  const conversationsUrl = new URL(`https://graph.instagram.com/${version}/${env.INSTAGRAM_USER_ID}/conversations`);
  conversationsUrl.searchParams.set("platform", "instagram");
  conversationsUrl.searchParams.set("fields", "messages.limit(25){id,created_time,from,to,message,attachments,shares}");
  conversationsUrl.searchParams.set("limit", "3");
  const response = await fetch(conversationsUrl.toString(), { headers }).catch(() => null);
  if (!response?.ok) return null;
  const payload = await response.json<{ data?: Array<{ messages?: { data?: unknown[] } }> }>()
    .catch((): { data?: Array<{ messages?: { data?: unknown[] } }> } => ({ data: [] }));
  const messages = (payload.data || []).flatMap((conversation) => conversation.messages?.data || []);
  const matched = messages.find((message) => String((message as { id?: unknown }).id || "") === messageId);
  if (!matched) return null;
  const matchedSource = instagramSourceFromPayload(matched);
  if (matchedSource.sourceUrl) return { ...matchedSource, payload: matched };
  const mediaResolution = await resolveInstagramMediaIds(env, matched);
  accumulatedMediaDiagnostics.push(...mediaResolution.diagnostics);
  return {
    sourceUrl: mediaResolution.sourceUrl,
    hasShareAttachment: matchedSource.hasShareAttachment || capturedShareAttachment,
    payload: { captured: initialPayload, message: matched, media_resolution: accumulatedMediaDiagnostics },
  };
}

type PendingDmPart = {
  id: string;
  sender_id: string;
  source_message_id: string;
  kind: "share" | "instruction" | "unsupported_share";
  source_url: string | null;
  instructions: string | null;
};

async function storePendingDmPart(
  env: Env,
  input: { senderId: string; sourceMessageId: string; kind: PendingDmPart["kind"]; sourceUrl?: string; instructions?: string; expiresIn?: "5 minutes" | "24 hours"; isTest?: boolean },
): Promise<void> {
  const expiryModifier = input.expiresIn === "24 hours" ? "+24 hours" : "+5 minutes";
  await env.REEL_DB.prepare(
    `INSERT OR IGNORE INTO pending_dm_parts(id,sender_id,source_message_id,kind,source_url,instructions,is_test,expires_at)
     VALUES (?,?,?,?,?,?,?,datetime('now',?))`,
  ).bind(
    uuid(), input.senderId, input.sourceMessageId, input.kind, input.sourceUrl || null, input.instructions || null,
    input.isTest ? 1 : 0, expiryModifier,
  ).run();
}

async function takePendingDmPart(env: Env, senderId: string, kinds: PendingDmPart["kind"][]): Promise<PendingDmPart | null> {
  const placeholders = kinds.map(() => "?").join(",");
  const pending = await env.REEL_DB.prepare(
    `SELECT id,sender_id,source_message_id,kind,source_url,instructions
     FROM pending_dm_parts
     WHERE sender_id=? AND consumed_at IS NULL AND expires_at >= CURRENT_TIMESTAMP AND kind IN (${placeholders})
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(senderId, ...kinds).first<PendingDmPart>();
  if (!pending) return null;
  const claimed = await env.REEL_DB.prepare(
    "UPDATE pending_dm_parts SET consumed_at=CURRENT_TIMESTAMP WHERE id=? AND consumed_at IS NULL",
  ).bind(pending.id).run();
  return claimed.meta.changes === 1 ? pending : null;
}

async function pairLiveInstructionWithShare(
  env: Env,
  input: { senderId: string; instructionMessageId: string; instructions: string },
): Promise<{ paired: boolean; shareMessageId?: string; late?: boolean; result: Record<string, unknown> }> {
  return pairLiveInstructionWithPendingShare({
    takePendingShare: (senderId) => takePendingDmPart(env, senderId, ["share"]),
    storePendingInstruction: (pendingInput) => storePendingDmPart(env, {
      senderId: pendingInput.senderId,
      sourceMessageId: pendingInput.instructionMessageId,
      kind: "instruction",
      instructions: pendingInput.instructions,
      expiresIn: "5 minutes",
    }),
    markInstructionWaiting: ({ instructionMessageId, result }) => env.REEL_DB.prepare(
      "UPDATE dm_commands SET status='waiting_for_share', result_summary=? WHERE source_message_id=?",
    ).bind(JSON.stringify(result), instructionMessageId).run().then(() => undefined),
    readTargetState: async (shareMessageId) => {
      const job = await env.REEL_DB.prepare(
        "SELECT id,status,stage FROM jobs WHERE source_message_id=? ORDER BY created_at DESC LIMIT 1",
      ).bind(shareMessageId).first<{ id: string; status: string; stage: string }>();
      const carousel = await env.REEL_DB.prepare(
        "SELECT status FROM instagram_carousel_resolutions WHERE source_message_id=?",
      ).bind(shareMessageId).first<{ status: string }>();
      return { job, carousel };
    },
    applyInstruction: (paired) => env.REEL_DB.batch([
      env.REEL_DB.prepare(
        "UPDATE dm_commands SET input_text=?,result_summary=? WHERE source_message_id=?",
      ).bind(paired.instructions, JSON.stringify(paired.originalSummary), paired.shareMessageId),
      env.REEL_DB.prepare(
        "UPDATE dm_commands SET status=?,result_summary=?,completed_at=CURRENT_TIMESTAMP WHERE source_message_id=?",
      ).bind(paired.late ? "paired_late" : "paired", JSON.stringify(paired.result), paired.instructionMessageId),
      env.REEL_DB.prepare(
        "UPDATE jobs SET instructions=?,updated_at=CURRENT_TIMESTAMP WHERE source_message_id=? AND status='queued' AND stage='queued'",
      ).bind(paired.instructions, paired.shareMessageId),
    ]).then(() => undefined),
  }, input);
}

async function takeLiveInstructionForShare(
  env: Env,
  input: { senderId: string; shareMessageId: string },
): Promise<string | null> {
  return takePendingInstructionForShare({
    takePendingInstruction: (senderId) => takePendingDmPart(env, senderId, ["instruction"]),
    applyPendingInstructionToShare: (paired) => env.REEL_DB.batch([
      env.REEL_DB.prepare(
        "UPDATE dm_commands SET status='paired',result_summary=?,completed_at=CURRENT_TIMESTAMP WHERE source_message_id=?",
      ).bind(JSON.stringify(paired.result), paired.instructionMessageId),
      env.REEL_DB.prepare(
        "UPDATE dm_commands SET input_text=?,result_summary=? WHERE source_message_id=?",
      ).bind(paired.instructions, JSON.stringify(paired.originalSummary), paired.shareMessageId),
    ]).then(() => undefined),
  }, input);
}

async function requestPermalinkForUnresolvedShare(
  env: Env,
  input: { senderId: string; sourceMessageId: string; instructions?: string },
): Promise<{ ok: true; waiting_for: string; reason: string; request_sent: boolean; idempotent: boolean }> {
  await storePendingDmPart(env, {
    senderId: input.senderId,
    sourceMessageId: input.sourceMessageId,
    kind: "unsupported_share",
    instructions: input.instructions || "",
    expiresIn: "24 hours",
  });
  const previous = await env.REEL_DB.prepare(
    "SELECT id FROM outbound_events WHERE source_message_id=? AND kind='permalink_required' AND status='sent' ORDER BY created_at DESC LIMIT 1",
  ).bind(input.sourceMessageId).first<{ id: string }>();
  let requested = true;
  if (!previous) {
    await reactToSourceMessage(env, { id: null, source_message_id: input.sourceMessageId, sender_id: input.senderId }, "error_media");
    requested = await sendInstagramText(
      env,
      input.senderId,
      "I received this post, but Instagram did not provide its source link or complete carousel. Paste the Instagram post link here within 24 hours and I’ll continue automatically.",
      input.sourceMessageId,
      "permalink_required",
    );
  }
  const result = {
    ok: true as const,
    waiting_for: "instagram_permalink",
    reason: "meta_withheld_third_party_post_permalink",
    request_sent: requested,
    idempotent: Boolean(previous),
  };
  await env.REEL_DB.prepare(
    "UPDATE dm_commands SET intent='unsupported_share',status='waiting_for_permalink',result_summary=? WHERE source_message_id=?",
  ).bind(JSON.stringify(result), input.sourceMessageId).run();
  return result;
}

type InstagramBrowserCookie = Pick<Cookie, "name" | "value" | "domain" | "path" | "expires" | "httpOnly" | "secure" | "sameSite">;

function instagramPostAttachment(payload: unknown): { mediaId: string; title: string } | null {
  if (!payload || typeof payload !== "object") return null;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = instagramPostAttachment(item);
      if (found) return found;
    }
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (String(record.type || "").toLowerCase() === "ig_post" && record.payload && typeof record.payload === "object") {
    const attachment = record.payload as Record<string, unknown>;
    const mediaId = String(attachment.ig_post_media_id || "").trim();
    if (/^\d{8,30}$/.test(mediaId)) return { mediaId, title: String(attachment.title || "").trim().slice(0, 3000) };
  }
  for (const value of Object.values(record)) {
    const found = instagramPostAttachment(value);
    if (found) return found;
  }
  return null;
}

async function loadInstagramBrowserCookies(env: Env): Promise<InstagramBrowserCookie[] | null> {
  const value = await loadRuntimeSecret(env, "instagram_browser_cookies");
  if (!value) return null;
  try {
    const cookies = JSON.parse(value) as InstagramBrowserCookie[];
    return Array.isArray(cookies) && cookies.some((cookie) => cookie.name === "sessionid" && cookie.value) ? cookies : null;
  } catch {
    return null;
  }
}

function instagramCookieHeader(cookies: InstagramBrowserCookie[]): string {
  const now = Date.now() / 1000;
  return cookies
    .filter((cookie) => (!cookie.expires || cookie.expires < 0 || cookie.expires > now) && /instagram\.com$/i.test(cookie.domain.replace(/^\./, "")))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

function instagramCookieValue(cookies: InstagramBrowserCookie[], name: string): string {
  return cookies.find((cookie) => cookie.name === name)?.value || "";
}

function instagramDirectHeaders(cookies: InstagramBrowserCookie[]): Record<string, string> {
  return {
    accept: "application/json",
    cookie: instagramCookieHeader(cookies),
    referer: "https://www.instagram.com/direct/inbox/",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36",
    "x-asbd-id": "129477",
    "x-csrftoken": instagramCookieValue(cookies, "csrftoken"),
    "x-ig-app-id": "936619743392459",
    "x-requested-with": "XMLHttpRequest",
  };
}

function instagramWebhookTimestampMs(payload: unknown): number | null {
  const timestamps: number[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (/^(?:time|timestamp|created_at)$/i.test(key)) {
        const numeric = Number(child);
        if (Number.isFinite(numeric) && numeric > 1_000_000_000) {
          const milliseconds = numeric > 10_000_000_000_000
            ? Math.round(numeric / 1000)
            : numeric > 10_000_000_000 ? Math.round(numeric) : Math.round(numeric * 1000);
          if (milliseconds <= Date.now() + 24 * 60 * 60_000) timestamps.push(milliseconds);
        }
      }
      visit(child);
    }
  };
  visit(payload);
  return timestamps.length ? Math.max(...timestamps) : null;
}

function instagramDirectThreads(payload: unknown): Array<Record<string, unknown>> {
  const root = payload as { inbox?: { threads?: unknown[] }; threads?: unknown[] } | null;
  const threads = root?.inbox?.threads || root?.threads || [];
  return Array.isArray(threads)
    ? threads.filter((thread): thread is Record<string, unknown> => Boolean(thread) && typeof thread === "object" && !Array.isArray(thread))
    : [];
}

async function fetchInstagramDirectJson(
  url: string,
  cookies: InstagramBrowserCookie[],
): Promise<{ payload: unknown; status: number; ok: boolean }> {
  const response = await fetch(url, { headers: instagramDirectHeaders(cookies) }).catch(() => null);
  if (!response) return { payload: null, status: 0, ok: false };
  const payload = await response.json<unknown>().catch(() => null);
  const apiStatus = payload && typeof payload === "object" ? String((payload as Record<string, unknown>).status || "") : "";
  return { payload, status: response.status, ok: response.ok && apiStatus !== "fail" };
}

function decodeInstagramHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function instagramOpenGraphValue(html: string, property: string): string {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const forward = html.match(new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"));
  const reverse = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["']`, "i"));
  return decodeInstagramHtmlAttribute(forward?.[1] || reverse?.[1] || "");
}

function instagramCarouselPayloadFromHtml(html: string): { items: Array<Record<string, unknown>> } | null {
  for (const match of html.matchAll(/<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const found = findInstagramCarouselMediaPayload(JSON.parse(match[1]) as unknown);
      if (found) return found;
    } catch {
      // Some application/json blocks are bootloader fragments rather than JSON.
    }
  }
  return null;
}

async function resolveInstagramCarouselSlidesFromHtml(
  sourceUrl: string,
  title: string | null | undefined,
  cookies: InstagramBrowserCookie[],
): Promise<{ sourceMediaJson: string | null; detail: string }> {
  const canonical = canonicalizeInstagramUrl(sourceUrl);
  if (!canonical) return { sourceMediaJson: null, detail: "html_invalid_canonical_url" };
  const anonymousHeaders = { accept: "text/html", "user-agent": instagramDirectHeaders(cookies)["user-agent"] };
  const anonymousPage = await fetch(canonical.url, { headers: anonymousHeaders, redirect: "follow" }).catch(() => null);
  if (anonymousPage?.ok) {
    const payload = instagramCarouselPayloadFromHtml(await anonymousPage.text());
    if (payload) {
      const count = Array.isArray(payload.items[0]?.carousel_media) ? payload.items[0].carousel_media.length : 0;
      return { sourceMediaJson: JSON.stringify(payload), detail: `html_embedded_carousel_${count}` };
    }
  }
  const slides: string[] = [];
  const seen = new Set<string>();
  let caption = String(title || "");
  for (let index = 1; index <= 20; index += 1) {
    const url = new URL(canonical.url);
    url.searchParams.set("img_index", String(index));
    const response = await fetch(url.toString(), { headers: instagramDirectHeaders(cookies), redirect: "follow" }).catch(() => null);
    if (!response?.ok) break;
    let html = await response.text();
    let imageUrl = instagramOpenGraphValue(html, "og:image") || instagramOpenGraphValue(html, "twitter:image");
    if (!imageUrl) {
      const anonymous = await fetch(url.toString(), {
        headers: anonymousHeaders,
        redirect: "follow",
      }).catch(() => null);
      if (anonymous?.ok) {
        html = await anonymous.text();
        imageUrl = instagramOpenGraphValue(html, "og:image") || instagramOpenGraphValue(html, "twitter:image");
      }
    }
    if (!caption) caption = instagramOpenGraphValue(html, "og:description");
    if (!/^https:\/\//i.test(imageUrl) || seen.has(imageUrl)) break;
    seen.add(imageUrl);
    slides.push(imageUrl);
  }
  if (slides.length <= 1) return { sourceMediaJson: null, detail: `html_open_graph_${slides.length}` };
  return {
    sourceMediaJson: JSON.stringify({ items: [{
      code: canonical.shortcode,
      caption: { text: caption },
      user: { username: "unknown" },
      carousel_media: slides.map((url, index) => ({
        pk: `html-${index + 1}`,
        image_versions2: { candidates: [{ url }] },
      })),
    }] }),
    detail: `html_open_graph_${slides.length}`,
  };
}

async function resolveInstagramMediaFromDirect(
  lookup: { mediaId: string; title?: string | null; timestampMs?: number | null },
  cookies: InstagramBrowserCookie[],
): Promise<{ sourceUrl: string | null; method: string; detail?: string; sourceMediaJson?: string | null }> {
  let inspectedThreads = 0;
  let inspectedInboxPages = 0;
  let inspectedThreadPages = 0;
  let lastHttpFailure = "";
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const inboxUrl = new URL("https://www.instagram.com/api/v1/direct_v2/inbox/");
    inboxUrl.searchParams.set("visual_message_return_type", "unseen");
    inboxUrl.searchParams.set("thread_message_limit", "50");
    inboxUrl.searchParams.set("persistentBadging", "true");
    inboxUrl.searchParams.set("limit", "20");
    let inboxCursor = "";
    const threadIds = new Set<string>();
    for (let pageNumber = 0; pageNumber < 2; pageNumber += 1) {
      if (inboxCursor) inboxUrl.searchParams.set("cursor", inboxCursor);
      const inbox = await fetchInstagramDirectJson(inboxUrl.toString(), cookies);
      inspectedInboxPages += 1;
      if (!inbox.ok) {
        lastHttpFailure = `inbox_HTTP_${inbox.status || "network"}`;
        break;
      }
      const match = findInstagramDirectPermalink(inbox.payload, lookup);
      if (match) {
        return {
          sourceUrl: match.sourceUrl,
          method: "instagram_direct_http",
          detail: [...match.matchedBy, `direct_attempt_${attempt}`].join("+"),
          sourceMediaJson: match.mediaPayload ? JSON.stringify(match.mediaPayload) : null,
        };
      }
      const threads = instagramDirectThreads(inbox.payload);
      for (const thread of threads.slice(0, 10)) {
        const threadId = String(thread.thread_id || thread.id || "").trim();
        if (threadId) threadIds.add(threadId);
      }
      const root = inbox.payload as { inbox?: { oldest_cursor?: unknown; has_older?: unknown } } | null;
      const nextCursor = String(root?.inbox?.oldest_cursor || "").trim();
      if (!nextCursor || root?.inbox?.has_older === false || nextCursor === inboxCursor) break;
      inboxCursor = nextCursor;
    }

    for (const threadId of [...threadIds].slice(0, 10)) {
      inspectedThreads += 1;
      let threadCursor = "";
      for (let pageNumber = 0; pageNumber < 3; pageNumber += 1) {
        const threadUrl = new URL(`https://www.instagram.com/api/v1/direct_v2/threads/${encodeURIComponent(threadId)}/`);
        threadUrl.searchParams.set("limit", "100");
        if (threadCursor) threadUrl.searchParams.set("cursor", threadCursor);
        const thread = await fetchInstagramDirectJson(threadUrl.toString(), cookies);
        inspectedThreadPages += 1;
        if (!thread.ok) {
          lastHttpFailure = `thread_HTTP_${thread.status || "network"}`;
          break;
        }
        const match = findInstagramDirectPermalink(thread.payload, lookup);
        if (match) {
          return {
            sourceUrl: match.sourceUrl,
            method: "instagram_direct_http",
            detail: [...match.matchedBy, `direct_attempt_${attempt}`].join("+"),
            sourceMediaJson: match.mediaPayload ? JSON.stringify(match.mediaPayload) : null,
          };
        }
        const root = thread.payload as { thread?: { oldest_cursor?: unknown; has_older?: unknown }; oldest_cursor?: unknown; has_older?: unknown } | null;
        const nextCursor = String(root?.thread?.oldest_cursor || root?.oldest_cursor || "").trim();
        const hasOlder = root?.thread?.has_older ?? root?.has_older;
        if (!nextCursor || hasOlder === false || nextCursor === threadCursor) break;
        threadCursor = nextCursor;
      }
    }
    if (attempt < maxAttempts) await new Promise<void>((resolve) => setTimeout(resolve, attempt * 1_000));
  }
  return {
    sourceUrl: null,
    method: "instagram_direct_http",
    detail: `no_matching_direct_item:${inspectedInboxPages}_inbox_pages:${inspectedThreads}_threads:${inspectedThreadPages}_thread_pages:${maxAttempts}_attempts${lastHttpFailure ? `;${lastHttpFailure}` : ""}`,
  };
}

function instagramCodeFromMediaInfo(payload: unknown): string | null {
  const root = payload as { items?: Array<{ code?: unknown }> };
  const code = String(root?.items?.[0]?.code || "").trim();
  return /^[A-Za-z0-9_-]{5,30}$/.test(code) ? code : null;
}

async function resolveInstagramMediaWithCookies(
  mediaId: string,
  cookies: InstagramBrowserCookie[],
): Promise<{ sourceUrl: string | null; method: string; detail?: string }> {
  const response = await fetch(`https://www.instagram.com/api/v1/media/${encodeURIComponent(mediaId)}/info/`, {
    headers: {
      accept: "application/json",
      cookie: instagramCookieHeader(cookies),
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36",
      "x-ig-app-id": "936619743392459",
      "x-requested-with": "XMLHttpRequest",
    },
  }).catch(() => null);
  if (!response) return { sourceUrl: null, method: "instagram_web_api", detail: "network_failure" };
  const body = await response.json<unknown>().catch(() => null);
  const code = instagramCodeFromMediaInfo(body);
  return {
    sourceUrl: code ? `https://www.instagram.com/p/${code}/` : null,
    method: "instagram_web_api",
    detail: code ? undefined : `HTTP ${response.status}`,
  };
}

async function resolveInstagramMediaWithBrowser(
  env: Env,
  mediaId: string,
  cookies: InstagramBrowserCookie[],
): Promise<{ sourceUrl: string | null; method: string; detail?: string }> {
  if (!env.BROWSER) return { sourceUrl: null, method: "cloudflare_browser", detail: "Browser binding unavailable" };
  const browser = await puppeteer.launch(env.BROWSER, { keep_alive: 120000 });
  try {
    const page = await browser.newPage();
    await page.setCookie(...cookies);
    await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
    const result = await page.evaluate(async (targetMediaId) => {
      const response = await fetch(`/api/v1/media/${encodeURIComponent(targetMediaId)}/info/`, {
        headers: { "x-ig-app-id": "936619743392459", "x-requested-with": "XMLHttpRequest" },
      });
      const payload = await response.json().catch(() => null) as { items?: Array<{ code?: unknown }> } | null;
      return { status: response.status, code: String(payload?.items?.[0]?.code || "") };
    }, mediaId);
    const code = /^[A-Za-z0-9_-]{5,30}$/.test(result.code) ? result.code : null;
    return { sourceUrl: code ? `https://www.instagram.com/p/${code}/` : null, method: "cloudflare_browser", detail: code ? undefined : `HTTP ${result.status}` };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function resolveInstagramCarouselSlidesWithBrowser(
  env: Env,
  sourceUrl: string,
  title: string | null | undefined,
  cookies: InstagramBrowserCookie[],
): Promise<{ sourceMediaJson: string | null; detail: string }> {
  if (!env.BROWSER) return { sourceMediaJson: null, detail: "browser_binding_unavailable" };
  const canonical = canonicalizeInstagramUrl(sourceUrl);
  if (!canonical) return { sourceMediaJson: null, detail: "invalid_canonical_url" };
  const browser = await puppeteer.launch(env.BROWSER, { keep_alive: 120000 });
  try {
    const page = await browser.newPage();
    let networkMediaJson: string | null = null;
    const networkTasks: Array<Promise<void>> = [];
    (page as any).on("response", (response: any) => {
      const responseUrl = String(response.url?.() || "");
      const contentType = String(response.headers?.()["content-type"] || "");
      if (!/(?:graphql|api\/v1)/i.test(responseUrl) || !/json/i.test(contentType)) return;
      const task = Promise.resolve(response.json())
        .then((payload: unknown) => {
          const mediaPayload = findInstagramCarouselMediaPayload(payload);
          if (mediaPayload && !networkMediaJson) networkMediaJson = JSON.stringify(mediaPayload);
        })
        .catch(() => undefined) as Promise<void>;
      networkTasks.push(task);
    });
    await page.setCookie(...cookies);
    await page.setViewport({ width: 1280, height: 1000 });
    await page.goto(canonical.url, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await Promise.allSettled(networkTasks);
    if (networkMediaJson) return { sourceMediaJson: networkMediaJson, detail: "browser_network_carousel" };
    const media: Array<{ type: "image" | "video"; url: string }> = [];
    const seen = new Set<string>();
    let username = "unknown";
    let clicks = 0;
    let articleFound = false;
    for (let index = 0; index < 20; index += 1) {
      const state = await page.evaluate(() => {
        const documentObject = (globalThis as unknown as { document: { querySelector(selector: string): any } }).document;
        const article = documentObject.querySelector("article");
        if (!article) return { media: [] as Array<{ type: "image" | "video"; url: string }>, clicked: false, username: "" };
        const rows: Array<{ type: "image" | "video"; url: string }> = [];
        for (const image of Array.from(article.querySelectorAll("img")) as any[]) {
          const rect = image.getBoundingClientRect();
          const url = image.currentSrc || image.src;
          if (rect.width >= 220 && rect.height >= 220 && /^https:\/\//i.test(url)) rows.push({ type: "image", url });
        }
        for (const video of Array.from(article.querySelectorAll("video")) as any[]) {
          const rect = video.getBoundingClientRect();
          const url = /^https:\/\//i.test(video.currentSrc || video.src) ? video.currentSrc || video.src : video.poster;
          if (rect.width >= 220 && rect.height >= 220 && /^https:\/\//i.test(url)) rows.push({ type: "video", url });
        }
        const profile = (Array.from(article.querySelectorAll('a[href^="/"]')) as any[])
          .map((link) => link.getAttribute("href") || "")
          .find((href) => /^\/[A-Za-z0-9._]+\/$/.test(href));
        const next = (Array.from(article.querySelectorAll("button")) as any[])
          .find((button) => button.getAttribute("aria-label")?.toLowerCase() === "next"
            || Boolean(button.querySelector('[aria-label="Next"], [aria-label="next"]')));
        if (next) next.click();
        return { media: rows, clicked: Boolean(next), username: profile ? profile.slice(1, -1) : "" };
      });
      articleFound ||= state.media.length > 0 || state.clicked;
      if (state.username) username = state.username;
      for (const item of state.media) {
        if (!seen.has(item.url)) {
          seen.add(item.url);
          media.push(item);
        }
      }
      if (!state.clicked) break;
      clicks += 1;
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    if (media.length <= 1) {
      const currentPath = (() => { try { return new URL(page.url()).pathname; } catch { return "unknown"; } })();
      const titleText = (await page.title().catch(() => "")).replace(/[^a-z0-9 _-]+/gi, "").slice(0, 60);
      return { sourceMediaJson: null, detail: `browser_media_${media.length}:clicks_${clicks}:article_${articleFound}:path_${currentPath}:title_${titleText}` };
    }
    const carouselMedia = media.map((item, index) => item.type === "video"
      ? { pk: `browser-${index + 1}`, video_versions: [{ url: item.url }] }
      : { pk: `browser-${index + 1}`, image_versions2: { candidates: [{ url: item.url }] } });
    return { sourceMediaJson: JSON.stringify({
      items: [{
        code: canonical.shortcode,
        caption: { text: String(title || "") },
        user: { username },
        carousel_media: carouselMedia,
      }],
    }), detail: `browser_media_${media.length}:clicks_${clicks}:article_${articleFound}` };
  } catch (error) {
    return { sourceMediaJson: null, detail: `browser_error:${error instanceof Error ? error.message.slice(0, 160) : "unknown"}` };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function resolveInstagramCarouselPermalink(
  env: Env,
  mediaId: string,
  title?: string | null,
  timestampMs?: number | null,
): Promise<{ sourceUrl: string | null; method: string; detail?: string; sourceMediaJson?: string | null }> {
  const cookies = await loadInstagramBrowserCookies(env);
  if (!cookies) return { sourceUrl: null, method: "instagram_browser_auth", detail: "Instagram browser authentication is not connected" };
  const directInbox = await resolveInstagramMediaFromDirect({ mediaId, title, timestampMs }, cookies);
  if (directInbox.sourceUrl) return directInbox;
  const direct = await resolveInstagramMediaWithCookies(mediaId, cookies);
  if (direct.sourceUrl) return direct;
  const browser = await resolveInstagramMediaWithBrowser(env, mediaId, cookies);
  return browser.sourceUrl ? browser : { ...browser, detail: `${directInbox.detail || "direct_lookup_failed"};${browser.detail || "browser_lookup_failed"}` };
}

async function enqueueCarouselResolution(
  env: Env,
  input: { senderId: string; sourceMessageId: string; raw: unknown; instructions?: string; queueDelayMode?: string },
): Promise<Record<string, unknown>> {
  const attachment = instagramPostAttachment(input.raw);
  if (!attachment) {
    const result = { ok: false, queued: false, status: "carousel_metadata_missing", notification: "none" };
    await env.REEL_DB.prepare(
      "UPDATE dm_commands SET intent='carousel',status='carousel_metadata_missing',error=?,result_summary=? WHERE source_message_id=?",
    ).bind("Instagram did not provide a usable carousel media identifier", JSON.stringify(result), input.sourceMessageId).run();
    await reactToSourceMessage(env, { id: null, source_message_id: input.sourceMessageId, sender_id: input.senderId }, "error_media");
    return result;
  }
  const existing = await env.REEL_DB.prepare(
    "SELECT status,source_url FROM instagram_carousel_resolutions WHERE source_message_id=?",
  ).bind(input.sourceMessageId).first<{ status: string; source_url: string | null }>();
  if (existing?.status === "complete") return { ok: true, duplicate: true, status: "complete", source_url: existing.source_url };
  if (!existing || !["queued", "running"].includes(existing.status)) {
    await env.REEL_DB.prepare(
      `INSERT INTO instagram_carousel_resolutions(source_message_id,sender_id,media_id,title,status,error,updated_at)
       VALUES (?,?,?,?,'queued',NULL,CURRENT_TIMESTAMP)
       ON CONFLICT(source_message_id) DO UPDATE SET sender_id=excluded.sender_id,media_id=excluded.media_id,title=excluded.title,status='queued',error=NULL,updated_at=CURRENT_TIMESTAMP`,
    ).bind(input.sourceMessageId, input.senderId, attachment.mediaId, attachment.title).run();
    await sendQueueMessageWithAdjacentInstructionDelay(env.REEL_QUEUE, { type: "carousel_resolve", sourceMessageId: input.sourceMessageId }, input.queueDelayMode || "");
  }
  await reactToSourceMessage(env, { id: null, source_message_id: input.sourceMessageId, sender_id: input.senderId }, "queued");
  const result = { ok: true, queued: true, status: "resolving_carousel", media_id: attachment.mediaId };
  await env.REEL_DB.prepare(
    "UPDATE dm_commands SET intent='carousel',status='resolving_carousel',result_summary=? WHERE source_message_id=?",
  ).bind(JSON.stringify(result), input.sourceMessageId).run();
  return result;
}

async function processCarouselResolution(env: Env, sourceMessageId: string): Promise<void> {
  const row = await env.REEL_DB.prepare(
    `SELECT c.*,w.raw_json
       FROM instagram_carousel_resolutions c
       LEFT JOIN inbound_webhook_events w ON w.source_message_id=c.source_message_id
      WHERE c.source_message_id=?`,
  ).bind(sourceMessageId).first<{ source_message_id: string; sender_id: string | null; media_id: string; title: string | null; status: string; source_url: string | null; attempts: number; raw_json: string | null }>();
  if (!row || row.status === "complete") return;
  await env.REEL_DB.prepare(
    "UPDATE instagram_carousel_resolutions SET status='running',attempts=attempts+1,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE source_message_id=?",
  ).bind(sourceMessageId).run();
  try {
    const rawWebhook = row.raw_json ? JSON.parse(row.raw_json) as unknown : null;
    const resolved = await resolveInstagramCarouselPermalink(env, row.media_id, row.title, instagramWebhookTimestampMs(rawWebhook));
    if (!resolved.sourceUrl) {
      const waitingForAuth = resolved.method === "instagram_browser_auth";
      await env.REEL_DB.batch([
        env.REEL_DB.prepare(
          "UPDATE instagram_carousel_resolutions SET status=?,resolution_method=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE source_message_id=?",
        ).bind(waitingForAuth ? "waiting_for_auth" : "failed", resolved.method, resolved.detail || "Carousel permalink was not resolved", sourceMessageId),
        env.REEL_DB.prepare(
          "UPDATE dm_commands SET status=?,error=?,result_summary=? WHERE source_message_id=?",
        ).bind(waitingForAuth ? "waiting_for_carousel_auth" : "carousel_resolution_failed", resolved.detail || null, JSON.stringify(resolved), sourceMessageId),
      ]);
      if (row.sender_id) {
        await reactToSourceMessage(
          env,
          { id: null, source_message_id: sourceMessageId, sender_id: row.sender_id },
          waitingForAuth ? "error_auth" : "error_media",
        );
      }
      return;
    }
    const command = await env.REEL_DB.prepare("SELECT input_text FROM dm_commands WHERE source_message_id=?")
      .bind(sourceMessageId).first<{ input_text: string | null }>();
    const job = await createJob(env, {
      sourceUrl: resolved.sourceUrl,
      instructions: command?.input_text || "",
      senderId: row.sender_id,
      sourceMessageId,
      sourceMediaJson: resolved.sourceMediaJson || null,
    });
    await env.REEL_DB.batch([
      env.REEL_DB.prepare(
        "UPDATE instagram_carousel_resolutions SET status='complete',source_url=?,resolution_method=?,error=NULL,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE source_message_id=?",
      ).bind(resolved.sourceUrl, resolved.method, sourceMessageId),
      env.REEL_DB.prepare(
        "UPDATE inbound_webhook_events SET recovered_url=?,updated_at=CURRENT_TIMESTAMP WHERE source_message_id=?",
      ).bind(resolved.sourceUrl, sourceMessageId),
      env.REEL_DB.prepare(
        "UPDATE dm_commands SET intent='carousel',status=?,result_job_id=?,result_summary=?,error=NULL WHERE source_message_id=?",
      ).bind(job.duplicate ? "complete" : "queued", job.id, JSON.stringify({ ...job, carousel_resolved: true, method: resolved.method }), sourceMessageId),
    ]);
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 500) : "Carousel resolver failed";
    await env.REEL_DB.prepare(
      "UPDATE instagram_carousel_resolutions SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE source_message_id=?",
    ).bind(detail, sourceMessageId).run();
    throw error;
  }
}

async function verifyMetaSignature(request: Request, env: Env, body: string): Promise<boolean> {
  const provided = request.headers.get("x-hub-signature-256") || "";
  if (!env.META_APP_SECRET || !provided.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.META_APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = `sha256=${hex(signed)}`;
  return timingSafeEqual(provided, expected);
}

function requireAdmin(request: Request, env: Env): Response | null {
  if (!env.ADMIN_TOKEN || bearer(request) !== env.ADMIN_TOKEN) {
    return json({ error: "Unauthorised" }, { status: 401 });
  }
  return null;
}

function requirePhase5Control(request: Request, env: Env): Response | null {
  const provided = bearer(request);
  const phase5Match = Boolean(env.PHASE5_CONTROL_TOKEN && provided === env.PHASE5_CONTROL_TOKEN);
  const adminMatch = Boolean(env.ADMIN_TOKEN && provided === env.ADMIN_TOKEN);
  if (!phase5Match && !adminMatch) return json({ error: "Unauthorised" }, { status: 401 });
  return null;
}

function uuid(): string {
  return crypto.randomUUID();
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string | ArrayBuffer): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

function secondBrainContentType(path: string): string {
  const extension = path.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] || "";
  return ({
    ".md": "text/markdown; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
  } as Record<string, string>)[extension] || "application/octet-stream";
}

function secondBrainRootPath(jobId: string): string {
  return `wiki/sources/instagram-reels/${jobId}.md`;
}

async function mirrorMarkdownToSecondBrain(env: Env, path: string, markdown: string): Promise<void> {
  if (!env.SECOND_BRAIN_KV) return;
  const encoded = new TextEncoder().encode(markdown);
  await env.SECOND_BRAIN_KV.put(`second-brain:file:${toBase64Url(path)}`, markdown, {
    metadata: {
      path,
      type: "markdown",
      content_type: "text/markdown; charset=utf-8",
      bytes: encoded.byteLength,
      sha256: await sha256(markdown),
      updated_at: new Date().toISOString(),
      updated_by: "instagram-reel-brain",
      source: "instagram-reel-brain",
    },
  });
}

async function refreshSecondBrainManifest(env: Env): Promise<void> {
  if (!env.SECOND_BRAIN_KV) return;
  const pages: Array<Record<string, unknown>> = [];
  let cursor: string | undefined;
  do {
    const result = await env.SECOND_BRAIN_KV.list({ prefix: "second-brain:file:", cursor });
    for (const key of result.keys) {
      const metadata = (key.metadata || {}) as Record<string, unknown>;
      let path = typeof metadata.path === "string" ? metadata.path : "";
      if (!path) {
        try {
          path = fromBase64Url(key.name.slice("second-brain:file:".length));
        } catch {
          continue;
        }
      }
      const isMarkdown = path.toLowerCase().endsWith(".md");
      const isAttachment = path.startsWith("80-Attachments/") && secondBrainContentType(path).startsWith("image/");
      if (!isMarkdown && !isAttachment) continue;
      pages.push({
        path,
        type: isMarkdown ? "markdown" : "image",
        content_type: metadata.content_type || secondBrainContentType(path),
        bytes: metadata.bytes || null,
        sha256: metadata.sha256 || "",
        updated_at: metadata.updated_at || "",
      });
    }
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);
  pages.sort((left, right) => String(left.path).localeCompare(String(right.path)));
  const manifest = { generated_at: new Date().toISOString(), file_count: pages.length, pages };
  await env.SECOND_BRAIN_KV.put("second-brain:manifest", JSON.stringify(manifest), {
    metadata: { generated_at: manifest.generated_at, file_count: manifest.file_count },
  });
}

const REEL_LIBRARY_FILE_PREFIX = "reel-library:file:";
const REEL_LIBRARY_MANIFEST_KEY = "reel-library:manifest";

function phase7OriginPath(base: string, kind: "object" | "library", path: string): string {
  const encoded = path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  return `${base.replace(/\/$/, "")}/v1/${kind === "object" ? "object" : "library/file"}/${encoded}`;
}

async function putPhase7Origin(
  env: Env,
  kind: "object" | "library",
  path: string,
  body: BodyInit,
  contentType: string,
  byteSize: number,
  contentSha256: string,
  libraryMetadata?: Record<string, unknown>,
): Promise<void> {
  if (!env.PHASE7_ORIGIN_URL || !env.PHASE7_ORIGIN_TOKEN) return;
  const headers: Record<string, string> = {
    authorization: `Bearer ${env.PHASE7_ORIGIN_TOKEN}`,
    "content-type": contentType,
    "content-length": String(byteSize),
    "x-content-sha256": contentSha256,
  };
  if (kind === "library" && libraryMetadata) {
    headers["x-phase7-library-metadata"] = toBase64Url(JSON.stringify(libraryMetadata));
  }
  const request = new Request(phase7OriginPath(env.PHASE7_ORIGIN_URL, kind, path), {
    method: "PUT",
    headers,
    body,
  });
  const response = env.REEL_ORIGIN ? await env.REEL_ORIGIN.fetch(request) : await fetch(request);
  if (!response.ok) throw new Error(`Phase 7 local ${kind} write failed (${response.status})`);
  const receipt = await response.json<{ ok?: boolean; bytes?: number; sha256?: string }>();
  if (receipt.ok !== true || Number(receipt.bytes) !== byteSize || receipt.sha256 !== contentSha256) {
    throw new Error(`Phase 7 local ${kind} receipt mismatch`);
  }
}

async function putPhase7MirroredObject(
  env: Env,
  key: string,
  value: string | ArrayBuffer,
  options: R2PutOptions,
): Promise<void> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  const digest = await sha256(value);
  const contentType = options.httpMetadata && "contentType" in options.httpMetadata
    ? options.httpMetadata.contentType || "application/octet-stream"
    : "application/octet-stream";
  await putPhase7Origin(env, "object", key, value, contentType, bytes.byteLength, digest);
  await env.REEL_ARCHIVE.put(key, value, options);
}

async function pushPhase7Wake(request: Request, env: Env): Promise<void> {
  if (!env.PHASE7_ORIGIN_URL || !env.PHASE7_ORIGIN_TOKEN) return;
  const url = new URL(request.url);
  const wakeRequest = new Request(`${env.PHASE7_ORIGIN_URL.replace(/\/$/, "")}/v1/wake`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.PHASE7_ORIGIN_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ wake_id: crypto.randomUUID(), path: url.pathname, accepted_at: new Date().toISOString() }),
  });
  const response = env.REEL_ORIGIN ? await env.REEL_ORIGIN.fetch(wakeRequest) : await fetch(wakeRequest);
  if (!response.ok) throw new Error(`Phase 7 wake failed (${response.status})`);
}

function reelLibraryPaths(job: JobRow, payload: SynthesisPayload): { root: string; directory: string } {
  const author = slugify(payload.metadata.author_username || job.author_username || "unknown-creator");
  const reel = slugify(payload.metadata.shortcode || job.shortcode || job.id);
  const directory = `reels/${author}/${reel}`;
  return { root: `${directory}/index.html`, directory };
}

async function putReelLibraryHtml(
  env: Env,
  path: string,
  html: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const encoded = new TextEncoder().encode(html);
  const digest = await sha256(html);
  const phase7Metadata = {
    kind: String(metadata.kind || "file").slice(0, 80),
    job_id: String(metadata.job_id || "").slice(0, 120),
    parent_path: String(metadata.parent_path || "").slice(0, 500),
    title: String(metadata.title || path).slice(0, 500),
    author: String(metadata.author || "").slice(0, 240),
    video_available: Boolean(metadata.video_available),
    media_type: String(metadata.media_type || "").slice(0, 80),
    resource_kind: String(metadata.resource_kind || "").slice(0, 120),
    resource_folder: String(metadata.resource_folder || "").slice(0, 240),
    artifact_type: String(metadata.artifact_type || "").slice(0, 120),
    summary: String(metadata.summary || "").slice(0, 1200),
    source_count: Math.max(0, Number(metadata.source_count) || 0),
  };
  await putPhase7Origin(env, "library", path, html, "text/html; charset=utf-8", encoded.byteLength, digest, phase7Metadata);
  if (!env.REEL_LIBRARY_KV) return;
  await env.REEL_LIBRARY_KV.put(`${REEL_LIBRARY_FILE_PREFIX}${toBase64Url(path)}`, html, {
    metadata: {
      path,
      content_type: "text/html; charset=utf-8",
      bytes: encoded.byteLength,
      sha256: digest,
      updated_at: new Date().toISOString(),
      source: "instagram-reel-brain",
      ...metadata,
    },
  });
}

async function refreshReelLibraryManifest(env: Env): Promise<void> {
  if (!env.REEL_LIBRARY_KV) return;
  const files: Array<Record<string, unknown>> = [];
  let cursor: string | undefined;
  do {
    const result = await env.REEL_LIBRARY_KV.list({ prefix: REEL_LIBRARY_FILE_PREFIX, cursor });
    for (const key of result.keys) {
      const metadata = (key.metadata || {}) as Record<string, unknown>;
      if (typeof metadata.path !== "string" || !metadata.path.endsWith(".html")) continue;
      files.push({
        path: metadata.path,
        kind: metadata.kind || "file",
        job_id: metadata.job_id || "",
        parent_path: metadata.parent_path || "",
        title: metadata.title || metadata.path,
        author: metadata.author || "",
        updated_at: metadata.updated_at || "",
        bytes: metadata.bytes || null,
        video_available: Boolean(metadata.video_available),
        media_type: metadata.media_type || "",
        resource_kind: metadata.resource_kind || "",
        resource_folder: metadata.resource_folder || "",
        artifact_type: metadata.artifact_type || "",
        summary: metadata.summary || "",
        source_count: metadata.source_count || 0,
      });
    }
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);
  files.sort((left, right) => String(left.path).localeCompare(String(right.path)));
  const manifest = { generated_at: new Date().toISOString(), file_count: files.length, files };
  await env.REEL_LIBRARY_KV.put(REEL_LIBRARY_MANIFEST_KEY, JSON.stringify(manifest), {
    metadata: { generated_at: manifest.generated_at, file_count: manifest.file_count },
  });
}

async function refreshArtifactCollectionPages(env: Env): Promise<void> {
  if (!env.REEL_LIBRARY_KV) return;
  const grouped = new Map<ArtifactType, Array<{
    name: string;
    libraryPath: string;
    rootPath: string;
    summary?: string;
    author?: string;
    sourceCount?: number;
  }>>();
  for (const artifactType of Object.keys(ARTIFACT_COLLECTION_DEFINITIONS) as ArtifactType[]) grouped.set(artifactType, []);
  let cursor: string | undefined;
  do {
    const result = await env.REEL_LIBRARY_KV.list({ prefix: REEL_LIBRARY_FILE_PREFIX, cursor });
    for (const key of result.keys) {
      const metadata = (key.metadata || {}) as Record<string, unknown>;
      if (metadata.kind !== "resource" || typeof metadata.path !== "string") continue;
      const name = String(metadata.title || metadata.path);
      const summary = String(metadata.summary || "");
      const artifactType = normalizeArtifactType(
        String(metadata.artifact_type || ""),
        String(metadata.resource_kind || ""),
        name,
        summary,
      );
      if (!artifactType) continue;
      grouped.get(artifactType)?.push({
        name,
        libraryPath: metadata.path,
        rootPath: String(metadata.parent_path || ""),
        summary,
        author: String(metadata.author || ""),
        sourceCount: Number(metadata.source_count || 1),
      });
    }
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);

  for (const [artifactType, definition] of Object.entries(ARTIFACT_COLLECTION_DEFINITIONS) as Array<[ArtifactType, typeof ARTIFACT_COLLECTION_DEFINITIONS[ArtifactType]]>) {
    const items = grouped.get(artifactType) || [];
    items.sort((left, right) => left.name.localeCompare(right.name));
    const path = `${definition.folder}/index.html`;
    await putReelLibraryHtml(env, path, renderArtifactCollectionHtml({ artifactType, items }), {
      kind: "artifact-index",
      job_id: "",
      parent_path: "",
      title: definition.title,
      author: "",
      video_available: false,
      artifact_type: artifactType,
      resource_folder: definition.folder,
      summary: definition.description,
    });
  }
}

async function refreshListCollectionPage(env: Env): Promise<void> {
  if (!env.REEL_LIBRARY_KV) return;
  const items: Array<{ title: string; libraryPath: string; summary?: string; author?: string; itemCount?: number }> = [];
  let cursor: string | undefined;
  do {
    const result = await env.REEL_LIBRARY_KV.list({ prefix: REEL_LIBRARY_FILE_PREFIX, cursor });
    for (const key of result.keys) {
      const metadata = (key.metadata || {}) as Record<string, unknown>;
      if (metadata.kind !== "list" || typeof metadata.path !== "string") continue;
      items.push({
        title: String(metadata.title || metadata.path),
        libraryPath: metadata.path,
        summary: String(metadata.summary || ""),
        author: String(metadata.author || ""),
        itemCount: Number(metadata.source_count || 0),
      });
    }
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);
  items.sort((left, right) => left.title.localeCompare(right.title));
  await putReelLibraryHtml(env, "lists/index.html", renderListCollectionHtml({ items }), {
    kind: "list-index",
    job_id: "",
    parent_path: "",
    title: "Lists",
    author: "",
    video_available: false,
    resource_folder: "lists",
    summary: `${items.length} ordered list${items.length === 1 ? "" : "s"} recreated from Instagram sources`,
    source_count: items.length,
  });
}

async function refreshYoutubeCollectionPages(env: Env, onlyVideoIds?: Set<string>): Promise<{ videos: number; published: number; removed: number }> {
  if (!env.REEL_LIBRARY_KV) return { videos: 0, published: 0, removed: 0 };
  const rows = await env.REEL_DB.prepare(
    `SELECT r.name AS resource_name,r.library_path AS resource_path,r.media_json,
      r.artifact_type,j.library_path AS reel_path,j.title AS reel_title,j.author_username
     FROM resources r JOIN jobs j ON j.id=r.job_id
     WHERE r.library_path IS NOT NULL
       AND json_array_length(json_extract(r.media_json,'$.youtube_candidates')) > 0
     ORDER BY r.name,j.completed_at,j.created_at`,
  ).all<{
    resource_name: string; resource_path: string; media_json: string; artifact_type: string | null;
    reel_path: string | null; reel_title: string | null; author_username: string | null;
  }>();
  const grouped = new Map<string, YoutubeVideoProfile>();
  const sourceKeys = new Map<string, Set<string>>();
  for (const row of rows.results) {
    let media: ResourceMedia;
    try { media = JSON.parse(row.media_json || "{}") as ResourceMedia; } catch { continue; }
    for (const candidate of media.youtube_candidates || []) {
      const id = youtubeVideoId(candidate.url);
      if (!id || !isYoutubeNativeCandidate({
        artifactType: row.artifact_type,
        resourceName: row.resource_name,
        candidateTitle: candidate.title,
        matchReason: candidate.match_reason,
      })) continue;
      let profile = grouped.get(id);
      if (!profile) {
        profile = {
          id,
          title: candidate.title || row.resource_name || "Untitled YouTube video",
          channel: candidate.channel || "Channel not recorded",
          url: candidate.url,
          confidence: candidate.confidence,
          matchReason: candidate.match_reason || "Stored during Reel research.",
          sources: [],
        };
        grouped.set(id, profile);
        sourceKeys.set(id, new Set());
      }
      const sourceKey = `${row.resource_path}|${row.reel_path || ""}`;
      if (sourceKeys.get(id)?.has(sourceKey)) continue;
      sourceKeys.get(id)?.add(sourceKey);
      profile.sources.push({
        resourceName: row.resource_name,
        resourcePath: row.resource_path,
        reelTitle: row.reel_title || "Untitled Instagram research",
        reelPath: row.reel_path || "",
        author: row.author_username || "unknown",
      });
    }
  }
  const videos = [...grouped.values()].sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
  const selected = onlyVideoIds ? videos.filter((video) => onlyVideoIds.has(video.id)) : videos;
  for (let offset = 0; offset < selected.length; offset += 12) {
    await Promise.all(selected.slice(offset, offset + 12).map((video) => {
      const path = `youtube/${video.id}.html`;
      return putReelLibraryHtml(env, path, renderYoutubeVideoHtml(video), {
        kind: "youtube-video",
        job_id: "",
        parent_path: "youtube/index.html",
        title: video.title,
        author: video.channel,
        video_available: false,
        resource_kind: "media",
        resource_folder: "youtube",
        artifact_type: "",
        summary: `${video.channel} · referenced by ${video.sources.length} stored profile${video.sources.length === 1 ? "" : "s"}`,
        source_count: video.sources.length,
      });
    }));
  }
  await putReelLibraryHtml(env, "youtube/index.html", renderYoutubeCollectionHtml(videos), {
    kind: "youtube-index",
    job_id: "",
    parent_path: "",
    title: "YouTube",
    author: "",
    video_available: false,
    resource_kind: "media",
    resource_folder: "youtube",
    artifact_type: "",
    summary: `${videos.length} creator-made YouTube work${videos.length === 1 ? "" : "s"}, deduplicated by video ID`,
    source_count: videos.length,
  });
  const retainedPaths = new Set(["youtube/index.html", ...videos.map((video) => `youtube/${video.id}.html`)]);
  let removed = 0;
  let cursor: string | undefined;
  do {
    const result = await env.REEL_LIBRARY_KV.list({ prefix: REEL_LIBRARY_FILE_PREFIX, cursor });
    const stale = result.keys.filter((key) => {
      const path = String(((key.metadata || {}) as Record<string, unknown>).path || "");
      return path.startsWith("youtube/") && !retainedPaths.has(path);
    });
    if (stale.length) await Promise.all(stale.map((key) => env.REEL_LIBRARY_KV!.delete(key.name)));
    removed += stale.length;
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);
  return { videos: videos.length, published: selected.length, removed };
}

function routeSynthesisResources(job: JobRow, payload: SynthesisPayload): RoutedSynthesisResource[] {
  const sourceSuffix = slugify(payload.metadata.shortcode || job.shortcode || job.id.slice(0, 8));
  return payload.resources.map((resource) => {
    const slug = slugify(resource.name);
    const kind = normalizeResourceKind(resource.kind, resource.name, resource.summary);
    const artifactType = normalizeArtifactType(resource.artifact_type, kind, resource.name, resource.summary);
    const canonicalKey = artifactType ? canonicalArtifactKey(artifactType, resource.name) : null;
    const heroImageUrl = artifactType === "music" && resource.hero_image_url
      ? highResolutionMusicArtworkUrl(resource.hero_image_url)
      : resource.hero_image_url;
    return { ...resource, hero_image_url: heroImageUrl, slug, kind, artifactType, canonicalKey, documentSlug: artifactType ? slug : `${slug}-${sourceSuffix}` };
  });
}

type RoutedSynthesisList = Omit<SynthesisList, "items"> & {
  libraryPath: string;
  items: Array<SynthesisList["items"][number] & { resourcePath: string }>;
};

function routeSynthesisLists(job: JobRow, payload: SynthesisPayload, resources: RoutedSynthesisResource[], resourcePaths: Map<string, string>): RoutedSynthesisList[] {
  const sourceSuffix = slugify(payload.metadata.shortcode || job.shortcode || job.id.slice(0, 8));
  const resourceByName = new Map(resources.map((resource) => [slugify(resource.name), resource]));
  const usedPaths = new Set<string>();
  return (Array.isArray(payload.lists) ? payload.lists : []).slice(0, 20).flatMap((list, listIndex) => {
    const title = String(list?.title || "").trim();
    const summary = String(list?.summary || "").trim();
    if (!title || !Array.isArray(list?.items)) return [];
    const items = list.items.slice(0, 200).flatMap((item, itemIndex) => {
      const label = String(item?.label || "").trim();
      const resource = resourceByName.get(slugify(String(item?.resource_name || label)));
      const resourcePath = resource ? resourcePaths.get(resource.slug) : null;
      if (!label || !resourcePath) return [];
      const requestedPosition = Number(item?.position);
      return [{
        position: Number.isInteger(requestedPosition) && requestedPosition > 0 ? requestedPosition : itemIndex + 1,
        label,
        description: String(item?.description || "").trim(),
        resource_name: resource!.name,
        resourcePath,
      }];
    }).sort((left, right) => left.position - right.position);
    if (items.length !== list.items.length || items.length < 2) {
      throw new Error(`List ${title} has an item without a matching researched resource profile`);
    }
    let libraryPath = `lists/${slugify(title)}-${sourceSuffix}.html`;
    if (usedPaths.has(libraryPath)) libraryPath = `lists/${slugify(title)}-${sourceSuffix}-${listIndex + 1}.html`;
    usedPaths.add(libraryPath);
    return [{ title, summary, items, libraryPath }];
  });
}

function wikipediaArtworkTitles(name: string, artifactType: ArtifactType, summary = ""): string[] {
  const cleaned = name.trim();
  if (artifactType === "film") {
    const titleYear = cleaned.match(/\(((?:19|20)\d{2})\)$/)?.[1];
    const summaryYear = summary.match(/\b((?:19|20)\d{2})\b/)?.[1];
    const year = titleYear || summaryYear;
    const base = titleYear ? cleaned.replace(/\s*\((?:19|20)\d{2}\)$/, "") : cleaned;
    return [...new Set([
      year ? `${base} (${year} film)` : "",
      `${base} (film)`,
      cleaned,
    ].filter(Boolean))];
  }
  const qualified = /\((?:TV series|television series)\)$/i.test(cleaned) ? cleaned : `${cleaned} (TV series)`;
  return qualified === cleaned ? [cleaned] : [qualified, cleaned];
}

function resolvedWikipediaTitle(
  title: string,
  mappings: Array<{ from?: string; to?: string }>,
): string {
  let current = title;
  for (let pass = 0; pass < 4; pass += 1) {
    const next = mappings.find((entry) => entry.from === current)?.to;
    if (!next || next === current) break;
    current = next;
  }
  return current;
}

function bestWikipediaArtworkFile(page: WikipediaPageImage, resourceName: string): string | null {
  const nameWords = resourceName.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
  const ranked = (page.images || []).flatMap((image) => {
    const title = String(image.title || "");
    if (!/^File:.+\.(?:jpe?g|png|webp)$/i.test(title)) return [];
    const lower = title.toLowerCase();
    let score = /poster|cover|key art/.test(lower) ? 100 : 0;
    score += nameWords.filter((word) => lower.includes(word)).length * 10;
    if (/icon|logo|flag|symbol|edit|protection|wikiquote|featured/.test(lower)) score -= 100;
    return [{ title, score }];
  }).sort((left, right) => right.score - left.score);
  return ranked[0] && ranked[0].score > 0 ? ranked[0].title : null;
}

async function wikipediaArtwork(resources: SynthesisResource[]): Promise<Map<number, { url: string; alt: string }>> {
  const targets = resources.flatMap((resource, index) => {
    const kind = normalizeResourceKind(resource.kind, resource.name, resource.summary);
    const artifactType = normalizeArtifactType(resource.artifact_type, kind, resource.name, resource.summary);
    if ((artifactType !== "film" && artifactType !== "tv_show") || resource.hero_image_url) return [];
    return [{ index, artifactType, titles: wikipediaArtworkTitles(resource.name, artifactType, resource.summary || "") }];
  });
  const results = new Map<number, { url: string; alt: string }>();
  // Keep both the page-title and image-file queries comfortably below MediaWiki's
  // URL/title limits. Large carousel result sets can otherwise lose later posters.
  const artworkBatchSize = 8;
  for (let offset = 0; offset < targets.length; offset += artworkBatchSize) {
    const batch = targets.slice(offset, offset + artworkBatchSize);
    const url = new URL("https://en.wikipedia.org/w/api.php");
    url.searchParams.set("action", "query");
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    url.searchParams.set("redirects", "1");
    url.searchParams.set("prop", "pageimages|images");
    url.searchParams.set("piprop", "original|thumbnail");
    url.searchParams.set("pithumbsize", "1200");
    // `imlimit` is shared across every page in this request, not applied per page.
    // Request the API maximum so later film/TV titles still receive poster files.
    url.searchParams.set("imlimit", "max");
    url.searchParams.set("titles", batch.flatMap((target) => target.titles).join("|"));
    try {
      const response = await fetch(url, { headers: { "user-agent": "Instagram-Reel-Brain/1.0 (private research archive)" } });
      if (!response.ok) continue;
      const payload = await response.json<{
        query?: {
          normalized?: Array<{ from?: string; to?: string }>;
          redirects?: Array<{ from?: string; to?: string }>;
          pages?: WikipediaPageImage[];
        };
      }>();
      const mappings = [...(payload.query?.normalized || []), ...(payload.query?.redirects || [])];
      const pages = new Map((payload.query?.pages || []).map((page) => [page.title || "", page]));
      const unresolvedFiles: Array<{ target: typeof batch[number]; title: string }> = [];
      for (const target of batch) {
        const candidatePages = target.titles.flatMap((title) => {
          const page = pages.get(resolvedWikipediaTitle(title, mappings));
          return page && !page.missing ? [page] : [];
        });
        const directImage = candidatePages.map((page) => page.original?.source || page.thumbnail?.source || "").find((source) => source.startsWith("https://")) || "";
        if (directImage) {
          results.set(target.index, {
            url: directImage,
            alt: `${resources[target.index].name} ${target.artifactType === "film" ? "film poster or cover image" : "television artwork"}`,
          });
        } else {
          const title = candidatePages.map((page) => bestWikipediaArtworkFile(page, resources[target.index].name)).find(Boolean);
          if (title) unresolvedFiles.push({ target, title });
        }
      }
      if (unresolvedFiles.length) {
        const imageUrl = new URL("https://en.wikipedia.org/w/api.php");
        imageUrl.searchParams.set("action", "query");
        imageUrl.searchParams.set("format", "json");
        imageUrl.searchParams.set("formatversion", "2");
        imageUrl.searchParams.set("prop", "imageinfo");
        imageUrl.searchParams.set("iiprop", "url");
        imageUrl.searchParams.set("iiurlwidth", "1200");
        imageUrl.searchParams.set("titles", unresolvedFiles.map((entry) => entry.title).join("|"));
        const imageResponse = await fetch(imageUrl, { headers: { "user-agent": "Instagram-Reel-Brain/1.0 (private research archive)" } });
        const imagePayload = imageResponse.ok ? await imageResponse.json<{ query?: { pages?: WikipediaPageImage[] } }>() : {};
        const imagePages = new Map((imagePayload.query?.pages || []).map((page) => [page.title || "", page]));
        for (const entry of unresolvedFiles) {
          const image = imagePages.get(entry.title)?.imageinfo?.[0];
          const source = image?.thumburl || image?.url || "";
          if (source.startsWith("https://")) {
            results.set(entry.target.index, {
              url: source,
              alt: `${resources[entry.target.index].name} ${entry.target.artifactType === "film" ? "film poster or cover image" : "television artwork"}`,
            });
          }
        }
      }
    } catch (error) {
      console.warn("Wikipedia artwork lookup failed", error instanceof Error ? error.message : String(error));
    }
  }
  return results;
}

async function enrichSynthesisResourceMedia(resources: SynthesisResource[]): Promise<SynthesisResource[]> {
  const artwork = await wikipediaArtwork(resources);
  return Promise.all(resources.map(async (resource, index) => {
    const kind = normalizeResourceKind(resource.kind, resource.name, resource.summary);
    const artifactType = normalizeArtifactType(resource.artifact_type, kind, resource.name, resource.summary);
    const media = applyMediaLinkFallbacks(resource, artifactType);
    if (artifactType === "music" && media.hero_image_url) {
      media.hero_image_url = highResolutionMusicArtworkUrl(media.hero_image_url);
    }
    const resolvedArtwork = artwork.get(index);
    if (resolvedArtwork && !media.hero_image_url) {
      media.hero_image_url = resolvedArtwork.url;
      media.hero_image_alt = resolvedArtwork.alt;
    }
    if (media.spotify_url && /^https:\/\/open\.spotify\.com\/(track|album|episode|show)\//i.test(media.spotify_url)) {
      try {
        const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(media.spotify_url)}`);
        const spotify = response.ok ? await response.json<{ thumbnail_url?: string }>() : {};
        if (spotify.thumbnail_url?.startsWith("https://") && (artifactType === "music" || !media.hero_image_url)) {
          media.hero_image_url = highResolutionMusicArtworkUrl(spotify.thumbnail_url);
          media.hero_image_alt = `${resource.name} Spotify artwork`;
        }
      } catch (error) {
        console.warn("Spotify artwork lookup failed", error instanceof Error ? error.message : String(error));
      }
    }
    return { ...resource, ...media };
  }));
}

type CanonicalArtifactRow = {
  name: string;
  kind: string | null;
  artifact_type: string;
  canonical_url: string | null;
  summary: string | null;
  why_useful: string | null;
  guide_text: string | null;
  evidence_json: string | null;
  media_json: string | null;
  job_id: string;
  reel_title: string | null;
  author_username: string | null;
  shortcode: string | null;
  root_path: string | null;
  media_type: "reel" | "carousel" | "post";
};

function longestText(rows: CanonicalArtifactRow[], field: "summary" | "why_useful" | "guide_text"): string {
  return rows.map((row) => String(row[field] || "").trim()).sort((left, right) => right.length - left.length)[0] || "Not recorded.";
}

async function refreshCanonicalArtifactPage(env: Env, canonicalKey: string): Promise<string | null> {
  const artifactType = canonicalKey.split(":", 1)[0] as ArtifactType;
  const definition = ARTIFACT_COLLECTION_DEFINITIONS[artifactType];
  if (!definition) return null;
  const rows = await env.REEL_DB.prepare(
    `SELECT r.name,r.kind,r.artifact_type,r.canonical_url,r.summary,r.why_useful,r.guide_text,r.evidence_json,r.media_json,
      j.id AS job_id,j.title AS reel_title,j.author_username,j.shortcode,j.library_path AS root_path,
      CASE WHEN EXISTS(SELECT 1 FROM artifacts a WHERE a.job_id=j.id AND a.kind='carousel_item') THEN 'carousel'
        WHEN COALESCE(j.canonical_url,j.source_url) LIKE '%/p/%' THEN 'post' ELSE 'reel' END AS media_type
     FROM resources r JOIN jobs j ON j.id=r.job_id
     WHERE r.canonical_key=? ORDER BY j.completed_at,j.created_at`,
  ).bind(canonicalKey).all<CanonicalArtifactRow>();
  if (!rows.results.length) return null;
  const names = rows.results.map((row) => row.name.trim()).filter(Boolean).sort((left, right) => left.length - right.length || left.localeCompare(right));
  const name = names[0] || canonicalKey.split(":").slice(1).join(":");
  const slug = canonicalKey.split(":").slice(1).join(":");
  const path = `${definition.folder}/${slug}.html`;
  const canonicalUrl = rows.results.map((row) => row.canonical_url).find(Boolean) || null;
  const sources = new Set<string>();
  for (const row of rows.results) {
    try {
      const values = JSON.parse(row.evidence_json || "[]");
      if (Array.isArray(values)) for (const value of values) if (String(value || "").trim()) sources.add(String(value).trim());
    } catch {
      // A malformed legacy evidence field should not prevent the shared profile from publishing.
    }
  }
  const sourceReels = [...new Map(rows.results.map((row) => {
    const rootPath = row.root_path || `reels/${slugify(row.author_username || "unknown-creator")}/${slugify(row.shortcode || row.job_id)}/index.html`;
    return [row.job_id, {
      jobId: row.job_id,
      rootPath,
      title: row.reel_title || "Untitled Instagram research",
      author: row.author_username || "unknown",
      mediaType: row.media_type,
    }] as const;
  })).values()];
  const media = rows.results.flatMap((row) => {
    try {
      const value = JSON.parse(row.media_json || "null") as ResourceMedia | null;
      return value && typeof value === "object" ? [value] : [];
    } catch {
      return [];
    }
  }).sort((left, right) => JSON.stringify(right).length - JSON.stringify(left).length)[0] || null;
  const html = renderResourceHtml({
    rootId: sourceReels[0]?.jobId || "",
    rootPath: "",
    name,
    kind: rows.results[0].kind,
    canonicalUrl,
    summary: longestText(rows.results, "summary"),
    whyUseful: longestText(rows.results, "why_useful"),
    guide: longestText(rows.results, "guide_text"),
    sources: [...sources],
    artifactType,
    sourceReels,
    media,
  });
  const key = `library/${path}`;
  await env.REEL_ARCHIVE.put(key, html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
  await putReelLibraryHtml(env, path, html, {
    kind: "resource",
    job_id: "",
    parent_path: "",
    title: name,
    author: "",
    video_available: false,
    resource_kind: rows.results[0].kind || "media",
    resource_folder: definition.folder,
    artifact_type: artifactType,
    summary: longestText(rows.results, "summary"),
    source_count: sourceReels.length,
  });
  await env.REEL_DB.prepare("UPDATE resources SET guide_html_key=?,library_path=? WHERE canonical_key=?")
    .bind(key, path, canonicalKey).run();
  return path;
}

async function removeSupersededReelLibraryFiles(
  env: Env,
  jobId: string,
  keepPaths: Set<string>,
  legacyResourcePrefix: string,
): Promise<void> {
  if (!env.REEL_LIBRARY_KV) return;
  let cursor: string | undefined;
  do {
    const result = await env.REEL_LIBRARY_KV.list({ prefix: REEL_LIBRARY_FILE_PREFIX, cursor });
    for (const key of result.keys) {
      const metadata = (key.metadata || {}) as Record<string, unknown>;
      const path = typeof metadata.path === "string" ? metadata.path : "";
      const belongsToJob = metadata.job_id === jobId || path.startsWith(legacyResourcePrefix);
      if (belongsToJob && path && !keepPaths.has(path)) {
        await env.REEL_LIBRARY_KV.delete(key.name);
      }
    }
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);
}

function normalizeCapturedComments(value: unknown): CapturedComment[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const text = String(row.text || "").trim();
    if (!text) return [];
    return [{
      id: String(row.id || ""),
      author: String(row.author || ""),
      text,
      like_count: typeof row.like_count === "number" ? row.like_count : null,
      timestamp: typeof row.timestamp === "string" || typeof row.timestamp === "number" ? row.timestamp : null,
    }];
  });
}

async function loadCapturedCommentBundle(
  env: Env,
  job: JobRow,
  payload: SynthesisPayload,
): Promise<{ comments: CapturedComment[]; reportedCommentCount: number | null }> {
  let comments = normalizeCapturedComments(payload.comments);
  let reportedCommentCount = typeof payload.reported_comment_count === "number" ? payload.reported_comment_count : null;
  if (comments.length && reportedCommentCount !== null) return { comments, reportedCommentCount };

  const artifacts = await env.REEL_DB.prepare(
    "SELECT kind, object_key FROM artifacts WHERE job_id=? AND kind IN ('comments','metadata') ORDER BY created_at",
  ).bind(job.id).all<{ kind: string; object_key: string }>();

  if (!comments.length) {
    const commentArtifact = artifacts.results.find((artifact) => artifact.kind === "comments");
    if (commentArtifact) {
      const object = await env.REEL_ARCHIVE.get(commentArtifact.object_key);
      if (object) comments = normalizeCapturedComments(await object.json<unknown>().catch(() => []));
    }
  }
  if (reportedCommentCount === null) {
    const metadataArtifact = artifacts.results.find((artifact) => artifact.object_key.endsWith("/metadata.json"));
    if (metadataArtifact) {
      const object = await env.REEL_ARCHIVE.get(metadataArtifact.object_key);
      const metadata: Record<string, unknown> = object
        ? await object.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}))
        : {};
      reportedCommentCount = typeof metadata.comment_count === "number" ? metadata.comment_count : null;
    }
  }
  return { comments, reportedCommentCount };
}

async function publishSynthesisHtml(
  env: Env,
  job: JobRow,
  payload: SynthesisPayload,
  options: { deferIndexRefresh?: boolean } = {},
): Promise<{ rootKey: string; rootPath: string; resourceCount: number }> {
  if (!env.REEL_LIBRARY_KV) throw new Error("REEL_LIBRARY_KV is not configured");
  if (!Array.isArray(payload.lists) || !payload.lists.length) {
    const storedLists = await env.REEL_DB.prepare("SELECT object_key FROM artifacts WHERE job_id=? AND kind='lists' ORDER BY created_at DESC LIMIT 1")
      .bind(job.id).first<{ object_key: string }>();
    if (storedLists?.object_key) {
      const object = await env.REEL_ARCHIVE.get(storedLists.object_key);
      const lists = object ? await object.json<SynthesisList[]>().catch(() => []) : [];
      if (Array.isArray(lists)) payload.lists = lists;
    }
  }
  const resources = routeSynthesisResources(job, payload);
  const tokenUsage = tokenUsageFromPayload(payload);
  const commentBundle = await loadCapturedCommentBundle(env, job, payload);
  const paths = reelLibraryPaths(job, payload);
  const resourcePaths = new Map(resources.map((resource) => [
    resource.slug,
    `${resource.artifactType ? ARTIFACT_COLLECTION_DEFINITIONS[resource.artifactType].folder : RESOURCE_KIND_DEFINITIONS[resource.kind].folder}/${resource.documentSlug}.html`,
  ]));
  const lists = routeSynthesisLists(job, payload, resources, resourcePaths);
  const rootHtml = renderRootHtml({
    id: job.id,
    canonicalUrl: payload.metadata.canonical_url || job.canonical_url || job.source_url,
    title: payload.metadata.title,
    author: payload.metadata.author_username,
    description: payload.metadata.description || "",
    transcript: payload.transcript || "",
    summary: payload.summary,
    visualSummary: payload.visual_summary || "No visual summary returned.",
    instructions: job.instructions,
    rootPath: paths.root,
    resources: resources.map((resource) => ({
      name: resource.name,
      slug: resource.slug,
      summary: resource.summary,
      libraryPath: resourcePaths.get(resource.slug) || "",
      kind: resource.kind,
    })),
    lists: lists.map((list) => ({
      title: list.title,
      summary: list.summary,
      libraryPath: list.libraryPath,
      itemCount: list.items.length,
    })),
    claims: payload.claims || [],
    comments: commentBundle.comments,
    reportedCommentCount: commentBundle.reportedCommentCount,
    audioAvailable: Boolean(job.audio_key),
    audioTitle: payload.audio?.title || job.audio_title,
    audioArtist: payload.audio?.artist || job.audio_artist,
    audioSourceUrl: payload.audio?.source_url || job.audio_source_url,
    audioIdentificationMethod: payload.audio?.identification_method || job.audio_identification_method,
    mediaType: payload.metadata.media_type || (payload.metadata.canonical_url.includes("/p/") ? "post" : "reel"),
    carouselItemCount: payload.metadata.carousel_item_count || null,
    tokenUsage,
    processingSeconds: job.processing_seconds,
    createdAt: job.completed_at || new Date().toISOString(),
  });
  const rootKey = `library/reels/${job.id}/index.html`;
  await env.REEL_ARCHIVE.put(rootKey, rootHtml, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
  await putReelLibraryHtml(env, paths.root, rootHtml, {
    kind: "reel",
    job_id: job.id,
    title: payload.metadata.title,
    author: payload.metadata.author_username,
    video_available: Boolean(job.original_video_key),
    audio_available: Boolean(job.audio_key),
    media_type: payload.metadata.media_type || (payload.metadata.canonical_url.includes("/p/") ? "post" : "reel"),
  });

  const statements: D1PreparedStatement[] = [
    env.REEL_DB.prepare("UPDATE jobs SET html_key=?, library_path=?, codex_input_tokens=?, codex_cached_input_tokens=?, codex_output_tokens=?, codex_reasoning_output_tokens=?, codex_total_tokens=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(rootKey, paths.root, tokenUsage.input_tokens, tokenUsage.cached_input_tokens, tokenUsage.output_tokens, tokenUsage.reasoning_output_tokens, tokenUsage.total_tokens, job.id),
  ];
  const canonicalArtifactKeys = new Set<string>();
  for (const resource of resources) {
    const definition = RESOURCE_KIND_DEFINITIONS[resource.kind];
    const resourceFolder = resource.artifactType ? ARTIFACT_COLLECTION_DEFINITIONS[resource.artifactType].folder : definition.folder;
    const path = resourcePaths.get(resource.slug) || `${resourceFolder}/${resource.documentSlug}.html`;
    const key = `library/${path}`;
    if (resource.canonicalKey) {
      canonicalArtifactKeys.add(resource.canonicalKey);
    } else {
      const html = renderResourceHtml({
        rootId: job.id,
        rootPath: paths.root,
        name: resource.name,
        kind: resource.kind,
        canonicalUrl: resource.canonical_url,
        summary: resource.summary,
        whyUseful: resource.why_useful,
        guide: resource.guide,
        sources: resource.sources || [],
        artifactType: resource.artifactType,
        media: resource,
      });
      await env.REEL_ARCHIVE.put(key, html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
      await putReelLibraryHtml(env, path, html, {
        kind: "resource",
        job_id: job.id,
        parent_path: paths.root,
        title: resource.name,
        author: payload.metadata.author_username,
        video_available: false,
        resource_kind: resource.kind,
        resource_folder: resourceFolder,
        artifact_type: "",
        summary: resource.summary,
      });
    }
    statements.push(
      env.REEL_DB.prepare("UPDATE resources SET canonical_key=?,guide_text=?,media_json=?,guide_html_key=?,library_path=? WHERE job_id=? AND slug=?")
        .bind(resource.canonicalKey, resource.guide, JSON.stringify({ hero_image_url: resource.hero_image_url || null, hero_image_alt: resource.hero_image_alt || null, spotify_url: resource.spotify_url || null, youtube_candidates: resource.youtube_candidates || [], article_links: resource.article_links || [] }), key, path, job.id, resource.slug),
    );
  }
  for (const list of lists) {
    const html = renderListHtml({
      id: job.id,
      title: list.title,
      summary: list.summary,
      rootPath: paths.root,
      author: payload.metadata.author_username,
      description: payload.metadata.description || "",
      mediaType: payload.metadata.media_type || (payload.metadata.canonical_url.includes("/p/") ? "post" : "reel"),
      carouselItemCount: payload.metadata.carousel_item_count || null,
      comments: commentBundle.comments,
      reportedCommentCount: commentBundle.reportedCommentCount,
      items: list.items.map((item) => ({
        position: item.position,
        label: item.label,
        description: item.description,
        resourcePath: item.resourcePath,
      })),
    });
    await env.REEL_ARCHIVE.put(`library/${list.libraryPath}`, html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
    await putReelLibraryHtml(env, list.libraryPath, html, {
      kind: "list",
      job_id: job.id,
      parent_path: paths.root,
      title: list.title,
      author: payload.metadata.author_username,
      video_available: Boolean(job.original_video_key),
      media_type: payload.metadata.media_type || (payload.metadata.canonical_url.includes("/p/") ? "post" : "reel"),
      resource_folder: "lists",
      summary: list.summary,
      source_count: list.items.length,
    });
  }
  await removeSupersededReelLibraryFiles(
    env,
    job.id,
    new Set([paths.root, ...resourcePaths.values(), ...lists.map((list) => list.libraryPath)]),
    `${paths.directory}/resources/`,
  );
  await env.REEL_DB.batch(statements);
  for (const canonicalKey of canonicalArtifactKeys) await refreshCanonicalArtifactPage(env, canonicalKey);
  if (!options.deferIndexRefresh) {
    const youtubeIds = new Set(resources.flatMap((resource) => (resource.youtube_candidates || []).map((candidate) => youtubeVideoId(candidate.url)).filter((id): id is string => Boolean(id))));
    await refreshYoutubeCollectionPages(env, youtubeIds);
    await refreshArtifactCollectionPages(env);
    await refreshListCollectionPage(env);
    await refreshReelLibraryManifest(env);
  }
  return { rootKey, rootPath: paths.root, resourceCount: resources.length };
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function validCodexAuth(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as { tokens?: unknown; OPENAI_API_KEY?: unknown; auth_mode?: unknown };
    return Boolean(parsed && typeof parsed === "object" && (parsed.tokens || parsed.OPENAI_API_KEY || parsed.auth_mode));
  } catch {
    return false;
  }
}

async function runtimeAuthKey(env: Env): Promise<CryptoKey | null> {
  if (!env.CODEX_AUTH_STATE_KEY) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(env.CODEX_AUTH_STATE_KEY));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function loadRuntimeSecret(env: Env, name: string): Promise<string | null> {
  const key = await runtimeAuthKey(env);
  if (!key) return null;
  const row = await env.REEL_DB.prepare("SELECT ciphertext, iv FROM runtime_secrets WHERE name=?")
    .bind(name).first<{ ciphertext: string; iv: string }>();
  if (!row) return null;
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(row.iv) },
      key,
      base64ToBytes(row.ciphertext),
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

async function persistRuntimeSecret(env: Env, name: string, value: string): Promise<void> {
  const key = await runtimeAuthKey(env);
  if (!key) throw new Error("CODEX_AUTH_STATE_KEY is required to encrypt runtime credentials");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  await env.REEL_DB.prepare(
    "INSERT INTO runtime_secrets(name,ciphertext,iv,updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(name) DO UPDATE SET ciphertext=excluded.ciphertext, iv=excluded.iv, updated_at=CURRENT_TIMESTAMP",
  ).bind(name, bytesToBase64(new Uint8Array(encrypted)), bytesToBase64(iv)).run();
}

async function loadPersistedCodexAuth(env: Env): Promise<string | null> {
  const value = await loadRuntimeSecret(env, "codex_auth");
  return value && validCodexAuth(value) ? value : null;
}

async function persistCodexAuth(env: Env, value: string | null | undefined): Promise<void> {
  if (!value || !validCodexAuth(value)) return;
  await persistRuntimeSecret(env, "codex_auth", value);
}

async function readJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) throw new Error("Expected application/json");
  return request.json<T>();
}

async function getEmoji(env: Env, stage: string): Promise<EmojiSetting> {
  const fallback: EmojiSetting = DEFAULT_STAGE_REACTIONS[stage] || { display: "❓", reaction: "❓" };
  const row = await env.REEL_DB.prepare("SELECT value FROM settings WHERE key = ?")
    .bind(`emoji.${stage}`)
    .first<{ value: string }>();
  if (!row) return fallback;
  try {
    const parsed = JSON.parse(row.value) as EmojiSetting;
    if (!parsed.display || !isValidInstagramReaction(parsed.reaction)) return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

async function recordOutboundEvent(env: Env, input: {
  recipientId?: string | null;
  sourceMessageId?: string | null;
  jobId?: string | null;
  kind: string;
  stage?: string | null;
  displayEmoji?: string | null;
  reaction?: string | null;
  status: string;
  httpStatus?: number | null;
  error?: string | null;
}): Promise<void> {
  await env.REEL_DB.prepare(
    "INSERT INTO outbound_events(id,recipient_id,source_message_id,job_id,kind,stage,display_emoji,reaction,status,http_status,error) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  ).bind(
    uuid(), input.recipientId || null, input.sourceMessageId || null, input.jobId || null,
    input.kind, input.stage || null, input.displayEmoji || null, input.reaction || null,
    input.status, input.httpStatus || null, input.error?.slice(0, 500) || null,
  ).run();
}

async function reactToSourceMessage(
  env: Env,
  job: { id?: string | null; source_message_id: string | null; sender_id: string | null },
  stage: string,
): Promise<boolean> {
  const setting = await getEmoji(env, stage);
  if (!job.source_message_id || !job.sender_id) return false;
  if (!env.INSTAGRAM_ACCESS_TOKEN || !env.INSTAGRAM_USER_ID) {
    await recordOutboundEvent(env, { recipientId: job.sender_id, sourceMessageId: job.source_message_id, jobId: job.id, kind: "reaction", stage, displayEmoji: setting.display, reaction: setting.reaction, status: "not_configured", error: "Instagram credentials are unavailable" });
    return false;
  }
  try {
    const version = env.INSTAGRAM_GRAPH_VERSION || "v24.0";
    const response = await fetch(`https://graph.instagram.com/${version}/${env.INSTAGRAM_USER_ID}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.INSTAGRAM_ACCESS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        recipient: { id: job.sender_id },
        sender_action: "react",
        payload: { message_id: job.source_message_id, reaction: setting.reaction },
      }),
    });
    if (!response.ok) {
      const error = (await response.text()).slice(0, 500);
      console.error("Instagram reaction failed", response.status, error.slice(0, 300));
      await recordOutboundEvent(env, { recipientId: job.sender_id, sourceMessageId: job.source_message_id, jobId: job.id, kind: "reaction", stage, displayEmoji: setting.display, reaction: setting.reaction, status: "failed", httpStatus: response.status, error });
      return false;
    }
    await recordOutboundEvent(env, { recipientId: job.sender_id, sourceMessageId: job.source_message_id, jobId: job.id, kind: "reaction", stage, displayEmoji: setting.display, reaction: setting.reaction, status: "sent", httpStatus: response.status });
    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("Instagram reaction failed", detail.slice(0, 300));
    await recordOutboundEvent(env, { recipientId: job.sender_id, sourceMessageId: job.source_message_id, jobId: job.id, kind: "reaction", stage, displayEmoji: setting.display, reaction: setting.reaction, status: "failed", error: detail });
    return false;
  }
}

async function sendInstagramText(
  env: Env,
  senderId: string,
  text: string,
  sourceMessageId?: string | null,
  kind = "text",
): Promise<boolean> {
  if (!env.INSTAGRAM_ACCESS_TOKEN || !env.INSTAGRAM_USER_ID) {
    await recordOutboundEvent(env, { recipientId: senderId, sourceMessageId, kind, status: "not_configured", error: "Instagram credentials are unavailable" });
    return false;
  }
  const version = env.INSTAGRAM_GRAPH_VERSION || "v24.0";
  const response = await fetch(`https://graph.instagram.com/${version}/${env.INSTAGRAM_USER_ID}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.INSTAGRAM_ACCESS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ recipient: { id: senderId }, message: { text: text.slice(0, 950) } }),
  });
  const error = response.ok ? "" : (await response.text()).slice(0, 500);
  await recordOutboundEvent(env, { recipientId: senderId, sourceMessageId, kind, status: response.ok ? "sent" : "failed", httpStatus: response.status, error });
  return response.ok;
}

type InstagramConversation = { id?: string; updated_time?: string };
type InstagramConversationMessage = {
  id?: string;
  created_time?: string;
  from?: { id?: string; username?: string };
  message?: string;
  attachments?: unknown;
  shares?: unknown;
};
type InstagramGraphPage<T> = {
  data?: T[];
  paging?: { next?: string; cursors?: { after?: string } };
};
type BacklogCandidate = {
  messageId: string;
  createdTime: string;
  senderId: string;
  sourceUrl: string | null;
  shortcode: string | null;
  instructions: string;
  hasShareEvidence: boolean;
  mediaType?: "carousel" | "reel" | "post" | "unknown";
  carouselItemCount?: number;
  classificationDetail?: string;
  sourceMediaJson?: string;
};

function allowedInstagramSenders(env: Env): string[] {
  return (env.INSTAGRAM_ALLOWED_SENDER_IDS || "").split(",").map((value) => value.trim()).filter(Boolean);
}

async function instagramGraphPage<T>(env: Env, inputUrl: string): Promise<InstagramGraphPage<T>> {
  if (!env.INSTAGRAM_ACCESS_TOKEN) throw new Error("INSTAGRAM_ACCESS_TOKEN is unavailable");
  const url = new URL(inputUrl);
  url.searchParams.delete("access_token");
  const response = await fetch(url.toString(), { headers: { authorization: `Bearer ${env.INSTAGRAM_ACCESS_TOKEN}` } });
  if (!response.ok) throw new Error(`Instagram conversations request failed with HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`);
  return response.json<InstagramGraphPage<T>>();
}

function backlogCandidate(message: InstagramConversationMessage, allowed: Set<string>): BacklogCandidate | null {
  const messageId = String(message.id || "").trim();
  const senderId = String(message.from?.id || "").trim();
  if (!messageId || !senderId || (allowed.size && !allowed.has(senderId))) return null;
  const strings = collectStrings(message);
  const sourceUrl = [
    ...instagramUrls(strings),
    ...strings.map(instagramPostUrlFromCdnUrl).filter((value): value is string => Boolean(value)),
  ].map((value) => canonicalizeInstagramUrl(value)).find(Boolean) || null;
  const attachmentStrings = collectStrings([message.attachments, message.shares]);
  const hasShareEvidence = attachmentStrings.length > 0 || instagramUrls(strings).length > 0;
  return {
    messageId,
    createdTime: String(message.created_time || ""),
    senderId,
    sourceUrl: sourceUrl?.url || null,
    shortcode: sourceUrl?.shortcode || null,
    instructions: String(message.message || "").trim().slice(0, 3000),
    hasShareEvidence,
  };
}

async function loadBacklogCandidates(env: Env, maxMessagePages = 30): Promise<BacklogCandidate[]> {
  if (!env.INSTAGRAM_USER_ID) throw new Error("INSTAGRAM_USER_ID is unavailable");
  const allowed = new Set(allowedInstagramSenders(env));
  if (!allowed.size) throw new Error("INSTAGRAM_ALLOWED_SENDER_IDS must be configured before backlog selection");
  const version = env.INSTAGRAM_GRAPH_VERSION || "v24.0";
  let conversationsUrl = `https://graph.instagram.com/${version}/${env.INSTAGRAM_USER_ID}/conversations?platform=instagram&fields=id,updated_time&limit=50`;
  const conversations: InstagramConversation[] = [];
  for (let pageNumber = 0; conversationsUrl && pageNumber < 10; pageNumber += 1) {
    const page = await instagramGraphPage<InstagramConversation>(env, conversationsUrl);
    conversations.push(...(page.data || []));
    conversationsUrl = page.paging?.next || "";
  }
  conversations.sort((left, right) => String(right.updated_time || "").localeCompare(String(left.updated_time || "")));
  const candidates: BacklogCandidate[] = [];
  for (const conversation of conversations) {
    if (!conversation.id) continue;
    let messagesUrl = `https://graph.instagram.com/${version}/${conversation.id}/messages?fields=id,created_time,from,to,message,attachments,shares&limit=50`;
    for (let pageNumber = 0; messagesUrl && pageNumber < maxMessagePages; pageNumber += 1) {
      const page = await instagramGraphPage<InstagramConversationMessage>(env, messagesUrl);
      for (const message of page.data || []) {
        const candidate = backlogCandidate(message, allowed);
        if (candidate) candidates.push(candidate);
      }
      messagesUrl = page.paging?.next || "";
    }
  }
  const unique = new Map<string, BacklogCandidate>();
  for (const candidate of candidates) if (!unique.has(candidate.messageId)) unique.set(candidate.messageId, candidate);
  return [...unique.values()].sort((left, right) => right.createdTime.localeCompare(left.createdTime));
}

async function loadDirectCarouselBacklogCandidates(env: Env, targetPool = 40): Promise<BacklogCandidate[]> {
  const cookies = await loadInstagramBrowserCookies(env);
  if (!cookies) throw new Error("Instagram browser authentication is not connected");
  const systemUserId = instagramCookieValue(cookies, "ds_user_id");
  const inboxUrl = new URL("https://www.instagram.com/api/v1/direct_v2/inbox/");
  inboxUrl.searchParams.set("thread_message_limit", "50");
  inboxUrl.searchParams.set("limit", "20");
  inboxUrl.searchParams.set("persistentBadging", "true");
  const inbox = await fetchInstagramDirectJson(inboxUrl.toString(), cookies);
  if (!inbox.ok) throw new Error(`Instagram Direct inbox request failed with HTTP ${inbox.status}`);
  const rows = [...instagramDirectCarousels(inbox.payload)];
  const threads = instagramDirectThreads(inbox.payload);
  for (const thread of threads.slice(0, 10)) {
    const threadId = String(thread.thread_id || thread.id || "").trim();
    if (!threadId) continue;
    let cursor = "";
    for (let pageNumber = 0; pageNumber < 30 && rows.length < targetPool; pageNumber += 1) {
      const threadUrl = new URL(`https://www.instagram.com/api/v1/direct_v2/threads/${encodeURIComponent(threadId)}/`);
      threadUrl.searchParams.set("limit", "100");
      if (cursor) threadUrl.searchParams.set("cursor", cursor);
      const page = await fetchInstagramDirectJson(threadUrl.toString(), cookies);
      if (!page.ok) break;
      rows.push(...instagramDirectCarousels(page.payload));
      const root = page.payload as { thread?: { oldest_cursor?: unknown; has_older?: unknown }; oldest_cursor?: unknown; has_older?: unknown } | null;
      const nextCursor = String(root?.thread?.oldest_cursor || root?.oldest_cursor || "").trim();
      const hasOlder = root?.thread?.has_older ?? root?.has_older;
      if (!nextCursor || hasOlder === false || nextCursor === cursor) break;
      cursor = nextCursor;
    }
    if (rows.length >= targetPool) break;
  }
  const unique = new Map<string, BacklogCandidate>();
  for (const row of rows) {
    if (systemUserId && row.senderId === systemUserId) continue;
    const candidate: BacklogCandidate = {
      messageId: `direct:${row.itemId}`,
      createdTime: row.timestampMs ? new Date(row.timestampMs).toISOString() : "",
      senderId: "",
      sourceUrl: row.sourceUrl,
      shortcode: row.shortcode,
      instructions: row.instructions,
      hasShareEvidence: true,
      mediaType: "carousel",
      carouselItemCount: row.itemCount,
      classificationDetail: "instagram_direct_carousel_media",
      sourceMediaJson: JSON.stringify(row.mediaPayload),
    };
    if (!unique.has(candidate.messageId)) unique.set(candidate.messageId, candidate);
  }
  return [...unique.values()].sort((left, right) => right.createdTime.localeCompare(left.createdTime));
}

async function loadCachedPilotCandidates(env: Env, pilotKey: string): Promise<BacklogCandidate[] | null> {
  const row = await env.REEL_DB.prepare(
    "SELECT candidates_json FROM pilot_candidate_cache WHERE pilot_key=? AND datetime(expires_at) > CURRENT_TIMESTAMP",
  ).bind(pilotKey).first<{ candidates_json: string }>();
  if (!row?.candidates_json) return null;
  try {
    const candidates = JSON.parse(row.candidates_json) as BacklogCandidate[];
    return Array.isArray(candidates) && candidates.length === 10 ? candidates : null;
  } catch {
    return null;
  }
}

async function cachePilotCandidates(env: Env, pilotKey: string, candidates: BacklogCandidate[]): Promise<void> {
  await env.REEL_DB.prepare(
    `INSERT INTO pilot_candidate_cache(pilot_key,candidates_json,expires_at,updated_at)
     VALUES (?,?,datetime('now','+2 hours'),CURRENT_TIMESTAMP)
     ON CONFLICT(pilot_key) DO UPDATE SET candidates_json=excluded.candidates_json,expires_at=excluded.expires_at,updated_at=CURRENT_TIMESTAMP`,
  ).bind(pilotKey, JSON.stringify(candidates)).run();
}

async function classifyBacklogCandidate(env: Env, candidate: BacklogCandidate): Promise<BacklogCandidate> {
  if (candidate.mediaType) return candidate;
  if (!candidate.sourceUrl || !candidate.shortcode) return { ...candidate, mediaType: "unknown", carouselItemCount: 0 };
  const cookies = await loadInstagramBrowserCookies(env);
  if (!cookies) throw new Error("Instagram browser authentication is not connected");
  const classifyResponse = async (response: Response | null): Promise<ReturnType<typeof classifyInstagramMediaPayload>> => {
    if (!response?.ok) return { mediaType: "unknown", itemCount: 0 };
    return classifyInstagramMediaPayload(await response.json<unknown>().catch(() => null));
  };
  const response = await fetch(`https://www.instagram.com/api/v1/media/shortcode/${encodeURIComponent(candidate.shortcode)}/info/`, {
    headers: {
      ...instagramDirectHeaders(cookies),
      referer: candidate.sourceUrl,
    },
  }).catch(() => null);
  let classification = await classifyResponse(response);
  const detail = [`shortcode_HTTP_${response?.status || "network"}`];
  if (classification.mediaType === "unknown") {
    const page = await fetch(candidate.sourceUrl, {
      headers: { accept: "text/html", "user-agent": instagramDirectHeaders(cookies)["user-agent"] },
      redirect: "follow",
    }).catch(() => null);
    const html = page?.ok ? await page.text() : "";
    detail.push(`html_HTTP_${page?.status || "network"}`, `html_bytes_${html.length}`);
    const embedded = html ? instagramCarouselPayloadFromHtml(html) : null;
    if (embedded) detail.push("html_embedded_media");
    if (embedded) classification = classifyInstagramMediaPayload(embedded);
    if (classification.mediaType === "unknown" && html) {
      const escapedShortcode = candidate.shortcode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const forward = html.match(new RegExp(`"media_id":"(\\d{8,30})".{0,5000}"shortcode":"${escapedShortcode}"`, "s"));
      const reverse = html.match(new RegExp(`"shortcode":"${escapedShortcode}".{0,5000}"media_id":"(\\d{8,30})"`, "s"));
      const mediaId = forward?.[1] || reverse?.[1] || "";
      detail.push(mediaId ? "html_media_id" : `html_no_media_id:shortcode_${html.includes(candidate.shortcode)}`);
      if (mediaId) {
        const info = await fetch(`https://www.instagram.com/api/v1/media/${encodeURIComponent(mediaId)}/info/`, {
          headers: { ...instagramDirectHeaders(cookies), referer: candidate.sourceUrl },
        }).catch(() => null);
        detail.push(`media_HTTP_${info?.status || "network"}`);
        classification = await classifyResponse(info);
      }
    }
  }
  return { ...candidate, mediaType: classification.mediaType, carouselItemCount: classification.itemCount, classificationDetail: detail.join(";") };
}

async function findExistingJobForCandidate(env: Env, candidate: BacklogCandidate): Promise<{ id: string; status: string; pilot_run_id: string | null } | null> {
  if (!candidate.sourceUrl || !candidate.shortcode) return null;
  return env.REEL_DB.prepare(
    `SELECT id, status, pilot_run_id FROM jobs
     WHERE dedupe_key=? OR shortcode=? OR canonical_url=? OR source_message_id=?
     ORDER BY CASE status WHEN 'complete' THEN 0 WHEN 'running' THEN 1 WHEN 'queued' THEN 2 ELSE 3 END, created_at DESC
     LIMIT 1`,
  ).bind(`instagram:${candidate.shortcode}`, candidate.shortcode, candidate.sourceUrl, candidate.messageId)
    .first<{ id: string; status: string; pilot_run_id: string | null }>();
}

async function pilotRunSummary(env: Env, pilotId: string): Promise<Record<string, unknown>> {
  const run = await env.REEL_DB.prepare("SELECT * FROM pilot_runs WHERE id=?").bind(pilotId).first<Record<string, unknown>>();
  if (!run) throw new Error("Pilot run was not found");
  const jobCounts = await env.REEL_DB.prepare("SELECT status, COUNT(*) AS count FROM jobs WHERE pilot_run_id=? GROUP BY status ORDER BY status").bind(pilotId).all();
  const totals = await env.REEL_DB.prepare(
    "SELECT SUM(CASE WHEN status!='duplicate' THEN 1 ELSE 0 END) AS selected, SUM(CASE WHEN status='complete' THEN 1 ELSE 0 END) AS complete, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed, SUM(COALESCE(codex_total_tokens,0)) AS total_tokens FROM jobs WHERE pilot_run_id=?",
  ).bind(pilotId).first<{ selected: number; complete: number; failed: number; total_tokens: number }>();
  const selected = Number(totals?.selected || 0);
  const complete = Number(totals?.complete || 0);
  const failed = Number(totals?.failed || 0);
  const target = Number(run.target_count || 0);
  const status = selected < target ? "selecting" : complete + failed >= target ? (failed ? "completed_with_failures" : "complete") : "running";
  await env.REEL_DB.prepare(
    "UPDATE pilot_runs SET status=?, selected_count=?, completed_at=CASE WHEN ? IN ('complete','completed_with_failures') THEN COALESCE(completed_at,CURRENT_TIMESTAMP) ELSE completed_at END, updated_at=CURRENT_TIMESTAMP WHERE id=?",
  ).bind(status, selected, status, pilotId).run();
  return { ...run, status, selected_count: selected, complete_count: complete, failed_count: failed, total_tokens: Number(totals?.total_tokens || 0), jobs: jobCounts.results };
}

async function backlogProcessingActive(env: Env): Promise<boolean> {
  const row = await env.REEL_DB.prepare(
    `SELECT p.id FROM pilot_runs p
     WHERE p.status IN ('selecting','running')
       AND EXISTS(SELECT 1 FROM jobs j WHERE j.pilot_run_id=p.id AND j.status IN ('queued','running'))
     LIMIT 1`,
  ).first<{ id: string }>();
  return Boolean(row);
}

async function handleBacklogPilot(request: Request, env: Env): Promise<Response> {
  const input = await readJson<{ pilot_key?: string; target_count?: number; confirm_pilot?: string; dry_run?: boolean; carousel_only?: boolean; debug_limit?: number }>(request);
  const pilotKey = String(input.pilot_key || "").trim().slice(0, 120);
  const targetCount = Math.min(20, Math.max(1, Number(input.target_count || 10)));
  if (!pilotKey) return json({ error: "pilot_key is required" }, { status: 400 });
  if (targetCount !== 10) return json({ error: "This rollout is locked to exactly 10 posts" }, { status: 400 });
  if (!input.dry_run && input.confirm_pilot !== "ENQUEUE_EXACTLY_10") return json({ error: "confirm_pilot must equal ENQUEUE_EXACTLY_10" }, { status: 400 });
  if ((env.INGEST_MODE || "disabled") !== "live") return json({ error: "INGEST_MODE must be live before a backlog pilot can run" }, { status: 409 });

  let candidates: BacklogCandidate[];
  try {
    candidates = input.dry_run
      ? (input.carousel_only ? await loadDirectCarouselBacklogCandidates(env) : await loadBacklogCandidates(env))
      : (await loadCachedPilotCandidates(env, pilotKey))
        || (input.carousel_only ? await loadDirectCarouselBacklogCandidates(env) : await loadBacklogCandidates(env));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Instagram conversation scan failed";
    return json({ error: detail.slice(0, 500), retryable: true }, { status: 502 });
  }
  if (input.dry_run) {
    const selection: Array<Record<string, unknown>> = [];
    const selectedCandidates: BacklogCandidate[] = [];
    let duplicates = 0;
    let unavailable = 0;
    let nonCarousels = 0;
    const classificationDebug: Array<Record<string, unknown>> = [];
    for (const candidate of candidates) {
      if (!candidate.sourceUrl || !candidate.shortcode) {
        if (candidate.hasShareEvidence) unavailable += 1;
        continue;
      }
      const classified = input.carousel_only ? await classifyBacklogCandidate(env, candidate) : candidate;
      if (input.debug_limit && classificationDebug.length < Math.min(20, input.debug_limit)) {
        classificationDebug.push({ source_url: classified.sourceUrl, shortcode: classified.shortcode, media_type: classified.mediaType, detail: classified.classificationDetail });
      }
      if (input.carousel_only && classified.mediaType !== "carousel") {
        nonCarousels += 1;
        if (input.debug_limit && classificationDebug.length >= Math.min(20, input.debug_limit)) break;
        continue;
      }
      const existing = await findExistingJobForCandidate(env, classified);
      if (existing) { duplicates += 1; continue; }
      selection.push({ message_id: classified.messageId, created_time: classified.createdTime, source_url: classified.sourceUrl, shortcode: classified.shortcode, media_type: classified.mediaType || null, carousel_item_count: classified.carouselItemCount || null });
      selectedCandidates.push(classified);
      if (selection.length === targetCount) break;
    }
    if (selectedCandidates.length === targetCount) await cachePilotCandidates(env, pilotKey, selectedCandidates);
    return json({ ok: selection.length === targetCount, dry_run: true, target_count: targetCount, carousel_only: Boolean(input.carousel_only), selectable: selection.length, duplicates_before_selection: duplicates, unavailable_before_selection: unavailable, non_carousels_before_selection: nonCarousels, classification_debug: classificationDebug, selection }, { status: selection.length === targetCount ? 200 : 409 });
  }

  let run = await env.REEL_DB.prepare("SELECT id, status FROM pilot_runs WHERE pilot_key=?").bind(pilotKey).first<{ id: string; status: string }>();
  if (!run) {
    const id = uuid();
    await env.REEL_DB.prepare("INSERT INTO pilot_runs(id,pilot_key,target_count,status,started_at) VALUES (?,?,?,'selecting',CURRENT_TIMESTAMP)").bind(id, pilotKey, targetCount).run();
    run = { id, status: "selecting" };
  }
  const existingSummary = await pilotRunSummary(env, run.id);
  if (Number(existingSummary.selected_count || 0) >= targetCount) return json({ ok: true, idempotent: true, pilot: existingSummary });

  let duplicates = Number(existingSummary.duplicate_count || 0);
  let unavailable = Number(existingSummary.unavailable_count || 0);
  for (const candidate of candidates) {
    const alreadyRecorded = await env.REEL_DB.prepare("SELECT decision FROM pilot_items WHERE pilot_run_id=? AND source_message_id=?").bind(run.id, candidate.messageId).first();
    if (alreadyRecorded) continue;
    if (!candidate.sourceUrl || !candidate.shortcode) {
      if (!candidate.hasShareEvidence) continue;
      unavailable += 1;
      await env.REEL_DB.prepare("INSERT OR IGNORE INTO pilot_items(id,pilot_run_id,source_message_id,decision,detail) VALUES (?,?,?,'unavailable','No recoverable Instagram post URL')")
        .bind(uuid(), run.id, candidate.messageId).run();
      continue;
    }
    const classified = input.carousel_only ? await classifyBacklogCandidate(env, candidate) : candidate;
    if (input.carousel_only && classified.mediaType !== "carousel") continue;
    const before = await findExistingJobForCandidate(env, classified);
    if (before && before.pilot_run_id !== run.id) {
      duplicates += 1;
      await env.REEL_DB.prepare("INSERT OR IGNORE INTO pilot_items(id,pilot_run_id,source_message_id,source_url,shortcode,job_id,decision,detail) VALUES (?,?,?,?,?,?,'duplicate','Rejected before queue and Codex')")
        .bind(uuid(), run.id, classified.messageId, classified.sourceUrl, classified.shortcode, before.id).run();
      continue;
    }
    const result = await createJob(env, {
      sourceUrl: classified.sourceUrl!,
      instructions: classified.instructions,
      senderId: classified.senderId,
      sourceMessageId: classified.messageId,
      pilotRunId: run.id,
      sourceMediaJson: classified.sourceMediaJson || null,
    });
    const resolved = await env.REEL_DB.prepare("SELECT pilot_run_id FROM jobs WHERE id=?").bind(result.id).first<{ pilot_run_id: string | null }>();
    const selected = !result.duplicate || resolved?.pilot_run_id === run.id;
    if (!selected) duplicates += 1;
    await env.REEL_DB.prepare("INSERT OR IGNORE INTO pilot_items(id,pilot_run_id,source_message_id,source_url,shortcode,job_id,decision,detail) VALUES (?,?,?,?,?,?,?,?)")
      .bind(uuid(), run.id, classified.messageId, classified.sourceUrl, classified.shortcode, result.id, selected ? "selected" : "duplicate", selected ? "Queued after carousel classification and canonical deduplication" : "Rejected before queue and Codex").run();
    const count = await env.REEL_DB.prepare("SELECT COUNT(*) AS count FROM jobs WHERE pilot_run_id=? AND status!='duplicate'").bind(run.id).first<{ count: number }>();
    if (Number(count?.count || 0) >= targetCount) break;
  }
  await env.REEL_DB.prepare("UPDATE pilot_runs SET duplicate_count=?, unavailable_count=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(duplicates, unavailable, run.id).run();
  const summary = await pilotRunSummary(env, run.id);
  if (Number(summary.selected_count || 0) !== targetCount) return json({ error: `Only ${summary.selected_count || 0} unique accessible posts were selected`, pilot: summary }, { status: 409 });
  return json({ ok: true, pilot: summary }, { status: 202 });
}

async function handlePilotStatus(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pilotKey = String(url.searchParams.get("pilot_key") || "").trim();
  const run = await env.REEL_DB.prepare("SELECT id FROM pilot_runs WHERE pilot_key=?").bind(pilotKey).first<{ id: string }>();
  if (!run) return json({ error: "Pilot run not found" }, { status: 404 });
  return json({ ok: true, pilot: await pilotRunSummary(env, run.id) });
}

async function handlePilotReprocess(request: Request, env: Env): Promise<Response> {
  const input = await readJson<{ pilot_id?: string; job_ids?: string[]; reprocess_key?: string; confirm_reprocess?: string }>(request);
  const pilotId = String(input.pilot_id || "").trim();
  const reprocessKey = String(input.reprocess_key || "").trim().slice(0, 120);
  const jobIds = [...new Set((input.job_ids || []).map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 20);
  if (!pilotId || !reprocessKey || !jobIds.length) return json({ error: "pilot_id, reprocess_key and job_ids are required" }, { status: 400 });
  if (input.confirm_reprocess !== "REARCHIVE_AND_RESYNTHESISE") {
    return json({ error: "confirm_reprocess must equal REARCHIVE_AND_RESYNTHESISE" }, { status: 400 });
  }
  const placeholders = jobIds.map(() => "?").join(",");
  const rows = await env.REEL_DB.prepare(
    `SELECT id,status,stage FROM jobs WHERE pilot_run_id=? AND id IN (${placeholders}) ORDER BY created_at`,
  ).bind(pilotId, ...jobIds).all<{ id: string; status: string; stage: string }>();
  if (rows.results.length !== jobIds.length) return json({ error: "Every requested job must belong to the stated pilot" }, { status: 409 });
  const queued: string[] = [];
  const idempotent: string[] = [];
  for (const job of rows.results) {
    const prior = await env.REEL_DB.prepare(
      "SELECT id FROM job_events WHERE job_id=? AND detail=? LIMIT 1",
    ).bind(job.id, `reprocess:${reprocessKey}`).first<{ id: string }>();
    if (prior) { idempotent.push(job.id); continue; }
    if (job.status !== "complete") return json({ error: `Job ${job.id} is ${job.status}; only settled completed jobs may be reset` }, { status: 409 });
    await env.REEL_DB.batch([
      env.REEL_DB.prepare("DELETE FROM resources WHERE job_id=?").bind(job.id),
      env.REEL_DB.prepare(
        `UPDATE jobs SET status='queued',stage='queued',error_code=NULL,error_message=NULL,started_at=NULL,completed_at=NULL,
          processing_seconds=NULL,codex_input_tokens=NULL,codex_cached_input_tokens=NULL,codex_output_tokens=NULL,
          codex_reasoning_output_tokens=NULL,codex_total_tokens=NULL,synthesis_json_key=NULL,upload_token_hash=NULL,
          upload_token_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      ).bind(job.id),
      env.REEL_DB.prepare("INSERT INTO job_events(job_id,stage,status,emoji,detail) VALUES (?,'queued','queued','⬇️',?)")
        .bind(job.id, `reprocess:${reprocessKey}`),
    ]);
    try {
      await env.REEL_QUEUE.send({ jobId: job.id });
      queued.push(job.id);
    } catch (error) {
      const detail = error instanceof Error ? error.message.slice(0, 400) : "Queue send failed";
      await env.REEL_DB.prepare("UPDATE jobs SET status='failed',stage='error_queue',error_code='error_queue',error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(detail, job.id).run();
      return json({ error: detail, queued, failed_job_id: job.id }, { status: 502 });
    }
  }
  return json({ ok: true, pilot_id: pilotId, reprocess_key: reprocessKey, queued, idempotent }, { status: 202 });
}

async function handlePilotRearchive(request: Request, env: Env): Promise<Response> {
  const input = await readJson<{ pilot_id?: string; job_ids?: string[]; rearchive_key?: string; confirm_rearchive?: string }>(request);
  const pilotId = String(input.pilot_id || "").trim();
  const rearchiveKey = String(input.rearchive_key || "").trim().slice(0, 120);
  const jobIds = [...new Set((input.job_ids || []).map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 20);
  if (!pilotId || !rearchiveKey || !jobIds.length) return json({ error: "pilot_id, rearchive_key and job_ids are required" }, { status: 400 });
  if (input.confirm_rearchive !== "REARCHIVE_WITHOUT_CODEX") {
    return json({ error: "confirm_rearchive must equal REARCHIVE_WITHOUT_CODEX" }, { status: 400 });
  }
  const placeholders = jobIds.map(() => "?").join(",");
  const rows = await env.REEL_DB.prepare(
    `SELECT id,status FROM jobs WHERE pilot_run_id=? AND id IN (${placeholders}) ORDER BY created_at`,
  ).bind(pilotId, ...jobIds).all<{ id: string; status: string }>();
  if (rows.results.length !== jobIds.length) return json({ error: "Every requested job must belong to the stated pilot" }, { status: 409 });
  const queued: string[] = [];
  const idempotent: string[] = [];
  for (const job of rows.results) {
    const marker = `rearchive-only:${rearchiveKey}`;
    const prior = await env.REEL_DB.prepare("SELECT id FROM job_events WHERE job_id=? AND detail=? LIMIT 1")
      .bind(job.id, marker).first<{ id: string }>();
    if (prior) { idempotent.push(job.id); continue; }
    if (job.status !== "complete") return json({ error: `Job ${job.id} is ${job.status}; only completed jobs may be rearchived` }, { status: 409 });
    await env.REEL_DB.batch([
      env.REEL_DB.prepare(
        "UPDATE jobs SET status='queued',stage='queued',error_code='rearchive_only',error_message=NULL,started_at=NULL,completed_at=NULL,upload_token_hash=NULL,upload_token_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      ).bind(job.id),
      env.REEL_DB.prepare("INSERT INTO job_events(job_id,stage,status,emoji,detail) VALUES (?,'queued','queued','⬇️',?)")
        .bind(job.id, marker),
    ]);
    await env.REEL_QUEUE.send({ jobId: job.id });
    queued.push(job.id);
  }
  return json({ ok: true, pilot_id: pilotId, rearchive_key: rearchiveKey, queued, idempotent }, { status: 202 });
}

async function handleMediaEnrich(request: Request, env: Env): Promise<Response> {
  const input = await readJson<{ job_ids?: string[]; confirm_enrich?: string }>(request);
  const jobIds = [...new Set((input.job_ids || []).map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 20);
  if (!jobIds.length) return json({ error: "job_ids are required" }, { status: 400 });
  if (input.confirm_enrich !== "ENRICH_MEDIA_AND_REPUBLISH") {
    return json({ error: "confirm_enrich must equal ENRICH_MEDIA_AND_REPUBLISH" }, { status: 400 });
  }
  const results: Array<{ job_id: string; resources: number; artwork: number; youtube: number; spotify: number; articles: number }> = [];
  for (const jobId of jobIds) {
    const job = await env.REEL_DB.prepare("SELECT * FROM jobs WHERE id=? AND status='complete' AND synthesis_json_key IS NOT NULL")
      .bind(jobId).first<JobRow>();
    if (!job?.synthesis_json_key) return json({ error: `Completed synthesis is unavailable for ${jobId}`, results }, { status: 409 });
    const object = await env.REEL_ARCHIVE.get(job.synthesis_json_key);
    const payload = object ? await object.json<SynthesisPayload>().catch(() => null) : null;
    if (!payload || !Array.isArray(payload.resources)) return json({ error: `Stored synthesis is invalid for ${jobId}`, results }, { status: 500 });
    payload.resources = await enrichSynthesisResourceMedia(payload.resources);
    await env.REEL_ARCHIVE.put(job.synthesis_json_key, JSON.stringify(payload, null, 2), { httpMetadata: { contentType: "application/json" } });
    await publishSynthesisHtml(env, job, payload, { deferIndexRefresh: true });
    results.push({
      job_id: jobId,
      resources: payload.resources.length,
      artwork: payload.resources.filter((resource) => Boolean(resource.hero_image_url)).length,
      youtube: payload.resources.filter((resource) => Boolean(resource.youtube_candidates?.length)).length,
      spotify: payload.resources.filter((resource) => Boolean(resource.spotify_url)).length,
      articles: payload.resources.filter((resource) => Boolean(resource.article_links?.length)).length,
    });
  }
  await refreshYoutubeCollectionPages(env);
  await refreshArtifactCollectionPages(env);
  await refreshListCollectionPage(env);
  await refreshReelLibraryManifest(env);
  return json({ ok: true, results });
}

async function handleListBackfill(request: Request, env: Env): Promise<Response> {
  const input = await readJson<{ job_id?: string; lists?: SynthesisList[]; confirm_backfill?: string }>(request);
  const jobId = String(input.job_id || "").trim();
  if (!jobId || input.confirm_backfill !== "BACKFILL_RECREATED_LISTS") {
    return json({ error: "job_id and exact confirm_backfill are required" }, { status: 400 });
  }
  if (!Array.isArray(input.lists) || !input.lists.length || input.lists.length > 20) {
    return json({ error: "lists must contain between 1 and 20 lists" }, { status: 400 });
  }
  const job = await env.REEL_DB.prepare("SELECT * FROM jobs WHERE id=? AND status='complete' AND synthesis_json_key IS NOT NULL")
    .bind(jobId).first<JobRow>();
  if (!job?.synthesis_json_key) return json({ error: "Completed synthesis is unavailable" }, { status: 409 });
  const object = await env.REEL_ARCHIVE.get(job.synthesis_json_key);
  const payload = object ? await object.json<SynthesisPayload>().catch(() => null) : null;
  if (!payload?.metadata?.title || !Array.isArray(payload.resources)) return json({ error: "Stored synthesis is invalid" }, { status: 500 });
  const resourceNames = new Set(payload.resources.map((resource) => slugify(resource.name)));
  for (const list of input.lists) {
    if (!String(list?.title || "").trim() || !Array.isArray(list?.items) || list.items.length < 2 || list.items.length > 200) {
      return json({ error: "Every list requires a title and 2-200 items" }, { status: 400 });
    }
    for (const item of list.items) {
      if (!String(item?.label || "").trim() || !resourceNames.has(slugify(String(item?.resource_name || "")))) {
        return json({ error: `List item ${String(item?.label || "(untitled)")} does not match a stored resource` }, { status: 409 });
      }
    }
  }
  payload.lists = input.lists;
  const serialised = JSON.stringify(input.lists, null, 2);
  const digest = await sha256(serialised);
  const listKey = `reels/${job.shortcode || job.id}/${job.id}/synthesis/lists-${digest.slice(0, 12)}.json`;
  const marker = `list_backfill:${digest.slice(0, 12)}`;
  const prior = await env.REEL_DB.prepare("SELECT id FROM job_events WHERE job_id=? AND detail=? LIMIT 1")
    .bind(jobId, marker).first<{ id: string }>();
  if (prior) return json({ ok: true, idempotent: true, job_id: jobId, lists: input.lists.length, root_path: job.library_path });
  const existing = await env.REEL_ARCHIVE.head(listKey);
  if (!existing) await putPhase7MirroredObject(env, listKey, serialised, { httpMetadata: { contentType: "application/json" } });
  await env.REEL_DB.prepare(
    "INSERT INTO artifacts(id,job_id,kind,object_key,content_type,byte_size,sha256) VALUES (?,?,?,?,?,?,?) ON CONFLICT(object_key) DO UPDATE SET byte_size=excluded.byte_size,sha256=excluded.sha256",
  ).bind(uuid(), jobId, "lists", listKey, "application/json", new TextEncoder().encode(serialised).byteLength, digest).run();
  const published = await publishSynthesisHtml(env, job, payload);
  await env.REEL_DB.prepare("INSERT INTO job_events(job_id,stage,status,detail) SELECT ?,'published','complete',? WHERE NOT EXISTS (SELECT 1 FROM job_events WHERE job_id=? AND detail=?)")
    .bind(jobId, marker, jobId, marker).run();
  return json({ ok: true, job_id: jobId, lists: input.lists.length, root_path: published.rootPath });
}

async function handleConfirmLiveMode(env: Env): Promise<Response> {
  if ((env.INGEST_MODE || "disabled") !== "live") return json({ error: "INGEST_MODE is not live" }, { status: 409 });
  const senderId = allowedInstagramSenders(env)[0];
  if (!senderId) return json({ error: "No allowlisted Instagram recipient is configured" }, { status: 503 });
  const previous = await env.REEL_DB.prepare("SELECT id FROM outbound_events WHERE kind='live_mode_confirmation' AND status='sent' ORDER BY created_at DESC LIMIT 1").first<{ id: string }>();
  if (previous) return json({ ok: true, sent: false, idempotent: true });
  const sent = await sendInstagramText(env, senderId, "Test mode is off. Live intake is enabled, and the bounded 10-post backlog pilot is starting.", null, "live_mode_confirmation");
  return json({ ok: sent, sent }, { status: sent ? 200 : 502 });
}

async function handleRecoverInstagramMessage(request: Request, env: Env): Promise<Response> {
  const input = await readJson<{ message_id?: string; confirm_recovery?: string }>(request);
  const messageId = String(input.message_id || "").trim();
  if (!messageId) return json({ error: "message_id is required" }, { status: 400 });
  if (input.confirm_recovery !== "RECOVER_MESSAGE") return json({ error: "confirm_recovery must equal RECOVER_MESSAGE" }, { status: 400 });
  const command = await env.REEL_DB.prepare("SELECT sender_id,input_text FROM dm_commands WHERE source_message_id=?")
    .bind(messageId).first<{ sender_id: string | null; input_text: string | null }>();
  if (!command) return json({ error: "Message command was not found" }, { status: 404 });
  const captured = await env.REEL_DB.prepare("SELECT raw_json FROM inbound_webhook_events WHERE source_message_id=?")
    .bind(messageId).first<{ raw_json: string | null }>();
  let capturedPayload: unknown;
  try {
    capturedPayload = captured?.raw_json ? JSON.parse(captured.raw_json) as unknown : undefined;
  } catch {
    capturedPayload = undefined;
  }
  const recovered = await recoverInstagramMessage(env, messageId, capturedPayload);
  if (!recovered?.sourceUrl) {
    if (recovered) {
      await env.REEL_DB.prepare(
        "UPDATE inbound_webhook_events SET recovery_json=?,updated_at=CURRENT_TIMESTAMP WHERE source_message_id=?",
      ).bind(JSON.stringify(recovered.payload).slice(0, 16000), messageId).run();
    }
    const fallback = recovered?.hasShareAttachment && command.sender_id
      ? await enqueueCarouselResolution(env, {
          senderId: command.sender_id,
          sourceMessageId: messageId,
          raw: capturedPayload,
          instructions: command.input_text || "",
        })
      : null;
    return json({
      error: "No processable Instagram post URL could be recovered",
      has_share_attachment: recovered?.hasShareAttachment || false,
      recovery: recovered?.payload || null,
      fallback,
    }, { status: 409 });
  }
  const result = await createJob(env, {
    sourceUrl: recovered.sourceUrl,
    instructions: command.input_text || "",
    senderId: command.sender_id,
    sourceMessageId: messageId,
  });
  await env.REEL_DB.prepare(
    "UPDATE dm_commands SET intent='reel',status='complete',result_job_id=?,result_summary=?,error=NULL,completed_at=CURRENT_TIMESTAMP WHERE source_message_id=?",
  ).bind(result.id, JSON.stringify({ ok: true, recovered: true, ...result }).slice(0, 1500), messageId).run();
  return json({ ok: true, recovered: true, ...result }, { status: result.duplicate ? 200 : 202 });
}

async function handleRetryJob(request: Request, env: Env, jobId: string): Promise<Response> {
  const input = await readJson<{ confirm_retry?: string }>(request);
  if (input.confirm_retry !== "RETRY_JOB") {
    return json({ error: "confirm_retry must equal RETRY_JOB" }, { status: 400 });
  }
  const job = await env.REEL_DB.prepare("SELECT * FROM jobs WHERE id=?").bind(jobId).first<JobRow>();
  if (!job) return json({ error: "Job not found" }, { status: 404 });
  if (job.status === "complete") return json({ ok: true, queued: false, status: "complete" });
  if (job.status === "queued" || job.status === "running") {
    return json({ ok: true, queued: false, status: job.status, stage: job.stage });
  }
  await env.REEL_DB.prepare(
    "UPDATE jobs SET status='queued',stage='queued',started_at=NULL,completed_at=NULL,upload_token_hash=NULL,upload_token_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?",
  ).bind(job.id).run();
  await env.REEL_DB.prepare(
    "UPDATE dm_commands SET intent='reel',status='queued',result_job_id=?,result_summary=?,error=NULL,completed_at=NULL WHERE source_message_id=?",
  ).bind(job.id, JSON.stringify({ ok: true, retried: true, job_id: job.id }), job.source_message_id || "").run();
  await setStage(env, job, "queued", "queued", "Administrative retry requested after processor correction");
  try {
    await env.REEL_QUEUE.send({ jobId: job.id });
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 500) : "Queue send failed";
    await env.REEL_DB.batch([
      env.REEL_DB.prepare("UPDATE jobs SET status=?,stage=?,error_code=?,error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(job.status, job.stage, job.error_code, job.error_message, job.id),
      env.REEL_DB.prepare("INSERT INTO job_events(job_id,stage,status,emoji,detail) VALUES (?,'error_queue','failed','❓',?)")
        .bind(job.id, detail),
      env.REEL_DB.prepare("UPDATE dm_commands SET status='failed',error=? WHERE source_message_id=?")
        .bind(detail, job.source_message_id || ""),
    ]);
    return json({ ok: false, queued: false, job_id: job.id, error: detail }, { status: 503 });
  }
  return json({ ok: true, queued: true, job_id: job.id, attempts: job.attempts });
}

async function handleCorrectiveResynthesis(request: Request, env: Env, jobId: string): Promise<Response> {
  const input = await readJson<{ confirm_corrective?: string; corrective_key?: string; instructions?: string; reason?: string }>(request);
  const result = await correctivelyResynthesiseOne(
    {
      readJob: async (id) => env.REEL_DB.prepare("SELECT * FROM jobs WHERE id=?").bind(id).first<JobRow>(),
      hasAuditEvent: async (id, marker) => {
        const prior = await env.REEL_DB.prepare("SELECT id FROM job_events WHERE job_id=? AND instr(detail, ?) > 0 LIMIT 1")
          .bind(id, marker).first<{ id: string }>();
        return !!prior;
      },
      applyReset: async (reset) => {
        const claim = await env.REEL_DB.prepare(
          `UPDATE jobs SET instructions=?,status='queued',stage='queued',error_code=NULL,error_message=NULL,started_at=NULL,completed_at=NULL,
            processing_seconds=NULL,codex_input_tokens=NULL,codex_cached_input_tokens=NULL,codex_output_tokens=NULL,
            codex_reasoning_output_tokens=NULL,codex_total_tokens=NULL,synthesis_json_key=NULL,upload_token_hash=NULL,
            upload_token_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='complete' AND pilot_run_id IS NULL`,
        ).bind(reset.instructions, reset.job.id).run();
        if (!correctiveClaimApplied(claim)) return { applied: false };
        const guardedJob = "EXISTS(SELECT 1 FROM jobs WHERE id=? AND status='queued' AND pilot_run_id IS NULL AND instructions=?)";
        const results = await env.REEL_DB.batch([
          env.REEL_DB.prepare(`DELETE FROM resources WHERE job_id=? AND ${guardedJob}`)
            .bind(reset.job.id, reset.job.id, reset.instructions),
          env.REEL_DB.prepare(
            `UPDATE dm_commands SET input_text=?,status='queued',result_job_id=?,result_summary=?,error=NULL,completed_at=NULL
             WHERE source_message_id=? AND ${guardedJob}`,
          ).bind(reset.instructions, reset.job.id, JSON.stringify(reset.commandSummary), reset.job.source_message_id || "", reset.job.id, reset.instructions),
          env.REEL_DB.prepare(
            `INSERT INTO job_events(job_id,stage,status,emoji,detail)
             SELECT ?,'queued','queued','⬇️',? WHERE ${guardedJob}`,
          ).bind(reset.job.id, reset.eventDetail, reset.job.id, reset.instructions),
        ]);
        return { applied: correctiveClaimApplied(results[2]) };
      },
      queueJob: async (id) => {
        await env.REEL_QUEUE.send({ jobId: id });
      },
      markQueueFailure: async (id, detail) => {
        await env.REEL_DB.batch([
          env.REEL_DB.prepare(
            "UPDATE jobs SET status='failed',stage='error_queue',error_code='error_queue',error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued'",
          ).bind(detail, id),
          env.REEL_DB.prepare("INSERT INTO job_events(job_id,stage,status,emoji,detail) VALUES (?,'error_queue','failed','❓',?)")
            .bind(id, detail),
        ]);
      },
    },
    {
      jobId,
      confirm: input.confirm_corrective,
      correctiveKey: input.corrective_key || "",
      instructions: input.instructions || "",
      reason: input.reason,
    },
  );
  return json(result.body, { status: result.status });
}

const PHASE5_ACTIVE_FENCE_SQL = "'armed','local_claimed','local_processing'";

async function phase6Authority(env: Env): Promise<Phase6AuthoritySnapshot> {
  try {
    const row = await env.REEL_DB.prepare(
      `SELECT mode,generation,dispatch_enabled,codex_enabled,outbound_enabled,backlog_enabled,cutover_watermark
       FROM processing_authority WHERE authority_key='instagram-reel-brain'`,
    ).first<Phase6AuthoritySnapshot>();
    if (row) return row;
  } catch (error) {
    if (!String((error as Error)?.message || error).includes("processing_authority")) throw error;
  }
  return {
    mode: "cloud",
    generation: 0,
    dispatch_enabled: 0,
    codex_enabled: 0,
    outbound_enabled: 0,
    backlog_enabled: 0,
    cutover_watermark: null,
  };
}

async function auditPhase6CloudAuthoritySkip(env: Env, job: JobRow, authority: Phase6AuthoritySnapshot): Promise<void> {
  const marker = `phase6-authority:${authority.generation}:${job.id}:cloud-skip`;
  await env.REEL_DB.prepare(
    `INSERT INTO job_events(job_id,stage,status,emoji,detail)
     SELECT ?,'phase6_local_authority','queued','🔒',?
     WHERE NOT EXISTS (SELECT 1 FROM job_events WHERE job_id=? AND instr(COALESCE(detail,''), ?) > 0)`,
  ).bind(job.id, JSON.stringify({ marker, mode: authority.mode, generation: authority.generation, cloud_processing_skipped: true }), job.id, marker).run();
}

async function activePhase5FenceForJob(env: Env, jobId: string): Promise<Phase5FenceRow | null> {
  try {
    const row = await env.REEL_DB.prepare(
      `SELECT pilot_key,job_id,source_message_id,status,expires_at,local_lease_owner,local_lease_expires_at
       FROM phase5_local_pilot_fences
       WHERE job_id=? AND status IN (${PHASE5_ACTIVE_FENCE_SQL})
       ORDER BY created_at DESC LIMIT 1`,
    ).bind(jobId).first<Phase5FenceRow>();
    return phase5FenceActive(row) ? row : null;
  } catch (error) {
    if (String((error as Error)?.message || error).includes("phase5_local_pilot_fences")) return null;
    throw error;
  }
}

async function auditPhase5CloudFenceSkip(env: Env, job: JobRow, fence: Phase5FenceRow): Promise<void> {
  const marker = `phase5-local-pilot:${fence.pilot_key}:cloud-skip`;
  await env.REEL_DB.prepare(
    `INSERT INTO job_events(job_id,stage,status,emoji,detail)
     SELECT ?,'phase5_local_fenced','queued','🧪',?
     WHERE NOT EXISTS (
       SELECT 1 FROM job_events WHERE job_id=? AND stage='phase5_local_fenced' AND instr(COALESCE(detail,''), ?) > 0
     )`,
  ).bind(
    job.id,
    JSON.stringify({
      marker,
      pilot_key: fence.pilot_key,
      source_message_id: fence.source_message_id,
      cloud_processing_skipped: true,
    }),
    job.id,
    marker,
  ).run();
}

async function handlePhase5Fence(request: Request, env: Env): Promise<Response> {
  const input = await readJson<{
    pilot_key?: string;
    job_id?: string;
    source_message_id?: string;
    confirm_fence?: string;
    expires_minutes?: number;
  }>(request);
  let validated: ReturnType<typeof validatePhase5FenceRequest>;
  try {
    validated = validatePhase5FenceRequest({ ...input, confirmation: input.confirm_fence });
  } catch (error) {
    return json({ ok: false, error: String((error as Error).message || error) }, { status: 400 });
  }
  const { pilotKey, jobId, sourceMessageId, expiresAt } = validated;
  const active = await env.REEL_DB.prepare(
    `SELECT pilot_key,job_id,source_message_id,status,expires_at
     FROM phase5_local_pilot_fences
     WHERE status IN (${PHASE5_ACTIVE_FENCE_SQL}) AND datetime(expires_at) > datetime('now')
     ORDER BY created_at DESC LIMIT 1`,
  ).first<Phase5FenceRow>();
  if (active && (active.pilot_key !== pilotKey || active.job_id !== jobId)) {
    return json({ ok: false, error: "A different Phase 5 local pilot fence is already active", active }, { status: 409 });
  }
  const job = await env.REEL_DB.prepare(
    `SELECT id,status,stage,source_message_id,dedupe_key,created_at,pilot_run_id
     FROM jobs WHERE id=?`,
  ).bind(jobId).first<Pick<JobRow, "id" | "status" | "stage" | "source_message_id" | "dedupe_key" | "created_at" | "pilot_run_id">>();
  if (!job) return json({ ok: false, error: "Exact job not found" }, { status: 404 });
  if (job.pilot_run_id) return json({ ok: false, error: "Pilot/backlog jobs cannot be fenced for Phase 5 local compute" }, { status: 409 });
  if (job.status !== "queued") return json({ ok: false, error: "Only a queued new share can be fenced", job_status: job.status, job_stage: job.stage }, { status: 409 });
  if (job.source_message_id !== sourceMessageId) return json({ ok: false, error: "source_message_id does not match the job" }, { status: 409 });
  if (Date.parse(job.created_at) < Date.parse(PHASE5_MIN_EXPLICIT_JOB_CREATED_AT)) {
    return json({ ok: false, error: "Phase 5 pilot fences require a new explicitly identified post-gate share" }, { status: 409 });
  }
  const audit = {
    pilot_key: pilotKey,
    job_id: jobId,
    source_message_id: sourceMessageId,
    min_created_at: PHASE5_MIN_EXPLICIT_JOB_CREATED_AT,
    created_by: "admin_explicit_phase5_pilot",
  };
  await env.REEL_DB.batch([
    env.REEL_DB.prepare(
      `INSERT INTO phase5_local_pilot_fences(pilot_key,job_id,source_message_id,dedupe_key,status,expires_at,audit_json)
       VALUES (?, ?, ?, ?, 'armed', ?, ?)
       ON CONFLICT(pilot_key) DO UPDATE SET
         job_id=excluded.job_id,
         source_message_id=excluded.source_message_id,
         dedupe_key=excluded.dedupe_key,
         status=CASE WHEN phase5_local_pilot_fences.status IN ('armed','local_claimed','local_processing') THEN phase5_local_pilot_fences.status ELSE 'armed' END,
         expires_at=excluded.expires_at,
         audit_json=excluded.audit_json,
         updated_at=CURRENT_TIMESTAMP
       WHERE phase5_local_pilot_fences.job_id=excluded.job_id`,
    ).bind(pilotKey, jobId, sourceMessageId, job.dedupe_key || null, expiresAt, JSON.stringify(audit)),
    env.REEL_DB.prepare(
      `INSERT INTO job_events(job_id,stage,status,emoji,detail)
       SELECT ?,'phase5_local_fenced','queued','🧪',?
       WHERE NOT EXISTS (
         SELECT 1 FROM job_events WHERE job_id=? AND stage='phase5_local_fenced' AND instr(COALESCE(detail,''), ?) > 0
       )`,
    ).bind(jobId, JSON.stringify({ ...audit, marker: `phase5-local-pilot:${pilotKey}:fenced`, expires_at: expiresAt }), jobId, `phase5-local-pilot:${pilotKey}:fenced`),
  ]);
  return json({ ok: true, fenced: true, pilot_key: pilotKey, job_id: jobId, source_message_id: sourceMessageId, expires_at: expiresAt });
}

async function handlePhase5Rollback(request: Request, env: Env): Promise<Response> {
  const input = await readJson<{ pilot_key?: string; job_id?: string; confirm_rollback?: string; reason?: string }>(request);
  let validated: ReturnType<typeof validatePhase5RollbackRequest>;
  try {
    validated = validatePhase5RollbackRequest({ ...input, confirmation: input.confirm_rollback });
  } catch (error) {
    return json({ ok: false, error: String((error as Error).message || error) }, { status: 400 });
  }
  const fence = await env.REEL_DB.prepare(
    `SELECT pilot_key,job_id,source_message_id,status,expires_at
     FROM phase5_local_pilot_fences WHERE pilot_key=? AND job_id=?`,
  ).bind(validated.pilotKey, validated.jobId).first<Phase5FenceRow>();
  if (!fence) return json({ ok: false, error: "Phase 5 pilot fence not found" }, { status: 404 });
  if (fence.status === "rolled_back") return json({ ok: true, rolled_back: true, idempotent: true, queued: false, pilot_key: validated.pilotKey, job_id: validated.jobId });
  if (!isPhase5ActiveFenceStatus(fence.status)) {
    return json({ ok: false, error: "Only an active Phase 5 fence can be rolled back to cloud queue", fence_status: fence.status }, { status: 409 });
  }
  const job = await env.REEL_DB.prepare("SELECT id,status,stage FROM jobs WHERE id=?").bind(validated.jobId).first<Pick<JobRow, "id" | "status" | "stage">>();
  if (!job) return json({ ok: false, error: "Job not found" }, { status: 404 });
  if (job.status === "complete") return json({ ok: false, error: "Completed jobs cannot be requeued by Phase 5 rollback" }, { status: 409 });
  await env.REEL_DB.batch([
    env.REEL_DB.prepare(
      `UPDATE phase5_local_pilot_fences
       SET status='rolled_back',rollback_at=CURRENT_TIMESTAMP,rollback_reason=?,updated_at=CURRENT_TIMESTAMP
       WHERE pilot_key=? AND job_id=? AND status IN (${PHASE5_ACTIVE_FENCE_SQL})`,
    ).bind(validated.reason, validated.pilotKey, validated.jobId),
    env.REEL_DB.prepare(
      "UPDATE jobs SET status='queued',stage='queued',error_code=NULL,error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status <> 'complete'",
    ).bind(validated.jobId),
    env.REEL_DB.prepare(
      `UPDATE phase5_preintake_arms
       SET status='rolled_back',rollback_at=CURRENT_TIMESTAMP,rollback_reason=?,updated_at=CURRENT_TIMESTAMP
       WHERE arm_key=? AND job_id=? AND status='captured'`,
    ).bind(validated.reason, validated.pilotKey, validated.jobId),
    env.REEL_DB.prepare(
      "INSERT INTO job_events(job_id,stage,status,emoji,detail) VALUES (?,'phase5_local_rollback','queued','↩️',?)",
    ).bind(validated.jobId, JSON.stringify({ pilot_key: validated.pilotKey, reason: validated.reason, requeued_to_cloud: true })),
  ]);
  await env.REEL_QUEUE.send({ jobId: validated.jobId });
  return json({ ok: true, rolled_back: true, queued: true, pilot_key: validated.pilotKey, job_id: validated.jobId });
}

async function handlePhase5RenewLease(request: Request, env: Env): Promise<Response> {
  const input = await readJson<{
    pilot_key?: string;
    job_id?: string;
    source_message_id?: string;
    lease_owner?: string;
    confirm_renew?: string;
    expires_minutes?: number;
    reason?: string;
  }>(request);
  let validated: ReturnType<typeof validatePhase5RenewRequest>;
  try {
    validated = validatePhase5RenewRequest({ ...input, confirmation: input.confirm_renew });
  } catch (error) {
    return json({ ok: false, error: String((error as Error).message || error) }, { status: 400 });
  }
  const row = await env.REEL_DB.prepare(
    `SELECT f.pilot_key,f.job_id,f.source_message_id,f.status,f.local_lease_owner,f.local_lease_expires_at,
            j.status AS job_status,j.stage AS job_stage,j.html_key,j.library_path,j.completed_at,
            (SELECT COUNT(*) FROM artifacts a WHERE a.job_id=f.job_id AND (a.object_key LIKE 'library/%' OR a.object_key LIKE 'reels/%/index.html')) AS publication_artifacts,
            (SELECT COUNT(*) FROM job_events e WHERE e.job_id=f.job_id AND e.stage IN ('complete','published','phase5_local_complete')) AS completion_events
     FROM phase5_local_pilot_fences f
     JOIN jobs j ON j.id=f.job_id
     WHERE f.pilot_key=? AND f.job_id=? AND f.source_message_id=?`,
  ).bind(validated.pilotKey, validated.jobId, validated.sourceMessageId).first<Phase5FenceRow & {
    job_status: string;
    job_stage: string;
    html_key: string | null;
    library_path: string | null;
    completed_at: string | null;
    publication_artifacts: number;
    completion_events: number;
  }>();
  if (!row) return json({ ok: false, error: "Exact Phase 5 fence/job not found" }, { status: 404 });
  if (row.status !== "local_claimed" || row.local_lease_owner !== validated.leaseOwner) {
    return json({ ok: false, error: "Phase 5 renewal requires the exact local_claimed fence and lease owner", fence_status: row.status, lease_owner: row.local_lease_owner }, { status: 409 });
  }
  if (row.job_status !== "queued") {
    return json({ ok: false, error: "Phase 5 renewal requires the job to remain queued", job_status: row.job_status, job_stage: row.job_stage }, { status: 409 });
  }
  if (row.html_key || row.library_path || row.completed_at || Number(row.publication_artifacts || 0) > 0 || Number(row.completion_events || 0) > 0) {
    return json({ ok: false, error: "Phase 5 renewal refused because completion/publication evidence exists" }, { status: 409 });
  }
  const marker = `phase5-local-pilot:${validated.pilotKey}:renew:${validated.expiresAt}`;
  const updated = await env.REEL_DB.prepare(
    `UPDATE phase5_local_pilot_fences
     SET expires_at=?,local_lease_expires_at=?,updated_at=CURRENT_TIMESTAMP
     WHERE pilot_key=? AND job_id=? AND source_message_id=? AND status='local_claimed' AND local_lease_owner=?
       AND EXISTS (
         SELECT 1 FROM jobs j
         WHERE j.id=phase5_local_pilot_fences.job_id
           AND j.status='queued'
           AND j.html_key IS NULL
           AND j.library_path IS NULL
           AND j.completed_at IS NULL
       )
       AND NOT EXISTS (
         SELECT 1 FROM artifacts a
         WHERE a.job_id=phase5_local_pilot_fences.job_id
           AND (a.object_key LIKE 'library/%' OR a.object_key LIKE 'reels/%/index.html')
       )
       AND NOT EXISTS (
         SELECT 1 FROM job_events e
         WHERE e.job_id=phase5_local_pilot_fences.job_id
           AND e.stage IN ('complete','published','phase5_local_complete')
       )`,
  ).bind(validated.expiresAt, validated.expiresAt, validated.pilotKey, validated.jobId, validated.sourceMessageId, validated.leaseOwner).run();
  if ((updated.meta.changes || 0) !== 1) {
    return json({ ok: false, error: "Phase 5 renewal lost the guarded claim or the job is no longer renewable" }, { status: 409 });
  }
  await env.REEL_DB.prepare(
    "INSERT INTO job_events(job_id,stage,status,emoji,detail) VALUES (?,'phase5_local_lease_renewed','queued','🧪',?)",
  ).bind(validated.jobId, JSON.stringify({
    marker,
    pilot_key: validated.pilotKey,
    source_message_id: validated.sourceMessageId,
    lease_owner: validated.leaseOwner,
    expires_at: validated.expiresAt,
    reason: validated.reason,
    confirmation: PHASE5_RENEW_CONFIRMATION,
  })).run();
  return json({ ok: true, renewed: true, pilot_key: validated.pilotKey, job_id: validated.jobId, lease_owner: validated.leaseOwner, expires_at: validated.expiresAt });
}

type Phase5ControlStateRow = Phase5FenceRow & {
  job_status: string;
  job_stage: string;
  upload_token_hash: string | null;
  upload_token_expires_at: string | null;
  html_key: string | null;
  library_path: string | null;
  completed_at: string | null;
  publication_artifacts: number;
  completion_events: number;
  marker_events: number;
};

async function phase5ControlState(
  env: Env,
  input: { pilotKey: string; jobId: string; sourceMessageId: string; marker?: string },
): Promise<Phase5ControlStateRow | null> {
  return env.REEL_DB.prepare(
    `SELECT f.pilot_key,f.job_id,f.source_message_id,f.status,f.expires_at,f.local_lease_owner,f.local_lease_expires_at,
            j.status AS job_status,j.stage AS job_stage,j.upload_token_hash,j.upload_token_expires_at,j.html_key,j.library_path,j.completed_at,
            (SELECT COUNT(*) FROM artifacts a WHERE a.job_id=f.job_id AND (a.object_key LIKE 'library/%' OR a.object_key LIKE 'reels/%/index.html')) AS publication_artifacts,
            (SELECT COUNT(*) FROM job_events e WHERE e.job_id=f.job_id AND e.stage IN ('complete','published','phase5_local_complete')) AS completion_events,
            (SELECT COUNT(*) FROM job_events e WHERE e.job_id=f.job_id AND instr(COALESCE(e.detail,''), ?) > 0) AS marker_events
     FROM phase5_local_pilot_fences f
     JOIN jobs j ON j.id=f.job_id
     WHERE f.pilot_key=? AND f.job_id=? AND f.source_message_id=?`,
  ).bind(input.marker || "__phase5_no_marker__", input.pilotKey, input.jobId, input.sourceMessageId).first<Phase5ControlStateRow>();
}

async function phase5InsertControlMarker(
  env: Env,
  input: { jobId: string; marker: string },
  event: { stage: string; status: string; emoji: string; detail: Record<string, unknown> },
): Promise<boolean> {
  const inserted = await env.REEL_DB.prepare(
    `INSERT INTO job_events(job_id,stage,status,emoji,detail)
     SELECT ?,?,?,?,?
     WHERE NOT EXISTS (
       SELECT 1 FROM job_events WHERE job_id=? AND instr(COALESCE(detail,''), ?) > 0
     )`,
  ).bind(
    input.jobId,
    event.stage,
    event.status,
    event.emoji,
    JSON.stringify(event.detail),
    input.jobId,
    input.marker,
  ).run();
  return (inserted.meta.changes || 0) === 1;
}

async function phase5EnsureStartAudit(
  env: Env,
  input: ReturnType<typeof validatePhase5StartRequest>,
  tokenExpiresAt: string | null | undefined,
  recoveryStatus: string,
): Promise<boolean> {
  return phase5InsertControlMarker(env, input, {
    stage: "phase5_local_processing",
    status: "running",
    emoji: "🧪",
    detail: {
      marker: input.marker,
      pilot_key: input.pilotKey,
      source_message_id: input.sourceMessageId,
      lease_owner: input.leaseOwner,
      token_expires_at: tokenExpiresAt || null,
      reason: input.reason,
      confirmation: PHASE5_START_CONFIRMATION,
      recovery_status: recoveryStatus,
    },
  });
}

async function phase5EnsureFinalizeAudit(
  env: Env,
  input: ReturnType<typeof validatePhase5FinalizeRequest>,
  recoveryStatus: string,
): Promise<boolean> {
  return phase5InsertControlMarker(env, input, {
    stage: "phase5_local_complete",
    status: "complete",
    emoji: "✅",
    detail: {
      marker: input.marker,
      pilot_key: input.pilotKey,
      source_message_id: input.sourceMessageId,
      lease_owner: input.leaseOwner,
      reason: input.reason,
      confirmation: PHASE5_FINALIZE_CONFIRMATION,
      recovery_status: recoveryStatus,
    },
  });
}

function phase5StartRequestWithEffectiveExpiry(
  input: ReturnType<typeof validatePhase5StartRequest>,
  decision: { effectiveTokenExpiresAt?: string },
): ReturnType<typeof validatePhase5StartRequest> {
  return decision.effectiveTokenExpiresAt ? { ...input, tokenExpiresAt: decision.effectiveTokenExpiresAt } : input;
}

function phase5ExecutionExpiryPostcondition(
  row: Phase5ControlStateRow | null,
  tokenExpiresAt: string,
): boolean {
  if (!row) return false;
  const tokenExpiresMs = Date.parse(tokenExpiresAt);
  const fenceExpiresMs = Date.parse(row.expires_at || "");
  return Boolean(
    Number.isFinite(tokenExpiresMs)
    && Number.isFinite(fenceExpiresMs)
    && tokenExpiresMs <= fenceExpiresMs
    && row.upload_token_expires_at === tokenExpiresAt
    && row.local_lease_expires_at === tokenExpiresAt
  );
}

async function phase5RenewProcessingLease(
  env: Env,
  input: ReturnType<typeof validatePhase5StartRequest>,
): Promise<boolean> {
  if (!input.callbackTokenHash) return false;
  const results = await env.REEL_DB.batch([
    env.REEL_DB.prepare(
      `UPDATE phase5_local_pilot_fences
       SET local_lease_expires_at=?,updated_at=CURRENT_TIMESTAMP
       WHERE pilot_key=? AND job_id=? AND source_message_id=? AND status='local_processing' AND local_lease_owner=?
         AND datetime(expires_at) > datetime('now')
         AND datetime(expires_at) >= datetime(?)
         AND EXISTS (
           SELECT 1 FROM jobs j
           WHERE j.id=phase5_local_pilot_fences.job_id
             AND j.source_message_id=?
             AND j.status='running'
             AND j.upload_token_hash=?
             AND j.completed_at IS NULL
             AND j.html_key IS NULL
             AND j.library_path IS NULL
         )
         AND NOT EXISTS (
           SELECT 1 FROM artifacts a
           WHERE a.job_id=phase5_local_pilot_fences.job_id
             AND (a.object_key LIKE 'library/%' OR a.object_key LIKE 'reels/%/index.html')
         )
         AND NOT EXISTS (
           SELECT 1 FROM job_events e
           WHERE e.job_id=phase5_local_pilot_fences.job_id
             AND e.stage IN ('complete','published','phase5_local_complete')
         )`,
    ).bind(
      input.tokenExpiresAt,
      input.pilotKey,
      input.jobId,
      input.sourceMessageId,
      input.leaseOwner,
      input.tokenExpiresAt,
      input.sourceMessageId,
      input.callbackTokenHash,
    ),
    env.REEL_DB.prepare(
      `UPDATE jobs
       SET upload_token_expires_at=?,updated_at=CURRENT_TIMESTAMP
       WHERE id=? AND source_message_id=? AND status='running' AND upload_token_hash=?
         AND completed_at IS NULL
         AND html_key IS NULL
         AND library_path IS NULL
         AND EXISTS (
           SELECT 1 FROM phase5_local_pilot_fences f
           WHERE f.job_id=jobs.id
             AND f.pilot_key=?
             AND f.source_message_id=?
             AND f.status='local_processing'
             AND f.local_lease_owner=?
             AND f.local_lease_expires_at=?
             AND datetime(f.expires_at) > datetime('now')
             AND datetime(f.expires_at) >= datetime(?)
         )
         AND NOT EXISTS (
           SELECT 1 FROM artifacts a
           WHERE a.job_id=jobs.id
             AND (a.object_key LIKE 'library/%' OR a.object_key LIKE 'reels/%/index.html')
         )
         AND NOT EXISTS (
           SELECT 1 FROM job_events e
           WHERE e.job_id=jobs.id
             AND e.stage IN ('complete','published','phase5_local_complete')
         )`,
    ).bind(
      input.tokenExpiresAt,
      input.jobId,
      input.sourceMessageId,
      input.callbackTokenHash,
      input.pilotKey,
      input.sourceMessageId,
      input.leaseOwner,
      input.tokenExpiresAt,
      input.tokenExpiresAt,
    ),
  ]);
  return results.every((result) => (result.meta.changes || 0) === 1);
}

async function phase5RepairQueuedStart(
  env: Env,
  input: ReturnType<typeof validatePhase5StartRequest>,
  emoji: { display: string },
): Promise<boolean> {
  if (!input.callbackTokenHash) return false;
  const results = await env.REEL_DB.batch([
    env.REEL_DB.prepare(
      `UPDATE phase5_local_pilot_fences
       SET local_lease_expires_at=?,updated_at=CURRENT_TIMESTAMP
       WHERE pilot_key=? AND job_id=? AND source_message_id=? AND status='local_processing' AND local_lease_owner=?
         AND datetime(expires_at) > datetime('now')
         AND datetime(expires_at) >= datetime(?)
         AND EXISTS (
           SELECT 1 FROM jobs j
           WHERE j.id=phase5_local_pilot_fences.job_id
             AND j.source_message_id=?
             AND j.status='queued'
             AND j.completed_at IS NULL
             AND j.html_key IS NULL
             AND j.library_path IS NULL
         )
         AND NOT EXISTS (
           SELECT 1 FROM artifacts a
           WHERE a.job_id=phase5_local_pilot_fences.job_id
             AND (a.object_key LIKE 'library/%' OR a.object_key LIKE 'reels/%/index.html')
         )
         AND NOT EXISTS (
           SELECT 1 FROM job_events e
           WHERE e.job_id=phase5_local_pilot_fences.job_id
             AND e.stage IN ('complete','published','phase5_local_complete')
         )`,
    ).bind(input.tokenExpiresAt, input.pilotKey, input.jobId, input.sourceMessageId, input.leaseOwner, input.tokenExpiresAt, input.sourceMessageId),
    env.REEL_DB.prepare(
      `UPDATE jobs
       SET status='running',stage='downloading',status_emoji=?,started_at=COALESCE(started_at,CURRENT_TIMESTAMP),
           attempts=attempts+1,upload_token_hash=?,upload_token_expires_at=?,error_code=NULL,error_message=NULL,updated_at=CURRENT_TIMESTAMP
       WHERE id=? AND source_message_id=? AND status='queued' AND completed_at IS NULL AND html_key IS NULL AND library_path IS NULL
         AND EXISTS (
           SELECT 1 FROM phase5_local_pilot_fences f
           WHERE f.job_id=jobs.id
             AND f.pilot_key=?
             AND f.source_message_id=?
             AND f.status='local_processing'
             AND f.local_lease_owner=?
             AND f.local_lease_expires_at=?
             AND datetime(f.expires_at) > datetime('now')
             AND datetime(f.expires_at) >= datetime(?)
         )
         AND NOT EXISTS (
           SELECT 1 FROM artifacts a
           WHERE a.job_id=jobs.id
             AND (a.object_key LIKE 'library/%' OR a.object_key LIKE 'reels/%/index.html')
         )
         AND NOT EXISTS (
           SELECT 1 FROM job_events e
           WHERE e.job_id=jobs.id
             AND e.stage IN ('complete','published','phase5_local_complete')
         )`,
    ).bind(
      emoji.display,
      input.callbackTokenHash,
      input.tokenExpiresAt,
      input.jobId,
      input.sourceMessageId,
      input.pilotKey,
      input.sourceMessageId,
      input.leaseOwner,
      input.tokenExpiresAt,
      input.tokenExpiresAt,
    ),
  ]);
  return results.every((result) => (result.meta.changes || 0) === 1);
}

async function handlePhase5StartLocalProcessing(request: Request, env: Env): Promise<Response> {
  const input = await readJson<{
    pilot_key?: string;
    job_id?: string;
    source_message_id?: string;
    lease_owner?: string;
    idempotency_key?: string;
    callback_token_hash?: string;
    confirm_start?: string;
    token_minutes?: number;
    reason?: string;
  }>(request);
  let validated: ReturnType<typeof validatePhase5StartRequest>;
  const requestNow = Date.now();
  try {
    validated = validatePhase5StartRequest({ ...input, confirmation: input.confirm_start }, requestNow);
  } catch (error) {
    return json({ ok: false, error: String((error as Error).message || error) }, { status: 400 });
  }
  const existing = await phase5ControlState(env, validated);
  if (!existing) return json({ ok: false, error: "Exact Phase 5 fence/job not found" }, { status: 404 });
  const decision = phase5StartRecoveryDecision(existing, { ...validated, now: requestNow });
  if (!decision.ok) {
    return json({
      ok: false,
      error: decision.error,
      recovery_status: decision.recoveryStatus,
      requires_callback_token: Boolean(decision.requiresCallbackToken),
      prepublication_abort_required: Boolean(decision.prepublicationAbortRequired),
      fence_status: existing.status,
      lease_owner: existing.local_lease_owner,
      job_status: existing.job_status,
      job_stage: existing.job_stage,
    }, { status: decision.httpStatus });
  }

  if (decision.status === "resume_running") {
    const repairedAudit = await phase5EnsureStartAudit(env, validated, existing.upload_token_expires_at, decision.recoveryStatus);
    if (repairedAudit && shouldReactToStage("downloading")) {
      await reactToSourceMessage(env, { id: validated.jobId, source_message_id: validated.sourceMessageId, sender_id: null }, "downloading");
    }
    return json({
      ok: true,
      started: true,
      idempotent: true,
      recovery_status: decision.recoveryStatus,
      repaired_audit: repairedAudit,
      pilot_key: validated.pilotKey,
      job_id: validated.jobId,
      token_expires_at: existing.upload_token_expires_at,
    });
  }

  if (decision.status === "renew_processing_lease") {
    const execution = phase5StartRequestWithEffectiveExpiry(validated, decision);
    const renewed = await phase5RenewProcessingLease(env, execution);
    if (!renewed) {
      const post = await phase5ControlState(env, validated);
      return json({
        ok: false,
        error: "Phase 5 processing lease renewal failed closed",
        recovery_status: "processing_lease_renewal_failed",
        prepublication_abort_required: true,
        fence_status: post?.status || existing.status,
        job_status: post?.job_status || existing.job_status,
      }, { status: 409 });
    }
    const repairedAudit = await phase5EnsureStartAudit(env, execution, execution.tokenExpiresAt, decision.recoveryStatus);
    if (repairedAudit && shouldReactToStage("downloading")) {
      await reactToSourceMessage(env, { id: validated.jobId, source_message_id: validated.sourceMessageId, sender_id: null }, "downloading");
    }
    const post = await phase5ControlState(env, validated);
    if (
      !post
      || post.status !== "local_processing"
      || post.job_status !== "running"
      || post.upload_token_hash !== execution.callbackTokenHash
      || !phase5ExecutionExpiryPostcondition(post, execution.tokenExpiresAt)
    ) {
      return json({ ok: false, error: "Phase 5 processing lease renewal postcondition failed", recovery_status: "processing_lease_renewal_postcondition_failed" }, { status: 409 });
    }
    return json({
      ok: true,
      started: true,
      idempotent: true,
      renewed_processing_lease: true,
      recovery_status: decision.recoveryStatus,
      repaired_audit: repairedAudit,
      pilot_key: validated.pilotKey,
      job_id: validated.jobId,
      token_expires_at: execution.tokenExpiresAt,
    });
  }

  if (decision.status === "processor_already_complete") {
    const repairedAudit = decision.repairAudit
      ? await phase5EnsureStartAudit(env, validated, existing.upload_token_expires_at, decision.recoveryStatus)
      : false;
    return json({
      ok: true,
      started: false,
      idempotent: true,
      processor_already_complete: true,
      finalized: Boolean(decision.finalized),
      recovery_status: decision.recoveryStatus,
      repaired_audit: repairedAudit,
      pilot_key: validated.pilotKey,
      job_id: validated.jobId,
      token_expires_at: existing.upload_token_expires_at,
    });
  }

  const emoji = await getEmoji(env, "downloading");
  if (decision.status === "repair_queued_start") {
    const execution = phase5StartRequestWithEffectiveExpiry(validated, decision);
    const repaired = await phase5RepairQueuedStart(env, execution, emoji);
    if (!repaired) {
      const post = await phase5ControlState(env, validated);
      return json({
        ok: false,
        error: "Phase 5 partial start repair failed closed",
        recovery_status: "partial_start_repair_failed",
        fence_status: post?.status || existing.status,
        job_status: post?.job_status || existing.job_status,
      }, { status: 409 });
    }
    const repairedAudit = await phase5EnsureStartAudit(env, execution, execution.tokenExpiresAt, decision.recoveryStatus);
    if (repairedAudit && shouldReactToStage("downloading")) {
      await reactToSourceMessage(env, { id: validated.jobId, source_message_id: validated.sourceMessageId, sender_id: null }, "downloading");
    }
    const post = await phase5ControlState(env, validated);
    if (
      !post
      || post.status !== "local_processing"
      || post.job_status !== "running"
      || post.upload_token_hash !== execution.callbackTokenHash
      || !phase5ExecutionExpiryPostcondition(post, execution.tokenExpiresAt)
    ) {
      return json({ ok: false, error: "Phase 5 partial start repair postcondition failed", recovery_status: "partial_start_repair_postcondition_failed" }, { status: 409 });
    }
    return json({
      ok: true,
      started: true,
      repaired_start: true,
      recovery_status: decision.recoveryStatus,
      repaired_audit: repairedAudit,
      pilot_key: validated.pilotKey,
      job_id: validated.jobId,
      token_expires_at: execution.tokenExpiresAt,
    });
  }

  const execution = phase5StartRequestWithEffectiveExpiry(validated, decision);
  const fenceUpdate = await env.REEL_DB.prepare(
    `UPDATE phase5_local_pilot_fences
     SET status='local_processing',local_lease_expires_at=?,updated_at=CURRENT_TIMESTAMP
     WHERE pilot_key=? AND job_id=? AND source_message_id=? AND status='local_claimed' AND local_lease_owner=? AND datetime(expires_at) > datetime('now')
       AND datetime(expires_at) >= datetime(?)
       AND EXISTS (
         SELECT 1 FROM jobs j
         WHERE j.id=phase5_local_pilot_fences.job_id
           AND j.status='queued'
           AND j.completed_at IS NULL
           AND j.html_key IS NULL
           AND j.library_path IS NULL
       )
       AND NOT EXISTS (
         SELECT 1 FROM artifacts a
         WHERE a.job_id=phase5_local_pilot_fences.job_id
           AND (a.object_key LIKE 'library/%' OR a.object_key LIKE 'reels/%/index.html')
       )
       AND NOT EXISTS (
         SELECT 1 FROM job_events e
         WHERE e.job_id=phase5_local_pilot_fences.job_id
           AND e.stage IN ('complete','published','phase5_local_complete')
       )`,
  ).bind(execution.tokenExpiresAt, validated.pilotKey, validated.jobId, validated.sourceMessageId, validated.leaseOwner, execution.tokenExpiresAt).run();
  if ((fenceUpdate.meta.changes || 0) !== 1) {
    const post = await phase5ControlState(env, validated);
    return json({
      ok: false,
      error: "Phase 5 start lost the guarded fence claim",
      recovery_status: "guarded_fence_claim_lost",
      fence_status: post?.status || existing.status,
      job_status: post?.job_status || existing.job_status,
    }, { status: 409 });
  }

  const repairedStart = await phase5RepairQueuedStart(env, execution, emoji);
  if (!repairedStart) {
    const compensation = await env.REEL_DB.prepare(
      `UPDATE phase5_local_pilot_fences
       SET status='local_claimed',updated_at=CURRENT_TIMESTAMP
       WHERE pilot_key=? AND job_id=? AND source_message_id=? AND status='local_processing' AND local_lease_owner=?
         AND NOT EXISTS (
           SELECT 1 FROM jobs j
           WHERE j.id=phase5_local_pilot_fences.job_id
             AND j.status='running'
             AND j.upload_token_hash=?
         )`,
    ).bind(validated.pilotKey, validated.jobId, validated.sourceMessageId, validated.leaseOwner, execution.callbackTokenHash).run();
    const post = await phase5ControlState(env, validated);
    if ((compensation.meta.changes || 0) === 1 && post?.status === "local_claimed" && post.job_status === "queued") {
      return json({
        ok: false,
        error: "Phase 5 start lost the guarded job transition; fence compensation restored local_claimed",
        recovery_status: "compensated_to_local_claimed",
        retryable_start: true,
        fence_status: post.status,
        job_status: post.job_status,
      }, { status: 409 });
    }
    return json({
      ok: false,
      error: "Phase 5 start lost the guarded job transition and compensation postcondition failed",
      recovery_status: "ambiguous_partial_start",
      fence_status: post?.status || "unknown",
      job_status: post?.job_status || "unknown",
    }, { status: 409 });
  }

  const insertedAudit = await phase5EnsureStartAudit(env, execution, execution.tokenExpiresAt, decision.recoveryStatus);
  if (insertedAudit && shouldReactToStage("downloading")) {
    await reactToSourceMessage(env, { id: validated.jobId, source_message_id: validated.sourceMessageId, sender_id: null }, "downloading");
  }
  const post = await phase5ControlState(env, validated);
  if (
    !post
    || post.status !== "local_processing"
    || post.job_status !== "running"
    || post.upload_token_hash !== execution.callbackTokenHash
    || !phase5ExecutionExpiryPostcondition(post, execution.tokenExpiresAt)
    || Number(post.marker_events || 0) <= 0
  ) {
    return json({ ok: false, error: "Phase 5 start postcondition failed" }, { status: 409 });
  }
  return json({ ok: true, started: true, recovery_status: decision.recoveryStatus, repaired_audit: insertedAudit, pilot_key: validated.pilotKey, job_id: validated.jobId, token_expires_at: execution.tokenExpiresAt });
}

async function handlePhase5FinalizeLocalProcessing(request: Request, env: Env): Promise<Response> {
  const input = await readJson<{
    pilot_key?: string;
    job_id?: string;
    source_message_id?: string;
    lease_owner?: string;
    idempotency_key?: string;
    confirm_finalize?: string;
    reason?: string;
  }>(request);
  let validated: ReturnType<typeof validatePhase5FinalizeRequest>;
  try {
    validated = validatePhase5FinalizeRequest({ ...input, confirmation: input.confirm_finalize });
  } catch (error) {
    return json({ ok: false, error: String((error as Error).message || error) }, { status: 400 });
  }
  const existing = await phase5ControlState(env, validated);
  if (!existing) return json({ ok: false, error: "Exact Phase 5 fence/job not found" }, { status: 404 });
  const decision = phase5FinalizeRecoveryDecision(existing, validated);
  if (!decision.ok) {
    return json({
      ok: false,
      error: decision.error,
      recovery_status: decision.recoveryStatus,
      fence_status: existing.status,
      job_status: existing.job_status,
    }, { status: decision.httpStatus });
  }

  if (decision.status === "idempotent_finalized" || decision.status === "repair_finalize_audit") {
    const repairedAudit = decision.repairAudit
      ? await phase5EnsureFinalizeAudit(env, validated, decision.recoveryStatus)
      : false;
    const post = await phase5ControlState(env, validated);
    if (!post || post.status !== "local_complete" || post.job_status !== "complete" || Number(post.marker_events || 0) <= 0) {
      return json({ ok: false, error: "Phase 5 finalize idempotency audit repair postcondition failed", recovery_status: "finalize_audit_repair_failed" }, { status: 409 });
    }
    return json({
      ok: true,
      finalized: true,
      idempotent: true,
      repaired_audit: repairedAudit,
      recovery_status: decision.recoveryStatus,
      pilot_key: validated.pilotKey,
      job_id: validated.jobId,
    });
  }

  const updated = await env.REEL_DB.prepare(
    `UPDATE phase5_local_pilot_fences
     SET status='local_complete',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
     WHERE pilot_key=? AND job_id=? AND source_message_id=? AND status='local_processing' AND local_lease_owner=?
       AND EXISTS (SELECT 1 FROM jobs j WHERE j.id=phase5_local_pilot_fences.job_id AND j.status='complete')`,
  ).bind(validated.pilotKey, validated.jobId, validated.sourceMessageId, validated.leaseOwner).run();
  if ((updated.meta.changes || 0) !== 1) {
    const post = await phase5ControlState(env, validated);
    return json({
      ok: false,
      error: "Phase 5 finalize lost the guarded fence transition",
      recovery_status: "guarded_finalize_lost",
      fence_status: post?.status || existing.status,
      job_status: post?.job_status || existing.job_status,
    }, { status: 409 });
  }
  const insertedAudit = await phase5EnsureFinalizeAudit(env, validated, decision.recoveryStatus);
  const post = await phase5ControlState(env, validated);
  if (!post || post.status !== "local_complete" || post.job_status !== "complete" || Number(post.marker_events || 0) <= 0) {
    return json({ ok: false, error: "Phase 5 finalize postcondition failed" }, { status: 409 });
  }
  return json({ ok: true, finalized: true, recovery_status: decision.recoveryStatus, repaired_audit: insertedAudit, pilot_key: validated.pilotKey, job_id: validated.jobId });
}

async function handlePhase5AbortLocalProcessing(request: Request, env: Env): Promise<Response> {
  const input = await readJson<{
    pilot_key?: string;
    job_id?: string;
    source_message_id?: string;
    lease_owner?: string;
    idempotency_key?: string;
    confirm_abort?: string;
    reason?: string;
  }>(request);
  let validated: ReturnType<typeof validatePhase5AbortRequest>;
  try {
    validated = validatePhase5AbortRequest({ ...input, confirmation: input.confirm_abort });
  } catch (error) {
    return json({ ok: false, error: String((error as Error).message || error) }, { status: 400 });
  }
  const existing = await phase5ControlState(env, validated);
  if (!existing) return json({ ok: false, error: "Exact Phase 5 fence/job not found" }, { status: 404 });
  const decision = phase5AbortRecoveryDecision(existing, validated);
  if (!decision.ok) {
    return json({
      ok: false,
      error: decision.error,
      recovery_status: decision.recoveryStatus,
      fence_status: existing.status,
      lease_owner: existing.local_lease_owner,
      job_status: existing.job_status,
    }, { status: decision.httpStatus });
  }
  if (decision.status === "idempotent_aborted") {
    return json({ ok: true, aborted: true, idempotent: true, queued: false, recovery_status: decision.recoveryStatus, pilot_key: validated.pilotKey, job_id: validated.jobId });
  }

  if (decision.status === "guarded_abort") {
    const jobUpdate = await env.REEL_DB.prepare(
      `UPDATE jobs
       SET status='queued',stage='queued',status_emoji='⬇️',upload_token_hash=NULL,upload_token_expires_at=NULL,error_code=NULL,error_message=NULL,updated_at=CURRENT_TIMESTAMP
       WHERE id=? AND source_message_id=? AND status IN ('queued','running','failed')
         AND completed_at IS NULL AND html_key IS NULL AND library_path IS NULL
         AND EXISTS (
           SELECT 1 FROM phase5_local_pilot_fences f
           WHERE f.job_id=jobs.id
             AND f.pilot_key=?
             AND f.source_message_id=?
             AND f.status IN (${PHASE5_ACTIVE_FENCE_SQL})
             AND f.local_lease_owner=?
         )`,
    ).bind(validated.jobId, validated.sourceMessageId, validated.pilotKey, validated.sourceMessageId, validated.leaseOwner).run();
    if ((jobUpdate.meta.changes || 0) !== 1) {
      return json({ ok: false, error: "Phase 5 abort lost the guarded job rollback" }, { status: 409 });
    }
    const fenceUpdate = await env.REEL_DB.prepare(
      `UPDATE phase5_local_pilot_fences
       SET status='rolled_back',rollback_at=CURRENT_TIMESTAMP,rollback_reason=?,updated_at=CURRENT_TIMESTAMP
       WHERE pilot_key=? AND job_id=? AND source_message_id=? AND status IN (${PHASE5_ACTIVE_FENCE_SQL}) AND local_lease_owner=?
         AND EXISTS (SELECT 1 FROM jobs j WHERE j.id=phase5_local_pilot_fences.job_id AND j.status='queued')
         AND NOT EXISTS (
           SELECT 1 FROM artifacts a
           WHERE a.job_id=phase5_local_pilot_fences.job_id
             AND (a.object_key LIKE 'library/%' OR a.object_key LIKE 'reels/%/index.html')
         )
         AND NOT EXISTS (
           SELECT 1 FROM job_events e
           WHERE e.job_id=phase5_local_pilot_fences.job_id
             AND e.stage IN ('complete','published','phase5_local_complete')
         )`,
    ).bind(validated.reason, validated.pilotKey, validated.jobId, validated.sourceMessageId, validated.leaseOwner).run();
    if ((fenceUpdate.meta.changes || 0) !== 1) {
      return json({ ok: false, error: "Phase 5 abort lost the guarded fence rollback after job rollback; retry exact abort before doing anything else" }, { status: 409 });
    }
  }

  await env.REEL_QUEUE.send({ jobId: validated.jobId });
  await env.REEL_DB.prepare(
    `INSERT INTO job_events(job_id,stage,status,emoji,detail)
     SELECT ?,'phase5_local_abort','queued','↩️',?
     WHERE NOT EXISTS (
       SELECT 1 FROM job_events WHERE job_id=? AND instr(COALESCE(detail,''), ?) > 0
     )`,
  ).bind(validated.jobId, JSON.stringify({
    marker: validated.marker,
    pilot_key: validated.pilotKey,
    source_message_id: validated.sourceMessageId,
    lease_owner: validated.leaseOwner,
    reason: validated.reason,
    requeued_to_cloud: true,
    confirmation: PHASE5_ABORT_CONFIRMATION,
    recovery_status: decision.recoveryStatus,
  }), validated.jobId, validated.marker).run();
  return json({ ok: true, aborted: true, queued: true, recovery_status: decision.recoveryStatus, pilot_key: validated.pilotKey, job_id: validated.jobId });
}

async function handlePhase5PreintakeArm(request: Request, env: Env, mediaType: "reel" | "carousel"): Promise<Response> {
  const input = await readJson<{ arm_key?: string; sender_id?: string; confirm_arm?: string; expires_minutes?: number }>(request);
  let validated: ReturnType<typeof validatePhase5PreintakeArmRequest>;
  try {
    validated = validatePhase5PreintakeArmRequest({ ...input, media_type: mediaType, confirmation: input.confirm_arm });
  } catch (error) {
    return json({ ok: false, error: String((error as Error).message || error) }, { status: 400 });
  }
  const allowed = allowedInstagramSenders(env);
  if (allowed.length && !allowed.includes(validated.senderId)) {
    return json({ ok: false, error: "Phase 5 pre-intake arm sender must be allowlisted" }, { status: 403 });
  }
  const activeFence = await env.REEL_DB.prepare(
    `SELECT pilot_key,job_id,source_message_id,status,expires_at
     FROM phase5_local_pilot_fences
     WHERE status IN (${PHASE5_ACTIVE_FENCE_SQL}) AND datetime(expires_at) > datetime('now')
     LIMIT 1`,
  ).first<Phase5FenceRow>();
  if (activeFence) return json({ ok: false, error: "A Phase 5 job fence is already active", active_fence: activeFence }, { status: 409 });
  const audit = {
    arm_key: validated.armKey,
    sender_id: validated.senderId,
    media_type: validated.mediaType,
    confirmation: input.confirm_arm,
    operator_scope: `capture_next_new_${validated.mediaType}_only`,
  };
  try {
    await env.REEL_DB.prepare(
      `INSERT INTO phase5_preintake_arms(arm_key,sender_id,media_type,status,armed_at,expires_at,audit_json)
       VALUES (?, ?, ?, 'armed', ?, ?, ?)`,
    ).bind(validated.armKey, validated.senderId, validated.mediaType, validated.armedAt, validated.expiresAt, JSON.stringify(audit)).run();
  } catch (error) {
    const existing = await env.REEL_DB.prepare(
      "SELECT arm_key,sender_id,media_type,status,armed_at,expires_at,source_message_id,job_id FROM phase5_preintake_arms WHERE status='armed' LIMIT 1",
    ).first<Phase5PreintakeArmRow>();
    return json({ ok: false, error: "A Phase 5 pre-intake arm is already active", active_arm: existing, detail: String((error as Error).message || error).slice(0, 300) }, { status: 409 });
  }
  return json({
    ok: true,
    armed: true,
    arm_key: validated.armKey,
    sender_id: validated.senderId,
    media_type: validated.mediaType,
    armed_at: validated.armedAt,
    expires_at: validated.expiresAt,
    instruction: `Send exactly one brand-new ${validated.mediaType === "carousel" ? "carousel" : "Reel"} from the allowlisted sender before expiry.`,
  });
}

async function handlePhase5PreintakeCancel(request: Request, env: Env): Promise<Response> {
  const input = await readJson<{ arm_key?: string; confirm_cancel?: string; reason?: string }>(request);
  let validated: ReturnType<typeof validatePhase5PreintakeCancelRequest>;
  try {
    validated = validatePhase5PreintakeCancelRequest({ ...input, confirmation: input.confirm_cancel });
  } catch (error) {
    return json({ ok: false, error: String((error as Error).message || error) }, { status: 400 });
  }
  const result = await env.REEL_DB.prepare(
    `UPDATE phase5_preintake_arms
     SET status='cancelled',rollback_at=CURRENT_TIMESTAMP,rollback_reason=?,updated_at=CURRENT_TIMESTAMP
     WHERE arm_key=? AND status='armed'`,
  ).bind(validated.reason, validated.armKey).run();
  return json({ ok: true, cancelled: (result.meta.changes || 0) === 1, arm_key: validated.armKey });
}

async function capturePhase5PreintakeArmForJob(
  env: Env,
  input: {
    jobId: string;
    senderId?: string | null;
    sourceMessageId?: string | null;
    canonicalUrl: string;
    dedupeKey: string;
  },
): Promise<{ captured: boolean; armKey?: string; expiresAt?: string }> {
  const mediaType = input.canonicalUrl.includes("/reel/") ? "reel" : input.canonicalUrl.includes("/p/") ? "carousel" : null;
  if (!input.senderId || !input.sourceMessageId || !mediaType) return { captured: false };
  const arm = await env.REEL_DB.prepare(
    `SELECT arm_key,sender_id,media_type,status,armed_at,expires_at,source_message_id,job_id
     FROM phase5_preintake_arms
     WHERE status='armed' AND sender_id=? AND media_type=?
     ORDER BY datetime(armed_at) DESC LIMIT 1`,
  ).bind(input.senderId, mediaType).first<Phase5PreintakeArmRow>();
  if (!phase5ArmCanCaptureShare(arm, { senderId: input.senderId, mediaType })) return { captured: false };
  const claim = await env.REEL_DB.prepare(
    `UPDATE phase5_preintake_arms
     SET status='captured',consumed_at=CURRENT_TIMESTAMP,source_message_id=?,job_id=?,event_id=?,updated_at=CURRENT_TIMESTAMP
     WHERE arm_key=? AND status='armed' AND sender_id=? AND media_type=?
       AND datetime(armed_at) <= datetime('now') AND datetime(expires_at) > datetime('now')`,
  ).bind(input.sourceMessageId, input.jobId, input.sourceMessageId, arm!.arm_key, input.senderId, mediaType).run();
  if ((claim.meta.changes || 0) !== 1) return { captured: false };
  const audit = {
    pilot_key: arm!.arm_key,
    job_id: input.jobId,
    source_message_id: input.sourceMessageId,
    preintake_arm: true,
    media_type: mediaType,
    sender_id: input.senderId,
  };
  await env.REEL_DB.batch([
    env.REEL_DB.prepare(
      `INSERT INTO phase5_local_pilot_fences(pilot_key,job_id,source_message_id,dedupe_key,status,expires_at,audit_json)
       VALUES (?, ?, ?, ?, 'armed', ?, ?)`,
    ).bind(arm!.arm_key, input.jobId, input.sourceMessageId, input.dedupeKey, arm!.expires_at, JSON.stringify(audit)),
    env.REEL_DB.prepare(
      "INSERT INTO job_events(job_id,stage,status,emoji,detail) VALUES (?,'phase5_preintake_captured','queued','🧪',?)",
    ).bind(input.jobId, JSON.stringify({ ...audit, expires_at: arm!.expires_at })),
  ]);
  return { captured: true, armKey: arm!.arm_key, expiresAt: arm!.expires_at };
}

async function capturePhase6AuthorityJob(
  env: Env,
  input: {
    jobId: string;
    senderId?: string | null;
    sourceMessageId?: string | null;
    canonicalUrl: string;
    dedupeKey: string;
    createdAt: string;
  },
): Promise<{ captured: boolean; pilotKey?: string; expiresAt?: string }> {
  if (!input.senderId || !input.sourceMessageId) return { captured: false };
  const authority = await phase6Authority(env);
  if (!phase6ShouldFenceNewJob(authority, input.createdAt)) return { captured: false };
  const mediaType = input.canonicalUrl.includes("/reel/") ? "reel" : "carousel";
  const pilotKey = phase6PilotKey(authority.generation, input.jobId);
  const expiresAt = new Date(Date.now() + 6 * 60 * 60_000).toISOString();
  const audit = {
    pilot_key: pilotKey,
    job_id: input.jobId,
    source_message_id: input.sourceMessageId,
    phase6_authority: true,
    generation: authority.generation,
    watermark: authority.cutover_watermark,
    mode_at_capture: authority.mode,
    media_type: mediaType,
  };
  await env.REEL_DB.batch([
    env.REEL_DB.prepare(
      `INSERT OR IGNORE INTO phase5_preintake_arms(
         arm_key,active_slot,sender_id,media_type,status,armed_at,expires_at,consumed_at,source_message_id,job_id,event_id,audit_json
       ) VALUES (?,? ,?,?, 'captured',CURRENT_TIMESTAMP,?,CURRENT_TIMESTAMP,?,?,?,?)`,
    ).bind(pilotKey, pilotKey, input.senderId, mediaType, expiresAt, input.sourceMessageId, input.jobId, input.sourceMessageId, JSON.stringify(audit)),
    env.REEL_DB.prepare(
      `INSERT OR IGNORE INTO phase5_local_pilot_fences(
         pilot_key,job_id,source_message_id,dedupe_key,status,expires_at,audit_json
       ) VALUES (?,?,?,?,'armed',?,?)`,
    ).bind(pilotKey, input.jobId, input.sourceMessageId, input.dedupeKey, expiresAt, JSON.stringify(audit)),
    env.REEL_DB.prepare(
      `INSERT INTO job_events(job_id,stage,status,emoji,detail)
       SELECT ?,'phase6_local_fenced','queued','🔒',?
       WHERE NOT EXISTS (SELECT 1 FROM job_events WHERE job_id=? AND stage='phase6_local_fenced')`,
    ).bind(input.jobId, JSON.stringify({ ...audit, expires_at: expiresAt }), input.jobId),
  ]);
  return { captured: true, pilotKey, expiresAt };
}

async function handlePhase6AuthorityState(env: Env): Promise<Response> {
  const authority = await phase6Authority(env);
  const active = await env.REEL_DB.prepare(
    `SELECT
       SUM(CASE WHEN status='armed' THEN 1 ELSE 0 END) AS armed,
       SUM(CASE WHEN status='local_claimed' THEN 1 ELSE 0 END) AS claimed,
       SUM(CASE WHEN status='local_processing' THEN 1 ELSE 0 END) AS processing
     FROM phase5_local_pilot_fences WHERE pilot_key LIKE ?`,
  ).bind(`phase6:${authority.generation}:%`).first<{ armed: number; claimed: number; processing: number }>();
  return json({
    ok: true,
    authority,
    active: {
      armed: Number(active?.armed || 0),
      claimed: Number(active?.claimed || 0),
      processing: Number(active?.processing || 0),
    },
  });
}

async function handlePhase6AuthorityChange(request: Request, env: Env, target: "transition" | "self_hosted" | "cloud"): Promise<Response> {
  const input = await readJson<{ expected_generation?: number; confirmation?: string; reason?: string }>(request);
  const confirmation = target === "transition"
    ? PHASE6_TRANSITION_CONFIRMATION
    : target === "self_hosted" ? PHASE6_LOCAL_CONFIRMATION : PHASE6_CLOUD_CONFIRMATION;
  let validated: ReturnType<typeof validatePhase6AuthorityRequest>;
  try {
    validated = validatePhase6AuthorityRequest(input, confirmation);
  } catch (error) {
    return json({ ok: false, error: String((error as Error).message || error) }, { status: 400 });
  }
  const current = await phase6Authority(env);
  if (current.generation !== validated.expectedGeneration) {
    return json({ ok: false, error: "Phase 6 authority generation mismatch", authority: current }, { status: 409 });
  }
  if (current.mode === target) return json({ ok: true, idempotent: true, authority: current });

  let generation = current.generation;
  let watermark = current.cutover_watermark;
  if (target === "transition") {
    if (current.mode === "cloud") {
      const unsettled = await env.REEL_DB.prepare("SELECT COUNT(*) AS count FROM jobs WHERE status IN ('queued','running')")
        .first<{ count: number }>();
      const activePilot = await env.REEL_DB.prepare(
        `SELECT COUNT(*) AS count FROM phase5_local_pilot_fences
         WHERE status IN (${PHASE5_ACTIVE_FENCE_SQL}) AND datetime(expires_at)>datetime('now')`,
      ).first<{ count: number }>();
      if (Number(unsettled?.count || 0) !== 0 || Number(activePilot?.count || 0) !== 0) {
        return json({ ok: false, error: "Cloud jobs and active pilot fences must settle before Phase 6 transition", unsettled_jobs: unsettled?.count || 0, active_fences: activePilot?.count || 0 }, { status: 409 });
      }
      generation += 1;
      watermark = new Date().toISOString();
    } else if (current.mode !== "self_hosted") {
      return json({ ok: false, error: "Unsupported Phase 6 transition source", authority: current }, { status: 409 });
    }
  } else if (target === "self_hosted") {
    if (current.mode !== "transition" || !watermark) {
      return json({ ok: false, error: "Phase 6 local authority requires a transition watermark", authority: current }, { status: 409 });
    }
  } else if (current.mode !== "transition") {
    return json({ ok: false, error: "Phase 6 cloud rollback requires transition mode first", authority: current }, { status: 409 });
  }

  const generationPrefix = `phase6:${generation}:%`;
  let rollbackJobs: Array<{ job_id: string }> = [];
  if (target === "cloud") {
    const processing = await env.REEL_DB.prepare(
      "SELECT COUNT(*) AS count FROM phase5_local_pilot_fences WHERE pilot_key LIKE ? AND status='local_processing'",
    ).bind(generationPrefix).first<{ count: number }>();
    if (Number(processing?.count || 0) !== 0) {
      return json({ ok: false, error: "Active local processing must finish before cloud rollback", active_processing: processing?.count || 0 }, { status: 409 });
    }
    rollbackJobs = (await env.REEL_DB.prepare(
      `SELECT f.job_id FROM phase5_local_pilot_fences f JOIN jobs j ON j.id=f.job_id
       WHERE f.pilot_key LIKE ? AND f.status IN ('armed','local_claimed') AND j.status='queued'`,
    ).bind(generationPrefix).all<{ job_id: string }>()).results;
  }

  const flags = target === "self_hosted" ? [1, 1, 1] : [0, 0, 0];
  const audit = JSON.stringify({ reason: validated.reason, confirmation, previous: current, watermark });
  const statements = [
    env.REEL_DB.prepare(
      `UPDATE processing_authority SET mode=?,generation=?,dispatch_enabled=?,codex_enabled=?,outbound_enabled=?,backlog_enabled=0,
       cutover_watermark=?,lease_owner=?,updated_at=CURRENT_TIMESTAMP,audit_json=?
       WHERE authority_key='instagram-reel-brain' AND mode=? AND generation=?`,
    ).bind(target, generation, flags[0], flags[1], flags[2], watermark, target === "self_hosted" ? "phase6-local-worker-1" : null, audit, current.mode, current.generation),
    env.REEL_DB.prepare(
      "INSERT INTO processing_authority_events(authority_key,generation,from_mode,to_mode,watermark,detail) VALUES ('instagram-reel-brain',?,?,?,?,?)",
    ).bind(generation, current.mode, target, watermark, audit),
  ];
  if (target === "cloud") {
    statements.push(
      env.REEL_DB.prepare(
        `UPDATE phase5_local_pilot_fences SET status='rolled_back',rollback_at=CURRENT_TIMESTAMP,
         rollback_reason='phase6_authority_rollback',updated_at=CURRENT_TIMESTAMP
         WHERE pilot_key LIKE ? AND status IN ('armed','local_claimed')`,
      ).bind(generationPrefix),
      env.REEL_DB.prepare(
        `UPDATE phase5_preintake_arms SET status='rolled_back',rollback_at=CURRENT_TIMESTAMP,
         rollback_reason='phase6_authority_rollback',updated_at=CURRENT_TIMESTAMP
         WHERE arm_key LIKE ? AND status='captured'`,
      ).bind(generationPrefix),
    );
  }
  const results = await env.REEL_DB.batch(statements);
  if ((results[0].meta.changes || 0) !== 1) {
    return json({ ok: false, error: "Phase 6 authority update lost its guarded transition" }, { status: 409 });
  }
  if (target === "cloud") {
    for (const row of rollbackJobs) await env.REEL_QUEUE.send({ jobId: row.job_id });
  }
  return json({ ok: true, authority: await phase6Authority(env), requeued_jobs: target === "cloud" ? rollbackJobs.length : 0 });
}

async function phase6NextCandidate(env: Env, owner: string): Promise<Record<string, unknown> | null> {
  const authority = await phase6Authority(env);
  if (!phase6AuthorityAllowsLocalClaims(authority)) return null;
  return env.REEL_DB.prepare(
    `SELECT f.pilot_key,f.job_id,f.source_message_id,f.status AS fence_status,f.expires_at,
            f.local_lease_owner,f.local_lease_expires_at,j.source_url,j.created_at,j.attempts,
            j.status AS job_status,j.stage AS job_stage
     FROM phase5_local_pilot_fences f JOIN jobs j ON j.id=f.job_id
     WHERE f.pilot_key LIKE ? AND datetime(f.expires_at)>datetime('now')
       AND j.pilot_run_id IS NULL AND datetime(j.created_at)>=datetime(?)
       AND ((f.status IN ('local_claimed','local_processing') AND f.local_lease_owner=?) OR f.status='armed')
       AND j.status IN ('queued','running')
     ORDER BY CASE f.status WHEN 'local_processing' THEN 0 WHEN 'local_claimed' THEN 1 ELSE 2 END, datetime(j.created_at),f.job_id
     LIMIT 1`,
  ).bind(`phase6:${authority.generation}:%`, authority.cutover_watermark, owner).first<Record<string, unknown>>();
}

async function handlePhase6Next(request: Request, env: Env): Promise<Response> {
  const owner = String(new URL(request.url).searchParams.get("lease_owner") || "phase6-local-worker-1").trim();
  if (!phase6LeaseOwnerAllowed(owner)) return json({ ok: false, error: "lease_owner is not an allowed Phase 6 worker slot" }, { status: 400 });
  const authority = await phase6Authority(env);
  if (!phase6AuthorityAllowsLocalClaims(authority)) return json({ ok: true, candidate: null, authority });
  return json({ ok: true, candidate: await phase6NextCandidate(env, owner), authority });
}

async function handlePhase6PrefetchNext(request: Request, env: Env): Promise<Response> {
  const owner = String(new URL(request.url).searchParams.get("lease_owner") || "phase6-local-worker-1").trim();
  if (!phase6LeaseOwnerAllowed(owner)) return json({ ok: false, error: "lease_owner is not an allowed Phase 6 worker slot" }, { status: 400 });
  const authority = await phase6Authority(env);
  if (!phase6AuthorityAllowsLocalClaims(authority)) return json({ ok: true, active: null, candidate: null, authority });
  const active = await env.REEL_DB.prepare(
    `SELECT f.pilot_key,f.job_id,f.source_message_id,f.status AS fence_status,
            j.status AS job_status,j.stage AS job_stage,j.started_at
     FROM phase5_local_pilot_fences f JOIN jobs j ON j.id=f.job_id
     WHERE f.pilot_key LIKE ? AND f.status='local_processing' AND f.local_lease_owner=?
       AND datetime(f.expires_at)>datetime('now') AND j.status='running'
     ORDER BY datetime(j.started_at),f.job_id LIMIT 1`,
  ).bind(`phase6:${authority.generation}:%`, owner).first<Record<string, unknown>>();
  if (!active || active.job_stage !== "synthesizing") {
    return json({ ok: true, active: active || null, candidate: null, authority });
  }
  const candidate = await env.REEL_DB.prepare(
    `SELECT f.pilot_key,f.job_id,f.source_message_id,f.expires_at,
            j.source_url,j.created_at,j.status AS job_status,j.stage AS job_stage
     FROM phase5_local_pilot_fences f JOIN jobs j ON j.id=f.job_id
     WHERE f.pilot_key LIKE ? AND f.status='armed' AND datetime(f.expires_at)>datetime('now')
       AND j.pilot_run_id IS NULL AND datetime(j.created_at)>=datetime(?)
       AND j.status='queued' AND j.stage='queued' AND j.source_url LIKE '%/reel/%'
     ORDER BY datetime(j.created_at),f.job_id LIMIT 1`,
  ).bind(`phase6:${authority.generation}:%`, authority.cutover_watermark).first<Record<string, unknown>>();
  return json({ ok: true, active, candidate: candidate || null, authority });
}

async function handlePhase6Claim(request: Request, env: Env, release = false): Promise<Response> {
  const input = await readJson<Record<string, unknown>>(request);
  let validated: ReturnType<typeof validatePhase6ClaimRequest>;
  try {
    validated = validatePhase6ClaimRequest(input, release ? PHASE6_RELEASE_CONFIRMATION : PHASE6_CLAIM_CONFIRMATION);
  } catch (error) {
    return json({ ok: false, error: String((error as Error).message || error) }, { status: 400 });
  }
  const authority = await phase6Authority(env);
  if (!phase6AuthorityAllowsLocalClaims(authority) || authority.generation !== validated.expectedGeneration) {
    return json({ ok: false, error: "Phase 6 local authority is not active for this generation", authority }, { status: 409 });
  }
  if (validated.pilotKey !== phase6PilotKey(authority.generation, validated.jobId)) {
    return json({ ok: false, error: "Phase 6 pilot key does not match generation and job" }, { status: 409 });
  }
  if (!phase6LeaseOwnerAllowed(validated.leaseOwner)) {
    return json({ ok: false, error: "Phase 6 lease owner is outside the configured worker slots" }, { status: 409 });
  }
  if (release) {
    const result = await env.REEL_DB.prepare(
      `UPDATE phase5_local_pilot_fences SET status='armed',local_lease_owner=NULL,local_lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP
       WHERE pilot_key=? AND job_id=? AND source_message_id=? AND status='local_claimed' AND local_lease_owner=?
         AND EXISTS(SELECT 1 FROM jobs j WHERE j.id=phase5_local_pilot_fences.job_id AND j.status='queued' AND j.completed_at IS NULL AND j.html_key IS NULL)`,
    ).bind(validated.pilotKey, validated.jobId, validated.sourceMessageId, validated.leaseOwner).run();
    return json({ ok: true, released: (result.meta.changes || 0) === 1, pilot_key: validated.pilotKey, job_id: validated.jobId });
  }
  const requestedExpiry = new Date(Date.now() + validated.leaseMinutes * 60_000).toISOString();
  const result = await env.REEL_DB.prepare(
    `UPDATE phase5_local_pilot_fences SET status='local_claimed',local_lease_owner=?,
       local_lease_expires_at=CASE WHEN datetime(expires_at)<datetime(?) THEN expires_at ELSE ? END,updated_at=CURRENT_TIMESTAMP
     WHERE pilot_key=? AND job_id=? AND source_message_id=? AND status IN ('armed','local_claimed')
       AND datetime(expires_at)>datetime('now')
       AND (
         (status='local_claimed' AND local_lease_owner=?)
         OR (status='armed' AND local_lease_owner IS NULL AND (
           SELECT COUNT(*) FROM phase5_local_pilot_fences other
           WHERE other.pilot_key<>phase5_local_pilot_fences.pilot_key
             AND other.status IN ('local_claimed','local_processing')
         )<?)
       )
       AND EXISTS(SELECT 1 FROM jobs j WHERE j.id=phase5_local_pilot_fences.job_id AND j.status='queued' AND j.pilot_run_id IS NULL)`,
  ).bind(validated.leaseOwner, requestedExpiry, requestedExpiry, validated.pilotKey, validated.jobId,
    validated.sourceMessageId, validated.leaseOwner, PHASE6_LOCAL_CONCURRENCY).run();
  const post = await env.REEL_DB.prepare(
    `SELECT pilot_key,job_id,source_message_id,status,expires_at,local_lease_owner,local_lease_expires_at
     FROM phase5_local_pilot_fences WHERE pilot_key=? AND job_id=?`,
  ).bind(validated.pilotKey, validated.jobId).first<Record<string, unknown>>();
  if ((result.meta.changes || 0) !== 1 && !(post?.status === "local_claimed" && post.local_lease_owner === validated.leaseOwner)) {
    return json({ ok: false, error: "Phase 6 exact claim failed closed", fence: post }, { status: 409 });
  }
  await env.REEL_DB.prepare(
    `INSERT INTO job_events(job_id,stage,status,emoji,detail)
     SELECT ?,'phase6_local_claimed','queued','🔒',?
     WHERE NOT EXISTS(SELECT 1 FROM job_events WHERE job_id=? AND stage='phase6_local_claimed')`,
  ).bind(validated.jobId, JSON.stringify({ pilot_key: validated.pilotKey, lease_owner: validated.leaseOwner, generation: authority.generation }), validated.jobId).run();
  return json({ ok: true, claimed: true, idempotent: (result.meta.changes || 0) === 0, fence: post, authority });
}

async function handlePhase6Retry(request: Request, env: Env): Promise<Response> {
  const input = await readJson<Record<string, unknown>>(request);
  let validated: ReturnType<typeof validatePhase6ClaimRequest>;
  try {
    validated = validatePhase6ClaimRequest(input, PHASE6_RETRY_CONFIRMATION);
  } catch (error) {
    return json({ ok: false, error: String((error as Error).message || error) }, { status: 400 });
  }
  const authority = await phase6Authority(env);
  if (!phase6AuthorityAllowsLocalClaims(authority) || authority.generation !== validated.expectedGeneration) {
    return json({ ok: false, error: "Phase 6 local authority is not active for this generation", authority }, { status: 409 });
  }
  if (validated.pilotKey !== phase6PilotKey(authority.generation, validated.jobId)) {
    return json({ ok: false, error: "Phase 6 retry identity does not match generation and job" }, { status: 409 });
  }
  const existing = await env.REEL_DB.prepare(
    `SELECT f.status AS fence_status,f.rollback_reason,f.source_message_id,f.local_lease_owner,
            j.status AS job_status,j.stage AS job_stage,j.attempts,j.created_at,j.completed_at,j.html_key,j.library_path
     FROM phase5_local_pilot_fences f JOIN jobs j ON j.id=f.job_id
     WHERE f.pilot_key=? AND f.job_id=? AND f.source_message_id=?`,
  ).bind(validated.pilotKey, validated.jobId, validated.sourceMessageId).first<Record<string, unknown>>();
  if (existing?.fence_status === "armed" && existing.job_status === "queued") {
    return json({ ok: true, retry_armed: true, idempotent: true, job_id: validated.jobId, pilot_key: validated.pilotKey });
  }
  const createdTime = Date.parse(String(existing?.created_at || ""));
  const watermarkTime = Date.parse(String(authority.cutover_watermark || ""));
  if (
    !existing
    || existing.fence_status !== "rolled_back"
    || !["queued", "failed"].includes(String(existing.job_status || ""))
    || Number(existing.attempts || 0) >= 3
    || existing.completed_at || existing.html_key || existing.library_path
    || !Number.isFinite(createdTime) || !Number.isFinite(watermarkTime) || createdTime < watermarkTime
  ) {
    return json({ ok: false, error: "Phase 6 exact retry is not eligible", state: existing || null }, { status: 409 });
  }
  const expiresAt = new Date(Date.now() + 6 * 60 * 60_000).toISOString();
  const queuedEmoji = await getEmoji(env, "queued");
  const marker = `phase6-retry:${authority.generation}:${validated.jobId}:${Number(existing.attempts || 0) + 1}`;
  const detail = JSON.stringify({ marker, reason: validated.reason, lease_owner: validated.leaseOwner, previous: existing });
  const results = await env.REEL_DB.batch([
    env.REEL_DB.prepare(
      `UPDATE phase5_local_pilot_fences
       SET status='armed',expires_at=?,local_lease_owner=NULL,local_lease_expires_at=NULL,
           rollback_at=NULL,rollback_reason=NULL,updated_at=CURRENT_TIMESTAMP
       WHERE pilot_key=? AND job_id=? AND source_message_id=? AND status='rolled_back'
         AND EXISTS(SELECT 1 FROM jobs j WHERE j.id=phase5_local_pilot_fences.job_id
           AND j.status IN ('queued','failed') AND j.completed_at IS NULL
           AND j.html_key IS NULL AND j.library_path IS NULL AND j.attempts<3)`,
    ).bind(expiresAt, validated.pilotKey, validated.jobId, validated.sourceMessageId),
    env.REEL_DB.prepare(
      `UPDATE jobs SET status='queued',stage='queued',status_emoji=?,error_code=NULL,error_message=NULL,
       upload_token_hash=NULL,upload_token_expires_at=NULL,started_at=NULL,completed_at=NULL,processing_seconds=NULL,updated_at=CURRENT_TIMESTAMP
       WHERE id=? AND status IN ('queued','failed') AND completed_at IS NULL AND html_key IS NULL AND library_path IS NULL AND attempts<3
         AND EXISTS(SELECT 1 FROM phase5_local_pilot_fences f WHERE f.job_id=jobs.id
           AND f.pilot_key=? AND f.source_message_id=? AND f.status='armed')`,
    ).bind(queuedEmoji.display, validated.jobId, validated.pilotKey, validated.sourceMessageId),
    env.REEL_DB.prepare(
      `INSERT INTO job_events(job_id,stage,status,emoji,detail)
       SELECT ?,'phase6_retry_armed','queued',?,?
       WHERE EXISTS(SELECT 1 FROM jobs j JOIN phase5_local_pilot_fences f ON f.job_id=j.id
         WHERE j.id=? AND j.status='queued' AND f.pilot_key=? AND f.status='armed')
         AND NOT EXISTS(SELECT 1 FROM job_events WHERE job_id=? AND instr(COALESCE(detail,''),?)>0)`,
    ).bind(validated.jobId, queuedEmoji.display, detail, validated.jobId, validated.pilotKey, validated.jobId, marker),
  ]);
  if ((results[0].meta.changes || 0) !== 1 || (results[1].meta.changes || 0) !== 1 || (results[2].meta.changes || 0) !== 1) {
    return json({ ok: false, error: "Phase 6 exact retry lost its guarded transition" }, { status: 409 });
  }
  const job = await env.REEL_DB.prepare("SELECT id,source_message_id,sender_id FROM jobs WHERE id=?")
    .bind(validated.jobId).first<JobRow>();
  if (job) await reactToSourceMessage(env, job, "queued");
  return json({ ok: true, retry_armed: true, idempotent: false, job_id: validated.jobId, pilot_key: validated.pilotKey, expires_at: expiresAt });
}

async function handlePhase6TerminalFailure(request: Request, env: Env): Promise<Response> {
  const input = await readJson<Record<string, unknown>>(request);
  let validated: ReturnType<typeof validatePhase6FailureRequest>;
  try {
    validated = validatePhase6FailureRequest(input);
  } catch (error) {
    return json({ ok: false, error: String((error as Error).message || error) }, { status: 400 });
  }
  const authority = await phase6Authority(env);
  if (!phase6AuthorityAllowsLocalClaims(authority) || authority.generation !== validated.expectedGeneration) {
    return json({ ok: false, error: "Phase 6 local authority is not active for this generation", authority }, { status: 409 });
  }
  if (validated.pilotKey !== phase6PilotKey(authority.generation, validated.jobId)) {
    return json({ ok: false, error: "Phase 6 failure identity does not match generation and job" }, { status: 409 });
  }
  const job = await env.REEL_DB.prepare("SELECT * FROM jobs WHERE id=?").bind(validated.jobId).first<JobRow>();
  const fence = await env.REEL_DB.prepare(
    `SELECT pilot_key,job_id,source_message_id,status,local_lease_owner,rollback_reason
     FROM phase5_local_pilot_fences WHERE pilot_key=? AND job_id=? AND source_message_id=?`,
  ).bind(validated.pilotKey, validated.jobId, validated.sourceMessageId).first<Record<string, unknown>>();
  if (job?.status === "failed" && job.error_code === validated.errorCode && fence?.status === "rolled_back") {
    return json({ ok: true, failed: true, idempotent: true, job_id: validated.jobId, stage: validated.errorCode });
  }
  if (
    !job || !fence || fence.status !== "rolled_back"
    || fence.local_lease_owner !== validated.leaseOwner
    || job.status !== "queued" || job.completed_at || job.html_key || job.library_path
  ) {
    return json({ ok: false, error: "Phase 6 terminal failure is not eligible", job_status: job?.status || null, fence: fence || null }, { status: 409 });
  }
  const emoji = await getEmoji(env, validated.errorCode);
  const marker = `phase6-terminal-failure:${authority.generation}:${validated.jobId}:${validated.errorCode}`;
  const detail = JSON.stringify({ marker, reason: validated.reason, error: validated.errorMessage });
  const results = await env.REEL_DB.batch([
    env.REEL_DB.prepare(
      `UPDATE jobs SET status='failed',stage=?,status_emoji=?,error_code=?,error_message=?,
       upload_token_hash=NULL,upload_token_expires_at=NULL,updated_at=CURRENT_TIMESTAMP
       WHERE id=? AND status='queued' AND completed_at IS NULL AND html_key IS NULL AND library_path IS NULL
         AND EXISTS(SELECT 1 FROM phase5_local_pilot_fences f WHERE f.job_id=jobs.id
           AND f.pilot_key=? AND f.source_message_id=? AND f.status='rolled_back' AND f.local_lease_owner=?)`,
    ).bind(validated.errorCode, emoji.display, validated.errorCode, validated.errorMessage, validated.jobId,
      validated.pilotKey, validated.sourceMessageId, validated.leaseOwner),
    env.REEL_DB.prepare(
      `UPDATE phase5_local_pilot_fences SET rollback_reason=?,updated_at=CURRENT_TIMESTAMP
       WHERE pilot_key=? AND job_id=? AND source_message_id=? AND status='rolled_back' AND local_lease_owner=?
         AND EXISTS(SELECT 1 FROM jobs j WHERE j.id=phase5_local_pilot_fences.job_id
           AND j.status='failed' AND j.error_code=?)`,
    ).bind(`phase6_terminal_failure:${validated.errorCode}`, validated.pilotKey, validated.jobId,
      validated.sourceMessageId, validated.leaseOwner, validated.errorCode),
    env.REEL_DB.prepare(
      `INSERT INTO job_events(job_id,stage,status,emoji,detail)
       SELECT ?,?,'failed',?,?
       WHERE EXISTS(SELECT 1 FROM jobs j JOIN phase5_local_pilot_fences f ON f.job_id=j.id
         WHERE j.id=? AND j.status='failed' AND j.error_code=? AND f.pilot_key=? AND f.rollback_reason=?)
         AND NOT EXISTS(SELECT 1 FROM job_events WHERE job_id=? AND instr(COALESCE(detail,''),?)>0)`,
    ).bind(validated.jobId, validated.errorCode, emoji.display, detail,
      validated.jobId, validated.errorCode, validated.pilotKey, `phase6_terminal_failure:${validated.errorCode}`,
      validated.jobId, marker),
  ]);
  if ((results[0].meta.changes || 0) !== 1 || (results[1].meta.changes || 0) !== 1 || (results[2].meta.changes || 0) !== 1) {
    return json({ ok: false, error: "Phase 6 terminal failure lost its guarded transition" }, { status: 409 });
  }
  await reactToSourceMessage(env, job, validated.errorCode);
  return json({ ok: true, failed: true, idempotent: false, job_id: validated.jobId, stage: validated.errorCode });
}

async function handlePilotSummaryDm(request: Request, env: Env): Promise<Response> {
  const input = await readJson<{ pilot_key?: string; confirm_send?: string }>(request);
  const pilotKey = String(input.pilot_key || "").trim();
  if (!pilotKey) return json({ error: "pilot_key is required" }, { status: 400 });
  if (input.confirm_send !== "SEND_PILOT_SUMMARY") {
    return json({ error: "confirm_send must equal SEND_PILOT_SUMMARY" }, { status: 400 });
  }
  const run = await env.REEL_DB.prepare("SELECT id,target_count FROM pilot_runs WHERE pilot_key=?")
    .bind(pilotKey).first<{ id: string; target_count: number }>();
  if (!run) return json({ error: "Pilot run not found" }, { status: 404 });
  const summary = await pilotRunSummary(env, run.id);
  if (Number(summary.complete_count || 0) !== Number(run.target_count) || Number(summary.failed_count || 0) !== 0) {
    return json({ error: "Pilot must complete successfully before its summary is sent", pilot: summary }, { status: 409 });
  }
  const previous = await env.REEL_DB.prepare(
    "SELECT id FROM outbound_events WHERE kind='pilot_summary' AND source_message_id=? AND status='sent' LIMIT 1",
  ).bind(run.id).first<{ id: string }>();
  if (previous) return json({ ok: true, sent: false, idempotent: true, pilot: summary });
  const aggregate = await env.REEL_DB.prepare(
    `SELECT COUNT(*) AS completed_jobs,
            COUNT(processing_seconds) AS timed_jobs,
            AVG(processing_seconds) AS average_seconds,
            COUNT(codex_total_tokens) AS measured_token_jobs,
            AVG(codex_total_tokens) AS average_tokens
     FROM jobs WHERE pilot_run_id=? AND status='complete'`,
  ).bind(run.id).first<{
    completed_jobs: number;
    timed_jobs: number;
    average_seconds: number | null;
    measured_token_jobs: number;
    average_tokens: number | null;
  }>();
  if (Number(aggregate?.timed_jobs || 0) !== Number(run.target_count) || Number(aggregate?.measured_token_jobs || 0) !== Number(run.target_count)) {
    return json({ error: "Pilot timing or token measurements are incomplete", pilot: summary, aggregate }, { status: 409 });
  }
  const senderId = allowedInstagramSenders(env)[0];
  if (!senderId) return json({ error: "No allowlisted Instagram recipient is configured" }, { status: 503 });
  const averageSeconds = Math.round(Number(aggregate?.average_seconds || 0));
  const averageTokens = Math.round(Number(aggregate?.average_tokens || 0));
  const message = `10-Reel test complete. Average queue-to-synthesis time: ${formatProcessingDuration(averageSeconds)}. Average Codex token cost: ${averageTokens.toLocaleString("en-AU")} per Reel. 10/10 completed with 0 failures.`;
  const sent = await sendInstagramText(env, senderId, message, run.id, "pilot_summary");
  return json({ ok: sent, sent, pilot: summary, aggregate: { ...aggregate, average_seconds: averageSeconds, average_tokens: averageTokens } }, { status: sent ? 200 : 502 });
}

async function sendInstagramVideo(env: Env, senderId: string, jobId: string, sourceMessageId?: string | null): Promise<boolean> {
  if (!env.INSTAGRAM_ACCESS_TOKEN || !env.INSTAGRAM_USER_ID || !env.DOWNLOAD_SIGNING_KEY || !env.PUBLIC_BASE_URL) {
    await recordOutboundEvent(env, { recipientId: senderId, sourceMessageId, jobId, kind: "video", status: "not_configured", error: "Instagram or signed-download configuration is unavailable" });
    return false;
  }
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const signature = await hmacHex(env.DOWNLOAD_SIGNING_KEY, `${jobId}:${expires}`);
  const mediaUrl = `${env.PUBLIC_BASE_URL}/download/jobs/${jobId}/video?expires=${expires}&sig=${signature}`;
  const version = env.INSTAGRAM_GRAPH_VERSION || "v24.0";
  const response = await fetch(`https://graph.instagram.com/${version}/${env.INSTAGRAM_USER_ID}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.INSTAGRAM_ACCESS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      recipient: { id: senderId },
      message: { attachment: { type: "video", payload: { url: mediaUrl, is_reusable: true } } },
    }),
  });
  const error = response.ok ? "" : (await response.text()).slice(0, 500);
  if (!response.ok) console.error("Instagram video reply failed", response.status, error.slice(0, 300));
  await recordOutboundEvent(env, { recipientId: senderId, sourceMessageId, jobId, kind: "video", status: response.ok ? "sent" : "failed", httpStatus: response.status, error });
  return response.ok;
}

async function sendInstagramArchivedVideoWithContext(
  env: Env,
  senderId: string,
  match: { id: string; author_username?: string | null; description?: string | null },
  sourceMessageId?: string | null,
): Promise<boolean> {
  const username = String(match.author_username || "unknown").trim().replace(/^@+/, "") || "unknown";
  const usernameSent = await sendInstagramText(env, senderId, `@${username}`, sourceMessageId, "video_context_username");
  if (!usernameSent) return false;
  const description = String(match.description || "No creator description was captured.").trim();
  const descriptionSent = await sendInstagramText(env, senderId, description, sourceMessageId, "video_context_description");
  if (!descriptionSent) return false;
  return sendInstagramVideo(env, senderId, match.id, sourceMessageId);
}

async function setStage(
  env: Env,
  job: Pick<JobRow, "id" | "source_message_id" | "sender_id">,
  stage: string,
  status: string,
  detail?: string,
): Promise<void> {
  const emoji = await getEmoji(env, stage);
  await env.REEL_DB.batch([
    env.REEL_DB.prepare(
      "UPDATE jobs SET stage = ?, status = ?, status_emoji = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(stage, status, emoji.display, job.id),
    env.REEL_DB.prepare(
      "INSERT INTO job_events(job_id, stage, status, emoji, detail) VALUES (?, ?, ?, ?, ?)",
    ).bind(job.id, stage, status, emoji.display, detail || null),
  ]);
  if (shouldReactToStage(stage)) await reactToSourceMessage(env, job, stage);
}

async function validateCallback(request: Request, env: Env, jobId: string): Promise<JobRow | null> {
  const token = bearer(request);
  if (!token) return null;
  const job = await env.REEL_DB.prepare("SELECT * FROM jobs WHERE id = ?")
    .bind(jobId)
    .first<JobRow>();
  if (!job || !job.upload_token_hash || !job.upload_token_expires_at) return null;
  if (Date.parse(job.upload_token_expires_at) < Date.now()) return null;
  if ((await sha256(token)) !== job.upload_token_hash) return null;
  const phase5Fence = await env.REEL_DB.prepare(
    `SELECT status,local_lease_owner,local_lease_expires_at
     FROM phase5_local_pilot_fences
     WHERE job_id=?
     ORDER BY updated_at DESC
     LIMIT 1`,
  ).bind(jobId).first<{ status: string; local_lease_owner: string | null; local_lease_expires_at: string | null }>();
  if (phase5Fence) {
    if (
      phase5Fence.status !== "local_processing"
      || !phase5Fence.local_lease_expires_at
      || Date.parse(phase5Fence.local_lease_expires_at) < Date.now()
      || !phase5Fence.local_lease_owner
    ) {
      return null;
    }
  }
  return job;
}

async function createJob(
  env: Env,
  input: {
    sourceUrl: string;
    instructions?: string | null;
    senderId?: string | null;
    sourceMessageId?: string | null;
    pilotRunId?: string | null;
    sourceMediaJson?: string | null;
    queueDelayMode?: string;
  },
): Promise<{ id: string; canonicalUrl: string; shortcode: string; duplicate: boolean; phase5_preintake_captured?: boolean; phase5_arm_key?: string; phase6_authority_captured?: boolean; phase6_pilot_key?: string }> {
  const canonical = canonicalizeInstagramUrl(input.sourceUrl);
  if (!canonical) throw new Error("A supported Instagram Reel or post URL is required");
  const dedupeKey = instagramDedupeKey(canonical.url);
  if (!dedupeKey) throw new Error("A canonical Instagram deduplication key could not be created");
  const findExisting = () => env.REEL_DB.prepare(
    `SELECT id,status,stage FROM jobs
     WHERE dedupe_key = ? OR shortcode = ? OR canonical_url = ? OR (? IS NOT NULL AND source_message_id = ?)
     ORDER BY CASE status WHEN 'complete' THEN 0 WHEN 'running' THEN 1 WHEN 'queued' THEN 2 ELSE 3 END, created_at DESC
     LIMIT 1`,
  ).bind(dedupeKey, canonical.shortcode, canonical.url, input.sourceMessageId || null, input.sourceMessageId || null).first<{ id: string; status: string; stage: string }>();
  const existing = await findExisting();
  if (existing) {
    if (input.sourceMediaJson) {
      await env.REEL_DB.prepare("UPDATE jobs SET source_media_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(input.sourceMediaJson, existing.id).run();
    }
    const reactionStage = existing.status === "complete" ? "complete" : shouldReactToStage(existing.stage) ? existing.stage : null;
    if (reactionStage && input.sourceMessageId && input.senderId) {
      await reactToSourceMessage(env, { id: existing.id, source_message_id: input.sourceMessageId, sender_id: input.senderId }, reactionStage);
    }
    return { id: existing.id, canonicalUrl: canonical.url, shortcode: canonical.shortcode, duplicate: true };
  }
  const id = uuid();
  const emoji = await getEmoji(env, "queued");
  const inserted = await env.REEL_DB.prepare(
    "INSERT OR IGNORE INTO jobs(id, source_url, canonical_url, shortcode, dedupe_key, pilot_run_id, sender_id, source_message_id, source_media_json, instructions, status, stage, status_emoji) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 'queued', ?)",
  ).bind(
    id,
    input.sourceUrl,
    canonical.url,
    canonical.shortcode,
    dedupeKey,
    input.pilotRunId || null,
    input.senderId || null,
    input.sourceMessageId || null,
    input.sourceMediaJson || null,
    input.instructions || null,
    emoji.display,
  ).run();
  if ((inserted.meta.changes || 0) === 0) {
    const raced = await findExisting();
    if (!raced) throw new Error("Duplicate Reel was rejected but the existing job could not be resolved");
    return { id: raced.id, canonicalUrl: canonical.url, shortcode: canonical.shortcode, duplicate: true };
  }
  await env.REEL_DB.prepare(
    "INSERT INTO job_events(job_id, stage, status, emoji, detail) VALUES (?, 'queued', 'queued', ?, 'Accepted after pre-Codex canonical Reel deduplication')",
  ).bind(id, emoji.display).run();
  const phase5Capture = await capturePhase5PreintakeArmForJob(env, {
    jobId: id,
    senderId: input.senderId || null,
    sourceMessageId: input.sourceMessageId || null,
    canonicalUrl: canonical.url,
    dedupeKey,
  });
  const insertedJob = await env.REEL_DB.prepare("SELECT created_at FROM jobs WHERE id=?")
    .bind(id).first<{ created_at: string }>();
  const phase6Capture = phase5Capture.captured ? { captured: false } : await capturePhase6AuthorityJob(env, {
    jobId: id,
    senderId: input.senderId || null,
    sourceMessageId: input.sourceMessageId || null,
    canonicalUrl: canonical.url,
    dedupeKey,
    createdAt: insertedJob?.created_at || new Date().toISOString(),
  });
  if (shouldReactToStage("queued")) {
    await reactToSourceMessage(env, { id, source_message_id: input.sourceMessageId || null, sender_id: input.senderId || null }, "queued");
  }
  try {
    await sendQueueMessageWithAdjacentInstructionDelay(env.REEL_QUEUE, { jobId: id }, input.queueDelayMode || "");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await setStage(env, { id, source_message_id: input.sourceMessageId || null, sender_id: input.senderId || null }, "error_queue", "failed", detail);
    throw error;
  }
  return {
    id,
    canonicalUrl: canonical.url,
    shortcode: canonical.shortcode,
    duplicate: false,
    phase5_preintake_captured: phase5Capture.captured || undefined,
    phase5_arm_key: phase5Capture.armKey,
    phase6_authority_captured: phase6Capture.captured || undefined,
    phase6_pilot_key: phase6Capture.pilotKey,
  };
}

async function handleTestCreate(request: Request, env: Env): Promise<Response> {
  const unauthorized = requireAdmin(request, env);
  if (unauthorized) return unauthorized;
  if ((env.INGEST_MODE || "disabled") === "disabled") return json({ error: "Ingest is disabled" }, { status: 409 });
  const input = await readJson<{
    source_url?: string;
    instructions?: string;
    confirm_test?: boolean;
    sender_id?: string;
    source_message_id?: string;
  }>(request);
  if (!input.confirm_test) {
    return json({ error: "confirm_test=true is required; backlog ingest is intentionally disabled" }, { status: 400 });
  }
  try {
    const result = await createJob(env, {
      sourceUrl: input.source_url || "",
      instructions: input.instructions,
      senderId: input.sender_id,
      sourceMessageId: input.source_message_id,
    });
    return json({ ok: true, ...result, backlog_untouched: true }, { status: result.duplicate ? 200 : 202 });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

async function handleNormalizedIntake(request: Request, env: Env): Promise<Response> {
  const unauthorized = requireAdmin(request, env);
  if (unauthorized) return unauthorized;
  const input = await readJson<{
    source_url?: string;
    text?: string;
    instructions?: string;
    sender_id?: string;
    source_message_id?: string;
    test?: boolean;
    queue_delay_mode?: string;
  }>(request);
  const mode = env.INGEST_MODE || "disabled";
  if (mode === "disabled") return json({ error: "Ingest is disabled" }, { status: 409 });
  if (mode === "test_only" && !input.test) {
    return json({ ignored: true, reason: "test_only mode protects the existing backlog" }, { status: 202 });
  }
  const text = (input.text || "").trim();
  if (input.source_url) {
    const result = await createJob(env, {
      sourceUrl: input.source_url,
      instructions: input.instructions || text,
      senderId: input.sender_id,
      sourceMessageId: input.source_message_id,
      queueDelayMode: input.queue_delay_mode,
    });
    return json({ ok: true, ...result }, { status: result.duplicate ? 200 : 202 });
  }
  const command = parseMessageCommand(text);
  if (command.intent === "emoji") {
    const current = await getEmoji(env, command.stage);
    const requestedReaction = normalizeInstagramReaction(command.display);
    const next: EmojiSetting = { display: command.display, reaction: requestedReaction || current.reaction };
    await env.REEL_DB.prepare(
      "INSERT INTO settings(key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
    ).bind(`emoji.${command.stage}`, JSON.stringify(next)).run();
    return json({ ok: true, command: "emoji_display_changed", stage: command.stage, display: next.display, reaction: next.reaction, reaction_changed: Boolean(requestedReaction), chat_delivery: "reaction_only" });
  }
  if (command.intent === "note") {
    const id = uuid();
    await env.REEL_DB.prepare("INSERT OR IGNORE INTO notes(id, sender_id, body, source_message_id) VALUES (?, ?, ?, ?)")
      .bind(id, input.sender_id || null, command.body, input.source_message_id || null)
      .run();
    return json({ ok: true, command: "note_saved", id, preview: command.body.slice(0, 120) });
  }
  if (command.intent === "status") {
    const counts = await env.REEL_DB.prepare("SELECT status, COUNT(*) AS count FROM jobs GROUP BY status ORDER BY status").all();
    return json({ ok: true, command: "status", ingest_mode: mode, backlog_processing: await backlogProcessingActive(env), jobs: counts.results });
  }
  if (command.intent === "help") {
    return json({ ok: true, command: "help", message: "Send a Reel with optional instructions; use ‘note: …’, ‘send me the video about …’, ‘status’, or ‘change the emoji for <stage> to <supported reaction>’. Processing status uses reactions on the original share, never emoji messages." });
  }
  if (command.intent === "retrieval") return handleSearchQuery(env, command.query, 10);
  return json({ ok: true, command: "unknown", message: "I did not change anything. Send ‘help’ for supported commands." });
}

async function handleInstagramWebhook(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET") {
    const mode = url.searchParams.get("hub.mode") || "";
    const token = url.searchParams.get("hub.verify_token") || "";
    const challenge = url.searchParams.get("hub.challenge") || "";
    if (!env.META_WEBHOOK_VERIFY_TOKEN) return new Response("Webhook token is not configured", { status: 503 });
    return mode === "subscribe" && timingSafeEqual(token, env.META_WEBHOOK_VERIFY_TOKEN)
      ? new Response(challenge, { status: 200 })
      : new Response("Webhook verification failed", { status: 403 });
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await request.text();
  if (!(await verifyMetaSignature(request, env, body))) return json({ error: "Invalid Meta signature" }, { status: 403 });
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }
  const allowed = new Set((env.INSTAGRAM_ALLOWED_SENDER_IDS || "").split(",").map((value) => value.trim()).filter(Boolean));
  const results: unknown[] = [];
  for (const event of directMessageEvents(payload)) {
    const senderAllowed = !(allowed.size && !allowed.has(event.senderId));
    const senderSkip = instagramWebhookSkipReason({ senderAllowed, duplicateCommand: false });
    if (senderSkip === "sender_not_allowed") {
      results.push({ message_id: event.messageId, ignored: true, reason: "sender_not_allowed" });
      continue;
    }
    await env.REEL_DB.prepare(
      `INSERT OR IGNORE INTO inbound_webhook_events(source_message_id,sender_id,has_share_attachment,extracted_urls_json,raw_json)
       VALUES (?,?,?,?,?)`,
    ).bind(
      event.messageId || uuid(), event.senderId || null, event.hasShareAttachment ? 1 : 0,
      JSON.stringify(event.urls).slice(0, 6000), JSON.stringify(event.raw).slice(0, 16000),
    ).run();
    const markedTest = /(?:^|\s)#brain-test(?:\s|$)/i.test(event.text);
    let sourceUrl: string | undefined = event.urls.find((candidate) => canonicalizeInstagramUrl(candidate)) || event.urls[0];
    let hasShareAttachment = event.hasShareAttachment;
    if (!sourceUrl && event.messageId && (!event.text || hasShareAttachment)) {
      const recovered = await recoverInstagramMessage(env, event.messageId, event.raw);
      if (recovered) {
        sourceUrl = recovered.sourceUrl || undefined;
        hasShareAttachment = hasShareAttachment || recovered.hasShareAttachment;
        await env.REEL_DB.prepare(
          "UPDATE inbound_webhook_events SET recovery_json=?,recovered_url=?,updated_at=CURRENT_TIMESTAMP WHERE source_message_id=?",
        ).bind(JSON.stringify(recovered.payload).slice(0, 16000), sourceUrl || null, event.messageId).run();
      }
    }
    let sourceMessageId = event.messageId;
    const cleanText = event.text.replace(/(?:^|\s)#brain-test(?:\s|$)/ig, " ").trim();
    const markerOnly = markedTest && !cleanText && !sourceUrl;
    const command = sourceUrl ? null : parseMessageCommand(cleanText);
    const emptyMessage = !sourceUrl && !cleanText;
    const commandIntent = sourceUrl ? "reel" : markerOnly ? "test_marker" : hasShareAttachment ? "unsupported_share" : emptyMessage ? "empty_message" : command?.intent || "unknown";
    const existingCommand = await env.REEL_DB.prepare("SELECT id, status FROM dm_commands WHERE source_message_id=?")
      .bind(event.messageId).first<{ id: string; status: string }>();
    const duplicateSkip = instagramWebhookSkipReason({ senderAllowed: true, duplicateCommand: Boolean(existingCommand) });
    if (duplicateSkip === "duplicate_command" && existingCommand) {
      results.push({ message_id: event.messageId, duplicate: true, command_id: existingCommand.id, status: existingCommand.status });
      continue;
    }
    const commandId = uuid();
    await env.REEL_DB.prepare(
      "INSERT INTO dm_commands(id,sender_id,source_message_id,intent,input_text,normalized_query,is_test) VALUES (?,?,?,?,?,?,?)",
    ).bind(
      commandId, event.senderId, event.messageId, commandIntent, cleanText,
      command?.intent === "retrieval" ? command.query : null, markedTest ? 1 : 0,
    ).run();

    let effectiveTest = markedTest;
    let instructions = cleanText;
    if (sourceUrl && !hasShareAttachment) {
      const pendingUnsupportedShare = await takePendingDmPart(env, event.senderId, ["unsupported_share"]);
      if (pendingUnsupportedShare) {
        sourceMessageId = pendingUnsupportedShare.source_message_id;
        await env.REEL_DB.prepare(
          "UPDATE dm_commands SET status='paired',result_summary=?,completed_at=CURRENT_TIMESTAMP WHERE source_message_id=?",
        ).bind(JSON.stringify({ paired_with: event.messageId, kind: "permalink" }), pendingUnsupportedShare.source_message_id).run();
      }
    }
    if ((env.INGEST_MODE || "disabled") === "test_only") {
      if (sourceUrl && !markedTest) {
        const pendingInstruction = await takePendingDmPart(env, event.senderId, ["instruction"]);
        if (pendingInstruction) {
          effectiveTest = true;
          instructions = pendingInstruction.instructions || "";
          await env.REEL_DB.prepare(
            "UPDATE dm_commands SET status='paired', result_summary=?, completed_at=CURRENT_TIMESTAMP WHERE source_message_id=?",
          ).bind(JSON.stringify({ paired_with: event.messageId, kind: "instruction" }), pendingInstruction.source_message_id).run();
        } else {
          await storePendingDmPart(env, {
            senderId: event.senderId,
            sourceMessageId: event.messageId,
            kind: "share",
            sourceUrl,
            isTest: pendingPartIsTest({ mode: env.INGEST_MODE || "disabled", kind: "share" }),
          });
          const waiting = { ok: true, silent: true, waiting_for: "#brain-test", message_id: event.messageId };
          await env.REEL_DB.prepare(
            "UPDATE dm_commands SET status='waiting_for_test_marker', result_summary=? WHERE id=?",
          ).bind(JSON.stringify(waiting), commandId).run();
          results.push(waiting);
          continue;
        }
      } else if (markerOnly) {
        const pendingShare = await takePendingDmPart(env, event.senderId, ["share", "unsupported_share"]);
        if (!pendingShare) {
          await storePendingDmPart(env, {
            senderId: event.senderId,
            sourceMessageId: event.messageId,
            kind: "instruction",
            isTest: pendingPartIsTest({ mode: env.INGEST_MODE || "disabled", kind: "instruction" }),
          });
          const waiting = { ok: true, silent: true, waiting_for: "instagram_share", message_id: event.messageId };
          await env.REEL_DB.prepare(
            "UPDATE dm_commands SET status='waiting_for_share', result_summary=? WHERE id=?",
          ).bind(JSON.stringify(waiting), commandId).run();
          results.push(waiting);
          continue;
        }
        if (pendingShare.kind === "unsupported_share" || !pendingShare.source_url) {
          const unsupported = { ok: true, silent: true, ignored: true, reason: "shared_post_has_no_processable_reel_url" };
          await env.REEL_DB.batch([
            env.REEL_DB.prepare(
              "UPDATE dm_commands SET status='unsupported_silent', result_summary=?, completed_at=CURRENT_TIMESTAMP WHERE id=?",
            ).bind(JSON.stringify(unsupported), commandId),
            env.REEL_DB.prepare(
              "UPDATE dm_commands SET status='unsupported_silent', result_summary=?, completed_at=CURRENT_TIMESTAMP WHERE source_message_id=?",
            ).bind(JSON.stringify(unsupported), pendingShare.source_message_id),
          ]);
          results.push(unsupported);
          continue;
        }
        sourceUrl = pendingShare.source_url;
        sourceMessageId = pendingShare.source_message_id;
        effectiveTest = true;
      } else if (!sourceUrl && hasShareAttachment) {
        await storePendingDmPart(env, {
          senderId: event.senderId,
          sourceMessageId: event.messageId,
          kind: "unsupported_share",
          isTest: pendingPartIsTest({ mode: env.INGEST_MODE || "disabled", kind: "unsupported_share" }),
        });
        const waiting = { ok: true, silent: true, waiting_for: "processable_reel_url_or_test_marker", message_id: event.messageId };
        await env.REEL_DB.prepare(
          "UPDATE dm_commands SET status='unsupported_share_waiting', result_summary=? WHERE id=?",
        ).bind(JSON.stringify(waiting), commandId).run();
        results.push(waiting);
        continue;
      }
    }
    if ((env.INGEST_MODE || "disabled") === "live") {
      const hasShare = Boolean(sourceUrl || hasShareAttachment);
      if (shouldCreateLiveInstructionTarget({ mode: env.INGEST_MODE || "disabled", hasShare, instructions })) {
        const pendingInstruction = await takeLiveInstructionForShare(env, {
          senderId: event.senderId,
          shareMessageId: sourceMessageId,
        });
        if (pendingInstruction) instructions = pendingInstruction;
      }
      if (shouldCreateLiveInstructionTarget({ mode: env.INGEST_MODE || "disabled", hasShare, instructions })) {
        await storePendingDmPart(env, {
          senderId: event.senderId,
          sourceMessageId,
          kind: "share",
          sourceUrl,
          expiresIn: "5 minutes",
        });
      } else if (shouldStoreLiveInstructionCandidate({
        mode: env.INGEST_MODE || "disabled",
        hasShare,
        emptyMessage,
        commandIntent: command?.intent,
      })) {
        const unknownInstructions = command?.intent === "unknown" ? command.text : cleanText;
        const paired = await pairLiveInstructionWithShare(env, {
          senderId: event.senderId,
          instructionMessageId: event.messageId,
          instructions: unknownInstructions,
        });
        results.push(paired.result);
        continue;
      }
    }
    if (!sourceUrl && hasShareAttachment) {
      const unsupported = await enqueueCarouselResolution(env, {
        senderId: event.senderId,
        sourceMessageId,
        raw: event.raw,
        instructions,
        queueDelayMode: env.INGEST_MODE || "disabled",
      });
      results.push(unsupported);
      continue;
    }
    if (!sourceUrl && emptyMessage) {
      const unsupported = {
        ok: true,
        silent: true,
        ignored: true,
        reason: "empty_message_event",
      };
      await env.REEL_DB.prepare(
        "UPDATE dm_commands SET status='unsupported_silent', result_summary=?, completed_at=CURRENT_TIMESTAMP WHERE id=?",
      ).bind(JSON.stringify(unsupported), commandId).run();
      results.push(unsupported);
      continue;
    }
    const normalizedRequest = new Request("https://worker.internal/api/intake", {
      method: "POST",
      headers: { authorization: `Bearer ${env.ADMIN_TOKEN || ""}`, "content-type": "application/json" },
      body: JSON.stringify({
        source_url: sourceUrl,
        text: cleanText,
        instructions,
        sender_id: event.senderId,
        source_message_id: sourceMessageId,
        test: effectiveTest,
        queue_delay_mode: env.INGEST_MODE || "disabled",
      }),
    });
    const response = await handleNormalizedIntake(normalizedRequest, env);
    const result: {
      decision?: "match" | "ambiguous" | "no_match";
      matches?: Array<{ id?: string; title?: string | null; canonical_url?: string | null; author_username?: string | null; description?: string | null; original_video_key?: string | null; score?: number }>;
      reel_sent?: boolean;
      video_sent?: boolean;
      delivery?: string;
    } & Record<string, unknown> = await response
      .json<{
        decision?: "match" | "ambiguous" | "no_match";
        matches?: Array<{ id?: string; title?: string | null; canonical_url?: string | null; author_username?: string | null; description?: string | null; original_video_key?: string | null; score?: number }>;
        reel_sent?: boolean;
        video_sent?: boolean;
        delivery?: string;
      } & Record<string, unknown>>()
      .catch(() => ({ error: `HTTP ${response.status}` }));
    let outboundOk = true;
    const firstMatch = selectRetrievalMatch(result.decision, result.matches);
    const firstJobId = firstMatch?.id || (typeof result.id === "string" && sourceUrl ? result.id : undefined);
    if (!sourceUrl && event.senderId && command?.intent === "retrieval") {
      if (firstJobId && firstMatch) {
        const useArchivedFile = command.delivery === "video_file" || !firstMatch.canonical_url;
        if (useArchivedFile) {
          result.delivery = "video_file";
          result.video_sent = await sendInstagramArchivedVideoWithContext(
            env,
            event.senderId,
            { id: firstJobId, author_username: firstMatch.author_username, description: firstMatch.description },
            event.messageId,
          );
          outboundOk = Boolean(result.video_sent);
        } else {
          result.delivery = "original_reel";
          result.reel_sent = await sendInstagramText(env, event.senderId, firstMatch.canonical_url!, event.messageId, "reel_link");
          outboundOk = Boolean(result.reel_sent);
        }
      } else if (result.decision === "ambiguous" && result.matches?.length) {
        result.delivery = "candidate_list";
        const candidates = result.matches.slice(0, 3).map((match, index) => {
          const author = match.author_username ? `@${String(match.author_username).replace(/^@/, "")}` : "Unknown creator";
          const title = String(match.title || match.description || "Untitled Reel").replace(/\s+/g, " ").trim().slice(0, 100);
          return `${index + 1}. ${author} — ${title}${match.canonical_url ? `\n${match.canonical_url}` : ""}`;
        });
        outboundOk = await sendInstagramText(
          env,
          event.senderId,
          `I found several possible matches. Here are the three strongest results:\n\n${candidates.join("\n\n")}\n\nAdd another distinctive detail if none is correct.`,
          event.messageId,
        );
      } else {
        outboundOk = await sendInstagramText(env, event.senderId, "I could not find a completed Reel matching that description.", event.messageId);
      }
    } else if (!sourceUrl && event.senderId) {
      if (result.ignored || result.silent) {
        outboundOk = true;
      } else if (result.command === "emoji_display_changed") {
        // Confirm configuration as a reaction on the command itself; never add an emoji chat message.
        outboundOk = await reactToSourceMessage(
          env,
          { source_message_id: event.messageId, sender_id: event.senderId, id: commandId },
          String(result.stage || "error_unknown"),
        );
      } else {
        const reply = result.command === "note_saved"
        ? `Note saved: ${String(result.preview || "").slice(0, 180)}`
        : result.command === "status"
            ? `System is online in ${String(result.ingest_mode)} mode. Backlog processing is off.`
            : String(result.message || "Request received.");
        outboundOk = await sendInstagramText(env, event.senderId, reply, event.messageId);
      }
    }
    const commandStatus = outboundOk ? "complete" : "complete_with_outbound_error";
    await env.REEL_DB.prepare(
      "UPDATE dm_commands SET status=?, result_job_id=?, result_summary=?, error=?, completed_at=CURRENT_TIMESTAMP WHERE id=?",
    ).bind(
      commandStatus, firstJobId || null, JSON.stringify(result).slice(0, 1500),
      outboundOk ? null : "Command completed internally, but the Instagram reply failed", commandId,
    ).run();
    if (sourceMessageId !== event.messageId && firstJobId) {
      await env.REEL_DB.prepare(
        "UPDATE dm_commands SET status='complete', result_job_id=?, result_summary=?, completed_at=CURRENT_TIMESTAMP WHERE source_message_id=?",
      ).bind(firstJobId, JSON.stringify({ paired_with: event.messageId, result_job_id: firstJobId }), sourceMessageId).run();
    }
    result.command_id = commandId;
    result.command_status = commandStatus;
    results.push(result);
  }
  return json({ ok: true, received: results.length, results });
}

async function retrievalDocumentForJob(env: Env, job: JobRow, payload: SynthesisPayload): Promise<RetrievalDocument> {
  const comments = (await loadCapturedCommentBundle(env, job, payload)).comments;
  return buildRetrievalDocument({
    jobId: job.id,
    title: payload.metadata.title || job.title,
    author: payload.metadata.author_username || job.author_username,
    description: payload.metadata.description || job.description,
    instructions: job.instructions,
    summary: payload.summary,
    visualSummary: payload.visual_summary,
    transcript: payload.transcript,
    comments,
    resources: payload.resources,
    claims: payload.claims,
  });
}

async function replaceRetrievalIndex(
  env: Env,
  document: RetrievalDocument,
  sourceUpdatedAt: string | null,
): Promise<{ contentHash: string; termCount: number }> {
  const contentHash = await sha256(JSON.stringify(document));
  const terms = retrievalDocumentTerms(document);
  const statements: D1PreparedStatement[] = [
    env.REEL_DB.prepare(
      `INSERT INTO retrieval_documents(
        job_id,document_version,title_text,author_text,description_text,instructions_text,
        summary_text,visual_text,transcript_text,comments_text,resource_names_text,
        resource_details_text,claims_text,content_hash,source_updated_at,indexed_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(job_id) DO UPDATE SET
        document_version=excluded.document_version,title_text=excluded.title_text,
        author_text=excluded.author_text,description_text=excluded.description_text,
        instructions_text=excluded.instructions_text,summary_text=excluded.summary_text,
        visual_text=excluded.visual_text,transcript_text=excluded.transcript_text,
        comments_text=excluded.comments_text,resource_names_text=excluded.resource_names_text,
        resource_details_text=excluded.resource_details_text,claims_text=excluded.claims_text,
        content_hash=excluded.content_hash,source_updated_at=excluded.source_updated_at,
        indexed_at=CURRENT_TIMESTAMP`,
    ).bind(
      document.job_id, document.document_version, document.title_text, document.author_text,
      document.description_text, document.instructions_text, document.summary_text,
      document.visual_text, document.transcript_text, document.comments_text,
      document.resource_names_text, document.resource_details_text, document.claims_text,
      contentHash, sourceUpdatedAt,
    ),
    env.REEL_DB.prepare("DELETE FROM retrieval_terms WHERE job_id=?").bind(document.job_id),
  ];
  for (let offset = 0; offset < terms.length; offset += 40) {
    const chunk = terms.slice(offset, offset + 40);
    const values = chunk.map(() => "(?,?,CURRENT_TIMESTAMP)").join(",");
    statements.push(
      env.REEL_DB.prepare(`INSERT INTO retrieval_terms(job_id,term,indexed_at) VALUES ${values}`)
        .bind(...chunk.flatMap((term) => [document.job_id, term])),
    );
  }
  await env.REEL_DB.batch(statements);
  return { contentHash, termCount: terms.length };
}

type RetrievalReindexCursor = { completed_at: string; id: string };

function decodeRetrievalReindexCursor(value: unknown): RetrievalReindexCursor | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(fromBase64Url(value)) as Partial<RetrievalReindexCursor>;
    return typeof parsed.completed_at === "string" && typeof parsed.id === "string"
      ? { completed_at: parsed.completed_at, id: parsed.id }
      : null;
  } catch {
    return null;
  }
}

async function handleRetrievalReindex(request: Request, env: Env): Promise<Response> {
  const input = await readJson<{ limit?: number; cursor?: string; job_id?: string; confirmation?: string }>(request);
  if (input.confirmation !== RETRIEVAL_REINDEX_CONFIRMATION) {
    return json({ error: `confirmation must exactly equal ${RETRIEVAL_REINDEX_CONFIRMATION}` }, { status: 400 });
  }
  const limit = Math.min(Math.max(Math.trunc(Number(input.limit || 10)), 1), 20);
  const jobId = String(input.job_id || "").trim();
  const cursor = decodeRetrievalReindexCursor(input.cursor);
  if (input.cursor && !cursor) return json({ error: "Invalid retrieval reindex cursor" }, { status: 400 });
  const rows = jobId
    ? await env.REEL_DB.prepare("SELECT * FROM jobs WHERE id=? AND status='complete' AND synthesis_json_key IS NOT NULL LIMIT 1")
      .bind(jobId).all<JobRow>()
    : cursor
      ? await env.REEL_DB.prepare(
        `SELECT * FROM jobs
         WHERE status='complete' AND synthesis_json_key IS NOT NULL
           AND (datetime(completed_at)>datetime(?) OR (datetime(completed_at)=datetime(?) AND id>?))
         ORDER BY datetime(completed_at),id LIMIT ?`,
      ).bind(cursor.completed_at, cursor.completed_at, cursor.id, limit).all<JobRow>()
      : await env.REEL_DB.prepare(
        "SELECT * FROM jobs WHERE status='complete' AND synthesis_json_key IS NOT NULL ORDER BY datetime(completed_at),id LIMIT ?",
      ).bind(limit).all<JobRow>();
  const indexed: Array<{ job_id: string; content_hash: string; term_count: number }> = [];
  const failures: Array<{ job_id: string; error: string }> = [];
  let lastCursor: RetrievalReindexCursor | null = cursor;
  for (const job of rows.results) {
    try {
      const object = job.synthesis_json_key ? await env.REEL_ARCHIVE.get(job.synthesis_json_key) : null;
      if (!object) throw new Error("Stored synthesis object is missing");
      const payload = await object.json<SynthesisPayload>();
      if (!payload?.metadata?.title || !Array.isArray(payload.resources)) throw new Error("Stored synthesis payload is invalid");
      const indexedResult = await replaceRetrievalIndex(env, await retrievalDocumentForJob(env, job, payload), job.updated_at);
      indexed.push({ job_id: job.id, content_hash: indexedResult.contentHash, term_count: indexedResult.termCount });
      lastCursor = { completed_at: job.completed_at || job.updated_at, id: job.id };
    } catch (error) {
      failures.push({ job_id: job.id, error: (error instanceof Error ? error.message : String(error)).slice(0, 300) });
      break;
    }
  }
  const nextCursor = !jobId && !failures.length && rows.results.length === limit && lastCursor
    ? toBase64Url(JSON.stringify(lastCursor))
    : null;
  const counts = await env.REEL_DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM jobs WHERE status='complete') AS complete_jobs,
      (SELECT COUNT(*) FROM retrieval_documents) AS indexed_jobs,
      (SELECT COUNT(*) FROM retrieval_terms) AS indexed_terms`,
  ).first<{ complete_jobs: number; indexed_jobs: number; indexed_terms: number }>();
  return json({
    ok: failures.length === 0,
    indexed,
    failures,
    next_cursor: nextCursor,
    counts,
  }, failures.length ? { status: 500 } : undefined);
}

async function handleRetrievalIndexStatus(env: Env): Promise<Response> {
  const counts = await env.REEL_DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM jobs WHERE status='complete') AS complete_jobs,
      (SELECT COUNT(*) FROM jobs WHERE status='complete' AND synthesis_json_key IS NOT NULL) AS indexable_jobs,
      (SELECT COUNT(*) FROM retrieval_documents) AS indexed_jobs,
      (SELECT COUNT(*) FROM retrieval_terms) AS indexed_terms,
      (SELECT MAX(indexed_at) FROM retrieval_documents) AS last_indexed_at`,
  ).first();
  return json({ ok: true, ...counts });
}

async function handleSearchQuery(env: Env, query: string, limit: number): Promise<Response> {
  const expandedTerms = retrievalExpandedTerms(query);
  if (!expandedTerms.length) {
    return json({ ok: true, command: "retrieval", query, decision: "no_match", reason: "no_distinctive_terms", terms: [], matches: [] });
  }
  const placeholders = expandedTerms.map(() => "?").join(",");
  const rows = await env.REEL_DB.prepare(
    `SELECT d.*,j.id,j.title,j.author_username,j.description,j.canonical_url,j.status,j.status_emoji,
            j.original_video_key,j.markdown_key,j.completed_at,
            (SELECT COUNT(*) FROM resources r WHERE r.job_id=j.id) AS resource_count
     FROM retrieval_documents d
     INNER JOIN jobs j ON j.id=d.job_id
     WHERE j.status='complete'
       AND EXISTS (
         SELECT 1 FROM retrieval_terms t
         WHERE t.job_id=d.job_id AND t.term IN (${placeholders})
       )
     ORDER BY datetime(j.completed_at) DESC,j.id
     LIMIT 250`,
  ).bind(...expandedTerms).all<RetrievalCandidate>();
  const candidates = rows.results.map((candidate) => ({
    ...candidate,
    resource_count: Number(candidate.resource_count || 0),
  }));
  const ranked = rankRetrievalCandidates(query, candidates, Math.min(Math.max(limit, 1), 25));
  return json({
    ok: true,
    command: "retrieval",
    query,
    ...ranked,
    matches: ranked.matches.map(retrievalMatchView),
  });
}

async function handleArtifactUpload(request: Request, env: Env, jobId: string, kind: string): Promise<Response> {
  const job = await validateCallback(request, env, jobId);
  if (!job) return json({ error: "Unauthorised callback" }, { status: 401 });
  if (!ARTIFACT_KINDS.has(kind)) return json({ error: "Unsupported artifact kind" }, { status: 400 });
  if (!request.body) return json({ error: "Artifact body is required" }, { status: 400 });
  const filename = (request.headers.get("x-artifact-filename") || `${kind}.bin`).replace(/[^A-Za-z0-9._-]/g, "_");
  const objectKey = `reels/${job.shortcode || job.id}/${job.id}/${kind}/attempt-${Math.max(job.attempts, 1)}/${filename}`;
  const contentType = request.headers.get("content-type") || "application/octet-stream";
  const sha = request.headers.get("x-artifact-sha256");
  const byteSize = Number(request.headers.get("content-length") || 0);
  if (env.PHASE7_ORIGIN_URL && (!sha || !Number.isSafeInteger(byteSize) || byteSize <= 0)) {
    return json({ error: "Phase 7 artifact upload requires content length and SHA-256" }, { status: 400 });
  }
  const [localBody, r2Body] = request.body.tee();
  await putPhase7Origin(env, "object", objectKey, localBody, contentType, byteSize, sha || "");
  await env.REEL_ARCHIVE.put(objectKey, r2Body, {
    httpMetadata: { contentType },
    customMetadata: { job_id: job.id, kind, source_url: job.canonical_url || job.source_url, ...(sha ? { sha256: sha } : {}) },
  });
  const head = await env.REEL_ARCHIVE.head(objectKey);
  const previous = await env.REEL_DB.prepare("SELECT id,object_key FROM artifacts WHERE job_id=? AND kind=?")
    .bind(job.id, kind).all<{ id: string; object_key: string }>();
  const superseded = previous.results.filter((artifact) => artifact.object_key !== objectKey && artifact.object_key.endsWith(`/${filename}`));
  if (superseded.length) {
    await env.REEL_DB.batch(superseded.map((artifact) => env.REEL_DB.prepare("DELETE FROM artifacts WHERE id=?").bind(artifact.id)));
  }
  await env.REEL_DB.prepare(
    "INSERT INTO artifacts(id, job_id, kind, object_key, content_type, byte_size, sha256) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(object_key) DO UPDATE SET content_type=excluded.content_type, byte_size=excluded.byte_size, sha256=excluded.sha256, created_at=CURRENT_TIMESTAMP",
  ).bind(uuid(), job.id, kind, objectKey, contentType, head?.size || null, sha || null).run();
  const jobColumn = kind === "video" ? "original_video_key" : kind === "audio" ? "audio_key" : kind === "transcript" ? "transcript_key" : kind === "synthesis" ? "synthesis_json_key" : null;
  if (jobColumn) {
    await env.REEL_DB.prepare(`UPDATE jobs SET ${jobColumn} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(objectKey, job.id)
      .run();
  }
  return json({ ok: true, object_key: objectKey, bytes: head?.size || null });
}

async function handleArtifactDownload(request: Request, env: Env, jobId: string, artifactId: string): Promise<Response> {
  const job = await validateCallback(request, env, jobId);
  if (!job) return json({ error: "Unauthorised callback" }, { status: 401 });
  const artifact = await env.REEL_DB.prepare(
    "SELECT object_key,content_type FROM artifacts WHERE id=? AND job_id=?",
  ).bind(artifactId, jobId).first<{ object_key: string; content_type: string | null }>();
  if (!artifact) return json({ error: "Artifact not found" }, { status: 404 });
  const object = await env.REEL_ARCHIVE.get(artifact.object_key);
  if (!object) return json({ error: "Archived object not found" }, { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": artifact.content_type || object.httpMetadata?.contentType || "application/octet-stream",
      "cache-control": "no-store",
    },
  });
}

async function handleStageCallback(request: Request, env: Env, jobId: string): Promise<Response> {
  const job = await validateCallback(request, env, jobId);
  if (!job) return json({ error: "Unauthorised callback" }, { status: 401 });
  const input = await readJson<{ stage?: string; detail?: string }>(request);
  if (input.stage !== "synthesizing") return json({ error: "Unsupported callback stage" }, { status: 400 });
  await setStage(env, job, "synthesizing", "running", String(input.detail || "Research started").slice(0, 500));
  return json({ ok: true, stage: "synthesizing" });
}

async function handlePreCodexDedupe(request: Request, env: Env, jobId: string): Promise<Response> {
  const job = await validateCallback(request, env, jobId);
  if (!job) return json({ error: "Unauthorised callback" }, { status: 401 });
  const input = await readJson<{ canonical_url?: string; shortcode?: string }>(request);
  const canonical = canonicalizeInstagramUrl(input.canonical_url || "");
  const shortcode = String(input.shortcode || canonical?.shortcode || "").trim();
  if (!shortcode) return json({ error: "A resolved Instagram shortcode is required" }, { status: 400 });
  const canonicalUrl = canonical?.url || `https://www.instagram.com/reel/${shortcode}/`;
  const dedupeKey = `instagram:${shortcode}`;
  const existing = await env.REEL_DB.prepare(
    `SELECT id,status FROM jobs
     WHERE id != ? AND (dedupe_key=? OR shortcode=? OR canonical_url=?)
     ORDER BY CASE status WHEN 'complete' THEN 0 WHEN 'running' THEN 1 WHEN 'queued' THEN 2 ELSE 3 END, created_at DESC
     LIMIT 1`,
  ).bind(jobId, dedupeKey, shortcode, canonicalUrl).first<{ id: string; status: string }>();
  if (existing) {
    const detail = `Resolved post duplicates existing job ${existing.id} (${existing.status}); stopped before Codex`;
    await env.REEL_DB.batch([
      env.REEL_DB.prepare("UPDATE jobs SET status='duplicate',stage='duplicate',error_code='duplicate_pre_codex',error_message=?,upload_token_hash=NULL,upload_token_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(detail, jobId),
      env.REEL_DB.prepare("INSERT INTO job_events(job_id,stage,status,emoji,detail) VALUES (?,'duplicate','duplicate','=',?)").bind(jobId, detail),
      env.REEL_DB.prepare("UPDATE pilot_items SET decision='duplicate',detail=? WHERE job_id=?").bind(detail, jobId),
    ]);
    return json({ ok: true, duplicate: true, existing_job_id: existing.id, stopped_before_codex: true });
  }
  try {
    await env.REEL_DB.prepare("UPDATE jobs SET canonical_url=?,shortcode=?,dedupe_key=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(canonicalUrl, shortcode, dedupeKey, jobId).run();
  } catch {
    const raced = await env.REEL_DB.prepare("SELECT id FROM jobs WHERE id != ? AND dedupe_key=? LIMIT 1").bind(jobId, dedupeKey).first<{ id: string }>();
    if (!raced) throw new Error("Resolved Reel deduplication update failed");
    const detail = `Resolved post duplicates concurrently accepted job ${raced.id}; stopped before Codex`;
    await env.REEL_DB.batch([
      env.REEL_DB.prepare("UPDATE jobs SET status='duplicate',stage='duplicate',error_code='duplicate_pre_codex',error_message=?,upload_token_hash=NULL,upload_token_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(detail, jobId),
      env.REEL_DB.prepare("UPDATE pilot_items SET decision='duplicate',detail=? WHERE job_id=?").bind(detail, jobId),
    ]);
    return json({ ok: true, duplicate: true, existing_job_id: raced.id, stopped_before_codex: true });
  }
  return json({ ok: true, duplicate: false, canonical_url: canonicalUrl, shortcode, dedupe_key: dedupeKey });
}

async function handleTranscription(request: Request, env: Env, jobId: string): Promise<Response> {
  const job = await validateCallback(request, env, jobId);
  if (!job) return json({ error: "Unauthorised callback" }, { status: 401 });
  const audio = new Uint8Array(await request.arrayBuffer());
  if (!audio.byteLength) return json({ error: "Audio body is required" }, { status: 400 });
  try {
    const result = await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
      audio: bytesToBase64(audio),
      vad_filter: true,
    }) as {
      text?: string;
      transcription_info?: unknown;
      words?: unknown[];
      segments?: unknown[];
    };
    return json({ ok: true, text: result.text || "", segments: result.segments || [], words: result.words || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Workers AI transcription failed", job.id, message);
    return json({ error: message }, { status: 500 });
  }
}

async function handleComplete(request: Request, env: Env, jobId: string): Promise<Response> {
  const job = await validateCallback(request, env, jobId);
  if (!job) return json({ error: "Unauthorised callback" }, { status: 401 });
  const payload = await readJson<SynthesisPayload>(request);
  if (!payload.metadata?.title || !payload.metadata?.author_username || !payload.summary || !Array.isArray(payload.resources)) {
    return json({ error: "Incomplete synthesis payload" }, { status: 400 });
  }
  payload.resources = await enrichSynthesisResourceMedia(payload.resources);
  const resources = routeSynthesisResources(job, payload);
  const audio = payload.audio && payload.audio.identification_method !== "unidentified" && payload.audio.source_url
    ? payload.audio
    : {
        title: null,
        artist: null,
        source_url: null,
        identification_method: "unidentified" as const,
        confidence: "unverified" as const,
      };
  payload.audio = audio;
  const processingSeconds = processingSecondsSince(job.started_at || job.created_at);
  const synthesisKey = `reels/${job.shortcode || job.id}/${job.id}/synthesis/result.json`;
  await putPhase7MirroredObject(env, synthesisKey, JSON.stringify(payload, null, 2), { httpMetadata: { contentType: "application/json" } });

  const statements: D1PreparedStatement[] = [
    env.REEL_DB.prepare(
      "UPDATE jobs SET canonical_url = ?, shortcode = ?, title = ?, author_username = ?, description = ?, synthesis_json_key = ?, audio_title=?, audio_artist=?, audio_source_url=?, audio_identification_method=?, audio_confidence=?, processing_seconds=?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(
      payload.metadata.canonical_url || job.canonical_url,
      payload.metadata.shortcode || job.shortcode,
      payload.metadata.title,
      payload.metadata.author_username,
      payload.metadata.description || "",
      synthesisKey,
      audio.title,
      audio.artist,
      audio.source_url,
      audio.identification_method,
      audio.confidence,
      processingSeconds,
      job.id,
    ),
  ];
  for (const resource of resources) {
    statements.push(
      env.REEL_DB.prepare(
        "INSERT INTO resources(id, job_id, name, slug, kind, artifact_type, canonical_key, canonical_url, summary, why_useful, guide_text, guide_markdown_key, evidence_json, media_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(job_id, slug) DO UPDATE SET name=excluded.name, kind=excluded.kind, artifact_type=excluded.artifact_type, canonical_key=excluded.canonical_key, canonical_url=excluded.canonical_url, summary=excluded.summary, why_useful=excluded.why_useful, guide_text=excluded.guide_text, guide_markdown_key=excluded.guide_markdown_key, evidence_json=excluded.evidence_json, media_json=excluded.media_json",
      ).bind(
        uuid(), job.id, resource.name, resource.slug, resource.kind || null, resource.artifactType, resource.canonicalKey, resource.canonical_url || null,
        resource.summary, resource.why_useful, resource.guide, null, JSON.stringify(resource.sources || []), JSON.stringify({ hero_image_url: resource.hero_image_url || null, hero_image_alt: resource.hero_image_alt || null, spotify_url: resource.spotify_url || null, youtube_candidates: resource.youtube_candidates || [], article_links: resource.article_links || [] }),
      ),
    );
  }
  await env.REEL_DB.batch(statements);
  await replaceRetrievalIndex(env, await retrievalDocumentForJob(env, job, payload), job.updated_at);
  const refreshedJob = await env.REEL_DB.prepare("SELECT * FROM jobs WHERE id=?").bind(job.id).first<JobRow>();
  if (!refreshedJob) return json({ error: "Job disappeared during HTML publication" }, { status: 500 });
  const published = await publishSynthesisHtml(env, refreshedJob, payload);
  await env.REEL_DB.prepare(
    "UPDATE jobs SET status='complete', stage='complete', upload_token_hash=NULL, upload_token_expires_at=NULL, completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?",
  ).bind(job.id).run();
  if (job.source_message_id) {
    await env.REEL_DB.prepare(
      "UPDATE dm_commands SET intent='reel',status='complete',result_job_id=?,result_summary=?,error=NULL,completed_at=CURRENT_TIMESTAMP WHERE source_message_id=?",
    ).bind(
      job.id,
      JSON.stringify({ ok: true, job_id: job.id, library_path: published.rootPath, resource_count: published.resourceCount }).slice(0, 1500),
      job.source_message_id,
    ).run();
  }
  await setStage(env, job, "complete", "complete", `${resources.length} resources documented`);
  return json({
    ok: true,
    html_key: published.rootKey,
    library_path: published.rootPath,
    resource_count: published.resourceCount,
  });
}

async function publishJobToSecondBrain(env: Env, jobId: string): Promise<Response> {
  if (!env.SECOND_BRAIN_KV) return json({ error: "SECOND_BRAIN_KV is not configured" }, { status: 503 });
  const job = await env.REEL_DB.prepare("SELECT markdown_key FROM jobs WHERE id = ?")
    .bind(jobId)
    .first<Pick<JobRow, "markdown_key">>();
  if (!job?.markdown_key) return json({ error: "Completed Markdown is not available" }, { status: 404 });
  const rootObject = await env.REEL_ARCHIVE.get(job.markdown_key);
  if (!rootObject) return json({ error: "Root Markdown object is missing" }, { status: 404 });
  const rootPath = secondBrainRootPath(jobId);
  await mirrorMarkdownToSecondBrain(env, rootPath, await rootObject.text());

  const resources = await env.REEL_DB.prepare(
    "SELECT slug, guide_markdown_key FROM resources WHERE job_id = ? ORDER BY name",
  ).bind(jobId).all<{ slug: string; guide_markdown_key: string }>();
  let resourceCount = 0;
  for (const resource of resources.results) {
    const object = await env.REEL_ARCHIVE.get(resource.guide_markdown_key);
    if (!object) continue;
    await mirrorMarkdownToSecondBrain(
      env,
      `wiki/sources/instagram-reels/resources/${jobId}/${resource.slug}.md`,
      await object.text(),
    );
    resourceCount += 1;
  }
  await refreshSecondBrainManifest(env);
  return json({ ok: true, second_brain_path: rootPath, resource_count: resourceCount });
}

async function publishJobToReelLibrary(env: Env, jobId: string): Promise<Response> {
  const job = await env.REEL_DB.prepare("SELECT * FROM jobs WHERE id=?").bind(jobId).first<JobRow>();
  if (!job?.synthesis_json_key) return json({ error: "Completed synthesis is not available" }, { status: 404 });
  const object = await env.REEL_ARCHIVE.get(job.synthesis_json_key);
  if (!object) return json({ error: "Synthesis object is missing" }, { status: 404 });
  const payload = await object.json<SynthesisPayload>().catch(() => null);
  if (!payload?.metadata?.title || !Array.isArray(payload.resources)) {
    return json({ error: "Stored synthesis is invalid" }, { status: 500 });
  }
  const published = await publishSynthesisHtml(env, job, payload);
  return json({
    ok: true,
    html_key: published.rootKey,
    library_path: published.rootPath,
    resource_count: published.resourceCount,
  });
}

async function getJobResponse(env: Env, id: string): Promise<Response> {
  const job = await env.REEL_DB.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first<JobRow>();
  if (!job) return json({ error: "Not found" }, { status: 404 });
  const [artifacts, resources, events] = await Promise.all([
    env.REEL_DB.prepare("SELECT kind, object_key, content_type, byte_size, sha256, created_at FROM artifacts WHERE job_id = ? ORDER BY created_at").bind(id).all(),
    env.REEL_DB.prepare("SELECT name, slug, kind, artifact_type, canonical_url, summary, why_useful, guide_markdown_key FROM resources WHERE job_id = ? ORDER BY name").bind(id).all(),
    env.REEL_DB.prepare("SELECT stage, status, emoji, detail, created_at FROM job_events WHERE job_id = ? ORDER BY id").bind(id).all(),
  ]);
  return json({ job, artifacts: artifacts.results, resources: resources.results, events: events.results });
}

function requirePhase4Mirror(request: Request, env: Env): Response | { scope: Phase4MirrorScope } {
  const scope = phase4MirrorScopeForToken(bearer(request), env.PHASE4_MIRROR_TOKEN, env.PHASE4_REPLAY_TOKEN);
  if (!scope) {
    return json({ error: "Unauthorised" }, { status: 401 });
  }
  return { scope };
}

async function handlePhase4Mirror(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (!phase4MirrorAllowsMethod(request.method)) return json({ error: "Method not allowed" }, { status: 405 });
  const authorization = requirePhase4Mirror(request, env);
  if (authorization instanceof Response) return authorization;
  const { scope } = authorization;
  const watermark = parsePhase4Watermark(url.searchParams.get("watermark"));
  if (!watermark) return json({ error: "A valid ISO watermark is required" }, { status: 400 });
  if (!phase4WatermarkAllowed(scope, watermark)) {
    return json({ error: "Requested watermark is outside the authorised Phase 4 mirror scope" }, { status: 403 });
  }

  if (url.pathname === "/api/phase4/mirror/delta") {
    const table = url.searchParams.get("table") || "";
    if (!isPhase4MirrorTable(table)) return json({ error: "Unsupported Phase 4 mirror table", supported_tables: phase4Tables() }, { status: 400 });
    const limit = parsePhase4Limit(url.searchParams.get("limit"));
    const cursor = decodePhase4Cursor(url.searchParams.get("cursor"), watermark);
    const query = phase4DeltaQuery(table, watermark, cursor, limit, scope);
    const rows = (await env.REEL_DB.prepare(query.sql).bind(...query.binds).all<Record<string, unknown>>()).results || [];
    return json({
      ok: true,
      table,
      watermark,
      limit,
      count: rows.length,
      rows,
      next_cursor: phase4NextCursor(table, rows),
    });
  }

  if (url.pathname === "/api/phase4/mirror/object") {
    const key = String(url.searchParams.get("key") || "").trim();
    if (!key || key.includes("..") || key.startsWith("/") || key.startsWith("\\")) return json({ error: "A valid object key is required" }, { status: 400 });
    const query = phase4ObjectAccessQuery(key, watermark, scope);
    const allowed = await env.REEL_DB.prepare(`SELECT object_key FROM (${query.sql}) AS allowed_objects WHERE object_key IS NOT NULL LIMIT 1`)
      .bind(...query.binds)
      .first<{ object_key: string }>();
    if (!allowed) return json({ error: "Object is outside the Phase 4 post-watermark mirror scope" }, { status: 404 });
    const object = await env.REEL_ARCHIVE.get(key);
    if (!object) return json({ error: "Artifact object is missing" }, { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "no-store");
    headers.set("x-phase4-object-key", key);
    headers.set("x-phase4-object-size", String(object.size));
    return new Response(object.body, { headers });
  }

  return json({ error: "Not found" }, { status: 404 });
}

async function streamObject(env: Env, objectKey: string | null, disposition: string): Promise<Response> {
  if (!objectKey) return json({ error: "Artifact is not available" }, { status: 404 });
  const object = await env.REEL_ARCHIVE.get(objectKey);
  if (!object) return json({ error: "Artifact object is missing" }, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("content-disposition", disposition);
  return new Response(object.body, { headers });
}

async function handleSignedDownload(request: Request, env: Env, jobId: string, kind: "video" | "audio" = "video"): Promise<Response> {
  if (!env.DOWNLOAD_SIGNING_KEY) return json({ error: "Downloads are not configured" }, { status: 503 });
  const url = new URL(request.url);
  const expires = Number(url.searchParams.get("expires") || 0);
  const signature = url.searchParams.get("sig") || "";
  if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return json({ error: "Download link expired" }, { status: 403 });
  const signaturePayload = kind === "video" ? `${jobId}:${expires}` : `${jobId}:audio:${expires}`;
  const expected = await hmacHex(env.DOWNLOAD_SIGNING_KEY, signaturePayload);
  if (!timingSafeEqual(signature, expected)) return json({ error: "Invalid download signature" }, { status: 403 });
  const job = await env.REEL_DB.prepare("SELECT original_video_key,audio_key FROM jobs WHERE id = ? AND status='complete'")
    .bind(jobId)
    .first<Pick<JobRow, "original_video_key" | "audio_key">>();
  const objectKey = kind === "video" ? job?.original_video_key : job?.audio_key;
  if (!objectKey) return json({ error: `${kind === "video" ? "Video" : "Audio"} not found` }, { status: 404 });
  const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
  const extension = kind === "video" ? "mp4" : "mp3";
  return streamObject(env, objectKey, `${disposition}; filename=instagram-reel-${jobId}.${extension}`);
}

async function handleReelLibraryMediaLink(request: Request, env: Env, jobId: string, kind: "video" | "audio"): Promise<Response> {
  if (!env.REEL_LIBRARY_SHARED_TOKEN || !timingSafeEqual(bearer(request), env.REEL_LIBRARY_SHARED_TOKEN)) {
    return json({ error: "Unauthorised" }, { status: 401 });
  }
  if (!env.DOWNLOAD_SIGNING_KEY || !env.PUBLIC_BASE_URL) {
    return json({ error: `Archived-${kind} links are not configured` }, { status: 503 });
  }
  const job = await env.REEL_DB.prepare(
    "SELECT original_video_key,audio_key,synthesis_json_key,codex_input_tokens,codex_cached_input_tokens,codex_output_tokens,codex_reasoning_output_tokens,codex_total_tokens FROM jobs WHERE id=? AND status='complete'",
  ).bind(jobId).first<JobRow>();
  if (!job) return json({ error: `Archived ${kind} is not available` }, { status: 404 });
  const objectKey = kind === "video" ? job?.original_video_key : job?.audio_key;
  if (!objectKey) return json({ error: `Archived ${kind} is not available` }, { status: 404 });
  const expires = Math.floor(Date.now() / 1000) + 60 * 60;
  const signaturePayload = kind === "video" ? `${jobId}:${expires}` : `${jobId}:audio:${expires}`;
  const signature = await hmacHex(env.DOWNLOAD_SIGNING_KEY, signaturePayload);
  const base = `${env.PUBLIC_BASE_URL}/download/jobs/${jobId}/${kind}?expires=${expires}&sig=${signature}`;
  return json({
    ok: true,
    play_url: base,
    download_url: `${base}&download=1`,
    expires_at: new Date(expires * 1000).toISOString(),
    token_usage: await loadJobTokenUsage(env, job),
  });
}

async function handleReelLibraryCarousel(request: Request, env: Env, jobId: string): Promise<Response> {
  if (!env.REEL_LIBRARY_SHARED_TOKEN || !timingSafeEqual(bearer(request), env.REEL_LIBRARY_SHARED_TOKEN)) {
    return json({ error: "Unauthorised" }, { status: 401 });
  }
  if (!env.DOWNLOAD_SIGNING_KEY || !env.PUBLIC_BASE_URL) return json({ error: "Archived carousel links are not configured" }, { status: 503 });
  const job = await env.REEL_DB.prepare(
    "SELECT synthesis_json_key,codex_input_tokens,codex_cached_input_tokens,codex_output_tokens,codex_reasoning_output_tokens,codex_total_tokens FROM jobs WHERE id=? AND status='complete'",
  ).bind(jobId).first<JobRow>();
  if (!job) return json({ error: "Completed carousel is not available" }, { status: 404 });
  const artifacts = await env.REEL_DB.prepare(
    "SELECT object_key,content_type,byte_size FROM artifacts WHERE job_id=? AND kind='carousel_item' ORDER BY object_key",
  ).bind(jobId).all<{ object_key: string; content_type: string | null; byte_size: number | null }>();
  if (!artifacts.results.length) return json({ error: "Archived carousel slides are not available" }, { status: 404 });
  const expires = Math.floor(Date.now() / 1000) + 60 * 60;
  const slides = await Promise.all(artifacts.results.map(async (artifact, zeroIndex) => {
    const index = zeroIndex + 1;
    const signature = await hmacHex(env.DOWNLOAD_SIGNING_KEY!, `${jobId}:carousel:${index}:${expires}`);
    const base = `${env.PUBLIC_BASE_URL}/download/jobs/${jobId}/carousel/${index}?expires=${expires}&sig=${signature}`;
    return { index, play_url: base, download_url: `${base}&download=1`, content_type: artifact.content_type, byte_size: artifact.byte_size };
  }));
  return json({ ok: true, slides, expires_at: new Date(expires * 1000).toISOString(), token_usage: await loadJobTokenUsage(env, job) });
}

async function handleReelLibraryThumbnail(request: Request, env: Env, jobId: string): Promise<Response> {
  if (!env.REEL_LIBRARY_SHARED_TOKEN || !timingSafeEqual(bearer(request), env.REEL_LIBRARY_SHARED_TOKEN)) {
    return json({ error: "Unauthorised" }, { status: 401 });
  }
  if (!env.DOWNLOAD_SIGNING_KEY || !env.PUBLIC_BASE_URL) return json({ error: "Gallery thumbnails are not configured" }, { status: 503 });
  const artifact = await env.REEL_DB.prepare(
    "SELECT object_key,content_type FROM artifacts WHERE job_id=? AND kind IN ('carousel_item','frame') ORDER BY CASE kind WHEN 'carousel_item' THEN 0 ELSE 1 END,object_key LIMIT 1",
  ).bind(jobId).first<{ object_key: string; content_type: string | null }>();
  if (!artifact) return json({ error: "A thumbnail is not available" }, { status: 404 });
  const expires = Math.floor(Date.now() / 1000) + 60 * 60;
  const signature = await hmacHex(env.DOWNLOAD_SIGNING_KEY, `${jobId}:thumbnail:${expires}`);
  return json({
    ok: true,
    thumbnail_url: `${env.PUBLIC_BASE_URL}/download/jobs/${jobId}/thumbnail?expires=${expires}&sig=${signature}`,
    expires_at: new Date(expires * 1000).toISOString(),
  });
}

async function handleReelLibraryArtifactRepair(request: Request, env: Env): Promise<Response> {
  if (!env.REEL_LIBRARY_SHARED_TOKEN || !timingSafeEqual(bearer(request), env.REEL_LIBRARY_SHARED_TOKEN)) {
    return json({ error: "Unauthorised" }, { status: 401 });
  }
  const jobs = await env.REEL_DB.prepare(
    `SELECT j.* FROM jobs j WHERE j.status='complete' AND j.synthesis_json_key IS NOT NULL AND EXISTS (
      SELECT 1 FROM resources r WHERE r.job_id=j.id AND r.guide_text IS NULL
    ) ORDER BY j.completed_at,j.created_at LIMIT 8`,
  ).all<JobRow>();
  const results: Array<{ job_id: string; ok: boolean; error?: string }> = [];
  for (const job of jobs.results) {
    try {
      const object = await env.REEL_ARCHIVE.get(job.synthesis_json_key!);
      const payload = object ? await object.json<SynthesisPayload>().catch(() => null) : null;
      if (!payload?.metadata?.title || !Array.isArray(payload.resources)) throw new Error("Stored synthesis is unavailable or invalid");
      payload.resources = await enrichSynthesisResourceMedia(payload.resources);
      await env.REEL_ARCHIVE.put(job.synthesis_json_key!, JSON.stringify(payload, null, 2), { httpMetadata: { contentType: "application/json" } });
      await publishSynthesisHtml(env, job, payload, { deferIndexRefresh: true });
      results.push({ job_id: job.id, ok: true });
    } catch (error) {
      results.push({ job_id: job.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const musicRows = await env.REEL_DB.prepare(
    "SELECT id,canonical_key,media_json FROM resources WHERE artifact_type='music' AND media_json IS NOT NULL",
  ).all<{ id: string; canonical_key: string | null; media_json: string }>();
  const refreshedMusicKeys = new Set<string>();
  let artworkUpgraded = 0;
  for (const row of musicRows.results) {
    let media: ResourceMedia;
    try {
      media = JSON.parse(row.media_json || "{}") as ResourceMedia;
    } catch {
      continue;
    }
    const currentUrl = String(media.hero_image_url || "");
    const upgradedUrl = highResolutionMusicArtworkUrl(currentUrl);
    if (!currentUrl || !upgradedUrl || currentUrl === upgradedUrl) continue;
    media.hero_image_url = upgradedUrl;
    await env.REEL_DB.prepare("UPDATE resources SET media_json=? WHERE id=?").bind(JSON.stringify(media), row.id).run();
    if (row.canonical_key) refreshedMusicKeys.add(row.canonical_key);
    artworkUpgraded += 1;
  }
  const youtubeCanonicalRows = await env.REEL_DB.prepare(
    `SELECT DISTINCT canonical_key FROM resources WHERE canonical_key IS NOT NULL
      AND json_array_length(json_extract(media_json,'$.youtube_candidates')) > 0`,
  ).all<{ canonical_key: string }>();
  const profileKeys = [...new Set([...refreshedMusicKeys, ...youtubeCanonicalRows.results.map((row) => row.canonical_key)])];
  for (let offset = 0; offset < profileKeys.length; offset += 12) {
    await Promise.all(profileKeys.slice(offset, offset + 12).map((canonicalKey) => refreshCanonicalArtifactPage(env, canonicalKey)));
  }
  const youtubeResourceRows = await env.REEL_DB.prepare(
    `SELECT r.id,r.job_id,r.name,r.kind,r.canonical_url,r.summary,r.why_useful,r.guide_text,r.evidence_json,r.media_json,
      r.library_path,j.library_path AS root_path,j.author_username
     FROM resources r JOIN jobs j ON j.id=r.job_id
     WHERE r.canonical_key IS NULL AND r.library_path IS NOT NULL
       AND json_array_length(json_extract(r.media_json,'$.youtube_candidates')) > 0`,
  ).all<{
    id: string; job_id: string; name: string; kind: string | null; canonical_url: string | null;
    summary: string | null; why_useful: string | null; guide_text: string | null; evidence_json: string | null;
    media_json: string; library_path: string; root_path: string | null; author_username: string | null;
  }>();
  for (const row of youtubeResourceRows.results) {
    let media: ResourceMedia = {};
    let sources: string[] = [];
    try { media = JSON.parse(row.media_json || "{}") as ResourceMedia; } catch { /* retain empty media */ }
    try {
      const values = JSON.parse(row.evidence_json || "[]");
      if (Array.isArray(values)) sources = values.map((value) => String(value || "").trim()).filter(Boolean);
    } catch { /* retain empty sources */ }
    const html = renderResourceHtml({
      rootId: row.job_id,
      rootPath: row.root_path || "",
      name: row.name,
      kind: row.kind,
      canonicalUrl: row.canonical_url,
      summary: row.summary || "Not recorded.",
      whyUseful: row.why_useful || "Not recorded.",
      guide: row.guide_text || "Not recorded.",
      sources,
      media,
    });
    const key = `library/${row.library_path}`;
    await Promise.all([
      env.REEL_ARCHIVE.put(key, html, { httpMetadata: { contentType: "text/html; charset=utf-8" } }),
      putReelLibraryHtml(env, row.library_path, html, {
        kind: "resource", job_id: row.job_id, parent_path: row.root_path || "", title: row.name,
        author: row.author_username || "", video_available: false, resource_kind: row.kind || "media",
        resource_folder: row.library_path.split("/", 1)[0] || "media", artifact_type: "", summary: row.summary || "",
      }),
    ]);
  }
  const youtubeCollection = await refreshYoutubeCollectionPages(env);
  await refreshArtifactCollectionPages(env);
  await refreshListCollectionPage(env);
  await refreshReelLibraryManifest(env);
  const repaired = results.filter((result) => result.ok).length;
  return json({ ok: repaired === results.length, repaired, artwork_upgraded: artworkUpgraded, youtube_profiles_rebuilt: profileKeys.length + youtubeResourceRows.results.length, youtube_videos: youtubeCollection.videos, youtube_video_pages_rebuilt: youtubeCollection.published, youtube_video_pages_removed: youtubeCollection.removed, failed: results.length - repaired, results });
}

async function handleSignedThumbnailDownload(request: Request, env: Env, jobId: string): Promise<Response> {
  if (!env.DOWNLOAD_SIGNING_KEY) return json({ error: "Downloads are not configured" }, { status: 503 });
  const url = new URL(request.url);
  const expires = Number(url.searchParams.get("expires") || 0);
  const signature = url.searchParams.get("sig") || "";
  if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return json({ error: "Thumbnail link expired" }, { status: 403 });
  const expected = await hmacHex(env.DOWNLOAD_SIGNING_KEY, `${jobId}:thumbnail:${expires}`);
  if (!timingSafeEqual(signature, expected)) return json({ error: "Invalid thumbnail signature" }, { status: 403 });
  const artifact = await env.REEL_DB.prepare(
    "SELECT object_key FROM artifacts WHERE job_id=? AND kind IN ('carousel_item','frame') ORDER BY CASE kind WHEN 'carousel_item' THEN 0 ELSE 1 END,object_key LIMIT 1",
  ).bind(jobId).first<{ object_key: string }>();
  if (!artifact) return json({ error: "Thumbnail not found" }, { status: 404 });
  const response = await streamObject(env, artifact.object_key, "inline");
  response.headers.set("cache-control", "private, max-age=3600");
  return response;
}

async function handleSignedCarouselDownload(request: Request, env: Env, jobId: string, slideIndex: number): Promise<Response> {
  if (!env.DOWNLOAD_SIGNING_KEY) return json({ error: "Downloads are not configured" }, { status: 503 });
  const url = new URL(request.url);
  const expires = Number(url.searchParams.get("expires") || 0);
  const signature = url.searchParams.get("sig") || "";
  if (!Number.isInteger(slideIndex) || slideIndex < 1 || slideIndex > 40) return json({ error: "Invalid slide number" }, { status: 400 });
  if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return json({ error: "Download link expired" }, { status: 403 });
  const expected = await hmacHex(env.DOWNLOAD_SIGNING_KEY, `${jobId}:carousel:${slideIndex}:${expires}`);
  if (!timingSafeEqual(signature, expected)) return json({ error: "Invalid download signature" }, { status: 403 });
  const artifact = await env.REEL_DB.prepare(
    "SELECT object_key,content_type FROM artifacts WHERE job_id=? AND kind='carousel_item' ORDER BY object_key LIMIT 1 OFFSET ?",
  ).bind(jobId, slideIndex - 1).first<{ object_key: string; content_type: string | null }>();
  if (!artifact) return json({ error: "Slide not found" }, { status: 404 });
  const extension = artifact.object_key.split(".").pop()?.replace(/[^a-z0-9]/gi, "") || "jpg";
  const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
  return streamObject(env, artifact.object_key, `${disposition}; filename=instagram-carousel-${jobId}-slide-${String(slideIndex).padStart(2, "0")}.${extension}`);
}

function requireReelLibraryToken(request: Request, env: Env): Response | null {
  if (!env.REEL_LIBRARY_SHARED_TOKEN || !timingSafeEqual(bearer(request), env.REEL_LIBRARY_SHARED_TOKEN)) {
    return json({ error: "Unauthorised" }, { status: 401 });
  }
  return null;
}

async function handleInstagramBrowserAuthStart(request: Request, env: Env): Promise<Response> {
  const authError = requireReelLibraryToken(request, env);
  if (authError) return authError;
  if (!env.BROWSER) return json({ error: "Cloudflare Browser Run is not bound" }, { status: 503 });
  const browser = await puppeteer.launch(env.BROWSER, { keep_alive: 600000 });
  try {
    const page = await browser.newPage();
    await page.goto("https://www.instagram.com/accounts/login/", { waitUntil: "domcontentloaded", timeout: 45000 });
    const session = await page.createCDPSession();
    const liveView = await session.send("Cloudflare.getLiveView", { mode: "tab", expiresInMs: 600000 });
    const state = {
      session_id: browser.sessionId(),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
    await env.REEL_DB.prepare(
      "INSERT INTO settings(key,value,updated_at) VALUES ('instagram.browser.auth_session',?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP",
    ).bind(JSON.stringify(state)).run();
    await browser.disconnect();
    return json({ ok: true, live_view_url: liveView.devtoolsFrontendUrl, expires_at: state.expires_at });
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }
}

async function handleInstagramBrowserAuthComplete(request: Request, env: Env): Promise<Response> {
  const authError = requireReelLibraryToken(request, env);
  if (authError) return authError;
  if (!env.BROWSER) return json({ error: "Cloudflare Browser Run is not bound" }, { status: 503 });
  const row = await env.REEL_DB.prepare("SELECT value FROM settings WHERE key='instagram.browser.auth_session'")
    .first<{ value: string }>();
  let state: { session_id?: string; expires_at?: string } = {};
  try { state = row?.value ? JSON.parse(row.value) as typeof state : {}; } catch { state = {}; }
  if (!state.session_id || !state.expires_at || Date.parse(state.expires_at) <= Date.now()) {
    return json({ error: "The Instagram login window expired. Start a new connection." }, { status: 409 });
  }
  const browser = await puppeteer.connect(env.BROWSER, state.session_id);
  try {
    const pages = await browser.pages();
    const page = pages.find((candidate) => candidate.url().includes("instagram.com")) || pages[0];
    if (!page) return json({ error: "The Instagram login page is unavailable" }, { status: 409 });
    const cookies = (await page.cookies()).filter((cookie) => /instagram\.com$/i.test(cookie.domain.replace(/^\./, "")));
    if (!cookies.some((cookie) => cookie.name === "sessionid" && cookie.value)) {
      return json({ error: "Instagram is not logged in yet. Complete the login in the open window, then press Finish connection again." }, { status: 409 });
    }
    await persistRuntimeSecret(env, "instagram_browser_cookies", JSON.stringify(cookies));
    const connectedAt = new Date().toISOString();
    await env.REEL_DB.batch([
      env.REEL_DB.prepare(
        "INSERT INTO settings(key,value,updated_at) VALUES ('instagram.browser.connected_at',?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP",
      ).bind(connectedAt),
      env.REEL_DB.prepare("DELETE FROM settings WHERE key='instagram.browser.auth_session'"),
    ]);

    // Recover one recent failed carousel as a bounded acceptance test; this deliberately does not open the backlog.
    const pending = await env.REEL_DB.prepare(
      `SELECT d.source_message_id,d.sender_id,d.input_text,w.raw_json
       FROM dm_commands d JOIN inbound_webhook_events w ON w.source_message_id=d.source_message_id
       WHERE d.status IN ('waiting_for_permalink','waiting_for_carousel_auth','carousel_resolution_failed')
       ORDER BY d.created_at DESC LIMIT 1`,
    ).first<{ source_message_id: string; sender_id: string; input_text: string | null; raw_json: string }>();
    let acceptanceTest: Record<string, unknown> | null = null;
    if (pending) {
      let raw: unknown = null;
      try { raw = JSON.parse(pending.raw_json); } catch { raw = null; }
      acceptanceTest = await enqueueCarouselResolution(env, {
        senderId: pending.sender_id,
        sourceMessageId: pending.source_message_id,
        raw,
        instructions: pending.input_text || "",
      });
    }
    return json({ ok: true, connected_at: connectedAt, acceptance_test: acceptanceTest });
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function handleReelLibraryStatus(request: Request, env: Env): Promise<Response> {
  if (!env.REEL_LIBRARY_SHARED_TOKEN || !timingSafeEqual(bearer(request), env.REEL_LIBRARY_SHARED_TOKEN)) {
    return json({ error: "Unauthorised" }, { status: 401 });
  }
  const probe = new URL(request.url).searchParams.get("probe") === "1";
  const [jobCounts, totals, failureTotals, recentJobs, recentCommands, recentOutbound, emojiRows, tokenAggregate, processingAggregate, legacyTokenJobs, browserConnectedRow, recentCarouselResolutions, codexAuthRow, latestCodexAuthFailure] = await Promise.all([
    env.REEL_DB.prepare("SELECT status, COUNT(*) AS count FROM jobs GROUP BY status ORDER BY status").all(),
    env.REEL_DB.prepare("SELECT (SELECT COUNT(*) FROM jobs) AS jobs, (SELECT COUNT(*) FROM resources) AS resources, (SELECT COUNT(*) FROM notes) AS notes, (SELECT COUNT(*) FROM dm_commands) AS commands, (SELECT COUNT(*) FROM outbound_events WHERE status='failed') AS outbound_failures").first(),
    env.REEL_DB.prepare(`SELECT
      SUM(CASE WHEN f.status='failed' AND NOT EXISTS(SELECT 1 FROM jobs c WHERE c.status='complete' AND c.shortcode=f.shortcode) THEN 1 ELSE 0 END) AS active_failed,
      SUM(CASE WHEN f.status='failed' AND EXISTS(SELECT 1 FROM jobs c WHERE c.status='complete' AND c.shortcode=f.shortcode) THEN 1 ELSE 0 END) AS superseded_failed
      FROM jobs f`).first<{ active_failed: number; superseded_failed: number }>(),
    env.REEL_DB.prepare("SELECT id,title,author_username,status,stage,status_emoji,error_code,SUBSTR(error_message,1,320) AS error_message,created_at,completed_at,updated_at,processing_seconds,codex_input_tokens,codex_cached_input_tokens,codex_output_tokens,codex_reasoning_output_tokens,codex_total_tokens,synthesis_json_key FROM jobs ORDER BY created_at DESC LIMIT 8").all<JobRow>(),
    env.REEL_DB.prepare("SELECT id,intent,status,result_job_id,error,is_test,created_at,completed_at FROM dm_commands ORDER BY created_at DESC LIMIT 10").all(),
    env.REEL_DB.prepare("SELECT kind,stage,display_emoji,reaction,status,http_status,error,created_at FROM outbound_events ORDER BY created_at DESC LIMIT 12").all(),
    env.REEL_DB.prepare("SELECT key,value,updated_at FROM settings WHERE key LIKE 'emoji.%' ORDER BY key").all(),
    env.REEL_DB.prepare("SELECT COUNT(codex_total_tokens) AS measured_jobs, COALESCE(SUM(codex_total_tokens),0) AS total_tokens FROM jobs WHERE status='complete'").first<{ measured_jobs: number; total_tokens: number }>(),
    env.REEL_DB.prepare("SELECT COUNT(processing_seconds) AS measured_jobs, COALESCE(SUM(processing_seconds),0) AS total_seconds FROM jobs WHERE status='complete'").first<{ measured_jobs: number; total_seconds: number }>(),
    env.REEL_DB.prepare("SELECT id,synthesis_json_key FROM jobs WHERE status='complete' AND codex_total_tokens IS NULL AND synthesis_json_key IS NOT NULL ORDER BY completed_at DESC LIMIT 50").all<JobRow>(),
    env.REEL_DB.prepare("SELECT value,updated_at FROM settings WHERE key='instagram.browser.connected_at'").first<{ value: string; updated_at: string }>(),
    env.REEL_DB.prepare("SELECT source_message_id,media_id,title,status,source_url,resolution_method,attempts,error,created_at,updated_at FROM instagram_carousel_resolutions ORDER BY created_at DESC LIMIT 8").all(),
    env.REEL_DB.prepare("SELECT updated_at FROM runtime_secrets WHERE name='codex_auth'").first<{ updated_at: string }>(),
    env.REEL_DB.prepare(`SELECT updated_at FROM jobs
      WHERE status='failed' AND error_code='error_research' AND (
        INSTR(LOWER(COALESCE(error_message,'')),'refresh token was already used')>0 OR
        INSTR(LOWER(COALESCE(error_message,'')),'token_expired')>0 OR
        INSTR(LOWER(COALESCE(error_message,'')),'authentication token is invalid')>0 OR
        INSTR(LOWER(COALESCE(error_message,'')),'failed to refresh token')>0 OR
        INSTR(LOWER(COALESCE(error_message,'')),'log in again')>0
      ) ORDER BY updated_at DESC LIMIT 1`).first<{ updated_at: string }>(),
  ]);
  const legacyUsage = await Promise.all(legacyTokenJobs.results.map((job) => loadJobTokenUsage(env, job)));
  const legacyTotals = legacyUsage.map((usage) => usage.total_tokens).filter((value): value is number => value !== null);
  const measuredJobs = Number(tokenAggregate?.measured_jobs || 0) + legacyTotals.length;
  const measuredTotalTokens = Number(tokenAggregate?.total_tokens || 0) + legacyTotals.reduce((sum, value) => sum + value, 0);
  const recentJobsWithUsage = await Promise.all(recentJobs.results.map(async (job) => ({ ...job, token_usage: await loadJobTokenUsage(env, job) })));
  const lastArchived = await env.REEL_DB.prepare("SELECT original_video_key FROM jobs WHERE original_video_key IS NOT NULL ORDER BY completed_at DESC LIMIT 1")
    .first<{ original_video_key: string }>();
  const [codexAuth, instagramBrowserCookies, archiveHead] = await Promise.all([
    loadPersistedCodexAuth(env).catch(() => null),
    loadInstagramBrowserCookies(env).catch(() => null),
    lastArchived?.original_video_key ? env.REEL_ARCHIVE.head(lastArchived.original_video_key).catch(() => null) : Promise.resolve(null),
  ]);
  const availableCodexAuth = codexAuth || env.CODEX_AUTH_JSON || "";
  let codexCheck: { ok: boolean; detail: string; live_probe_run: boolean; authenticated?: boolean | null; available?: boolean };
  if (!availableCodexAuth) {
    codexCheck = { ok: false, detail: "Codex auth is unavailable", live_probe_run: probe, authenticated: false, available: false };
  } else if (probe) {
    try {
      const result = await runCodexAuthProbe(env, availableCodexAuth);
      codexCheck = { ...result, live_probe_run: true };
    } catch (error) {
      codexCheck = { ok: false, detail: error instanceof Error ? error.message.slice(0, 500) : "Codex authentication probe failed", live_probe_run: true, authenticated: null, available: false };
    }
  } else {
    const authUpdated = databaseTimestampMs(codexAuthRow?.updated_at);
    const failedAt = databaseTimestampMs(latestCodexAuthFailure?.updated_at);
    const knownInvalid = authUpdated !== null && failedAt !== null && failedAt > authUpdated;
    codexCheck = knownInvalid
      ? { ok: false, detail: "Stored Codex authentication failed after its last refresh; run live checks or reconnect", live_probe_run: false, authenticated: false, available: false }
      : { ok: true, detail: "Encrypted Codex auth is available; run live checks to validate it", live_probe_run: false, authenticated: null, available: true };
  }
  const instagram: Record<string, unknown> = {
    configured: Boolean(env.INSTAGRAM_ACCESS_TOKEN && env.INSTAGRAM_USER_ID),
    user_id_configured: Boolean(env.INSTAGRAM_USER_ID),
    live_probe_run: probe,
  };
  if (probe && env.INSTAGRAM_ACCESS_TOKEN && env.INSTAGRAM_USER_ID) {
    try {
      const version = env.INSTAGRAM_GRAPH_VERSION || "v24.0";
      const response = await fetch(`https://graph.instagram.com/${version}/${env.INSTAGRAM_USER_ID}?fields=id,username`, {
        headers: { authorization: `Bearer ${env.INSTAGRAM_ACCESS_TOKEN}` },
      });
      const payload: Record<string, unknown> = await response.json<Record<string, unknown>>().catch(() => ({}));
      instagram.ok = response.ok;
      instagram.http_status = response.status;
      instagram.username = response.ok ? payload.username || null : null;
      instagram.error = response.ok ? null : String((payload.error as { message?: unknown } | undefined)?.message || "Instagram probe failed").slice(0, 300);
    } catch (error) {
      instagram.ok = false;
      instagram.error = error instanceof Error ? error.message.slice(0, 300) : "Instagram probe failed";
    }
  }
  const backlogProcessing = await backlogProcessingActive(env);
  const authority = await phase6Authority(env);
  return json({
    ok: true,
    generated_at: new Date().toISOString(),
    service: { name: "Instagram Reel Brain", ingest_mode: env.INGEST_MODE || "disabled", backlog_processing: backlogProcessing, processing_authority: authority.mode, authority_generation: authority.generation, model: env.CODEX_RESEARCH_MODEL || "gpt-5.6-luna", reasoning: env.CODEX_RESEARCH_REASONING_EFFORT || "medium" },
    checks: {
      worker: { ok: true, detail: "Worker request completed" },
      database: { ok: true, detail: "D1 queries completed" },
      archive: { ok: Boolean(archiveHead), detail: archiveHead ? `Latest archived object available (${archiveHead.size} bytes)` : "No archived object verified" },
      library: { ok: Boolean(env.REEL_LIBRARY_KV), detail: env.REEL_LIBRARY_KV ? "Reel Library KV is bound" : "Reel Library KV binding is missing" },
      codex: codexCheck,
      carousel_resolver: {
        ok: Boolean(env.BROWSER && instagramBrowserCookies),
        detail: instagramBrowserCookies
          ? `Authenticated cloud carousel resolver connected${browserConnectedRow?.value ? ` ${browserConnectedRow.value}` : ""}`
          : env.BROWSER ? "One-time Instagram browser connection is required" : "Cloudflare Browser Run binding is missing",
      },
      instagram,
    },
    totals: { ...(totals || {}), active_failed: Number(failureTotals?.active_failed || 0), superseded_failed: Number(failureTotals?.superseded_failed || 0) },
    token_usage: {
      measured_jobs: measuredJobs,
      total_tokens: measuredTotalTokens,
      average_total_tokens: measuredJobs ? Math.round(measuredTotalTokens / measuredJobs) : null,
      legacy_jobs_checked: legacyTokenJobs.results.length,
    },
    processing_time: {
      measured_jobs: Number(processingAggregate?.measured_jobs || 0),
      total_seconds: Math.round(Number(processingAggregate?.total_seconds || 0)),
      average_seconds: Number(processingAggregate?.measured_jobs || 0)
        ? Math.round(Number(processingAggregate?.total_seconds || 0) / Number(processingAggregate?.measured_jobs || 0))
        : null,
    },
    jobs_by_status: jobCounts.results,
    recent_jobs: recentJobsWithUsage,
    recent_commands: recentCommands.results,
    recent_outbound: recentOutbound.results,
    carousel_resolver: {
      configured: Boolean(env.BROWSER),
      connected: Boolean(instagramBrowserCookies),
      connected_at: browserConnectedRow?.value || null,
      recent: recentCarouselResolutions.results,
    },
    emojis: emojiRows.results.map((row) => {
      try { return { key: row.key, value: JSON.parse(String(row.value)), updated_at: row.updated_at }; }
      catch { return { key: row.key, value: row.value, updated_at: row.updated_at }; }
    }),
  });
}

async function handleReelLibrarySelfTest(request: Request, env: Env): Promise<Response> {
  if (!env.REEL_LIBRARY_SHARED_TOKEN || !timingSafeEqual(bearer(request), env.REEL_LIBRARY_SHARED_TOKEN)) {
    return json({ error: "Unauthorised" }, { status: 401 });
  }
  const tests: Array<{ name: string; ok: boolean; detail: string }> = [];
  const callIntake = async (text: string, sourceMessageId: string) => {
    const internal = new Request("https://worker.internal/api/intake", {
      method: "POST",
      headers: { authorization: `Bearer ${env.ADMIN_TOKEN || ""}`, "content-type": "application/json" },
      body: JSON.stringify({ text, source_message_id: sourceMessageId, sender_id: "automated-self-test", test: true }),
    });
    const response = await handleNormalizedIntake(internal, env);
    const payload: Record<string, unknown> = await response.json<Record<string, unknown>>().catch(() => ({}));
    return { response, payload };
  };
  const marker = `selftest-${uuid()}`;
  try {
    const note = await callIntake("note: automated Reel Brain health check", `${marker}-note`);
    const noteId = typeof note.payload.id === "string" ? note.payload.id : "";
    tests.push({ name: "note command", ok: note.response.ok && note.payload.command === "note_saved" && Boolean(noteId), detail: noteId ? "Note was parsed, stored, and selected for cleanup" : "Note was not stored" });
    if (noteId) await env.REEL_DB.prepare("DELETE FROM notes WHERE id=? AND sender_id='automated-self-test'").bind(noteId).run();
  } catch (error) {
    tests.push({ name: "note command", ok: false, detail: error instanceof Error ? error.message.slice(0, 200) : "Note test failed" });
  }
  try {
    const retrieval = await callIntake("send me the video about the robot arm that mentions MoveIt OpenXR PyBullet", `${marker}-retrieval`);
    const matches = Array.isArray(retrieval.payload.matches) ? retrieval.payload.matches as Array<{ id?: string }> : [];
    tests.push({ name: "Reel retrieval", ok: retrieval.response.ok && matches.length > 0, detail: matches.length ? `Matched completed Reel ${matches[0].id}` : "No completed Reel matched the test description" });
  } catch (error) {
    tests.push({ name: "Reel retrieval", ok: false, detail: error instanceof Error ? error.message.slice(0, 200) : "Retrieval test failed" });
  }
  try {
    const status = await callIntake("system status", `${marker}-status`);
    tests.push({ name: "status command", ok: status.response.ok && status.payload.command === "status" && typeof status.payload.backlog_processing === "boolean", detail: `Mode ${String(status.payload.ingest_mode || "unknown")}; backlog processing is ${status.payload.backlog_processing ? "active" : "idle"}` });
  } catch (error) {
    tests.push({ name: "status command", ok: false, detail: error instanceof Error ? error.message.slice(0, 200) : "Status test failed" });
  }
  const completeEmoji = await getEmoji(env, "complete");
  const synthesisEmoji = await getEmoji(env, "synthesizing");
  tests.push({
    name: "reaction policy",
    ok: Boolean(completeEmoji.reaction === "✅" && synthesisEmoji.reaction === "💬" && shouldReactToStage("queued") && shouldReactToStage("synthesizing") && shouldReactToStage("complete") && shouldReactToStage("error_research")),
    detail: `Instagram outbound reactions use UTF-8 emoji; synthesising maps to ${synthesisEmoji.reaction} and complete maps to ${completeEmoji.reaction}`,
  });
  const originalDelivery = parseMessageCommand("send me the Reel about OpenXR");
  const backupDelivery = parseMessageCommand("send me the archived video file about OpenXR");
  tests.push({
    name: "retrieval delivery policy",
    ok: originalDelivery.intent === "retrieval" && originalDelivery.delivery === "reel" && backupDelivery.intent === "retrieval" && backupDelivery.delivery === "video_file",
    detail: "Original Reel is primary; archived MP4 requires an explicit file/unavailable request",
  });
  const commandId = uuid();
  try {
    await env.REEL_DB.prepare("INSERT INTO dm_commands(id,sender_id,source_message_id,intent,input_text,status,is_test,completed_at) VALUES (?,?,?,?,?,'complete',1,CURRENT_TIMESTAMP)")
      .bind(commandId, "automated-self-test", `${marker}-audit`, "status", "system status").run();
    const stored = await env.REEL_DB.prepare("SELECT id FROM dm_commands WHERE id=? AND is_test=1").bind(commandId).first<{ id: string }>();
    tests.push({ name: "command audit", ok: stored?.id === commandId, detail: stored ? "Command audit record round-trip passed" : "Command audit record could not be read" });
  } catch (error) {
    tests.push({ name: "command audit", ok: false, detail: error instanceof Error ? error.message.slice(0, 200) : "Command audit test failed" });
  } finally {
    await env.REEL_DB.prepare("DELETE FROM dm_commands WHERE id=? AND is_test=1").bind(commandId).run().catch(() => undefined);
  }
  return json({ ok: tests.every((test) => test.ok), generated_at: new Date().toISOString(), tests, cleanup: "Temporary note and command records removed; Reel backlog untouched" }, { status: tests.every((test) => test.ok) ? 200 : 503 });
}

function containerEnv(env: Env): Record<string, string> {
  return {
    CODEX_HOME: "/home/codex/.codex",
    CODEX_RESEARCH_MODEL: env.CODEX_RESEARCH_MODEL || "gpt-5.6-luna",
    CODEX_RESEARCH_REASONING_EFFORT: env.CODEX_RESEARCH_REASONING_EFFORT || "medium",
  };
}

type ResumeArtifact = { kind: string; filename: string; url: string };

async function researchResumeManifest(env: Env, job: JobRow): Promise<ResumeArtifact[] | null> {
  if (job.error_code !== "error_research" || !job.transcript_key || !job.original_video_key || !env.PUBLIC_BASE_URL) return null;
  const rows = await env.REEL_DB.prepare(
    "SELECT id,kind,object_key FROM artifacts WHERE job_id=? AND kind IN ('metadata','comments','transcript','frame') ORDER BY created_at",
  ).bind(job.id).all<{ id: string; kind: string; object_key: string }>();
  const hasMetadata = rows.results.some((row) => row.kind === "metadata" && row.object_key.endsWith("/metadata.json"));
  const hasTranscript = rows.results.some((row) => row.kind === "transcript");
  const hasFrame = rows.results.some((row) => row.kind === "frame");
  if (!hasMetadata || !hasTranscript || !hasFrame) return null;
  return rows.results.map((row) => ({
    kind: row.kind,
    filename: row.object_key.split("/").pop() || `${row.kind}.bin`,
    url: `${env.PUBLIC_BASE_URL!.replace(/\/$/, "")}/internal/jobs/${encodeURIComponent(job.id)}/artifacts/${encodeURIComponent(row.id)}`,
  }));
}

function retryDelayForFailure(code: string, detail: string, previousAttempts: number): number {
  const lowered = detail.toLowerCase();
  if (code === "error_research" && (lowered.includes("selected model is at capacity") || lowered.includes("model is at capacity"))) {
    return Math.min(3600, 300 * (2 ** Math.max(0, previousAttempts)));
  }
  if (code === "error_research" && ["refresh token was already used", "token_expired", "authentication token is invalid", "failed to refresh token", "log in again"].some((marker) => lowered.includes(marker))) {
    return 900;
  }
  if (code === "error_download") return 120;
  return 30;
}

async function runCodexAuthProbe(env: Env, authJson: string): Promise<{ ok: boolean; authenticated: boolean | null; available: boolean; detail: string }> {
  const container = getContainer(env.REEL_CONTAINER, "reel-serial");
  await container.startAndWaitForPorts(undefined, undefined, { envVars: containerEnv(env) });
  const response = await container.fetch(new Request("https://container.local/codex-auth-probe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ codex_auth_json: authJson, model: env.CODEX_RESEARCH_MODEL || "gpt-5.6-luna" }),
  }));
  type ProbeResult = { ok?: boolean; authenticated?: boolean | null; available?: boolean; detail?: string; auth_json?: string };
  const result: ProbeResult = await response.json<ProbeResult>().catch(() => ({} as ProbeResult));
  await persistCodexAuth(env, result.auth_json).catch((error) => console.error("Could not persist auth probe credential", error));
  return {
    ok: response.ok && result.ok === true,
    authenticated: typeof result.authenticated === "boolean" ? result.authenticated : null,
    available: result.available === true,
    detail: result.detail || `Codex authentication probe returned HTTP ${response.status}`,
  };
}

async function processJob(env: Env, jobId: string): Promise<void> {
  const job = await env.REEL_DB.prepare("SELECT * FROM jobs WHERE id = ?").bind(jobId).first<JobRow>();
  if (!job || job.status === "complete") return;
  const authority = await phase6Authority(env);
  if (!phase6AuthorityAllowsCloudClaims(authority)) {
    await auditPhase6CloudAuthoritySkip(env, job, authority);
    return;
  }
  const phase5Fence = await activePhase5FenceForJob(env, job.id);
  if (phase5Fence) {
    await auditPhase5CloudFenceSkip(env, job, phase5Fence);
    return;
  }
  // Queue delivery, including its configured delayed retries, is the authority for
  // attempt limits. Returning here would silently acknowledge the final retry of
  // an older administratively recovered job before it had another processing run.
  const archiveOnly = job.error_code === "rearchive_only";
  const resumeArtifacts = archiveOnly ? null : await researchResumeManifest(env, job);
  const uploadToken = randomToken();
  const tokenHash = await sha256(uploadToken);
  const expires = new Date(Date.now() + 20 * 60_000).toISOString();
  await env.REEL_DB.prepare(
    "UPDATE jobs SET status='running', stage=?, attempts=attempts+1, started_at=COALESCE(started_at,CURRENT_TIMESTAMP), upload_token_hash=?, upload_token_expires_at=?, error_code=NULL, error_message=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?",
  ).bind(resumeArtifacts ? "synthesizing" : "downloading", tokenHash, expires, job.id).run();
  if (resumeArtifacts) await setStage(env, job, "synthesizing", "running", "Research-only retry using retained artifacts");
  else await setStage(env, job, "downloading", "running");
  const container = getContainer(env.REEL_CONTAINER, "reel-serial");
  const persistedAuth = await loadPersistedCodexAuth(env).catch(() => null);
  const instagramBrowserCookies = await loadInstagramBrowserCookies(env).catch(() => null);
  await container.startAndWaitForPorts(undefined, undefined, { envVars: containerEnv(env) });
  const response = await container.fetch(new Request("https://container.local/process", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      job_id: job.id,
      source_url: job.canonical_url || job.source_url,
      instructions: job.instructions || "",
      callback_base_url: env.PUBLIC_BASE_URL,
      callback_token: uploadToken,
      codex_auth_json: persistedAuth || env.CODEX_AUTH_JSON || "",
      instagram_cookies_json: instagramBrowserCookies ? JSON.stringify(instagramBrowserCookies) : "",
      instagram_media_json: job.source_media_json || "",
      archive_only: archiveOnly,
      resume_research: Boolean(resumeArtifacts),
      resume_artifacts: resumeArtifacts || [],
      timeout_seconds: 600,
    }),
  }));
  const result: { ok?: boolean; error?: string; error_code?: string; auth_json?: string; archive_only?: boolean } = await response
    .json<{ ok?: boolean; error?: string; error_code?: string; auth_json?: string; archive_only?: boolean }>()
    .catch(() => ({}));
  await persistCodexAuth(env, result.auth_json).catch((error) => console.error("Could not persist refreshed Codex auth", error));
  if (!response.ok || !result.ok) {
    const code = result.error_code || "error_unknown";
    await env.REEL_DB.prepare(
      "UPDATE jobs SET status='failed', stage=?, error_code=?, error_message=?, upload_token_hash=NULL, upload_token_expires_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?",
    ).bind(code, code, result.error || `Container HTTP ${response.status}`, job.id).run();
    await setStage(env, job, code, "failed", result.error || `Container HTTP ${response.status}`);
    if (job.pilot_run_id) await pilotRunSummary(env, job.pilot_run_id).catch((error) => console.error("Could not refresh pilot status", error));
    const detail = result.error || `Reel processing failed with HTTP ${response.status}`;
    throw new JobProcessingError(detail, code, retryDelayForFailure(code, detail, job.attempts));
  }
  if (archiveOnly && result.archive_only) {
    const refreshed = await env.REEL_DB.prepare("SELECT * FROM jobs WHERE id=?").bind(job.id).first<JobRow>();
    const object = job.synthesis_json_key ? await env.REEL_ARCHIVE.get(job.synthesis_json_key) : null;
    const payload = object ? await object.json<SynthesisPayload>().catch(() => null) : null;
    if (!refreshed || !payload?.metadata?.title || !Array.isArray(payload.resources)) {
      throw new JobProcessingError("Stored synthesis is unavailable after archive-only refresh", "error_archive", 30);
    }
    payload.resources = await enrichSynthesisResourceMedia(payload.resources);
    await env.REEL_ARCHIVE.put(job.synthesis_json_key!, JSON.stringify(payload, null, 2), { httpMetadata: { contentType: "application/json" } });
    await publishSynthesisHtml(env, refreshed, payload);
    await env.REEL_DB.prepare(
      "UPDATE jobs SET status='complete',stage='complete',error_code=NULL,error_message=NULL,upload_token_hash=NULL,upload_token_expires_at=NULL,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    ).bind(job.id).run();
    await setStage(env, job, "complete", "complete", "High-resolution archive refreshed without Codex");
  }
  if (job.pilot_run_id) await pilotRunSummary(env, job.pilot_run_id).catch((error) => console.error("Could not refresh pilot status", error));
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/phase4/mirror/")) return handlePhase4Mirror(request, env);
  if (url.pathname.startsWith("/api/phase7/origin/")) {
    if (request.method !== "GET") return json({ error: "Method not allowed" }, { status: 405 });
    if (!env.PHASE7_ORIGIN_TOKEN || !timingSafeEqual(bearer(request), env.PHASE7_ORIGIN_TOKEN)) {
      return json({ error: "Unauthorised" }, { status: 401 });
    }
    if (!env.REEL_ORIGIN) return json({ error: "Private Reel origin unavailable" }, { status: 503 });
    const suffix = url.pathname.slice("/api/phase7/origin".length);
    const upstream = new Request(`http://caddy:8080/api/reel-origin${suffix}${url.search}`, request);
    try {
      return await env.REEL_ORIGIN.fetch(upstream);
    } catch {
      return json({ error: "Private Reel origin unavailable" }, { status: 503 });
    }
  }
  if (url.pathname.startsWith("/api/phase7/library/")) {
    if (request.method !== "GET") return json({ error: "Method not allowed" }, { status: 405 });
    if (!env.PHASE7_ORIGIN_TOKEN || !timingSafeEqual(bearer(request), env.PHASE7_ORIGIN_TOKEN)) {
      return json({ error: "Unauthorised" }, { status: 401 });
    }
    if (!env.REEL_LIBRARY_KV) return json({ error: "Reel Library KV unavailable" }, { status: 503 });
    if (url.pathname === "/api/phase7/library/manifest") {
      const manifest = await env.REEL_LIBRARY_KV.get(REEL_LIBRARY_MANIFEST_KEY, "json");
      return json({ ok: true, ...(manifest && typeof manifest === "object" ? manifest as Record<string, unknown> : { generated_at: "", file_count: 0, files: [] }) });
    }
    if (url.pathname === "/api/phase7/library/file") {
      const path = String(url.searchParams.get("path") || "").replace(/\\/g, "/").replace(/^\/+/, "");
      if (!path.endsWith(".html") || path.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
        return json({ error: "Invalid library path" }, { status: 400 });
      }
      const stored = await env.REEL_LIBRARY_KV.getWithMetadata(`${REEL_LIBRARY_FILE_PREFIX}${toBase64Url(path)}`, "arrayBuffer");
      if (stored.value === null) return json({ error: "Not found" }, { status: 404 });
      const metadata = (stored.metadata || {}) as Record<string, unknown>;
      return new Response(stored.value, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-length": String(stored.value.byteLength),
          "x-content-sha256": String(metadata.sha256 || await sha256(stored.value)),
          "cache-control": "no-store",
        },
      });
    }
    return json({ error: "Not found" }, { status: 404 });
  }
  if (url.pathname === "/api/phase7/object") {
    if (request.method !== "GET") return json({ error: "Method not allowed" }, { status: 405 });
    if (!env.PHASE7_ORIGIN_TOKEN || !timingSafeEqual(bearer(request), env.PHASE7_ORIGIN_TOKEN)) {
      return json({ error: "Unauthorised" }, { status: 401 });
    }
    const key = String(url.searchParams.get("key") || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!key || key.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
      return json({ error: "Invalid object key" }, { status: 400 });
    }
    const stored = await env.REEL_ARCHIVE.get(key);
    if (!stored) return json({ error: "Not found" }, { status: 404 });
    const headers = new Headers();
    stored.writeHttpMetadata(headers);
    headers.set("content-length", String(stored.size));
    headers.set("etag", stored.httpEtag);
    headers.set("cache-control", "private, no-store");
    return new Response(stored.body, { headers });
  }
  if (url.pathname === "/api/test/jobs" && request.method === "POST") return handleTestCreate(request, env);
  if (url.pathname === "/api/intake" && request.method === "POST") return handleNormalizedIntake(request, env);
  if (url.pathname.startsWith("/api/admin/phase6/")) {
    const phase6Unauthorized = requirePhase5Control(request, env);
    if (phase6Unauthorized) return phase6Unauthorized;
    if (url.pathname === "/api/admin/phase6/authority" && request.method === "GET") return handlePhase6AuthorityState(env);
    if (url.pathname === "/api/admin/phase6/authority/transition" && request.method === "POST") return handlePhase6AuthorityChange(request, env, "transition");
    if (url.pathname === "/api/admin/phase6/authority/local" && request.method === "POST") return handlePhase6AuthorityChange(request, env, "self_hosted");
    if (url.pathname === "/api/admin/phase6/authority/cloud" && request.method === "POST") return handlePhase6AuthorityChange(request, env, "cloud");
    if (url.pathname === "/api/admin/phase6/next" && request.method === "GET") return handlePhase6Next(request, env);
    if (url.pathname === "/api/admin/phase6/prefetch-next" && request.method === "GET") return handlePhase6PrefetchNext(request, env);
    if (url.pathname === "/api/admin/phase6/claim" && request.method === "POST") return handlePhase6Claim(request, env);
    if (url.pathname === "/api/admin/phase6/release" && request.method === "POST") return handlePhase6Claim(request, env, true);
    if (url.pathname === "/api/admin/phase6/retry" && request.method === "POST") return handlePhase6Retry(request, env);
    if (url.pathname === "/api/admin/phase6/fail" && request.method === "POST") return handlePhase6TerminalFailure(request, env);
    return json({ error: "Not found" }, { status: 404 });
  }
  if (url.pathname.startsWith("/api/admin/phase5/local-pilot/")) {
    const phase5Unauthorized = requirePhase5Control(request, env);
    if (phase5Unauthorized) return phase5Unauthorized;
    if (url.pathname === "/api/admin/phase5/local-pilot/arm-next-reel" && request.method === "POST") return handlePhase5PreintakeArm(request, env, "reel");
    if (url.pathname === "/api/admin/phase5/local-pilot/arm-next-carousel" && request.method === "POST") return handlePhase5PreintakeArm(request, env, "carousel");
    if (url.pathname === "/api/admin/phase5/local-pilot/cancel-arm" && request.method === "POST") return handlePhase5PreintakeCancel(request, env);
    if (url.pathname === "/api/admin/phase5/local-pilot/fence" && request.method === "POST") return handlePhase5Fence(request, env);
    if (url.pathname === "/api/admin/phase5/local-pilot/renew" && request.method === "POST") return handlePhase5RenewLease(request, env);
    if (url.pathname === "/api/admin/phase5/local-pilot/rollback" && request.method === "POST") return handlePhase5Rollback(request, env);
    if (url.pathname === "/api/admin/phase5/local-pilot/start" && request.method === "POST") return handlePhase5StartLocalProcessing(request, env);
    if (url.pathname === "/api/admin/phase5/local-pilot/finalize" && request.method === "POST") return handlePhase5FinalizeLocalProcessing(request, env);
    if (url.pathname === "/api/admin/phase5/local-pilot/abort" && request.method === "POST") return handlePhase5AbortLocalProcessing(request, env);
    return json({ error: "Not found" }, { status: 404 });
  }
  if (url.pathname.startsWith("/api/admin/retrieval/")) {
    const retrievalUnauthorized = requirePhase5Control(request, env);
    if (retrievalUnauthorized) return retrievalUnauthorized;
    if (url.pathname === "/api/admin/retrieval/reindex" && request.method === "POST") {
      return handleRetrievalReindex(request, env);
    }
    if (url.pathname === "/api/admin/retrieval/status" && request.method === "GET") {
      return handleRetrievalIndexStatus(env);
    }
    if (url.pathname === "/api/admin/retrieval/search" && request.method === "GET") {
      return handleSearchQuery(env, url.searchParams.get("q") || "", Number(url.searchParams.get("limit") || 10));
    }
    return json({ error: "Not found" }, { status: 404 });
  }
  if (url.pathname === "/api/admin/reel-library/backfill-lists") {
    const libraryUnauthorized = requirePhase5Control(request, env);
    if (libraryUnauthorized) return libraryUnauthorized;
    if (request.method === "POST") return handleListBackfill(request, env);
    return json({ error: "Method not allowed" }, { status: 405 });
  }
  const unauthorized = requireAdmin(request, env);
  if (unauthorized) return unauthorized;

  if (url.pathname === "/api/search" && request.method === "GET") {
    return handleSearchQuery(env, url.searchParams.get("q") || "", Number(url.searchParams.get("limit") || 10));
  }
  if (url.pathname === "/api/settings/emojis" && request.method === "GET") {
    const rows = await env.REEL_DB.prepare("SELECT key, value, updated_at FROM settings WHERE key LIKE 'emoji.%' ORDER BY key").all();
    return json({ ok: true, settings: rows.results.map((row) => ({ ...row, value: JSON.parse(String(row.value)) })) });
  }
  if (url.pathname === "/api/container/recycle" && request.method === "POST") {
    await Promise.all(
      Array.from({ length: 4 }, (_, slot) => getContainer(env.REEL_CONTAINER, `reel-${slot}`).destroy().catch(() => undefined)),
    );
    return json({ ok: true, recycled: 4 });
  }
  if (url.pathname === "/api/backlog/pilot" && request.method === "POST") return handleBacklogPilot(request, env);
  if (url.pathname === "/api/backlog/pilot" && request.method === "GET") return handlePilotStatus(request, env);
  if (url.pathname === "/api/backlog/pilot/reprocess" && request.method === "POST") return handlePilotReprocess(request, env);
  if (url.pathname === "/api/backlog/pilot/rearchive" && request.method === "POST") return handlePilotRearchive(request, env);
  if (url.pathname === "/api/admin/media-enrich" && request.method === "POST") return handleMediaEnrich(request, env);
  if (url.pathname === "/api/admin/instagram-confirm-live" && request.method === "POST") return handleConfirmLiveMode(env);
  if (url.pathname === "/api/admin/instagram-pilot-summary" && request.method === "POST") return handlePilotSummaryDm(request, env);
  if (url.pathname === "/api/admin/instagram-recover-message" && request.method === "POST") return handleRecoverInstagramMessage(request, env);
  if (url.pathname === "/api/settings/emoji" && request.method === "POST") {
    const input = await readJson<{ stage?: string; display?: string; reaction?: InstagramReaction }>(request);
    if (!input.stage || !input.display || !input.reaction || !isValidInstagramReaction(input.reaction)) {
      return json({ error: "stage, display and a compact UTF-8 reaction are required" }, { status: 400 });
    }
    await env.REEL_DB.prepare(
      "INSERT INTO settings(key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP",
    ).bind(`emoji.${input.stage}`, JSON.stringify({ display: input.display, reaction: input.reaction })).run();
    return json({ ok: true, stage: input.stage, display: input.display, reaction: input.reaction });
  }
  const publishMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/publish$/);
  if (publishMatch && request.method === "POST") return publishJobToReelLibrary(env, publishMatch[1]);
  const retryMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/retry$/);
  if (retryMatch && request.method === "POST") return handleRetryJob(request, env, retryMatch[1]);
  const correctiveMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/corrective-resynthesis$/);
  if (correctiveMatch && request.method === "POST") return handleCorrectiveResynthesis(request, env, correctiveMatch[1]);
  const legacyPublishMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/publish-markdown$/);
  if (legacyPublishMatch && request.method === "POST") return publishJobToSecondBrain(env, legacyPublishMatch[1]);
  const match = url.pathname.match(/^\/api\/jobs\/([^/]+)(?:\/(markdown|html|video))?$/);
  if (match && request.method === "GET") {
    if (!match[2]) return getJobResponse(env, match[1]);
    const job = await env.REEL_DB.prepare("SELECT markdown_key, html_key, original_video_key FROM jobs WHERE id = ?").bind(match[1]).first<Pick<JobRow, "markdown_key" | "html_key" | "original_video_key">>();
    if (!job) return json({ error: "Not found" }, { status: 404 });
    if (match[2] === "markdown") return streamObject(env, job.markdown_key, `attachment; filename=instagram-reel-${match[1]}.md`);
    if (match[2] === "html") return streamObject(env, job.html_key, `attachment; filename=instagram-reel-${match[1]}.html`);
    return streamObject(env, job.original_video_key, `attachment; filename=instagram-reel-${match[1]}.mp4`);
  }
  return json({ error: "Not found" }, { status: 404 });
}

async function handleInternal(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const dedupe = url.pathname.match(/^\/internal\/jobs\/([^/]+)\/dedupe-check$/);
  if (dedupe && request.method === "POST") return handlePreCodexDedupe(request, env, dedupe[1]);
  const artifact = url.pathname.match(/^\/internal\/jobs\/([^/]+)\/artifacts\/([^/]+)$/);
  if (artifact && request.method === "PUT") return handleArtifactUpload(request, env, artifact[1], artifact[2]);
  if (artifact && request.method === "GET") return handleArtifactDownload(request, env, artifact[1], artifact[2]);
  const stage = url.pathname.match(/^\/internal\/jobs\/([^/]+)\/stage$/);
  if (stage && request.method === "POST") return handleStageCallback(request, env, stage[1]);
  const transcription = url.pathname.match(/^\/internal\/jobs\/([^/]+)\/transcribe$/);
  if (transcription && request.method === "POST") return handleTranscription(request, env, transcription[1]);
  const complete = url.pathname.match(/^\/internal\/jobs\/([^/]+)\/complete$/);
  if (complete && request.method === "POST") return handleComplete(request, env, complete[1]);
  return json({ error: "Not found" }, { status: 404 });
}

export class ReelBrainContainer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  sleepAfter = "15m";
  enableInternet = true;
  pingEndpoint = "health";
  envVars = { CODEX_HOME: "/home/codex/.codex" };
}

async function handleFetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      const authority = await phase6Authority(env);
      return json({
        ok: true,
        service: "cartdotcom-instagram-reel-brain",
        ingest_mode: env.INGEST_MODE || "disabled",
        backlog_processing: await backlogProcessingActive(env),
        processing_authority: authority.mode,
        authority_generation: authority.generation,
        model: env.CODEX_RESEARCH_MODEL || "gpt-5.6-luna",
      });
    }
    if (url.pathname === "/instagram/webhook") return handleInstagramWebhook(request, env);
    if (url.pathname === "/integration/reel-library/status" && request.method === "POST") return handleReelLibraryStatus(request, env);
    if (url.pathname === "/integration/reel-library/instagram-browser/start" && request.method === "POST") return handleInstagramBrowserAuthStart(request, env);
    if (url.pathname === "/integration/reel-library/instagram-browser/complete" && request.method === "POST") return handleInstagramBrowserAuthComplete(request, env);
    if (url.pathname === "/integration/reel-library/self-test" && request.method === "POST") return handleReelLibrarySelfTest(request, env);
    if (url.pathname === "/integration/reel-library/repair-artifacts" && request.method === "POST") return handleReelLibraryArtifactRepair(request, env);
    const libraryMedia = url.pathname.match(/^\/integration\/reel-library\/jobs\/([^/]+)\/(video|audio)$/);
    if (libraryMedia && request.method === "POST") return handleReelLibraryMediaLink(request, env, libraryMedia[1], libraryMedia[2] as "video" | "audio");
    const libraryCarousel = url.pathname.match(/^\/integration\/reel-library\/jobs\/([^/]+)\/carousel$/);
    if (libraryCarousel && request.method === "POST") return handleReelLibraryCarousel(request, env, libraryCarousel[1]);
    const libraryThumbnail = url.pathname.match(/^\/integration\/reel-library\/jobs\/([^/]+)\/thumbnail$/);
    if (libraryThumbnail && request.method === "POST") return handleReelLibraryThumbnail(request, env, libraryThumbnail[1]);
    const download = url.pathname.match(/^\/download\/jobs\/([^/]+)\/(video|audio)$/);
    if (download && request.method === "GET") return handleSignedDownload(request, env, download[1], download[2] as "video" | "audio");
    const carouselDownload = url.pathname.match(/^\/download\/jobs\/([^/]+)\/carousel\/(\d+)$/);
    if (carouselDownload && request.method === "GET") return handleSignedCarouselDownload(request, env, carouselDownload[1], Number(carouselDownload[2]));
    const thumbnailDownload = url.pathname.match(/^\/download\/jobs\/([^/]+)\/thumbnail$/);
    if (thumbnailDownload && request.method === "GET") return handleSignedThumbnailDownload(request, env, thumbnailDownload[1]);
    if (url.pathname.startsWith("/internal/")) return handleInternal(request, env);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env);
    return json({ error: "Not found" }, { status: 404 });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const response = await handleFetch(request, env);
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && response.status < 500) {
      ctx.waitUntil(pushPhase7Wake(request, env).catch((error) => console.error("Phase 7 wake failed", error)));
    }
    return response;
  },

  async queue(batch: MessageBatch<ReelJobMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        if ("type" in message.body && message.body.type === "carousel_resolve") {
          await processCarouselResolution(env, message.body.sourceMessageId);
        } else {
          await processJob(env, (message.body as { jobId: string }).jobId);
        }
        message.ack();
      } catch (error) {
        console.error("Reel queue item failed", "type" in message.body ? message.body.sourceMessageId : message.body.jobId, error);
        message.retry({ delaySeconds: error instanceof JobProcessingError ? error.retryDelaySeconds : 30 });
      }
    }
  },
};
