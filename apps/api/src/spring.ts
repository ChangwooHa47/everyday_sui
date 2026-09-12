import type { FastifyInstance } from 'fastify';
import { authenticate, failure, type AuthConfig } from './auth.js';
import type { Database } from './database.js';
import { readBytes } from './market-package.js';
import { reserveAiBudget } from './ai-budget.js';

/** Keep the original /api DTOs; Spring owns all off-chain product records. */
export function registerSpring(app: FastifyInstance, db: Database, auth: AuthConfig, baseUrl?: string, dailyLimit = 50, globalDailyLimit = 100) {
  if (!baseUrl) return;
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/') throw Error('Invalid SPRING_API_URL');
  app.route({ method: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'], url: '/api/*', handler: async (req, reply) => {
    const owner = await authenticate(req, db, auth);
    const url = new URL(req.raw.url!, base);
    // All product routes use ASCII IDs/names. Do not let an encoded route evade accounting rules.
    if (url.pathname.includes('%')) throw failure(400, 'NON_CANONICAL_PATH');
    if (url.origin !== base.origin || !url.pathname.startsWith('/api/') || url.pathname.startsWith('/api/auth/')) throw failure(404, 'NOT_FOUND');
    if (req.method === 'POST' && /\/(interview|compile|messages|greeting|train-face|photo-jobs|portraits|start)$/.test(url.pathname)) {
      await reserveAiBudget(db, owner, dailyLimit, globalDailyLimit);
    }
    let result: Response;
    try {
      result = await fetch(url, { method: req.method, redirect: 'error', signal: AbortSignal.timeout(180_000),
        headers: { Authorization: req.headers.authorization!, Origin: req.headers.origin!, 'Content-Type': 'application/json' },
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}) });
    } catch { throw failure(503, 'PRODUCT_SERVICE_UNAVAILABLE'); }
    if (result.status === 204) return reply.code(204).send();
    // Bound even error bodies, and never relay internal HTML/stack traces to the browser.
    const bytes = await readBytes(new Response(result.body, { status: 200, headers: result.headers }), 4 * 1024 * 1024);
    if (!result.headers.get('content-type')?.includes('application/json')) throw failure(502, 'PRODUCT_SERVICE_UNAVAILABLE');
    const retryAfter = result.headers.get('retry-after');
    if (result.status === 429 && retryAfter && /^[1-9][0-9]?$/.test(retryAfter) && Number(retryAfter) <= 60) {
      reply.header('Retry-After', retryAfter);
    }
    return reply.code(result.status).type('application/json').send(Buffer.from(bytes));
  } });
}
