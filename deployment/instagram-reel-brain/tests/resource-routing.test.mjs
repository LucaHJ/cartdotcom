import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/domain.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const domain = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("normalizes recipe aliases into the global recipes folder", () => {
  assert.equal(domain.normalizeResourceKind("dish", "Miso noodles", ""), "recipe");
  assert.equal(domain.RESOURCE_KIND_DEFINITIONS.recipe.folder, "recipes");
});

test("normalizes common technical resource kinds", () => {
  assert.equal(domain.normalizeResourceKind("repository", "Motion toolkit", ""), "software");
  assert.equal(domain.RESOURCE_KIND_DEFINITIONS.software.folder, "software-tools");
  assert.equal(domain.normalizeResourceKind("method", "Lighting workflow", ""), "technique");
});

test("falls back safely for an unknown resource kind", () => {
  assert.equal(domain.normalizeResourceKind("novel category", "Unclassified item", ""), "other");
  assert.equal(domain.RESOURCE_KIND_DEFINITIONS.other.folder, "other-resources");
});

test("routes common artifacts into durable central collections", () => {
  assert.equal(domain.normalizeArtifactType("font", "other", "Inter", "A variable typeface"), "font");
  assert.equal(domain.normalizeArtifactType(null, "recipe", "Miso noodles", "A weeknight recipe"), "recipe");
  assert.equal(domain.normalizeArtifactType("tv_show", "media", "Severance", "Apple TV series"), "tv_show");
  assert.equal(domain.normalizeArtifactType(null, "software", "Figma", "Interface design software"), null);
  assert.equal(domain.normalizeArtifactType(null, "software", "Canva", "A design platform with a large font catalogue"), null);
  assert.equal(domain.normalizeArtifactType(null, "technique", "Font pairing by contrast", "Contrast a display face with a text face"), null);
  assert.equal(domain.ARTIFACT_COLLECTION_DEFINITIONS.font.folder, "fonts");
  assert.equal(domain.ARTIFACT_COLLECTION_DEFINITIONS.tv_show.folder, "tv-shows");
  assert.equal(domain.canonicalArtifactKey("book", "Meditations"), "book:meditations");
});

test("renders one canonical artifact page with every source Reel in a three-wide-ready grid", () => {
  const detail = domain.renderResourceHtml({
    rootId: "job-1",
    rootPath: "",
    name: "Meditations",
    kind: "media",
    artifactType: "book",
    canonicalUrl: "https://example.com/meditations",
    summary: "Marcus Aurelius's philosophical work.",
    whyUseful: "A primary Stoic text.",
    guide: "Read by theme or book.",
    sources: ["https://example.com/source"],
    sourceReels: [
      { jobId: "job-1", rootPath: "reels/dhananvir/one/index.html", title: "First Reel", author: "dhananvir", mediaType: "reel" },
      { jobId: "job-2", rootPath: "reels/max-panko5/two/index.html", title: "Second Reel", author: "max_panko5", mediaType: "reel" },
    ],
  });
  assert.match(detail, /class="artifact-reel-grid"/);
  assert.equal((detail.match(/data-thumbnail-job-id=/g) || []).length, 2);
  assert.match(detail, /@dhananvir/);
  assert.match(detail, /@max_panko5/);
  assert.doesNotMatch(detail, />Back to Reel</);
});

test("renders bidirectional artifact collection and source Reel links", () => {
  const detail = domain.renderResourceHtml({
    rootId: "job-1",
    rootPath: "reels/example/index.html",
    name: "Inter",
    kind: "other",
    artifactType: "font",
    canonicalUrl: "https://rsms.me/inter/",
    summary: "A variable sans-serif typeface.",
    whyUseful: "Clear interface typography.",
    guide: "Use its variable font build.",
    sources: ["https://rsms.me/inter/"],
  });
  assert.match(detail, /data-gallery-action/);
  assert.match(detail, /data-library-path="fonts\/index\.html"/);
  assert.match(detail, /data-library-path="reels\/example\/index\.html"/);

  const collection = domain.renderArtifactCollectionHtml({
    artifactType: "font",
    items: [{
      name: "Inter",
      libraryPath: "fonts/inter.html",
      rootPath: "reels/example/index.html",
      summary: "A variable sans-serif typeface.",
      author: "designer",
      sourceCount: 2,
    }],
  });
  assert.match(collection, /data-library-path="fonts\/inter\.html"/);
  assert.match(collection, /2 source Reels/);
  assert.match(collection, /data-gallery-action/);
});

test("renders verified media links, artwork, and selectable YouTube candidates", () => {
  const detail = domain.renderResourceHtml({
    rootId: "job-media",
    rootPath: "reels/example/index.html",
    name: "Referenced media",
    kind: "media",
    canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
    summary: "Media mentioned by the carousel.",
    whyUseful: "Provides the original context.",
    guide: "Compare the candidates before selecting one.",
    sources: ["https://example.com/source"],
    media: {
      hero_image_url: "https://i.ytimg.com/vi/M7lc1UVf-VE/hqdefault.jpg",
      hero_image_alt: "Official video thumbnail",
      spotify_url: "https://open.spotify.com/track/example",
      youtube_candidates: [
        { title: "Candidate one", channel: "Channel A", url: "https://www.youtube.com/watch?v=M7lc1UVf-VE", confidence: "medium", match_reason: "Title fragment matches." },
        { title: "Candidate two", channel: "Channel B", url: "https://youtu.be/dQw4w9WgXcQ", confidence: "low", match_reason: "Subject matches but creator does not." },
      ],
      article_links: [{ title: "Original article", publisher: "Example", url: "https://example.com/article" }],
    },
  });
  assert.match(detail, /class="resource-hero"/);
  assert.match(detail, /Open on Spotify/);
  assert.equal((detail.match(/class="youtube-match"/g) || []).length, 2);
  assert.match(detail, /youtube\.com\/embed\/M7lc1UVf-VE/);
  assert.match(detail, /Possible YouTube matches/);
  assert.match(detail, /Original article/);
});

test("adds deterministic YouTube, Spotify, and article fallbacks", () => {
  const youtube = domain.applyMediaLinkFallbacks({
    name: "Exact video",
    kind: "media",
    canonical_url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
  }, null);
  assert.equal(youtube.youtube_candidates.length, 1);
  assert.equal(youtube.hero_image_url, "https://i.ytimg.com/vi/M7lc1UVf-VE/hqdefault.jpg");

  const music = domain.applyMediaLinkFallbacks({ name: "Song and artist", kind: "media" }, "music");
  assert.equal(music.spotify_url, "https://open.spotify.com/search/Song%20and%20artist");

  const article = domain.applyMediaLinkFallbacks({
    name: "Mentioned investigation",
    kind: "reference",
    canonical_url: "https://example.com/report",
  }, null);
  assert.deepEqual(article.article_links, [{ title: "Mentioned investigation", publisher: "example.com", url: "https://example.com/report" }]);
});

test("routes Instagram text into retrieval, note, status, help, and emoji commands", () => {
  assert.deepEqual(domain.parseMessageCommand("send me the video about robot arms that mentions MoveIt"), {
    intent: "retrieval",
    query: "robot arms that mentions MoveIt",
    delivery: "reel",
  });
  assert.deepEqual(domain.parseMessageCommand("note: compare this with the Blender workflow"), {
    intent: "note",
    body: "compare this with the Blender workflow",
  });
  assert.deepEqual(domain.parseMessageCommand("system status"), { intent: "status" });
  assert.deepEqual(domain.parseMessageCommand("help"), { intent: "help" });
  assert.deepEqual(domain.parseMessageCommand("change the emoji for complete to ✅"), {
    intent: "emoji",
    stage: "complete",
    display: "✅",
  });
});

test("requests archived files only when explicitly asked or the original is unavailable", () => {
  assert.equal(domain.parseMessageCommand("send me the Reel about OpenXR").delivery, "reel");
  assert.equal(domain.parseMessageCommand("send me the MP4 about OpenXR").delivery, "video_file");
  assert.equal(domain.parseMessageCommand("send me the archived video about OpenXR").delivery, "video_file");
  assert.equal(domain.parseMessageCommand("send me the Reel about OpenXR because it was taken down").delivery, "video_file");
});

test("does not silently save or mutate an unrecognized message", () => {
  assert.deepEqual(domain.parseMessageCommand("hello there"), { intent: "unknown", text: "hello there" });
});
