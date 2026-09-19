'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { logoutWallet } from '@/lib/wallet-auth';
import { BottomNav } from '../components';

export default function SettingsPage() {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function logout() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      await logoutWallet();
      window.location.replace('/');
    } catch {
      setError('로그아웃을 완료하지 못했어요. 연결 상태를 확인하고 다시 시도해주세요.');
      inFlight.current = false; setBusy(false);
    }
  }
  return <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
    <header className="topbar"><Link href="/my" className="nav-btn nav-prev">이전</Link><h1 className="headline1" style={{ margin: 0 }}>설정</h1><span /></header>
    <main style={{ flex: 1, padding: 20 }}>
      <p className="body2" style={{ color: 'var(--gray-600)' }}>로그아웃하면 이 서비스의 로그인 세션과 지갑 연결이 해제됩니다. NFT와 대화 기록은 삭제되지 않습니다.</p>
      <button type="button" className="cta" disabled={busy} onClick={() => void logout()}>{busy ? '로그아웃 중…' : '로그아웃'}</button>
      {error && <p role="alert" className="body2">{error}</p>}
    </main>
    <BottomNav active="my" />
  </div>;
}
