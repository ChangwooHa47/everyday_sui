# Railway 배포

배포 대상은 `web`, 단일 TypeScript/Node 백엔드 `api`, PostgreSQL이다. `infra/Dockerfile.api`는 Fastify 제품 API와 Web3 기능을 Node 프로세스 하나로 실행한다. 각 앱 서비스의 Root Directory는 `/`다. Java·Gradle·내부 Spring 포트는 현재 이미지에 없다. 실제 CPU·메모리 사용량이나 요금 감소는 측정 없이 보장하지 않는다.

2026-09-12 앞선 운영 통합에서 `everyday_spring`을 제거했고, 서비스는 `everyday_web`, `everyday_api`, 기존 `Postgres`로 유지한다. 이번 단일 Node 런타임은 로컬 구현과 기존 Spring/Flyway DB 전환 검증을 완료한 상태이며, 실제 Railway 반영은 [리뷰](DEPLOYMENT_REVIEW.md)의 최신 배포 기록을 따른다. 웹/API 공개 주소와 DB 볼륨을 유지하며 provider 변경은 대상과 효과가 승인된 범위에서만 진행한다.

## 서비스 설정

별도 승인된 신규 설정 또는 전환에서는 Dockerfile 선택을 각 서비스의 Variables에서 설정한다. 구형 `railway.json` Config File 및 Build Command·Start Command 수동 override가 있다면 승인 범위에서 정리하여 Dockerfile의 build/CMD를 사용한다.

| 설정 | api | web |
| --- | --- | --- |
| `RAILWAY_DOCKERFILE_PATH` | `infra/Dockerfile.api` | `infra/Dockerfile.web` |
| Healthcheck Path | `/health/ready` | `/` |
| Healthcheck Timeout | 120초 | 120초 |
| 공개 도메인 | 기존 API 도메인 유지 | 기존 웹 도메인 유지 |

`PORT`는 Railway가 제공하는 값을 사용한다. API와 Next.js 모두 그 값을 직접 읽는다. API의 우선순위는 `PORT` → 로컬 호환용 `API_PORT` → `3001`이다. API 운영 기본 호스트는 `0.0.0.0`이다. 웹의 컨테이너 기본 포트는 `3000`이다.

공개 API에는 `API_HOST=127.0.0.1` 같은 로컬 설정을 사용하지 않는다. `API_PORT`는 Railway에서 설정할 필요 없다. 이미 `PORT=3001`을 설정한 API도 그대로 동작한다. API는 HTTP 포트 하나를 사용한다.

**Public Domain의 target port는 해당 서비스의 실제 `PORT`와 같아야 한다.** API의 시작 로그 `Server listening at ...`에서 실제 포트를 확인할 수 있다. 고정 target port 3001을 유지하고 싶으면 API에 `PORT=3001`을 명시해도 된다. web의 고정 target port 3000도 같은 방식이다.

## api 환경변수

| 변수 | 값 |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (실제 DB 서비스 이름 사용) |
| `WEB_ORIGINS` | web의 정확한 공개 HTTPS Origin, 끝의 `/` 없이 |
| `API_AUDIENCE` | api의 정확한 공개 HTTPS Origin, 끝의 `/` 없이 |
| `ANTHROPIC_API_KEY` | 기존 제품 생성·대화와 마켓 AI에서 함께 사용하는 서버 비밀값 |
| `HIGGSFIELD_API_KEY`, `HIGGSFIELD_API_SECRET` | 초상·사진·Soul 연동의 서버 비밀값 |

운영 로그인에는 `DATABASE_URL`, `WEB_ORIGINS`, `API_AUDIENCE`를 모두 설정한다. 같은 API가 기존 PostgreSQL의 `public`·`everyday` schema를 사용하므로 DB를 새로 만들거나 데이터를 이관하지 않는다. 복수 WEB_ORIGINS는 쉼표로 구분하며 wildcard를 허용하지 않는다. Postgres는 같은 Railway 프로젝트/환경의 private 연결을 사용하고 외부 공개 포트는 필요 없다.

`ANTHROPIC_BASE_URL`·`ANTHROPIC_MODEL`·`HIGGSFIELD_BASE_URL`의 기존 사용자 설정이 있다면 통합 API에 함께 유지한다. 실제 공급자 키가 없으면 생성·대화·사진 검증을 완료할 수 없다. 비밀/JSON 값을 전달할 때 UTF-8 BOM을 붙이지 않고, 실제 해석된 값은 프로그램 안에서 비교하여 비밀값 자체를 로그로 남기지 않는다.

`SPRING_DATASOURCE_*`, `SPRING_API_URL`, `WALLET_AUTH_URL`, `APP_MARKET_API_URL`, `JAVA_TOOL_OPTIONS`는 새 런타임에서 읽지 않는다. 기존 provider 변수에 남아 있어도 Node 실행에 사용되지 않으며, 변수 정리는 별도로 승인된 설정 변경 범위에서만 수행한다. 내부 서비스 주소나 JDBC URL을 새로 설정할 필요가 없다.

DB 연결 풀은 Node의 최대 10개만 사용한다. 제품 작업과 마켓 기능이 이 풀을 공유하며, 사진·초상 이미지 생성은 DB 트랜잭션 밖에서 실행한다. 실제 사용량을 측정한 뒤 별도 승인된 자원 설정에서 조정한다.

API는 시작 시 실제 Postgres에 연결해 `public` schema의 멱등 DDL과 `everyday` schema의 기존 SQL V1–V11을 확인한 후 listen한다. [migration 실행기](../apps/api/src/product/migrations.ts)는 기존 Flyway 이력·checksum을 확인하고 적용되지 않은 SQL만 실행한다. 기존 데이터·적용 이력·schema를 합치거나 재생성하지 않는다. 별도 pre-deploy migration 명령은 없으며, DB 연결·이력 검증 실패 시 시작을 중단한다.

## web 환경변수

`NEXT_PUBLIC_API_BASE=https://실제-api-공개도메인`을 설정한 다음 빌드한다. 따옴표, 끝의 `/`, `/v1`을 넣지 않는다. 브라우저가 직접 호출하므로 `railway.internal` 주소를 넣으면 안 된다. 이 값이 없거나 잘못되면 빌드가 설명 메시지와 함께 실패한다.

공개 주소 생성 → api/web 주소 변수 설정 → 배포 순서로 진행한다. `NEXT_PUBLIC_*`는 빌드 시 JavaScript에 들어가므로 변경하면 web을 다시 빌드한다. `EVERYDAY_STATIC_EXPORT`와 `NEXT_PUBLIC_LEGACY_BASELINE`은 운영에 설정하지 않는다. 서버 비밀키는 web 변수에 넣지 않는다.

## 단일 백엔드의 시작과 종료

[Dockerfile.api](Dockerfile.api)는 tini 아래에서 `node apps/api/dist/server.js`를 실행한다. 인증·마켓·제품 API와 사진·초상 작업 큐가 같은 Node 프로세스에서 실행된다.

정상 종료 신호를 받으면 작업 큐의 신규 실행을 중단한다. 실행 중인 사진·초상 작업은 최대 20초 기다린 뒤 공급자 요청을 취소하고 5초의 정리 시간을 둔다. 작업 정리가 끝난 후 HTTP 요청과 DB 연결을 종료하며 전체 프로세스 종료 제한은 35초다. 불확실한 유료 호출은 자동 재실행하지 않는다. 기존 사진 실패·환불 및 초상 `unknown` 상태를 유지하며, 취소되지 않는 작업을 정상 종료로 보고하지 않는다. Compose의 종료 여유 시간은 40초다.

## 기존 운영 전환 순서 — 별도 승인 필요

아래는 기존 API를 새 Node 이미지로 전환할 때의 체크리스트다. 이 문서 수정이나 로컬 검증은 provider 변경 승인이 아니며, 대상 서비스의 배포·설정 변경에 대한 명시적 승인 범위에서 실행한다.

1. 검토된 커밋과 API 이미지의 로컬 검사 결과를 확정한다. 기존 Spring/Flyway DB에서 새 Node 이미지로 전환해 모든 데이터와 migration 이력이 유지되는지도 검사한다.
2. 기존 API 서비스·공개 도메인·PostgreSQL을 그대로 사용한다. `DATABASE_URL`과 공급자·체인·기억 설정이 기존 대상을 참조하는지 확인하고 비밀값을 문서나 로그에 노출하지 않는다.
3. API Watch Paths는 `apps/api/**`, `packages/contracts/**`, 루트 npm manifest·lockfile·TypeScript 설정, `infra/Dockerfile.api`, `.dockerignore`를 포함한다. web은 기존 범위를 유지한다. 기존 자동 배포 설정을 승인 없이 바꾸지 않는다.
4. 승인된 이미지로 기존 API 서비스에 배포한다. 실제 target port와 `/health/ready`, 단일 Node 실행을 확인한다. 웹의 API 주소·Move package가 같으면 백엔드 이전만을 이유로 웹 공개 변수를 바꾸거나 재빌드할 필요가 없다.
5. 지갑 로그인, 제품 조회, 기존 이용권·대화·개인 기억 접근과 격리를 확인한다. 체인 거래나 유료 공급자 호출은 해당 검증에 대한 승인 범위에서만 수행하고 미검증 항목은 명시한다. 기존 운영 키가 비어 있으면 실제 AI·이미지 호출을 검증했다고 보고하지 않는다.
6. 별도 Spring 서비스는 앞선 통합에서 제거됐으므로 다시 만들지 않는다. 전환 실패를 이유로 임의의 재배포·rollback·DB 변경을 하지 않는다.

## 헬스체크와 오류 진단

- API `/health/ready`: 시작 시 schema·migration 검증을 통과한 Node API에서 DB 질의가 성공하면 200, 실패하면 503이다. 헬스체크는 일반 요청 rate limit에서 제외한다.
- API `/health/live`: 프로세스 응답 여부만 확인한다. readiness 실패를 숨기기 위해 이 경로로 바꾸지 않는다.
- web `/`: 웹 서버 응답을 확인한다. `/health/ready`는 웹 경로가 아니다.
- `Application failed to respond`: Runtime/Deploy Logs에서 실제 listen 성공 여부를 먼저 확인하고 도메인의 target port를 맞춘다. 이 화면만으로 DB/포트/설정 오류를 확정할 수 없다.
- `No start command detected`와 Railpack 출력: 해당 서비스의 `RAILWAY_DOCKERFILE_PATH`가 새 배포에 적용됐는지 확인한다. 루트 start 스크립트 하나로 웹/API를 동시에 띄우지 않는다.

## 실제 마켓 기능

API/웹 호스팅 성공과 온체인 결제 성공은 별도 검증이다.

- testnet에 실제 배포한 package ID를 api의 `SUI_MARKET_PACKAGE_ID`와 web의 `NEXT_PUBLIC_SUI_PACKAGE_ID`에 동일하게 설정한다.
- 마켓 AI는 api의 `ANTHROPIC_API_KEY`로 기존 Claude 계정을 재사용할 수 있다. 별도 OpenAI 호환 공급자를 쓸 때만 `AI_ENDPOINT`, `AI_MODEL`, `AI_API_KEY` 세 변수를 함께 설정한다.
- `AI_DAILY_LIMIT` 기본 50, `AI_GLOBAL_DAILY_LIMIT` 기본 100은 사용자별/서버 전체 일일 요청 한도다. 제품·마켓·선물 판단에 같은 DB 예약 함수를 사용한다. 요청 수 제한이며 공급자 청구액 상한은 아니다. 읽기 요청은 AI를 생성하지 않고 첫 인사는 별도 제한된 POST 요청이다.
- Seal/Walrus/operator 및 MemWal의 필수 변수 그룹은 [API 환경 예시](../apps/api/.env.example)와 [마켓 실행 가이드](../docs/MARKET_RUNBOOK.md)를 따른다.
- 공개 변수 목록은 [웹 환경 예시](../apps/web/.env.local.example)를 따른다. P1 선물은 기본 비활성이다.

2026-09-12 Walrus/Sui epoch 구분을 수정해 v2 testnet package `0x3ff2bfc626a8b26ca76eb13045009f642103a7a623188794f5b534882d210023`를 게시했다. [배포 기록](../contracts/everyday/deployments/testnet.json)을 참조한다. 재확인은 `node infra/deploy-testnet.mjs --execute --deployment-state market-testnet-v2`다. 이전 v1은 Git 기록과 기존 로컬 상태에 남기며 새 상품과 혼용하지 않는다. 키/서명은 ignored `.local-tools/market-testnet-v2`에만 있다.

2026-09-12 NFT 선물 계약을 포함한 package `0x3e99d3e3789354810095f4dc41f7f2b0d1614ac16f068928b0d9e6691531aa37`를 별도 testnet 검증 대상으로 게시했다. 생성 이미지 3개는 Walrus testnet에 7 epochs로 보관 요청하고 재다운로드 해시를 확인했으며, 각 `NftGiftProduct`도 실제 생성·조회했다. 공개 식별자와 해시는 [NFT 선물 배포 기록](../contracts/everyday/deployments/nft-gifts-testnet.json)에 있다. 기존 운영 API·웹의 package 변수는 이 작업에서 변경하지 않았다.

실제 가상 데이터 검증: `node infra/verify-market-testnet.mjs --execute --with-memory`. 같은 서명/거래를 재확인하고 불확실한 업로드를 자동 재시도하지 않는다. [거래 증거](../contracts/everyday/deployments/testnet-verification.json)와 [기억 증거](../contracts/everyday/deployments/memory-verification.json)는 공개 식별자만 담는다. 검증용 가상 상품을 운영 카탈로그에 등록했다고 간주하지 않는다.

`node infra/verify-market-api.mjs`는 실제 체인/저장/기억 어댑터를 두 Origin의 인증 API로 검증한다. DB는 별도 PGlite이고 AI/이미지 호출은 하지 않는다. 시드 상품은 `--seed-market` 옵션으로 게시한 [10명 기록](../contracts/everyday/deployments/market-seed.json)을 사용한다. 새 API와 DB migration이 준비된 뒤 `node infra/register-market-seed.mjs --execute --api https://everydayapi-production.up.railway.app --origin https://everydayweb-production.up.railway.app`로 운영 카탈로그에 등록한다. 이미 게시한 상품만 등록하며 새 결제·업로드는 하지 않는다.

## 검증

검증 결과와 한계는 [배포 리뷰](DEPLOYMENT_REVIEW.md)에 기록한다. Railway 계정 접근 없이 클라우드 배포 성공을 주장하지 않는다.

공식 문서: [Dockerfiles](https://docs.railway.com/builds/dockerfiles), [Healthchecks](https://docs.railway.com/deployments/healthchecks), [Monorepos](https://docs.railway.com/deployments/monorepo).
