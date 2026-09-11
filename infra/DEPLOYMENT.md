# Railway 웹 + API + Postgres 배포

저장소: https://github.com/ChangwooHa47/everyday_sui

Railway 프로젝트 하나에 `web`, `api`, `Postgres` 서비스 세 개를 만든다. `web`과 `api`는 같은 GitHub 저장소의 `main` 브랜치를 연결하며 Node.js 24와 루트 package-lock.json을 사용한다.

| 서비스 | Root Directory | Config File | Public Domain target port |
| --- | --- | --- | --- |
| `api` | `/` | `/infra/railway.json` | `3001` |
| `web` | `/` | `/infra/railway.web.json` | `3000` |
| `Postgres` | Railway PostgreSQL 서비스 | 해당 없음 | 공개 도메인 불필요 |

먼저 세 서비스를 만들고 web/api의 공개 도메인을 생성한다. 아래 주소 변수를 채운 뒤 배포한다. 시작 명령과 Dockerfile은 각 Config File이 지정하므로 별도로 덮어쓰지 않는다.

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
| `WEB_ORIGINS` | `https://실제-WEB.up.railway.app` — 끝의 `/` 없이 정확한 Origin |
| `API_AUDIENCE` | `https://실제-API.up.railway.app` — 끝의 `/` 없이 설정 |
| `AGENT_GIFTS_ENABLED` | `0` |

6. Networking에서 Public Domain을 생성하고 target port를 `3001`로 설정한다. 생성된 주소를 `API_AUDIENCE`에 반영한다.
7. web 주소를 `WEB_ORIGINS`에 반영한다. 복수의 Origin은 공백 없이 쉼표로 구분한다. Preview 도메인은 자동으로 허용되지 않는다.

Dockerfile의 시작 명령은 `node apps/api/dist/server.js`다. 시작 시 DB 스키마를 멱등 적용하므로 별도 migration 명령은 필요 없다. 첫 배포는 API 단일 replica로 시작한다.
`/health/ready`는 DB 연결을 확인한다. Sui나 AI 제공자의 정상 동작을 증명하는 엔드포인트는 아니다.

## 2. Railway: Next.js 웹

1. 같은 프로젝트에 같은 GitHub 저장소를 연결한 `web` 서비스를 추가한다.
2. Root Directory는 저장소 루트(`/`), Config File은 `/infra/railway.web.json`으로 설정한다.
3. `PORT=3000`을 설정하고 Public Domain의 target port를 `3000`으로 설정한다.
4. `NEXT_PUBLIC_API_BASE=https://실제-API.up.railway.app`을 설정한다. 끝의 `/`는 넣지 않는다. 브라우저가 직접 호출하므로 `railway.internal` 주소를 넣으면 안 된다.
5. API의 `WEB_ORIGINS`에 web의 실제 HTTPS Origin을 설정하고 양쪽을 배포한다.

`infra/Dockerfile.web`이 공통 패키지와 웹을 빌드하며, 런타임에는 production 의존성·빌드 결과·public 파일을 복사한다. Next.js 서버는 `0.0.0.0:$PORT`에서 실행된다. 공개 API Origin이 없거나 HTTPS Origin 형식이 아니면 빌드가 실패한다.

`NEXT_PUBLIC_*`는 Docker build ARG를 통해 빌드에 포함되므로 변경 후 web을 다시 빌드/배포해야 한다. `EVERYDAY_STATIC_EXPORT`는 설정하지 않는다. 서버 전용 비밀값은 `api` 서비스에만 설정한다.

## 3. 실제 마켓 기능 활성화

API/웹 호스팅과 온체인 마켓의 준비 상태는 별개다. 미설정 기능은 기존 코드대로 요청을 거절한다.

- Move를 testnet에 배포한 뒤 정확히 같은 package ID를 api의 `SUI_MARKET_PACKAGE_ID`와 web의 `NEXT_PUBLIC_SUI_PACKAGE_ID`에 설정한다. 임의의 예시 ID를 넣지 않는다.
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
Railway 웹 구성으로 전환한 뒤 전체 빌드를 다시 통과했고, Dockerfile과 같은 Next.js 시작 명령을 로컬에서 실행해 `PORT` 적용과 `/`, `/market`, `/viewer`, SVG 및 JavaScript 정적 파일의 HTTP 200 응답을 확인했다.
이 설정 파일만으로 Railway 프로젝트 생성, 계정 연결, 환경변수 입력 또는 원격 배포가 완료되지는 않는다. 클라우드 배포와 Docker 이미지 기동은 아직 검증하지 않았다.

### Sui testnet 배포 대기 상태 (2026-09-11)

`npm run deploy:testnet`을 실행했으나 전용 지갑 잔액이 `0` MIST이고 faucet이 HTTP 429를 반환했다. 첫 응답의 Retry-After 45초를 기다린 뒤 재시도했지만 동일하게 거절됐다. 게시 거래는 생성되지 않았으며 package ID도 아직 없다.

배포용 공개 주소:

`0x97eb51ec405dfd3edf9f5cbe7f38dc8e0cba2ff6252ffe565055a52fe618aa47`

이 주소에 테스트 SUI 0.2개 이상(`200000000` MIST)을 확보한 뒤 루트에서 `npm run deploy:testnet`을 다시 실행한다. 이는 스크립트의 최대 가스 예산이며 실제 수수료는 거래 결과로 확인한다. private key는 기존 `.local-tools/market-testnet/creator.key`를 그대로 사용하고 공개하지 않는다. 성공 결과는 `.local-tools/market-testnet/deployment.json`에 기록된다.

공식 문서: [Railway Config as Code](https://docs.railway.com/config-as-code), [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles), [Railway Monorepos](https://docs.railway.com/deployments/monorepo).
