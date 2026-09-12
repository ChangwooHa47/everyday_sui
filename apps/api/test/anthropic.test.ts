import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { requestCompletion } from '../src/turn-service.js';
import { aiFromEnv } from '../src/runtime-config.js';

test('original Anthropic credentials configure market AI; Messages uses top-level system and text blocks', async t => {
  const config = aiFromEnv({ ANTHROPIC_API_KEY: 'fixture-key' })!;
  assert.equal(config.provider, 'anthropic');
  assert.equal(config.endpoint, 'https://api.anthropic.com/v1/messages');
  let received: { headers: Record<string, unknown>; body: Record<string, unknown> };
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    received = { headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString()) };
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const result = await requestCompletion({ ...config, endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}` }, 'fictional system', [{ role: 'user', content: 'hello' }]);
  assert.equal(result, 'one\ntwo'); assert.equal(received!.headers['x-api-key'], 'fixture-key');
  assert.equal(received!.headers['anthropic-version'], '2023-06-01'); assert.equal(received!.headers.authorization, undefined);
  assert.equal(received!.body.system, 'fictional system');
  assert.deepEqual(received!.body.messages, [{ role: 'user', content: 'hello' }]);
});
