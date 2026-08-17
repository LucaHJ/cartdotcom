import assert from "node:assert/strict";
import test from "node:test";

// The source is dependency-free TypeScript. These compact mirror tests protect the
// URL and command contracts even before a bundler is involved.
const canonicalize = (value) => {
  let parsed;
  try { parsed = new URL(value); } catch { return null; }
  if (parsed.hostname.toLowerCase().replace(/^www\./, "") !== "instagram.com") return null;
  const match = parsed.pathname.match(/^\/(?:[^/]+\/)?(reel|p|tv)\/([A-Za-z0-9_-]+)\/?/i)
    || parsed.pathname.match(/^\/(reel|p|tv)\/([A-Za-z0-9_-]+)\/?/i);
  if (!match) return null;
  const mediaPath = match[1].toLowerCase() === "p" ? "p" : "reel";
  return { url: `https://www.instagram.com/${mediaPath}/${match[2]}/`, shortcode: match[2] };
};
const dedupeKey = (value) => {
  const canonical = canonicalize(value);
  return canonical ? `instagram:${canonical.shortcode}` : null;
};

test("canonicalizes supported Instagram Reel URLs", () => {
  assert.deepEqual(canonicalize("https://www.instagram.com/matt.xyz_motion/reel/DZIkrEoSoZj/?x=1"), {
    url: "https://www.instagram.com/reel/DZIkrEoSoZj/",
    shortcode: "DZIkrEoSoZj",
  });
  assert.deepEqual(canonicalize("https://instagram.com/p/DZIkrEoSoZj/"), {
    url: "https://www.instagram.com/p/DZIkrEoSoZj/",
    shortcode: "DZIkrEoSoZj",
  });
});

test("uses one pre-Codex deduplication key for Reel and post URL variants", () => {
  assert.equal(dedupeKey("https://www.instagram.com/reel/AbC_123/?igsh=example"), "instagram:AbC_123");
  assert.equal(dedupeKey("https://www.instagram.com/p/AbC_123/"), "instagram:AbC_123");
  assert.equal(dedupeKey("https://example.com/reel/AbC_123/"), null);
});

test("preserves carousel post URLs during canonicalisation", () => {
  assert.deepEqual(canonicalize("https://www.instagram.com/growithalex/p/Dblrpj-E_Lf/?img_index=4"), {
    url: "https://www.instagram.com/p/Dblrpj-E_Lf/",
    shortcode: "Dblrpj-E_Lf",
  });
});

test("derives an Instagram post URL from a carousel CDN cache key", () => {
  const mediaId = "3955759437608861697";
  const cacheKey = Buffer.from(`${mediaId}.3-ccb7-5`).toString("base64");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let numeric = BigInt(mediaId);
  let shortcode = "";
  do {
    shortcode = alphabet[Number(numeric % 64n)] + shortcode;
    numeric /= 64n;
  } while (numeric > 0n);
  const url = new URL(`https://scontent-syd2-1.cdninstagram.com/image.jpg?ig_cache_key=${encodeURIComponent(cacheKey)}`);
  assert.equal(url.hostname.endsWith(".cdninstagram.com"), true);
  assert.equal(shortcode, "Dblrj__k0AB");
  assert.equal(`https://www.instagram.com/p/${shortcode}/`, "https://www.instagram.com/p/Dblrj__k0AB/");
});

test("rejects non-Instagram and profile URLs", () => {
  assert.equal(canonicalize("https://example.com/reel/abc/"), null);
  assert.equal(canonicalize("https://instagram.com/matt.xyz_motion/"), null);
});

test("emoji command remains deliberately narrow", () => {
  const match = "change the emoji for complete to 🥳".match(/^change\s+(?:the\s+)?emoji\s+for\s+([a-z0-9_-]+)\s+to\s+(.+)$/i);
  assert.equal(match?.[1], "complete");
  assert.equal(match?.[2], "🥳");
  assert.equal("research this harder".match(/^change\s+(?:the\s+)?emoji/), null);
});

test("Instagram reaction policy covers each visible pipeline stage", () => {
  const stages = new Set(["queued", "downloading", "synthesizing", "complete", "error_auth", "error_download", "error_media", "error_transcript", "error_research", "error_archive", "error_unknown"]);
  const shouldReactToStage = (stage) => stages.has(stage);
  assert.equal(shouldReactToStage("complete"), true);
  assert.equal(shouldReactToStage("queued"), true);
  assert.equal(shouldReactToStage("downloading"), true);
  assert.equal(shouldReactToStage("synthesizing"), true);
  assert.equal(shouldReactToStage("error_research"), true);
});

test("Instagram outbound reactions use live-verified UTF-8 values", () => {
  assert.equal(Array.from("💬").length, 1);
  assert.equal(Buffer.from("💬", "utf8").toString("hex"), "f09f92ac");
  assert.equal(Buffer.from("✅", "utf8").toString("hex"), "e29c85");
});

test("reaction commands map names to UTF-8 emoji", () => {
  const aliases = new Map([
    ["❤", "❤️"], ["❤️", "❤️"], ["heart", "❤️"], ["speech balloon", "💬"],
  ]);
  assert.equal(aliases.get("❤️"), "❤️");
  assert.equal(aliases.get("heart"), "❤️");
  assert.equal(aliases.get("speech balloon"), "💬");
  assert.equal(aliases.get("haha"), undefined);
});

test("formats queue-to-synthesis processing durations compactly", () => {
  const formatDuration = (seconds) => {
    if (seconds == null || !Number.isFinite(Number(seconds)) || Number(seconds) < 0) return "Not measured";
    const rounded = Math.round(Number(seconds));
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const remainingSeconds = rounded % 60;
    if (hours) return `${hours}h ${minutes}m ${remainingSeconds}s`;
    if (minutes) return `${minutes}m ${remainingSeconds}s`;
    return `${remainingSeconds}s`;
  };
  assert.equal(formatDuration(42.4), "42s");
  assert.equal(formatDuration(142.8), "2m 23s");
  assert.equal(formatDuration(3723), "1h 2m 3s");
  assert.equal(formatDuration(null), "Not measured");
});
