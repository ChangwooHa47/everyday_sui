import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { Database } from '../database.js';
import { failure, type AuthConfig } from '../auth.js';
import { reserveAiBudget } from '../ai-budget.js';
import type { MarketChain } from '../market-chain.js';
import type { PackageStore } from '../market-package.js';
import type { MemoryProvider } from '../memory-provider.js';
import { createProductContext, type ProductOptions } from './context.js';
import { productError } from './core.js';
import { registerProductCharacters } from './characters.js';
import { registerProductConversations } from './conversations.js';
import { registerProductEpisodes } from './episodes.js';
import { registerProductImages, startProductImageWorkers } from './images.js';
import { registerProductLibrary } from './library.js';
import { AnthropicLlmClient } from './llm.js';
import { createHiggsfieldImageProvider } from './image-provider.js';
import type { GiftService } from '../gifts.js';
import { createPhotoPaymentProvider } from './photo-payment.js';

export function productFromEnv(env: NodeJS.ProcessEnv = process.env): ProductOptions {
  return {
    llm: new AnthropicLlmClient({ apiKey: env.ANTHROPIC_API_KEY, baseUrl: env.ANTHROPIC_BASE_URL, model: env.ANTHROPIC_MODEL }),
    image: createHiggsfieldImageProvider({ apiKey: env.HIGGSFIELD_API_KEY, apiSecret: env.HIGGSFIELD_API_SECRET, baseUrl: env.HIGGSFIELD_BASE_URL }),
    photoPayments: createPhotoPaymentProvider(env.PHOTO_PAYMENT_RECIPIENT, env.PHOTO_PRICE_MIST),
  };
}
export function registerProduct(app: FastifyInstance, options: {
  db: Database; auth: AuthConfig; providers: ProductOptions; chain?: MarketChain; packages?: PackageStore;
  memory?: MemoryProvider; gifts?: GiftService; dailyLimit?: number; globalDailyLimit?: number;
}) {
  const context = createProductContext(options.db, options.auth, options.providers, options.chain, options.memory, options.gifts, options.packages);
  app.register(async product => {
    product.setErrorHandler((error, _req, reply) => {
      const known = error as Error & { productError?: boolean; statusCode?: number };
      const status = error instanceof ZodError ? 400 : known.statusCode ?? 500;
      if (error instanceof ZodError || known.productError || status >= 500 && !known.statusCode) {
        const message = error instanceof ZodError ? productError('INVALID_REQUEST').message
          : known.productError ? known.message : productError(500).message;
        return reply.code(status).send({ success: false, data: null, message });
      }
      return reply.code(status).send({ error: status >= 500 ? 'SERVICE_UNAVAILABLE' : known.message });
    });
    product.addHook('preHandler', async req => {
      const path = new URL(req.raw.url!, 'http://local.invalid').pathname;
      if (path.includes('%')) throw failure(400, 'NON_CANONICAL_PATH');
      const identity = await context.authenticate(req);
      // Preserve the existing per-wallet/global quota boundary for product generation routes.
      if (req.method === 'POST' && /\/(interview|compile|messages|greeting|train-face|photo-jobs|portraits|start)$/.test(path))
        await reserveAiBudget(options.db, identity.address, options.dailyLimit ?? 50, options.globalDailyLimit ?? 100);
    });
    registerProductCharacters(product, context);
    registerProductConversations(product, context);
    registerProductEpisodes(product, context);
    registerProductImages(product, context);
    registerProductLibrary(product, context, options.chain, options.packages);
  });
  if (options.providers.workers !== false) {
    let stop: (() => Promise<void>) | undefined;
    app.addHook('onReady', async () => { stop = startProductImageWorkers(context, () => app.log.error('Product background job failed')); });
    app.addHook('preClose', async () => { await stop?.(); });
  }
}
