import { createRegistrationOptions } from "../../../_lib/mobile-auth.js";

export async function onRequestPost(context) {
    return createRegistrationOptions(context.request, context.env);
}
