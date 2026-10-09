import test from 'node:test';
import assert from 'node:assert/strict';
import { balanceRankings, createQlooClient, findCommonGround, sampleResult, validatePeople } from '../lib/common-ground.mjs';
import { handleMcp } from '../lib/mcp.mjs';
import { createDemoAccessGuard } from '../lib/http.mjs';

const movie = (id, name = id) => ({ entity_id: id, name, subtype: 'urn:entity:movie' });
const seedA = '00000000-0000-4000-8000-000000000001';
const seedB = '00000000-0000-4000-8000-000000000002';
const rpc = (body, origin, url = 'http://127.0.0.1:3000/mcp') => new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });

test('public browser demo is opt-in and bounds live API credits without blocking sample mode', () => {
  let time = 0;
  const guard = createDemoAccessGuard({ maxCredits: 6, windowMs: 1000, now: () => time });
  const request = new Request('https://demo.example/api/recommend');
  assert.throws(() => guard(request, false, 1), error => error.code === 'access');
  guard(request, true, 1);
  guard(request, true, 1);
  guard(request, true, 4);
  assert.throws(() => guard(request, true, 1), error => error.code === 'demo_limit' && error.status === 429);
  guard(request, true, 0);
  time = 1000;
  guard(request, true, 4);
});

test('balanced compromise beats a polarizing first choice; tie order is stable', () => {
  const pool = ['a','b','c','d','e'].map(id => movie(id));
  const result = balanceRankings(pool, [['a','b','c','d','e'], ['e','d','c','b','a']]);
  assert.equal(result.candidates[0].movie.entity_id, 'c');
  assert.deepEqual(result.candidates[0].perPersonRanks, [3,3]);
  assert.deepEqual(result.candidates.slice(1).map(row => row.movie.entity_id), ['b','d']);
  assert.equal(balanceRankings([...pool].reverse(), [['a','b','c','d','e'], ['e','d','c','b','a']]).candidates[0].movie.entity_id, 'c');
});

test('missing ranking evidence is excluded and never treated as dislike', () => {
  const result = balanceRankings(['a','b','c'].map(id => movie(id)), [['a','b','c'], ['b','c']]);
  assert.equal(result.status, 'partial');
  assert.equal(result.excludedCount, 1);
  assert.equal(result.poolSize, 2);
  assert.deepEqual(result.candidates[0].perPersonRanks, [1,1]);
  assert.equal(balanceRankings([movie('a')], [['a'], []]).status, 'empty');
});

test('fixed pool request is sent to both people and input movies are excluded', async () => {
  const calls = [];
  const client = { async insights(seeds, pool) {
    calls.push({ seeds, pool });
    if (!pool) return seeds[0] === seedA ? [movie(seedA), movie('a'), movie('b')] : [movie(seedB), movie('c'), movie('b')];
    return (seeds[0] === seedA ? ['a','b','c'] : ['c','b','a']).map(id => movie(id));
  } };
  const result = await findCommonGround([[seedA], [seedB]], client);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[2].pool, calls[3].pool);
  assert(!calls[2].pool.includes(seedA));
  assert(!calls[2].pool.includes(seedB));
  assert.equal(result.candidates[0].movie.entity_id, 'b');
  await assert.rejects(findCommonGround([[seedA], [seedB]], { insights: async () => { throw new Error('upstream'); } }));
});

test('HTTP contract uses server header, fixed endpoint and bounded pool; errors redact upstream details', async () => {
  const seen = [];
  const client = createQlooClient('private-key', async (url, init) => {
    seen.push({ url: new URL(url), init });
    return Response.json({ success: true, results: { entities: [movie('a')] } });
  });
  await client.insights([seedA], ['a','b']);
  assert.equal(seen[0].url.origin, 'https://hackathon.api.qloo.com');
  assert.equal(seen[0].url.searchParams.get('filter.results.entities'), 'a,b');
  assert.equal(seen[0].url.searchParams.get('sort_by'), 'affinity');
  assert.equal(seen[0].init.headers['X-Api-Key'], 'private-key');
  assert.equal(seen[0].init.redirect, 'manual');
  for (const status of [401,403,429,500]) {
    await assert.rejects(createQlooClient('private-key', async () => new Response('private-key upstream secret', {status})).search('Arrival'), error => !error.message.includes('private-key') && error.code !== undefined);
  }
  await assert.rejects(createQlooClient('private-key', async () => { throw new Error('private-key'); }).search('Arrival'), error => error.code === 'connection_error' && !error.message.includes('private-key'));
  await assert.rejects(createQlooClient(undefined).search('Arrival'), error => error.code === 'not_configured');
});

test('unexpected redirects never forward the server credential or expose the target', async () => {
  let calls = 0;
  const client = createQlooClient('private-key', async (_url, init) => {
    calls += 1;
    assert.equal(init.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example/?secret=private-key' } });
  });
  await assert.rejects(client.search('Arrival'), error => error.code === 'redirect_refused' && !error.message.includes('private-key') && !error.message.includes('untrusted.example'));
  assert.equal(calls, 1);
});

test('invalid preferences and undocumented response wrappers fail clearly', async () => {
  assert.throws(() => validatePeople([[], [seedB]]));
  assert.throws(() => validatePeople([[seedA], ['not-an-id']]));
  assert.throws(() => validatePeople([[seedA]]));
  await assert.rejects(createQlooClient('key', async () => Response.json({ unexpected: [] })).search('Arrival'), error => error.code === 'response_contract');
  const result = sampleResult([['demo-arrival'], ['demo-before-sunrise']]);
  assert.equal(result.mode, 'sample');
  assert(result.warnings[0].includes('not Qloo'));
});

test('MCP initialize, discovery, notifications and sample tool calls work without live API requests', async () => {
  let response = await handleMcp(rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }), undefined);
  assert.equal((await response.json()).result.protocolVersion, '2025-03-26');
  response = await handleMcp(rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined);
  assert.equal(response.status, 202);
  response = await handleMcp(rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), undefined);
  assert.equal((await response.json()).result.tools.length, 2);
  response = await handleMcp(rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'find_common_ground', arguments: { people: [['demo-arrival'], ['demo-before-sunrise']], mode: 'sample' } } }), undefined, () => { throw new Error('Live API should not be called'); });
  const data = await response.json();
  assert.equal(data.result.isError, false);
  assert.equal(JSON.parse(data.result.content[0].text).mode, 'sample');
});

test('MCP rejects cross-origin, private anonymous calls and unsafe input without exposing a key', async () => {
  assert.equal((await handleMcp(rpc({ jsonrpc:'2.0', id:1, method:'tools/list' }, 'https://untrusted.example'), 'secret')).status, 403);
  const body = { jsonrpc:'2.0', id:1, method:'tools/call', params: { name:'find_common_ground', arguments: { people: [[seedA], [seedB]] } } };
  const privateResponse = await handleMcp(rpc(body, undefined, 'https://private.example/mcp'), 'secret');
  const privateResult = await privateResponse.json();
  assert.equal(privateResult.result.isError, true);
  assert(!JSON.stringify(privateResult).includes('secret'));
  const broken = await handleMcp(rpc({ ...body, params: { name:'unknown', arguments:{} } }), 'secret');
  assert.equal((await broken.json()).result.isError, true);
});
