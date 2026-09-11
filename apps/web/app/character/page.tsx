"use client";

// 캐릭터 페이지 — figma nKyolUAkQEK9hPqDAiOpGe (설정 42:2779 / 갤러리 42:2855·42:2918).
// 프로필 카드 + 설정/갤러리 탭. 편집(외모·성격·말투·호칭)은 backend.updateCharacter / setCallName.
// globals.css·components.tsx·icons.tsx·lib/* 는 수정 금지 → 페이지 전용 스타일은 아래 <style>·인라인.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  backend,
  getActiveCharacterId,
  setActiveCharacterId,
  type CharacterDetail,
  type PhotoItem,
} from "@/lib/api";
import { Avatar } from "../components";
import { Icon } from "../icons";

type Tab = "settings" | "gallery";

// ── 인라인 편집 섹션 (외모/성격) ──────────────────────────────
// ⚠️ 반드시 컴포넌트 밖에 정의 (안에 두면 입력마다 리마운트되어 포커스 유실)
function EditSection({
  title,
  value,
  placeholder,
  onSave,
}: {
  title: string;
  value: string;
  placeholder?: string;
  onSave: (v: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  function open() {
    setDraft(value);
    setEditing(true);
  }
  async function commit() {
    setSaving(true);
    try {
      await onSave(draft.trim());
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={{ marginBottom: 26 }}>
      <button className="cp-secTitle" onClick={open} type="button">
        <Icon name="edit-small" size={16} style={{ color: "var(--orange-700)" }} />
        <span className="label1">{title}</span>
      </button>

      {/* 편집/보기 부드러운 전환 — max-height + opacity */}
      <div className={`cp-collapse ${editing ? "open" : ""}`}>
        <div className="cp-collapseInner">
          <textarea
            className="input"
            style={{ height: 96, resize: "none", lineHeight: 1.55 }}
            value={draft}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="cp-btnGhost" onClick={() => setEditing(false)} type="button">
              취소
            </button>
            <button className="cp-btnFill" disabled={saving} onClick={() => void commit()} type="button">
              {saving ? "저장 중…" : "저장"}
            </button>
          </div>
        </div>
      </div>

      <div className={`cp-collapse ${editing ? "" : "open"}`}>
        <p className="body2 cp-collapseInner" style={{ color: "var(--gray-700)", margin: 0 }}>
          {value || <span style={{ color: "var(--gray-400)" }}>{placeholder ?? "아직 비어 있어요"}</span>}
        </p>
      </div>
    </section>
  );
}

export default function CharacterPage() {
  const router = useRouter();
  const [char, setChar] = useState<CharacterDetail | null>(null);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [galleryLoaded, setGalleryLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>("settings");
  const [viewer, setViewer] = useState<PhotoItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 호칭·말투 편집 상태
  const [editingName, setEditingName] = useState(false);
  const [callDraft, setCallDraft] = useState("");
  const [savingCall, setSavingCall] = useState(false);
  const [editingSpeech, setEditingSpeech] = useState(false);
  const [speechDraft, setSpeechDraft] = useState("");
  const [savingSpeech, setSavingSpeech] = useState(false);

  const idRef = useRef<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        let id = getActiveCharacterId();
        if (!id) {
          const list = await backend.listCharacters();
          if (list.length === 0) {
            router.replace("/create");
            return;
          }
          id = list[0].id;
          setActiveCharacterId(id);
        }
        idRef.current = id;
        setChar(await backend.getCharacter(id));
      } catch (e) {
        setError(e instanceof Error ? e.message : "백엔드 연결 실패");
      }
    })();
  }, [router]);

  // 갤러리 탭 첫 진입 시 lazy 로드
  useEffect(() => {
    if (tab !== "gallery" || galleryLoaded || idRef.current == null) return;
    (async () => {
      try {
        setPhotos(await backend.getGallery(idRef.current!));
      } catch {
        /* 빈 그리드 유지 */
      } finally {
        setGalleryLoaded(true);
      }
    })();
  }, [tab, galleryLoaded]);

  async function saveField(patch: { appearance?: string; personality?: string; speechStyles?: string[] }) {
    if (idRef.current == null) return;
    const updated = await backend.updateCharacter(idRef.current, patch);
    setChar(updated);
  }

  async function saveCallName() {
    if (idRef.current == null || savingCall) return;
    setSavingCall(true);
    try {
      const v = callDraft.trim();
      if (v && v !== (char?.callName ?? "")) {
        setChar(await backend.setCallName(idRef.current, v));
      }
      setEditingName(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "호칭 저장 실패");
    } finally {
      setSavingCall(false);
    }
  }

  async function saveSpeech() {
    if (savingSpeech) return;
    setSavingSpeech(true);
    try {
      const styles = speechDraft.split("\n").map((s) => s.trim()).filter(Boolean);
      await saveField({ speechStyles: styles });
      setEditingSpeech(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "말투 저장 실패");
    } finally {
      setSavingSpeech(false);
    }
  }

  if (error && !char) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100dvh", padding: 24 }}>
        <div className="body2" style={{ color: "var(--gray-500)", textAlign: "center" }}>{error}</div>
      </div>
    );
  }
  if (!char) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh", background: "var(--gray-50)" }}>
      {/* 헤더 */}
      <header className="topbar" style={{ background: "#fff" }}>
        <button className="nav-btn nav-prev" onClick={() => router.back()}>
          <Icon name="chevron-left" size={18} />
        </button>
        <span className="headline1">캐릭터 페이지</span>
        <span style={{ width: 18 }} />
      </header>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* 프로필 카드 */}
        <div style={{ padding: "8px 20px 4px" }}>
          <div className="cp-profile">
            <Avatar emoji="🙂" src={char.profileImageUrl ?? undefined} size={64} radius={16} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="h3" style={{ marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {char.name}
              </div>
              <div className="body2" style={{ color: "var(--gray-500)" }}>
                {char.relationshipType} <span style={{ color: "var(--gray-300)" }}>|</span> {char.age}{" "}
                <span style={{ color: "var(--gray-300)" }}>|</span> {char.gender}
              </div>
            </div>
            <button
              className="cp-pencil"
              onClick={() => {
                setCallDraft(char.callName ?? "");
                setEditingName((v) => !v);
              }}
              type="button"
              aria-label="호칭 편집"
            >
              <Icon name="edit" size={18} style={{ color: "var(--gray-500)" }} />
            </button>
          </div>

          {/* 호칭 편집 (연필 → 펼침) */}
          <div className={`cp-collapse ${editingName ? "open" : ""}`}>
            <div className="cp-collapseInner cp-callBox">
              <div className="caption" style={{ color: "var(--orange-700)", fontWeight: 700, marginBottom: 8 }}>
                {char.name}(이)가 나를 부르는 호칭
              </div>
              <input
                className="input"
                style={{ background: "#fff" }}
                placeholder="예: 자기야, 은우야, 야"
                value={callDraft}
                onChange={(e) => setCallDraft(e.target.value)}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button className="cp-btnGhost" onClick={() => setEditingName(false)} type="button">
                  취소
                </button>
                <button className="cp-btnFill" disabled={savingCall} onClick={() => void saveCallName()} type="button">
                  {savingCall ? "저장 중…" : "저장"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 탭 */}
        <div className="cp-tabs">
          <button className={`cp-tab ${tab === "settings" ? "on" : ""}`} onClick={() => setTab("settings")} type="button">
            설정
          </button>
          <button className={`cp-tab ${tab === "gallery" ? "on" : ""}`} onClick={() => setTab("gallery")} type="button">
            갤러리
          </button>
          <span className="cp-tabInd" style={{ transform: `translateX(${tab === "settings" ? "0" : "100%"})` }} />
        </div>

        {/* 탭 콘텐츠 — key 로 리마운트하며 fade-in (opacity, 360ms var(--ease)) */}
        <div key={tab} className="fade-in" style={{ padding: "18px 20px 28px" }}>
          {tab === "settings" ? (
            <>
              {char.summary && <div className="cp-summary body2">{char.summary}</div>}

              <EditSection
                title="외모"
                value={char.appearance ?? ""}
                placeholder="외모를 적어주세요"
                onSave={(v) => saveField({ appearance: v })}
              />
              <EditSection
                title="성격"
                value={char.personality ?? ""}
                placeholder="성격을 적어주세요"
                onSave={(v) => saveField({ personality: v })}
              />

              {/* 말투 */}
              <section style={{ marginBottom: 8 }}>
                <button
                  className="cp-secTitle"
                  type="button"
                  onClick={() => {
                    setSpeechDraft(char.speechStyles.join("\n"));
                    setEditingSpeech(true);
                  }}
                >
                  <Icon name="edit-small" size={16} style={{ color: "var(--orange-700)" }} />
                  <span className="label1">말투</span>
                </button>

                <div className={`cp-collapse ${editingSpeech ? "open" : ""}`}>
                  <div className="cp-collapseInner">
                    <textarea
                      className="input"
                      style={{ height: 110, resize: "none", lineHeight: 1.55 }}
                      value={speechDraft}
                      placeholder="한 줄에 하나 씩 · 예) ~던데? 를 자주 씀"
                      onChange={(e) => setSpeechDraft(e.target.value)}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <button className="cp-btnGhost" onClick={() => setEditingSpeech(false)} type="button">
                        취소
                      </button>
                      <button className="cp-btnFill" disabled={savingSpeech} onClick={() => void saveSpeech()} type="button">
                        {savingSpeech ? "저장 중…" : "저장"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className={`cp-collapse ${editingSpeech ? "" : "open"}`}>
                  <div className="cp-collapseInner" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {char.speechStyles.length > 0 ? (
                      char.speechStyles.map((s, i) => (
                        <span key={i} className="cp-speechChip">
                          {s}
                        </span>
                      ))
                    ) : (
                      <span className="body2" style={{ color: "var(--gray-400)" }}>말투가 아직 없어요</span>
                    )}
                  </div>
                </div>
              </section>

              {error && (
                <div className="caption" style={{ color: "#d64545", textAlign: "center", marginTop: 12 }}>{error}</div>
              )}
            </>
          ) : (
            <>
              {!galleryLoaded ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="skeleton" style={{ aspectRatio: "3/4", borderRadius: 14 }} />
                  ))}
                </div>
              ) : photos.length === 0 ? (
                <div
                  style={{
                    padding: "72px 0",
                    textAlign: "center",
                    color: "var(--gray-400)",
                    border: "1px dashed var(--gray-200)",
                    borderRadius: 16,
                  }}
                >
                  <Icon name="camera" size={30} style={{ color: "var(--gray-400)", marginBottom: 10 }} />
                  <div className="body2">{char.name}와의 사진이 아직 없어요</div>
                  <button className="chip" style={{ marginTop: 14 }} onClick={() => router.push("/photobooth")}>
                    포토부스에서 찍기
                  </button>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {photos.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setViewer(p)}
                      style={{ border: "none", padding: 0, background: "transparent", cursor: "pointer", position: "relative" }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.imageUrl}
                        alt={p.concept ?? ""}
                        style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover", borderRadius: 14, display: "block" }}
                      />
                      <span className="cp-concept">
                        {p.type === "PROFILE" ? "프로필" : p.concept ?? "포토부스"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 전체화면 뷰어 */}
      {viewer && (
        <div className="dim" onClick={() => setViewer(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={viewer.imageUrl}
            alt=""
            style={{ maxWidth: "92vw", maxHeight: "74vh", borderRadius: 16 }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* 페이지 전용 스타일 (globals.css 수정 금지 → 인라인) */}
      <style>{`
        .cp-profile {
          display: flex; align-items: center; gap: 14px;
          padding: 16px; border-radius: 18px; background: #fff;
          border: 1px solid var(--gray-100);
          box-shadow: 0 6px 20px rgba(30,30,30,0.05);
        }
        .cp-pencil {
          flex-shrink: 0; width: 34px; height: 34px; border-radius: 10px;
          border: none; background: var(--gray-50); cursor: pointer;
          display: grid; place-items: center;
          transition: background 200ms var(--ease);
        }
        .cp-pencil:active { background: var(--gray-100); }

        .cp-callBox {
          margin-top: 10px; padding: 14px 16px; border-radius: 14px;
          background: var(--orange-50); border: 1px solid var(--orange-200);
        }

        /* 탭 */
        .cp-tabs {
          position: relative; display: flex;
          margin: 18px 20px 0; border-bottom: 1px solid var(--gray-200);
        }
        .cp-tab {
          flex: 1; padding: 12px 0; border: none; background: none; cursor: pointer;
          font-family: inherit; font-size: 16px; font-weight: 500;
          color: var(--gray-400);
          transition: color 360ms var(--ease), font-weight 360ms var(--ease);
        }
        .cp-tab.on { color: var(--black); font-weight: 700; }
        .cp-tabInd {
          position: absolute; bottom: -1px; left: 0; width: 50%; height: 2px;
          background: var(--black); border-radius: 2px;
          transition: transform 360ms var(--ease);
        }

        /* 요약 카드 (크림) */
        .cp-summary {
          padding: 14px 16px; border-radius: 12px; margin-bottom: 24px;
          background: var(--orange-50); border: 1px solid var(--orange-200);
          color: var(--gray-800); text-align: center;
        }

        /* 섹션 제목 (연필 + 텍스트) */
        .cp-secTitle {
          display: flex; align-items: center; gap: 7px;
          border: none; background: none; cursor: pointer; padding: 0;
          margin-bottom: 8px; color: var(--black);
        }
        .cp-secTitle .label1 { color: var(--black); }

        /* 말투 칩 (figma: 흰 배경 아웃라인 pill) */
        .cp-speechChip {
          padding: 8px 14px; border-radius: 999px;
          border: 1px solid var(--gray-200); background: #fff;
          font-size: 14px; font-weight: 500; color: var(--gray-700);
        }

        /* 갤러리 컨셉 라벨 (figma: 사진 좌하단 흰 pill) */
        .cp-concept {
          position: absolute; left: 8px; bottom: 8px;
          padding: 4px 10px; border-radius: 999px;
          background: #fff; color: var(--gray-800);
          font-size: 11px; font-weight: 700;
          box-shadow: 0 2px 8px rgba(30,30,30,0.18);
        }

        /* 편집/보기 접힘 전환 — display:none 대신 max-height + opacity */
        .cp-collapse {
          display: grid; grid-template-rows: 0fr; opacity: 0;
          transition: grid-template-rows 360ms var(--ease), opacity 240ms var(--ease);
        }
        .cp-collapse.open { grid-template-rows: 1fr; opacity: 1; }
        .cp-collapseInner { overflow: hidden; min-height: 0; }

        .cp-btnGhost, .cp-btnFill {
          flex: 1; padding: 11px 0; border-radius: 10px; cursor: pointer;
          font-family: inherit; font-size: 14px; font-weight: 700;
          transition: all 200ms var(--ease);
        }
        .cp-btnGhost { border: 1px solid var(--gray-200); background: #fff; color: var(--gray-600); }
        .cp-btnFill { border: none; background: var(--gray-900); color: #fff; }
        .cp-btnFill:disabled { background: var(--gray-300); color: #fff; cursor: default; }
      `}</style>
    </div>
  );
}
