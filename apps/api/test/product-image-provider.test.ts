import assert from 'node:assert/strict';
import test from 'node:test';
import { createHiggsfieldImageProvider } from '../src/product/image-provider.js';

test('Soul provider submits exactly once and preserves image/reference parameters while polling', async () => {
  const calls: { path: string; init: RequestInit | undefined }[] = [];
  let polls = 0;
  const provider = createHiggsfieldImageProvider({ apiKey: 'fixture-key', apiSecret: 'fixture-secret', baseUrl: 'https://fixture.invalid/' }, {
    pollIntervalMs: 0, fetch: async (input, init) => {
      const path = String(input); calls.push({ path, init });
      if (init?.method === 'POST') return Response.json({ id: 'job-set' });
      return Response.json({ jobs: ++polls === 1 ? [{ status: 'running' }] :
        Array.from({ length: 4 }, (_, i) => ({ status: 'completed', results: { raw: { url: `https://images.invalid/${i}` } } })) });
    },
  });
  assert.equal((await provider.generateImages('portrait', 'https://images.invalid/reference', 4, 'soul-id')).length, 4);
  assert.equal(calls.filter(call => call.init?.method === 'POST').length, 1);
  assert.equal(calls.length, 3);
  assert.deepEqual(JSON.parse(String(calls[0]!.init!.body)), { params: {
    prompt: 'portrait', width_and_height: '1536x2048', quality: '1080p', batch_size: 4, enhance_prompt: true,
    image_reference: { type: 'image_url', image_url: 'https://images.invalid/reference' },
    custom_reference_id: 'soul-id', custom_reference_strength: 1,
  } });
  assert.equal((calls[0]!.init!.headers as Record<string, string>).Authorization, 'Key fixture-key:fixture-secret');
});

test('uncertain image submissions and expired polling fail without paid automatic retry', async () => {
  for (const mode of ['submission-failure', 'poll-timeout'] as const) {
    let submissions = 0;
    const provider = createHiggsfieldImageProvider({ apiKey: 'fixture', apiSecret: 'fixture' }, {
      pollIntervalMs: 0, maxPollAttempts: 2,
      fetch: async (_input, init) => {
        if (init?.method === 'POST') {
          submissions++;
          if (mode === 'submission-failure') throw Error('uncertain fixture-only failure');
          return Response.json({ id: 'job-set' });
        }
        return Response.json({ jobs: [{ status: 'running' }] });
      },
    });
    await assert.rejects(provider.generateImages('portrait', null, 1), { statusCode: 502 });
    assert.equal(submissions, 1);
  }
});

test('Soul registration remains untrained until the matching reference reports completion', async () => {
  let readiness = 'training'; let identity = 'soul-id';
  const calls: string[] = [];
  const provider = createHiggsfieldImageProvider({ apiKey: 'fixture', apiSecret: 'fixture' }, {
    fetch: async (input, init) => {
      calls.push(init?.method ?? 'GET');
      return Response.json({ id: init?.method === 'POST' ? 'soul-id' : identity, status: readiness });
    },
  });
  assert.equal(await provider.trainSoul('https://images.invalid/reference'), 'soul-id');
  assert.equal(await provider.soulReady('soul-id'), false);
  readiness = 'completed';
  assert.equal(await provider.soulReady('soul-id'), true);
  identity = 'other-soul';
  await assert.rejects(provider.soulReady('soul-id'), { statusCode: 502 });
  identity = 'soul-id'; readiness = 'failed';
  await assert.rejects(provider.soulReady('soul-id'), { statusCode: 502 });
  assert.equal(calls.filter(method => method === 'POST').length, 1);
});

test('missing image credentials fail before any provider call', async () => {
  let calls = 0;
  const provider = createHiggsfieldImageProvider({}, { fetch: async () => { calls++; return Response.json({}); } });
  await assert.rejects(provider.generateImages('portrait', null, 1), { statusCode: 502 });
  await assert.rejects(provider.trainSoul('https://images.invalid/reference'), { statusCode: 502 });
  await assert.rejects(provider.soulReady('soul-id'), { statusCode: 502 });
  assert.equal(calls, 0);
});

test('shutdown aborts an outstanding provider request and prevents subsequent submissions', async () => {
  let calls = 0;
  const provider = createHiggsfieldImageProvider({ apiKey: 'fixture', apiSecret: 'fixture' }, {
    fetch: async (_input, init) => {
      calls++;
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(Error('aborted')), { once: true });
      });
    },
  });
  const image = provider.generateImages('portrait', null, 1);
  provider.cancel!();
  await assert.rejects(image, { statusCode: 502 });
  await assert.rejects(provider.generateImages('portrait', null, 1), { statusCode: 502 });
  assert.equal(calls, 1);
});
