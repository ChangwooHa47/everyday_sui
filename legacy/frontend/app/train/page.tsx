"use client";

// 인물 학습 페이지 — 초상 후보들을 보여주고 살릴 사진 고르기 → Soul 학습 → 진짜 얼굴 일관성.
// 흐름: 후보 그리드(살림/뺌 토글) → 부족하면 더 뽑기 → 학습 → 폴링 → 완료.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { store, type StoredCharacter } from "@/lib/store";
import { Avatar } from "../components";

export default function TrainPage() {
  const router = useRouter();
  const [char, setChar] = useState<StoredCharacter | null>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [genBusy, setGenBusy] = useState(false);
  const [angleBusy, setAngleBusy] = useState(false);
  const [phase, setPhase] = useState<"pick" | "training" | "done" | "failed">("pick");
  const [msg, setMsg] = useState("");
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    const c = store.getActive();
    if (!c) {
      router.replace("/create");
      return;
    }
    setChar(c);
    // 후보 = 저장된 초상 후보 + 프로필 사진
    const opts = [
      ...(c.portraitOptions ?? []),
      ...(c.imageUrl ? [c.imageUrl] : []),
    ].filter((v, i, a) => a.indexOf(v) === i);
    setCandidates(opts);
    setPicked(new Set(opts)); // 기본 전부 선택
    if (c.trainStatus === "completed" && c.customReferenceId) {
      setPhase("done");
    } else if (c.trainStatus === "in_progress" && c.trainJobId) {
      // 백그라운드로 두고 나갔다 재진입 → 학습중 화면 + 폴링 재개
      setPhase("training");
      setMsg("학습 상태 확인 중...");
      pollTrain(c.id, c.trainJobId, c.trainStartedAt ?? Date.now());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  if (!char) return null;

  function toggle(url: string) {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(url)) n.delete(url);
      else n.add(url);
      return n;
    });
  }

  // 나노바나나로 4각도 자동 생성 — 대표 사진 1장 → 같은 얼굴 정면/측면/클로즈업/원거리
  async function genAngles() {
    if (!char) return;
    const ref = char.imageUrl ?? candidates[0];
    if (!ref) {
      setMsg("기준이 될 사진이 없어요");
      return;
    }
    setAngleBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/nano-angles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: ref }),
      }).then((res) => res.json());
      const more: string[] = r.urls ?? [];
      if (more.length) {
        const next = [...candidates, ...more].filter((v, i, a) => a.indexOf(v) === i);
        setCandidates(next);
        setPicked((prev) => new Set([...prev, ...more]));
        store.updateCharacter(char.id, { portraitOptions: next });
      } else {
        setMsg(r.error ?? "각도 생성 실패");
      }
    } catch (e) {
      setMsg(String(e));
    } finally {
      setAngleBusy(false);
    }
  }

  // 후보 더 뽑기 (같은 외모 프롬프트, 새 시드)
  async function genMore() {
    if (!char) return;
    setGenBusy(true);
    try {
      const r = await fetch("/api/photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "portrait",
          appearancePrompt: char.appearancePrompt ?? char.appearance,
          count: 4,
          seed: Math.floor(Math.random() * 1_000_000),
        }),
      }).then((res) => res.json());
      const more: string[] = r.urls ?? [];
      if (more.length) {
        const next = [...candidates, ...more];
        setCandidates(next);
        setPicked((prev) => new Set([...prev, ...more]));
        store.updateCharacter(char.id, { portraitOptions: next });
      }
    } catch {
      /* 실패 무시 */
    } finally {
      setGenBusy(false);
    }
  }

  // 학습 폴링 (제출 후 + 재진입 시 공용) — 경과 시간으로 진행 문구 갱신
  function pollTrain(charId: string, jobId: string, startedAt: number) {
    const EST_MS = 6 * 60_000; // 보통 6분
    const tick = async () => {
      let st: { status?: string } = {};
      try {
        st = await fetch(`/api/train-character?id=${jobId}`).then((r) => r.json());
      } catch {
        /* 네트워크 흔들려도 계속 재시도 */
      }
      if (st.status === "completed") {
        store.updateCharacter(charId, {
          customReferenceId: jobId,
          trainStatus: "completed",
          trainJobId: undefined,
        });
        setChar((c) => (c ? { ...c, customReferenceId: jobId, trainStatus: "completed" } : c));
        setPhase("done");
        return;
      }
      if (st.status === "failed" || Date.now() - startedAt > 12 * 60_000) {
        store.updateCharacter(charId, { trainStatus: "failed", trainJobId: undefined });
        setPhase("failed");
        setMsg("학습 실패 — 사진을 바꿔서 다시 시도해주세요");
        return;
      }
      const elapsed = Date.now() - startedAt;
      const secs = Math.round(elapsed / 1000);
      const remainMin = Math.max(1, Math.ceil((EST_MS - elapsed) / 60_000));
      setElapsedSec(secs);
      setMsg(
        elapsed < EST_MS
          ? `약 ${remainMin}분 남았어요 (${secs}초 경과)`
          : `거의 다 됐어요... (${secs}초 경과)`,
      );
      setTimeout(tick, 5000);
    };
    void tick();
  }

  // 학습 시작
  async function startTrain() {
    if (!char) return;
    const srcs = candidates.filter((u) => picked.has(u));
    if (srcs.length < 2) {
      setMsg("사진을 2장 이상 골라주세요");
      return;
    }
    setPhase("training");
    setMsg("학습 제출 중...");
    try {
      const sub = await fetch("/api/train-character", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: char.name, imageUrls: srcs }),
      }).then((r) => r.json());
      if (!sub.id) {
        setPhase("failed");
        setMsg(sub.error ?? "학습 실패");
        return;
      }
      const startedAt = Date.now();
      store.updateCharacter(char.id, {
        trainStatus: "in_progress",
        trainJobId: sub.id,
        trainStartedAt: startedAt,
      });
      setMsg("학습을 시작했어요...");
      pollTrain(char.id, sub.id, startedAt);
    } catch (e) {
      setPhase("failed");
      setMsg(String(e));
    }
  }

  // ── 완료 화면 ──
  if (phase === "done") {
    return (
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh", alignItems: "center", justifyContent: "center", padding: 24, gap: 20, textAlign: "center" }}>
        <Avatar emoji={char.emoji} src={char.imageUrl} size={180} radius={20} />
        <div className="h2">얼굴 학습 완료</div>
        <div className="body2" style={{ color: "var(--gray-500)", lineHeight: 1.6 }}>
          이제 {char.name}의 사진은 어떤 장면에서도<br />항상 같은 얼굴로 나와요.
        </div>
        <button className="cta" style={{ maxWidth: 320 }} onClick={() => router.push("/photobooth")}>
          포토부스에서 찍어보기
        </button>
        <button className="nav-btn nav-prev" onClick={() => router.push("/my")}>
          마이페이지로
        </button>
      </div>
    );
  }

  // ── 학습 중 화면 ──
  if (phase === "training") {
    return (
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh", alignItems: "center", justifyContent: "center", padding: 24, gap: 24 }}>
        <div style={{ position: "relative" }}>
          <Avatar emoji={char.emoji} src={char.imageUrl} size={200} radius={20} />
          <div className="skeleton" style={{ position: "absolute", inset: 0, borderRadius: 20, opacity: 0.45 }} />
        </div>
        <div className="headline1">{char.name} 얼굴 학습 중</div>
        {/* 진행바 (6분 추정) */}
        <div style={{ width: "80%", maxWidth: 280 }}>
          <div style={{ height: 8, borderRadius: 999, background: "var(--gray-100)", overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${Math.min(96, (elapsedSec / 360) * 100)}%`,
                background: "var(--orange-700)",
                borderRadius: 999,
                transition: "width 1s linear",
              }}
            />
          </div>
        </div>
        <div className="body2" style={{ color: "var(--gray-500)", textAlign: "center", lineHeight: 1.6, maxWidth: 300 }}>
          {msg}
        </div>
        <div className="caption" style={{ color: "var(--gray-400)", textAlign: "center", maxWidth: 280, lineHeight: 1.5 }}>
          창을 닫거나 나가도 학습은 계속돼요.<br />다시 들어오면 여기서 진행 상황을 볼 수 있어요.
        </div>
        <button className="nav-btn nav-prev" onClick={() => router.push("/my")}>
          백그라운드로 두고 나가기
        </button>
      </div>
    );
  }

  // ── 사진 고르기 화면 ──
  const pickedCount = candidates.filter((u) => picked.has(u)).length;
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <header className="topbar" style={{ borderBottom: "1px solid var(--gray-100)" }}>
        <button className="nav-btn nav-prev" onClick={() => router.push("/my")}>
          ‹
        </button>
        <span className="headline1">얼굴 학습</span>
        <span style={{ width: 24 }} />
      </header>

      <div style={{ padding: "8px 20px 4px" }}>
        <div className="body2" style={{ color: "var(--gray-600)", lineHeight: 1.6 }}>
          {char.name}의 사진을 <b>여러 장 학습</b>시키면, 앞으로 어떤 장면에서도
          <b> 항상 같은 얼굴</b>로 나와요.
          <br />
          쓸 사진을 골라주세요. (많을수록 좋아요 · 4장+ 권장)
        </div>
      </div>

      <div style={{ flex: 1, padding: "12px 20px" }}>
        {candidates.length === 0 ? (
          <div style={{ padding: "48px 0", textAlign: "center", color: "var(--gray-400)" }} className="body2">
            학습할 후보 사진이 없어요.
            <br />
            아래 &quot;사진 더 만들기&quot;로 뽑아주세요.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {candidates.map((url) => {
              const on = picked.has(url);
              return (
                <button
                  key={url}
                  onClick={() => toggle(url)}
                  style={{
                    padding: 0,
                    border: on ? "3px solid var(--orange-700)" : "3px solid transparent",
                    borderRadius: 12,
                    overflow: "hidden",
                    background: "none",
                    cursor: "pointer",
                    position: "relative",
                    opacity: on ? 1 : 0.5,
                    transition: "all 200ms var(--ease)",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover", display: "block" }} />
                  <span
                    style={{
                      position: "absolute",
                      top: 6,
                      right: 6,
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: on ? "var(--orange-700)" : "rgba(30,30,30,0.5)",
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    {on ? "✓" : ""}
                  </span>
                </button>
              );
            })}
            {/* 사진 뽑는 동안 스켈레톤 (일반 4칸 / 각도 4칸) */}
            {(genBusy || angleBusy) &&
              [0, 1, 2, 3].map((i) => (
                <div
                  key={`sk-${i}`}
                  className="skeleton"
                  style={{ aspectRatio: "3/4", borderRadius: 12 }}
                />
              ))}
          </div>
        )}

        {/* 나노바나나 각도 자동 생성 — 같은 얼굴 여러 각도 (일관성 최상) */}
        <button
          onClick={genAngles}
          disabled={angleBusy || genBusy}
          style={{
            width: "100%",
            marginTop: 14,
            padding: 13,
            borderRadius: 10,
            border: "none",
            background: angleBusy ? "var(--gray-200)" : "var(--orange-700)",
            color: angleBusy ? "var(--gray-500)" : "#fff",
            fontFamily: "inherit",
            fontSize: 14,
            fontWeight: 700,
            cursor: angleBusy || genBusy ? "default" : "pointer",
          }}
        >
          {angleBusy
            ? "각도별로 뽑는 중... (1~2분)"
            : "대표 사진으로 4각도 자동 생성 (일관성 최상)"}
        </button>
        <div className="caption" style={{ color: "var(--gray-400)", marginTop: 6, lineHeight: 1.5 }}>
          프로필 사진 얼굴 그대로 정면·측면·옆모습·원거리를 만들어 학습에 넣어요.
        </div>

        <button
          onClick={genMore}
          disabled={genBusy || angleBusy}
          style={{
            width: "100%",
            marginTop: 14,
            padding: 13,
            borderRadius: 10,
            border: "1px solid var(--gray-200)",
            background: "#fff",
            fontFamily: "inherit",
            fontSize: 14,
            fontWeight: 600,
            color: genBusy ? "var(--gray-400)" : "var(--black)",
            cursor: genBusy ? "default" : "pointer",
          }}
        >
          {genBusy ? "사진 뽑는 중..." : "🔄 사진 더 만들기 (4장)"}
        </button>
        {msg && phase === "pick" && (
          <div className="caption" style={{ textAlign: "center", color: "#d64545", marginTop: 8 }}>
            {msg}
          </div>
        )}
      </div>

      <div style={{ padding: 20 }}>
        <div className="caption" style={{ textAlign: "center", color: "var(--gray-500)", marginBottom: 10 }}>
          {pickedCount}장 선택됨 · 학습에 1,200P 소모 · 3~6분
        </div>
        <button className="cta" disabled={pickedCount < 2 || genBusy} onClick={startTrain}>
          이 얼굴들로 학습하기
        </button>
      </div>
    </div>
  );
}
