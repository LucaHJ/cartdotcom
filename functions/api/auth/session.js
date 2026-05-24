import { getBackendAuthConfig, getBackendSession, json } from "../../_lib/backend-auth.js";

export async function onRequestGet(context) {
    const config = await getBackendAuthConfig(context.env);
    const session = await getBackendSession(context.request, context.env);
    return json({
        configured: config.configured,
        authenticated: session.ok,
        user: session.ok ? {
            username: session.username,
            email: session.email
        } : null,
        error: session.ok ? "" : session.error
    }, session.ok || config.configured ? 200 : 503);
}
