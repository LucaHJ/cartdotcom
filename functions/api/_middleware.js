import cloudflareAccessPlugin from "@cloudflare/pages-plugin-cloudflare-access";
import { json, requireBackendSession } from "../_lib/backend-auth.js";

const DEFAULT_ACCESS_DOMAIN = "https://broad-dream-fada.cloudflareaccess.com";
const DEFAULT_ACCESS_AUD = "ccb25d793f9a91a6260af5a0934ae79bedfbd0009bbd8aa38bed0aa98806c2f1";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const DEFAULT_IMDB_HISTORY_ORIGIN_URL = "https://cartdotcom-news-signal-container.lucajeannin.workers.dev";

function imdbHistoryUrl(request, env) {
    const requestUrl = new URL(request.url);
    const origin = String(env.IMDB_HISTORY_ORIGIN_URL || DEFAULT_IMDB_HISTORY_ORIGIN_URL).replace(/\/+$/, "");
    return `${origin}${requestUrl.pathname}${requestUrl.search}`;
}

async function proxyImdbHistory(context) {
    if (!["GET", "HEAD"].includes(context.request.method)) {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: {
                "content-type": "application/json; charset=utf-8",
                allow: "GET, HEAD"
            }
        });
    }
    const requestUrl = new URL(context.request.url);
    const requestHeaders = {
        accept: context.request.headers.get("accept") || "*/*",
        "accept-encoding": context.request.headers.get("accept-encoding") || "gzip, br",
        "user-agent": "cartdotcom-pages-imdb-history-proxy/1.0",
        "x-forwarded-host": requestUrl.host
    };
    const upstream = context.env.IMDB_HISTORY_SELF_HOSTED_API
        ? await context.env.IMDB_HISTORY_SELF_HOSTED_API.fetch(new Request(`http://news-api:3000${requestUrl.pathname}${requestUrl.search}`, {
            method: context.request.method,
            headers: requestHeaders
        }))
        : await fetch(imdbHistoryUrl(context.request, context.env), {
            method: context.request.method,
            headers: requestHeaders
        });
    const headers = new Headers(upstream.headers);
    headers.set("access-control-allow-origin", "*");
    headers.set("x-content-type-options", "nosniff");
    return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers
    });
}

export async function onRequest(context) {
    const url = new URL(context.request.url);
    if (LOCAL_HOSTS.has(url.hostname)) return context.next();

    if (url.pathname.startsWith("/api/imdb/history/")) {
        return proxyImdbHistory(context);
    }

    if (url.pathname.startsWith("/api/mobile/")) {
        const domain = context.env.CF_ACCESS_DOMAIN || DEFAULT_ACCESS_DOMAIN;
        const aud = context.env.CF_ACCESS_AUD || DEFAULT_ACCESS_AUD;
        return cloudflareAccessPlugin({ domain, aud })(context);
    }

    if (url.pathname.startsWith("/api/auth/")) return context.next();
    if (url.pathname.startsWith("/api/instagram/webhook")) return context.next();

    const session = await requireBackendSession(context);
    if (!session.ok) {
        return json({ error: session.error || "Backend login is required." }, 401);
    }

    context.data.backendSession = session;
    return context.next();
}
