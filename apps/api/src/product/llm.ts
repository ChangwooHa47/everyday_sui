import { readBytes } from '../market-package.js';
import { productError, type ProductLlm, type LlmMessage } from './core.js';
export interface LlmProperties { apiKey?: string; baseUrl?: string; model?: string }

/** The same Anthropic protocol, model and output budget used by the existing product. */
export class AnthropicLlmClient implements ProductLlm {
  private readonly active = new Set<AbortController>();
  constructor(private readonly config: LlmProperties, private readonly fetcher: typeof fetch = fetch) {}
  cancel() { for (const request of this.active) request.abort(); }
  requireConfigured() {
    if (!this.config.apiKey?.trim()) throw productError('LLM_API_ERROR');
  }
  async chat(systemPrompt: string, messages: LlmMessage[]) {
    this.requireConfigured();
    const controller = new AbortController();
    this.active.add(controller);
    try {
      const response = await this.fetcher(`${(this.config.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(60_000), controller.signal]),
        headers: { 'x-api-key': this.config.apiKey!, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.config.model ?? 'claude-sonnet-4-5', max_tokens: 1024, system: systemPrompt, messages }),
      });
      if (!response.ok) { await response.body?.cancel(); throw Error('Provider failure'); }
      const payload = JSON.parse(new TextDecoder().decode(await readBytes(response, 4 * 1024 * 1024))) as { content?: { type?: string; text?: string }[] };
      if (!Array.isArray(payload.content) || !payload.content.length) throw Error('Empty response');
      const text = payload.content.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('');
      if (!text.trim()) throw Error('Empty text');
      return text;
    } catch { throw productError('LLM_API_ERROR'); }
    finally { this.active.delete(controller); }
  }
}

export interface CharacterPersona {
  name: string; relationshipType: string; gender: string; summary: string | null;
  appearance: string | null; personality: string | null; speechStyles: string[]; callName: string | null;
}
export function buildSystemPrompt(persona: CharacterPersona) {
  let prompt = `너는 '${persona.name}'라는 이름의 캐릭터야. 사용자와의 관계는 '${persona.relationshipType}'이고, 너의 성별은 '${persona.gender}'이야.\n\n`;
  if (persona.summary?.trim()) prompt += `한 줄 소개: ${persona.summary}\n`;
  if (persona.appearance?.trim()) prompt += `외모: ${persona.appearance}\n`;
  if (persona.personality?.trim()) prompt += `성격: ${persona.personality}\n`;
  if (persona.speechStyles.length) prompt += `말투 특징: ${persona.speechStyles.join(', ')}\n`;
  if (persona.callName?.trim()) prompt += `사용자를 부르는 호칭: '${persona.callName}'\n`;
  return prompt + `
아래 규칙을 반드시 지켜서 캐릭터를 연기해:
1. 항상 위 캐릭터의 1인칭 시점으로, 설정된 말투와 성격을 유지하며 대화한다.
2. 답변은 실제 메신저 대화처럼 짧고 자연스러운 문장 1~3개로 구성하며, 존댓말·반말은 위 캐릭터의 말투 설정을 따른다.
3. 스스로 AI/모델이라는 사실을 언급하지 않는다.
4. 선정적이거나 정책상 부적절한 요청에는 캐릭터를 유지한 채 부드럽게 화제를 돌리거나 거절한다.
`;
}
export function examplePrompt(examples: { role: string; content: string }[]) {
  if (!examples.length) return '';
  return '\n[작가가 구성한 가상 예시: 실제 사용자와의 기억이 아닙니다. 현재 설정과 충돌하면 현재 설정이 우선입니다.]\n'
    + examples.map(e => `${e.role}: ${e.content}`).join('\n');
}

export function stripCodeFence(raw: string) {
  let trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    trimmed = trimmed.replace(/^```[a-zA-Z]*\n/, '');
    if (trimmed.endsWith('```')) trimmed = trimmed.slice(0, -3);
  }
  return trimmed.trim();
}
