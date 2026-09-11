"use client";

// 마이페이지 — figma 42:3341.
// everyday 로고 + 포인트 배지 / 프로필 행(아바타·유저명·구독 칩) / 메뉴 리스트.
// 계정 데이터는 백엔드 /api/me. 미구현 메뉴는 인라인 토스트로 안내.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { backend, type MyPage as MyPageData } from "@/lib/api";
import { BottomNav } from "../components";
import { Icon } from "../icons";

type MenuRow = {
  label: string;
  href?: string;
  soon?: boolean;
};

const MENU: MenuRow[] = [
  { label: "내 갤러리", href: "/gallery" },
  { label: "정보 관리", soon: true },
  { label: "구독 관리", href: "/subscription" },
  { label: "포인트 사용 내역", soon: true },
  { label: "포인트 결제 내역", soon: true },
  { label: "설정", soon: true },
];

export default function MyPage() {
  const router = useRouter();
  const [me, setMe] = useState<MyPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setMe(await backend.getMe());
      } catch (e) {
        setError(e instanceof Error ? e.message : "백엔드 연결 실패");
      }
    })();
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  }

  function onRow(row: MenuRow) {
    if (row.href) router.push(row.href);
    else showToast("곧 만나요, 준비 중인 기능이에요");
  }

  if (error) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100dvh", padding: 24 }}>
        <div className="body2" style={{ color: "var(--gray-500)", textAlign: "center" }}>{error}</div>
      </div>
    );
  }
  if (!me) return null;

  const userName = me.email.split("@")[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <header className="topbar">
        <span className="logo" style={{ fontSize: 22, color: "var(--gray-800)" }}>
          everyday
        </span>
        <span className="point-badge">
          <span className="p">P</span> {me.points.toLocaleString()}
        </span>
      </header>

      {/* 프로필 행 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "10px 20px 22px",
        }}
      >
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: "50%",
            background: "var(--gray-200)",
            flexShrink: 0,
          }}
        />
        <span className="h3" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {userName}
        </span>
        <button
          onClick={() => router.push("/subscription")}
          className="chip"
          style={{
            flexShrink: 0,
            background: "var(--gray-50)",
            borderColor: "var(--gray-200)",
            color: "var(--gray-600)",
            fontWeight: 700,
          }}
        >
          {me.subscriptionTier}
        </button>
      </div>

      {/* 메뉴 리스트 */}
      <div style={{ padding: "0 20px" }}>
        {MENU.map((row) => (
          <button
            key={row.label}
            onClick={() => onRow(row)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              padding: "18px 0",
              background: "transparent",
              border: "none",
              borderBottom: "1px solid var(--gray-100)",
              font: "inherit",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span className="body1" style={{ color: "var(--gray-800)" }}>
              {row.label}
            </span>
            <Icon name="chevron-right" size={20} style={{ color: "var(--gray-400)" }} />
          </button>
        ))}
      </div>

      <div style={{ flex: 1 }} />
      <BottomNav active="my" />

      {/* 인라인 토스트 */}
      {toast && (
        <div
          className="fade-in"
          style={{
            position: "fixed",
            left: "50%",
            transform: "translateX(-50%)",
            bottom: 88,
            padding: "10px 18px",
            borderRadius: 999,
            background: "rgba(30,30,30,0.86)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            whiteSpace: "nowrap",
            zIndex: 60,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
