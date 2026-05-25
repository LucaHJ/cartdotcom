import cloudflareAccessPlugin from "@cloudflare/pages-plugin-cloudflare-access";
import { backendLoginRedirect, requireBackendSession } from "./_lib/backend-auth.js";

const DEFAULT_ACCESS_DOMAIN = "https://broad-dream-fada.cloudflareaccess.com";
const DEFAULT_ACCESS_AUD = "ccb25d793f9a91a6260af5a0934ae79bedfbd0009bbd8aa38bed0aa98806c2f1";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const BACKEND_STATIC_PATHS = new Set([
    "/backend/dashboard",
    "/backend/dashboard.html",
    "/backend/prompting",
    "/backend/prompting.html",
    "/backend/second-brain",
    "/backend/second-brain.html",
    "/backend/youtube-synthesis",
    "/backend/youtube-synthesis.html",
    "/backend/instagram",
    "/backend/instagram.html",
    "/dashboard",
    "/dashboard.html",
    "/prompting",
    "/prompting.html",
    "/second-brain",
    "/second-brain.html",
    "/youtube-synthesis",
    "/youtube-synthesis.html",
    "/instagram",
    "/instagram.html"
]);
const REDIRECTS = new Map([
    ["/dashboard", "/backend/dashboard.html"],
    ["/dashboard.html", "/backend/dashboard.html"],
    ["/prompting", "/backend/prompting.html"],
    ["/prompting.html", "/backend/prompting.html"],
    ["/second-brain", "/backend/second-brain.html"],
    ["/second-brain.html", "/backend/second-brain.html"],
    ["/youtube-synthesis", "/backend/youtube-synthesis.html"],
    ["/youtube-synthesis.html", "/backend/youtube-synthesis.html"],
    ["/instagram", "/backend/instagram.html"],
    ["/instagram.html", "/backend/instagram.html"]
]);
const MOBILE_ACCESS_PATHS = new Set(["/mobile-approval", "/mobile-approval.html"]);

export async function onRequest(context) {
    const url = new URL(context.request.url);
    if (LOCAL_HOSTS.has(url.hostname)) {
        return context.next();
    }

    if (MOBILE_ACCESS_PATHS.has(url.pathname)) {
        const domain = context.env.CF_ACCESS_DOMAIN || DEFAULT_ACCESS_DOMAIN;
        const aud = context.env.CF_ACCESS_AUD || DEFAULT_ACCESS_AUD;
        return cloudflareAccessPlugin({ domain, aud })(context);
    }

    if (!BACKEND_STATIC_PATHS.has(url.pathname)) return context.next();

    const session = await requireBackendSession(context);
    if (!session.ok) return backendLoginRedirect(context.request);

    const redirectTarget = REDIRECTS.get(url.pathname);
    if (redirectTarget) {
        return Response.redirect(`${url.origin}${redirectTarget}${url.search}`, 302);
    }

    return context.next();
}
