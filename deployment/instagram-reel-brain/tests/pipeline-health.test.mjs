import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { probeOriginHealth, queueProgressHealth } from '../src/pipeline-health.ts';

const now = Date.parse('2026-09-03T14:00:00Z');
const healthy = { ok: true, mirror_state: 'healthy', last_completed_at: '2026-09-03T13:59:00Z' };
const probe = (payload, status = 200) => probeOriginHealth('http://origin', 'fixture', async (request) => {
  assert.equal(request.method, 'GET');
  assert.equal(new URL(request.url).pathname, '/healthz');
  return Response.json(payload, { status });
}, now);

test('origin probe rejects false-green, stale, failed, invalid and unavailable responses', async () => {
  assert.equal((await probe(healthy)).ok, true);
  for (const payload of [{ ok: true }, { ...healthy, mirror_state: 'awaiting_first_drain' }, { ...healthy, last_completed_at: '2026-09-03T12:00:00Z' }, { ...healthy, ok: false }]) {
    assert.equal((await probe(payload)).ok, false);
  }
  assert.equal((await probe(healthy, 503)).ok, false);
  assert.equal((await probeOriginHealth(undefined, undefined, async () => { throw new Error('must not call'); })).ok, false);
  assert.equal((await probeOriginHealth('http://origin', 'fixture', async () => { throw new Error('secret'); })).ok, false);
  assert.equal((await probeOriginHealth('http://origin', 'fixture', async () => new Response('bad json'))).ok, false);
  assert.equal((await probeOriginHealth('http://origin', 'fixture', async () => new Response('x'.repeat(16385)))).ok, false);
});

test('origin probe has a real deadline even when upstream never responds', async () => {
  const result = await probeOriginHealth('http://origin', 'fixture', () => new Promise(() => {}), now, 20);
  assert.equal(result.ok, false);
  assert.equal(result.state, 'unreachable');
});

test('queue health detects hours-old untouched queue independently of green service liveness', () => {
  const queue = { queued: 11, running: 0, oldest_queued_at: '2026-09-03 05:10:23', oldest_running_update: null };
  assert.equal(queueProgressHealth(queue, now).state, 'stalled');
  assert.equal(queueProgressHealth({ ...queue, queued: 0 }, now).ok, true);
  assert.equal(queueProgressHealth({ ...queue, oldest_queued_at: '2026-09-03 13:59:00' }, now).state, 'waiting');
  assert.equal(queueProgressHealth({ ...queue, running: 2, oldest_running_update: '2026-09-03 13:59:00' }, now).state, 'processing');
  assert.equal(queueProgressHealth({ ...queue, running: 1, oldest_running_update: '2026-09-03 13:00:00' }, now).ok, false);
});

test('production library status wires both operational checks into existing dashboard rows', () => {
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const status = source.slice(source.indexOf('async function handleReelLibraryStatus'), source.indexOf('async function handleReelLibrarySelfTest'));
  assert.match(status, /probeOriginHealth\(env\.PHASE7_ORIGIN_URL/);
  assert.match(status, /queue_progress: queueProgressHealth/);
});
