"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

/** 온보딩 상단바: 이전 / 다음 */
export function WizardBar({
  onPrev,
  onNext,
  nextDisabled,
  showPrev = true,
}: {
  onPrev?: () => void;
  onNext?: () => void;
  nextDisabled?: boolean;
  showPrev?: boolean;
}) {
  return (
    <div className="topbar">
      {showPrev ? (
        <button className="nav-btn nav-prev" onClick={onPrev}>
          <Icon name="chevron-left" size={18} /> 이전
        </button>
      ) : (
        <span />
      )}
      {onNext ? (
        <button
          className="nav-btn nav-next"
          onClick={onNext}
          disabled={nextDisabled}
        >
          다음 <Icon name="chevron-right" size={18} />
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

/** 진행 표시 (4단계) */
export function Progress({ step, total = 4 }: { step: number; total?: number }) {
  return (
    <div className="progress">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i === step ? "active" : ""} />
      ))}
    </div>
  );
}

/** 칩 */
export function Chip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`chip ${selected ? "selected" : ""}`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

/** 캐릭터 아바타 — imageUrl 있으면 사진, 없으면 이모지 placeholder */
export function Avatar({
  emoji,
  src,
  size = 120,
  radius = 16,
}: {
  emoji: string;
  src?: string | null;
  size?: number | string;
  radius?: number;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        className="avatar"
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          objectFit: "cover",
          display: "block",
        }}
      />
    );
  }
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize:
          typeof size === "number" ? Math.max(28, size * 0.4) : "min(38vw, 140px)",
      }}
    >
      {emoji}
    </div>
  );
}

/** 바텀 내비게이션 (커뮤니티는 Phase 2 → 갤러리로 대체) */
// figma 수정본 네비바 — 플로팅 필 바. 활성 탭만 다크 필(아이콘+라벨), 나머지는 아이콘만.
export function BottomNav({
  active,
}: {
  active: "home" | "chat" | "gallery" | "community" | "my";
}) {
  const item = (
    href: string,
    icon: IconName,
    label: string,
    isActive: boolean,
  ) => (
    <Link
      href={href}
      aria-label={label}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        flex: isActive ? "0 0 auto" : 1,
        padding: isActive ? "11px 22px" : "11px 0",
        borderRadius: 999,
        background: isActive ? "var(--gray-900)" : "transparent",
        color: isActive ? "#fff" : "var(--gray-400)",
        fontSize: 13,
        fontWeight: 700,
        textDecoration: "none",
        whiteSpace: "nowrap",
        transition: "all 360ms cubic-bezier(0.32, 0.72, 0, 1)",
      }}
    >
      <Icon name={icon} size={22} />
      {isActive && label}
    </Link>
  );
  return (
    <>
      {/* 자리 확보 — fixed 네비바에 콘텐츠가 가리지 않도록 */}
      <div aria-hidden style={{ height: "calc(78px + env(safe-area-inset-bottom))", flexShrink: 0 }} />
      {/* 375 프레임 하단 중앙에 고정 — 스크롤해도 항상 화면 하단 */}
      <nav
        style={{
          position: "fixed",
          bottom: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: "100%",
          maxWidth: 375,
          padding: "0 16px calc(10px + env(safe-area-inset-bottom))",
          boxSizing: "border-box",
          zIndex: 50,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            padding: 5,
            display: "flex",
            alignItems: "center",
            borderRadius: 999,
            background: "rgba(255,255,255,0.96)",
            boxShadow: "0 6px 22px rgba(30, 24, 18, 0.14)",
            backdropFilter: "blur(8px)",
            pointerEvents: "auto",
          }}
        >
          {item("/home", "home", "홈", active === "home")}
          {item("/chatlist", "chat", "채팅", active === "chat")}
          {item("/community", "community", "커뮤", active === "community" || active === "gallery")}
          {item("/my", "person", "마이", active === "my")}
        </div>
      </nav>
    </>
  );
}

/** 화면 본문 패딩 래퍼 */
export function Body({ children }: { children: ReactNode }) {
  return <div style={{ padding: "0 20px", flex: 1 }}>{children}</div>;
}
