import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { migrateProduct } from '../src/product/migrations.js';
import { migration } from '../src/database.js';
import Fastify from 'fastify';
import { PGlite } from '@electric-sql/pglite';
import type { CharacterRow, LlmMessage, ProductContext } from '../src/product/core.js';
import { productError } from '../src/product/core.js';
import { conversationContext, photoMood, registerProductConversations, saveMessage } from '../src/product/conversations.js';
import { importPackageEpisodes, parseEpisodeStarters, registerProductEpisodes, seedEpisodeCatalog } from '../src/product/episodes.js';
import type { MarketListing } from '@everyday/contracts';

test('ported conversation and episode behavior preserves transactions, replay safety and isolation', async t => {
  const db = new PGlite();
  await db.exec(migration);
  await migrateProduct(db);
  await db.exec("INSERT INTO everyday.users(id,email,points) VALUES(1,'first@example.test',100),(2,'second@example.test',100)");
  for (const [id, owner] of [['1', '1'], ['2', '2'], ['3', '1'], ['4', '1']]) await db.query(
    `INSERT INTO everyday.characters(id,user_id,name,relationship_type,gender,system_prompt) VALUES($1,$2,$3,'FRIEND','FEMALE',$4)`,
    [id, owner, 'character-' + id, 'PERSONA_' + id],
  );
  const calls: { system: string; messages: LlmMessage[] }[] = [];
  let available = true, uncertain = false, memoryUnavailable = false, accessRevoked = false;
  const ctx: ProductContext = {
    db, llm: {
      requireConfigured() { if (!available) throw productError(503); },
      async chat(system, messages) {
        calls.push({ system, messages });
        if (uncertain) throw productError('LLM_API_ERROR');
        return system.includes('JSON 배열') ? '["먼저 인사해볼까?","함께 걸을래?"]' : 'reply-' + calls.length;
      },
    },
    image: { requireConfigured() {}, async generateImages() { return []; }, async trainSoul() { return ''; }, async soulReady() { return false; } },
    async authenticate(req) {
      if (!req.headers['x-user']) throw productError('UNAUTHORIZED');
      return { userId: String(req.headers['x-user']), address: '0x' + 'a'.repeat(64) };
    },
    async ownedCharacter(userId, characterId, connection = db, lock = false) {
      const row = (await connection.query<CharacterRow>('SELECT * FROM everyday.characters WHERE id=$1' + (lock ? ' FOR UPDATE' : ''), [characterId])).rows[0];
      if (!row) throw productError('CHARACTER_NOT_FOUND');
      if (String(row.user_id) !== userId) throw productError('FORBIDDEN_CHARACTER_ACCESS');
      return row;
    },
    async requireAccess() { if (accessRevoked) throw productError('FORBIDDEN_CHARACTER_ACCESS'); },
    async requireEditable() {}, async isLicensed() { return false; },
    async personalizedPrompt(_id, fallback) { return fallback; },
    async withApprovedMemory(_req, _id, prompt) {
      if (memoryUnavailable) throw productError(503);
      return prompt + '\nAPPROVED_PRIVATE_MEMORY';
    },
  };
  const app = Fastify();
  app.setErrorHandler((error, _req, reply) => reply.code((error as { statusCode?: number }).statusCode ?? 500).send({ success: false }));
  registerProductConversations(app, ctx);
  registerProductEpisodes(app, ctx);
  t.after(async () => { await app.close(); await db.close(); });
  async function post(url: string, payload: object = {}, user = '1') { return app.inject({ method: 'POST', url, headers: { 'x-user': user }, payload }); }
  const base = '/api/characters/1';

  await t.test('ordinary chat keeps greeting and completed requests stable, and validates ownership before replay', async () => {
    const requestId = randomUUID();
    const greeting = await post(base + '/greeting', { requestId });
    assert.equal(greeting.statusCode, 200, greeting.body);
    assert.deepEqual(calls[0], { system: 'PERSONA_1', messages: [{ role: 'user', content: '(오랜만에 먼저 대화를 시작하는 상황이야. 자연스럽게 먼저 인사를 건네줘.)' }] });
    assert.deepEqual((await post(base + '/greeting', { requestId })).json(), greeting.json());
    assert.deepEqual((await post(base + '/greeting', { requestId: randomUUID() })).json(), greeting.json());
    assert.equal(calls.length, 1);
    assert.equal((await post(base + '/greeting', { requestId }, '2')).statusCode, 403);
    assert.equal((await post(base + '/messages', { content: 'different operation', requestId })).statusCode, 409);
    const message = { requestId: randomUUID(), content: 'hello' };
    const answer = await post(base + '/messages', message);
    assert.equal(answer.statusCode, 200, answer.body);
    assert.deepEqual(calls.at(-1), { system: 'PERSONA_1\nAPPROVED_PRIVATE_MEMORY', messages: [
      { role: 'assistant', content: greeting.json().data.content }, { role: 'user', content: 'hello' },
    ] });
    const count = calls.length;
    assert.deepEqual((await post(base + '/messages', message)).json(), answer.json());
    assert.equal(calls.length, count);
    assert.equal((await post(base + '/messages', { ...message, content: 'changed' })).statusCode, 409);
    accessRevoked = true;
    assert.equal((await post(base + '/messages', message)).statusCode, 403);
    accessRevoked = false;
    const history = (await app.inject({ url: base + '/messages/history', headers: { 'x-user': '1' } })).json().data;
    assert.deepEqual(history.map((m: { sender: string }) => m.sender), ['AI', 'USER', 'AI']);
    assert.equal((await post(base + '/messages', { content: ' '.repeat(2) })).statusCode, 400);
    assert.equal((await post(base + '/messages', { content: 'x'.repeat(8001) })).statusCode, 400);
    assert.equal((await post(base + '/messages', { content: 'hello', requestId: 'not-uuid' })).statusCode, 400);
  });

  await t.test('licensed ordinary chat gives the gift decision its approved memory without risking the saved reply', async () => {
    const observed: LlmMessage[][] = [];
    const listing: MarketListing = { id: '0x' + 'b'.repeat(64), creator: '0x' + 'c'.repeat(64), operator: '0x' + 'd'.repeat(64),
      title: 'Gift character', priceMist: '1000', agentBps: 2000, treasuryMist: '200', published: true, active: true,
      package: { blobId: 'a'.repeat(43), contentHash: '0'.repeat(64), endEpoch: '100' },
      policy: { perGiftLimitMist: '100', dailyLimitMist: '200', allowedGiftIds: ['0x' + 'e'.repeat(64)] } };
    ctx.licensedListing = async () => listing;
    ctx.gifts = { propose: async (_owner, actual, _turn, messages) => { assert.equal(actual, listing); observed.push(messages); throw Error('gift provider unavailable'); }, recover: async () => {} };
    const response = await post(base + '/messages', { requestId: randomUUID(), content: 'today matters' });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().data.gift.status, 'unknown');
    assert.match(observed[0].at(-1)!.content, /APPROVED_PRIVATE_MEMORY/);
    assert.equal((await db.query<{ count: number }>('SELECT count(*)::integer AS count FROM everyday.chat_messages WHERE content=$1', ['today matters'])).rows[0].count, 1);
    ctx.gifts = undefined; ctx.licensedListing = undefined;
  });

  await t.test('history re-attaches delivered or pending gifts to their reply and hides declined decisions', async () => {
    const replies = (await db.query<{ id: string }>("SELECT id FROM everyday.chat_messages WHERE character_id=1 AND sender='AI' AND character_episode_id IS NULL ORDER BY id DESC LIMIT 2")).rows;
    await db.query(`INSERT INTO agent_gifts(intent,owner,listing_id,product_id,status,digest,reason,character_id,message_id)
      VALUES('intent-confirmed','0xowner','0xlisting','0xproduct','confirmed','digest-1','오늘은 내가 살게.',1,$1),
             ('intent-declined','0xowner','0xlisting',NULL,'declined',NULL,NULL,1,$2)`, [replies[0].id, replies[1].id]);
    const history = (await app.inject({ url: base + '/messages/history', headers: { 'x-user': '1' } })).json().data as { id: number; gift?: { status: string; reason?: string; digest?: string } }[];
    const delivered = history.find(m => m.id === Number(replies[0].id))!, declined = history.find(m => m.id === Number(replies[1].id))!;
    assert.deepEqual(delivered.gift, { status: 'confirmed', productId: '0xproduct', digest: 'digest-1', reason: '오늘은 내가 살게.' });
    assert.equal(declined.gift, undefined);
    await db.query("DELETE FROM agent_gifts WHERE intent IN ('intent-confirmed','intent-declined')");
  });

  await t.test('failures before a provider release claims; uncertain provider calls roll back messages and cannot silently retry', async () => {
    const input = { requestId: randomUUID(), content: 'failure-rolls-back' };
    const before = calls.length;
    memoryUnavailable = true;
    assert.equal((await post(base + '/messages', input)).statusCode, 503);
    memoryUnavailable = false;
    assert.equal((await db.query('SELECT * FROM everyday.chat_turn_requests WHERE request_id=$1', [input.requestId])).rows.length, 0);
    assert.equal((await db.query('SELECT * FROM everyday.chat_messages WHERE content=$1', [input.content])).rows.length, 0);
    available = false;
    assert.equal((await post(base + '/messages', input)).statusCode, 503);
    available = true;
    assert.equal(calls.length, before);
    assert.equal((await db.query('SELECT * FROM everyday.chat_turn_requests WHERE request_id=$1', [input.requestId])).rows.length, 0);
    uncertain = true;
    assert.equal((await post(base + '/messages', input)).statusCode, 502);
    uncertain = false;
    assert.equal((await post(base + '/messages', input)).statusCode, 503);
    assert.equal(calls.length, before + 1);
    assert.equal((await db.query('SELECT * FROM everyday.chat_messages WHERE content=$1', [input.content])).rows.length, 0);
    assert.equal((await db.query<{ points: number }>('SELECT points FROM everyday.users WHERE id=1')).rows[0].points, 100);
  });

  await t.test('episodes retain templates, licensed boundaries, private progress and stable starters', async () => {
    await seedEpisodeCatalog(db);
    await seedEpisodeCatalog(db);
    const publicList = await app.inject({ url: '/api/episodes', headers: { 'x-user': '1' } });
    assert.equal(publicList.json().data.length, 3);
    const episodeId = publicList.json().data[0].id;
    const episodeBase = base + '/episodes/' + episodeId;
    const started = await post(episodeBase + '/start');
    assert.equal(started.statusCode, 200, started.body);
    assert.deepEqual(started.json().data.starters, ['먼저 인사해볼까?', '함께 걸을래?']);
    const before = calls.length;
    assert.deepEqual((await post(episodeBase + '/start')).json(), started.json());
    assert.equal(calls.length, before);
    const input = { requestId: randomUUID(), content: 'episode message' };
    const answer = await post(episodeBase + '/messages', input);
    assert.equal(answer.statusCode, 200, answer.body);
    assert.deepEqual(calls.at(-1)?.messages, [{ role: 'user', content: 'episode message' }]);
    assert.match(calls.at(-1)!.system, /PERSONA_1\n\n\[현재 에피소드 상황\]\n.*APPROVED_PRIVATE_MEMORY/s);
    const after = calls.length;
    assert.deepEqual((await post(episodeBase + '/messages', input)).json(), answer.json());
    assert.equal(calls.length, after);
    const normal = (await app.inject({ url: base + '/messages', headers: { 'x-user': '1' } })).json().data;
    assert.ok(!normal.some((item: { content: string }) => item.content === input.content));

    const listingId = '0x' + 'b'.repeat(64);
    await importPackageEpisodes(db, listingId, [{ id: 'authored', title: 'authored title', setting: 'AUTHOR_SETTING' }]);
    await importPackageEpisodes(db, listingId, [{ id: 'authored', title: 'changed title', setting: 'CHANGED_SETTING' }]);
    await db.query('INSERT INTO everyday.licensed_characters(character_id,listing_id,license_id,base_prompt) VALUES(3,$1,$2,$3)', [listingId, '0x' + 'c'.repeat(64), 'PERSONA_3']);
    const authored = (await app.inject({ url: '/api/characters/3/episodes', headers: { 'x-user': '1' } })).json().data;
    assert.equal(authored.length, 1);
    assert.equal(authored[0].title, 'authored title');
    assert.equal((await app.inject({ url: '/api/episodes', headers: { 'x-user': '2' } })).json().data.length, 3);
    assert.equal((await post(base + '/episodes/' + authored[0].id + '/start')).statusCode, 403);
    assert.equal((await post('/api/characters/3/episodes/' + authored[0].id + '/start')).statusCode, 200);
    assert.equal((await post('/api/characters/3/episodes/' + authored[0].id + '/start', {}, '2')).statusCode, 403);
    assert.equal((await post('/api/characters/4/episodes/' + episodeId + '/messages', { content: 'not started' })).statusCode, 404);

    const retryBase = '/api/characters/4/episodes/' + episodeId;
    available = false;
    assert.equal((await post(retryBase + '/start')).statusCode, 503);
    available = true;
    uncertain = true;
    assert.equal((await post(retryBase + '/start')).statusCode, 502);
    uncertain = false;
    const count = calls.length;
    assert.equal((await post(retryBase + '/start')).statusCode, 503);
    assert.equal(calls.length, count);
  });

  await t.test('recent context is ordered and cannot mix ordinary, episode or other-character messages', async () => {
    const episodes = (await db.query<{ id: string }>('SELECT id FROM everyday.character_episodes WHERE character_id=1')).rows;
    const episode = String(episodes[0].id);
    await db.query('DELETE FROM everyday.chat_turn_requests');
    await db.query('DELETE FROM everyday.chat_messages');
    for (let i = 0; i < 12; i++) {
      const sender = i % 2 ? 'AI' : 'USER';
      await saveMessage(db, '1', null, sender, 'normal-' + i);
      await saveMessage(db, '1', episode, sender, 'episode-' + i);
      await saveMessage(db, '2', null, sender, 'other-character');
    }
    assert.deepEqual((await conversationContext(db, '1')).map(item => item.content), Array.from({ length: 10 }, (_, i) => 'normal-' + (i + 2)));
    assert.deepEqual((await conversationContext(db, '1', episode)).map(item => item.content), Array.from({ length: 10 }, (_, i) => 'episode-' + (i + 2)));
    assert.equal(await photoMood(db, '1'), '캐릭터: normal-7 / 유저: normal-8 / 캐릭터: normal-9 / 유저: normal-10 / 캐릭터: normal-11');
    assert.deepEqual(await conversationContext(db, '4'), []);
  });
});

test('episode starter parsing retains the original bounded fallback', () => {
  assert.deepEqual(parseEpisodeStarters('```json\n["one","two","three"]\n```'), ['one', 'two']);
  for (const invalid of ['null', '{}', '["one"]', '["one",""]', '["one",null]', JSON.stringify(['one', 'x'.repeat(501)]), 'bad'])
    assert.deepEqual(parseEpisodeStarters(invalid), ['안녕, 오랜만이야.', '오늘 여기서 보니까 반갑다.']);
});
