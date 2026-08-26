export type Phase4MirrorTable =
  | "jobs"
  | "job_events"
  | "artifacts"
  | "resources"
  | "notes"
  | "dm_commands"
  | "outbound_events"
  | "pending_dm_parts"
  | "instagram_carousel_resolutions"
  | "inbound_webhook_events"
  | "retrieval_documents"
  | "retrieval_terms";

export type Phase4Cursor = {
  created_at: string;
  key: string;
};

export type Phase4TableSpec = {
  table: Phase4MirrorTable;
  keyColumn: string;
  cursorExpression: string;
  columns: string[];
  keyExpression?: string;
  extraWhere?: string;
};

export const PHASE4_MAX_LIMIT = 200;
export const PHASE4_DEFAULT_LIMIT = 100;
export const PHASE4_NORMAL_MIN_WATERMARK = "2026-08-21T01:42:46.000Z";
export const PHASE4_REPLAY_WATERMARK = "2026-08-19T04:19:57.000Z";
export const PHASE4_REPLAY_MAX_EXCLUSIVE_WATERMARK = PHASE4_NORMAL_MIN_WATERMARK;

export type Phase4MirrorScope = {
  kind: "live" | "historical_replay";
  minWatermark: string;
  maxExclusiveWatermark?: string;
  completedJobsOnly?: boolean;
};

export const PHASE4_MIRROR_TABLES: Record<Phase4MirrorTable, Phase4TableSpec> = {
  jobs: {
    table: "jobs",
    keyColumn: "id",
    cursorExpression: "updated_at",
    columns: [
      "id", "source_url", "canonical_url", "shortcode", "dedupe_key", "pilot_run_id",
      "sender_id", "source_message_id", "source_media_json", "instructions", "title",
      "author_username", "description", "status", "stage", "attempts", "status_emoji",
      "error_code", "error_message", "original_video_key", "audio_key", "audio_title",
      "audio_artist", "audio_source_url", "audio_identification_method", "audio_confidence",
      "html_key", "library_path", "markdown_key", "transcript_key", "synthesis_json_key",
      "codex_input_tokens", "codex_cached_input_tokens", "codex_output_tokens",
      "codex_reasoning_output_tokens", "codex_total_tokens", "processing_seconds",
      "created_at", "started_at", "completed_at", "updated_at",
    ],
    extraWhere: "datetime(created_at) >= datetime(?)",
  },
  job_events: {
    table: "job_events",
    keyColumn: "id",
    cursorExpression: "created_at",
    columns: ["id", "job_id", "stage", "status", "emoji", "detail", "created_at"],
    extraWhere: "job_id IN (SELECT id FROM jobs WHERE datetime(created_at) >= datetime(?))",
  },
  artifacts: {
    table: "artifacts",
    keyColumn: "id",
    cursorExpression: "created_at",
    columns: ["id", "job_id", "kind", "object_key", "content_type", "byte_size", "sha256", "created_at"],
    extraWhere: "job_id IN (SELECT id FROM jobs WHERE datetime(created_at) >= datetime(?))",
  },
  resources: {
    table: "resources",
    keyColumn: "id",
    cursorExpression: "COALESCE((SELECT updated_at FROM jobs WHERE jobs.id=resources.job_id), created_at)",
    columns: [
      "id", "job_id", "name", "slug", "kind", "canonical_url", "summary", "why_useful",
      "guide_markdown_key", "evidence_json", "created_at", "guide_html_key", "library_path",
      "artifact_type", "canonical_key", "guide_text", "media_json",
    ],
    extraWhere: "job_id IN (SELECT id FROM jobs WHERE datetime(created_at) >= datetime(?))",
  },
  notes: {
    table: "notes",
    keyColumn: "id",
    cursorExpression: "created_at",
    columns: ["id", "sender_id", "body", "source_message_id", "created_at"],
  },
  dm_commands: {
    table: "dm_commands",
    keyColumn: "id",
    cursorExpression: "COALESCE(completed_at, created_at)",
    columns: [
      "id", "sender_id", "source_message_id", "intent", "input_text", "normalized_query",
      "status", "result_job_id", "result_summary", "error", "is_test", "created_at", "completed_at",
    ],
    extraWhere: "datetime(created_at) >= datetime(?)",
  },
  outbound_events: {
    table: "outbound_events",
    keyColumn: "id",
    cursorExpression: "created_at",
    columns: [
      "id", "recipient_id", "source_message_id", "job_id", "kind", "stage", "display_emoji",
      "reaction", "status", "http_status", "error", "created_at",
    ],
  },
  pending_dm_parts: {
    table: "pending_dm_parts",
    keyColumn: "id",
    cursorExpression: "COALESCE(consumed_at, created_at)",
    columns: [
      "id", "sender_id", "source_message_id", "kind", "source_url", "instructions",
      "is_test", "consumed_at", "expires_at", "created_at",
    ],
    extraWhere: "datetime(created_at) >= datetime(?)",
  },
  instagram_carousel_resolutions: {
    table: "instagram_carousel_resolutions",
    keyColumn: "source_message_id",
    cursorExpression: "updated_at",
    columns: [
      "source_message_id", "sender_id", "media_id", "title", "status", "source_url",
      "resolution_method", "attempts", "error", "created_at", "updated_at", "completed_at",
    ],
    extraWhere: "datetime(created_at) >= datetime(?)",
  },
  inbound_webhook_events: {
    table: "inbound_webhook_events",
    keyColumn: "source_message_id",
    cursorExpression: "updated_at",
    columns: [
      "source_message_id", "sender_id", "has_share_attachment", "extracted_urls_json",
      "raw_json", "recovery_json", "recovered_url", "created_at", "updated_at",
    ],
    extraWhere: "datetime(created_at) >= datetime(?)",
  },
  retrieval_documents: {
    table: "retrieval_documents",
    keyColumn: "job_id",
    cursorExpression: "indexed_at",
    columns: [
      "job_id", "document_version", "title_text", "author_text", "description_text",
      "instructions_text", "summary_text", "visual_text", "transcript_text", "comments_text",
      "resource_names_text", "resource_details_text", "claims_text", "content_hash",
      "source_updated_at", "indexed_at",
    ],
    extraWhere: "job_id IN (SELECT id FROM jobs WHERE datetime(created_at) >= datetime(?))",
  },
  retrieval_terms: {
    table: "retrieval_terms",
    keyColumn: "term",
    keyExpression: "job_id || ':' || term",
    cursorExpression: "indexed_at",
    columns: ["job_id", "term", "indexed_at"],
    extraWhere: "job_id IN (SELECT id FROM jobs WHERE datetime(created_at) >= datetime(?))",
  },
};

export function isPhase4MirrorTable(value: string): value is Phase4MirrorTable {
  return Object.prototype.hasOwnProperty.call(PHASE4_MIRROR_TABLES, value);
}

export function phase4MirrorAllowsMethod(method: string): boolean {
  return method.toUpperCase() === "GET";
}

export function constantTimeEqual(left: string, right: string): boolean {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

export function phase4MirrorAuthorized(provided: string, expected: string | undefined): boolean {
  return Boolean(expected) && constantTimeEqual(provided, expected || "");
}

export function phase4MirrorScopeForToken(provided: string, liveToken: string | undefined, replayToken?: string | undefined): Phase4MirrorScope | null {
  if (phase4MirrorAuthorized(provided, liveToken)) {
    return { kind: "live", minWatermark: PHASE4_NORMAL_MIN_WATERMARK };
  }
  if (replayToken && phase4MirrorAuthorized(provided, replayToken)) {
    return {
      kind: "historical_replay",
      minWatermark: PHASE4_REPLAY_WATERMARK,
      maxExclusiveWatermark: PHASE4_REPLAY_MAX_EXCLUSIVE_WATERMARK,
      completedJobsOnly: true,
    };
  }
  return null;
}

export function phase4WatermarkAllowed(scope: Phase4MirrorScope, requestedWatermark: string): boolean {
  if (scope.kind === "historical_replay") {
    return Date.parse(requestedWatermark) === Date.parse(scope.minWatermark);
  }
  return Date.parse(requestedWatermark) >= Date.parse(scope.minWatermark);
}

export function parsePhase4Limit(raw: string | null | undefined): number {
  const value = Number(raw || PHASE4_DEFAULT_LIMIT);
  if (!Number.isFinite(value)) return PHASE4_DEFAULT_LIMIT;
  return Math.max(1, Math.min(Math.trunc(value), PHASE4_MAX_LIMIT));
}

export function parsePhase4Watermark(raw: string | null | undefined): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function encodePhase4Cursor(cursor: Phase4Cursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodePhase4Cursor(raw: string | null | undefined, watermark: string): Phase4Cursor {
  if (!raw) return { created_at: watermark, key: "" };
  try {
    const padded = raw.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(raw.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<Phase4Cursor>;
    const createdAt = parsePhase4Watermark(parsed.created_at) || watermark;
    const key = typeof parsed.key === "string" ? parsed.key : "";
    return Date.parse(createdAt) < Date.parse(watermark) ? { created_at: watermark, key: "" } : { created_at: createdAt, key };
  } catch {
    return { created_at: watermark, key: "" };
  }
}

function phase4NormalizedTimestampExpression(expression: string): string {
  return `datetime(${expression})`;
}

function phase4MirrorTimestampExpression(expression: string): string {
  return `strftime('%Y-%m-%dT%H:%M:%fZ', datetime(${expression}))`;
}

function phase4ReplayJobScope(scope: Phase4MirrorScope | undefined): { sql: string; binds: string[] } | null {
  if (!scope?.completedJobsOnly) return null;
  const where = ["datetime(created_at) >= datetime(?)"];
  const binds = [scope.minWatermark];
  if (scope.maxExclusiveWatermark) {
    where.push("datetime(created_at) < datetime(?)");
    binds.push(scope.maxExclusiveWatermark);
  }
  where.push("status = 'complete'");
  return { sql: where.join(" AND "), binds };
}

function phase4ReplayLinkedJobScope(table: Phase4MirrorTable, scope: Phase4MirrorScope | undefined): { sql: string; binds: string[] } | null {
  const jobScope = phase4ReplayJobScope(scope);
  if (!jobScope) return null;
  if (table === "jobs") return jobScope;
  if (["job_events", "artifacts", "resources", "outbound_events", "retrieval_documents", "retrieval_terms"].includes(table)) {
    return { sql: `job_id IN (SELECT id FROM jobs WHERE ${jobScope.sql})`, binds: jobScope.binds };
  }
  return { sql: "0 = 1", binds: [] };
}

function phase4LiveCorrectiveJobScope(scope: Phase4MirrorScope | undefined, watermark: string): { sql: string; binds: string[] } | null {
  if (scope?.kind !== "live") return null;
  return {
    sql: `(datetime(created_at) >= datetime(?) OR EXISTS (
      SELECT 1 FROM job_events
      WHERE job_events.job_id = jobs.id
        AND datetime(job_events.created_at) >= datetime(?)
        AND COALESCE(
          CASE WHEN json_valid(job_events.detail)
            THEN CAST(json_extract(job_events.detail, '$.marker') AS TEXT)
          END,
          ''
        ) LIKE 'corrective-resynthesis:%'
    ))`,
    binds: [watermark, watermark],
  };
}

function phase4LiveLinkedJobScope(table: Phase4MirrorTable, scope: Phase4MirrorScope | undefined, watermark: string): { sql: string; binds: string[] } | null {
  const jobScope = phase4LiveCorrectiveJobScope(scope, watermark);
  if (!jobScope) return null;
  if (table === "jobs") return jobScope;
  if (["job_events", "artifacts", "resources", "outbound_events", "retrieval_documents", "retrieval_terms"].includes(table)) {
    return { sql: `job_id IN (SELECT id FROM jobs WHERE ${jobScope.sql})`, binds: jobScope.binds };
  }
  return null;
}

export function phase4DeltaQuery(table: Phase4MirrorTable, watermark: string, cursor: Phase4Cursor, limit: number, scope?: Phase4MirrorScope): { sql: string; binds: Array<string | number> } {
  const spec = PHASE4_MIRROR_TABLES[table];
  const keyExpression = `CAST(${spec.keyExpression || spec.keyColumn} AS TEXT)`;
  const cursorExpression = spec.cursorExpression;
  // retrieval_terms is large and indexed_at is always D1 CURRENT_TIMESTAMP text.
  // Comparing the raw column to datetime(?) preserves timestamp normalisation while
  // allowing SQLite/D1 to use the dedicated cursor index. datetime(indexed_at)
  // forced a full table scan and eventually exhausted the Worker request budget.
  const normalizedCursorExpression = table === "retrieval_terms"
    ? cursorExpression
    : phase4NormalizedTimestampExpression(cursorExpression);
  const mirrorTimestampExpression = phase4MirrorTimestampExpression(cursorExpression);
  const where = [
    `${normalizedCursorExpression} >= datetime(?)`,
    `(${normalizedCursorExpression} > datetime(?) OR (${normalizedCursorExpression} = datetime(?) AND ${keyExpression} > ?))`,
  ];
  const binds: Array<string | number> = [watermark, cursor.created_at, cursor.created_at, cursor.key];
  const liveScope = phase4LiveLinkedJobScope(table, scope, watermark);
  if (liveScope) {
    where.push(liveScope.sql);
    binds.push(...liveScope.binds);
  } else if (spec.extraWhere) {
    where.push(spec.extraWhere);
    binds.push(watermark);
  }
  const replayScope = phase4ReplayLinkedJobScope(table, scope);
  if (replayScope) {
    where.push(replayScope.sql);
    binds.push(...replayScope.binds);
  }
  binds.push(limit);
  const tableExpression = table === "retrieval_terms"
    ? "retrieval_terms INDEXED BY retrieval_terms_mirror_cursor_idx"
    : spec.table;
  return {
    sql: `SELECT ${spec.columns.join(", ")}, ${mirrorTimestampExpression} AS mirror_updated_at, ${keyExpression} AS mirror_key FROM ${tableExpression} WHERE ${where.join(" AND ")} ORDER BY ${normalizedCursorExpression} ASC, ${keyExpression} ASC LIMIT ?`,
    binds,
  };
}

export function phase4NextCursor(table: Phase4MirrorTable, rows: Array<Record<string, unknown>>): string | null {
  if (!rows.length) return null;
  const spec = PHASE4_MIRROR_TABLES[table];
  const last = rows[rows.length - 1];
  const createdAt = String(last.mirror_updated_at || last.created_at || "");
  const key = String(last.mirror_key || last[spec.keyColumn] || "");
  return createdAt && key ? encodePhase4Cursor({ created_at: createdAt, key }) : null;
}

export function phase4ObjectAccessQuery(key: string, watermark: string, scope?: Phase4MirrorScope): { sql: string; binds: string[] } {
  const liveJobScope = phase4LiveCorrectiveJobScope(scope, watermark);
  const jobWhere = [liveJobScope?.sql || "datetime(created_at) >= datetime(?)"];
  const jobBinds = liveJobScope?.binds || [watermark];
  if (scope?.completedJobsOnly) jobWhere.push("status = 'complete'");
  if (scope?.maxExclusiveWatermark) {
    jobWhere.push("datetime(created_at) < datetime(?)");
    jobBinds.push(scope.maxExclusiveWatermark);
  }
  const jobScopeSql = jobWhere.join(" AND ");
  const jobScopeBinds = () => [...jobBinds];
  const jobObjectColumns = [
    "original_video_key",
    "audio_key",
    "markdown_key",
    "transcript_key",
    "synthesis_json_key",
    "html_key",
  ].join(", ");
  return {
    sql: `
      SELECT ? AS object_key
      WHERE EXISTS (
        SELECT 1 FROM artifacts
        WHERE object_key=? AND datetime(created_at) >= datetime(?) AND job_id IN (SELECT id FROM jobs WHERE ${jobScopeSql})
      )
      OR EXISTS (
        SELECT 1 FROM jobs
        WHERE ? IN (${jobObjectColumns}) AND ${jobScopeSql}
      )
      OR EXISTS (
        SELECT 1 FROM resources
        WHERE guide_html_key=? AND datetime(created_at) >= datetime(?) AND job_id IN (SELECT id FROM jobs WHERE ${jobScopeSql})
      )
      LIMIT 1
    `,
    binds: [
      key,
      key, watermark, ...jobScopeBinds(),
      key, ...jobScopeBinds(),
      key, watermark, ...jobScopeBinds(),
    ],
  };
}

export function phase4Tables(): Phase4MirrorTable[] {
  return Object.keys(PHASE4_MIRROR_TABLES) as Phase4MirrorTable[];
}
