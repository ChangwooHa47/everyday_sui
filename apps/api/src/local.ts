import { mkdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { buildApp } from './app.js';
import { migration } from './database.js';
import { marketChainFromEnv } from './market-chain.js';
import { runtimeFromEnv, aiFromEnv } from './runtime-config.js';
import { migrateProduct } from './product/migrations.js';
import { seedEpisodeCatalog } from './product/episodes.js';
import { productFromEnv } from './product/index.js';

// Explicit development entry point. The production entry point requires Postgres.
const dataDir = process.env.LOCAL_DATABASE_PATH ?? '../../.local-tools/everyday-pglite';
// Match PGlite's filesystem routing without changing relative-path or memory URI semantics.
const filePath = dataDir.startsWith('file://') ? dataDir.slice(7)
  : /^(?:memory|idb|opfs-ahp):\/\//.test(dataDir) ? undefined : dataDir;
if (filePath) mkdirSync(filePath, { recursive: true });
const db = new PGlite(dataDir);
await db.exec(migration);
await migrateProduct(db);
await seedEpisodeCatalog(db);
const market = marketChainFromEnv();
const app = buildApp(true,{ db, market, ...runtimeFromEnv(market, process.env, db), ai: aiFromEnv(), product: productFromEnv(),
  auth:{origins:(process.env.WEB_ORIGINS ?? 'http://127.0.0.1:3000,http://127.0.0.1:3002').split(','),audience:'http://127.0.0.1:3001',network:'testnet'} });
app.addHook('onClose',() => db.close());
for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,() => {void app.close();});
await app.listen({host:'127.0.0.1',port:3001});
