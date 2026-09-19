import { z } from 'zod';
import { addressSchema } from './auth.js';
import { createPackageStore } from './market-package.js';
import { createMemoryProvider } from './memory-provider.js';
import type { MarketChain } from './market-chain.js';
import type { AiConfig } from './turn-service.js';
import type { Database } from './database.js';
import { createGiftService, createGiftTransport, giftDecision } from './gifts.js';
import { reserveAiBudget } from './ai-budget.js';
const httpsUrl = z.string().url().refine(value => new URL(value).protocol === 'https:').transform(value => value.replace(/\/$/, ''));
export function aiLimitsFromEnv(env: NodeJS.ProcessEnv = process.env) {
  return { dailyLimit: z.coerce.number().int().min(1).max(10000).parse(env.AI_DAILY_LIMIT ?? 50),
    globalDailyLimit: z.coerce.number().int().min(1).max(100000).parse(env.AI_GLOBAL_DAILY_LIMIT ?? 100) };
}
export function aiFromEnv(env: NodeJS.ProcessEnv = process.env): AiConfig | undefined {
  const limits = aiLimitsFromEnv(env);
  if (!env.AI_API_KEY && !env.AI_ENDPOINT && !env.AI_MODEL) {
    if (!env.ANTHROPIC_API_KEY) return undefined;
    return { provider: 'anthropic', apiKey: env.ANTHROPIC_API_KEY,
      endpoint: `${httpsUrl.parse(env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com')}/v1/messages`,
      model: env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5', ...limits };
  }
  return { apiKey: z.string().min(1).parse(env.AI_API_KEY), endpoint: z.string().url().parse(env.AI_ENDPOINT),
    model: z.string().min(1).parse(env.AI_MODEL), ...limits };
}
export function runtimeFromEnv(chain: MarketChain | undefined, env: NodeJS.ProcessEnv = process.env, db?: Database, giftChain?: MarketChain) {
  const rpcUrl = httpsUrl.parse(env.SUI_GRPC_URL ?? 'https://fullnode.testnet.sui.io:443');
  let runtime; let memory;
  if (env.SUI_OPERATOR_KEY) {
    if (!chain) throw Error('SUI_MARKET_PACKAGE_ID is required for market runtime');
    const servers = z.array(z.object({ objectId: addressSchema, weight: z.literal(1), aggregatorUrl: httpsUrl.optional() }).strict()).min(2).parse(JSON.parse(env.SEAL_SERVERS_JSON ?? 'null'));
    if (new Set(servers.map(s => s.objectId)).size !== servers.length) throw Error('Seal servers must be distinct');
    runtime = { previewTurns: z.coerce.number().int().min(1).max(20).parse(env.MARKET_PREVIEW_TURNS ?? 3),
      packages: createPackageStore({ packageId: chain.packageId, rpcUrl, operatorKey: env.SUI_OPERATOR_KEY, servers,
        threshold: z.coerce.number().int().min(2).max(servers.length).parse(env.SEAL_THRESHOLD ?? 2),
        publisher: httpsUrl.parse(env.WALRUS_PUBLISHER), aggregator: httpsUrl.parse(env.WALRUS_AGGREGATOR),
        walrusTypeOrigin: env.WALRUS_TYPE_ORIGIN ? addressSchema.parse(env.WALRUS_TYPE_ORIGIN) : undefined,
        epochs: z.coerce.number().int().min(1).max(53).parse(env.WALRUS_EPOCHS ?? 7) }) };
  }
  if (env.MEMWAL_DELEGATE_MASTER_KEY) {
    if (!chain) throw Error('SUI_MARKET_PACKAGE_ID is required for memory');
    memory = createMemoryProvider({ masterKey: z.string().regex(/^[a-fA-F0-9]{64}$/).parse(env.MEMWAL_DELEGATE_MASTER_KEY),
      packageId: addressSchema.parse(env.MEMWAL_PACKAGE_ID), registryId: addressSchema.parse(env.MEMWAL_REGISTRY_ID),
      marketPackageId: chain.packageId, rpcUrl, serverUrl: httpsUrl.parse(env.MEMWAL_SERVER_URL ?? 'https://relayer-staging.memory.walrus.xyz') });
  }
  let gifts;
  if (env.AGENT_GIFTS_ENABLED === '1') {
    const ai = aiFromEnv(env);
    if (!db || !chain || !runtime || !ai || !env.SUI_OPERATOR_KEY) throw Error('Agent gifts require DB, market runtime and AI configuration');
    // send_nft_gift takes the Listing and the NftGiftProduct in one Move call, so both must live in one package.
    // Fail closed instead of signing transactions the chain would reject.
    const giftPackage = (giftChain ?? chain).packageId;
    if (giftPackage !== chain.packageId) throw Error('Agent gifts require NFT_GIFT_PACKAGE_ID to equal SUI_MARKET_PACKAGE_ID: send_nft_gift needs the Listing and NftGiftProduct in the same package');
    gifts = createGiftService(db, createGiftTransport(giftPackage, rpcUrl, env.SUI_OPERATOR_KEY), giftDecision(ai),
      owner => reserveAiBudget(db, owner, ai.dailyLimit, ai.globalDailyLimit));
  }
  return { runtime, memory, gifts };
}
