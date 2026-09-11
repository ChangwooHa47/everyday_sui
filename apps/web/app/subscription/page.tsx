"use client";

// 구독 요금제 — figma 42:3413.
// everyday 로고 + 포인트 배지 / 세로 요금제 카드 4개. 현재 플랜만 오렌지 활성 + 체크.
// 구독 기능은 백엔드 미구현 → 표시용 (현재 등급은 /api/me 로 반영).

import { useEffect, useState } from "react";
import { backend } from "@/lib/api";
import { BottomNav } from "../components";
import { Icon } from "../icons";

type Plan = {
  key: string;
  name: string;
  price: string;
  benefits: string[];
};

const PLANS: Plan[] = [
  {
    key: "free",
    name: "Free",
    price: "무료",
    benefits: [
      "하루 메시지 30개",
      "캐릭터 1명",
      "기본 대화 모델",
      "사진 생성 없음",
      "에피소드 주 1회",
      "표준 화질 사진",
    ],
  },
  {
    key: "day",
    name: "Day",
    price: "일 2,800원",
    benefits: [
      "하루 메시지 무제한",
      "캐릭터 3명",
      "기본 대화 모델",
      "사진 생성 100P 지급",
      "에피소드 무제한",
      "표준 화질 사진",
    ],
  },
  {
    key: "plus",
    name: "Plus",
    price: "월 9,900원",
    benefits: [
      "하루 메시지 무제한",
      "캐릭터 5명",
      "프리미엄 대화 모델",
      "매달 사진 500P",
      "에피소드 무제한",
      "고화질 사진",
    ],
  },
  {
    key: "pro",
    name: "Pro",
    price: "월 19,900원",
    benefits: [
      "하루 메시지 무제한",
      "캐릭터 무제한",
      "최신 대화 모델",
      "매달 사진 1,500P",
      "에피소드·우선 생성",
      "4K 화질 사진",
    ],
  },
];

export default function SubscriptionPage() {
  const [points, setPoints] = useState<number | null>(null);
  const [tier, setTier] = useState<string>("Free");

  useEffect(() => {
    (async () => {
      try {
        const me = await backend.getMe();
        setPoints(me.points);
        setTier(me.subscriptionTier);
      } catch {
        // 백엔드 미연결이어도 카드는 표시
      }
    })();
  }, []);

  const currentKey = tier.toLowerCase();

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <header className="topbar">
        <span className="logo" style={{ fontSize: 22, color: "var(--gray-800)" }}>
          everyday
        </span>
        <span className="point-badge">
          <span className="p">P</span> {(points ?? 0).toLocaleString()}
        </span>
      </header>

      <div style={{ padding: "6px 20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
        {PLANS.map((plan) => {
          const active = plan.key === currentKey;
          return (
            <div key={plan.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  flex: 1,
                  borderRadius: 16,
                  padding: "18px 18px 16px",
                  border: `1px solid ${active ? "var(--orange-700)" : "var(--gray-200)"}`,
                  background: active ? "var(--orange-50)" : "#fff",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    marginBottom: 14,
                  }}
                >
                  <span
                    className="logo"
                    style={{
                      fontSize: 24,
                      color: active ? "var(--orange-700)" : "var(--gray-700)",
                    }}
                  >
                    {plan.name}
                  </span>
                  <span className="headline1" style={{ color: "var(--black)" }}>
                    {plan.price}
                  </span>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    columnGap: 14,
                    rowGap: 8,
                  }}
                >
                  {plan.benefits.map((b) => (
                    <div
                      key={b}
                      className="body2"
                      style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--gray-600)" }}
                    >
                      <span
                        style={{
                          width: 4,
                          height: 4,
                          borderRadius: "50%",
                          background: active ? "var(--orange-600)" : "var(--gray-400)",
                          flexShrink: 0,
                        }}
                      />
                      {b}
                    </div>
                  ))}
                </div>
              </div>
              <Icon
                name="check"
                size={22}
                style={{ flexShrink: 0, color: active ? "var(--orange-700)" : "var(--gray-300)" }}
              />
            </div>
          );
        })}
      </div>

      <div style={{ flex: 1 }} />
      <BottomNav active="my" />
    </div>
  );
}
