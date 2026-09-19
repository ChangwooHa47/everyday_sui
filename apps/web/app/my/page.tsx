"use client";

// 마이페이지 — figma 42:3341.
// everyday 로고 + 지갑 SUI 잔액 / 프로필 행 / 메뉴 리스트.
// 계정 데이터는 백엔드 /api/me. 연결되지 않은 기존 메뉴는 비활성화한다.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { backend, type MyPage as MyPageData } from "@/lib/api";
import { BottomNav } from "../components";
import { Icon } from "../icons";

type MenuRow = {
  label: string;
  href?: string;
};

const MENU: MenuRow[] = [
  { label: "내 갤러리", href: "/gallery" },
  { label: "내 NFT 선물", href: "/my/gifts" },
  { label: "정보 관리" },
  { label: "구독 관리", ...(process.env.NEXT_PUBLIC_LEGACY_BASELINE === '1' ? { href: '/subscription' } : {}) },
  { label: "설정" },
];

export default function MyPage() {
  const router = useRouter();
  const [me, setMe] = useState<MyPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suiBalance, setSuiBalance] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setMe(await backend.getMe());
        const { walletKit } = await import("@/lib/wallet-auth");
        const account = walletKit.stores.$connection.get().account;
        if (account) {
          const { balance } = await walletKit.getClient("testnet").getBalance({ owner: account.address });
          setSuiBalance((Number(balance.balance) / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 4 }));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "불러오지 못했어요. 다시 시도해주세요.");
      }
    })();
  }, []);

  function onRow(row: MenuRow) {
    if (row.href) router.push(row.href);
  }

  if (error) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100dvh", padding: 24 }}>
        <div className="body2" style={{ color: "var(--gray-500)", textAlign: "center" }}>{error}</div>
      </div>
    );
  }
  if (!me) return null;

  const userName = me.email.split("@")[0] || "사용자";

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <header className="topbar">
        <span className="logo" style={{ fontSize: 22, color: "var(--gray-800)" }}>
          Dear Mine
        </span>
        <span className="point-badge">{suiBalance === null ? "…" : suiBalance} SUI</span>
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
          disabled={process.env.NEXT_PUBLIC_LEGACY_BASELINE !== '1'}
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
            disabled={!row.href}
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
              cursor: row.href ? "pointer" : "default",
              textAlign: "left",
            }}
          >
            <span className="body1" style={{ color: row.href ? "var(--gray-800)" : "var(--gray-400)" }}>
              {row.label}
            </span>
            <Icon name="chevron-right" size={20} style={{ color: "var(--gray-400)" }} />
          </button>
        ))}
      </div>

      <div style={{ flex: 1 }} />
      <BottomNav active="my" />

    </div>
  );
}
