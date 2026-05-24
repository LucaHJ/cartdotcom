import cloudflareAccessPlugin from "@cloudflare/pages-plugin-cloudflare-access";
import { json, requireBackendSession } from "../_lib/backend-auth.js";

const DEFAULT_ACCESS_DOMAIN = "https://broad-dream-fada.cloudflareaccess.com";
const DEFAULT_ACCESS_AUD = "ccb25d793f9a91a6260af5a0934ae79bedfbd0009bbd8aa38bed0aa98806c2f1";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export async function onRequest(context) {
    const url = new URL(context.request.url);
    if (LOCAL_HOSTS.has(url.hostname)) return context.next();

    if (url.pathname.startsWith("/api/mobile/")) {
        const domain = context.env.CF_ACCESS_DOMAIN || DEFAULT_ACCESS_DOMAIN;
        const aud = context.env.CF_ACCESS_AUD || DEFAULT_ACCESS_AUD;
        return cloudflareAccessPlugin({ domain, aud })(context);
    }

    if (url.pathname.startsWith("/api/auth/")) return context.next();
    if (url.pathname === "/api/instagram/webhook") return context.next();

    const session = await requireBackendSession(context);
    if (!session.ok) {
        return json({ error: session.error || "Backend login is required." }, 401);
    }

    context.data.backendSession = session;
    return context.next();
}
