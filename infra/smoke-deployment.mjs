// Run after building everyday-api:deployment-review and everyday-web:deployment-review.
// Creates and removes only its own temporary containers/network. No production data is used.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const prefix = `everyday-review-${randomBytes(5).toString('hex')}`;
const names = { db: `${prefix}-db`, api: `${prefix}-api`, web: `${prefix}-web` };
const password = randomBytes(24).toString('hex');
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const port = name => docker('port', name).match(/127\.0\.0\.1:(\d+)/)?.[1];
async function waitFor(url, status = 200) {
  for (let i = 0; i < 40; i++) {
    try { const result = await fetch(url, { signal: AbortSignal.timeout(15000) }); if (result.status === status) return result; } catch {}
    await pause(500);
  }
  throw Error(`Expected HTTP ${status} from ${url}`);
}
try {
  docker('network', 'create', prefix);
  docker('run', '-d', '--name', names.db, '--network', prefix,
    '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=everyday', 'postgres:17-bookworm');
  let dbReady = false;
  for (let i = 0; i < 40; i++) {
    try { docker('exec', names.db, 'pg_isready', '-U', 'postgres'); dbReady = true; break; } catch { await pause(500); }
  }
  assert.ok(dbReady, 'Postgres startup');
  docker('run', '-d', '--name', names.api, '--network', prefix, '-p', '127.0.0.1::8080',
    '-e', 'PORT=8080', '-e', 'API_PORT=3001',
    '-e', `DATABASE_URL=postgresql://postgres:${password}@${names.db}:5432/everyday`,
    '-e', 'WEB_ORIGINS=https://web.example.com', '-e', 'API_AUDIENCE=https://api.example.com',
    'everyday-api:deployment-review');
  const api = `http://127.0.0.1:${port(names.api)}`;
  await waitFor(`${api}/health/ready`);
  console.log('PASS API image: real Postgres migration, PORT=8080 overrides API_PORT=3001, externally reachable readiness');
  for (let i = 0; i < 65; i++) assert.equal((await fetch(`${api}/health/ready`)).status, 200);
  console.log('PASS readiness is not throttled');
  const cors = await fetch(`${api}/v1/auth/challenge`, { method: 'OPTIONS', headers: {
    Origin: 'https://web.example.com', 'Access-Control-Request-Method': 'POST',
  } });
  assert.equal(cors.headers.get('access-control-allow-origin'), 'https://web.example.com');
  docker('run', '-d', '--name', names.web, '--network', prefix, '-p', '127.0.0.1::8090',
    '-e', 'PORT=8090', 'everyday-web:deployment-review');
  const web = `http://127.0.0.1:${port(names.web)}`;
  const html = await (await waitFor(web)).text();
  const asset = html.match(/src="(\/_next\/[^" ]+)"/)?.[1];
  assert.ok(asset, 'Next.js JavaScript asset');
  for (const route of ['/market', '/viewer', '/icons/home.svg', asset]) await waitFor(web + route);
  assert.equal(docker('exec', names.web, 'id', '-u'), '1000');
  assert.equal(docker('exec', names.api, 'id', '-u'), '1000');
  console.log('PASS web image: PORT=8090, pages/static assets; both images run as non-root');
  docker('stop', '-t', '1', names.db);
  await waitFor(`${api}/health/ready`, 503);
  await waitFor(`${api}/health/live`);
  console.log('PASS database outage: readiness 503, liveness 200');
  docker('start', names.db);
  await waitFor(`${api}/health/ready`);
  console.log('PASS readiness recovers after Postgres restart');
} catch (error) {
  // Do not print raw docker command arguments, which contain the temporary DB password.
  console.error(error instanceof assert.AssertionError ? error.message : 'Container smoke test failed; inspect the test step above.');
  for (const [role, name] of Object.entries(names)) {
    try {
      const logs = spawnSync('docker', ['logs', '--tail', '15', name], { encoding: 'utf8' });
      console.error(`${role}: ${(logs.stdout + logs.stderr).replaceAll(password, '[redacted]')}`);
    } catch {}
  }
  process.exitCode = 1;
} finally {
  for (const name of Object.values(names)) { try { docker('rm', '-f', '-v', name); } catch {} }
  try { docker('network', 'rm', prefix); } catch {}
}
