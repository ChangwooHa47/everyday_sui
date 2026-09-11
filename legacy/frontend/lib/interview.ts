// AI 인터뷰 공유 타입 — 캐릭터 생성 질문 플로우
// 3 페이즈: 외모(appearance) → 분위기·스타일(style) → 성격(personality)
// 외모/스타일 = 선택지 3~5개(칩 그리드), 성격 = A/B. 어느 질문이든 직접 입력도 가능.

export type Phase = "appearance" | "style" | "personality";

export interface InterviewQuestion {
  question: string;
  options: string[]; // 외모/스타일: 3~5개, 성격: 2개
  dimension: string; // 이 질문이 채우는 세부 차원
  phase: Phase;
}

export interface AnsweredQA extends InterviewQuestion {
  picked: string; // 선택한 옵션 or 직접 입력 텍스트. 스킵은 "skip"
}

export const PHASE_LABEL: Record<Phase, string> = {
  appearance: "외모",
  style: "분위기·스타일",
  personality: "성격",
};
