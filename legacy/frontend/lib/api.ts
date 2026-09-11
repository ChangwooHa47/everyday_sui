// Spring 백엔드(everday_project_backend) 클라이언트.
// 모든 응답은 { success, data, message } 래핑 — api()가 언랩해서 data만 돌려준다.
// 데모라 계정 UI 없이 데모 계정으로 자동 로그인한다.

// 데모 배포용: 프로덕션 빌드는 Render에 상시 배포된 백엔드로, 개발은 localhost.
// Render 무료 플랜은 15분 미사용 시 잠들어 첫 요청이 1분 정도 걸릴 수 있다.
const RENDER_BACKEND = "https://everyday-backend-os5a.onrender.com";
const BASE =
  process.env.NEXT_PUBLIC_API_BASE ??
  (process.env.NODE_ENV === "production" ? RENDER_BACKEND : "http://localhost:8080");

const DEMO_EMAIL = "demo@everyday.app";
const DEMO_PASSWORD = "demo1234!";
const TOKEN_KEY = "everyday.v2.jwt";

// ── 백엔드 응답 타입 ──
export interface CharacterSummary {
  id: number;
  name: string;
  age: number;
  gender: string;
  relationshipType: string;
  profileImageUrl: string | null;
}

export interface CharacterDetail {
  id: number;
  name: string;
  birthday: string | null;
  age: number;
  relationshipType: string;
  gender: string;
  summary: string | null;
  appearance: string | null;
  personality: string | null;
  speechStyles: string[];
  profileImageUrl: string | null;
  callName: string | null;
  soulTrained: boolean;
}

export interface ChatMessage {
  id: number;
  sender: "USER" | "AI";
  content: string;
  createdAt: string;
}

export interface InterviewQuestion {
  category: string;
  question: string;
  suggestedAnswers: string[];
  done: boolean;
}

export interface InterviewAnswer {
  category: string;
  question: string;
  answer: string;
}

export interface PhotoItem {
  id: number;
  imageUrl: string;
  concept: string | null;
  type: "PROFILE" | "PHOTOBOOTH";
  selected: boolean;
}

export interface CompileResult {
  character: CharacterDetail;
  candidatePortraits: PhotoItem[];
}

export interface EpisodeItem {
  id: number;
  code: string;
  title: string;
  emoji: string;
  description: string;
}

export interface EpisodeStart {
  characterEpisodeId: number;
  title: string;
  emoji: string;
  description: string;
  status: string;
  starters: string[];
}

export interface PhotoConcept {
  code: string;
  label: string;
}

export interface PhotoGeneration {
  photo: PhotoItem;
  remainingPoints: number;
}

export interface MyPage {
  id: number;
  email: string;
  points: number;
  subscriptionTier: string;
  characters: CharacterSummary[];
}

// ── 인증 ──
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
  return getToken() ?? login();
}

// ── 공통 fetch ──
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
  if (res.status === 401 && !retried) {
    // 토큰 만료 → 재로그인 후 1회 재시도
    localStorage.removeItem(TOKEN_KEY);
    return api<T>(path, init, true);
  }
  const json = await res.json();
  if (!json.success) throw new Error(json.message ?? `요청 실패 (${res.status})`);
  return json.data as T;
}

// ── 캐릭터 ──
export const backend = {
  listCharacters: () => api<CharacterSummary[]>("/api/characters"),
  getCharacter: (id: number | string) => api<CharacterDetail>(`/api/characters/${id}`),
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
    relationshipType: string;
    gender: string;
    freeText?: string;
    interviewAnswers?: InterviewAnswer[];
    name: string;
    birthday?: string; // yyyy-MM-dd
  }) => api<CompileResult>("/api/characters/compile", { method: "POST", body: JSON.stringify(body) }),
  selectPortrait: (characterId: number | string, photoId: number) =>
    api<CharacterDetail>(`/api/characters/${characterId}/select-portrait`, {
      method: "POST",
      body: JSON.stringify({ photoId }),
    }),

  // 채팅 (히스토리가 비어 있으면 GET이 첫 인사를 만들어 돌려준다)
  getMessages: (characterId: number | string) =>
    api<ChatMessage[]>(`/api/characters/${characterId}/messages`),
  sendMessage: (characterId: number | string, content: string) =>
    api<ChatMessage>(`/api/characters/${characterId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),

  // 에피소드
  listEpisodes: () => api<EpisodeItem[]>("/api/episodes"),
  startEpisode: (characterId: number | string, episodeId: number | string) =>
    api<EpisodeStart>(`/api/characters/${characterId}/episodes/${episodeId}/start`, { method: "POST" }),
  getEpisodeMessages: (characterId: number | string, episodeId: number | string) =>
    api<ChatMessage[]>(`/api/characters/${characterId}/episodes/${episodeId}/messages`),
  sendEpisodeMessage: (characterId: number | string, episodeId: number | string, content: string) =>
    api<ChatMessage>(`/api/characters/${characterId}/episodes/${episodeId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),

  // 포토부스·갤러리
  listPhotoConcepts: () => api<PhotoConcept[]>("/api/photo/concepts"),
  generatePhoto: (characterId: number | string, body: { concept?: string; customPrompt?: string }) =>
    api<PhotoGeneration>(`/api/characters/${characterId}/photos`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getGallery: (characterId: number | string) => api<PhotoItem[]>(`/api/characters/${characterId}/gallery`),

  // 마이페이지
  getMe: () => api<MyPage>("/api/me"),
};

// ── 활성 캐릭터 id (클라이언트 상태) ──
const ACTIVE_KEY = "everyday.v2.activeCharacterId";
export function getActiveCharacterId(): number | null {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(ACTIVE_KEY);
  return v ? Number(v) : null;
}
export function setActiveCharacterId(id: number) {
  localStorage.setItem(ACTIVE_KEY, String(id));
}
