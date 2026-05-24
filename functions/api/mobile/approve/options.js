import { createApprovalOptions } from "../../../_lib/mobile-auth.js";

export async function onRequestPost(context) {
    return createApprovalOptions(context.request, context.env, context.data);
}
