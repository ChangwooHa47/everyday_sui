import { PGlite } from '@electric-sql/pglite';
import { buildApp } from './app.js';
import { migration } from './database.js';
import { marketChainFromEnv } from './market-chain.js';
import { runtimeFromEnv, aiFromEnv } from './runtime-config.js';

// Explicit development entry point. The production entry point requires Postgres.
const db = new PGlite(process.env.LOCAL_DATABASE_PATH ?? '../../.local-tools/everyday-pglite');
await db.exec(migration);
const market = marketChainFromEnv();
const app = buildApp(true,{ db, market, ...runtimeFromEnv(market, process.env, db), ai: aiFromEnv(),
  auth:{origins:(process.env.WEB_ORIGINS ?? 'http://127.0.0.1:3000,http://127.0.0.1:3002').split(','),audience:'http://127.0.0.1:3001',network:'testnet'} });
app.addHook('onClose',() => db.close());
for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,() => {void app.close();});
await app.listen({host:'127.0.0.1',port:3001});
