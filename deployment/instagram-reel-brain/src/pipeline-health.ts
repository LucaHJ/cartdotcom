/** Read-only operational checks: configuration/liveness is not queue progress. */
export type PipelineCheck = { ok: boolean; detail: string; state: string };
export type QueueProgress = {
  queued: number; running: number; oldest_queued_at: string | null; oldest_running_update: string | null;
};

function ageSeconds(value: string | null, now: number): number {
  if (!value) return Infinity;
  const normal = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const parsed = Date.parse(normal);
  return Number.isFinite(parsed) ? Math.max(0, (now - parsed) / 1000) : Infinity;
}

export function queueProgressHealth(queue: QueueProgress, now = Date.now()): PipelineCheck {
  if (queue.running > 0) {
    const stalled = ageSeconds(queue.oldest_running_update, now) > 1200;
    return { ok: !stalled, state: stalled ? "stalled" : "processing", detail: stalled
      ? `${queue.running} running, ${queue.queued} queued; a running job has not progressed for over 20 minutes`
      : `${queue.running} processing, ${queue.queued} queued` };
  }
  if (queue.queued === 0) return { ok: true, state: "idle", detail: "No waiting or running jobs" };
  const stalled = ageSeconds(queue.oldest_queued_at, now) > 600;
  return { ok: !stalled, state: stalled ? "stalled" : "waiting", detail: stalled
    ? `${queue.queued} queued with no processor active; oldest waiting over 10 minutes`
    : `${queue.queued} queued; waiting for handover` };
}

export async function probeOriginHealth(
  originUrl: string | undefined, token: string | undefined,
  requestOrigin: (request: Request) => Promise<Response>, now = Date.now(), timeoutMs = 5000,
): Promise<PipelineCheck> {
  if (!originUrl || !token) return { ok: false, state: "unconfigured", detail: "Ubuntu handover health is not configured" };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("origin_timeout")); }, timeoutMs);
  });
  try {
    // Race the body as well as headers; a reachable but wedged origin is red.
    return await Promise.race([timeout, (async () => {
      const response = await requestOrigin(new Request(`${originUrl.replace(/\/$/, "")}/healthz`, {
        headers: { authorization: `Bearer ${token}` }, signal: controller.signal,
      }));
      const reader = response.body?.getReader();
      if (!reader) throw new Error("empty_health");
      let text = "", size = 0;
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 16384) throw new Error("oversized_health");
          text += decoder.decode(value, { stream: true });
        }
      } finally { await reader.cancel().catch(() => undefined); }
      const payload = JSON.parse(text) as Record<string, unknown>;
      const state = typeof payload.mirror_state === "string" ? payload.mirror_state : "invalid";
      const fresh = typeof payload.last_completed_at === "string" && ageSeconds(payload.last_completed_at, now) <= 600;
      const ok = response.ok && payload.ok === true && state === "healthy" && fresh;
      return { ok, state: ok ? "healthy" : state === "healthy" ? "stale" : state,
        detail: ok ? "Ubuntu receipt database and cloud-to-local handover are healthy (last drain within 10 minutes)"
          : "Ubuntu handover unavailable, stale, or failing; queued jobs may not reach the processor" };
    })()]);
  } catch {
    return { ok: false, state: "unreachable", detail: "Ubuntu handover health request failed or timed out" };
  } finally { if (timer) clearTimeout(timer); }
}
