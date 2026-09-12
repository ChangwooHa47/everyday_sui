"use client";

// FS-05 포토부스 — Spring 백엔드 연동판 (figma 사진 찍기 42:2973 / 생성 상세 42:2729).
// 컨셉 카탈로그(GET /api/photo/concepts) + 생성(POST /api/characters/{id}/photos, 포인트 차감).

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  backend,
  ApiError,
  getActiveCharacterId,
  setActiveCharacterId,
  type CharacterSummary,
  type PhotoConcept,
} from "@/lib/api";
import { Avatar } from "../components";
import { Icon } from "../icons";

// figma 42:2729 정산 행 기준 사진 1장 사용 포인트.
const PHOTO_COST = 1200;

// 백엔드 컨셉 라벨 → 섹션 그룹. 일상 키워드에 걸리면 일상, 나머지는 전부 이벤트.
const DAILY_KEYWORDS = ["인생네컷", "셀카", "거울", "일상"];
function groupOf(label: string): "일상" | "이벤트" {
  return DAILY_KEYWORDS.some((k) => label.includes(k)) ? "일상" : "이벤트";
}
function emojiOf(label: string): string {
  if (label.includes("인생네컷")) return "🎞️";
  if (label.includes("셀카")) return "🤳";
  if (label.includes("거울")) return "🪞";
  if (label.includes("웨딩")) return "💒";
  if (label.includes("놀이공원")) return "🎡";
  if (label.includes("상견례")) return "🍵";
  if (label.includes("카페")) return "☕";
  if (label.includes("산책") || label.includes("밤")) return "🌙";
  if (label.includes("데이트")) return "💕";
  return "📸";
}

export default function PhotoboothPage() {
  const router = useRouter();
  const [char, setChar] = useState<CharacterSummary | null>(null);
  const [concepts, setConcepts] = useState<PhotoConcept[]>([]);
  const [concept, setConcept] = useState<PhotoConcept | null>(null); // null = 카탈로그, 값 = 생성 상세
  const [desc, setDesc] = useState("");
  const [points, setPoints] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    (async () => {
      try {
        const list = await backend.listCharacters();
        if (list.length === 0) {
          router.replace("/create");
          return;
        }
        const activeId = getActiveCharacterId();
        const active = list.find((c) => c.id === activeId) ?? list[0];
        setActiveCharacterId(active.id);
        setChar(active);
        const [conceptList, me] = await Promise.all([
          backend.listPhotoConcepts(),
          backend.getMe(),
        ]);
        setConcepts(conceptList);
        setPoints(me.points);
        const pending = sessionStorage.getItem(`everyday.photo-job.${active.id}`);
        if (pending) {
          const saved = JSON.parse(pending) as { requestId: string; concept: string; customPrompt?: string };
          const selected = conceptList.find(c => c.code === saved.concept);
          if (selected) setConcept(selected);
          setDesc(saved.customPrompt ?? '');
          setBusy(true);
          try {
            await backend.startPhotoJob(active.id, saved.requestId, { concept: saved.concept, customPrompt: saved.customPrompt });
            await waitForPhoto(active.id, saved.requestId);
          } catch (e) {
            if (e instanceof ApiError && [400, 402, 403, 404].includes(e.status)) sessionStorage.removeItem(`everyday.photo-job.${active.id}`);
            throw e;
          } finally { if (mounted.current) setBusy(false); }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "불러오지 못했어요. 다시 시도해주세요.");
      }
    })();
  }, [router]);

  async function waitForPhoto(characterId: number, requestId: string) {
    for (let i = 0; i < 300 && mounted.current; i++) {
      const job = await backend.photoJob(requestId);
      setPoints(job.remainingPoints);
      if (job.status === 'completed' && job.photo) {
        sessionStorage.removeItem(`everyday.photo-job.${characterId}`);
        setResult(job.photo.imageUrl); return;
      }
      if (job.status === 'failed') {
        sessionStorage.removeItem(`everyday.photo-job.${characterId}`);
        throw new Error('사진을 만들지 못했어요. 사용한 포인트는 돌려드렸어요.');
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    if (mounted.current) throw new Error('사진을 만들고 있어요. 잠시 후 다시 확인해주세요.');
  }

  function openConcept(c: PhotoConcept) {
    setConcept(c);
    setDesc("");
    setResult(null);
    setError(null);
  }

  async function generate() {
    if (busy || !char || !concept) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      if (process.env.NEXT_PUBLIC_LEGACY_BASELINE === '1') {
        const gen = await backend.generatePhoto(char.id, { concept: concept.code, customPrompt: desc.trim() || undefined });
        setResult(gen.photo.imageUrl); setPoints(gen.remainingPoints);
      } else {
        const key = `everyday.photo-job.${char.id}`;
        const saved = sessionStorage.getItem(key);
        const job = saved ? JSON.parse(saved) : { requestId: crypto.randomUUID(), concept: concept.code, customPrompt: desc.trim() || undefined };
        if (job.concept !== concept.code || (job.customPrompt ?? '') !== desc.trim()) throw Error('이전 사진의 생성 결과를 먼저 확인해주세요.');
        sessionStorage.setItem(key, JSON.stringify(job));
        await backend.startPhotoJob(char.id, job.requestId, { concept: job.concept, customPrompt: job.customPrompt });
        await waitForPhoto(char.id, job.requestId);
      }
    } catch (e) {
      if (e instanceof ApiError && [400, 402, 403, 404].includes(e.status)) sessionStorage.removeItem(`everyday.photo-job.${char.id}`);
      setError(e instanceof Error ? e.message : "생성 실패");
    } finally {
      setBusy(false);
    }
  }

  if (!char) return error ? <p className="caption" role="alert">{error}</p> : null;

  const pointBadge = (
    <span className="point-badge">
      <span className="p">P</span> {points === null ? "…" : points.toLocaleString()}
    </span>
  );

  // ── 생성 상세 (42:2729) ──
  if (concept) {
    // 결과 전이면 예상 잔여, 결과가 나오면 백엔드가 준 실제 잔여(points)를 그대로.
    const remaining =
      points === null ? null : result || busy ? points : Math.max(0, points - PHOTO_COST);
    return (
      <div
        className="fade-in"
        style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}
      >
        <header className="topbar">
          <button
            className="nav-btn nav-prev"
            disabled={busy}
            onClick={() => {
              setConcept(null);
              setResult(null);
              setError(null);
            }}
          >
            <Icon name="chevron-left" size={24} />
          </button>
          <span className="headline1">{concept.label}</span>
          {pointBadge}
        </header>

        {/* 예시 이미지 / 결과 영역 */}
        <div style={{ padding: "4px 20px" }}>
          <div
            style={{
              borderRadius: 16,
              background: "var(--gray-50)",
              minHeight: 360,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              overflow: "hidden",
            }}
          >
            {result ? (
              <div style={{ position: "relative", width: "100%" }} className="fade-in">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={result} alt="" style={{ width: "100%", display: "block" }} />
                <span
                  style={{
                    position: "absolute",
                    left: 10,
                    top: 10,
                    padding: "4px 10px",
                    borderRadius: 999,
                    background: "rgba(30,30,30,0.6)",
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  <Icon name="check" size={13} style={{ verticalAlign: "-2px", marginRight: 3 }} />
                  갤러리에 저장됨
                </span>
              </div>
            ) : busy ? (
              <div style={{ width: "100%", position: "relative" }}>
                <div
                  className="skeleton"
                  style={{ width: "100%", aspectRatio: "3/4", borderRadius: 16 }}
                />
                <span
                  className="body2"
                  style={{
                    position: "absolute",
                    bottom: 16,
                    left: 0,
                    right: 0,
                    textAlign: "center",
                    color: "var(--gray-600)",
                  }}
                >
                  <Icon name="camera" size={15} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                  {char.name} 촬영 중... (2~7분 걸릴 수 있어요)
                </span>
              </div>
            ) : (
              <>
                <Icon name="generate" size={34} style={{ color: "var(--orange-700)" }} />
                <span className="body2" style={{ color: "var(--gray-500)" }}>
                  예시이미지
                </span>
                {error && (
                  <span
                    className="caption"
                    style={{ color: "#d64545", padding: "0 20px", textAlign: "center" }}
                  >
                    {error.slice(0, 160)}
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {/* 설명 추가 */}
        <div style={{ padding: "20px 20px 0" }}>
          <div className="label1" style={{ marginBottom: 10 }}>
            설명 추가
          </div>
          <input
            className="input"
            disabled={busy}
            placeholder="예: 나랑 사귀면 완전 야르~"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
        </div>

        <div style={{ flex: 1 }} />

        {/* 포인트 정산 */}
        <div
          style={{
            borderTop: "1px dashed var(--gray-300)",
            padding: "16px 20px calc(20px + env(safe-area-inset-bottom))",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span className="body2" style={{ color: "var(--gray-500)" }}>
              사용 포인트
            </span>
            <span className="body2" style={{ color: "var(--orange-700)", fontWeight: 700 }}>
              {PHOTO_COST.toLocaleString()} 사용
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
            <span className="body2" style={{ color: "var(--gray-500)" }}>
              남은 포인트
            </span>
            <span className="body2" style={{ fontWeight: 700 }}>
              {remaining === null ? "…" : remaining.toLocaleString()}
            </span>
          </div>
          <button className="cta" onClick={generate} disabled={busy}>
            {busy ? "생성 중..." : result ? "다시 생성" : "생성"}
          </button>
        </div>
      </div>
    );
  }

  // ── 컨셉 카탈로그 (42:2973) ──
  const daily = concepts.filter((c) => groupOf(c.label) === "일상");
  const events = concepts.filter((c) => groupOf(c.label) === "이벤트");

  const section = (title: string, items: PhotoConcept[]) =>
    items.length === 0 ? null : (
      <div style={{ marginTop: 22 }}>
        <div className="headline1" style={{ padding: "0 20px", marginBottom: 12 }}>
          {title}
        </div>
        <div
          style={{
            display: "flex",
            gap: 12,
            overflowX: "auto",
            padding: "0 20px 4px",
            scrollbarWidth: "none",
          }}
        >
          {items.map((c) => (
            <button
              key={c.code}
              onClick={() => openConcept(c)}
              style={{
                flex: "0 0 auto",
                width: 120,
                padding: 0,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 200ms var(--ease)",
              }}
            >
              <div
                style={{
                  width: 120,
                  height: 150,
                  borderRadius: 14,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 52,
                  background:
                    "linear-gradient(160deg, var(--orange-100), var(--orange-400))",
                  border: "1px solid var(--gray-100)",
                }}
              >
                {emojiOf(c.label)}
              </div>
              <div
                className="body2"
                style={{
                  marginTop: 8,
                  textAlign: "left",
                  fontWeight: 600,
                  color: "var(--black)",
                }}
              >
                {c.label}
              </div>
            </button>
          ))}
        </div>
      </div>
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <header className="topbar">
        <button className="nav-btn nav-prev" onClick={() => router.push("/home")}>
          <Icon name="chevron-left" size={24} />
        </button>
        <span className="headline1">사진 찍기</span>
        {pointBadge}
      </header>

      {/* 현재 캐릭터 */}
      <div
        style={{
          padding: "6px 20px 4px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span className="body2" style={{ color: "var(--gray-400)" }}>
          현재 캐릭터
        </span>
        <span className="label1" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Avatar emoji="🙂" src={char.profileImageUrl ?? undefined} size={26} radius={13} />
          {char.name}
        </span>
      </div>

      {error && (
        <div
          className="caption"
          style={{ color: "#d64545", padding: "8px 20px", textAlign: "center" }}
        >
          {error.slice(0, 160)}
        </div>
      )}

      {section("일상", daily)}
      {section("이벤트", events)}

      <div style={{ height: 24 }} />
    </div>
  );
}
