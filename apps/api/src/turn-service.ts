import { z } from 'zod';
import { failure, hash } from './auth.js';
import type { Database } from './database.js';
import { reserveAiBudget } from './ai-budget.js';
export interface AiConfig { endpoint: string; apiKey: string; model: string; dailyLimit: number; globalDailyLimit?: number; provider?: 'openai-compatible' | 'anthropic'; }
export const messagesSchema = z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(8000) }).strict()).min(1).max(40);
export const characterSchema = z.object({ name: z.string().min(1).max(80), personality: z.string().max(4000), callName: z.string().max(80) }).strict();
export type ChatMessage = z.infer<typeof messagesSchema>[number];

export async function requestCompletion(config: AiConfig, system: string, messages: ChatMessage[], maxTokens = 1000, timeout = 60000) {
  const anthropic = config.provider === 'anthropic';
  const response = await fetch(config.endpoint, { method: 'POST', signal: AbortSignal.timeout(timeout),
    headers: anthropic ? { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
      : { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.model, max_tokens: maxTokens,
      ...(anthropic ? { system, messages } : { messages: [{ role: 'system', content: system }, ...messages] }) }) });
  if (!response.ok) throw Error('provider failure');
  if (anthropic) {
    const data = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })) }).parse(await response.json());
    return z.string().min(1).max(32000).parse(data.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n'));
  }
  const data = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().min(1).max(32000) }) })).min(1) }).parse(await response.json());
  return data.choices[0].message.content;
}

// Only fingerprints/accounting are durable; prompts and completions are not.
export async function generateTurn(db: Database, config: AiConfig | undefined, input: {
  actor: string; requestId: string; fingerprint: unknown; system: string; messages: ChatMessage[];
  preview?: { listingId: string; limit: number };
}) {
  if (!config) throw failure(503, 'AI_NOT_CONFIGURED');
  const { actor, requestId } = input;
  const inputHash = hash(JSON.stringify(input.fingerprint));
  const inserted = await db.query(`INSERT INTO ai_requests(actor,request_id,input_hash,status)
    VALUES($1,$2,$3,'running') ON CONFLICT DO NOTHING RETURNING request_id`, [actor, requestId, inputHash]);
  if (!inserted.rows.length) {
    const old = await db.query<{ input_hash: string; status: string }>('SELECT input_hash,status FROM ai_requests WHERE actor=$1 AND request_id=$2', [actor, requestId]);
    throw failure(409, old.rows[0]?.input_hash !== inputHash ? 'IDEMPOTENCY_CONFLICT' : `TURN_${old.rows[0].status.toUpperCase()}`);
  }
  const unknown = () => db.query("UPDATE ai_requests SET status='unknown' WHERE actor=$1 AND request_id=$2", [actor, requestId]);
  try {
    await reserveAiBudget(db, actor, config.dailyLimit, config.globalDailyLimit, input.preview);
  } catch (error) {
    // No model request has started. The same request ID may be retried after a
    // known quota rejection without being mislabeled as an uncertain completion.
    await db.query("DELETE FROM ai_requests WHERE actor=$1 AND request_id=$2 AND status='running'", [actor, requestId]);
    throw error;
  }
  try {
    const content = await requestCompletion(config, input.system, input.messages);
    await db.query("UPDATE ai_requests SET status='completed' WHERE actor=$1 AND request_id=$2", [actor, requestId]);
    return { turnId: requestId, content };
  } catch { await unknown(); throw failure(502, 'PROVIDER_RESULT_UNKNOWN_DO_NOT_AUTO_RETRY'); }
}
