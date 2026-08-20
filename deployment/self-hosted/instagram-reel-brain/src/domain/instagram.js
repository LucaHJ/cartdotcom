export const LIVE_ADJACENT_INSTRUCTION_WINDOW_MINUTES = 5;
export const LIVE_INSTRUCTION_GRACE_DELAY_SECONDS = 12;

export function canonicalizeInstagramUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!["instagram.com", "instagr.am"].includes(host)) return null;
  const match = url.pathname.match(/^\/(reel|p|tv)\/([^/?#]+)/i);
  if (!match) return null;
  return `https://www.instagram.com/${match[1].toLowerCase()}/${match[2]}/`;
}

export function instagramShortcode(input) {
  const canonical = canonicalizeInstagramUrl(input);
  return canonical?.match(/^https:\/\/www\.instagram\.com\/(?:reel|p|tv)\/([^/]+)\//)?.[1] || null;
}

export function instagramDedupeKey(input) {
  const shortcode = instagramShortcode(input);
  return shortcode ? `instagram:${shortcode}` : null;
}

export function classifyInstagramMediaPayload(payload) {
  if (!payload || typeof payload !== "object") return { hasShare: false, mediaType: "unknown", urls: [] };
  const urls = [];
  const collect = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "string" && /https?:\/\/(?:www\.)?instagram\.com\/(?:reel|p|tv)\//i.test(item)) urls.push(item);
      if (item && typeof item === "object" && ["attachment", "attachments", "media", "share", "payload", "reel", "post"].includes(key)) collect(item);
      if (Array.isArray(item)) item.forEach(collect);
    }
  };
  collect(payload);
  const mediaType = JSON.stringify(payload).includes("ig_post") ? "post" : JSON.stringify(payload).includes("ig_reel") ? "reel" : urls.length ? "link" : "unknown";
  return { hasShare: urls.length > 0 || mediaType === "post" || mediaType === "reel", mediaType, urls: [...new Set(urls)] };
}

export function shouldCreateLiveInstructionTarget({ mode, hasShare, instructions }) {
  return mode === "live" && Boolean(hasShare) && !String(instructions || "").trim();
}

export function shouldStoreLiveInstructionCandidate({ mode, hasShare, emptyMessage, commandIntent }) {
  return mode === "live" && !hasShare && !emptyMessage && commandIntent === "unknown";
}

export function pendingPartIsTest({ mode }) {
  return mode === "test_only";
}

export function queueDelaySecondsForAdjacentInstruction(mode) {
  return mode === "live" ? LIVE_INSTRUCTION_GRACE_DELAY_SECONDS : 0;
}

export function rankComments(comments, limit = 40) {
  return [...(comments || [])]
    .sort((a, b) => Number(b.like_count || b.likes || 0) - Number(a.like_count || a.likes || 0))
    .slice(0, limit);
}
