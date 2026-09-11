'use client';
import { useRef, useState, type ComponentRef } from 'react';
import { DAppKitProvider, useCurrentAccount } from '@mysten/dapp-kit-react';
import { ConnectModal } from '@mysten/dapp-kit-react/ui';
import { walletKit, loginWithWallet } from '@/lib/wallet-auth';

export default function WalletLogin({ onLogin }: { onLogin: () => void }) {
  return <DAppKitProvider dAppKit={walletKit}><LoginButton onLogin={onLogin} /></DAppKitProvider>;
}
function LoginButton({ onLogin }: { onLogin: () => void }) {
  const account = useCurrentAccount();
  const modal = useRef<ComponentRef<typeof ConnectModal>>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const style = { background: 'none', border: 0, padding: '12px 20px', color: 'var(--gray-500)', cursor: 'pointer' };
  async function login() {
    if (busy) return;
    setBusy(true); setError('');
    try { await loginWithWallet(); onLogin(); }
    catch { setError('로그인을 완료하지 못했어요. 다시 시도해주세요.'); }
    finally { setBusy(false); }
  }
  return <>
    {account
      ? <button type="button" className="caption" style={style} disabled={busy} onClick={() => void login()}>{busy ? '로그인 중...' : '로그인'}</button>
      : <><button type="button" className="caption" style={style} onClick={() => { if (modal.current) modal.current.open = true; }}>로그인</button><ConnectModal ref={modal} /></>}
    {error && <div role="alert" className="caption">{error}</div>}
  </>;
}
