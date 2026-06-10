import { Container, getContainer } from "@cloudflare/containers";

export interface Env {
  CODEX_CONTAINER: DurableObjectNamespace<CodexResearchContainer>;
  CONTAINER_API_TOKEN?: string;
  OPENAI_API_KEY?: string;
  CODEX_ACCESS_TOKEN?: string;
  CODEX_AUTH_JSON?: string;
  CODEX_RESEARCH_MODEL?: string;
}

function json(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
}

function isAuthorized(request: Request, env: Env): boolean {
  if (!env.CONTAINER_API_TOKEN) return true;
  const header = request.headers.get("authorization") || "";
  return header === `Bearer ${env.CONTAINER_API_TOKEN}`;
}

function cloneForContainer(request: Request, path: string): Request {
  const sourceUrl = new URL(request.url);
  const target = new URL(sourceUrl);
  target.pathname = path;
  return new Request(target.toString(), request);
}

async function startWithSecrets(container: any, env: Env): Promise<void> {
  await container.startAndWaitForPorts({
    startOptions: {
      envVars: {
        CODEX_HOME: "/home/codex/.codex",
        CODEX_RESEARCH_MODEL: env.CODEX_RESEARCH_MODEL || "gpt-5.5",
        CODEX_AUTH_JSON: env.CODEX_AUTH_JSON || "",
        OPENAI_API_KEY: env.OPENAI_API_KEY || "",
        CODEX_ACCESS_TOKEN: env.CODEX_ACCESS_TOKEN || "",
      },
    },
  });
}

export class CodexResearchContainer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  sleepAfter = "15m";
  enableInternet = true;
  pingEndpoint = "health";

  envVars = {
    CODEX_HOME: "/home/codex/.codex",
  };

  override onStart() {
    console.log("Codex research container started");
  }

  override onStop(params: { exitCode?: number; reason?: string }) {
    console.log("Codex research container stopped", params);
  }

  override onError(error: unknown) {
    console.error("Codex research container failed", error);
    throw error;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({
        ok: true,
        service: "cartdotcom-news-signal-container",
        routes: ["/health", "/container/health", "/container/mcp-check", "/container/research"],
      });
    }

    if (!url.pathname.startsWith("/container/")) {
      return json({ error: "Not found" }, { status: 404 });
    }

    if (!isAuthorized(request, env)) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    const path = url.pathname.replace(/^\/container/, "") || "/health";
    const container = getContainer(env.CODEX_CONTAINER, "research-worker");

    if (path === "/start" && request.method === "POST") {
      await startWithSecrets(container, env);
      return json({ ok: true, state: await container.getState() });
    }

    if (path === "/mcp-check" || path === "/research" || path === "/login-check") {
      await startWithSecrets(container, env);
    }

    return container.fetch(cloneForContainer(request, path));
  },
};
