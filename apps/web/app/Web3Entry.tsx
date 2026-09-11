'use client';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
const Market = dynamic(() => import('./MarketApp'), { ssr: false });
const WalletApp = dynamic(() => import('./Web3App'), { ssr: false, loading: () => <p style={{ padding: 32 }}>지갑 연결 준비 중…</p> });
export default function Web3Entry() {
  const path = usePathname();
  return path === '/market' || path === '/viewer' ? <Market viewer={path === '/viewer'} /> : <WalletApp />;
}
