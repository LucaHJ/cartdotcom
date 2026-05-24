import { clearBackendSessionCookie, json } from "../../_lib/backend-auth.js";

export async function onRequestPost() {
    return json({ ok: true }, 200, { "set-cookie": clearBackendSessionCookie() });
}

export async function onRequestGet() {
    return json({ ok: true }, 200, { "set-cookie": clearBackendSessionCookie() });
}
