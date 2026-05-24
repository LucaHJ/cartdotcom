import cloudflareAccessPlugin from "@cloudflare/pages-plugin-cloudflare-access";

const DEFAULT_ACCESS_DOMAIN = "https://broad-dream-fada.cloudflareaccess.com";
const DEFAULT_ACCESS_AUD = "ccb25d793f9a91a6260af5a0934ae79bedfbd0009bbd8aa38bed0aa98806c2f1";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function onRequest(context) {
    const host = new URL(context.request.url).hostname;
    if (LOCAL_HOSTS.has(host)) return context.next();

    const domain = context.env.CF_ACCESS_DOMAIN || DEFAULT_ACCESS_DOMAIN;
    const aud = context.env.CF_ACCESS_AUD || DEFAULT_ACCESS_AUD;
    return cloudflareAccessPlugin({ domain, aud })(context);
}
