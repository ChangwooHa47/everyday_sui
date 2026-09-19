'use client';

import { DAppKitProvider } from '@mysten/dapp-kit-react';
import type { ReactNode } from 'react';
import { walletKit } from '@/lib/wallet-auth';

export default function WalletProvider({ children }: { children: ReactNode }) {
  return <DAppKitProvider dAppKit={walletKit}>{children}</DAppKitProvider>;
}
