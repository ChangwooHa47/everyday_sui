// 프로토타입용 클라이언트 상태 (localStorage) — 실서비스에선 DB
// v2: 멀티 캐릭터. 캐릭터 배열 + activeId, 대화/기억/호칭/인사는 캐릭터별 분리.

import type { CharacterProfile } from "./character";

export interface StoredCharacter extends CharacterProfile {
  id: string;
  emoji: string; // 이미지 없을 때 아바타 placeholder
  birth: string;
  gender: string;
  createdAt: number;
  imageUrl?: string; // Higgsfield 초상 (FS-01)
  appearancePrompt?: string; // 사진 생성용 고정 외모 블록 (영어)
  seed?: number; // 사진 생성 seed (스타일 일관성)
  customReferenceId?: string; // Soul ID — 진짜 인물 일관성 (학습으로 생성한 UUID)
  portraitOptions?: string[]; // 생성 때 뽑은 초상 후보들 (Soul 학습 소스)
  trainStatus?: "not_ready" | "in_progress" | "completed" | "failed"; // 학습 진행
  trainJobId?: string; // 학습 job id (재진입 시 폴링 재개용)
  trainStartedAt?: number; // 학습 시작 시각 (경과·남은시간 표시용)
}

export type ChatMsg = { role: "user" | "assistant"; content: string };

export interface Photo {
  url: string;
  label: string; // 장면 이름 (예: 카페 데이트)
  createdAt: number;
}

const NS = "everyday.v2";
const K = {
  characters: `${NS}.characters`,
  activeId: `${NS}.activeId`,
  msgs: (id: string) => `${NS}.c.${id}.messages`,
  memory: (id: string) => `${NS}.c.${id}.memory`,
  nickname: (id: string) => `${NS}.c.${id}.nickname`,
  greeting: (id: string) => `${NS}.c.${id}.greeting`,
  photos: (id: string) => `${NS}.c.${id}.photos`,
};

// v1 키 청소 (구조 변경으로 리셋)
const LEGACY_KEYS = [
  "everyday.character",
  "everyday.nickname",
  "everyday.messages",
  "everyday.memory",
  "everyday.greeting",
];

function get<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function set(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

let cleaned = false;
function cleanupLegacy() {
  if (cleaned || typeof window === "undefined") return;
  LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
  cleaned = true;
}

export const store = {
  // ── 캐릭터 목록 ──
  listCharacters(): StoredCharacter[] {
    cleanupLegacy();
    return get<StoredCharacter[]>(K.characters) ?? [];
  },
  addCharacter(c: StoredCharacter) {
    const list = store.listCharacters();
    set(K.characters, [...list, c]);
    set(K.activeId, c.id);
  },
  updateCharacter(id: string, patch: Partial<StoredCharacter>) {
    const list = store.listCharacters().map((c) =>
      c.id === id ? { ...c, ...patch } : c,
    );
    set(K.characters, list);
  },
  removeCharacter(id: string) {
    const list = store.listCharacters().filter((c) => c.id !== id);
    set(K.characters, list);
    [K.msgs(id), K.memory(id), K.nickname(id), K.greeting(id), K.photos(id)].forEach(
      (k) => localStorage.removeItem(k),
    );
    if (store.getActiveId() === id) {
      set(K.activeId, list[0]?.id ?? "");
    }
  },

  // ── 활성 캐릭터 ──
  getActiveId(): string | null {
    return get<string>(K.activeId) || null;
  },
  setActiveId(id: string) {
    set(K.activeId, id);
  },
  getActive(): StoredCharacter | null {
    const list = store.listCharacters();
    if (list.length === 0) return null;
    const id = store.getActiveId();
    return list.find((c) => c.id === id) ?? list[0];
  },

  // ── 캐릭터별 상태 ──
  getMessages(id: string): ChatMsg[] {
    return get<ChatMsg[]>(K.msgs(id)) ?? [];
  },
  setMessages(id: string, m: ChatMsg[]) {
    set(K.msgs(id), m);
  },
  getMemory(id: string): string {
    return get<string>(K.memory(id)) ?? "";
  },
  setMemory(id: string, m: string) {
    set(K.memory(id), m);
  },
  getNickname(id: string): string | null {
    return get<string>(K.nickname(id));
  },
  setNickname(id: string, n: string) {
    set(K.nickname(id), n);
  },
  getGreeting(id: string): string | null {
    return get<string>(K.greeting(id));
  },
  setGreeting(id: string, g: string) {
    set(K.greeting(id), g);
  },

  // ── 사진 갤러리 (FS-05 결과 누적) ──
  getPhotos(id: string): Photo[] {
    return get<Photo[]>(K.photos(id)) ?? [];
  },
  addPhoto(id: string, photo: Photo) {
    set(K.photos(id), [photo, ...store.getPhotos(id)]); // 최신순
  },
  removePhoto(id: string, url: string) {
    set(
      K.photos(id),
      store.getPhotos(id).filter((p) => p.url !== url),
    );
  },
};
