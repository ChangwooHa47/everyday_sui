# Railway + Vercel 배포

저장소: https://github.com/ChangwooHa47/everyday_sui

하나의 저장소를 두 서비스에 연결한다. Node.js 24와 루트 package-lock.json을 사용한다.

## 1. Railway: PostgreSQL + API

1. 새 프로젝트에서 PostgreSQL 서비스를 추가한다.
2. 같은 프로젝트에 GitHub 저장소를 연결한 API 서비스를 추가한다. 브랜치는 `main`.
3. Root Directory는 저장소 루트(`/`)로 유지한다. `apps/api`로 바꾸면 공통 패키지를 빌드할 수 없다.
4. Settings에서 Config File 경로를 `/infra/railway.json`으로 설정한다.
5. 아래 변수를 설정한다. PostgreSQL 서비스 이름이 다르면 참조 이름도 바꾼다.

| 변수 | 값 |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — Railway의 서비스 변수 참조 |
| `PORT` | `3001` — Docker 이미지의 API_PORT와 동일하게 설정 |
| `API_HOST` | `0.0.0.0` |
| `API_PORT` | `3001` |
| `WEB_ORIGINS` | `https://실제-프로젝트.vercel.app` — 끝의 `/` 없이 정확한 Origin |
| `API_AUDIENCE` | `https://실제-API.up.railway.app` — 끝의 `/` 없이 설정 |
| `AGENT_GIFTS_ENABLED` | `0` |

6. Networking에서 Public Domain을 생성하고 target port를 `3001`로 설정한다. 생성된 주소를 `API_AUDIENCE`에 반영한다.
7. Vercel 주소가 확정되면 `WEB_ORIGINS`를 실제 주소로 바꾸고 재배포한다. 복수의 Origin은 공백 없이 쉼표로 구분한다. Preview 도메인은 자동으로 허용되지 않는다.

Dockerfile의 시작 명령은 `node apps/api/dist/server.js`다. 시작 시 DB 스키마를 멱등 적용하므로 별도 migration 명령은 필요 없다. 첫 배포는 API 단일 replica로 시작한다.
`/health/ready`는 DB 연결을 확인한다. Sui나 AI 제공자의 정상 동작을 증명하는 엔드포인트는 아니다.

## 2. Vercel: Next.js 웹

1. Add New Project에서 같은 GitHub 저장소를 가져온다.
2. Framework는 Next.js, Root Directory는 `apps/web`, Node.js는 `24.x`로 설정한다.
3. Root Directory 밖의 소스 파일을 빌드에 포함하는 옵션을 켠다. `packages/contracts`와 루트 lockfile에 필요하다.
4. `apps/web/vercel.json`의 install/build 명령을 사용한다. Output Directory는 Next.js 기본값을 유지한다.
5. `NEXT_PUBLIC_API_BASE`를 Railway의 HTTPS 주소로 설정한다. 끝의 `/`는 넣지 않는다.
6. 배포 후 Vercel의 실제 도메인을 Railway `WEB_ORIGINS`에 반영한다.

`NEXT_PUBLIC_*`는 빌드에 포함되므로 변경 후 Vercel을 재배포해야 한다. `EVERYDAY_STATIC_EXPORT`는 설정하지 않는다.

## 3. 실제 마켓 기능 활성화

API/웹 호스팅과 온체인 마켓의 준비 상태는 별개다. 미설정 기능은 기존 코드대로 요청을 거절한다.

- Move를 testnet에 배포한 뒤 정확히 같은 package ID를 Railway `SUI_MARKET_PACKAGE_ID`와 Vercel `NEXT_PUBLIC_SUI_PACKAGE_ID`에 설정한다. 임의의 예시 ID를 넣지 않는다.
- AI를 사용하려면 Railway에 `AI_ENDPOINT`, `AI_MODEL`, `AI_API_KEY`를 함께 설정한다.
- 패키지 업로드/복호화와 기억 기능은 [API 환경변수 예시](../apps/api/.env.example) 및 [마켓 실행 가이드](../docs/MARKET_RUNBOOK.md)를 따른다. operator/Seal/Walrus 설정과 MemWal 설정은 각 그룹의 필수 항목을 모두 구성해야 한다.
- 웹 공개 변수 목록은 [웹 환경변수 예시](../apps/web/.env.local.example)에 있다. 개인키, AI 키, MemWal master key는 Railway 서버 변수에만 넣는다.

## 4. 확인 및 현재 범위

```powershell
Invoke-RestMethod https://실제-API.up.railway.app/health/ready
```

웹에서 지갑 로그인과 API 요청을 확인한다. 실제 구매/정산은 배포된 Move package와 실제 거래로 별도 검증해야 한다. Walrus 저장, Seal 복호화, MemWal 복원도 별도 실연동 확인이 필요하다.

2026-09-11 로컬에서 `npm run build`를 실행해 공통 패키지, API, Next.js 전체 빌드가 통과했다.
같은 날 `npm run check:backend`도 통과했다(API 14개, Move 20개 테스트).
이 설정 파일만으로 Railway/Vercel 프로젝트 생성, 계정 연결, 환경변수 입력 또는 원격 배포가 완료되지는 않는다. 클라우드 배포와 Docker 이미지 기동은 아직 검증하지 않았다.

### Sui testnet 배포 대기 상태 (2026-09-11)

`npm run deploy:testnet`을 실행했으나 전용 지갑 잔액이 `0` MIST이고 faucet이 HTTP 429를 반환했다. 첫 응답의 Retry-After 45초를 기다린 뒤 재시도했지만 동일하게 거절됐다. 게시 거래는 생성되지 않았으며 package ID도 아직 없다.

배포용 공개 주소:

`0x97eb51ec405dfd3edf9f5cbe7f38dc8e0cba2ff6252ffe565055a52fe618aa47`

이 주소에 테스트 SUI 0.2개 이상(`200000000` MIST)을 확보한 뒤 루트에서 `npm run deploy:testnet`을 다시 실행한다. 이는 스크립트의 최대 가스 예산이며 실제 수수료는 거래 결과로 확인한다. private key는 기존 `.local-tools/market-testnet/creator.key`를 그대로 사용하고 공개하지 않는다. 성공 결과는 `.local-tools/market-testnet/deployment.json`에 기록된다.

공식 문서: [Railway Config as Code](https://docs.railway.com/config-as-code), [Vercel Monorepos](https://vercel.com/docs/monorepos).
