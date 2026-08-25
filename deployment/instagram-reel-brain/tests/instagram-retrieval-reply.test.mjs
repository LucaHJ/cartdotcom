import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/instagram-messaging.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const messaging = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("builds a native reply to the matched original Instagram message", () => {
  assert.deepEqual(messaging.instagramMessageReplyBody("recipient-1", "matched-share-mid"), {
    recipient: { id: "recipient-1" },
    message: { text: "." },
    reply_to: { mid: "matched-share-mid" },
  });
});

test("production reply transport posts the exact reply_to payload without putting the token in the URL", async () => {
  let captured;
  const result = await messaging.postInstagramMessageReply({
    apiVersion: "v24.0",
    instagramUserId: "ig-account-1",
    accessToken: "synthetic-token",
    recipientId: "recipient-1",
    targetMessageId: "matched-share-mid",
  }, async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ recipient_id: "recipient-1", message_id: "reply-mid" }), { status: 200 });
  });
  assert.equal(result.ok, true);
  assert.equal(captured.url, "https://graph.instagram.com/v24.0/ig-account-1/messages");
  assert.equal(captured.url.includes("synthetic-token"), false);
  assert.equal(captured.init.headers.authorization, "Bearer synthetic-token");
  assert.deepEqual(JSON.parse(captured.init.body), {
    recipient: { id: "recipient-1" },
    message: { text: "." },
    reply_to: { mid: "matched-share-mid" },
  });
});

test("failed native replies return bounded failure details for the link fallback", async () => {
  const result = await messaging.postInstagramMessageReply({
    apiVersion: "v24.0",
    instagramUserId: "ig-account-1",
    accessToken: "synthetic-token",
    recipientId: "recipient-1",
    targetMessageId: "matched-share-mid",
  }, async () => new Response("reply target unavailable", { status: 400 }));
  assert.deepEqual(result, { ok: false, status: 400, error: "reply target unavailable" });
});

test("the retrieval path looks up the matched job share, replies with a dot, and keeps fallbacks", async () => {
  const worker = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(worker, /SELECT source_message_id FROM jobs WHERE id=\? AND status='complete'/);
  assert.match(worker, /result\.delivery = "reply_to_original_share"/);
  assert.match(worker, /sendInstagramReplyToMessage\([\s\S]{0,250}replyTarget\.source_message_id[\s\S]{0,150}"\."/);
  assert.match(worker, /result\.delivery = "original_reel_link_fallback"/);
  assert.match(worker, /result\.delivery = "video_file_fallback"/);
});
