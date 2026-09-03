import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { renewUnstartedQueueFence } from '../src/queued-fence-renewal.ts';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE processing_authority(mode,generation,dispatch_enabled,codex_enabled,outbound_enabled,backlog_enabled,cutover_watermark);
    INSERT INTO processing_authority VALUES('self_hosted',2,1,1,1,0,'2026-08-23T01:17:09Z');
    CREATE TABLE jobs(id,source_message_id,status,stage,attempts,started_at,completed_at,html_key,upload_token_hash,pilot_run_id,created_at);
    INSERT INTO jobs VALUES('job','message','queued','queued',0,NULL,NULL,NULL,NULL,NULL,'2026-09-03 05:10:23');
    CREATE TABLE phase5_local_pilot_fences(pilot_key,job_id,source_message_id,status,local_lease_owner,local_lease_expires_at,expires_at,updated_at);
    INSERT INTO phase5_local_pilot_fences VALUES('phase6:2:job','job','message','armed',NULL,NULL,'2026-09-03T11:10:24Z',NULL);
    CREATE TABLE job_events(job_id,stage,status,emoji,detail);`);
  const db = {
    prepare(query) { return { bind(...args) { return { run() { const result = sql.prepare(query).run(...args); return { meta: { changes: Number(result.changes) } }; } }; } }; },
    async batch(statements) { sql.exec('BEGIN'); try { const result = statements.map(s => s.run()); sql.exec('COMMIT'); return result; } catch(e) { sql.exec('ROLLBACK'); throw e; } },
  };
  return { sql, db };
}
const exact = { pilotKey: 'phase6:2:job', jobId: 'job', sourceMessageId: 'message', generation: 2 };
const now = Date.parse('2026-09-03T14:00:00Z');

test('expired never-started live fence renews six hours, with one durable audit and no job changes', async () => {
  const { sql, db } = fixture();
  try {
    assert.equal(await renewUnstartedQueueFence(db, exact, now), true);
    assert.equal(sql.prepare('SELECT expires_at FROM phase5_local_pilot_fences').get().expires_at, '2026-09-03T20:00:00.000Z');
    assert.equal(sql.prepare('SELECT attempts FROM jobs').get().attempts, 0);
    assert.equal(await renewUnstartedQueueFence(db, exact, now), false);
    assert.equal(sql.prepare('SELECT COUNT(*) n FROM job_events').get().n, 1);
    const detail = JSON.parse(sql.prepare('SELECT detail FROM job_events').get().detail);
    assert.equal(detail.previous_expires_at, '2026-09-03T11:10:24Z');
  } finally { sql.close(); }
});

test('queued reservation with seconds left gets a full bounded window before any processor starts', async () => {
  const { sql, db } = fixture();
  try {
    sql.exec("UPDATE phase5_local_pilot_fences SET expires_at='2026-09-03T14:00:01Z'");
    assert.equal(await renewUnstartedQueueFence(db, exact, now), true);
  } finally { sql.close(); }
});

test('renewal fails closed for wrong identity, old generation, backlog, prior work or publication', async () => {
  for (const mutation of [
    "UPDATE processing_authority SET mode='cloud'", "UPDATE processing_authority SET generation=3",
    "UPDATE processing_authority SET backlog_enabled=1", "UPDATE processing_authority SET dispatch_enabled=0",
    "UPDATE jobs SET created_at='2026-08-01'", "UPDATE jobs SET pilot_run_id='historic'",
    "UPDATE jobs SET source_message_id='other'", "UPDATE jobs SET attempts=1", "UPDATE jobs SET started_at='2026-09-03'",
    "UPDATE jobs SET html_key='published'", "UPDATE jobs SET completed_at='2026-09-03'", "UPDATE jobs SET upload_token_hash='callback'",
    "UPDATE jobs SET status='running'", "UPDATE phase5_local_pilot_fences SET status='local_processing'",
    "UPDATE phase5_local_pilot_fences SET local_lease_owner='worker'",
    "UPDATE phase5_local_pilot_fences SET local_lease_expires_at='2026-09-04'",
  ]) {
    const { sql, db } = fixture();
    try {
      sql.exec(mutation);
      assert.equal(await renewUnstartedQueueFence(db, exact, now), false, mutation);
      assert.equal(sql.prepare('SELECT COUNT(*) n FROM job_events').get().n, 0, mutation);
    } finally { sql.close(); }
  }
});

test('interrupted renewal transaction rolls back its audit and cannot create partial authority', async () => {
  const { sql, db } = fixture();
  try {
    sql.exec("CREATE TRIGGER fail_update BEFORE UPDATE ON phase5_local_pilot_fences BEGIN SELECT RAISE(ABORT,'injected'); END;");
    await assert.rejects(renewUnstartedQueueFence(db, exact, now), /injected/);
    assert.equal(sql.prepare('SELECT COUNT(*) n FROM job_events').get().n, 0);
    assert.equal(sql.prepare('SELECT expires_at FROM phase5_local_pilot_fences').get().expires_at, '2026-09-03T11:10:24Z');
  } finally { sql.close(); }
});
