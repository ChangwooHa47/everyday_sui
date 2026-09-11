// 나노바나나 Pro 각도 생성 (로컬 dev 전용 — CLI 경유)
// REST 키 계정엔 nano-banana가 없어서, hf CLI(OAuth 계정, nano-banana 보유)를 서버가 직접 호출.
// 레퍼런스 1장 → 정면/측면/클로즈업/원거리 4각도(같은 얼굴 유지) → 공개 CDN URL 반환.
// 반환된 URL은 공개라 이후 학습(REST)에서 계정 상관없이 사용 가능.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const exec = promisify(execFile);
const HF = join(homedir(), ".local/bin/hf");

// 기본 4각도 (같은 인물 강제 프롬프트)
const ANGLES = [
  { key: "front", prompt: "the same exact person, clean front-facing portrait looking straight at camera, plain light gray studio background, sharp clear face, upper body" },
  { key: "side", prompt: "the same exact person, side profile three-quarter angle view, plain gray background, clear face, upper body" },
  { key: "profile", prompt: "the same exact person, full side profile view, head facing 90 degrees to the side, plain gray background, clear face outline, upper body" },
  { key: "far", prompt: "the same exact person, full body shot from far away, standing, entire figure visible, natural setting" },
];

export const maxDuration = 300;

// hf 출력의 마지막 http URL 추출
function parseUrl(stdout: string): string | null {
  const m = stdout.trim().match(/https?:\/\/\S+/g);
  return m ? m[m.length - 1] : null;
}

async function genAngle(localPath: string, prompt: string): Promise<string | null> {
  try {
    const { stdout } = await exec(
      HF,
      ["generate", "create", "nano_banana_pro", "--image", localPath, "--prompt", prompt, "--aspect-ratio", "3:4", "--wait", "--wait-timeout", "5m"],
      { timeout: 300_000, maxBuffer: 1024 * 1024 },
    );
    return parseUrl(stdout);
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const { imageUrl, angles }: { imageUrl: string; angles?: string[] } = await req.json();
  if (!imageUrl) return Response.json({ error: "imageUrl 필요" }, { status: 400 });

  // 레퍼런스 다운로드 → 임시 파일
  const tmp = join(tmpdir(), `nano-ref-${randomUUID()}.png`);
  try {
    const buf = Buffer.from(await (await fetch(imageUrl)).arrayBuffer());
    await writeFile(tmp, buf);

    const targets = angles?.length
      ? ANGLES.filter((a) => angles.includes(a.key))
      : ANGLES;

    // 4각도 병렬
    const results = await Promise.all(targets.map((a) => genAngle(tmp, a.prompt)));
    const urls = results.filter((u): u is string => Boolean(u));

    if (urls.length === 0) {
      return Response.json({ error: "생성 실패 (CLI 인증/크레딧 확인)", urls: [] }, { status: 500 });
    }
    return Response.json({ urls });
  } catch (e) {
    return Response.json({ error: String(e), urls: [] }, { status: 500 });
  } finally {
    await unlink(tmp).catch(() => {});
  }
}
