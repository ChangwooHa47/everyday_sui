import { createDAppKit } from '@mysten/dapp-kit-react';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { apiUrl, rpcUrl } from './web3/config';

export const walletKit = createDAppKit({ networks: ['testnet'],
  slushWalletConfig: { appName: 'everyday' },
  createClient: () => new SuiGrpcClient({ network: 'testnet', baseUrl: rpcUrl }) });
type Session = { token: string; address: string; expiresAt: string };
const sessionKey = 'everyday.session.v1';
function readSession(): Session | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(sessionKey) ?? 'null');
    if (value && /^[A-Za-z0-9_-]{43}$/.test(value.token) && /^0x[0-9a-f]{64}$/.test(value.address)
      && Date.parse(value.expiresAt) > Date.now()) return value;
  } catch {}
  return null;
}
let session: Session | null = readSession();
function remember(value: Session | null) {
  session = value;
  try { if (value) sessionStorage.setItem(sessionKey, JSON.stringify(value)); else sessionStorage.removeItem(sessionKey); } catch {}
}
let generation = 0;
let connected: string | undefined;
function revoke(token: string) {
  void fetch(`${apiUrl}/v1/auth/session`, { method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }, keepalive: true }).catch(() => {});
}
walletKit.stores.$connection.subscribe(connection => {
  const address = connection.account?.address;
  if (address === connected) return;
  connected = address;
  generation++;
  if (session && (!address || normalizeSuiAddress(address) !== session.address)) {
    revoke(session.token); remember(null);
    if (typeof window !== 'undefined' && window.location.pathname !== '/') window.location.replace('/');
  }
});

export function getWalletToken() {
  if (!session || !connected || normalizeSuiAddress(connected) !== session.address || Date.parse(session.expiresAt) <= Date.now()) {
    remember(null);
    throw Error('로그인해주세요.');
  }
  return session.token;
}

export async function restoreWalletToken() {
  if (session && !connected && typeof window !== 'undefined') {
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => { unsubscribe(); resolve(); }, 10000);
      const unsubscribe = walletKit.stores.$connection.listen(value => {
        if (value.account) { clearTimeout(timeout); unsubscribe(); resolve(); }
      });
    });
  }
  return getWalletToken();
}

export async function loginWithWallet() {
  const address = walletKit.stores.$connection.get().account?.address;
  if (!address) throw Error('로그인해주세요.');
  const owner = normalizeSuiAddress(address);
  const started = generation;
  const check = () => { if (started !== generation) throw Error('다시 로그인해주세요.'); };
  async function post(path: string, body: unknown) {
    const response = await fetch(`${apiUrl}${path}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error('로그인에 실패했습니다. 잠시 후 다시 시도해주세요.');
    return response.json();
  }
  const challenge = await post('/v1/auth/challenges', { address: owner, network: 'testnet' });
  check();
  if (typeof challenge.id !== 'string' || typeof challenge.message !== 'string' ||
      !challenge.message.startsWith('Everyday wallet login v1\n') ||
      !challenge.message.split('\n').includes(`Address: ${owner}`) ||
      !challenge.message.split('\n').includes(`Origin: ${window.location.origin}`) ||
      !challenge.message.split('\n').includes(`Audience: ${new URL(apiUrl).origin}`) ||
      !challenge.message.split('\n').includes('Chain: sui:testnet')) throw Error('로그인 요청을 확인할 수 없습니다.');
  const signed = await walletKit.signPersonalMessage({ message: new TextEncoder().encode(challenge.message) });
  check();
  const result = await post('/v1/auth/sessions', { challengeId: challenge.id, signature: signed.signature });
  if (typeof result.token !== 'string' || result.address !== owner || !Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= Date.now()) {
    throw Error('로그인 응답을 확인할 수 없습니다.');
  }
  if (generation !== started) { revoke(result.token); check(); }
  if (session) revoke(session.token);
  remember(result);
}
