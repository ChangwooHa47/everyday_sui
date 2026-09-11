import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = fileURLToPath(new URL('../.local-tools/sui-1.79.0/sui.exe', import.meta.url));
const executable = process.env.SUI_BIN || (process.platform === 'win32' && existsSync(local) ? local : 'sui');
const action = process.argv[2];
if (!['test', 'build'].includes(action)) throw Error('Expected test or build');
const result = spawnSync(executable, ['move', action, '--path', 'contracts/everyday'], { cwd: root, stdio: 'inherit', shell: false });
if (result.error) console.error('Install Sui CLI testnet-v1.79.0 or set SUI_BIN to its executable:', result.error.message);
process.exitCode = result.status ?? 1;
