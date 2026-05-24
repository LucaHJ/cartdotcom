import { verifyApproval } from "../../../_lib/mobile-auth.js";

export async function onRequestPost(context) {
    return verifyApproval(context.request, context.env);
}
