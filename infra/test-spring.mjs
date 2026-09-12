import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import pg from 'pg';

// Real PostgreSQL + Spring + wallet authentication. AI/image/market adapter responses are fixtures.
const root = resolve(import.meta.dirname, '..');
const container = `everyday-spring-test-${Date.now()}`;
const password = randomBytes(24).toString('hex');
const origin = 'http://127.0.0.1:3000';
const apiPort = 19311, springPort = 19312, fixturePort = 19313;
const api = `http://127.0.0.1:${apiPort}`, spring = `http://127.0.0.1:${springPort}`;
const children = []; let pool;
let failedImage = false;
let failedTraining = false, failedStarters = false;
let imageCalls = 0, llmCalls = 0;
let trainingCalls = 0, imageSoulId = null;
let portraitPrompt = '';
let memoryOwner = null, failedMemory = false, lastSystem = '';
let failedChain = false;
const listingId = `0x${'1'.repeat(64)}`;
const licenses = new Map();
const provider = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/v1/me/memory-account') {
    res.end(JSON.stringify({ account: memoryOwner === req.headers.authorization ? { enabled: true, accountId: 'fixture' } : null })); return;
  }
  if (req.url.startsWith('/v1/me/relationships/') && req.url.endsWith('/recall')) {
    if (failedMemory) { res.writeHead(503); res.end('{}'); return; }
    res.end(JSON.stringify({ results: memoryOwner === req.headers.authorization ? [{ text: 'APPROVED_PRIVATE_MEMORY' }] : [] })); return;
  }
  if (req.url.startsWith('/v1/market/listings/')) {
    const url = new URL(req.url, 'http://fixture.invalid');
    if (failedChain) { res.writeHead(503); res.end('{}'); return; }
    if (licenses.get(url.searchParams.get('licenseId')) !== req.headers.authorization) { res.writeHead(403); res.end('{}'); return; }
    res.end(JSON.stringify(url.pathname.endsWith('/character') ? { characterPackage: {
      network: 'testnet', listingId, character: { name: '작품', personality: '차분함', background: 'FICTIONAL_BACKGROUND',
        callName: 'CREATOR_PRIVATE', gender: '남성', relationshipType: '연인', speechStyles: ['차분한 존댓말'] }, examples: [{ role: 'assistant', content: 'FICTIONAL_EXAMPLE' }],
      episodes: [{ id: 'authored-night', title: '작가의 밤 산책', setting: 'PRIVATE_AUTHORED_EPISODE_SETTING' }],
    } } : { listingId, network: 'testnet' })); return;
  }
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
function run(command, args, env) {
  const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let tail = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', d => { tail = (tail + d).slice(-6000); });
  children.push(child); child.on('error', e => { tail += e.message; });
  return () => tail;
}
async function ready(url, logs) {
  const until = Date.now() + 90000;
  while (Date.now() < until) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw Error(`Not ready: ${url}\n${logs()}`);
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
  assert.equal(s.status, 200); return s.json.token;
}
async function ok(path, token, method, body) {
  const r = await request(path, token, method, body);
  assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.json)}`);
  assert.equal(r.json.success, true); return r.json.data;
}
try {
  await new Promise(r => provider.listen(fixturePort, '127.0.0.1', r));
  execFileSync('docker', ['run', '--detach', '--rm', '--name', container, '-e', `POSTGRES_PASSWORD=${password}`, '-p', '127.0.0.1::5432', 'postgres:17'], { stdio: 'pipe' });
  const mapping = execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }).trim();
  const dbPort = Number(mapping.split(':').at(-1));
  const connectionString = `postgresql://postgres:${password}@127.0.0.1:${dbPort}/postgres`;
  pool = new pg.Pool({ connectionString });
  for (let i = 0; ; i++) { try { await pool.query('SELECT 1'); break; } catch (e) { if (i === 40) throw e; await new Promise(r => setTimeout(r, 250)); } }
  const nodeLogs = run(process.execPath, ['--import', 'tsx', 'apps/api/src/server.ts'], {
    PORT: String(apiPort), API_HOST: '127.0.0.1', DATABASE_URL: connectionString, WEB_ORIGINS: origin, API_AUDIENCE: api,
    SPRING_API_URL: spring, SUI_MARKET_PACKAGE_ID: '', SUI_OPERATOR_KEY: '', MEMWAL_DELEGATE_MASTER_KEY: '',
    AI_API_KEY: '', AI_ENDPOINT: '', AI_MODEL: '', AGENT_GIFTS_ENABLED: '0',
  });
  await ready(api + '/health/live', nodeLogs);
  const localJava = resolve(root, '.local-tools/jdk-21.0.12.1+1/bin/java.exe');
  const java = process.env.JAVA_HOME ? resolve(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : existsSync(localJava) ? localJava : 'java';
  const springLogs = run(java, ['-jar', 'apps/api/spring/build/libs/everyday.jar'], {
    PORT: String(springPort), SPRING_PROFILES_ACTIVE: '', SPRING_DATASOURCE_URL: `jdbc:postgresql://127.0.0.1:${dbPort}/postgres`,
    SPRING_DATASOURCE_USERNAME: 'postgres', SPRING_DATASOURCE_PASSWORD: password, WALLET_AUTH_URL: api, WEB_ORIGINS: origin,
    ANTHROPIC_API_KEY: 'fixture-only', ANTHROPIC_BASE_URL: `http://127.0.0.1:${fixturePort}`,
    HIGGSFIELD_API_KEY: 'fixture-only', HIGGSFIELD_API_SECRET: 'fixture-only', HIGGSFIELD_BASE_URL: `http://127.0.0.1:${fixturePort}`,
    APP_MARKET_API_URL: `http://127.0.0.1:${fixturePort}`,
  });
  await ready(spring + '/health/ready', springLogs);
  await ready(api + '/health/ready', nodeLogs);
  assert.ok((await pool.query('SELECT version FROM everyday.flyway_schema_history WHERE success=true')).rows.some(row => row.version === '11'));
  const a = await login(), b = await login();
  assert.equal((await request('/api/characters/%69nterview', a, 'POST', { relationshipType: 'FRIEND', gender: 'MALE' })).status, 400);
  assert.equal((await request('/api/characters')).status, 401);
  assert.deepEqual(await ok('/api/characters', a), []);
  assert.equal((await ok('/api/me', a)).points, 1200);
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
  await ok(base + '/photo-jobs', a, 'POST', { requestId: failedJob, photo: { concept: 'CAFE_DATE' } });
  async function finished(job) {
    for (let i = 0; i < 60; i++) {
      const result = await ok('/api/photo-jobs/' + job, a);
      if (['failed', 'completed'].includes(result.status)) return result;
      await new Promise(r => setTimeout(r, 500));
    }
    throw Error('Photo job did not finish');
  }
  assert.equal((await finished(failedJob)).status, 'failed');
  assert.equal((await ok('/api/me', a)).points, 1200);
  failedImage = false;
  const photoRequest = { requestId: randomUUID(), photo: { concept: 'CAFE_DATE' } };
  const duplicate = await Promise.all([1, 2].map(() => request(base + '/photo-jobs', a, 'POST', photoRequest)));
  assert.deepEqual(duplicate.map(r => r.status), [200, 200]);
  assert.equal((await request('/api/photo-jobs/' + photoRequest.requestId, b)).status, 404);
  const concurrent = [duplicate[0], await request(base + '/photo-jobs', a, 'POST', { ...photoRequest, requestId: randomUUID() })];
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 402]);
  assert.equal((await finished(photoRequest.requestId)).status, 'completed');
  assert.equal(imageSoulId, 'fixture-soul');
  assert.equal((await ok('/api/me', a)).points, 0);
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
  memoryOwner = `Bearer ${a}`;
  await ok(ownBase + '/messages', a, 'POST', { content: 'Recall my approved preference' });
  assert.ok(lastSystem.includes('APPROVED_PRIVATE_MEMORY'));
  await ok(`/api/characters/${other.id}/messages`, b, 'POST', { content: 'My own conversation' });
  assert.ok(!lastSystem.includes('APPROVED_PRIVATE_MEMORY'));
  failedMemory = true;
  assert.equal((await request(ownBase + '/messages', a, 'POST', { content: 'MEMORY_FAILURE_MUST_ROLL_BACK' })).status, 503);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM everyday.chat_messages WHERE content=$1', ['MEMORY_FAILURE_MUST_ROLL_BACK'])).rows[0].count, 0);
  failedMemory = false; memoryOwner = null;
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
  memoryOwner = `Bearer ${a}`;
  const episodeBase = ownBase + `/episodes/${authoredEpisodes[0].id}`;
  await ok(episodeBase + '/start', a, 'POST', {});
  const episodeTurn = { requestId: randomUUID(), content: 'Remember during the authored episode' };
  const episodeAnswer = await ok(episodeBase + '/messages', a, 'POST', episodeTurn);
  assert.ok(lastSystem.includes('PRIVATE_AUTHORED_EPISODE_SETTING'));
  assert.ok(lastSystem.includes('APPROVED_PRIVATE_MEMORY'));
  const episodeCalls = llmCalls;
  assert.deepEqual(await ok(episodeBase + '/messages', a, 'POST', episodeTurn), episodeAnswer);
  assert.equal(llmCalls, episodeCalls);
  memoryOwner = null;
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
  console.log('PASS: PostgreSQL migrations; real wallet signatures; original product flow; failed-provider rollback; concurrent point protection; licensed import isolation; current entitlement failure closes access. AI/image/market adapter responses were fixtures, not live provider or settlement validation.');
} finally {
  for (const child of children.reverse()) { child.kill(); }
  if (pool) await pool.end();
  provider.closeAllConnections(); await new Promise(r => provider.close(r));
  try { execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' }); } catch {}
}
