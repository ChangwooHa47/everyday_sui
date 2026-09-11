import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const command = process.argv[2];
if (!['build', 'start', 'dev'].includes(command)) {
  throw new Error('Usage: node scripts/baseline.mjs build|start|dev');
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
