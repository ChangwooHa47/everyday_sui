// FS-01 인물 학습 (Soul 커스텀 레퍼런스)
// POST: 캐릭터 사진들로 학습 제출 → reference id 즉시 반환 (완료는 클라가 폴링)
// GET ?id=... : 학습 상태 조회

import { submitCustomReference, getCustomReference } from "@/lib/higgsfield";

interface TrainRequest {
  name: string;
  imageUrls: string[]; // 캐릭터 초상 후보들 (많을수록 좋음, 4장+ 권장)
}

export async function POST(req: Request) {
  const { name, imageUrls }: TrainRequest = await req.json();
  const urls = (imageUrls ?? []).filter(Boolean);
  if (urls.length < 2) {
    return Response.json(
      { error: "학습에는 사진이 최소 2장 필요해요" },
      { status: 400 },
    );
  }
  try {
    const { id, status } = await submitCustomReference(name || "character", urls);
    return Response.json({ id, status });
  } catch (e) {
    console.error("[train submit]", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id 필요" }, { status: 400 });
  try {
    const { status } = await getCustomReference(id);
    return Response.json({ id, status });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
