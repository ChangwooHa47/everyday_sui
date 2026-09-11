"use client";

// splash — Spring 백엔드 연동판. 데모 계정 자동 로그인 후 캐릭터 유무로 분기.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { backend, ensureAuth } from "@/lib/api";

export default function Splash() {
  const router = useRouter();
  const [hasCharacter, setHasCharacter] = useState<boolean | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
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
        everyday
      </div>
      <div className="body2" style={{ color: "var(--gray-500)", marginTop: 8 }}>
        with your character
      </div>
      <div
        className="caption fade-in"
        style={{ position: "absolute", bottom: 64, color: "var(--gray-500)" }}
      >
        {error
          ? "백엔드(localhost:8080)에 연결할 수 없어요"
          : hasCharacter === null
            ? "연결 중..."
            : hasCharacter
              ? "탭해서 이어하기"
              : "탭해서 시작하기"}
      </div>
    </div>
  );
}
