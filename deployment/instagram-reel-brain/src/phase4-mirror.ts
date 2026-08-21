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
  | "inbound_webhook_events";

export type Phase4Cursor = {
  created_at: string;
  key: string;
};

export type Phase4TableSpec = {
  table: Phase4MirrorTable;
  keyColumn: string;
  cursorExpression: string;
  columns: string[];
  extraWhere?: string;
};

export const PHASE4_MAX_LIMIT = 200;
export const PHASE4_DEFAULT_LIMIT = 100;

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
    extraWhere: "created_at >= ?",
  },
  job_events: {
    table: "job_events",
    keyColumn: "id",
    cursorExpression: "created_at",
    columns: ["id", "job_id", "stage", "status", "emoji", "detail", "created_at"],
    extraWhere: "job_id IN (SELECT id FROM jobs WHERE created_at >= ?)",
  },
  artifacts: {
    table: "artifacts",
    keyColumn: "id",
    cursorExpression: "created_at",
    columns: ["id", "job_id", "kind", "object_key", "content_type", "byte_size", "sha256", "created_at"],
    extraWhere: "job_id IN (SELECT id FROM jobs WHERE created_at >= ?)",
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
    extraWhere: "job_id IN (SELECT id FROM jobs WHERE created_at >= ?)",
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
  },
  instagram_carousel_resolutions: {
    table: "instagram_carousel_resolutions",
    keyColumn: "source_message_id",
    cursorExpression: "updated_at",
    columns: [
      "source_message_id", "sender_id", "media_id", "title", "status", "source_url",
      "resolution_method", "attempts", "error", "created_at", "updated_at", "completed_at",
    ],
    extraWhere: "created_at >= ?",
  },
  inbound_webhook_events: {
    table: "inbound_webhook_events",
    keyColumn: "source_message_id",
    cursorExpression: "updated_at",
    columns: [
      "source_message_id", "sender_id", "has_share_attachment", "extracted_urls_json",
      "raw_json", "recovery_json", "recovered_url", "created_at", "updated_at",
    ],
    extraWhere: "created_at >= ?",
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
  return btoa(JSON.stringify(cursor)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodePhase4Cursor(raw: string | null | undefined, watermark: string): Phase4Cursor {
  if (!raw) return { created_at: watermark, key: "" };
  try {
    const padded = raw.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(raw.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded)) as Partial<Phase4Cursor>;
    const createdAt = parsePhase4Watermark(parsed.created_at) || watermark;
    const key = typeof parsed.key === "string" ? parsed.key : "";
    return Date.parse(createdAt) < Date.parse(watermark) ? { created_at: watermark, key: "" } : { created_at: createdAt, key };
  } catch {
    return { created_at: watermark, key: "" };
  }
}

export function phase4DeltaQuery(table: Phase4MirrorTable, watermark: string, cursor: Phase4Cursor, limit: number): { sql: string; binds: Array<string | number> } {
  const spec = PHASE4_MIRROR_TABLES[table];
  const keyExpression = `CAST(${spec.keyColumn} AS TEXT)`;
  const cursorExpression = spec.cursorExpression;
  const where = [
    `${cursorExpression} >= ?`,
    `(${cursorExpression} > ? OR (${cursorExpression} = ? AND ${keyExpression} > ?))`,
  ];
  const binds: Array<string | number> = [watermark, cursor.created_at, cursor.created_at, cursor.key];
  if (spec.extraWhere) {
    where.push(spec.extraWhere);
    binds.push(watermark);
  }
  binds.push(limit);
  return {
    sql: `SELECT ${spec.columns.join(", ")}, ${cursorExpression} AS mirror_updated_at FROM ${spec.table} WHERE ${where.join(" AND ")} ORDER BY mirror_updated_at ASC, ${keyExpression} ASC LIMIT ?`,
    binds,
  };
}

export function phase4NextCursor(table: Phase4MirrorTable, rows: Array<Record<string, unknown>>): string | null {
  if (!rows.length) return null;
  const spec = PHASE4_MIRROR_TABLES[table];
  const last = rows[rows.length - 1];
  const createdAt = String(last.mirror_updated_at || last.created_at || "");
  const key = String(last[spec.keyColumn] || "");
  return createdAt && key ? encodePhase4Cursor({ created_at: createdAt, key }) : null;
}

export function phase4ObjectAccessQuery(key: string, watermark: string): { sql: string; binds: string[] } {
  return {
    sql: `
      SELECT object_key FROM artifacts WHERE object_key=? AND created_at >= ? AND job_id IN (SELECT id FROM jobs WHERE created_at >= ?)
      UNION
      SELECT original_video_key AS object_key FROM jobs WHERE original_video_key=? AND created_at >= ?
      UNION
      SELECT audio_key AS object_key FROM jobs WHERE audio_key=? AND created_at >= ?
      UNION
      SELECT markdown_key AS object_key FROM jobs WHERE markdown_key=? AND created_at >= ?
      UNION
      SELECT transcript_key AS object_key FROM jobs WHERE transcript_key=? AND created_at >= ?
      UNION
      SELECT synthesis_json_key AS object_key FROM jobs WHERE synthesis_json_key=? AND created_at >= ?
      UNION
      SELECT html_key AS object_key FROM jobs WHERE html_key=? AND created_at >= ?
      UNION
      SELECT guide_html_key AS object_key FROM resources WHERE guide_html_key=? AND created_at >= ? AND job_id IN (SELECT id FROM jobs WHERE created_at >= ?)
    `,
    binds: [key, watermark, watermark, key, watermark, key, watermark, key, watermark, key, watermark, key, watermark, key, watermark, key, watermark, watermark],
  };
}

export function phase4Tables(): Phase4MirrorTable[] {
  return Object.keys(PHASE4_MIRROR_TABLES) as Phase4MirrorTable[];
}
