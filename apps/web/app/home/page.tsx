"use client";

// home — figma UI(191:8569): 캐릭터 카드 가로 캐러셀. 오른쪽에 다음 카드가 살짝 보이고(peek),
// 옆으로 스와이프하면 활성 캐릭터가 바뀐다. 카드 하단 오버레이 = 이름·→·상태 2줄.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  backend,
  getActiveCharacterId,
  setActiveCharacterId,
  type CharacterSummary,
} from "@/lib/api";
import { BottomNav } from "../components";
import { Icon } from "../icons";

export default function Home() {
  const router = useRouter();
  const [chars, setChars] = useState<CharacterSummary[] | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [dayCounts, setDayCounts] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 대화 일수 — 캐릭터별 최초 메시지 기준. 활성 카드에 대해서만 지연 로드.
  const loadDayCount = useCallback(async (id: number) => {
    setDayCounts((prev) => (id in prev ? prev : prev));
    try {
      const msgs = await backend.getMessages(id);
      const times = msgs
        .map((m) => new Date(m.createdAt).getTime())
        .filter((t) => Number.isFinite(t));
      const days = times.length
        ? Math.max(1, Math.floor((Date.now() - Math.min(...times)) / 86_400_000) + 1)
        : 1;
      setDayCounts((prev) => ({ ...prev, [id]: days }));
    } catch {
      setDayCounts((prev) => ({ ...prev, [id]: 1 }));
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const list = await backend.listCharacters();
        if (list.length === 0) {
          router.replace("/create");
          return;
        }
        const savedId = getActiveCharacterId();
        const idx = Math.max(0, list.findIndex((c) => c.id === savedId));
        setChars(list);
        setActiveIdx(idx);
        setActiveCharacterId(list[idx].id);
        void loadDayCount(list[idx].id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "백엔드 연결 실패");
      }
    })();
  }, [router, loadDayCount]);

  // 저장된 활성 카드로 초기 스크롤 (애니메이션 없이)
  useEffect(() => {
    if (!chars || !scrollRef.current || activeIdx === 0) return;
    const el = scrollRef.current;
    const cards = el.querySelectorAll<HTMLElement>("[data-card]");
    const target = cards[activeIdx];
    if (target) el.scrollLeft = target.offsetLeft - el.offsetLeft;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chars]);

  function onScroll() {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const el = scrollRef.current;
      if (!el || !chars) return;
      const cards = el.querySelectorAll<HTMLElement>("[data-card]");
      if (cards.length < 1) return;
      // 화면에 가장 왼쪽으로 정렬된 카드 = 스크롤 위치에 가장 가까운 카드
      let best = 0;
      let min = Infinity;
      cards.forEach((c, i) => {
        const d = Math.abs(c.offsetLeft - el.offsetLeft - el.scrollLeft);
        if (d < min) { min = d; best = i; }
      });
      if (best !== activeIdx) {
        setActiveIdx(best);
        setActiveCharacterId(chars[best].id);
        void loadDayCount(chars[best].id);
      }
    }, 120);
  }

  if (error) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100dvh", padding: 24 }}>
        <div className="body2" style={{ color: "var(--gray-500)", textAlign: "center" }}>
          {error}
          <br />
          백엔드 연결을 확인해주세요.
        </div>
      </div>
    );
  }
  if (!chars) return null;

  const divider = (
    <span style={{ opacity: 0.45, margin: "0 8px", fontWeight: 400 }}>|</span>
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        background:
          "linear-gradient(180deg, var(--orange-50) 0%, #fffdf7 42%, var(--orange-100) 100%)",
      }}
    >
      <style>{`.hcar::-webkit-scrollbar{display:none}`}</style>

      <header className="topbar">
        <span className="logo" style={{ fontSize: 22, color: "var(--gray-800)" }}>
          everyday
        </span>
        <Icon name="bell" size={22} style={{ color: "var(--gray-700)" }} />
      </header>

      {/* 캐릭터 카드 캐러셀 — 가로 스냅 스크롤, 오른쪽 peek */}
      <div
        ref={scrollRef}
        className="hcar"
        onScroll={onScroll}
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          gap: 12,
          padding: "4px 20px 0",
          overflowX: "auto",
          overflowY: "hidden",
          scrollSnapType: "x mandatory",
          scrollPaddingLeft: 20,
          scrollbarWidth: "none",
          msOverflowStyle: "none",
        }}
      >
        {chars.map((char) => (
          <div
            key={char.id}
            data-card
            style={{
              position: "relative",
              flex: "0 0 calc(min(375px, 100vw) - 72px)",
              scrollSnapAlign: "start",
              borderRadius: 20,
              overflow: "hidden",
              background: "linear-gradient(160deg, var(--orange-100), var(--orange-400))",
            }}
          >
            {char.profileImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={char.profileImageUrl}
                alt=""
                draggable={false}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: "min(30vw, 120px)" }}>
                🙂
              </div>
            )}

            {/* 하단 오버레이 */}
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                padding: "56px 20px 20px",
                background:
                  "linear-gradient(transparent, rgba(20,18,16,0.35) 40%, rgba(20,18,16,0.82))",
                color: "#fff",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                <span className="h1" style={{ color: "#fff" }}>{char.name}</span>
                <Link
                  href="/character"
                  aria-label={`${char.name} 캐릭터 페이지`}
                  onClick={() => setActiveCharacterId(char.id)}
                  style={{
                    width: 44,
                    height: 44,
                    flexShrink: 0,
                    borderRadius: "50%",
                    background: "#fff",
                    color: "var(--gray-900)",
                    display: "grid",
                    placeItems: "center",
                    textDecoration: "none",
                  }}
                >
                  <Icon name="arrow-right" size={22} />
                </Link>
              </div>

              <div style={{ fontSize: 13, fontWeight: 500, lineHeight: "22px" }}>
                <div>
                  <span style={{ fontWeight: 700 }}>{char.relationshipType}</span>
                  {divider}
                  <span style={{ opacity: 0.9 }}>{dayCounts[char.id] ?? 1}일째 대화</span>
                </div>
                <div>
                  <span style={{ fontWeight: 700 }}>에피소드</span>
                  {divider}
                  <span style={{ opacity: 0.9 }}>진행 전</span>
                </div>
              </div>
            </div>
          </div>
        ))}

        {/* 캐러셀 끝 — 새 캐릭터 추가 카드 (figma 278:2213, 점선 보더) */}
        <button
          onClick={() => router.push("/create")}
          aria-label="새 캐릭터 추가하기"
          style={{
            flex: "0 0 calc(min(375px, 100vw) - 72px)",
            scrollSnapAlign: "start",
            borderRadius: 20,
            border: "1.5px dashed var(--gray-800)",
            background: "transparent",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 20,
            color: "var(--gray-800)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          <Icon name="plus" size={44} />
          <span style={{ fontSize: 17, fontWeight: 600 }}>새 캐릭터 추가하기</span>
        </button>
      </div>

      {/* 페이지 인디케이터 (캐릭터 여러 명일 때) */}
      {chars.length > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 6, padding: "12px 0 2px" }}>
          {chars.map((c, i) => (
            <span
              key={c.id}
              style={{
                width: i === activeIdx ? 18 : 6,
                height: 6,
                borderRadius: 999,
                background: i === activeIdx ? "var(--orange-500)" : "var(--gray-300)",
                transition: "all 300ms var(--ease)",
              }}
            />
          ))}
        </div>
      )}

      {/* 액션 3버튼 — 활성 캐릭터 기준 */}
      <div className="home-actions">
        <Link href="/chat" className="home-action">
          <span className="ico-badge"><Icon name="chat" size={20} /></span>대화하기
        </Link>
        <Link href="/episode" className="home-action">
          <span className="ico-badge"><Icon name="heart" size={20} /></span>에피소드
        </Link>
        <Link href="/photobooth" className="home-action">
          <span className="ico-badge"><Icon name="camera" size={20} /></span>포토부스
        </Link>
      </div>

      <BottomNav active="home" />
    </div>
  );
}
