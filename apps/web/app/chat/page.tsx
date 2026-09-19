"use client";

// FS-03 채팅 — Spring 백엔드 연동판.
// 대화 이력·전송·호칭 모두 백엔드 API 경유. 응답은 non-streaming이라 대기 중 타이핑 버블 표시.
// ?episode=<id> 로 진입하면 에피소드 전용 채팅 엔드포인트를 쓴다.

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import {
  backend,
  ApiError,
  prepareChatRequest,
  getPendingChatRequest,
  clearChatRequest,
  getActiveCharacterId,
  setActiveCharacterId,
  type CharacterDetail,
  type ChatMessage,
} from "@/lib/api";
import { Icon } from "../icons";
import { market, formatPrice, purchaseCharacter, pendingPreviewMessages, MarketRequestError } from '@/lib/market';
import { nftGiftImageUrl, nftGifts, explorerTxUrl } from '@/lib/gifts';
import type { MarketPreview, NftGiftCatalogItem } from '@everyday/contracts';

type Msg = { role: "user" | "assistant"; content: string; id?: number; gift?: ChatMessage['gift'] };

function toMsg(m: ChatMessage): Msg {
  return { id: m.id, role: m.sender === "USER" ? "user" : "assistant", content: m.content, gift: m.gift };
}

// 선물 판단·서명·확정 사이의 상태. declined/failed는 서버가 내려주지 않는다.
const PENDING_GIFT = new Set(['evaluating', 'prepared', 'unknown']);
const isPendingGift = (m: Msg) => Boolean(m.gift && PENDING_GIFT.has(m.gift.status));

/** 확정 전에는 "확인 중"만, 확정 후에는 상품·캐릭터의 한마디·거래 링크. 거래 확정 전에 "보냈어"라고 말하지 않는다. */
function GiftCard({ gift, product, onOpen }: { gift: NonNullable<Msg['gift']>; product?: NftGiftCatalogItem; onOpen: () => void }) {
  if (gift.status !== 'confirmed') {
    return (
      <div className="gift-card gift-pending" role="status" aria-live="polite">
        <span className="gift-spinner" aria-hidden />
        <div>
          <strong className="body2">선물을 준비하고 있어요</strong>
          <div className="caption" style={{ color: 'var(--gray-600)', marginTop: 2 }}>온체인 확인 중이에요. 잠시만요.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="gift-card gift-confirmed">
      <button type="button" onClick={onOpen} className="gift-hero">
        {product?.imageUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={nftGiftImageUrl(product)} alt={product.title} className="gift-image" />
          : <div className="gift-image skeleton" aria-hidden />}
        <div style={{ minWidth: 0 }}>
          <div className="caption" style={{ color: 'var(--key)', fontWeight: 700 }}>🎁 NFT 선물이 도착했어요</div>
          <strong className="body2" style={{ display: 'block', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {product?.title ?? '선물'}
          </strong>
          {product && <div className="caption" style={{ color: 'var(--gray-600)' }}>{formatPrice(product.priceMist)} · 캐릭터 금고에서 결제</div>}
        </div>
      </button>
      {gift.reason && <p className="body2 gift-reason">“{gift.reason}”</p>}
      <div className="gift-actions">
        <button type="button" className="chip" onClick={onOpen}>내 선물 보기</button>
        {gift.digest && <a className="chip" href={explorerTxUrl(gift.digest)} target="_blank" rel="noreferrer">거래 보기</a>}
      </div>
    </div>
  );
}

function ChatInner() {
  const router = useRouter();
  const params = useSearchParams();
  const episodeId = params.get("episode");
  const episodeTitle = params.get("title");
  const starter = params.get("starter");
  const listingId = params.get('listing');
  const [preview, setPreview] = useState<MarketPreview | null>(null);

  const [char, setChar] = useState<CharacterDetail | null>(null);
  const [nicknameInput, setNicknameInput] = useState("");
  const [askNickname, setAskNickname] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [giftProducts, setGiftProducts] = useState<Record<string, NftGiftCatalogItem>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const requestedProducts = useRef(new Set<string>());

  // 선물 카드에 필요한 상품 정보만 한 번씩 가져온다. 실패해도 재요청하지 않는다 (카드는 제목 없이도 표시).
  useEffect(() => {
    const missing = Array.from(new Set(messages.map(m => m.gift?.status === 'confirmed' ? m.gift.productId : undefined)
      .filter((id): id is string => Boolean(id) && !requestedProducts.current.has(id!))));
    if (!missing.length) return;
    for (const id of missing) requestedProducts.current.add(id);
    let active = true;
    void Promise.all(missing.map(async id => [id, await nftGifts.detail(id).catch(() => null)] as const)).then(found => {
      if (!active) return;
      setGiftProducts(prev => Object.assign({}, prev, Object.fromEntries(found.filter(([, p]) => p).map(([id, p]) => [id, p!]))));
    });
    return () => { active = false; };
  }, [messages]);

  // 확정 전 선물이 있으면 이력을 다시 읽어 상태를 갱신한다 (서버 복구 루프는 30초 주기, 최대 3분).
  useEffect(() => {
    if (preview || !char || episodeId || !messages.some(isPendingGift)) return;
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      try {
        const history = await backend.getMessages(char.id);
        const byId = new Map(history.map(m => [m.id, m.gift] as const));
        setMessages(prev => prev.map(m => m.id && byId.has(m.id) ? { ...m, gift: byId.get(m.id) } : m));
      } catch { /* 다음 주기에 다시 시도 */ }
      if (attempts >= 18) clearInterval(timer);
    }, 10000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, char, episodeId, messages.some(isPendingGift)]);

  useEffect(() => {
    let active = true;
    setHistoryLoaded(false);
    setChar(null);
    startedRef.current = false;
    (async () => {
      try {
        if (listingId) {
          const selected = await market.preview(listingId);
          if (!active) return;
          setPreview(selected);
          setChar({ id: 0, name: selected.character.name, birthday: null, age: 0, relationshipType: '', gender: '',
            summary: selected.character.summary ?? null, appearance: null, personality: null, speechStyles: [],
            profileImageUrl: selected.character.imageUrl ?? null, callName: null, soulTrained: false });
          const pending = pendingPreviewMessages(listingId);
          setAskNickname(false); setMessages(pending ? pending.slice(0, -1) : []); setInput(pending?.at(-1)?.content ?? ''); setError(null);
          return;
        }
        setPreview(null);
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
        const detail = await backend.getCharacter(id);
        if (!active) return;
        setChar(detail);
        setAskNickname(!detail.callName);
        let history = episodeId
          ? await backend.getEpisodeMessages(id, episodeId)
          : await backend.getMessages(id);
        if (!active) return;
        if (!episodeId && history.length === 0) {
          const pending = prepareChatRequest(id, 'greeting', 'greeting');
          history = [await backend.ensureGreeting(id, pending.requestId)];
          clearChatRequest(id, 'greeting', pending.requestId);
        } else if (!episodeId) {
          const pending = getPendingChatRequest(id, 'greeting');
          if (pending) clearChatRequest(id, 'greeting', pending.requestId);
        }
        if (!active) return;
        setMessages(history.map(toMsg));
        const pending = getPendingChatRequest(id, episodeId);
        if (pending) setInput(pending.content);
        setHistoryLoaded(true);
        scrollDown();
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "불러오지 못했어요. 다시 시도해주세요.");
      }
    })();
    return () => { active = false; };
  }, [router, episodeId, listingId]);

  // 에피소드에서 starter 들고 진입 시 자동 발화
  useEffect(() => {
    if (starter && char && char.callName && historyLoaded && !preview && !startedRef.current) {
      startedRef.current = true;
      const remaining = new URLSearchParams(params.toString());
      remaining.delete('starter');
      router.replace(`/chat?${remaining.toString()}`, { scroll: false });
      if (!getPendingChatRequest(char.id, episodeId)) void send(starter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [starter, char, historyLoaded, preview]);

  function scrollDown() {
    setTimeout(
      () => scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight),
      60,
    );
  }

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim();
    if (!text || busy || !char || (!preview && !historyLoaded)) return;
    setInput("");
    setBusy(true);
    setError(null);

    const base: Msg[] = [...messages, { role: "user", content: text }];
    setMessages([...base, { role: "assistant", content: "" }]); // 타이핑 버블
    scrollDown();

    let requestId: string | undefined;
    try {
      if (preview) {
        const reply = await market.turn(preview.listing.id, base);
        setMessages([...base, { role: 'assistant', content: reply.content }]);
        return;
      }
      const pending = prepareChatRequest(char.id, episodeId, text);
      requestId = pending.requestId;
      const reply = episodeId
        ? await backend.sendEpisodeMessage(char.id, episodeId, text, requestId)
        : await backend.sendMessage(char.id, text, requestId);
      clearChatRequest(char.id, episodeId, requestId);
      setMessages(messages.some(message => message.id === reply.id) ? messages : [...base, toMsg(reply)]);
    } catch (e) {
      if (requestId && e instanceof ApiError && [400, 402, 403, 404, 422].includes(e.status)) clearChatRequest(char.id, episodeId, requestId);
      setMessages(messages);
      setInput(preview && e instanceof MarketRequestError && e.code === 'TURN_COMPLETED' ? '' : text);
      setError(e instanceof Error ? e.message : "메시지 전송 실패");
    } finally {
      setBusy(false);
      scrollDown();
    }
  }

  async function saveNickname() {
    if (!char || !nicknameInput.trim()) return;
    try {
      const updated = await backend.setCallName(char.id, nicknameInput.trim());
      setChar(updated); setAskNickname(false);
    } catch (e) { setError(e instanceof Error ? e.message : '저장하지 못했어요.'); }
  }

  async function buy() {
    if (!preview || busy) return;
    setBusy(true); setError(null);
    try {
      const character = await purchaseCharacter(preview.listing);
      setActiveCharacterId(character.id);
      router.replace('/chat');
    } catch (e) {
      setError(e instanceof Error ? e.message : '구매를 완료하지 못했어요.');
    } finally { setBusy(false); }
  }

  if (error && !char) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100dvh", padding: 24 }}>
        <div className="body2" style={{ color: "var(--gray-500)", textAlign: "center" }}>
          {error}
          <br />
        </div>
      </div>
    );
  }
  if (!char) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
      {/* 헤더 */}
      <header className="topbar" style={{ borderBottom: "1px solid var(--gray-100)" }}>
        <button
          className="nav-btn nav-prev"
          onClick={() => router.push(preview ? `/community/detail?listing=${encodeURIComponent(preview.listing.id)}` : episodeId ? "/episode" : "/home")}
        >
          <Icon name="chevron-left" size={24} />
        </button>
        <span
          className="headline1"
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          {char.name}
          {episodeTitle && (
            <span className="point-badge" style={{ fontSize: 11 }}>
              {episodeTitle}
            </span>
          )}
        </span>
        <button
          className="nav-btn"
          style={{ color: "var(--gray-700)", display: "flex" }}
          onClick={() => preview ? void buy() : router.push("/edit")}
          disabled={busy}
          title={preview ? '구매' : '캐릭터 편집'}
        >
          {preview ? '구매' : <Icon name="menu" size={22} />}
        </button>
      </header>

      {/* 메시지 — 캐릭터 응답은 줄바꿈마다 말풍선 분리 (톡처럼 여러 번 보낸 느낌) */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
        {preview && <p className="caption" style={{ color: 'var(--gray-500)' }}>
          미리보기 {preview.previewTurns}회 · 개인 이용권 {formatPrice(preview.listing.priceMist)}
        </p>}
        {messages.map((m, i) => {
          const isUser = m.role === "user";
          const lines =
            isUser || !m.content
              ? [m.content]
              : m.content.split("\n").map((l) => l.trim()).filter(Boolean);
          return (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: isUser ? "flex-end" : "flex-start",
                gap: 4,
                marginBottom: 10,
              }}
            >
              {lines.map((line, j) => (
                <div
                  key={j}
                  className={`bubble ${isUser ? "user" : "char"}`}
                  style={{ maxWidth: 240 }}
                >
                  {line || (
                    <span className="typing">
                      <span />
                      <span />
                      <span />
                    </span>
                  )}
                </div>
              ))}
              {m.gift && (m.gift.status === 'confirmed' || PENDING_GIFT.has(m.gift.status)) && (
                <GiftCard gift={m.gift} product={m.gift.productId ? giftProducts[m.gift.productId] : undefined} onOpen={() => router.push('/my/gifts')} />
              )}
            </div>
          );
        })}
      </div>

      {/* 요청 실패 안내 — 실제로 실패한 작업에 맞는 메시지를 표시한다. */}
      {error && char && (
        <div
          role="alert"
          style={{
            background: "var(--gray-900)",
            color: "var(--gray-300)",
            fontSize: 12,
            fontWeight: 500,
            textAlign: "center",
            padding: "10px 16px",
          }}
        >
          {error}
        </div>
      )}

      {/* 입력바 */}
      <div className="chat-inputbar">
        <input
          className="input"
          style={{ flex: 1, borderRadius: 999 }}
          placeholder={`${char.name}에게 메시지`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) =>
            e.key === "Enter" && !e.nativeEvent.isComposing && send()
          }
          disabled={askNickname || (!preview && !historyLoaded)}
        />
        <button className="send-btn" onClick={() => send()} disabled={busy || askNickname || (!preview && !historyLoaded)}>
          <Icon name="send" size={18} />
        </button>
      </div>

      {/* 호칭 팝업 (figma chat-pop) — 백엔드 callName */}
      {askNickname && (
        <div className="dim">
          <div className="popup">
            <div className="headline1" style={{ marginBottom: 6 }}>
              {char.name}(이)가 유저 님을 뭐라고 부를까요?
            </div>
            <div className="caption" style={{ color: "var(--gray-500)", marginBottom: 18 }}>
              이름을 입력해주세요
            </div>
            <input
              className="input"
              placeholder="예: 자기야, 은우야, 야"
              value={nicknameInput}
              onChange={(e) => setNicknameInput(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.nativeEvent.isComposing &&
                  nicknameInput.trim()
                ) {
                  void saveNickname();
                }
              }}
              autoFocus
            />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button
                className="send-btn"
                disabled={!nicknameInput.trim()}
                onClick={() => void saveNickname()}
              >
                <Icon name="send" size={18} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense>
      <ChatInner />
      {/* 페이지 전용 스타일 — globals.css는 원본 유지 원칙에 따라 손대지 않는다. */}
      <style>{`
        .gift-card {
          margin-top: 6px; max-width: 260px; width: 100%; padding: 12px; border-radius: 8px;
          border: 1px solid var(--key-100); background: var(--key-50);
          animation: gift-pop 360ms var(--ease);
        }
        .gift-pending { display: flex; align-items: center; gap: 10px; border-style: dashed; }
        .gift-spinner {
          width: 18px; height: 18px; flex: 0 0 auto; border-radius: 50%;
          border: 2px solid var(--key-100); border-top-color: var(--key);
          animation: gift-spin 900ms linear infinite;
        }
        .gift-hero {
          display: flex; gap: 12px; align-items: center; width: 100%; padding: 0; border: 0;
          background: transparent; text-align: left; cursor: pointer; font: inherit; color: inherit;
        }
        .gift-image {
          width: 64px; height: 64px; flex: 0 0 auto; border-radius: 4px; object-fit: cover;
          background: var(--orange-100); display: block;
        }
        .gift-reason { margin: 10px 0 0; color: var(--gray-800); }
        .gift-actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
        .gift-actions .chip { text-decoration: none; }
        @keyframes gift-pop {
          from { opacity: 0; transform: translateY(6px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes gift-spin { to { transform: rotate(360deg); } }
      `}</style>
    </Suspense>
  );
}
