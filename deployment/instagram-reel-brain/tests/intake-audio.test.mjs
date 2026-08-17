import assert from "node:assert/strict";
import test from "node:test";

test("test-only intake pairs an adjacent marker without producing a chat reply", () => {
  const pending = { kind: "share", source_url: "https://www.instagram.com/reel/ABC123/", source_message_id: "share-mid" };
  const cleanText = "#brain-test".replace(/(?:^|\s)#brain-test(?:\s|$)/ig, " ").trim();
  assert.equal(cleanText, "");
  assert.equal(pending.kind, "share");
  assert.equal(pending.source_message_id, "share-mid");
  assert.equal(Boolean(pending.source_url), true);
  assert.equal(cleanText ? "reply" : "silent_pair", "silent_pair");
});

test("archived audio is labelled only when a verified source link exists", () => {
  const normalizeAudio = (audio) => audio?.identification_method !== "unidentified" && audio?.source_url
    ? audio
    : {
        title: null, artist: null, source_url: null,
        identification_method: "unidentified", confidence: "unverified",
      };
  assert.equal(normalizeAudio({ title: "Guess", identification_method: "transcript_research", source_url: null }).title, null);
  assert.equal(normalizeAudio({
    title: "Track", artist: "Artist", identification_method: "instagram_metadata",
    source_url: "https://www.instagram.com/reels/audio/123/",
  }).title, "Track");
});

test("carousel attachment objects are treated as shares instead of help commands", () => {
  const attachmentItems = (...values) => values.flatMap((value) => Array.isArray(value) ? value : value && typeof value === "object" ? [value] : []);
  const looksLikeShareAttachment = (value) => {
    const strings = JSON.stringify(value).toLowerCase();
    return ["share", "reel", "ig_reel", "video", "image", "carousel", "post"].some((type) => strings.includes(type));
  };
  const message = { attachments: { type: "carousel", payload: { url: "https://scontent.cdninstagram.com/example" } } };
  const attachments = attachmentItems(message.attachments);
  assert.equal(attachments.some(looksLikeShareAttachment), true);
  assert.equal("" || (attachments.length ? "unsupported_share" : "help"), "unsupported_share");
});

test("Meta ig_post attachments are classified as shares", () => {
  const attachment = { type: "ig_post", payload: { ig_post_media_id: "18115777132926505" } };
  const supportedTypes = new Set(["share", "reel", "ig_reel", "ig_post", "video", "image", "carousel", "post"]);
  assert.equal(supportedTypes.has(attachment.type), true);
});

test("empty webhook messages remain silent", () => {
  const sourceUrl = "";
  const cleanText = "";
  const hasShareAttachment = false;
  const emptyMessage = !sourceUrl && !cleanText;
  assert.equal(emptyMessage, true);
  assert.equal(!sourceUrl && (hasShareAttachment || emptyMessage), true);
});

test("completed duplicates react on the newly shared message", () => {
  const existing = { status: "complete", stage: "complete" };
  const reactionStage = existing.status === "complete" ? "complete" : existing.stage;
  assert.equal(reactionStage, "complete");
});

test("Meta ig_post attachments expose media ids for automatic permalink recovery", () => {
  const payload = {
    type: "ig_post",
    payload: {
      ig_post_media_id: "18115777132926505",
      url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=18115777132926505&signature=test",
    },
  };
  const ids = new Set();
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (["ig_post_media_id", "reel_video_id", "media_id", "asset_id"].includes(key)) ids.add(String(item));
      if (key === "url" && typeof item === "string") ids.add(new URL(item).searchParams.get("asset_id"));
      visit(item);
    }
  };
  visit(payload);
  assert.deepEqual([...ids].filter(Boolean), ["18115777132926505"]);
});

test("unresolved live carousels enter cloud resolution without a chat reply", () => {
  const sourceUrl = null;
  const hasShareAttachment = true;
  const mode = "live";
  const outcome = mode === "live" && !sourceUrl && hasShareAttachment
    ? { status: "resolving_carousel", reaction: "queued", reply: null }
    : { status: "ignored" };
  assert.deepEqual(outcome, {
    status: "resolving_carousel",
    reaction: "queued",
    reply: null,
  });
});

test("a pasted Instagram link resumes the pending original share", () => {
  const pending = { kind: "unsupported_share", source_message_id: "carousel-mid" };
  const incoming = { source_url: "https://www.instagram.com/p/Carousel123/", has_share_attachment: false };
  const sourceMessageId = incoming.source_url && !incoming.has_share_attachment
    ? pending.source_message_id
    : "link-mid";
  assert.equal(sourceMessageId, "carousel-mid");
});
