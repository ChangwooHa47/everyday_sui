// Run after building everyday-api:deployment-review and everyday-web:deployment-review.
// Creates and removes only its own temporary containers/network. No production data is used.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const prefix = `everyday-review-${randomBytes(5).toString('hex')}`;
const names = { db: `${prefix}-db`, api: `${prefix}-api`, web: `${prefix}-web` };
const password = randomBytes(24).toString('hex');
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const port = name => docker('port', name).match(/127\.0\.0\.1:(\d+)/)?.[1];
async function waitFor(url, status = 200) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    try { const result = await fetch(url, { signal: AbortSignal.timeout(2000) }); if (result.status === status) return result; } catch {}
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
    '-e', `SPRING_DATASOURCE_URL=jdbc:postgresql://${names.db}:5432/everyday`,
    '-e', 'SPRING_DATASOURCE_USERNAME=postgres', '-e', `SPRING_DATASOURCE_PASSWORD=${password}`,
    // Old cross-service addresses must not escape the combined container.
    '-e', 'SPRING_API_URL=http://obsolete-spring.invalid:8080',
    '-e', 'WALLET_AUTH_URL=http://obsolete-api.invalid:8080',
    '-e', 'APP_MARKET_API_URL=http://obsolete-api.invalid:8080',
    '-e', 'WEB_ORIGINS=https://web.example.com', '-e', 'API_AUDIENCE=https://api.example.com',
    'everyday-api:deployment-review');
  let api = `http://127.0.0.1:${port(names.api)}`;
  await waitFor(`${api}/health/ready`);
  console.log('PASS combined backend: Node + Spring migrations, custom PORT=8080, aggregate readiness');
  const headers = { Origin: 'https://web.example.com', 'Content-Type': 'application/json' };
  const key = new Ed25519Keypair();
  const challenge = await (await fetch(api + '/v1/auth/challenges', { method: 'POST', headers,
    body: JSON.stringify({ address: key.toSuiAddress(), network: 'testnet' }) })).json();
  const signed = await key.signPersonalMessage(new TextEncoder().encode(challenge.message));
  const session = await (await fetch(api + '/v1/auth/sessions', { method: 'POST', headers,
    body: JSON.stringify({ challengeId: challenge.id, signature: signed.signature }) })).json();
  assert.ok(session.token);
  const product = await fetch(api + '/api/characters', { headers: { ...headers, Authorization: `Bearer ${session.token}` } });
  assert.equal(product.status, 200);
  assert.deepEqual((await product.json()).data, []);
  // Spring's listener must be inaccessible through the container's network IP.
  const internalIp = docker('inspect', '--format', `{{(index .NetworkSettings.Networks "${prefix}").IPAddress}}`, names.api);
  const hidden = spawnSync('docker', ['exec', names.api, 'node', '-e',
    `fetch('http://${internalIp}:18080/health/ready',{signal:AbortSignal.timeout(1000)}).then(()=>process.exit(1)).catch(()=>process.exit(0))`]);
  assert.equal(hidden.status, 0);
  console.log('PASS real wallet login → gateway → Spring → local auth callback; Spring is loopback-only');
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
  for (const route of ['/create', '/subscription', '/icons/home.svg', asset]) await waitFor(web + route);
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
  docker('stop', '-t', '40', names.api);
  assert.equal(docker('inspect', '--format', '{{.State.ExitCode}}', names.api), '0');
  docker('start', names.api);
  api = `http://127.0.0.1:${port(names.api)}`;
  await waitFor(`${api}/health/ready`);
  console.log('PASS graceful combined shutdown and restart against existing data');
  docker('exec', names.api, 'node', '-e', `
    const fs = require('node:fs');
    for (const pid of fs.readdirSync('/proc').filter(p => /^\\d+$/.test(p))) {
      try { if (fs.readFileSync('/proc/' + pid + '/comm', 'utf8').trim() === 'java') process.kill(Number(pid), 'SIGKILL'); } catch {}
    }
  `);
  assert.equal(docker('wait', names.api), '1');
  console.log('PASS Spring crash stops the whole backend with failure instead of leaving a partial service');
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
