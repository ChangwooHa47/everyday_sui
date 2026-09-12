import assert from 'node:assert/strict';
import test from 'node:test';
import { AnthropicLlmClient, buildSystemPrompt, examplePrompt, stripCodeFence } from '../src/product/llm.js';

test('product LLM port retains Anthropic model, budget, roles, and text block concatenation', async () => {
  let calls = 0;
  const provider = new AnthropicLlmClient({ apiKey: 'fixture-only' }, async (url, init) => {
    calls++;
    assert.equal(String(url), 'https://api.anthropic.com/v1/messages');
    assert.equal((init!.headers as Record<string, string>)['anthropic-version'], '2023-06-01');
    assert.deepEqual(JSON.parse(init!.body as string), { model: 'claude-sonnet-4-5', max_tokens: 1024, system: 'system', messages: [{ role: 'user', content: 'input' }] });
    return Response.json({ content: [{ type: 'text', text: '첫째' }, { type: 'image', text: '제외' }, { type: 'text', text: '둘째' }] });
  });
  assert.equal(await provider.chat('system', [{ role: 'user', content: 'input' }]), '첫째둘째');
  assert.equal(calls, 1);
});

test('product LLM failures do not retry or disclose provider bodies', async () => {
  let calls = 0;
  const missing = new AnthropicLlmClient({}, async () => { calls++; return Response.json({}); });
  await assert.rejects(missing.chat('system', []), { statusCode: 502, message: 'AI 응답 생성에 실패했습니다.' });
  assert.equal(calls, 0);
  for (const response of [new Response('private provider error', { status: 500 }), Response.json({ content: [] }), Response.json({ content: [{ type: 'text', text: ' ' }] })]) {
    const provider = new AnthropicLlmClient({ apiKey: 'fixture-only' }, async () => { calls++; return response; });
    await assert.rejects(provider.chat('system', []), { statusCode: 502, message: 'AI 응답 생성에 실패했습니다.' });
  }
  assert.equal(calls, 3);
});

test('character prompts preserve personal call-name and explicitly fictional authored examples', () => {
  const prompt = buildSystemPrompt({ name: '캐릭터', relationshipType: '친구', gender: '기타', summary: '소개', appearance: null,
    personality: '다정함', speechStyles: ['반말', '짧게'], callName: '친구' });
  assert.match(prompt, /말투 특징: 반말, 짧게/); assert.match(prompt, /사용자를 부르는 호칭: '친구'/);
  assert.equal(prompt.includes('외모:'), false);
  assert.equal(examplePrompt([]), '');
  assert.match(examplePrompt([{ role: 'assistant', content: '가상 대사' }]), /실제 사용자와의 기억이 아닙니다/);
  assert.equal(stripCodeFence(' ```json\n{"value":1}\n``` '), '{"value":1}');
});

test('product shutdown cancels an active LLM call without replaying it', async () => {
  let calls = 0;
  const provider = new AnthropicLlmClient({ apiKey: 'fixture-only' }, async (_url, init) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(Error('cancelled')), { once: true }));
  });
  const pending = provider.chat('system', [{ role: 'user', content: 'input' }]);
  provider.cancel();
  await assert.rejects(pending, { statusCode: 502, message: 'AI 응답 생성에 실패했습니다.' });
  assert.equal(calls, 1);
});
