import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/retrieval.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const retrieval = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

function candidate({ id, completedAt, title = "", author = "", description = "", summary = "", visual = "", transcript = "", comments = "", resourceNames = "", resourceDetails = "", claims = "" }) {
  return {
    id,
    job_id: id,
    document_version: 1,
    title,
    author_username: author,
    description,
    canonical_url: `https://www.instagram.com/reel/${id}/`,
    status: "complete",
    status_emoji: "✅",
    original_video_key: `${id}/original.mp4`,
    markdown_key: null,
    resource_count: 1,
    completed_at: completedAt,
    title_text: title,
    author_text: author,
    description_text: description,
    instructions_text: "",
    summary_text: summary,
    visual_text: visual,
    transcript_text: transcript,
    comments_text: comments,
    resource_names_text: resourceNames,
    resource_details_text: resourceDetails,
    claims_text: claims,
  };
}

const newestUnrelated = candidate({
  id: "Dad01vtsVD3",
  completedAt: "2026-08-25T04:05:43Z",
  title: "Video by escape8reality_",
  description: "At EVO, Daigo completed the famous parry. His counterattack won the round as the crowd reacted.",
  summary: "A landmark esports match involving Street Fighter III.",
});

const swordsmanCat = candidate({
  id: "DbkYou1ph6B",
  completedAt: "2026-08-25T00:52:08Z",
  title: "Video by tanukibayashi",
  visual: "A Japanese swordsman plays with his cat while handling an uchigatana.",
  resourceNames: "Neko no myōjutsu\nCats in Japanese history and culture",
  resourceDetails: "A martial fable about a swordsman and cats. Samurai sword handling and the creator's cat Kinako.",
});

const cherryFilm = candidate({
  id: "DcbSU6ntnEF",
  completedAt: "2026-08-25T03:59:30Z",
  title: "Video by z7.movie",
  summary: "A scene from the war drama film Cherry starring Tom Holland.",
  resourceNames: "Cherry\nTom Holland\nAnthony Russo\nJoe Russo",
  resourceDetails: "The Russo brothers directed the movie Cherry, adapted from Nico Walker's novel.",
});

test("removes request scaffolding, weak stopwords, and duplicate terms", () => {
  assert.deepEqual(
    retrieval.retrievalQueryGroups("Find me the video of the swordsman playing with his cat cat").map((group) => group.term),
    ["swordsman", "play", "cat"],
  );
});

test("does not treat substrings as token matches", () => {
  const result = retrieval.rankRetrievalCandidates("cat war", [candidate({
    id: "substring",
    completedAt: "2026-08-25T05:00:00Z",
    summary: "Catch the tournament while moving toward the exit.",
  })]);
  assert.equal(result.decision, "no_match");
});

test("ranks the swordsman and cat Reel above the newest unrelated Reel", () => {
  const result = retrieval.rankRetrievalCandidates(
    "Find me the video of the swordsman playing with his cat",
    [newestUnrelated, cherryFilm, swordsmanCat],
  );
  assert.equal(result.decision, "match");
  assert.equal(result.matches[0].id, "DbkYou1ph6B");
  assert.deepEqual(result.matches[0].matched_terms, ["swordsman", "play", "cat"]);
});

test("ranks the war movie Cherry Reel above the newest unrelated Reel", () => {
  const result = retrieval.rankRetrievalCandidates(
    "Send me the video of the war movie titled Cherry",
    [newestUnrelated, swordsmanCat, cherryFilm],
  );
  assert.equal(result.decision, "match");
  assert.equal(result.matches[0].id, "DcbSU6ntnEF");
  assert.ok(result.matches[0].coverage >= 0.66);
});

test("uses conservative aliases such as movie and film", () => {
  const result = retrieval.rankRetrievalCandidates("movie Cherry", [candidate({
    id: "film-alias",
    completedAt: "2026-08-25T01:00:00Z",
    resourceNames: "Cherry",
    resourceDetails: "A film directed by Anthony and Joe Russo.",
  })]);
  assert.equal(result.decision, "match");
  assert.equal(result.matches[0].matched_term_count, 2);
});

test("returns ambiguous candidates instead of selecting the newest weakly", () => {
  const first = candidate({ id: "one", completedAt: "2026-08-25T02:00:00Z", resourceNames: "Inter", summary: "A typeface." });
  const second = candidate({ id: "two", completedAt: "2026-08-25T03:00:00Z", resourceNames: "Inter", summary: "A typeface." });
  const result = retrieval.rankRetrievalCandidates("Inter font", [first, second]);
  assert.equal(result.decision, "ambiguous");
  assert.equal(retrieval.selectRetrievalMatch(result.decision, result.matches), undefined);
  assert.equal(result.matches.length, 2);
});

test("selects only an explicitly confident ranked match for delivery", () => {
  const result = retrieval.rankRetrievalCandidates("war movie Cherry", [cherryFilm, newestUnrelated]);
  assert.equal(retrieval.selectRetrievalMatch(result.decision, result.matches)?.id, "DcbSU6ntnEF");
  assert.equal(retrieval.selectRetrievalMatch("no_match", result.matches), undefined);
});

test("builds bounded full-content documents and deterministic index terms", () => {
  const document = retrieval.buildRetrievalDocument({
    jobId: "job-1",
    title: "Cherry",
    visualSummary: "Tom Holland appears in a military uniform.",
    transcript: "The film follows a veteran returning from war.",
    comments: [{ author: "viewer", text: "What movie is this?" }],
    resources: [{ name: "Cherry", artifact_type: "film", summary: "A Russo brothers film." }],
  });
  const terms = retrieval.retrievalDocumentTerms(document);
  assert.ok(terms.includes("cherry"));
  assert.ok(terms.includes("movie"));
  assert.ok(terms.includes("veteran"));
  assert.equal(new Set(terms).size, terms.length);
  assert.ok(terms.length <= 2_000);
});

test("migration creates durable document and inverted-term tables", async () => {
  const migration = await readFile(new URL("../migrations/0025_ranked_retrieval_index.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS retrieval_documents/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS retrieval_terms/);
  assert.match(migration, /PRIMARY KEY\(job_id, term\)/);
  assert.match(migration, /FOREIGN KEY\(job_id\) REFERENCES jobs\(id\) ON DELETE CASCADE/);
});
