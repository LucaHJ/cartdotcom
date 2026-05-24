import { verifyRegistration } from "../../../_lib/mobile-auth.js";

export async function onRequestPost(context) {
    return verifyRegistration(context.request, context.env, context.data);
}
