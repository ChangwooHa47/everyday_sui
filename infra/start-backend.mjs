import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// One deployable backend, with the existing Java and Node implementations intact.
export function backendCommands(env = process.env) {
  const rawPort = env.PORT ?? env.API_PORT ?? '3001';
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
    throw Error('PORT must be an integer between 1 and 65535');
  }
  for (const key of ['DATABASE_URL', 'SPRING_DATASOURCE_URL', 'SPRING_DATASOURCE_USERNAME', 'SPRING_DATASOURCE_PASSWORD']) {
    if (!env[key]) throw Error(`${key} is required for the combined backend`);
  }
  const port = Number(rawPort);
  const springPort = port === 18080 ? 18081 : 18080;
  const apiUrl = `http://127.0.0.1:${port}`;
  const springUrl = `http://127.0.0.1:${springPort}`;
  return [
    { name: 'api', command: process.execPath, args: ['apps/api/dist/server.js'], env: {
      ...env, NODE_ENV: 'production', PORT: String(port), API_HOST: '0.0.0.0', SPRING_API_URL: springUrl,
    } },
    { name: 'spring', command: 'java', args: ['-jar', 'apps/api/spring/everyday.jar',
      `--server.port=${springPort}`, '--server.address=127.0.0.1', '--server.shutdown=graceful',
      '--spring.lifecycle.timeout-per-shutdown-phase=20s',
      `--app.wallet.auth-url=${apiUrl}`, `--app.market.api-url=${apiUrl}`], env: {
      ...env, PORT: String(springPort), WALLET_AUTH_URL: apiUrl, APP_MARKET_API_URL: apiUrl,
      JAVA_TOOL_OPTIONS: env.JAVA_TOOL_OPTIONS ?? '-XX:MaxRAMPercentage=40 -Dfile.encoding=UTF-8',
    } },
  ];
}

// Start concurrently: Spring needs Node callbacks, while readiness checks Spring.
// Unexpected exits fail the entire deployment; the platform owns restart policy.
export async function supervise(commands, { graceMs = 35000 } = {}) {
  let stopping = false, failed = false, killTimer;
  const children = [];
  const signal = (entry, value) => {
    if (!entry.exited) {
      entry.terminated = true;
      entry.child.kill(value);
    }
  };
  function stop(unexpected) {
    failed ||= unexpected;
    if (stopping) {
      if (unexpected) for (const entry of children) signal(entry, 'SIGTERM');
      return;
    }
    stopping = true;
    killTimer = setTimeout(() => {
      failed = true;
      for (const entry of children) signal(entry, 'SIGKILL');
    }, graceMs);
    if (unexpected) {
      for (const entry of children) signal(entry, 'SIGTERM');
    } else {
      // Let Spring finish its in-flight callbacks while Node is still listening.
      const spring = children.find(entry => entry.name === 'spring');
      if (spring && !spring.exited) signal(spring, 'SIGTERM');
      else for (const entry of children) signal(entry, 'SIGTERM');
    }
  }
  const onSignal = () => stop(false);
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
  try {
    for (const spec of commands) {
      const child = spawn(spec.command, spec.args, { env: spec.env, stdio: 'inherit' });
      const entry = { name: spec.name, child, exited: false, terminated: false };
      entry.done = new Promise(resolve => {
        child.on('error', () => {
          console.error(`[backend] ${entry.name} could not start`);
          stop(true);
        });
        child.once('close', (code, exitSignal) => {
          entry.exited = true;
          if (!stopping || !entry.terminated) {
            console.error(`[backend] ${entry.name} exited unexpectedly (${exitSignal ?? code})`);
            stop(true);
          } else if (code !== 0 && code !== 143 && exitSignal !== 'SIGTERM') {
            failed = true;
          }
          if (stopping && entry.name === 'spring') {
            for (const sibling of children) signal(sibling, 'SIGTERM');
          }
          resolve();
        });
      });
      children.push(entry);
    }
    await Promise.all(children.map(entry => entry.done));
    return failed ? 1 : 0;
  } finally {
    clearTimeout(killTimer);
    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await supervise(backendCommands()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
