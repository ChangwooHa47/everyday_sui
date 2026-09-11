import type { ReactNode } from "react";
import "./globals.css";

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
        <div className="phone">{children}</div>
      </body>
    </html>
  );
}
