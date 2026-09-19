import { createDAppKit } from '@mysten/dapp-kit-react';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { apiUrl, rpcUrl } from './web3/config';
import { endSession, refreshSession, type WalletSession } from './wallet-session';
import { loginSigningNetwork } from './wallet-preflight';

// Wallet discovery uses mainnet so mainnet-only Phantom is visible. Asset
// operations always pass testnet explicitly; this is not the settlement chain.
export const walletKit = createDAppKit({ networks: ['testnet', 'mainnet'], defaultNetwork: 'mainnet',
  slushWalletConfig: typeof window === 'undefined' ? null : { appName: 'everyday' },
  createClient: network => new SuiGrpcClient({ network,
    baseUrl: network === 'testnet' ? rpcUrl : 'https://fullnode.mainnet.sui.io:443' }) });
type Session = WalletSession;
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
let loggingOut = false;
let connected: string | undefined;
function revoke(token: string | null, includeRefresh = true) {
  void fetch(`${apiUrl}/v1/auth/session`, { method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: includeRefresh ? 'include' : 'omit', keepalive: true }).catch(() => {});
}
walletKit.stores.$connection.subscribe(connection => {
  const address = connection.account?.address;
  if (address === connected) return;
  const previous = connected;
  connected = address;
  generation++;
  if (loggingOut) return;
  const accountChanged = previous && (!address || normalizeSuiAddress(address) !== normalizeSuiAddress(previous));
  if (accountChanged || (session && (!address || normalizeSuiAddress(address) !== session.address))) {
    revoke(session?.token ?? null); remember(null);
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

async function waitForWalletConnection() {
  if (!connected && typeof window !== 'undefined') {
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => { unsubscribe(); resolve(); }, 10000);
      const unsubscribe = walletKit.stores.$connection.listen(value => {
        if (value.account) { clearTimeout(timeout); unsubscribe(); resolve(); }
      });
    });
  }
}

let refreshInFlight: Promise<string> | null = null;
export function refreshWalletToken() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    await waitForWalletConnection();
    if (loggingOut) throw Error('로그아웃 중입니다.');
    const account = walletKit.stores.$connection.get().account;
    if (!account) { remember(null); throw Error('로그인해주세요.'); }
    const owner = normalizeSuiAddress(account.address);
    const started = generation;
    return refreshSession({ owner, isCurrent: () => generation === started, remember,
      // A stale response must not revoke the new account's HttpOnly refresh cookie.
      revoke: token => revoke(token, false),
      request: () => fetch(`${apiUrl}/v1/auth/session/refresh`, { method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15000) }),
    });
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

export async function restoreWalletToken() {
  if (loggingOut) throw Error('로그아웃 중입니다.');
  await waitForWalletConnection();
  try { return getWalletToken(); }
  catch { return refreshWalletToken(); }
}

export async function loginWithWallet() {
  if (loggingOut) throw Error('로그아웃 중입니다.');
  const account = walletKit.stores.$connection.get().account;
  if (!account) throw Error('로그인해주세요.');
  const signingNetwork = loginSigningNetwork(walletKit.stores.$connection.get().wallet, account);
  const owner = normalizeSuiAddress(account.address);
  const started = generation;
  const check = () => { if (started !== generation) throw Error('다시 로그인해주세요.'); };
  async function post(path: string, body: unknown) {
    const response = await fetch(`${apiUrl}${path}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
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
  // The challenge remains bound to the app's testnet audience. Only the wallet's
  // personal-message transport uses its supported network; no transaction occurs.
  const signed = await walletKit.signPersonalMessage({ message: new TextEncoder().encode(challenge.message),
    account, network: signingNetwork });
  check();
  const result = await post('/v1/auth/sessions', { challengeId: challenge.id, signature: signed.signature });
  if (typeof result.token !== 'string' || result.address !== owner || !Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= Date.now()) {
    throw Error('로그인 응답을 확인할 수 없습니다.');
  }
  if (generation !== started) { revoke(result.token); check(); }
  try { walletKit.switchAccount({ account }); }
  catch (error) { revoke(result.token); throw error; }
  check();
  if (session) revoke(session.token, false);
  remember(result);
}

export async function logoutWallet() {
  if (loggingOut) throw Error('로그아웃 중입니다.');
  loggingOut = true;
  generation++; // Reject any login/refresh response already in flight.
  const token = session?.token;
  try {
    await endSession(() => fetch(`${apiUrl}/v1/auth/session`, {
      method: 'DELETE', credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(15000),
    }), () => {
      remember(null);
      try { localStorage.removeItem('everyday.v2.jwt'); } catch {}
    }, async () => {
      if (walletKit.stores.$connection.get().wallet) await walletKit.disconnectWallet();
    });
  } finally { loggingOut = false; }
}
