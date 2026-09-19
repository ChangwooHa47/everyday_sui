"use client";

// Original splash layout. Production signs in with a wallet; demo auth is baseline-only.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { backend, ensureAuth } from "@/lib/api";
import dynamic from 'next/dynamic';
const WalletLogin = dynamic(() => import('./WalletLogin'), { ssr: false });
const legacyBaseline = process.env.NEXT_PUBLIC_LEGACY_BASELINE === '1';

export default function Splash() {
  const router = useRouter();
  const [hasCharacter, setHasCharacter] = useState<boolean | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!legacyBaseline) return;
    (async () => {
      try {
        await ensureAuth();
        const list = await backend.listCharacters();
        setHasCharacter(list.length > 0);
      } catch {
        setError(true);
      }
    })();
  }, []);

  return (
    <div
      onClick={() => {
        if (!legacyBaseline) return;
        if (hasCharacter === null) return;
        router.push(hasCharacter ? "/home" : "/create");
      }}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        background:
          "linear-gradient(180deg, var(--orange-50) 0%, #fff 62%, var(--orange-500) 140%)",
        minHeight: "100dvh",
      }}
    >
      <div className="logo" style={{ fontSize: 44, color: "var(--gray-800)" }}>
        Dear Mine
      </div>
      <div className="body2" style={{ color: "var(--gray-500)", marginTop: 8 }}>
        나만의 캐릭터, 나만의 기억
      </div>
      <div
        className="caption fade-in"
        style={{ position: "absolute", bottom: 64, color: "var(--gray-500)" }}
      >
        {!legacyBaseline ? <WalletLogin onLogin={() => router.push('/home')} /> : error
          ? "불러오지 못했어요. 다시 시도해주세요."
          : hasCharacter === null
            ? "연결 중..."
            : hasCharacter
              ? "탭해서 이어하기"
              : "탭해서 시작하기"}
      </div>
    </div>
  );
}
