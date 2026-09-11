// 말투 A/B 테스트 — 위저드가 생성하는 것과 동일한 캐릭터로
// gpt-4o-mini vs gpt-4.1-mini 같은 대화를 돌려 톤 비교.
// 실행: npx tsx scripts/tone-test.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
try {
  for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

import OpenAI from "openai";
import {
  buildSystemText,
  SPEECH_STYLES,
  type CharacterProfile,
} from "../lib/character";

const client = new OpenAI();

// 위저드 출력과 동일한 형태 (썸 + 여우상 + 츤데레·장난끼 + 반말)
const speech = SPEECH_STYLES.find((s) => s.label === "반말")!;
const profile: CharacterProfile = {
  name: "도윤",
  relationship: "썸",
  age: 25,
  appearance: "여우상 얼굴. 매력적인 인상",
  personality: "츤데레, 장난끼 있는",
  speechStyle: `반말. 예시 톤: "${speech.preview}"`,
  speechExamples: speech.fewshot,
  background: "성별 남성. 사용자와의 관계: 썸",
};

const TURNS = [
  "뭐해",
  "나 오늘 회사에서 부장님한테 혼났어 ㅠ",
  "몰라 그냥 다 짜증나",
  "너는 오늘 뭐했는데?",
];

async function run(model: string) {
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  const out: string[] = [];
  for (const t of TURNS) {
    messages.push({ role: "user", content: t });
    const res = await client.chat.completions.create({
      model,
      max_completion_tokens: 512,
      messages: [
        {
          role: "system",
          content: buildSystemText(profile, "", { userNickname: "은우야" }),
        },
        ...messages,
      ],
    });
    const reply = res.choices[0]?.message?.content ?? "";
    messages.push({ role: "assistant", content: reply });
    out.push(reply);
  }
  return out;
}

async function main() {
  const models = ["gpt-4o-mini", "gpt-4.1-mini"];
  const results = await Promise.all(models.map(run));
  for (let i = 0; i < TURNS.length; i++) {
    console.log(`\n유저: ${TURNS[i]}`);
    models.forEach((m, mi) => {
      console.log(`  [${m}] ${results[mi][i].replace(/\n/g, " / ")}`);
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
