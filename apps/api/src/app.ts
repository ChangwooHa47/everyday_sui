import Fastify from 'fastify';
import type { HealthResponse } from '@everyday/contracts';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { authenticate, registerAuth, type AuthConfig } from './auth.js';
import type { Database } from './database.js';
import { registerAi, type AiConfig } from './ai.js';
import { registerMarket } from './market.js';
import type { MarketChain } from './market-chain.js';
import { registerMarketFlow, type MarketRuntime } from './market-flow.js';
import { registerMemory } from './memory.js';
import type { MemoryProvider } from './memory-provider.js';
import type { GiftService } from './gifts.js';
import { registerProduct } from './product/index.js';
import type { ProductOptions } from './product/context.js';
import { registerPublications } from './publications.js';

export function buildApp(logger = false, options?: { db: Database; auth: AuthConfig; ai?: AiConfig; aiLimits?: Pick<AiConfig, 'dailyLimit' | 'globalDailyLimit'>; market?: MarketChain; giftMarket?: MarketChain; runtime?: MarketRuntime; memory?: MemoryProvider; gifts?: GiftService; product?: ProductOptions }) {
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
    app.register(cors, { origin: options.auth.origins, methods: ['GET','POST','PATCH','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] });
    app.register(rateLimit, { max: 120, timeWindow: '1 minute', hook: 'preHandler', keyGenerator: async req => {
      // Resolve a valid session
      // before assigning a per-user quota; arbitrary Authorization values cannot mint buckets.
      // Validate after body parsing, then reuse that identity in the route handler.
      if (req.headers.authorization) {
        try { return `user:${await authenticate(req, options.db, options.auth)}`; } catch {}
      }
      return `ip:${req.ip}`;
    } });
    // rate-limit installs an onRoute hook during plugin loading. Register routes
    // only after that hook exists, otherwise the configured quota never runs.
    app.after(error => {
      if (error) throw error;
      app.get('/health/ready', { config: { rateLimit: false } }, async (_request, reply) => {
        try {
          await options.db.query('SELECT 1');
          return { status: 'ok' };
        } catch {
          return reply.code(503).send({ status: 'unavailable' });
        }
      });
      registerAuth(app, options.db, options.auth);
      if (options.product) registerProduct(app, { db: options.db, auth: options.auth, providers: options.product,
        chain: options.market, packages: options.runtime?.packages, memory: options.memory,
        gifts: options.gifts,
        dailyLimit: options.aiLimits?.dailyLimit ?? options.ai?.dailyLimit,
        globalDailyLimit: options.aiLimits?.globalDailyLimit ?? options.ai?.globalDailyLimit });
      registerAi(app, options.db, options.auth, options.ai);
      registerMarket(app, options.db, options.auth, options.market, options.runtime?.packages, Boolean(options.product), options.giftMarket);
      registerMarketFlow(app, options.db, options.auth, options.market, options.runtime, options.ai, options.memory, options.gifts);
      registerPublications(app, options.db, options.auth, options.market);
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
    });
  }
  return app;
}
