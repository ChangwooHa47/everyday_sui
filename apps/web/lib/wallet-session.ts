export type WalletSession = { token: string; address: string; expiresAt: string };

export async function endSession(request: () => Promise<Response>, clear: () => void, disconnect: () => Promise<void>) {
  const response = await request();
  // An absent/expired session is already signed out. Provider failures are not success.
  if (!response.ok && response.status !== 401) throw Error('로그아웃에 실패했습니다.');
  clear();
  await disconnect();
}

/** A refresh response belongs to the connection that started it, never a later account. */
export async function refreshSession({ owner, isCurrent, request, remember, revoke }: {
  owner: string;
  isCurrent: () => boolean;
  request: () => Promise<Response>;
  remember: (session: WalletSession | null) => void;
  revoke: (token: string) => void;
}): Promise<string> {
  const response = await request();
  if (!response.ok) {
    if (isCurrent()) remember(null);
    throw Error('다시 로그인해주세요.');
  }
  const result: unknown = await response.json();
  const value = result as Partial<WalletSession> | null;
  const token = value && typeof value.token === 'string' ? value.token : null;
  if (!isCurrent()) {
    if (token) revoke(token);
    throw Error('다시 로그인해주세요.');
  }
  if (!value || !token || !/^[A-Za-z0-9_-]{43}$/.test(token) || value.address !== owner
    || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))
    || Date.parse(value.expiresAt) <= Date.now()) {
    if (token) revoke(token);
    remember(null);
    throw Error('로그인 응답을 확인할 수 없습니다.');
  }
  remember(value as WalletSession);
  return token;
}
