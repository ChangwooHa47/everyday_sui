import { buildApp } from './app.js';
import { readConfig } from './config.js';
import { connectDatabase, migration } from './database.js';
import { marketChainFromEnv } from './market-chain.js';
import { runtimeFromEnv, aiFromEnv } from './runtime-config.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; start Postgres first');
const db = connectDatabase(process.env.DATABASE_URL);
// Idle pg clients emit errors when Postgres restarts. Keep the process alive;
// requests/readiness still fail closed until the pool can reconnect.
db.on('error', () => console.error('Postgres connection lost; readiness will remain unavailable until reconnection.'));
await db.query(migration);
const origins = (process.env.WEB_ORIGINS ?? 'http://127.0.0.1:3000').split(',');
for (const origin of origins) if (new URL(origin).origin !== origin) throw Error('WEB_ORIGINS must contain exact origins');
const market = marketChainFromEnv();
const app = buildApp(true, { db, auth: { origins, audience: process.env.API_AUDIENCE ?? 'http://127.0.0.1:3001', network: 'testnet' },
  market, ...runtimeFromEnv(market, process.env, db), ai: aiFromEnv() });
app.addHook('onClose', () => db.end());
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close().catch(error => {
    app.log.error(error);
    process.exitCode = 1;
  }); });
}
try {
  await app.listen(readConfig());
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
