import Fastify from 'fastify';
import type { HealthResponse } from '@everyday/contracts';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { registerAuth, type AuthConfig } from './auth.js';
import type { Database } from './database.js';
import { registerAi, type AiConfig } from './ai.js';
import { registerMarket } from './market.js';
import type { MarketChain } from './market-chain.js';
import { registerMarketFlow, type MarketRuntime } from './market-flow.js';
import { registerMemory } from './memory.js';
import type { MemoryProvider } from './memory-provider.js';
import type { GiftService } from './gifts.js';

export function buildApp(logger = false, options?: { db: Database; auth: AuthConfig; ai?: AiConfig; market?: MarketChain; runtime?: MarketRuntime; memory?: MemoryProvider; gifts?: GiftService }) {
  const app = Fastify({
    logger: logger ? { redact: ['req.headers.authorization', 'req.headers.cookie'] } : false,
    bodyLimit: 1024 * 1024,
  });
  app.setErrorHandler((error, _req, reply) => {
    const status = error instanceof ZodError ? 400 : (error as { statusCode?: number }).statusCode ?? 500;
    reply.code(status).send({ error: status >= 500 ? 'SERVICE_UNAVAILABLE' : (error as Error).message });
  });
  app.get('/health/live', async (): Promise<HealthResponse> => ({
    service: 'everyday-api', status: 'ok', stage: options ? 'wallet' : 'foundation',
  }));
  if (options) {
    app.register(cors, { origin: options.auth.origins, methods: ['GET','POST','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] });
    app.register(rateLimit, { max: 60, timeWindow: '1 minute' });
    app.get('/health/ready', async () => { await options.db.query('SELECT 1'); return { status: 'ok' }; });
    registerAuth(app, options.db, options.auth);
    registerAi(app, options.db, options.auth, options.ai);
    registerMarket(app, options.db, options.auth, options.market);
    registerMarketFlow(app, options.db, options.auth, options.market, options.runtime, options.ai, options.memory, options.gifts);
    if (options.gifts) {
      let recovering = false;
      const timer = setInterval(() => {
        if (recovering) return;
        recovering = true;
        void options.gifts!.recover().catch(() => {}).finally(() => { recovering = false; });
      }, 30000);
      timer.unref();
      app.addHook('onClose', async () => { clearInterval(timer); });
    }
    registerMemory(app, options.db, options.auth, options.memory, options.market);
  }
  return app;
}
