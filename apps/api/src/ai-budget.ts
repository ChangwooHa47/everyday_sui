import type { Database } from './database.js';
import { failure } from './auth.js';

/** Counts authorized generation requests, including ambiguous provider results; this is not a currency budget. */
export async function reserveAiBudget(db: Database, actor: string, dailyLimit = 50, globalDailyLimit = 100, preview?: { listingId: string; limit: number }) {
  const result = await db.query<{ result: string }>('SELECT public.reserve_ai_budget($1,$2,$3,$4,$5) AS result',
    [actor, dailyLimit, globalDailyLimit, preview?.listingId ?? null, preview?.limit ?? null]);
  if (result.rows[0]?.result === 'global') throw failure(429, 'GLOBAL_DAILY_AI_LIMIT');
  if (result.rows[0]?.result === 'owner') throw failure(429, 'DAILY_AI_LIMIT');
  if (result.rows[0]?.result === 'preview') throw failure(403, 'PREVIEW_EXHAUSTED');
  if (result.rows[0]?.result !== 'ok') throw failure(503, 'AI_BUDGET_UNAVAILABLE');
}
