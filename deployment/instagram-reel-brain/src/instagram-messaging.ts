export type InstagramReplyRequest = {
  apiVersion: string;
  instagramUserId: string;
  accessToken: string;
  recipientId: string;
  targetMessageId: string;
  text?: string;
};

export type InstagramReplyResult = {
  ok: boolean;
  status: number;
  error: string;
};

export type InstagramFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function required(value: string, label: string): string {
  const clean = String(value || "").trim();
  if (!clean) throw new Error(`${label} is required`);
  return clean;
}

export function instagramMessageReplyBody(
  recipientId: string,
  targetMessageId: string,
  text = ".",
): Record<string, unknown> {
  const replyText = String(text || "").trim();
  if (!replyText) throw new Error("Reply text is required");
  return {
    recipient: { id: required(recipientId, "recipientId") },
    message: { text: replyText.slice(0, 950) },
    reply_to: { mid: required(targetMessageId, "targetMessageId") },
  };
}

export async function postInstagramMessageReply(
  input: InstagramReplyRequest,
  fetcher: InstagramFetch = fetch,
): Promise<InstagramReplyResult> {
  const apiVersion = required(input.apiVersion, "apiVersion");
  const instagramUserId = required(input.instagramUserId, "instagramUserId");
  const accessToken = required(input.accessToken, "accessToken");
  const response = await fetcher(`https://graph.instagram.com/${apiVersion}/${instagramUserId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(instagramMessageReplyBody(input.recipientId, input.targetMessageId, input.text)),
  });
  return {
    ok: response.ok,
    status: response.status,
    error: response.ok ? "" : (await response.text()).slice(0, 500),
  };
}
