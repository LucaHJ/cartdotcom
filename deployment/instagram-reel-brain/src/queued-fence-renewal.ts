/** Renew ONLY never-started, exact current-generation jobs at authenticated claim.
 * This is not execution-lease renewal and cannot revive a prior processor. */
export async function renewUnstartedQueueFence(db: D1Database, exact: {
  pilotKey: string; jobId: string; sourceMessageId: string; generation: number;
}, now = Date.now()): Promise<boolean> {
  if (exact.pilotKey !== `phase6:${exact.generation}:${exact.jobId}`) throw new Error("Invalid exact queue fence");
  const expiresAt = new Date(now + 6 * 3600_000).toISOString();
  const renewBefore = new Date(now + 4 * 3600_000 + 30_000).toISOString();
  const guard = `pilot_key=? AND job_id=? AND source_message_id=? AND status='armed'
    AND local_lease_owner IS NULL AND local_lease_expires_at IS NULL
    AND datetime(expires_at)<datetime(?)
    AND EXISTS(SELECT 1 FROM processing_authority a JOIN jobs j ON j.id=phase5_local_pilot_fences.job_id
      WHERE a.mode='self_hosted' AND a.generation=? AND a.dispatch_enabled=1 AND a.codex_enabled=1
        AND a.outbound_enabled=1 AND a.backlog_enabled=0
        AND j.status='queued' AND j.stage='queued' AND j.attempts=0 AND j.started_at IS NULL
        AND j.completed_at IS NULL AND j.html_key IS NULL AND j.upload_token_hash IS NULL
        AND j.source_message_id=phase5_local_pilot_fences.source_message_id
        AND j.pilot_run_id IS NULL AND datetime(j.created_at)>=datetime(a.cutover_watermark))`;
  const args = [exact.pilotKey, exact.jobId, exact.sourceMessageId, renewBefore, exact.generation];
  // D1 batch is one serial transaction: audit and update see the same guard.
  const result = await db.batch([
    db.prepare(`INSERT INTO job_events(job_id,stage,status,emoji,detail)
      SELECT job_id,'phase6_queued_fence_renewed','queued','🔒',
        json_object('pilot_key',pilot_key,'previous_expires_at',expires_at,'expires_at',?,'reason','unstarted_queue_wait')
      FROM phase5_local_pilot_fences WHERE ${guard}`).bind(expiresAt, ...args),
    db.prepare(`UPDATE phase5_local_pilot_fences SET expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE ${guard}`).bind(expiresAt, ...args),
  ]);
  const audit = result[0].meta.changes || 0, updated = result[1].meta.changes || 0;
  if (audit !== updated || updated > 1) throw new Error("Queue fence renewal postcondition failed");
  return updated === 1;
}
