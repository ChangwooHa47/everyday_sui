import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { PGlite } from '@electric-sql/pglite';
import { hash } from '../src/auth.js';
import { migration } from '../src/database.js';
import { migrateProduct } from '../src/product/migrations.js';
import { createProductContext } from '../src/product/context.js';
import { productError } from '../src/product/core.js';
import { characterAge, compileFingerprint, registerProductCharacters, validProfileEmail } from '../src/product/characters.js';

test('ported character product preserves compilation, private draft boundaries, ownership, and durable retry states', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(migration);
  await migrateProduct(db);
  const origin = 'http://127.0.0.1:3000', token = 'c'.repeat(43), otherToken = 'd'.repeat(43);
  const owner = `0x${'a'.repeat(64)}`, other = `0x${'b'.repeat(64)}`;
  await db.query('INSERT INTO wallet_sessions VALUES($1,$2,$3,now()+interval \'30 minutes\'),($4,$5,$3,now()+interval \'30 minutes\')', [hash(token), owner, origin, hash(otherToken), other]);
  let calls = 0, configured = true, malformed = false;
  const prompts: string[] = [];
  const ctx = createProductContext(db, { origins: [origin], audience: 'test', network: 'testnet' }, {
    llm: { requireConfigured() { if (!configured) throw productError('LLM_API_ERROR'); }, async chat(system) {
      calls++; prompts.push(system);
      if (malformed) return '{invalid provider output';
      return JSON.stringify({ summary: '한 줄 소개', appearance: '흑발', personality: '다정함', speechStyles: ['짧고 편하게'], imagePrompt: 'portrait fixture',
        examples: [{ role: 'user', content: '가상의 질문' }, { role: 'assistant', content: '가상의 답변' }] });
    } }, image: { requireConfigured() {}, async generateImages() { return []; }, async trainSoul() { return 'fixture'; }, async soulReady() { return false; } },
  });
  const app = Fastify();
  app.setErrorHandler((error, _req, reply) => reply.code((error as { statusCode?: number }).statusCode ?? 500).send({ success: false, data: null, message: (error as Error).message }));
  registerProductCharacters(app, ctx);
  t.after(() => app.close());
  const headers = { origin, authorization: `Bearer ${token}` }, otherHeaders = { origin, authorization: `Bearer ${otherToken}` };
  const input = { relationshipType: '친구', gender: '남성', name: '테스트', birthday: '2000-01-02', freeText: '가상 설정', requestId: randomUUID(), deferPortraitGeneration: true };
  const compile = (payload = input) => app.inject({ method: 'POST', url: '/api/characters/compile', headers, payload });
  assert.equal((await app.inject({ method: 'GET', url: '/api/characters', headers: { origin } })).statusCode, 401);
  assert.equal((await compile({ ...input, gender: 'invalid' })).statusCode, 400);
  assert.equal(calls, 0);
  const response = await compile(); assert.equal(response.statusCode, 200, response.body);
  const character = response.json().data.character, id = character.id;
  assert.equal(character.name, '테스트'); assert.equal(character.gender, '남성'); assert.equal(character.birthday, '2000-01-02');
  assert.equal(character.soulTrained, false); assert.deepEqual(response.json().data.candidatePortraits, []);
  assert.equal((await db.query<{ status: string }>('SELECT status FROM everyday.portrait_jobs WHERE character_id=$1', [id])).rows[0].status, 'draft');
  assert.match(prompts[0], /가상 대화 두 쌍/);
  const again = await compile(); assert.equal(again.statusCode, 200); assert.equal(again.json().data.character.id, id); assert.equal(calls, 1);
  assert.equal((await compile({ ...input, name: '다른 요청' })).statusCode, 409);
  assert.equal((await app.inject({ method: 'POST', url: '/api/characters/compile', headers: otherHeaders, payload: input })).statusCode, 409);
  assert.equal((await app.inject({ method: 'GET', url: `/api/characters/${id}`, headers: otherHeaders })).statusCode, 403);
  const callName = await app.inject({ method: 'PATCH', url: `/api/characters/${id}/call-name`, headers, payload: { callName: '사적인 호칭' } });
  assert.equal(callName.statusCode, 200, callName.body);
  await db.query("INSERT INTO everyday.chat_messages(character_id,sender,content,created_at,updated_at) VALUES($1,'USER','사적인 대화',now(),now())", [id]);
  const updated = await app.inject({ method: 'PATCH', url: `/api/characters/${id}`, headers, payload: { personality: '차분함', speechStyles: ['존댓말'] } });
  assert.equal(updated.statusCode, 200, updated.body);
  const storedPrompt = (await db.query<{ system_prompt: string }>('SELECT system_prompt FROM everyday.characters WHERE id=$1', [id])).rows[0].system_prompt;
  assert.match(storedPrompt, /차분함/); assert.match(storedPrompt, /사적인 호칭/); assert.match(storedPrompt, /가상의 답변/);
  const draft = await app.inject({ method: 'GET', url: `/api/characters/${id}/product-draft`, headers });
  assert.equal(draft.statusCode, 200);
  assert.deepEqual(Object.keys(draft.json().data).sort(), ['appearance', 'examples', 'gender', 'imageUrl', 'name', 'personality', 'relationshipType', 'speechStyles', 'summary']);
  assert.equal(draft.body.includes('사적인'), false); assert.match(draft.body, /가상의 답변/);
  assert.equal((await app.inject({ method: 'GET', url: `/api/characters/${id}/gallery`, headers: otherHeaders })).statusCode, 403);
  const firstPhoto = (await db.query<{ id: number }>("INSERT INTO everyday.photos(character_id,type,image_url,selected) VALUES($1,'PROFILE','https://images.invalid/one',true) RETURNING id", [id])).rows[0].id;
  const secondPhoto = (await db.query<{ id: number }>("INSERT INTO everyday.photos(character_id,type,image_url) VALUES($1,'PROFILE','https://images.invalid/two') RETURNING id", [id])).rows[0].id;
  assert.equal((await app.inject({ method: 'POST', url: `/api/characters/${id}/select-portrait`, headers: otherHeaders, payload: { photoId: secondPhoto } })).statusCode, 403);
  const selected = await app.inject({ method: 'POST', url: `/api/characters/${id}/select-portrait`, headers, payload: { photoId: secondPhoto } });
  assert.equal(selected.statusCode, 200); assert.equal(selected.json().data.profileImageUrl, 'https://images.invalid/two');
  assert.equal((await db.query<{ selected: boolean }>('SELECT selected FROM everyday.photos WHERE id=$1', [firstPhoto])).rows[0].selected, false);
  const me = await app.inject({ method: 'GET', url: '/api/me', headers });
  assert.equal(me.json().data.points, 1200); assert.equal(me.json().data.subscriptionTier, 'Free'); assert.equal(me.json().data.characters.length, 1);
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/me', headers, payload: { email: 'first@example.test' } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/me', headers: otherHeaders, payload: { email: 'first@example.test' } })).statusCode, 409);
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/me', headers, payload: { email: 'bad' } })).statusCode, 400);
  configured = false;
  const missingConfig = { ...input, requestId: randomUUID() };
  assert.equal((await compile(missingConfig)).statusCode, 502);
  assert.equal((await db.query('SELECT * FROM everyday.character_compile_requests WHERE request_id=$1', [missingConfig.requestId])).rows.length, 0);
  configured = true; malformed = true;
  const uncertain = { ...input, requestId: randomUUID() };
  assert.equal((await compile(uncertain)).statusCode, 502);
  const callsAfterFailure = calls;
  assert.equal((await compile(uncertain)).statusCode, 503); assert.equal(calls, callsAfterFailure);
  assert.equal((await db.query('SELECT * FROM everyday.characters')).rows.length, 1);
  const claims = JSON.stringify((await db.query('SELECT * FROM everyday.character_compile_requests')).rows);
  assert.equal(claims.includes('가상 설정'), false);
});

test('character age retains birthdays rather than rounding elapsed milliseconds', () => {
  assert.equal(characterAge(null, new Date(2026, 8, 12)), 0);
  assert.equal(characterAge('2000-09-13', new Date(2026, 8, 12, 23, 59, 59)), 25);
  assert.equal(characterAge(new Date(2000, 8, 12), new Date(2026, 8, 12)), 26);
});

test('compile fingerprint matches the deployed Java record serialization for existing request retries', () => {
  // Captured from the existing everyday.jar's CompileRequest and Jackson JavaTimeModule,
  // using Spring's ISO-date setting. Unspecified record fields serialize as null/false.
  assert.equal(compileFingerprint({ relationshipType: 'FRIEND', gender: 'MALE', name: '테스트', birthday: '2000-02-29',
    requestId: 'AAAAAAAA-1234-4234-8234-123456789ABC' }), 'c1eb8248fc82f0fd42e2996937412802eb889a4b30149bd50f2f1e82e2d5603c');
});

test('profile email validation retains the existing Hibernate validator acceptance cases', () => {
  // Golden outcomes captured from EmailValidator in the deployed everyday.jar dependencies.
  for (const value of ['', 'first@example.test', 'a@b', '"a b"@example.test', 'a@[127.0.0.1]', 'a@[IPv6:::1]', '사용자@예시.한국', 'a@a#b', 'a@a_b.test']) {
    assert.equal(validProfileEmail(value), true, value);
  }
  for (const value of ['a..b@example.test', `test@${'a'.repeat(64)}.test`, `${'a'.repeat(65)}@example.test`, 'a@-bad.test', 'a@bad-.test', 'a@example.test.', 'a b@example.test']) {
    assert.equal(validProfileEmail(value), false, value);
  }
});
