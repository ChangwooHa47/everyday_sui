import type { ReactNode } from "react";
import "./globals.css";
import Web3Entry from './Web3Entry';

export const metadata = {
  title: "everyday — with your character",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      {/* suppressHydrationWarning: Demoway 등 브라우저 확장이 body에 data-* 속성을
          주입해 서버/클라 마크업이 어긋나는 걸 무시 (우리 코드 문제 아님) */}
      <body suppressHydrationWarning>
        <div className="phone">{process.env.NEXT_PUBLIC_LEGACY_BASELINE === '1' ? children : <Web3Entry />}</div>
      </body>
    </html>
  );
}
