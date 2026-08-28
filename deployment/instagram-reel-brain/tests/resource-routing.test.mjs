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

test("renders ordered list pages with linked resource profiles and source Reel preview", () => {
  const detail = domain.renderListHtml({
    id: "job-list",
    title: "Five typefaces for editorial design",
    summary: "The source Reel's recommendations in their original order.",
    rootPath: "reels/designer/type-list/index.html",
    author: "designer",
    description: "Five useful typefaces.",
    mediaType: "reel",
    comments: [{ author: "reader", text: "Number two is excellent.", like_count: 4 }],
    items: [
      { position: 1, section: "ranked", label: "Inter", description: "A neutral interface sans.", resourcePath: "fonts/inter.html" },
      { position: 2, section: "ranked", label: "EB Garamond", description: "An open-source serif.", resourcePath: "fonts/eb-garamond.html" },
      { position: 1, section: "honourable_mention", label: "Source Sans", description: "An honourable mention.", resourcePath: "fonts/source-sans.html" },
    ],
  });
  assert.match(detail, /data-document-kind="list"/);
  assert.match(detail, /data-reel-preview="true"/);
  assert.match(detail, /data-job-id="job-list"/);
  assert.match(detail, /data-library-path="reels\/designer\/type-list\/index\.html"/);
  assert.match(detail, /data-library-path="fonts\/inter\.html"/);
  assert.match(detail, /data-library-path="fonts\/eb-garamond\.html"/);
  assert.match(detail, /data-library-path="fonts\/source-sans\.html"/);
  assert.ok(detail.indexOf("Inter") < detail.indexOf("EB Garamond"));
  assert.match(detail, /Ranked recommendations/);
  assert.match(detail, /Honourable mentions/);
  assert.match(detail, /class="recreated-list honourable-mentions"/);
  assert.match(detail, /data-reel-sidecar/);

  const collection = domain.renderListCollectionHtml({ items: [{
    title: "Five typefaces for editorial design",
    libraryPath: "lists/five-typefaces-type-list.html",
    summary: "Ordered recommendations.",
    author: "designer",
    itemCount: 5,
  }] });
  assert.match(collection, /data-library-path="lists\/five-typefaces-type-list\.html"/);
  assert.match(collection, /5 entries/);
  assert.match(collection, /@designer/);
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
  assert.match(detail, /class="spotify-brand-link"/);
  assert.match(detail, /data-spotify-uri="spotify:track:example"/);
  assert.match(detail, /aria-label="Open Referenced media in Spotify"/);
  assert.doesNotMatch(detail, />Open (?:on|in) Spotify</);
  assert.equal((detail.match(/class="youtube-match"/g) || []).length, 2);
  assert.match(detail, /youtube\.com\/embed\/M7lc1UVf-VE/);
  assert.match(detail, /Possible YouTube matches/);
  assert.equal((detail.match(/class="youtube-brand-link"/g) || []).length, 2);
  assert.match(detail, /aria-label="Open Candidate one in YouTube"/);
  assert.match(detail, /data-library-path="youtube\/M7lc1UVf-VE\.html"/);
  assert.match(detail, /Saved video profile/);
  assert.match(detail, /View all YouTube videos/);
  assert.doesNotMatch(detail, />Open on YouTube</);
  assert.match(detail, /Original article/);
});

test("renders a central YouTube folder with deduplicated video profiles and source links", () => {
  const profile = {
    id: "M7lc1UVf-VE",
    title: "YouTube Developers Live",
    channel: "Google for Developers",
    url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
    confidence: "high",
    matchReason: "Exact title and channel match.",
    sources: [{
      resourceName: "YouTube API demonstration",
      resourcePath: "learning-resources/youtube-api.html",
      reelTitle: "Useful web design videos",
      reelPath: "reels/example/index.html",
      author: "creator",
    }],
  };
  const collection = domain.renderYoutubeCollectionHtml([profile]);
  assert.match(collection, /<h1>YouTube<\/h1>/);
  assert.match(collection, /class="youtube-library-grid"/);
  assert.equal((collection.match(/data-library-path="youtube\/M7lc1UVf-VE\.html"/g) || []).length, 1);
  assert.match(collection, /i\.ytimg\.com\/vi\/M7lc1UVf-VE\/hqdefault\.jpg/);

  const detail = domain.renderYoutubeVideoHtml(profile);
  assert.match(detail, /youtube\.com\/embed\/M7lc1UVf-VE/);
  assert.match(detail, /data-library-path="youtube\/index\.html"/);
  assert.match(detail, /data-library-path="learning-resources\/youtube-api\.html"/);
  assert.match(detail, /data-library-path="reels\/example\/index\.html"/);
  assert.match(detail, /class="youtube-brand-link"/);
  assert.match(detail, /www\.gstatic\.com\/youtube\/img\/branding\/favicon\/favicon_144x144\.png/);
});

test("keeps trailers, film, television, and music out of the creator-made YouTube collection", () => {
  assert.equal(domain.isYoutubeNativeCandidate({
    resourceName: "Sean Carroll: Einstein’s most radical thought",
    candidateTitle: "Sean Carroll: Einstein’s most radical thought",
    matchReason: "Exact channel match.",
  }), true);
  assert.equal(domain.isYoutubeNativeCandidate({
    artifactType: "film",
    resourceName: "The Notebook",
    candidateTitle: "The Notebook - Official Trailer",
  }), false);
  assert.equal(domain.isYoutubeNativeCandidate({
    resourceName: "The Perks of Being a Wallflower",
    candidateTitle: "Full Deleted Scene",
  }), false);
  assert.equal(domain.isYoutubeNativeCandidate({
    artifactType: "music",
    resourceName: "Earrings",
    candidateTitle: "Earrings",
  }), false);

  const film = domain.renderResourceHtml({
    rootId: "film-job",
    rootPath: "reels/example/index.html",
    name: "The Notebook",
    kind: "media",
    artifactType: "film",
    canonicalUrl: "https://example.com/notebook",
    summary: "Film profile.",
    whyUseful: "Reference.",
    guide: "Watch the film.",
    sources: [],
    media: { youtube_candidates: [{ title: "The Notebook - Official Trailer", channel: "Studio", url: "https://www.youtube.com/watch?v=M7lc1UVf-VE", confidence: "high", match_reason: "Official trailer." }] },
  });
  assert.doesNotMatch(film, /youtube-match/);
  assert.doesNotMatch(film, /View all YouTube videos/);
  assert.doesNotMatch(film, /Official or canonical link/);
  assert.doesNotMatch(film, /<h2>Research sources<\/h2>/);
  assert.match(film, /href="https:\/\/www\.justwatch\.com\/au\/movie\/the-notebook"/);
  assert.match(film, />JustWatch<\/a>/);
});

test("renders the official JustWatch all-offers widget at the top of film and television profiles", () => {
  const film = domain.renderResourceHtml({
    rootId: "film-job",
    rootPath: "reels/example/index.html",
    name: "The Master (2012)",
    kind: "media",
    artifactType: "film",
    canonicalUrl: "https://www.criterion.com/films/2857-the-master",
    summary: "A 2012 Paul Thomas Anderson film.",
    whyUseful: "Reference.",
    guide: "Watch the film.",
    sources: ["https://www.criterion.com/films/2857-the-master"],
    media: { article_links: [{ title: "Review", publisher: "Example", url: "https://example.com/review" }] },
    justWatchWidgetKey: "synthetic-widget-key",
  });
  assert.match(film, /class="justwatch-panel"/);
  assert.match(film, /data-jw-widget/);
  assert.match(film, /data-api-key="synthetic-widget-key"/);
  assert.match(film, /data-object-type="movie"/);
  assert.match(film, /data-title="The Master"/);
  assert.match(film, /data-year="2012"/);
  assert.match(film, /www\.justwatch\.com\/au\/movie\/the-master/);
  assert.ok(film.indexOf("justwatch-panel") < film.indexOf("resource-hero") || !film.includes("resource-hero"));
  assert.doesNotMatch(film, /Official or canonical link/);
  assert.doesNotMatch(film, /Mentioned articles/);
  assert.doesNotMatch(film, /Research sources/);

  const show = domain.renderResourceHtml({
    rootId: "show-job",
    rootPath: "reels/example/index.html",
    name: "Severance",
    kind: "media",
    artifactType: "tv_show",
    canonicalUrl: "https://www.justwatch.com/au/tv-show/severance",
    summary: "A television series first released in 2022.",
    whyUseful: "Reference.",
    guide: "Watch the show.",
    sources: [],
    justWatchWidgetKey: "synthetic-widget-key",
  });
  assert.match(show, /data-object-type="show"/);
  assert.match(show, /data-year="2022"/);
  assert.match(show, /href="https:\/\/www\.justwatch\.com\/au\/tv-show\/severance"/);
});

test("derives Australian JustWatch paths and release years deterministically", () => {
  assert.equal(domain.justWatchTitleUrl("It’s a Wonderful Life (1946)", "film"), "https://www.justwatch.com/au/movie/it-s-a-wonderful-life");
  assert.equal(domain.justWatchTitleUrl("Kaiju No. 8", "tv_show"), "https://www.justwatch.com/au/tv-show/kaiju-no-8");
  assert.equal(domain.justWatchReleaseYear("The Master (2012)", ""), "2012");
  assert.equal(domain.justWatchReleaseYear("Severance", "A television series first released in 2022."), "2022");
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

test("upgrades Spotify artwork renditions and derives native app URIs", () => {
  assert.equal(
    domain.highResolutionSpotifyArtworkUrl("https://image-cdn-ak.spotifycdn.com/image/ab67616d00001e02a50279e4210b0f3820bc5378"),
    "https://image-cdn-ak.spotifycdn.com/image/ab67616d0000b273a50279e4210b0f3820bc5378",
  );
  assert.equal(domain.spotifyUriFromUrl("https://open.spotify.com/album/4xGTfawtEfy5f2yGYtRqlr?si=abc"), "spotify:album:4xGTfawtEfy5f2yGYtRqlr");
  assert.equal(domain.spotifyUriFromUrl("https://example.com/album/4xGTfawtEfy5f2yGYtRqlr"), "");
});

test("upgrades small Bandcamp music artwork", () => {
  assert.equal(
    domain.highResolutionMusicArtworkUrl("https://f4.bcbits.com/img/a393988977_1x1_120.jpg"),
    "https://f4.bcbits.com/img/a393988977_10.jpg",
  );
});

test("routes Instagram text into retrieval, note, status, help, and emoji commands", () => {
  assert.deepEqual(domain.parseMessageCommand("send me the video about robot arms that mentions MoveIt"), {
    intent: "retrieval",
    query: "robot arms that mentions MoveIt",
    delivery: "reel",
  });
  assert.deepEqual(domain.parseMessageCommand("Find me the video of the swordsman playing with his cat"), {
    intent: "retrieval",
    query: "swordsman playing with his cat",
    delivery: "reel",
  });
  assert.deepEqual(domain.parseMessageCommand("Send me the video of the war movie titled Cherry"), {
    intent: "retrieval",
    query: "war movie titled Cherry",
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
  assert.deepEqual(domain.parseMessageCommand("Change queue icon to 📥"), {
    intent: "emoji",
    stage: "queued",
    display: "📥",
  });
  assert.deepEqual(domain.parseMessageCommand("Change downloading icon to ⬇️"), {
    intent: "emoji",
    stage: "downloading",
    display: "⬇️",
  });
  assert.deepEqual(domain.parseMessageCommand("change restricted audience emoji to 🔞"), {
    intent: "emoji",
    stage: "error_restricted",
    display: "🔞",
  });
  assert.equal(domain.shouldStoreLiveInstructionCandidate({
    mode: "live", hasShare: false, emptyMessage: false,
    commandIntent: domain.parseMessageCommand("Change queued icon to 📥").intent,
  }), false);
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
