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
    (async () => {
      try {
        await ensureAuth();
        const list = await backend.listCharacters();
        if (!legacyBaseline) {
          router.replace(list.length > 0 ? "/home" : "/create");
          return;
        }
        setHasCharacter(list.length > 0);
      } catch {
        if (legacyBaseline) setError(true);
      }
    })();
  }, [router]);

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
        background: "var(--key)",
        minHeight: "100dvh",
      }}
    >
      <div className="logo" style={{ fontSize: 72, color: "#fff", lineHeight: 1 }}>
        dear.
      </div>
      <div className="body2" style={{ color: "rgba(255,255,255,0.72)", marginTop: 10 }}>
        나만의 캐릭터, 나만의 기억
      </div>
      <div
        className="caption fade-in landing-login"
        style={{ position: "absolute", bottom: 64, color: "rgba(255,255,255,0.85)" }}
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
