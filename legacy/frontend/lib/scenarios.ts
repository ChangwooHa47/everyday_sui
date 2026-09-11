// FS-04 기본 제공 시나리오 (figma episode 화면 기준)

export interface Scenario {
  id: string;
  title: string;
  scene: string; // 장면 지문 (system 주입 + 화면 표시)
  starters: string[]; // "먼저 말을 걸어주세요" 선택지
  emoji: string;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "first-date",
    title: "첫 데이트",
    scene: "카페에 마주앉은 두 사람, 어색한 침묵이 흐른다",
    starters: ["인천 앞바다의 반대말이 뭔지 아세요?", "오늘 좀 덥네요"],
    emoji: "☕",
  },
  {
    id: "night-walk",
    title: "밤 산책",
    scene: "밤 11시, 한강 공원. 시원한 바람이 불고 멀리 다리 불빛이 반짝인다",
    starters: ["와 바람 진짜 좋다", "우리 라면 먹고 갈래?"],
    emoji: "🌙",
  },
  {
    id: "after-fight",
    title: "싸운 다음 날",
    scene: "어제 사소한 일로 다퉜다. 하루 종일 연락이 없다가 밤에 메시지를 보내려 한다",
    starters: ["자니...?", "어제는 내가 좀 심했지"],
    emoji: "🌧️",
  },
];
