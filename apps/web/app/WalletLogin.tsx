'use client';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { ConnectModal } from '@mysten/dapp-kit-react/ui';
import { loginWithWallet } from '@/lib/wallet-auth';

export default function WalletLogin({ onLogin }: { onLogin: () => void }) {
  return <LoginButton onLogin={onLogin} />;
}
function LoginButton({ onLogin }: { onLogin: () => void }) {
  const account = useCurrentAccount();
  const modal = useRef<ComponentRef<typeof ConnectModal>>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requested = useRef(false);
  const style = { background: 'none', border: 0, padding: '12px 20px', color: 'var(--gray-500)', cursor: 'pointer' };
  async function login() {
    if (busy) return;
    setBusy(true); setError('');
    try { await loginWithWallet(); onLogin(); }
    catch { setError('로그인을 완료하지 못했어요. 다시 시도해주세요.'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (account && requested.current) { requested.current = false; void login(); }
    // Only a user click that opened the connection dialog starts authentication.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);
  return <>
    {account
      ? <button type="button" className="caption" style={style} disabled={busy} onClick={() => void login()}>{busy ? '로그인 중...' : '로그인'}</button>
      : <><button type="button" className="caption" style={style} onClick={() => { requested.current = true; if (modal.current) modal.current.open = true; }}>로그인</button><ConnectModal ref={modal} /></>}
    {error && <div role="alert" className="caption">{error}</div>}
  </>;
}
