import { backendLoginRedirect, requireBackendSession } from "../_lib/backend-auth.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export async function onRequest(context) {
    const url = new URL(context.request.url);
    if (LOCAL_HOSTS.has(url.hostname)) return context.next();

    const session = await requireBackendSession(context);
    if (!session.ok) return backendLoginRedirect(context.request);

    context.data.backendSession = session;
    return context.next();
}
