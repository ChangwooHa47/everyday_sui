// 원가 계산용 단가표 ($/1M tokens, 2026-07 기준)
// OpenAI: prefix 1024토큰 이상이면 자동 캐싱, cached input은 할인 단가
// Anthropic: cache write 1.25x / cache read 0.1x (전환 대비 보관)

export interface ModelPrice {
  input: number;
  cachedInput: number;
  output: number;
  cacheWrite?: number; // Anthropic만 해당
}

export const PRICES: Record<string, ModelPrice> = {
  // OpenAI
  "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },
  "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, output: 1.6 },
  "gpt-4.1": { input: 2.0, cachedInput: 0.5, output: 8.0 },
  // Anthropic (전환 대비)
  "claude-sonnet-4-6": { input: 3.0, cachedInput: 0.3, output: 15.0, cacheWrite: 3.75 },
  "claude-haiku-4-5": { input: 1.0, cachedInput: 0.1, output: 5.0, cacheWrite: 1.25 },
  "claude-opus-4-8": { input: 5.0, cachedInput: 0.5, output: 25.0, cacheWrite: 6.25 },
};

export interface Usage {
  input_tokens: number; // 캐시 안 된 입력
  output_tokens: number;
  cache_creation_input_tokens: number; // Anthropic 전용 (OpenAI는 0)
  cache_read_input_tokens: number; // 캐시에서 읽은 입력
}

/** 1회 호출 비용 (USD) */
export function costUsd(model: string, u: Usage): number {
  const p = PRICES[model];
  if (!p) return 0;
  return (
    (u.input_tokens * p.input +
      u.cache_creation_input_tokens * (p.cacheWrite ?? p.input) +
      u.cache_read_input_tokens * p.cachedInput +
      u.output_tokens * p.output) /
    1_000_000
  );
}
