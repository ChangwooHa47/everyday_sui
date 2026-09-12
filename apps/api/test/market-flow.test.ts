import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { normalizeSuiAddress as id } from '@mysten/sui/utils';
import type { MarketListing } from '@everyday/contracts';
import { buildApp } from '../src/app.js';
import { hash, failure } from '../src/auth.js';
import { migration } from '../src/database.js';
import { packageSchema, readBytes } from '../src/market-package.js';
import type { MemoryProvider } from '../src/memory-provider.js';

test('P0 preview to purchase, server persona, consented memories and second-origin continuity', async t => {
  const db = new PGlite(); await db.exec(migration);
  const origins = ['http://127.0.0.1:3000', 'http://127.0.0.1:3002'];
  for (const [token, actor, origin] of [['a', '0xa', origins[0]], ['b', '0xb', origins[0]], ['c', '0xb', origins[1]], ['e', '0xe', origins[1]]]) {
    await db.query("INSERT INTO wallet_sessions VALUES($1,$2,$3,now()+interval '30 minutes')", [hash(token.repeat(43)), id(actor), origin]);
  }
  const listing: MarketListing = { id: id('0x10'), creator: id('0xa'), operator: id('0xc'), title: 'Fixture',
    priceMist: '1000', agentBps: 2000, treasuryMist: '0', active: true, published: true,
    package: { blobId: 'a'.repeat(43), contentHash: '0'.repeat(64), endEpoch: '2000' },
    policy: { perGiftLimitMist: '100', dailyLimitMist: '200', allowedGiftIds: [] } };
  const content = packageSchema.parse({ schemaVersion: 1, network: 'testnet', packageId: id('0x99'), listingId: listing.id,
    character: { name: 'Fixture', personality: '첫 문장입니다. 두 번째 문장입니다. 숨길 세 번째 문장입니다.', appearance: '단정한 인상입니다.',
      background: '성인 가상 캐릭터. 관심사: 기타와 공연.', speechStyles: ['짧은 답장', '차분한 말투'] },
    preview: { name: 'Fixture', personality: 'PUBLIC_PREVIEW_PERSONA' },
    examples: [{ role: 'assistant', content: 'PAID_EXAMPLE' }] });
  const providerInputs: string[] = [];
  const provider = createServer((req, res) => { const chunks: Buffer[] = []; req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => { providerInputs.push(Buffer.concat(chunks).toString()); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: '대답' } }] })); }); });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const texts = new Map<string, string[]>(); const jobs = new Map<string, { owner: string; listingId: string }>();
  let memoryCalls = 0; let owned = false; let loads = 0; let uploads = 0;
  const memory: MemoryProvider = {
    setup: async () => ({ transaction: '{}', publicKey: '' }),
    verify: async (owner, accountId) => { if (accountId !== id(owner === id('0xb') ? '0xbb' : '0xee')) throw failure(403, 'MEMORY_OWNER_MISMATCH'); },
    remember: async (owner, _account, listingId, text) => { memoryCalls++; const key = `${owner}:${listingId}`; texts.set(key, [...texts.get(key) ?? [], text]); const job_id = randomUUID(); jobs.set(job_id, { owner, listingId }); return { job_id, status: 'running' }; },
    status: async (_owner, _account, _listing, job_id) => ({ job_id, status: 'done', blob_id: 'a'.repeat(43) }),
    recall: async (owner, _account, listingId) => ({ results: (texts.get(`${owner}:${listingId}`) ?? []).map(text => ({ text, blob_id: 'a'.repeat(43), distance: 0 })), total: 1 }),
  };
  const app = buildApp(false, { db, auth: { origins, audience: 'test', network: 'testnet' },
    market: { packageId: id('0x99'), listing: async () => listing, hasLicense: async (actor, target, proof) => owned && actor === id('0xb') && target === listing.id && proof === id('0x20') },
    runtime: { previewTurns: 2, packages: { operator: id('0xc'), load: async () => { loads++; return content; }, publish: async () => { uploads++; return listing.package; } } }, memory,
    ai: { endpoint: `http://127.0.0.1:${(provider.address() as { port: number }).port}`, model: 'fixture', apiKey: 'test', dailyLimit: 100 } });
  t.after(async () => { await app.close(); await db.close(); await new Promise<void>(resolve => provider.close(() => resolve())); });
  const headers = (token = 'b', origin = origins[0]) => ({ origin, authorization: `Bearer ${token.repeat(43)}` });
  const turn = { requestId: randomUUID(), mode: 'preview', messages: [{ role: 'user', content: 'PRIVATE_USER_MESSAGE' }] };
  const url = `/v1/market/listings/${listing.id}/turns`;
  const rejected = await app.inject({ method: 'POST', url, headers: headers(), payload: { ...turn, mode: 'licensed', licenseId: id('0x20') } });
  assert.equal(rejected.statusCode, 403); assert.equal(loads, 0);
  await db.query('INSERT INTO ai_daily_budget(actor,used) VALUES($1,100)', [id('0xe')]);
  const quotaRejected = await app.inject({ method: 'POST', url, headers: headers('e', origins[1]), payload: { ...turn, requestId: randomUUID() } });
  assert.equal(quotaRejected.statusCode, 429);
  assert.equal((await db.query('SELECT used FROM market_preview_budget WHERE owner=$1 AND listing_id=$2', [id('0xe'), listing.id])).rows.length, 0);
  assert.equal(providerInputs.length, 0);
  assert.equal((await app.inject({ method: 'POST', url, headers: headers(), payload: { ...turn, character: content.character } })).statusCode, 400);
  const previews = await Promise.all([turn, turn, { ...turn, requestId: randomUUID() }, { ...turn, requestId: randomUUID() }].map(payload => app.inject({ method: 'POST', url, headers: headers(), payload })));
  assert.deepEqual(previews.map(r => r.statusCode).sort(), [200, 200, 403, 409]);
  assert.ok(providerInputs.every(p => p.includes('숨길 세 번째 문장') && p.includes('PAID_EXAMPLE')));
  assert.ok(previews.every(response => !response.body.includes('숨길 세 번째 문장') && !response.body.includes('PAID_EXAMPLE') && !response.body.includes('characterPackage')));
  const publicPreview = await app.inject({ url: `/v1/market/listings/${listing.id}/preview`, headers: headers() });
  assert.equal(publicPreview.statusCode, 200);
  assert.equal(publicPreview.json().character.personality, '첫 문장입니다. 두 번째 문장입니다.');
  assert.equal(publicPreview.json().character.appearance, '단정한 인상입니다.');
  assert.equal(publicPreview.json().character.interests, '기타와 공연');
  assert.equal(publicPreview.json().character.background, undefined);
  assert.equal(publicPreview.json().character.relationshipType, '친구');
  assert.equal(publicPreview.body.includes('가상 캐릭터'), false);
  assert.deepEqual(publicPreview.json().character.speechStyles, ['짧은 답장', '차분한 말투']);
  assert.ok(!publicPreview.body.includes('숨길 세 번째 문장') && !publicPreview.body.includes('PAID_EXAMPLE'));
  for (const forbidden of [{ useMemory: true }, { episodeId: 'private-episode' }]) {
    const blocked = await app.inject({ method: 'POST', url, headers: headers('a'), payload: { ...turn, requestId: randomUUID(), ...forbidden } });
    assert.equal(blocked.statusCode, 400);
  }
  owned = true;
  const paid = { ...turn, mode: 'licensed', requestId: randomUUID(), licenseId: id('0x20') };
  assert.equal((await app.inject({ method: 'POST', url, headers: headers(), payload: paid })).statusCode, 200);
  assert.ok(providerInputs.at(-1)!.includes('숨길 세 번째 문장'));
  assert.ok(providerInputs.at(-1)!.includes('PAID_EXAMPLE'));
  assert.equal((await app.inject({ method: 'POST', url: '/v1/me/memory-account', headers: headers(), payload: { accountId: id('0xee'), consent: true } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/me/memory-account', headers: headers(), payload: { accountId: id('0xbb'), consent: true } })).statusCode, 200);
  const memoryBody = { requestId: randomUUID(), text: 'I like warm tea', consent: true, licenseId: id('0x20') };
  const rememberUrl = `/v1/me/relationships/${listing.id}/remember`;
  assert.equal((await app.inject({ method: 'POST', url: rememberUrl, headers: headers(), payload: { ...memoryBody, consent: false } })).statusCode, 400);
  for (let i = 0; i < 2; i++) assert.equal((await app.inject({ method: 'POST', url: rememberUrl, headers: headers(), payload: memoryBody })).statusCode, 202);
  assert.equal(memoryCalls, 1);
  assert.equal((await app.inject({ method: 'POST', url: rememberUrl, headers: headers(), payload: { ...memoryBody, text: 'different' } })).statusCode, 409);
  const job = await app.inject({ url: `/v1/me/memory-jobs/${memoryBody.requestId}`, headers: headers('c', origins[1]) });
  assert.equal(job.json().status, 'done');
  const recallUrl = `/v1/me/relationships/${listing.id}/recall`;
  const fromViewer = await app.inject({ method: 'POST', url: recallUrl, headers: headers('c', origins[1]), payload: { query: 'preferences' } });
  assert.equal(fromViewer.json().results[0].text, memoryBody.text);
  await app.inject({ method: 'POST', url: '/v1/me/memory-account', headers: headers('e', origins[1]), payload: { accountId: id('0xee'), consent: true } });
  const stranger = await app.inject({ method: 'POST', url: recallUrl, headers: headers('e', origins[1]), payload: { query: 'preferences' } });
  assert.deepEqual(stranger.json().results, []);
  assert.equal((await app.inject({ url: `/v1/me/memory-jobs/${memoryBody.requestId}`, headers: headers('e', origins[1]) })).statusCode, 404);
  const withMemory = await app.inject({ method: 'POST', url, headers: headers('c', origins[1]), payload: { ...paid, requestId: randomUUID(), useMemory: true } });
  assert.equal(withMemory.statusCode, 200); assert.ok(providerInputs.at(-1)!.includes(memoryBody.text));
  await app.inject({ method: 'DELETE', url: '/v1/me/memory-account', headers: headers() });
  assert.equal((await app.inject({ method: 'POST', url: recallUrl, headers: headers('c', origins[1]), payload: { query: 'preferences' } })).statusCode, 409);
  const stored = JSON.stringify((await db.query('SELECT * FROM ai_requests')).rows) + JSON.stringify((await db.query('SELECT * FROM memory_jobs')).rows);
  assert.ok(!stored.includes(memoryBody.text) && !stored.includes('PRIVATE_USER_MESSAGE') && !stored.includes('PRIVATE_PAID_PERSONA'));
  listing.published = false;
  const publishBody = { requestId: randomUUID(), characterPackage: content };
  const publishUrl = `/v1/market/listings/${listing.id}/package`;
  assert.equal((await app.inject({ method: 'POST', url: publishUrl, headers: headers(), payload: publishBody })).statusCode, 403);
  for (let i = 0; i < 2; i++) assert.equal((await app.inject({ method: 'POST', url: publishUrl, headers: headers('a'), payload: publishBody })).statusCode, 200);
  assert.equal(uploads, 1);
  assert.equal((await app.inject({ method: 'POST', url: publishUrl, headers: headers('a'), payload: { ...publishBody,
    characterPackage: { ...content, character: { ...content.character, personality: 'changed' } } } })).statusCode, 409);
  assert.ok(!JSON.stringify((await db.query('SELECT * FROM package_uploads')).rows).includes('PRIVATE_PAID_PERSONA'));
});

test('package schema rejects relationship data and streamed byte limits work without Content-Length', async () => {
  const valid = { schemaVersion: 1, network: 'testnet', packageId: id('0x99'), listingId: id('0x10'),
    character: { name: 'Test', personality: 'Test' }, preview: { name: 'Test', personality: 'Test' } };
  assert.throws(() => packageSchema.parse({ ...valid, memories: ['private'] }));
  assert.throws(() => packageSchema.parse({ ...valid, character: { ...valid.character, ownerMemory: 'private' } }));
  assert.throws(() => packageSchema.parse({ ...valid, character: { ...valid.character, callName: 'private nickname' } }));
  assert.throws(() => packageSchema.parse({ ...valid, preview: { ...valid.preview, callName: 'private nickname' } }));
  assert.equal(packageSchema.parse({ ...valid, character: { ...valid.character, gender: '여성', relationshipType: '연인' } }).character.gender, '여성');
  assert.throws(() => packageSchema.parse({ ...valid, character: { ...valid.character, gender: 'invalid' } }));
  assert.throws(() => packageSchema.parse({ ...valid, character: { ...valid.character, relationshipType: 'private relationship history' } }));
  assert.throws(() => packageSchema.parse({ ...valid, episodes: [
    { id: 'one', title: 'First', setting: 'first setting' }, { id: 'one', title: 'Second', setting: 'different setting' },
  ] }));
  await assert.rejects(readBytes(new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(8)); c.enqueue(new Uint8Array(8)); c.close(); } })), 10), { statusCode: 413 });
});
