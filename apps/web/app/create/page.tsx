"use client";

// FS-01 캐릭터 생성 — Spring 백엔드 연동판.
// 관계+성별 → 자유 서술 → AI 인터뷰(백엔드가 질문·선택지 생성) → 이름/생일 →
// 컴파일(백엔드가 프로필+초상 후보 생성) → 카드 확인/수정 → 사진 느낌 → 초상 선택 → 홈.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { RELATIONSHIPS } from "@/lib/character";
import {
  backend,
  setActiveCharacterId,
  type CharacterDetail,
  type InterviewAnswer,
  type InterviewQuestion,
  type PhotoItem,
} from "@/lib/api";
import { Avatar } from "../components";
import { Icon } from "../icons";

// 인터뷰 탭(피그마 카테고리) — 백엔드 question.category와 매칭해 활성 탭 표시.
const TAB_CATS = ["외모", "분위기", "성격"];
// 사진 느낌 추천 칩 (피그마 onboarding/6)
const PHOTO_FEEL_CHIPS = [
  "창밖 보며 나른한 옆얼굴",
  "새침하게 턱 괸 표정",
  "장난스럽게 살짝 웃는",
  "도도하게 내려다보는 눈빛",
  "피곤한 듯 무심한 표정",
  "무표정으로 카메라 정면 응시",
];

// 한글 받침 유무로 조사 선택 (외모를 / 성격을)
function josa(word: string, withBatchim: string, withoutBatchim: string): string {
  const code = word.charCodeAt(word.length - 1);
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return withoutBatchim;
  return (code - 0xac00) % 28 !== 0 ? withBatchim : withoutBatchim;
}

// 재생성 아이콘 (icons.tsx에 없어 인라인)
function RefreshIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// 진행 점 (피그마 온보딩 상단 4점)
function Dots({ active }: { active: number }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: i === active ? "var(--orange-600)" : "var(--gray-300)",
            transition: "background 360ms var(--ease)",
          }}
        />
      ))}
    </div>
  );
}

// 온보딩 상단바 — 좌측 뒤로가기(첫 화면 제외) + 중앙 진행 점
function OnbTop({ dots, onBack }: { dots: number; onBack?: () => void }) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px 20px",
        minHeight: 56,
      }}
    >
      {onBack && (
        <button
          onClick={onBack}
          aria-label="이전"
          style={{
            position: "absolute",
            left: 14,
            top: "50%",
            transform: "translateY(-50%)",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--gray-700)",
            display: "flex",
            padding: 6,
          }}
        >
          <Icon name="chevron-left" size={22} />
        </button>
      )}
      <Dots active={dots} />
    </div>
  );
}

// 매크로 스텝: 0 관계 → 1 프롬프트 → 2 인터뷰 → 3 이름/생일 → 4 컴파일 로딩 → 6 카드 → 7 사진 느낌 → 5 초상 선택
export default function CreatePage() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  const [relationship, setRelationship] = useState<string | null>(null);
  const [gender, setGender] = useState<string | null>(null);
  const [freeText, setFreeText] = useState("");
  const [answers, setAnswers] = useState<InterviewAnswer[]>([]);
  const [question, setQuestion] = useState<InterviewQuestion | null>(null);
  const [qLoading, setQLoading] = useState(false);
  const [customAnswer, setCustomAnswer] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  const [name, setName] = useState("");
  const [birth, setBirth] = useState({ y: "", m: "", d: "" });
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState<string | null>(null);

  // 컴파일 결과
  const [compiled, setCompiled] = useState<CharacterDetail | null>(null);
  const [portraits, setPortraits] = useState<PhotoItem[]>([]);
  const [selectedPortrait, setSelectedPortrait] = useState<number | null>(null);
  const [editingCard, setEditingCard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [portraitTimeout, setPortraitTimeout] = useState(false);
  const pollStartRef = useRef<number>(0);

  // 사진 느낌 (onboarding/6 프레젠테이션용 — 백엔드에 후보 재생성 엔드포인트 없음)
  const [photoFeelText, setPhotoFeelText] = useState("");
  const [photoFeelChip, setPhotoFeelChip] = useState<string | null>(null);

  // 초상 후보는 백엔드가 백그라운드로 생성 → 갤러리를 폴링해 도착하는 대로 표시.
  useEffect(() => {
    if (!compiled) return;
    pollStartRef.current = Date.now();
    const POLL_MS = 5000;
    const GIVE_UP_MS = 12 * 60 * 1000;
    const timer = setInterval(async () => {
      try {
        const gallery = await backend.getGallery(compiled.id);
        const profiles = gallery.filter((p) => p.type === "PROFILE");
        if (profiles.length > 0) setPortraits(profiles);
        if (profiles.length >= 4) {
          clearInterval(timer);
          return;
        }
      } catch {
        // 일시 오류는 다음 턴에 재시도
      }
      if (Date.now() - pollStartRef.current > GIVE_UP_MS) {
        clearInterval(timer);
        setPortraitTimeout(true);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [compiled]);

  async function fetchQuestion(prev: InterviewAnswer[]) {
    if (!relationship || !gender) return;
    setQLoading(true);
    setQuestion(null);
    setCustomAnswer("");
    setShowCustom(false);
    setError(null);
    try {
      const q = await backend.interview({
        relationshipType: relationship,
        gender,
        freeText: freeText.trim() || undefined,
        previousAnswers: prev,
      });
      if (q.done) {
        setStep(3); // 백엔드가 충분하다고 판단 → 이름/생일로
      } else {
        setQuestion(q);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "질문 생성 실패");
    } finally {
      setQLoading(false);
    }
  }

  function startInterview() {
    setStep(2);
    void fetchQuestion(answers);
  }

  function answer(picked: string) {
    if (!question) return;
    const next = [
      ...answers,
      { category: question.category, question: question.question, answer: picked },
    ];
    setAnswers(next);
    void fetchQuestion(next);
  }

  async function finish() {
    if (!relationship || !gender) return;
    const y = birth.y.padStart(4, "0");
    const m = birth.m.padStart(2, "0");
    const d = birth.d.padStart(2, "0");
    const birthday =
      parseInt(birth.y, 10) > 1900 && birth.m && birth.d ? `${y}-${m}-${d}` : undefined;
    setStep(4);
    setError(null);
    try {
      setLoadingMsg("답변을 바탕으로 프로필을 조립하는 중");
      const result = await backend.compile({
        relationshipType: relationship,
        gender,
        freeText: freeText.trim() || undefined,
        interviewAnswers: answers,
        name: name.trim(),
        birthday,
      });
      setCompiled(result.character);
      setPortraits(result.candidatePortraits);
      setActiveCharacterId(result.character.id);
      setStep(6); // 카드 확인
    } catch (e) {
      alert(
        `생성에 실패했어요. 다시 시도해주세요.\n${e instanceof Error ? e.message : ""}`,
      );
      setStep(3);
    }
  }

  // 카드 수정 반영 (백엔드 PATCH — 외모/성격/말투만 지원)
  async function finishCard() {
    if (!compiled) return;
    setSaving(true);
    try {
      await backend.updateCharacter(compiled.id, {
        appearance: compiled.appearance ?? undefined,
        personality: compiled.personality ?? undefined,
        speechStyles: compiled.speechStyles,
      });
    } catch {
      // 수정 저장 실패해도 진행
    } finally {
      setSaving(false);
    }
    setStep(7); // 사진 느낌 → 초상 선택
  }

  async function confirmPortrait() {
    if (!compiled) return;
    if (selectedPortrait !== null) {
      try {
        await backend.selectPortrait(compiled.id, selectedPortrait);
      } catch (e) {
        setError(e instanceof Error ? e.message : "초상 선택 실패");
        return;
      }
    }
    router.push("/home");
  }

  // 갤러리 재조회 (도착한 사진 새로고침) — 안전한 읽기
  async function refreshGallery() {
    if (!compiled) return;
    try {
      const gallery = await backend.getGallery(compiled.id);
      const profiles = gallery.filter((p) => p.type === "PROFILE");
      if (profiles.length > 0) setPortraits(profiles);
    } catch {
      // 무시 — 다음 폴링/재시도
    }
  }

  function setCardField(patch: Partial<CharacterDetail>) {
    setCompiled((c) => (c ? { ...c, ...patch } : c));
  }

  // ── step 6: 캐릭터 카드 (FS-02) ──
  if (step === 6 && compiled) {
    const c = compiled;
    const field = (
      label: string,
      value: string,
      key: "appearance" | "personality",
      rows = 3,
    ) => (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "52px 1fr",
          gap: "0 14px",
          marginBottom: 18,
          alignItems: "start",
        }}
      >
        <div className="label1" style={{ fontSize: 15, color: "var(--gray-800)", paddingTop: 2 }}>
          {label}
        </div>
        {editingCard ? (
          <textarea
            className="input"
            style={{ height: rows * 26 + 20, resize: "none", lineHeight: 1.55 }}
            value={value}
            onChange={(e) => setCardField({ [key]: e.target.value })}
          />
        ) : (
          <div className="body2" style={{ color: "var(--gray-600)", lineHeight: 1.6 }}>
            {value}
          </div>
        )}
      </div>
    );

    return (
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
        <div className="topbar">
          <span className="headline1">캐릭터가 생성되었어요</span>
          <button
            className="nav-btn"
            style={{
              color: editingCard ? "var(--orange-700)" : "var(--gray-500)",
              fontWeight: 700,
            }}
            onClick={() => setEditingCard((v) => !v)}
          >
            {editingCard ? (
              "완료"
            ) : (
              <>
                <Icon name="edit-small" size={14} style={{ verticalAlign: "-2px", marginRight: 3 }} />
                편집
              </>
            )}
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 20px" }}>
          {/* 프로필 헤더 카드 */}
          <div
            style={{
              border: "1px solid var(--gray-200)",
              borderRadius: 16,
              padding: "22px 20px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            <Avatar emoji="✨" src={c.profileImageUrl ?? undefined} size={84} radius={16} />
            <div className="headline1" style={{ marginTop: 12 }}>
              {c.name}
            </div>
            <div className="body2" style={{ color: "var(--gray-500)", marginTop: 4 }}>
              {c.relationshipType}　∣　{c.age}　∣　{c.gender}
            </div>
          </div>

          {/* 한 줄 요약 */}
          {c.summary && (
            <div
              style={{
                border: "1px solid var(--gray-200)",
                borderRadius: 12,
                padding: "16px 18px",
                marginBottom: 20,
                textAlign: "center",
              }}
            >
              <div className="headline2" style={{ color: "var(--gray-800)", fontWeight: 700, lineHeight: 1.5 }}>
                {c.summary}
              </div>
            </div>
          )}

          {field("외모", c.appearance ?? "", "appearance", 3)}
          {field("성격", c.personality ?? "", "personality", 3)}

          {/* 말투 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "52px 1fr",
              gap: "0 14px",
              marginBottom: 8,
              alignItems: "start",
            }}
          >
            <div className="label1" style={{ fontSize: 15, color: "var(--gray-800)", paddingTop: 2 }}>
              말투
            </div>
            {editingCard ? (
              <textarea
                className="input"
                style={{ height: 84, resize: "none", lineHeight: 1.55 }}
                value={c.speechStyles.join("\n")}
                onChange={(e) =>
                  setCardField({
                    speechStyles: e.target.value.split("\n").filter((x) => x.trim()),
                  })
                }
              />
            ) : (
              <div className="chip-row">
                {c.speechStyles.map((q) => (
                  <span key={q} className="chip" style={{ cursor: "default" }}>
                    {q}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: 20 }}>
          <button
            className="cta"
            disabled={editingCard || saving}
            onClick={() => void finishCard()}
          >
            {editingCard
              ? "수정 끝나면 완료를 눌러주세요"
              : saving
                ? "저장 중…"
                : "프로필 사진 만들기"}
          </button>
        </div>
      </div>
    );
  }

  // ── step 7: 사진 느낌 (onboarding/6) ──
  if (step === 7) {
    return (
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
        <div className="topbar">
          <button className="nav-btn nav-prev" onClick={() => setStep(6)}>
            <Icon name="chevron-left" size={18} /> 이전
          </button>
          <span />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 20px" }}>
          <h1 className="h2" style={{ margin: 0 }}>
            어떤 느낌이면 좋을까요?
          </h1>
          <div className="body2" style={{ color: "var(--gray-500)", marginTop: 6 }}>
            표정·분위기·상황을 적어주세요
          </div>
          <div className="body2" style={{ color: "var(--orange-700)", fontWeight: 600, marginTop: 2 }}>
            대신 얼굴이 나오는 사진이어야 해요!
          </div>

          <input
            className="input"
            style={{ marginTop: 16 }}
            placeholder="예: 무표정으로 창밖을 보는, 살짝 시크한 분위기"
            value={photoFeelText}
            onChange={(e) => setPhotoFeelText(e.target.value)}
          />

          <div className="headline1" style={{ margin: "24px 0 12px" }}>
            이런 느낌은 어떨까요?
          </div>
          <div className="chip-row">
            {PHOTO_FEEL_CHIPS.map((chipText) => (
              <button
                key={chipText}
                className={`chip ${photoFeelChip === chipText ? "selected" : ""}`}
                onClick={() =>
                  setPhotoFeelChip((cur) => (cur === chipText ? null : chipText))
                }
              >
                {chipText}
              </button>
            ))}
          </div>
        </div>

        <div style={{ padding: 20 }}>
          <button className="cta" onClick={() => setStep(5)}>
            이 느낌으로 사진 만들기
          </button>
        </div>
      </div>
    );
  }

  // ── step 5: 초상 후보 중 고르기 ──
  if (step === 5) {
    return (
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
        <div className="topbar">
          <button className="nav-btn nav-prev" onClick={() => setStep(7)}>
            <Icon name="chevron-left" size={18} /> 이전
          </button>
          <span />
        </div>

        <div style={{ padding: "0 20px 8px" }}>
          <h1 className="h2" style={{ margin: 0 }}>
            마음에 드는 사진을 골라주세요
          </h1>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px" }}>
          {portraits.length < 4 && !portraitTimeout && (
            <div
              className="body2 fade-in"
              style={{ textAlign: "center", color: "var(--gray-500)", margin: "4px 0 12px" }}
            >
              ✦ {name || "캐릭터"}의 사진을 그리는 중이에요 — 도착하는 대로 여기 떠요 (2~7분)
            </div>
          )}
          {portraitTimeout && portraits.length === 0 && (
            <div
              className="body2"
              style={{ textAlign: "center", color: "var(--gray-500)", margin: "4px 0 12px" }}
            >
              사진 생성이 지연되고 있어요. 나중에 마이페이지 갤러리에서 고를 수 있어요.
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {portraits.map((p) => {
              const on = selectedPortrait === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedPortrait(p.id)}
                  style={{
                    padding: 0,
                    border: on ? "2px solid var(--orange-700)" : "2px solid var(--gray-200)",
                    borderRadius: 16,
                    overflow: "hidden",
                    cursor: "pointer",
                    background: "none",
                    position: "relative",
                    transition: "border-color 200ms var(--ease)",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.imageUrl}
                    alt=""
                    style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover", display: "block" }}
                  />
                  {on && (
                    <span
                      style={{
                        position: "absolute",
                        top: 8,
                        right: 8,
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        background: "var(--orange-700)",
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Icon name="check" size={14} />
                    </span>
                  )}
                </button>
              );
            })}
            {!portraitTimeout &&
              portraits.length < 4 &&
              Array.from({ length: 4 - portraits.length }, (_, i) => (
                <div
                  key={`sk-${i}`}
                  className="skeleton"
                  style={{ aspectRatio: "3/4", borderRadius: 16 }}
                />
              ))}
          </div>
          {error && (
            <div className="caption" style={{ color: "#d64545", textAlign: "center", marginTop: 12 }}>
              {error}
            </div>
          )}
        </div>

        <div style={{ padding: 20 }}>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => void refreshGallery()}
              style={{
                flex: 1,
                padding: 16,
                borderRadius: 12,
                border: "1px solid var(--gray-300)",
                background: "#fff",
                color: "var(--gray-800)",
                fontFamily: "inherit",
                fontSize: 16,
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              재생성 <RefreshIcon size={15} />
            </button>
            <button
              className="cta"
              style={{ flex: 1 }}
              disabled={selectedPortrait === null}
              onClick={() => void confirmPortrait()}
            >
              확정
            </button>
          </div>
          <button
            onClick={() => router.push("/home")}
            style={{
              display: "block",
              margin: "10px auto 0",
              border: "none",
              background: "none",
              color: "var(--gray-400)",
              fontFamily: "inherit",
              fontSize: 13,
              cursor: "pointer",
              padding: 4,
            }}
          >
            나중에 정할래요
          </button>
        </div>
      </div>
    );
  }

  // ── step 4: 컴파일 로딩 ──
  if (step === 4) {
    return (
      <div
        style={{
          flex: 1,
          minHeight: "100dvh",
          background:
            "linear-gradient(180deg, var(--orange-50) 0%, #fff 62%, var(--orange-500) 140%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 24,
          padding: 20,
        }}
      >
        <div
          className="skeleton fade-in"
          style={{ width: "min(280px, 72vw)", aspectRatio: "3/4", borderRadius: 20 }}
        />
        <div className="logo" style={{ fontSize: 22, color: "var(--gray-600)" }}>
          Draw Your Character...
        </div>
        {loadingMsg && (
          <div className="caption" style={{ color: "var(--gray-500)" }}>
            {loadingMsg}
          </div>
        )}
      </div>
    );
  }

  // ── step 0~3: 위저드 (관계 / 프롬프트 / 인터뷰 / 이름) ──
  const handleBack = () => {
    if (step === 1) setStep(0);
    else if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
    else setStep(Math.max(0, step - 1));
  };

  const cat = question?.category ?? "";
  const activeTab = TAB_CATS.find((t) => cat.includes(t)) ?? cat;

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <OnbTop dots={step} onBack={step > 0 ? handleBack : undefined} />

      {/* ── 0. 관계 + 성별 ── */}
      {step === 0 && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 20px 20px" }}>
            <h1 className="h2" style={{ margin: "0 0 20px" }}>
              어떤 관계로 시작할까요?
            </h1>
            {RELATIONSHIPS.map((r) => (
              <button
                key={r}
                className={`select-card ${relationship === r ? "selected" : ""}`}
                onClick={() => setRelationship(r)}
              >
                {r}
                <span className="check">
                  <Icon name="check" size={16} />
                </span>
              </button>
            ))}

            <div className="label1" style={{ margin: "24px 0 12px" }}>
              그 사람의 성별은?
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {["여성", "남성", "기타"].map((g) => (
                <button
                  key={g}
                  className={`chip ${gender === g ? "selected" : ""}`}
                  style={{ flex: 1, borderRadius: 10, padding: "14px 0" }}
                  onClick={() => setGender(g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
          <div style={{ padding: 20 }}>
            <button
              className="cta"
              disabled={!relationship || !gender}
              onClick={() => setStep(1)}
            >
              다음
            </button>
          </div>
        </div>
      )}

      {/* ── 1. 시작 프롬프트 ── */}
      {step === 1 && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 20px 20px" }}>
            <h1 className="h2" style={{ margin: "0 0 4px" }}>
              어떤 사람이었으면 하나요?
            </h1>
            <div className="body2" style={{ color: "var(--gray-500)", margin: "8px 0 14px" }}>
              자유롭게 묘사해주세요. 부족한 부분은 AI가 물어봐요.
              <br />
              건너뛰면 처음부터 골라가며 만들 수 있어요.
            </div>
            <textarea
              className="input"
              style={{ height: 160, resize: "none", lineHeight: 1.6 }}
              placeholder={
                "ex)\n무심한데 나한테만 다정한 연상.\n밤에 통화하는 거 좋아하고, 골목 안 작은 바에서 일해요.\n웃을 때 눈이 접히는 강아지상이면 좋겠어요"
              }
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
            />
          </div>
          <div style={{ padding: 20 }}>
            <button className="cta" onClick={startInterview}>
              다음
            </button>
          </div>
        </div>
      )}

      {/* ── 2. AI 인터뷰 (탭/카드 구조) ── */}
      {step === 2 && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {/* 헤더: 제목 + 응답 수 + 카테고리 탭 */}
          <div style={{ padding: "0 20px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 14,
              }}
            >
              <h1 className="h2" style={{ margin: 0 }}>
                {cat ? `${cat}${josa(cat, "을", "를")} 골라주세요` : "AI 인터뷰"}
              </h1>
              <span className="caption" style={{ color: "var(--orange-700)", fontWeight: 700 }}>
                {answers.length}개 응답
              </span>
            </div>
            <div style={{ display: "flex", gap: 24, borderBottom: "1px solid var(--gray-200)" }}>
              {TAB_CATS.map((t) => {
                const on = t === activeTab;
                return (
                  <div
                    key={t}
                    style={{
                      padding: "0 0 10px",
                      marginBottom: -1,
                      fontSize: 15,
                      fontWeight: on ? 700 : 500,
                      color: on ? "var(--black)" : "var(--gray-400)",
                      borderBottom: on ? "2px solid var(--orange-600)" : "2px solid transparent",
                    }}
                  >
                    {t}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 본문 (연한 회색 배경) */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              background: "var(--gray-50)",
              padding: "20px",
            }}
          >
            {qLoading && (
              <div className="fade-in">
                <div className="skeleton" style={{ height: 26, width: "72%", marginBottom: 20 }} />
                <div className="skeleton" style={{ height: 60, borderRadius: 12, marginBottom: 10 }} />
                <div className="skeleton" style={{ height: 60, borderRadius: 12, marginBottom: 10 }} />
                <div className="skeleton" style={{ height: 60, borderRadius: 12, width: "60%" }} />
              </div>
            )}

            {error && !qLoading && (
              <div className="caption" style={{ color: "#d64545", margin: "12px 0" }}>
                {error} —{" "}
                <button
                  className="nav-btn"
                  style={{ display: "inline" }}
                  onClick={() => void fetchQuestion(answers)}
                >
                  다시 시도
                </button>
              </div>
            )}

            {!question && !qLoading && !error && (
              <div style={{ textAlign: "center", marginTop: 24 }}>
                <button className="cta" style={{ width: "auto", padding: "12px 20px" }} onClick={() => void fetchQuestion(answers)}>
                  질문 불러오기
                </button>
              </div>
            )}

            {question && !qLoading && (
              <div className="fade-in" key={question.question}>
                {answers.length > 0 && (
                  <button
                    className="nav-btn"
                    style={{ color: "var(--gray-700)", padding: 0, marginBottom: 14 }}
                    onClick={() => void fetchQuestion(answers)}
                  >
                    <Icon name="chevron-left" size={16} /> 다른 질문
                  </button>
                )}

                <div className="headline1" style={{ marginBottom: 14 }}>
                  {question.question}
                </div>

                {question.suggestedAnswers.map((text) => (
                  <button
                    key={text}
                    className="select-card"
                    style={{ background: "#fff" }}
                    onClick={() => answer(text)}
                  >
                    <span style={{ textAlign: "left", lineHeight: 1.5 }}>{text}</span>
                    <span className="check">
                      <Icon name="check" size={16} />
                    </span>
                  </button>
                ))}

                {/* 직접 입력 카드 → 인라인 입력 */}
                {!showCustom ? (
                  <button
                    className="select-card"
                    style={{ background: "#fff", color: "var(--gray-500)" }}
                    onClick={() => setShowCustom(true)}
                  >
                    <span>직접 입력</span>
                    <span className="check">
                      <Icon name="check" size={16} />
                    </span>
                  </button>
                ) : (
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      className="input"
                      style={{ flex: 1, borderRadius: 999, background: "#fff" }}
                      placeholder="직접 입력해도 돼요"
                      autoFocus
                      value={customAnswer}
                      onChange={(e) => setCustomAnswer(e.target.value)}
                      onKeyDown={(e) => {
                        if (
                          e.key === "Enter" &&
                          !e.nativeEvent.isComposing &&
                          customAnswer.trim()
                        ) {
                          answer(customAnswer.trim());
                        }
                      }}
                    />
                    <button
                      className="send-btn"
                      disabled={!customAnswer.trim()}
                      onClick={() => customAnswer.trim() && answer(customAnswer.trim())}
                    >
                      <Icon name="send" size={18} />
                    </button>
                  </div>
                )}

                {/* 재생성 */}
                <div style={{ textAlign: "center", marginTop: 16 }}>
                  <button
                    onClick={() => void fetchQuestion(answers)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--gray-500)",
                      fontFamily: "inherit",
                      fontSize: 14,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    재생성 <RefreshIcon size={15} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 하단 CTA (피치) */}
          <div style={{ padding: 20 }}>
            <button
              onClick={() => setStep(3)}
              style={{
                width: "100%",
                padding: 16,
                borderRadius: 12,
                border: "none",
                background: "var(--orange-400)",
                color: "var(--black)",
                fontFamily: "inherit",
                fontSize: 16,
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              이 정도면 됐어요 <Icon name="arrow-right" size={18} />
            </button>
          </div>
        </div>
      )}

      {/* ── 3. 이름/생일 ── */}
      {step === 3 && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 20px 20px" }}>
            <h1 className="h2" style={{ margin: 0 }}>
              이름과 나이를 정해주세요
            </h1>

            <div className="label1" style={{ marginTop: 28 }}>
              이름
            </div>
            <input
              className="input"
              style={{ marginTop: 10 }}
              placeholder="나랑 사귀면 완전 야르~"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            <div className="label1" style={{ marginTop: 28 }}>
              생일
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              {(["y", "m", "d"] as const).map((k) => (
                <input
                  key={k}
                  className="input"
                  style={{ textAlign: "center", flex: k === "y" ? 1.4 : 1 }}
                  placeholder={k === "y" ? "0000" : "00"}
                  maxLength={k === "y" ? 4 : 2}
                  inputMode="numeric"
                  value={birth[k]}
                  onChange={(e) =>
                    setBirth({ ...birth, [k]: e.target.value.replace(/\D/g, "") })
                  }
                />
              ))}
            </div>
          </div>
          <div style={{ padding: 20 }}>
            <button
              className="cta"
              disabled={!name.trim()}
              onClick={() => void finish()}
            >
              생성
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
