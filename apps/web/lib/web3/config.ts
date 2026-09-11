import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils';

export const network = 'testnet' as const;
export const rpcUrl = process.env.NEXT_PUBLIC_SUI_RPC ?? 'https://fullnode.testnet.sui.io:443';
export const apiUrl = process.env.NEXT_PUBLIC_API_BASE ?? 'http://127.0.0.1:3001';
export const packageId = process.env.NEXT_PUBLIC_SUI_PACKAGE_ID ?? '';
export const aggregatorUrl = process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR ?? '';
export const publisherUrl = process.env.NEXT_PUBLIC_WALRUS_PUBLISHER ?? '';
export const sealServerIds = (process.env.NEXT_PUBLIC_SEAL_SERVER_IDS ?? '').split(',').filter(Boolean);
export const sealThreshold = Number(process.env.NEXT_PUBLIC_SEAL_THRESHOLD ?? '2');
export function requirePackage() {
  if (!isValidSuiAddress(packageId) || BigInt(packageId) === 0n) throw Error('현재 서비스를 이용할 수 없습니다.');
  return normalizeSuiAddress(packageId);
}
export function requireSeal() {
  requirePackage();
  if (sealServerIds.length < 2 || new Set(sealServerIds).size !== sealServerIds.length || !sealServerIds.every(isValidSuiAddress)
    || !Number.isInteger(sealThreshold) || sealThreshold < 2 || sealThreshold > sealServerIds.length) {
    throw Error('현재 보관함을 열 수 없습니다.');
  }
}
export function endpoint(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname))) throw Error('안전하게 연결할 수 없습니다.');
  return url.toString().replace(/\/$/, '');
}
