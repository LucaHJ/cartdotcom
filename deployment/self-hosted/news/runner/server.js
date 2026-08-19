import { spawn } from "node:child_process";
import { access, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import process from "node:process";

const PORT = Number(process.env.PORT || 3010);
const ENABLED = /^(1|true|yes)$/i.test(process.env.RUNNER_ENABLED || "false");
const MAX_CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.RUNNER_CONCURRENCY || 8)));
const TIMEOUT_MS = Math.max(60000, Number(process.env.CODEX_JOB_TIMEOUT_MS || 300000));
const MODEL = process.env.CODEX_RESEARCH_MODEL || "gpt-5.6-luna";
const EFFORT = process.env.CODEX_RESEARCH_REASONING_EFFORT || "medium";
const AUTH_FILE = `${process.env.CODEX_HOME || "/codex-auth"}/auth.json`;
let active = 0;

async function readBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1000000) throw new Error("Request body exceeds 1 MB.");
  }
  return JSON.parse(body || "{}");
}

function execute(prompt, outputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", [
      "exec", "-", "--model", MODEL,
      "-c", `model_reasoning_effort=\"${EFFORT}\"`,
      "--sandbox", "read-only", "--ephemeral", "--ignore-user-config",
      "--skip-git-repo-check", "--output-schema", "/app/result.schema.json",
      "--output-last-message", outputPath, "--color", "never",
    ], {
      cwd: "/work",
      env: {
        PATH: process.env.PATH,
        HOME: "/home/node",
        CODEX_HOME: process.env.CODEX_HOME || "/codex-auth",
        LANG: "C.UTF-8",
      },
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-12000); });
    child.on("error", reject);
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, TIMEOUT_MS);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Codex exited with ${code ?? signal}: ${stderr.trim() || "no diagnostic output"}`));
    });
    child.stdin.end(prompt);
  });
}

const server = createServer(async (request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.method === "GET" && request.url === "/healthz") {
    response.writeHead(200).end(JSON.stringify({ ok: true, enabled: ENABLED, active, capacity: MAX_CONCURRENCY }));
    return;
  }
  if (request.method !== "POST" || request.url !== "/research") {
    response.writeHead(404).end(JSON.stringify({ error: "not_found" }));
    return;
  }
  if (!ENABLED) {
    response.writeHead(503).end(JSON.stringify({ error: "Codex runner is disabled during staging." }));
    return;
  }
  if (active >= MAX_CONCURRENCY) {
    response.writeHead(429).end(JSON.stringify({ error: "Codex runner is at capacity." }));
    return;
  }

  const outputPath = `/work/${randomUUID()}.json`;
  active += 1;
  try {
    await access(AUTH_FILE);
    const { prompt } = await readBody(request);
    if (typeof prompt !== "string" || !prompt.trim()) throw new Error("A non-empty prompt is required.");
    await execute(prompt, outputPath);
    const result = JSON.parse(await readFile(outputPath, "utf8"));
    response.writeHead(200).end(JSON.stringify({ ok: true, result }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.writeHead(500).end(JSON.stringify({ error: message.slice(0, 12000) }));
  } finally {
    active -= 1;
    await rm(outputPath, { force: true }).catch(() => {});
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "codex_runner_started", enabled: ENABLED, model: MODEL, effort: EFFORT, capacity: MAX_CONCURRENCY }));
});
