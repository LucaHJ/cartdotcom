import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';

test('only fixed read-only routes can reach the private origin', async () => {
  let calls = 0;
  globalThis.caches = { default: { match: async () => null, put: async () => {} } };
  const env = { ORIGIN: { fetch: async (url, options) => {
    calls++;
    assert.equal(url, 'http://origin/portfolio-public/investment.json');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers, undefined);
    return new Response('{}', {headers:{'content-type':'application/json','content-length':'2'}});
  } } };
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    const r = await worker.fetch(new Request('https://example.test/investment.json', {method}), env, {});
    assert.equal(r.status, 405);
  }
  for (const path of ['/admin', '/investment.json?path=/admin', '/portfolio-public/investment.json', '/%2e%2e/admin']) {
    const r = await worker.fetch(new Request('https://example.test' + path), env, {});
    assert.equal(r.status, 404);
  }
  assert.equal(calls, 0);
  const ctx = {waitUntil(p) { p.catch(() => {}); }};
  const response = await worker.fetch(new Request('https://example.test/investment.json', {headers:{Authorization:'Bearer private'}}), env, ctx);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://cartdotcom.com');
  assert.equal(await response.text(), '{}');
  const head = await worker.fetch(new Request('https://example.test/investment.json', {method:'HEAD'}), env, ctx);
  assert.equal(await head.text(), '');
});

test('upstream errors, redirects, unexpected types and sizes fail closed', async () => {
  globalThis.caches = { default: { match: async () => null } };
  for (const response of [new Response('private', {status:401}), new Response('', {status:302, headers:{Location:'/admin'}}), new Response('<html>'), new Response('{}', {headers:{'content-type':'application/json','content-length':'3000000'}})]) {
    const r = await worker.fetch(new Request('https://example.test/research.json'), {ORIGIN:{fetch:async()=>response}}, {});
    assert.equal(r.status, 503);
    assert.ok(!(await r.text()).includes('private'));
  }
});
