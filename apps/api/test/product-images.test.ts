import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { migrateProduct } from '../src/product/migrations.js';
import test from 'node:test';
import Fastify from 'fastify';
import { PGlite } from '@electric-sql/pglite';
import { migration } from '../src/database.js';
import { hash } from '../src/auth.js';
import { createProductContext } from '../src/product/context.js';
import { enqueuePortrait, failPhotoJob, processPhotoJobs, processPortraitJobs, registerProductImages, startProductImageWorkers } from '../src/product/images.js';
import type { ProductImageProvider, ProductLlm } from '../src/product/core.js';

test('migrated image jobs preserve ownership, durable requests, provider failures and SUI payment claims', async t => {
  const db = new PGlite();
  await db.exec(migration);
  await migrateProduct(db);

  const origin = 'https://fixture.invalid';
  const address = (n: number) => `0x${String(n).repeat(64)}`;
  for (const owner of [1, 2]) {
    await db.query('INSERT INTO everyday.users(id,wallet_address,points) VALUES($1,$2,2400)', [owner, address(owner)]);
    await db.query('INSERT INTO wallet_sessions VALUES($1,$2,$3,now()+interval \'30 minutes\')',
      [hash(String(owner).repeat(43)), address(owner), origin]);
    await db.query(`INSERT INTO everyday.characters(id,user_id,name,relationship_type,gender,appearance,system_prompt,image_prompt,profile_image_url)
      VALUES($1,$1,'fixture','FRIEND','OTHER',$2,'fixture system','portrait prompt','https://fixture.invalid/profile')`, [owner, `OWNER_${owner}_APPEARANCE`]);
  }
  const calls = { images: 0, training: 0, ready: 0, prompts: [] as string[] };
  let failImage = false; let failTraining = false;
  const image: ProductImageProvider = {
    requireConfigured() {},
    async generateImages(prompt, _ref, count) {
      calls.images++; calls.prompts.push(prompt);
      if (failImage) throw Error('fixture provider failure');
      return Array.from({ length: count }, (_, i) => `https://fixture.invalid/image-${i}`);
    },
    async trainSoul() { calls.training++; if (failTraining) throw Error('unknown paid result'); return 'fixture-soul'; },
    async soulReady() { calls.ready++; return true; },
  };
  const llm: ProductLlm = { requireConfigured() {}, async chat(_system, messages) { return messages[0]!.content; } };
  const photoPayments = { priceMist: '10000000', async transaction() { return 'fixture'; }, async verify() {} };
  const context = createProductContext(db, { origins: [origin], audience: 'https://api.fixture.invalid', network: 'testnet' }, { image, llm, photoPayments });
  const app = Fastify();
  app.setErrorHandler((error: Error & { statusCode?: number }, _req, reply) => reply.code(error.statusCode ?? 500).send({ message: error.message }));
  registerProductImages(app, context);
  t.after(async () => { await app.close(); await db.close(); });
  const paymentDigest = (id: string) => id.replaceAll('-', '').replaceAll('0', '1') + 'A'.repeat(12);
  const request = (url: string, owner = 1, payload?: Record<string, unknown>) => app.inject({ url,
    method: payload === undefined ? 'GET' : 'POST',
    headers: { origin, authorization: `Bearer ${String(owner).repeat(43)}` },
    ...(payload === undefined ? {} : { payload }),
  });

  await t.test('draft portraits start once and cross-owner access stays forbidden', async () => {
    await enqueuePortrait(db, '1', 'portrait prompt', 4, true);
    assert.equal((await request('/api/characters/1/portrait-status')).json().data.status, 'draft');
    assert.equal((await request('/api/characters/1/portraits', 2, { style: 'forbidden' })).statusCode, 403);
    for (let i = 0; i < 2; i++) assert.equal((await request('/api/characters/1/portraits', 1, { style: 'STYLE' })).statusCode, 200);
    assert.equal((await request('/api/characters/1/portraits', 1, { style: 'DIFFERENT' })).statusCode, 409);
    await processPortraitJobs(context); await processPortraitJobs(context);
    assert.equal(calls.images, 1);
    assert.equal(calls.prompts[0], 'portrait prompt\nRequested expression, atmosphere and scene: STYLE');
    assert.equal((await db.query('SELECT * FROM everyday.photos WHERE character_id=1')).rows.length, 4);
    assert.equal((await request('/api/characters/1/portrait-status')).json().data.status, 'completed');
  });
  await t.test('one SUI payment claim survives duplicate requests and successful photo completion', async () => {
    for (let i = 0; i < 6; i++) await db.query(`INSERT INTO everyday.chat_messages(character_id,sender,content)
      VALUES(1,'USER',$1)`, [`PRIVATE_MOOD_${i}`]);
    await db.query("INSERT INTO everyday.chat_messages(character_id,sender,content) VALUES(2,'USER','OTHER_OWNER_SECRET')");
    const id = randomUUID(); const input = { requestId: id, paymentDigest: paymentDigest(id), photo: { concept: 'CAFE_DATE' } };
    const results = await Promise.all([request('/api/characters/1/photo-jobs', 1, input), request('/api/characters/1/photo-jobs', 1, input)]);
    assert.deepEqual(results.map(r => r.statusCode), [200, 200]);
    assert.equal((await db.query('SELECT digest FROM photo_payments WHERE request_id=$1', [id])).rows.length, 1);
    const replayId = randomUUID();
    assert.equal((await request('/api/characters/1/photo-jobs', 1, { ...input, requestId: replayId })).statusCode, 409);
    assert.equal((await request(`/api/photo-jobs/${id}`, 2)).statusCode, 404);
    assert.equal((await request('/api/characters/1/photo-jobs', 1, { ...input, photo: { concept: 'NIGHT_WALK' } })).statusCode, 409);
    await processPhotoJobs(context); await processPhotoJobs(context);
    const result = (await request(`/api/photo-jobs/${id}`)).json().data;
    assert.equal(result.status, 'completed'); assert.equal(result.photo.type, 'PHOTOBOOTH');
    assert.equal(calls.images, 2);
    const mood = calls.prompts.at(-1)!;
    assert.ok(mood.includes('OWNER_1_APPEARANCE')); assert.ok(!mood.includes('OTHER_OWNER_SECRET'));
    assert.ok(!mood.includes('PRIVATE_MOOD_0')); assert.ok(mood.indexOf('PRIVATE_MOOD_1') < mood.indexOf('PRIVATE_MOOD_5'));
    assert.equal((await db.query<{ context: string }>('SELECT context FROM everyday.photo_jobs WHERE request_id=$1', [id])).rows[0]!.context, '');
  });
  await t.test('failed and stale paid photo calls never auto-resubmit', async () => {
    const id = randomUUID(); const payload = { requestId: id, paymentDigest: paymentDigest(id), photo: { concept: 'CAFE_DATE' } };
    assert.equal((await request('/api/characters/1/photo-jobs', 1, payload)).statusCode, 200);
    failImage = true; await processPhotoJobs(context); failImage = false;
    assert.equal((await request(`/api/photo-jobs/${id}`)).json().data.status, 'failed'); assert.equal(calls.images, 3);
    await failPhotoJob(db, id); await processPhotoJobs(context);
    assert.equal((await request('/api/characters/1/photo-jobs', 1, payload)).json().data.status, 'failed'); assert.equal(calls.images, 3);
    const stale = randomUUID();
    await request('/api/characters/1/photo-jobs', 1, { ...payload, requestId: stale, paymentDigest: paymentDigest(stale) });
    await db.query("UPDATE everyday.photo_jobs SET status='running',updated_at=now()-interval '31 minutes' WHERE request_id=$1", [stale]);
    await processPhotoJobs(context); await processPhotoJobs(context);
    assert.equal((await request(`/api/photo-jobs/${stale}`)).json().data.status, 'failed'); assert.equal(calls.images, 3);
  });
  await t.test('uncertain portraits and face training preserve a durable do-not-retry state', async () => {
    await enqueuePortrait(db, '2', 'second portrait', 4, false);
    await db.query("UPDATE everyday.portrait_jobs SET status='running',updated_at=now()-interval '31 minutes' WHERE character_id=2");
    await processPortraitJobs(context);
    assert.equal((await request('/api/characters/2/portrait-status', 2)).json().data.status, 'unknown');
    assert.equal(calls.images, 3);
    assert.equal((await request('/api/characters/1/train-face', 2, {})).statusCode, 403);
    failTraining = true;
    assert.equal((await request('/api/characters/2/train-face', 2, {})).statusCode, 500);
    failTraining = false;
    assert.equal((await request('/api/characters/2/train-face', 2, {})).statusCode, 503);
    assert.equal(calls.training, 1);
    assert.equal((await request('/api/characters/1/train-face', 1, {})).json().data.soulTrained, false);
    assert.equal((await request('/api/characters/1/train-face', 1, {})).json().data.soulTrained, true);
    assert.equal(calls.training, 2); assert.equal(calls.ready, 1);
  });
  await t.test('shutdown cancels an in-flight paid image call and leaves no retryable work', async () => {
    let submitted!: () => void;
    const submission = new Promise<void>(resolve => { submitted = resolve; });
    let rejectRequest!: (error: Error) => void;
    let imageCalls = 0; let cancellations = 0;
    const cancelImage: ProductImageProvider = {
      ...image,
      async generateImages() {
        imageCalls++; submitted();
        return new Promise<string[]>((_resolve, reject) => { rejectRequest = reject; });
      },
      cancel() { cancellations++; rejectRequest(Error('shutdown')); },
    };
    const id = randomUUID();
    await request('/api/characters/1/photo-jobs', 1, { requestId: id, paymentDigest: paymentDigest(id), photo: { concept: 'CAFE_DATE' } });
    const errors: unknown[] = [];
    const stop = startProductImageWorkers({ ...context, image: cancelImage }, error => { errors.push(error); }, 1, 10);
    const alive = setTimeout(() => {}, 1000);
    try {
      await submission;
      await stop();
      assert.equal(cancellations, 1);
      assert.equal((await request(`/api/photo-jobs/${id}`)).json().data.status, 'failed');
      await processPhotoJobs({ ...context, image: cancelImage });
      assert.equal(imageCalls, 1); assert.deepEqual(errors, []);
    } finally { clearTimeout(alive); }
  });
  await t.test('an adapter that ignores cancellation blocks a successful shutdown', async () => {
    let submitted!: () => void;
    const submission = new Promise<void>(resolve => { submitted = resolve; });
    let rejectRequest!: (error: Error) => void;
    const stuck: ProductImageProvider = {
      ...image,
      async generateImages() {
        submitted();
        return new Promise<string[]>((_resolve, reject) => { rejectRequest = reject; });
      }, cancel() {},
    };
    const id = randomUUID();
    await request('/api/characters/1/photo-jobs', 1, { requestId: id, paymentDigest: paymentDigest(id), photo: { concept: 'CAFE_DATE' } });
    const stop = startProductImageWorkers({ ...context, image: stuck }, () => {}, 1, 5, 5);
    const alive = setTimeout(() => {}, 1000);
    try {
      await submission;
      await assert.rejects(stop(), /did not finish during shutdown/);
      assert.equal((await request(`/api/photo-jobs/${id}`)).json().data.status, 'running');
      // Release the intentionally broken adapter before closing the test database.
      rejectRequest(Error('fixture cleanup'));
      await stop();
      assert.equal((await request(`/api/photo-jobs/${id}`)).json().data.status, 'failed');
    } finally { clearTimeout(alive); }
  });
});
