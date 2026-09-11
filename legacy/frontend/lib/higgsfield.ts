// Higgsfield Cloud API 클라이언트 (서버 전용) — Soul 2.0 신규 엔드포인트.
// 제출: POST /v1/text2image/soul  { params }  → { id, jobs[] }
// 폴링: GET /v1/job-sets/{id} → jobs[].status / jobs[].results.raw.url
// 인증: Authorization: Key {KEY_ID}:{KEY_SECRET} — MCP(Plus 플랜)와 별개 결제풀!
//
// 구버전(/higgsfield-ai/soul/*, aspect_ratio·resolution·status_url)은 폐기.
// 신규는 style_strength / custom_reference_strength / image_reference 를 지원해
// 웹(higgsfield.ai) 결과에 훨씬 가깝게 나옴.

const BASE = "https://platform.higgsfield.ai";

function authHeader() {
  const id = process.env.HIGGSFIELD_KEY_ID;
  const secret = process.env.HIGGSFIELD_KEY_SECRET;
  if (!id || !secret) throw new Error("HIGGSFIELD_KEY_ID/SECRET 미설정");
  return `Key ${id}:${secret}`;
}

export interface SoulParams {
  prompt: string;
  width_and_height?: string; // "WxH" (기본 3:4 = "1536x2048")
  quality?: "720p" | "1080p";
  seed?: number;
  batch_size?: 1 | 4;
  style_id?: string; // 스타일 프리셋 UUID
  style_strength?: number; // 스타일 적용 강도 0~1 (웹은 이 값을 씀 — 필수 레버)
  custom_reference_id?: string; // Soul ID — 진짜 인물 일관성
  custom_reference_strength?: number; // Soul 반영 강도 0~1
  image_reference?: { type: "image_url"; image_url: string }; // 참조 이미지
  enhance_prompt?: boolean;
}

type JobStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "nsfw"
  | "failed"
  | "canceled";

interface Job {
  status: JobStatus;
  results?: { raw?: { url: string }; min?: { url: string } } | null;
}
interface JobSet {
  id: string;
  jobs: Job[];
}

const TERMINAL: JobStatus[] = ["completed", "failed", "nsfw", "canceled"];

/** Soul 텍스트→이미지 생성 요청 → 완료까지 폴링 → 이미지 URL 배열 반환 */
export async function generateSoul(
  params: SoulParams,
  { timeoutMs = 270_000, pollMs = 2_500 } = {},
): Promise<string[]> {
  const submit = await fetch(`${BASE}/v1/text2image/soul`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      params: {
        width_and_height: "1536x2048",
        quality: "1080p",
        batch_size: 1,
        enhance_prompt: true,
        ...params,
      },
    }),
  });
  if (!submit.ok) {
    throw new Error(`submit ${submit.status}: ${await submit.text()}`);
  }
  const { id }: JobSet = await submit.json();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/v1/job-sets/${id}`, {
      headers: { Authorization: authHeader() },
    });
    const data: JobSet = await res.json();
    const jobs = data.jobs ?? [];

    if (jobs.length > 0 && jobs.every((j) => TERMINAL.includes(j.status))) {
      const urls = jobs
        .filter((j) => j.status === "completed")
        .map((j) => j.results?.raw?.url)
        .filter((u): u is string => Boolean(u));
      if (urls.length > 0) return urls;
      // 전부 실패/NSFW
      const bad = jobs.find((j) => j.status !== "completed");
      throw new Error(`generation ${bad?.status ?? "failed"} (job-set ${id})`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`generation timeout (job-set ${id})`);
}

// ─────────────────────────────────────────────
// Soul 학습 (custom reference) — 인물 사진들로 진짜 얼굴 고정.
// POST /v1/custom-references { name, input_images:[{type:"image_url", image_url}] }
//   → { id, status }  (id = custom_reference_id, 생성에 --custom-reference-id로 사용)
// GET /v1/custom-references/{id} → status (not_ready→in_progress→completed/failed)
// 학습은 3~5분 → 제출/조회를 분리해 서버리스 타임아웃 회피.
// ─────────────────────────────────────────────
export type CustomReferenceStatus =
  | "not_ready"
  | "in_progress"
  | "completed"
  | "failed";

/** 학습 제출 → reference id 즉시 반환 (완료 대기 X) */
export async function submitCustomReference(
  name: string,
  imageUrls: string[],
): Promise<{ id: string; status: CustomReferenceStatus }> {
  const res = await fetch(`${BASE}/v1/custom-references`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      input_images: imageUrls.map((u) => ({ type: "image_url", image_url: u })),
    }),
  });
  if (!res.ok) throw new Error(`train submit ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return { id: d.id, status: d.status };
}

/** 학습 상태 조회 (클라가 폴링) */
export async function getCustomReference(
  id: string,
): Promise<{ id: string; status: CustomReferenceStatus }> {
  const res = await fetch(`${BASE}/v1/custom-references/${id}`, {
    headers: { Authorization: authHeader() },
  });
  if (!res.ok) throw new Error(`train status ${res.status}`);
  const d = await res.json();
  return { id: d.id, status: d.status };
}
