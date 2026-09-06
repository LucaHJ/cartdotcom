const MAX_BYTES = 16 * 1024 * 1024;
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
export async function digest(value) {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function validateBundle(bundle) {
  const { snapshot: s, catalogue: c } = bundle || {};
  if (
    s?.version !== 1 ||
    c?.version !== 2 ||
    s.generatedAt !== c.generatedAt ||
    s.source?.sha256 !== c.snapshotSha256
  )
    throw Error("Snapshot identities do not match");
  if (
    !Array.isArray(s.rows) ||
    !s.rows.length ||
    s.rows.length > 100000 ||
    !Array.isArray(s.players) ||
    s.players.length > 10000 ||
    !Array.isArray(s.columns)
  )
    throw Error("Invalid snapshot shape");
  if (
    !Array.isArray(c.findings) ||
    !c.findings.length ||
    c.findings.length > 2400 ||
    !Number.isFinite(Date.parse(c.analysedAt))
  )
    throw Error("Invalid catalogue");
  if (
    !c.findings.every(
      (f) =>
        typeof f.id === "string" &&
        f.players?.length > 0 &&
        f.players.length <= 5 &&
        f.players.every(
          (p) => Number.isInteger(p) && p >= 0 && p < s.players.length,
        ) &&
        f.query?.rings?.length >= 1 &&
        f.query.rings.length <= 3,
    )
  )
    throw Error("Invalid finding");
  return bundle;
}
export async function publish(request, env) {
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);
  const header = request.headers.get("Authorization") || "";
  if (
    !env.NBA_PUBLISH_TOKEN ||
    (await digest(header)) !== (await digest(`Bearer ${env.NBA_PUBLISH_TOKEN}`))
  )
    return json({ error: "Publisher authentication required" }, 401);
  if (!env.NBA_PUBLICATIONS)
    return json({ error: "Publication storage unavailable" }, 503);
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BYTES)
    return json({ error: "Publication too large" }, 413);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "Body required" }, 400);
  const parts = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > MAX_BYTES) {
      await reader.cancel();
      return json({ error: "Publication too large" }, 413);
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  const sha = await digest(bytes);
  if (sha !== request.headers.get("X-Content-SHA256"))
    return json({ error: "Payload checksum mismatch" }, 400);
  let bundle;
  try {
    bundle = validateBundle(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) {
    return json({ error: error.message }, 400);
  }
  const previous = await env.NBA_PUBLICATIONS.get("latest");
  if (previous) {
    const older = JSON.parse(previous);
    if (
      Date.parse(older.catalogue.analysedAt) >
      Date.parse(bundle.catalogue.analysedAt)
    )
      return json({ error: "Refusing an older publication" }, 409);
    await env.NBA_PUBLICATIONS.put("previous", previous);
  }
  // One key contains both artifacts: eventual consistency can serve an older
  // generation, but cannot mix snapshot rows with another catalogue's player IDs.
  await env.NBA_PUBLICATIONS.put("latest", JSON.stringify(bundle));
  return json({
    ok: true,
    sha256: sha,
    analysedAt: bundle.catalogue.analysedAt,
    findings: bundle.catalogue.findings.length,
  });
}
