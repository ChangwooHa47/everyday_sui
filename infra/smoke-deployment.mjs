// Run after building everyday-api:deployment-review and everyday-web:deployment-review.
// Creates and removes only its own temporary containers/network. No production data is used.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const prefix = `everyday-review-${randomBytes(5).toString('hex')}`;
const names = { baseline: `${prefix}-baseline`, db: `${prefix}-db`, api: `${prefix}-api`, web: `${prefix}-web` };
const apiImage = process.env.EVERYDAY_API_IMAGE ?? 'everyday-api:deployment-review';
const baselineImage = process.env.EVERYDAY_BASELINE_IMAGE;
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
  const snapshot = () => {
    const tables = docker('exec', names.db, 'psql', '-U', 'postgres', '-d', 'everyday', '-Atc',
      "SELECT tablename FROM pg_tables WHERE schemaname='everyday' ORDER BY tablename").split('\n');
    return Object.fromEntries(tables.map(table => [table, docker('exec', names.db, 'psql', '-U', 'postgres', '-d', 'everyday', '-Atc',
      `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') FROM everyday.${table} t`)]));
  };
  let existingData;
  if (baselineImage) {
    docker('run', '-d', '--name', names.baseline, '--network', prefix, '-p', '127.0.0.1::8080',
      '-e', 'PORT=8080', '-e', `DATABASE_URL=postgresql://postgres:${password}@${names.db}:5432/everyday`,
      '-e', `SPRING_DATASOURCE_URL=jdbc:postgresql://${names.db}:5432/everyday`,
      '-e', 'SPRING_DATASOURCE_USERNAME=postgres', '-e', `SPRING_DATASOURCE_PASSWORD=${password}`, baselineImage);
    await waitFor(`http://127.0.0.1:${port(names.baseline)}/health/ready`);
    docker('exec', names.db, 'psql', '-U', 'postgres', '-d', 'everyday', '-v', 'ON_ERROR_STOP=1', '-c', `
      INSERT INTO everyday.users(wallet_address,points,created_at,updated_at) VALUES('0x${'f'.repeat(64)}',1200,now(),now());
      INSERT INTO everyday.characters(user_id,name,relationship_type,gender,system_prompt,birthday,created_at,updated_at)
        SELECT id,'Migration fixture','FRIEND','OTHER','Private fixture prompt','1990-01-02',now(),now() FROM everyday.users;
      INSERT INTO everyday.chat_messages(character_id,sender,content,created_at,updated_at)
        SELECT id,'USER','Private fixture conversation',now(),now() FROM everyday.characters;
      INSERT INTO everyday.portrait_jobs(character_id,image_prompt,image_count,status)
        SELECT id,'Uncertain paid fixture',4,'unknown' FROM everyday.characters;
      INSERT INTO everyday.soul_training_requests(character_id,input_hash,status)
        SELECT id,repeat('f',64),'pending' FROM everyday.characters;
    `);
    docker('stop', '-t', '40', names.baseline);
    existingData = snapshot();
  }
  docker('run', '-d', '--name', names.api, '--network', prefix, '-p', '127.0.0.1::8080',
    '-e', 'PORT=8080', '-e', 'API_PORT=3001',
    '-e', `DATABASE_URL=postgresql://postgres:${password}@${names.db}:5432/everyday`,
    // Stale variables are ignored; there is no backend HTTP bridge.
    '-e', 'SPRING_API_URL=http://obsolete-spring.invalid:8080',
    '-e', 'WALLET_AUTH_URL=http://obsolete-api.invalid:8080',
    '-e', 'APP_MARKET_API_URL=http://obsolete-api.invalid:8080',
    '-e', 'WEB_ORIGINS=https://web.example.com', '-e', 'API_AUDIENCE=https://api.example.com',
    apiImage);
  let api = `http://127.0.0.1:${port(names.api)}`;
  await waitFor(`${api}/health/ready`);
  if (existingData) { assert.deepEqual(snapshot(), existingData); console.log('PASS actual previous Spring/Flyway database retained: all product rows and migration history unchanged'); }
  console.log('PASS single Node backend: SQL migrations, PORT=8080, database readiness');
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
  const runtimeCheck = docker('exec', names.api, 'node', '-e', `
    const fs = require('node:fs');
    const cp = require('node:child_process');
    const assert = require('node:assert/strict');
    assert.equal(cp.spawnSync('java', ['-version']).error?.code, 'ENOENT');
    const commands = fs.readdirSync('/proc').filter(p => /^\\d+$/.test(p)).flatMap(p => {
      try { return [fs.readFileSync('/proc/' + p + '/cmdline', 'utf8').split('\\0')]; } catch { return []; }
    });
    assert.equal(commands.filter(args => args[0] === 'node' && args[1] === 'apps/api/dist/server.js').length, 1);
    assert.ok(!commands.some(args => args[0].endsWith('/java') || args[0] === 'java'));
    console.log('single-node-runtime');
  `);
  assert.equal(runtimeCheck, 'single-node-runtime');
  console.log('PASS real wallet login and product API; one Node application process and no JVM executable');
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
  console.log('PASS graceful Node shutdown and restart against existing data');
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
