import { listPendingApprovals } from "../../_lib/mobile-auth.js";

export async function onRequestGet(context) {
    return listPendingApprovals(context.request, context.env, context.data);
}
