import assert from "node:assert/strict";
import test from "node:test";

import { findInstagramCarouselMediaPayload, findInstagramDirectPermalink } from "../src/domain.ts";

const webhookTime = Date.parse("2026-08-17T06:23:33Z");

test("matches a media_share shortcode by the webhook media id", () => {
  const payload = {
    inbox: {
      threads: [{
        thread_id: "thread-1",
        items: [{
          item_id: "message-1",
          item_type: "media_share",
          timestamp: String(webhookTime * 1000),
          media_share: {
            pk: "18113134456932485",
            code: "DExample001",
            caption: { text: "Trust me... read these manga..." },
          },
        }],
      }],
    },
  };
  assert.deepEqual(findInstagramDirectPermalink(payload, {
    mediaId: "18113134456932485",
    title: "Trust me... read these manga...",
    timestampMs: webhookTime,
  }), {
    sourceUrl: "https://www.instagram.com/p/DExample001/",
    score: 180,
    matchedBy: ["media_id", "title", "timestamp_10m"],
    itemType: "media_share",
    mediaPayload: null,
  });
});

test("carries only the matched carousel media object into the processing hand-off", () => {
  const carousel = {
    pk: "18113134456932485",
    code: "DCarousel04",
    carousel_media: [
      { pk: "1", image_versions2: { candidates: [{ url: "https://cdn/1.jpg" }] } },
      { pk: "2", image_versions2: { candidates: [{ url: "https://cdn/2.jpg" }] } },
    ],
  };
  const payload = { inbox: { threads: [{ items: [{ item_id: "message-4", item_type: "media_share", media_share: carousel }] }] } };
  const match = findInstagramDirectPermalink(payload, { mediaId: "18113134456932485" });
  assert.deepEqual(match?.mediaPayload, { items: [carousel] });
});

test("normalises GraphQL sidecar children into the image hand-off schema", () => {
  const payload = { data: { xdt_shortcode_media: {
    shortcode: "DGraphQL05",
    owner: { id: "42", username: "reader" },
    edge_media_to_caption: { edges: [{ node: { text: "A reading list" } }] },
    edge_sidecar_to_children: { edges: [
      { node: { id: "1", display_url: "https://cdn/1.jpg" } },
      { node: { id: "2", display_url: "https://cdn/2.jpg" } },
    ] },
  } } };
  const result = findInstagramCarouselMediaPayload(payload);
  assert.equal(result?.items[0].code, "DGraphQL05");
  assert.equal(result?.items[0].user.username, "reader");
  assert.equal(result?.items[0].carousel_media.length, 2);
});

test("supports an XMA target_url when the webhook id is nested in the same item", () => {
  const payload = {
    thread: {
      items: [{
        item_id: "message-2",
        item_type: "xma_media_share",
        timestamp: webhookTime,
        xma_media_share: [{
          target_url: "https://www.instagram.com/p/DCarousel02/?img_index=3",
          subtitle_text: "18113134456932485",
          title_text: "Trust me... read these manga...",
        }],
      }],
    },
  };
  const match = findInstagramDirectPermalink(payload, {
    mediaId: "18113134456932485",
    title: "Trust me... read these manga...",
    timestampMs: webhookTime,
  });
  assert.equal(match?.sourceUrl, "https://www.instagram.com/p/DCarousel02/");
  assert.equal(match?.matchedBy.includes("media_id"), true);
});

test("does not borrow the permalink from a different Direct item", () => {
  const payload = {
    inbox: {
      threads: [{
        items: [
          {
            item_id: "matching-but-no-link",
            item_type: "text",
            timestamp: webhookTime,
            text: "18113134456932485 Trust me... read these manga...",
          },
          {
            item_id: "unrelated-link",
            item_type: "media_share",
            timestamp: webhookTime,
            media_share: { pk: "99999999999999999", code: "DWrongPost9" },
          },
        ],
      }],
    },
  };
  assert.equal(findInstagramDirectPermalink(payload, {
    mediaId: "18113134456932485",
    title: "Trust me... read these manga...",
    timestampMs: webhookTime,
  }), null);
});

test("allows title plus close timestamp when Direct omits the attachment media id", () => {
  const payload = {
    inbox: {
      threads: [{
        items: [{
          item_id: "message-3",
          item_type: "xma_media_share",
          timestamp: webhookTime + 30_000,
          xma_media_share: [{
            target_url: "https://www.instagram.com/p/DTitleTime3/",
            title_text: "Trust me... read these manga...",
          }],
        }],
      }],
    },
  };
  const match = findInstagramDirectPermalink(payload, {
    mediaId: "18113134456932485",
    title: "Trust me... read these manga...",
    timestampMs: webhookTime,
  });
  assert.equal(match?.sourceUrl, "https://www.instagram.com/p/DTitleTime3/");
  assert.deepEqual(match?.matchedBy, ["title", "timestamp_10m"]);
});

test("fails closed on equally strong conflicting candidates", () => {
  const item = (code) => ({
    item_id: code,
    item_type: "media_share",
    media_share: { pk: "18113134456932485", code },
  });
  assert.equal(findInstagramDirectPermalink({ inbox: { threads: [{ items: [item("DConflict1"), item("DConflict2")] }] } }, {
    mediaId: "18113134456932485",
  }), null);
});
