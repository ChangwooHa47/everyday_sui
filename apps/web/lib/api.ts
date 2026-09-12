// Spring 백엔드(everday_project_backend) 클라이언트.
// 모든 응답은 { success, data, message } 래핑 — api()가 언랩해서 data만 돌려준다.
// 운영에서는 검증된 사용자 세션을 사용한다.

// Original Spring product contracts; the Node gateway verifies wallet sessions.
// A fresh checkout must never silently connect to the old deployed service.
import { apiUrl } from './web3/config';
const BASE = apiUrl;

const DEMO_EMAIL = "demo@everyday.app";
const DEMO_PASSWORD = "demo1234!";
const TOKEN_KEY = "everyday.v2.jwt";

// ── 백엔드 응답 타입 ──
import type { CharacterSummary, ProductDraft, PhotoJob, LicenseBinding, PhotoPaymentTransaction } from '@everyday/contracts';
export type { CharacterSummary } from '@everyday/contracts';

import type { CharacterDetail, ChatMessage, InterviewQuestion, InterviewAnswer, PhotoItem, CompileResult, EpisodeItem, EpisodeStart, PhotoConcept, MyPage } from '@everyday/contracts';
export type { CharacterDetail, ChatMessage, InterviewQuestion, InterviewAnswer, PhotoItem, CompileResult, EpisodeItem, EpisodeStart, PhotoConcept, MyPage } from '@everyday/contracts';

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

async function login(): Promise<string> {
  let res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
  });
  if (!res.ok) {
    // 데모 계정이 없으면 만들어서 진행
    await fetch(`${BASE}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
    });
    res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
    });
  }
  const json = await res.json();
  if (!json.success) throw new Error(json.message ?? "로그인 실패");
  const token = json.data.accessToken as string;
  localStorage.setItem(TOKEN_KEY, token);
  return token;
}

export async function ensureAuth(): Promise<string> {
  if (process.env.NEXT_PUBLIC_LEGACY_BASELINE !== '1') {
    try { return await (await import('./wallet-auth')).restoreWalletToken(); }
    catch (error) { if (typeof window !== 'undefined' && window.location.pathname !== '/') window.location.replace('/'); throw error; }
  }
  return getToken() ?? login();
}

// ── 공통 fetch ──
export class ApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
async function api<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const token = await ensureAuth();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  if (res.status === 401 && process.env.NEXT_PUBLIC_LEGACY_BASELINE !== '1') {
    if (typeof window !== 'undefined' && window.location.pathname !== '/') window.location.replace('/');
    throw new Error('다시 로그인해주세요.');
  }
  if (res.status === 401 && !retried) {
    // 토큰 만료 → 재로그인 후 1회 재시도
    localStorage.removeItem(TOKEN_KEY);
    return api<T>(path, init, true);
  }
  if (!res.ok) throw new ApiError(res.status, res.status === 402 ? 'SUI 결제가 필요해요.' : '요청을 처리하지 못했어요. 다시 시도해주세요.');
  const json = await res.json();
  if (!json.success) throw new Error(json.message ?? `요청 실패 (${res.status})`);
  return json.data as T;
}

// ── 캐릭터 ──
export const backend = {
  licenseBinding: (id: number) => api<LicenseBinding | null>(`/api/library/${id}/license`),
  productDraft: (id: number) => api<ProductDraft>(`/api/characters/${id}/product-draft`),
  importLicense: (listingId: string, licenseId: string) => api<CharacterDetail>('/api/library', {
    method: 'POST', body: JSON.stringify({ listingId, licenseId }),
  }),
  listCharacters: () => api<CharacterSummary[]>("/api/characters"),
  getCharacter: (id: number | string) => api<CharacterDetail>(`/api/characters/${id}`),
  getPortraitStatus: (id: number | string) => api<{ status: 'draft' | 'pending' | 'running' | 'completed' | 'failed' | 'unknown' }>(`/api/characters/${id}/portrait-status`),
  startPortraits: (id: number, style: string) => api<{ status: string }>(`/api/characters/${id}/portraits`, {
    method: 'POST', body: JSON.stringify({ style }),
  }),
  updateCharacter: (
    id: number | string,
    patch: { appearance?: string; personality?: string; speechStyles?: string[] },
  ) => api<CharacterDetail>(`/api/characters/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  setCallName: (id: number | string, callName: string) =>
    api<CharacterDetail>(`/api/characters/${id}/call-name`, {
      method: "PATCH",
      body: JSON.stringify({ callName }),
    }),
  trainFace: (id: number | string) =>
    api<CharacterDetail>(`/api/characters/${id}/train-face`, { method: "POST" }),

  // 생성 플로우
  interview: (body: {
    relationshipType: string;
    gender: string;
    freeText?: string;
    previousAnswers?: InterviewAnswer[];
  }) => api<InterviewQuestion>("/api/characters/interview", { method: "POST", body: JSON.stringify(body) }),
  compile: (body: {
    requestId?: string;
    relationshipType: string;
    gender: string;
    freeText?: string;
    interviewAnswers?: InterviewAnswer[];
    name: string;
    birthday?: string; // yyyy-MM-dd
    deferPortraitGeneration?: boolean;
  }) => api<CompileResult>("/api/characters/compile", { method: "POST", body: JSON.stringify(body) }),
  selectPortrait: (characterId: number | string, photoId: number) =>
    api<CharacterDetail>(`/api/characters/${characterId}/select-portrait`, {
      method: "POST",
      body: JSON.stringify({ photoId }),
    }),

  // 대화 조회는 읽기 전용이며 첫 인사는 명시적인 요청으로 생성한다.
  getMessages: (characterId: number | string) =>
    api<ChatMessage[]>(`/api/characters/${characterId}/messages`),
  getHistory: (characterId: number | string) =>
    api<ChatMessage[]>(`/api/characters/${characterId}/messages/history`),
  ensureGreeting: (characterId: number | string, requestId: string) =>
    api<ChatMessage>(`/api/characters/${characterId}/greeting`, { method: 'POST', body: JSON.stringify({ requestId }) }),
  sendMessage: (characterId: number | string, content: string, requestId?: string) =>
    api<ChatMessage>(`/api/characters/${characterId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, requestId }),
    }),

  // 에피소드
  listEpisodes: (characterId?: number | string) => api<EpisodeItem[]>(characterId === undefined ? '/api/episodes' : `/api/characters/${characterId}/episodes`),
  startEpisode: (characterId: number | string, episodeId: number | string) =>
    api<EpisodeStart>(`/api/characters/${characterId}/episodes/${episodeId}/start`, { method: "POST" }),
  getEpisodeMessages: (characterId: number | string, episodeId: number | string) =>
    api<ChatMessage[]>(`/api/characters/${characterId}/episodes/${episodeId}/messages`),
  sendEpisodeMessage: (characterId: number | string, episodeId: number | string, content: string, requestId?: string) =>
    api<ChatMessage>(`/api/characters/${characterId}/episodes/${episodeId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, requestId }),
    }),

  // 포토부스·갤러리
  photoPaymentTransaction: (characterId: number | string) => api<PhotoPaymentTransaction>(`/api/characters/${characterId}/photo-payment-transaction`, { method: 'POST' }),
  startPhotoJob: (characterId: number | string, requestId: string, paymentDigest: string, photo: { concept?: string; customPrompt?: string }) =>
    api<PhotoJob>(`/api/characters/${characterId}/photo-jobs`, { method: 'POST', body: JSON.stringify({ requestId, paymentDigest, photo }) }),
  photoJob: (requestId: string) => api<PhotoJob>(`/api/photo-jobs/${requestId}`),
  listPhotoConcepts: () => api<PhotoConcept[]>("/api/photo/concepts"),
  getGallery: (characterId: number | string) => api<PhotoItem[]>(`/api/characters/${characterId}/gallery`),

  // 마이페이지
  getMe: () => api<MyPage>("/api/me"),
};

// ── 활성 캐릭터 id (클라이언트 상태) ──
const ACTIVE_KEY = "everyday.v2.activeCharacterId";
const REQUEST_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function activeKey() {
  if (process.env.NEXT_PUBLIC_LEGACY_BASELINE === '1') return ACTIVE_KEY;
  try {
    const session = JSON.parse(sessionStorage.getItem('everyday.session.v1') ?? 'null');
    if (/^0x[0-9a-f]{64}$/.test(session?.address) && Date.parse(session.expiresAt) > Date.now()) return `${ACTIVE_KEY}.${session.address}`;
  } catch {}
  return null;
}
function clientStateKey(suffix: string) {
  const identity = activeKey();
  if (!identity) throw Error('로그인해주세요.');
  return `${identity}.${suffix}`;
}
export function getActiveCharacterId(): number | null {
  if (typeof window === "undefined") return null;
  const key = activeKey(), v = key ? localStorage.getItem(key) : null;
  const id = Number(v);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
export function setActiveCharacterId(id: number) {
  const key = activeKey();
  if (key && Number.isSafeInteger(id) && id > 0) localStorage.setItem(key, String(id));
}

type PendingChatRequest = { requestId: string; content: string };
function chatRequestKey(characterId: number, episodeId: string | null) {
  return clientStateKey(`message.${characterId}.${episodeId ?? 'regular'}`);
}
export function getPendingChatRequest(characterId: number, episodeId: string | null): PendingChatRequest | null {
  const saved = sessionStorage.getItem(chatRequestKey(characterId, episodeId));
  if (!saved) return null;
  const value = JSON.parse(saved);
  if (!value || !REQUEST_UUID_PATTERN.test(value.requestId)
    || typeof value.content !== 'string' || !value.content.length) throw Error('이전 메시지의 전송 요청을 확인할 수 없어요.');
  return value;
}
export function prepareChatRequest(characterId: number, episodeId: string | null, content: string) {
  const pending = getPendingChatRequest(characterId, episodeId);
  if (pending && pending.content !== content) throw Error('이전 메시지의 전송 결과를 먼저 확인해주세요.');
  const request = pending ?? { requestId: crypto.randomUUID(), content };
  sessionStorage.setItem(chatRequestKey(characterId, episodeId), JSON.stringify(request));
  return request;
}
export function clearChatRequest(characterId: number, episodeId: string | null, requestId: string) {
  if (getPendingChatRequest(characterId, episodeId)?.requestId === requestId)
    sessionStorage.removeItem(chatRequestKey(characterId, episodeId));
}

type CompileInput = Parameters<typeof backend.compile>[0];
type PendingCompile = CompileInput & { requestId: string };
function compileRequestKey() {
  return clientStateKey('compile');
}
export function getPendingCompile(): PendingCompile | null {
  const stored = sessionStorage.getItem(compileRequestKey());
  if (!stored) return null;
  const pending = JSON.parse(stored);
  if (!pending || !REQUEST_UUID_PATTERN.test(pending.requestId)
    || typeof pending.name !== 'string' || typeof pending.relationshipType !== 'string' || typeof pending.gender !== 'string'
    || (pending.freeText !== undefined && typeof pending.freeText !== 'string')
    || (pending.birthday !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(pending.birthday))
    || (pending.interviewAnswers !== undefined && (!Array.isArray(pending.interviewAnswers)
      || pending.interviewAnswers.some((answer: { category?: unknown; question?: unknown; answer?: unknown }) => !answer
        || typeof answer.category !== 'string' || typeof answer.question !== 'string' || typeof answer.answer !== 'string'))))
    throw Error('이전 캐릭터 생성 요청을 확인할 수 없어요.');
  return pending;
}
export function prepareCompileRequest(input: Omit<CompileInput, 'requestId'>): PendingCompile {
  const pending = getPendingCompile();
  if (pending) {
    const { requestId: _requestId, ...previous } = pending;
    if (JSON.stringify(previous) !== JSON.stringify(input)) throw Error('이전 캐릭터 생성 요청의 내용을 먼저 확인해주세요.');
    return pending;
  }
  const request = { ...input, requestId: crypto.randomUUID() };
  sessionStorage.setItem(compileRequestKey(), JSON.stringify(request));
  return request;
}
export function clearCompileRequest(requestId: string) {
  if (getPendingCompile()?.requestId === requestId) sessionStorage.removeItem(compileRequestKey());
}

type IncompleteCharacter = { characterId: number; photoFeelText: string; photoFeelChip: string | null };
function incompleteCharacterKey() {
  return clientStateKey('incompleteCharacter');
}
export function getIncompleteCharacter(): IncompleteCharacter | null {
  const stored = sessionStorage.getItem(incompleteCharacterKey());
  if (!stored) return null;
  const value = JSON.parse(stored);
  if (!value || !Number.isSafeInteger(value.characterId) || value.characterId <= 0 || typeof value.photoFeelText !== 'string'
    || (value.photoFeelChip !== null && typeof value.photoFeelChip !== 'string')) throw Error('이전 캐릭터 생성 요청을 확인할 수 없어요.');
  return value;
}
export function saveIncompleteCharacter(value: IncompleteCharacter) {
  sessionStorage.setItem(incompleteCharacterKey(), JSON.stringify(value));
}
export function clearIncompleteCharacter(characterId?: number) {
  if (characterId === undefined || getIncompleteCharacter()?.characterId === characterId) sessionStorage.removeItem(incompleteCharacterKey());
}
