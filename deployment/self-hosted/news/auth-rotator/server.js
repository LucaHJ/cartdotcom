import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import process from "node:process";

const port = Number(process.env.PORT || 3011);
const token = (await readFile(process.env.RUNTIME_CONTROL_TOKEN_FILE, "utf8")).trim();
const authFile = process.env.CODEX_AUTH_FILE || "/codex-auth/auth.json";

function authorized(request) {
  const candidate = (request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const left = Buffer.from(candidate);
  const right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 120_000) throw Object.assign(new Error("Auth payload is too large"), { statusCode: 413 });
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw Object.assign(new Error("Auth payload must be valid JSON"), { statusCode: 400 });
  }
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/healthz") return json(response, 200, { ok: true });
    if (request.method !== "POST" || request.url !== "/rotate") return json(response, 404, { error: "not_found" });
    if (!authorized(request)) return json(response, 401, { error: "unauthorized" });
    const body = await readBody(request);
    const authJson = typeof body.auth_json === "string" ? body.auth_json.trim() : "";
    if (!authJson) return json(response, 400, { error: "Missing auth_json" });
    const parsed = JSON.parse(authJson);
    if (!parsed || typeof parsed !== "object" || !(parsed.tokens || parsed.OPENAI_API_KEY || parsed.auth_mode)) {
      return json(response, 400, { error: "Invalid Codex auth.json structure" });
    }
    const temporary = `${authFile}.next`;
    await writeFile(temporary, `${JSON.stringify(parsed)}\n`, { encoding: "utf8", mode: 0o600, flag: "w" });
    await chmod(temporary, 0o600);
    await rename(temporary, authFile);
    return json(response, 200, { ok: true, rotated: true });
  } catch (error) {
    return json(response, Number(error?.statusCode || 400), { error: error?.message || "rotation_failed" });
  }
}).listen(port, "0.0.0.0");
