import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import pg from 'pg';
import { buildApp } from '../apps/api/src/app.ts';
import { migration } from '../apps/api/src/database.ts';
import { failure } from '../apps/api/src/auth.ts';
import { productFromEnv } from '../apps/api/src/product/index.ts';
import { migrateProduct } from '../apps/api/src/product/migrations.ts';
import { seedEpisodeCatalog } from '../apps/api/src/product/episodes.ts';

// One Node API + real disposable PostgreSQL + real wallet signatures. AI/image HTTP responses and injected market/memory adapters are fixtures.
const container = `everyday-product-test-${Date.now()}`;
const password = randomBytes(24).toString('hex');
const suppliedDatabaseUrl = process.env.PRODUCT_TEST_DATABASE_URL;
let dockerStarted = false;
const origin = 'http://127.0.0.1:3000';
let api, fixturePort, app, pool;
const wallets = new Map();
let failedImage = false;
let failedTraining = false, failedStarters = false;
let imageCalls = 0, llmCalls = 0;
let trainingCalls = 0, imageSoulId = null;
let portraitPrompt = '';
let memoryOwner = null, failedMemory = false, lastSystem = '';
let failedChain = false;
const listingId = `0x${'1'.repeat(64)}`;
const licenses = new Map();
const photoPaymentOwners = new Map();
const provider = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/v1/messages') {
    lastSystem = body.system;
    llmCalls++;
    if (failedStarters && body.system.includes('대화 시작 문장을 추천')) { res.writeHead(502); res.end('{}'); return; }
    let text = '서버 통합 테스트 응답';
    if (body.system.includes('인터뷰어')) text = JSON.stringify({ category: '성격', question: '어떤 성격인가요?', suggestedAnswers: ['차분함'], done: false });
    if (body.system.includes('설정을 완성하는 작가')) text = JSON.stringify({ summary: '서버 테스트 캐릭터', appearance: '검은 머리', personality: '차분함', speechStyles: ['짧은 반말'], imagePrompt: 'fictional test portrait', examples: [{ role: 'user', content: 'FICTIONAL_AUTHORED_QUESTION' }, { role: 'assistant', content: 'FICTIONAL_AUTHORED_ANSWER' }] });
    if (body.system.includes('대화 시작 문장을 추천')) text = JSON.stringify(['산책할까?', '오늘 어땠어?']);
    if (body.messages?.some(m => m.content.includes('FAIL_PROVIDER'))) { res.writeHead(502); res.end('{}'); return; }
    res.end(JSON.stringify({ content: [{ type: 'text', text }] })); return;
  }
  if (req.url === '/v1/text2image/soul') {
    imageCalls++; portraitPrompt = body.params.prompt;
    imageSoulId = body.params.custom_reference_id ?? null;
    if (failedImage) { res.writeHead(502); res.end('{}'); return; }
    res.end(JSON.stringify({ id: `job-${body.params.batch_size}` })); return;
  }
  if (req.url.startsWith('/v1/job-sets/job-')) {
    const count = Number(req.url.split('-').at(-1));
    res.end(JSON.stringify({ jobs: Array.from({ length: count }, (_, i) => ({ status: 'completed', results: { raw: { url: `https://fixture.invalid/portrait-${i}.png` } } })) })); return;
  }
  if (req.url === '/v1/custom-references') {
    trainingCalls++;
    if (failedTraining) { res.writeHead(502); res.end('{}'); return; }
    res.end(JSON.stringify({ id: 'fixture-soul', status: 'pending' })); return;
  }
  if (req.url === '/v1/custom-references/fixture-soul') { res.end(JSON.stringify({ id: 'fixture-soul', status: 'completed' })); return; }
  res.writeHead(404); res.end('{}');
});
const marketPackageId = `0x${'9'.repeat(64)}`;
const operator = `0x${'8'.repeat(64)}`;
const sourcePackage = { schemaVersion: 1, packageId: marketPackageId,
  network: 'testnet', listingId, character: { name: '작품', personality: '차분함', background: 'FICTIONAL_BACKGROUND',
    callName: 'CREATOR_PRIVATE', gender: '남성', relationshipType: '연인', speechStyles: ['차분한 존댓말'] },
  examples: [{ role: 'assistant', content: 'FICTIONAL_EXAMPLE' }],
  episodes: [{ id: 'authored-night', title: '작가의 밤 산책', setting: 'PRIVATE_AUTHORED_EPISODE_SETTING' }],
};
sourcePackage.preview = { name: sourcePackage.character.name, personality: sourcePackage.character.personality };
const chain = {
  packageId: marketPackageId,
  async listing(id) {
    if (failedChain) throw failure(503, 'CHAIN_UNAVAILABLE');
    if (id !== listingId) throw failure(404, 'LISTING_NOT_FOUND');
    return { id, creator: `0x${'7'.repeat(64)}`, operator, title: 'Fixture listing', priceMist: '100', agentBps: 2000,
      treasuryMist: '0', published: true, active: true,
      package: { blobId: 'fixture-package', contentHash: '0'.repeat(64), endEpoch: '999' },
      policy: { perGiftLimitMist: '0', dailyLimitMist: '0', allowedGiftIds: [] } };
  },
  async hasLicense(actor, requestedListing, licenseId) {
    if (failedChain) throw failure(503, 'CHAIN_UNAVAILABLE');
    const token = licenses.get(licenseId)?.replace(/^Bearer /, '');
    return requestedListing === listingId && wallets.get(token) === actor;
  },
};
const packages = {
  operator,
  async load(listing) { assert.equal(listing.id, listingId); return structuredClone(sourcePackage); },
  async publish() { throw Error('Package publication is outside the product migration fixture'); },
};
const memory = {
  async verify(owner, account) {
    assert.equal(owner, wallets.get(memoryOwner?.replace(/^Bearer /, '')));
    assert.equal(account, 'fixture');
  },
  async recall(owner, account, requestedListing) {
    if (failedMemory) throw failure(503, 'MEMORY_UNAVAILABLE');
    await this.verify(owner, account);
    assert.equal(requestedListing, listingId);
    return { results: [{ text: 'APPROVED_PRIVATE_MEMORY', blob_id: 'fixture', distance: 0 }], total: 1 };
  },
  async setup() { throw Error('Unused fixture operation'); },
  async remember() { throw Error('Unused fixture operation'); },
  async status() { throw Error('Unused fixture operation'); },
};
async function enableMemory(token) {
  memoryOwner = token ? `Bearer ${token}` : null;
  await pool.query('UPDATE public.memory_accounts SET enabled=false');
  if (token) await pool.query(`INSERT INTO public.memory_accounts(owner,account_id,enabled) VALUES($1,'fixture',true)
    ON CONFLICT(owner) DO UPDATE SET enabled=true`, [wallets.get(token)]);
}
async function startApi() {
  const product = { ...productFromEnv({
    ANTHROPIC_API_KEY: 'fixture-only', ANTHROPIC_BASE_URL: `http://127.0.0.1:${fixturePort}`,
    HIGGSFIELD_API_KEY: 'fixture-only', HIGGSFIELD_API_SECRET: 'fixture-only', HIGGSFIELD_BASE_URL: `http://127.0.0.1:${fixturePort}`,
  }), photoPayments: {
    priceMist: '10000000',
    async transaction() { return 'fixture-photo-payment'; },
    async verify(digest, sender) { assert.equal(photoPaymentOwners.get(digest), sender); },
  } };
  app = buildApp(false, { db: pool, auth: { origins: [origin], audience: 'everyday-product-integration', network: 'testnet' },
    product, market: chain, runtime: { packages, previewTurns: 2 }, memory });
  api = await app.listen({ port: 0, host: '127.0.0.1' });
  assert.equal((await fetch(api + '/health/ready')).status, 200);
}
async function request(path, token, method = 'GET', body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(api + path, { method, headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = response.status === 204 ? null : await response.json();
    const retryAfter = response.headers.get('retry-after');
    // Run the full product suite against the real production request limit.
    // Only the pre-handler HTTP quota has this header; never retry AI budgets,
    // uncertain provider calls, or a request that reached the product handler.
    if (response.status === 429 && retryAfter && /^\d+$/.test(retryAfter) && Number(retryAfter) <= 60 && attempt < 2) {
      console.log('Pacing product integration requests for the HTTP quota window.');
      await new Promise(resolve => setTimeout(resolve, (Number(retryAfter) + 1) * 1000));
      continue;
    }
    return { status: response.status, json };
  }
}
async function login() {
  const key = new Ed25519Keypair();
  const c = await request('/v1/auth/challenges', null, 'POST', { address: key.toSuiAddress(), network: 'testnet' });
  assert.equal(c.status, 200);
  const signed = await key.signPersonalMessage(new TextEncoder().encode(c.json.message));
  const s = await request('/v1/auth/sessions', null, 'POST', { challengeId: c.json.id, signature: signed.signature });
  assert.equal(s.status, 200); wallets.set(s.json.token, key.toSuiAddress()); return s.json.token;
}
async function ok(path, token, method, body) {
  const r = await request(path, token, method, body);
  assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.json)}`);
  assert.equal(r.json.success, true); return r.json.data;
}
try {
  await new Promise(r => provider.listen(0, '127.0.0.1', r));
  fixturePort = provider.address().port;
  let connectionString = suppliedDatabaseUrl;
  if (!connectionString) {
    execFileSync('docker', ['run', '--detach', '--rm', '--name', container, '-e', `POSTGRES_PASSWORD=${password}`, '-p', '127.0.0.1::5432', 'postgres:17'], { stdio: 'pipe', timeout: 120000 });
    dockerStarted = true;
    const mapping = execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8', timeout: 120000 }).trim();
    const dbPort = Number(mapping.split(':').at(-1));
    connectionString = `postgresql://postgres:${password}@127.0.0.1:${dbPort}/postgres`;
  }
  pool = new pg.Pool({ connectionString });
  for (let i = 0; ; i++) { try { await pool.query('SELECT 1'); break; } catch (e) { if (i === 40) throw e; await new Promise(r => setTimeout(r, 250)); } }
  await pool.query(migration);
  await migrateProduct(pool);
  await seedEpisodeCatalog(pool);
  await startApi();
  assert.ok((await pool.query('SELECT version FROM everyday.flyway_schema_history WHERE success=true')).rows.some(row => row.version === '11'));
  const a = await login(), b = await login();
  assert.equal((await request('/api/characters/%69nterview', a, 'POST', { relationshipType: 'FRIEND', gender: 'MALE' })).status, 400);
  assert.equal((await request('/api/characters')).status, 401);
  assert.deepEqual(await ok('/api/characters', a), []);
  assert.equal('points' in await ok('/api/me', a), false);
  await ok('/api/characters/interview', a, 'POST', { relationshipType: 'FRIEND', gender: 'MALE' });
  const compilation = { requestId: randomUUID(), name: '테스트', relationshipType: 'FRIEND', gender: 'MALE', deferPortraitGeneration: true };
  const created = await ok('/api/characters/compile', a, 'POST', compilation);
  const compiledCalls = llmCalls;
  assert.deepEqual(await ok('/api/characters/compile', a, 'POST', compilation), created);
  assert.equal(llmCalls, compiledCalls);
  assert.equal((await ok('/api/characters', a)).length, 1);
  assert.equal((await request('/api/characters/compile', a, 'POST', { ...compilation, name: '다른 요청' })).status, 409);
  const id = created.character.id, base = `/api/characters/${id}`;
  assert.equal((await ok(base + '/portrait-status', a)).status, 'draft');
  assert.equal(imageCalls, 0);
  for (let i = 0; i < 2; i++) await ok(base + '/portraits', a, 'POST', { style: 'TEST_STYLE_REQUEST' });
  assert.equal((await request(base + '/portraits', b, 'POST', { style: 'test' })).status, 403);
  let photos;
  for (let i = 0; i < 40; i++) { photos = await ok(base + '/gallery', a); if (photos.length === 4) break; await new Promise(r => setTimeout(r, 250)); }
  assert.equal(photos.length, 4);
  assert.equal(imageCalls, 1); assert.ok(portraitPrompt.includes('TEST_STYLE_REQUEST'));
  await ok(base + '/select-portrait', a, 'POST', { photoId: photos[0].id });
  assert.equal((await ok(base + '/train-face', a, 'POST', {})).soulTrained, false);
  assert.equal((await ok(base + '/train-face', a, 'POST', {})).soulTrained, true);
  assert.equal(trainingCalls, 1);
  await ok(base, a, 'PATCH', { personality: '따뜻함' });
  await ok(base + '/call-name', a, 'PATCH', { callName: '친구야' });
  const stored = await pool.query('SELECT system_prompt FROM everyday.characters WHERE id=$1', [id]);
  assert.ok(stored.rows[0].system_prompt.includes('친구야'));
  const draft = await ok(base + '/product-draft', a);
  assert.ok(!('callName' in draft) && !('systemPrompt' in draft) && !('messages' in draft) && !('userId' in draft));
  assert.equal(draft.examples[1].content, 'FICTIONAL_AUTHORED_ANSWER');
  assert.ok(stored.rows[0].system_prompt.includes('FICTIONAL_AUTHORED_ANSWER'));
  assert.equal((await request(base, b)).status, 403);
  assert.deepEqual(await ok('/api/characters', b), []);
  const beforeHistory = llmCalls;
  assert.deepEqual(await ok(base + '/messages/history', a), []);
  assert.equal(llmCalls, beforeHistory);
  assert.deepEqual(await ok(base + '/messages', a), []);
  assert.equal(llmCalls, beforeHistory);
  const greeting = { requestId: randomUUID() };
  const firstGreeting = await ok(base + '/greeting', a, 'POST', greeting);
  const greetingCalls = llmCalls;
  assert.deepEqual(await ok(base + '/greeting', a, 'POST', greeting), firstGreeting);
  assert.equal(llmCalls, greetingCalls);
  await ok(base + '/messages', a, 'POST', { content: '안녕' });
  assert.deepEqual((await ok(base + '/product-draft', a)).examples, draft.examples);
  assert.equal((await ok(base + '/messages', a)).length, 3);
  const concurrentTurns = await Promise.all(['CONCURRENT_ONE', 'CONCURRENT_TWO'].map(content =>
    request(base + '/messages', a, 'POST', { requestId: randomUUID(), content })));
  assert.deepEqual(concurrentTurns.map(item => item.status), [200, 200]);
  const serialized = await pool.query('SELECT sender FROM everyday.chat_messages WHERE character_id=$1 AND character_episode_id IS NULL ORDER BY id DESC LIMIT 4', [id]);
  assert.deepEqual(serialized.rows.map(item => item.sender), ['AI', 'USER', 'AI', 'USER']);
  const before = (await ok(base + '/messages', a)).length;
  assert.equal((await request(base + '/messages', a, 'POST', { content: 'FAIL_PROVIDER' })).status, 502);
  assert.equal((await ok(base + '/messages', a)).length, before);
  const episode = (await ok('/api/episodes', a))[0].id;
  const startedEpisode = await ok(base + `/episodes/${episode}/start`, a, 'POST', {});
  const starterCalls = llmCalls;
  assert.deepEqual(await ok(base + `/episodes/${episode}/start`, a, 'POST', {}), startedEpisode);
  assert.equal(llmCalls, starterCalls);
  await ok(base + `/episodes/${episode}/messages`, a, 'POST', { content: '산책하자' });
  failedImage = true;
  const failedJob = randomUUID();
  const failedPayment = '2'.repeat(43);
  photoPaymentOwners.set(failedPayment, wallets.get(a));
  await ok(base + '/photo-jobs', a, 'POST', { requestId: failedJob, paymentDigest: failedPayment, photo: { concept: 'CAFE_DATE' } });
  async function finished(job) {
    for (let i = 0; i < 60; i++) {
      const result = await ok('/api/photo-jobs/' + job, a);
      if (['failed', 'completed'].includes(result.status)) return result;
      await new Promise(r => setTimeout(r, 500));
    }
    throw Error('Photo job did not finish');
  }
  assert.equal((await finished(failedJob)).status, 'failed');
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM photo_payments WHERE digest=$1', [failedPayment])).rows[0].count, 1);
  failedImage = false;
  const successfulPayment = '3'.repeat(43);
  photoPaymentOwners.set(successfulPayment, wallets.get(a));
  const photoRequest = { requestId: randomUUID(), paymentDigest: successfulPayment, photo: { concept: 'CAFE_DATE' } };
  const duplicate = await Promise.all([1, 2].map(() => request(base + '/photo-jobs', a, 'POST', photoRequest)));
  assert.deepEqual(duplicate.map(r => r.status), [200, 200]);
  assert.equal((await request('/api/photo-jobs/' + photoRequest.requestId, b)).status, 404);
  assert.equal((await request(base + '/photo-jobs', a, 'POST', { ...photoRequest, requestId: randomUUID() })).status, 409);
  assert.equal((await finished(photoRequest.requestId)).status, 'completed');
  assert.equal(imageSoulId, 'fixture-soul');
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM photo_payments')).rows[0].count, 2);
  const constraints = await pool.query("SELECT count(*)::int AS count FROM information_schema.table_constraints WHERE constraint_schema='everyday' AND constraint_type='FOREIGN KEY'");
  assert.ok(constraints.rows[0].count >= 6);
  const licenseA = `0x${'a'.repeat(64)}`, licenseB = `0x${'b'.repeat(64)}`;
  licenses.set(licenseA, `Bearer ${a}`); licenses.set(licenseB, `Bearer ${b}`);
  assert.equal((await request('/api/library', b, 'POST', { listingId, licenseId: licenseA })).status, 403);
  const imported = await ok('/api/library', a, 'POST', { listingId, licenseId: licenseA });
  const other = await ok('/api/library', b, 'POST', { listingId, licenseId: licenseB });
  assert.notEqual(imported.id, other.id); assert.equal(imported.callName, null); assert.equal(other.callName, null);
  assert.equal(imported.readOnlySettings, true);
  assert.equal(imported.gender, '남성'); assert.equal(imported.relationshipType, '연인');
  assert.equal((await ok('/api/library', a, 'POST', { listingId, licenseId: licenseA })).id, imported.id);
  const ownBase = `/api/characters/${imported.id}`;
  assert.deepEqual(await ok(`/api/library/${imported.id}/license`, a), { listingId, licenseId: licenseA });
  assert.equal((await request(`/api/library/${imported.id}/license`, b)).status, 403);
  await ok(ownBase + '/call-name', a, 'PATCH', { callName: 'MY_PRIVATE_NICKNAME' });
  const copy = await pool.query('SELECT system_prompt FROM everyday.characters WHERE id=$1', [imported.id]);
  assert.ok(copy.rows[0].system_prompt.includes('FICTIONAL_BACKGROUND'));
  assert.ok(copy.rows[0].system_prompt.includes('FICTIONAL_EXAMPLE'));
  assert.ok(!copy.rows[0].system_prompt.includes('CREATOR_PRIVATE'));
  const paidTurn = { requestId: randomUUID(), content: 'MY_PRIVATE_MESSAGE' };
  const firstAnswer = await ok(ownBase + '/messages', a, 'POST', paidTurn);
  const paidCalls = llmCalls;
  assert.deepEqual(await ok(ownBase + '/messages', a, 'POST', paidTurn), firstAnswer);
  assert.equal(llmCalls, paidCalls);
  assert.equal((await request(ownBase + '/messages', a, 'POST', { ...paidTurn, content: 'CHANGED_SAME_REQUEST' })).status, 409);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM everyday.chat_messages WHERE character_id=$1 AND content=$2', [imported.id, paidTurn.content])).rows[0].count, 1);
  const unknownTurn = { requestId: randomUUID(), content: 'FAIL_PROVIDER' };
  assert.equal((await request(ownBase + '/messages', a, 'POST', unknownTurn)).status, 502);
  const unknownCalls = llmCalls;
  assert.equal((await request(ownBase + '/messages', a, 'POST', unknownTurn)).status, 503);
  assert.equal(llmCalls, unknownCalls);
  const otherMessages = await pool.query('SELECT content FROM everyday.chat_messages WHERE character_id=$1', [other.id]);
  assert.deepEqual(otherMessages.rows, []);
  await enableMemory(a);
  await ok(ownBase + '/messages', a, 'POST', { content: 'Recall my approved preference' });
  assert.ok(lastSystem.includes('APPROVED_PRIVATE_MEMORY'));
  await ok(`/api/characters/${other.id}/messages`, b, 'POST', { content: 'My own conversation' });
  assert.ok(!lastSystem.includes('APPROVED_PRIVATE_MEMORY'));
  failedMemory = true;
  assert.equal((await request(ownBase + '/messages', a, 'POST', { content: 'MEMORY_FAILURE_MUST_ROLL_BACK' })).status, 503);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM everyday.chat_messages WHERE content=$1', ['MEMORY_FAILURE_MUST_ROLL_BACK'])).rows[0].count, 0);
  failedMemory = false; await enableMemory(null);
  const engagement = (await pool.query('SELECT * FROM everyday.market_engagement WHERE listing_id=$1', [listingId])).rows[0];
  assert.equal(engagement.turns, '3'); assert.equal(engagement.readers, '2'); assert.equal(engagement.returning_readers, '0');
  assert.ok(!('user_id' in engagement) && !('content' in engagement));
  const authoredEpisodes = await ok(ownBase + '/episodes', a);
  assert.equal(authoredEpisodes.length, 1);
  assert.equal(authoredEpisodes[0].title, '작가의 밤 산책');
  const publicEpisodes = await ok('/api/episodes', b);
  assert.ok(!JSON.stringify(publicEpisodes).includes('PRIVATE_AUTHORED_EPISODE_SETTING'));
  assert.ok(!publicEpisodes.some(item => item.id === authoredEpisodes[0].id));
  assert.equal((await request(base + `/episodes/${authoredEpisodes[0].id}/start`, a, 'POST', {})).status, 403);
  await enableMemory(a);
  const episodeBase = ownBase + `/episodes/${authoredEpisodes[0].id}`;
  await ok(episodeBase + '/start', a, 'POST', {});
  const episodeTurn = { requestId: randomUUID(), content: 'Remember during the authored episode' };
  const episodeAnswer = await ok(episodeBase + '/messages', a, 'POST', episodeTurn);
  assert.ok(lastSystem.includes('PRIVATE_AUTHORED_EPISODE_SETTING'));
  assert.ok(lastSystem.includes('APPROVED_PRIVATE_MEMORY'));
  const episodeCalls = llmCalls;
  assert.deepEqual(await ok(episodeBase + '/messages', a, 'POST', episodeTurn), episodeAnswer);
  assert.equal(llmCalls, episodeCalls);
  await enableMemory(null);
  assert.equal((await request(ownBase, a, 'PATCH', { personality: 'modified' })).status, 403);
  assert.equal((await request(ownBase + '/product-draft', a)).status, 403);
  failedChain = true;
  assert.equal((await request(ownBase + '/messages', a, 'POST', { content: 'must fail closed' })).status, 503);
  failedChain = false;
  assert.equal((await request(ownBase + '/messages', b)).status, 403);
  const recoveryCharacter = await ok('/api/characters/compile', b, 'POST', { ...compilation, requestId: randomUUID(), name: '복구 검증' });
  const recoveryBase = `/api/characters/${recoveryCharacter.character.id}`;
  await ok(recoveryBase + '/portraits', b, 'POST', { style: 'fixture recovery' });
  let recoveryPhotos;
  for (let i = 0; i < 40; i++) {
    recoveryPhotos = await ok(recoveryBase + '/gallery', b);
    if (recoveryPhotos.length === 4) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(recoveryPhotos.length, 4);
  await ok(recoveryBase + '/select-portrait', b, 'POST', { photoId: recoveryPhotos[0].id });
  failedTraining = true;
  assert.equal((await request(recoveryBase + '/train-face', b, 'POST', {})).status, 502);
  const uncertainTrainingCalls = trainingCalls;
  assert.equal((await request(recoveryBase + '/train-face', b, 'POST', {})).status, 503);
  assert.equal(trainingCalls, uncertainTrainingCalls);
  failedTraining = false; failedStarters = true;
  assert.equal((await request(recoveryBase + `/episodes/${episode}/start`, b, 'POST', {})).status, 502);
  const uncertainStarterCalls = llmCalls;
  assert.equal((await request(recoveryBase + `/episodes/${episode}/start`, b, 'POST', {})).status, 503);
  assert.equal(llmCalls, uncertainStarterCalls);
  failedStarters = false;
  // Restart against the same database and existing migration history. No new
  // wallet/user, template, message or provider call should appear on recovery.
  const historyBeforeRestart = await ok(base + '/messages/history', a);
  const identityBeforeRestart = await ok('/api/me', a);
  const importedBeforeRestart = await ok(ownBase, a);
  const usersBeforeRestart = (await pool.query('SELECT * FROM everyday.users ORDER BY id')).rows;
  const migrationsBeforeRestart = (await pool.query('SELECT * FROM everyday.flyway_schema_history ORDER BY installed_rank')).rows;
  const episodesBeforeRestart = (await pool.query('SELECT * FROM everyday.episodes ORDER BY id')).rows;
  const messagesBeforeRestart = (await pool.query('SELECT * FROM everyday.chat_messages ORDER BY id')).rows;
  const callsBeforeRestart = { llmCalls, imageCalls, trainingCalls };
  await app.close();
  app = undefined;
  await migrateProduct(pool);
  await seedEpisodeCatalog(pool);
  await startApi();
  assert.deepEqual(await ok('/api/me', a), identityBeforeRestart);
  assert.deepEqual(await ok(ownBase, a), importedBeforeRestart);
  assert.deepEqual(await ok(base + '/messages/history', a), historyBeforeRestart);
  assert.deepEqual(await ok(base + '/greeting', a, 'POST', greeting), firstGreeting);
  assert.deepEqual(await ok(ownBase + '/messages', a, 'POST', paidTurn), firstAnswer);
  assert.deepEqual(await ok(base + `/episodes/${episode}/start`, a, 'POST', {}), startedEpisode);
  assert.deepEqual((await pool.query('SELECT * FROM everyday.users ORDER BY id')).rows, usersBeforeRestart);
  assert.deepEqual((await pool.query('SELECT * FROM everyday.flyway_schema_history ORDER BY installed_rank')).rows, migrationsBeforeRestart);
  assert.deepEqual((await pool.query('SELECT * FROM everyday.episodes ORDER BY id')).rows, episodesBeforeRestart);
  assert.deepEqual((await pool.query('SELECT * FROM everyday.chat_messages ORDER BY id')).rows, messagesBeforeRestart);
  assert.deepEqual({ llmCalls, imageCalls, trainingCalls }, callsBeforeRestart);
  // The database belongs only to this disposable test container. Exercise real
  // concurrent connections; PGlite's serialized queries do not prove row locks.
  await pool.query('TRUNCATE public.ai_global_daily_budget,public.ai_daily_budget,public.market_preview_budget');
  const reserve = (actor, ownerLimit, globalLimit, listing = null, previewLimit = null) =>
    pool.query('SELECT public.reserve_ai_budget($1,$2,$3,$4,$5) AS result', [actor, ownerLimit, globalLimit, listing, previewLimit]);
  const quotaRace = await Promise.all(Array.from({ length: 20 }, (_, i) => reserve(`fixture-${i % 5}`, 2, 7)));
  assert.equal(quotaRace.filter(item => item.rows[0].result === 'ok').length, 7);
  assert.equal((await pool.query('SELECT used FROM public.ai_global_daily_budget')).rows[0].used, 7);
  assert.equal((await pool.query('SELECT sum(used)::int AS total,max(used) AS largest FROM public.ai_daily_budget')).rows[0].total, 7);
  assert.ok((await pool.query('SELECT max(used) AS largest FROM public.ai_daily_budget')).rows[0].largest <= 2);
  await pool.query('TRUNCATE public.ai_global_daily_budget,public.ai_daily_budget,public.market_preview_budget');
  const previewRace = await Promise.all(Array.from({ length: 6 }, () => reserve('fixture-preview', 100, 100, listingId, 2)));
  assert.deepEqual(previewRace.map(item => item.rows[0].result).sort(), ['ok', 'ok', 'preview', 'preview', 'preview', 'preview']);
  assert.equal((await pool.query('SELECT used FROM public.ai_global_daily_budget')).rows[0].used, 2);
  assert.equal((await pool.query('SELECT used FROM public.market_preview_budget')).rows[0].used, 2);
  console.log('PASS: One Node runtime; PostgreSQL migrations and restart continuity; real wallet signatures; original product flow; failed-provider rollback; SUI photo-payment idempotency; concurrent quota protection; licensed import isolation; current entitlement failure closes access. AI/image/market adapter responses were fixtures, not live provider or settlement validation.');
} finally {
  if (app) await app.close();
  if (pool) await pool.end();
  provider.closeAllConnections(); await new Promise(r => provider.close(r));
  if (dockerStarted) try { execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore', timeout: 120000 }); } catch {}
}
