import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { backendCommands } from './start-backend.mjs';

const supervisorUrl = new URL('./start-backend.mjs', import.meta.url).href;
const marker = 'SUPERVISOR_TEST ';
const databaseEnv = {
  DATABASE_URL: 'postgresql://app:example@db/everyday',
  SPRING_DATASOURCE_URL: 'jdbc:postgresql://db/everyday',
  SPRING_DATASOURCE_USERNAME: 'app',
  SPRING_DATASOURCE_PASSWORD: 'example',
};

function dummy(name, { crashCode = 7, stopDelay = 0, ignoreTerm = false } = {}) {
  const source = `
    const emit = event => console.log(${JSON.stringify(marker)} + JSON.stringify({ name: ${JSON.stringify(name)}, event, pid: process.pid }));
    process.on('SIGTERM', () => {
      emit('term');
      if (!${ignoreTerm}) setTimeout(() => { emit('stopped'); process.exit(0); }, ${stopDelay});
    });
    process.on('SIGUSR2', () => { emit('crash'); process.exit(${crashCode}); });
    setInterval(() => {}, 1000);
    emit('ready');
  `;
  return { name, command: process.execPath, args: ['--input-type=module', '-e', source], env: {} };
}

// Signals are sent only to this separate process group, never the node:test process.
function harness(t, commands, { graceMs = 1000 } = {}) {
  const source = `
    import { supervise } from ${JSON.stringify(supervisorUrl)};
    process.exitCode = await supervise(${JSON.stringify(commands)}, { graceMs: ${graceMs} });
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
    detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const changes = new EventEmitter();
  const events = [];
  let stdout = '', stderr = '', pending = '', closed = false;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    stdout += chunk;
    pending += chunk;
    for (;;) {
      const newline = pending.indexOf('\n');
      if (newline < 0) break;
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (line.startsWith(marker)) events.push(JSON.parse(line.slice(marker.length)));
    }
    changes.emit('change');
  });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      closed = true;
      changes.emit('change');
      resolve({ code, signal });
    });
  });
  t.after(async () => {
    if (!closed) {
      // Include descendants if an assertion fails before supervise finishes cleanup.
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    await done;
  });
  async function waitFor(predicate, timeoutMs = 3000) {
    if (predicate(events)) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(Error(`Timed out waiting for supervisor event.\n${stdout}\n${stderr}`)), timeoutMs);
      const changed = () => {
        if (predicate(events)) finish();
        else if (closed) finish(Error(`Supervisor exited before expected event.\n${stdout}\n${stderr}`));
      };
      function finish(error) {
        clearTimeout(timer);
        changes.off('change', changed);
        if (error) reject(error); else resolve();
      }
      changes.on('change', changed);
      changed();
    });
  }
  return {
    child, events, done, waitFor,
    ready: () => waitFor(items => ['api', 'spring'].every(name => items.some(item => item.name === name && item.event === 'ready'))),
    stderr: () => stderr,
  };
}

test('backend commands honor public PORT and avoid the private Spring port collision', () => {
  for (const [env, apiPort, springPort] of [
    [{ PORT: '8080', API_PORT: '4001' }, 8080, 18080],
    [{ API_PORT: '4001' }, 4001, 18080],
    [{}, 3001, 18080],
    [{ PORT: '18080' }, 18080, 18081],
  ]) {
    const [api, spring] = backendCommands({ ...databaseEnv, ...env });
    assert.equal(api.env.PORT, String(apiPort));
    assert.equal(api.env.API_HOST, '0.0.0.0');
    assert.equal(api.env.NODE_ENV, 'production');
    assert.equal(api.env.SPRING_API_URL, `http://127.0.0.1:${springPort}`);
    assert.ok(spring.args.includes(`--server.port=${springPort}`));
    assert.ok(spring.args.includes('--server.address=127.0.0.1'));
  }
  for (const PORT of ['', '0', '65536', '3001.5', 'abc', ' 3001 ', '3e3']) {
    assert.throws(() => backendCommands({ ...databaseEnv, PORT }), /PORT/);
  }
});

test('combined backend overrides old remote service addresses with loopback URLs', () => {
  const [api, spring] = backendCommands({
    ...databaseEnv, PORT: '8080', SPRING_API_URL: 'https://old-spring.example',
    WALLET_AUTH_URL: 'https://old-api.example', APP_MARKET_API_URL: 'https://old-api.example',
    JAVA_TOOL_OPTIONS: '-Xmx256m',
  });
  assert.equal(api.env.SPRING_API_URL, 'http://127.0.0.1:18080');
  assert.equal(spring.env.WALLET_AUTH_URL, 'http://127.0.0.1:8080');
  assert.equal(spring.env.APP_MARKET_API_URL, 'http://127.0.0.1:8080');
  assert.ok(spring.args.includes('--app.wallet.auth-url=http://127.0.0.1:8080'));
  assert.ok(spring.args.includes('--app.market.api-url=http://127.0.0.1:8080'));
  assert.equal(spring.env.JAVA_TOOL_OPTIONS, '-Xmx256m');
});

test('combined backend rejects missing database and JDBC settings before spawning', () => {
  for (const key of Object.keys(databaseEnv)) {
    const env = { ...databaseEnv };
    delete env[key];
    assert.throws(() => backendCommands(env), new RegExp(key));
    assert.throws(() => backendCommands({ ...databaseEnv, [key]: '' }), new RegExp(key));
  }
});

for (const crashCode of [7, 0]) {
  test(`unexpected child exit ${crashCode} terminates its sibling and fails the supervisor`, { timeout: 5000 }, async t => {
    const run = harness(t, [dummy('api', { crashCode }), dummy('spring')]);
    await run.ready();
    const api = run.events.find(item => item.name === 'api' && item.event === 'ready');
    process.kill(api.pid, 'SIGUSR2');
    assert.deepEqual(await run.done, { code: 1, signal: null });
    assert.ok(run.events.some(item => item.name === 'spring' && item.event === 'term'));
    assert.ok(run.events.some(item => item.name === 'spring' && item.event === 'stopped'));
    assert.match(run.stderr(), /api exited unexpectedly/);
  });
}

test('intentional SIGTERM lets Spring stop before terminating API and exits successfully', { timeout: 5000 }, async t => {
  const run = harness(t, [dummy('api'), dummy('spring', { stopDelay: 150 })]);
  await run.ready();
  run.child.kill('SIGTERM');
  assert.deepEqual(await run.done, { code: 0, signal: null });
  const shutdown = run.events.filter(item => item.event !== 'ready').map(item => `${item.name}:${item.event}`);
  assert.deepEqual(shutdown, ['spring:term', 'spring:stopped', 'api:term', 'api:stopped']);
  assert.equal(run.stderr(), '');
});

test('an unresponsive child is forcibly terminated within the shutdown budget', { timeout: 5000 }, async t => {
  const run = harness(t, [dummy('api'), dummy('spring', { ignoreTerm: true })], { graceMs: 200 });
  await run.ready();
  const start = performance.now();
  run.child.kill('SIGTERM');
  assert.deepEqual(await run.done, { code: 1, signal: null });
  assert.ok(performance.now() - start < 2000, 'supervisor must not wait indefinitely for a stuck child');
  assert.ok(run.events.some(item => item.name === 'spring' && item.event === 'term'));
  assert.ok(!run.events.some(item => item.name === 'spring' && item.event === 'stopped'));
  for (const { pid } of run.events.filter(item => item.event === 'ready')) {
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  }
});

test('a missing child executable fails startup and shuts down the sibling', { timeout: 5000 }, async t => {
  const run = harness(t, [dummy('api'), { name: 'spring', command: '/nonexistent/everyday-test-java', args: [], env: {} }]);
  assert.deepEqual(await run.done, { code: 1, signal: null });
  assert.match(run.stderr(), /spring could not start/);
});
