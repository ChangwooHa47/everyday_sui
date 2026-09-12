import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const command = process.argv[2];
if (!['build', 'start', 'dev'].includes(command)) {
  throw new Error('Usage: node scripts/baseline.mjs build|start|dev');
}
if (command === 'build') {
  // A clean checkout has no shared DTO declarations until contracts are built.
  const contracts = new URL('../../../packages/contracts/', import.meta.url);
  const contractsRequire = createRequire(new URL('package.json', contracts));
  const result = spawnSync(process.execPath, [contractsRequire.resolve('typescript/bin/tsc'),
    '--project', fileURLToPath(new URL('tsconfig.json', contracts))], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
// The archived Next AI routes are no longer part of this app. No AI keys needed.
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), command,
  ...(command === 'build' ? [] : ['--hostname', '127.0.0.1', '--port', '13000'])], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_LEGACY_BASELINE: '1',
    NEXT_PUBLIC_API_BASE: 'http://127.0.0.1:18080',
  },
});
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
