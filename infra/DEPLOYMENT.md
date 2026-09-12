# Railway 배포

배포 대상은 `web`, 통합 백엔드 `api`, PostgreSQL이다. `infra/Dockerfile.api`는 Fastify와 Spring을 한 이미지에 포함하며 Spring은 컨테이너 내부에서만 접근한다. 각 앱 서비스의 Root Directory는 `/`다. Node와 Java 런타임은 유지하므로 서비스 수 감소가 CPU·메모리 사용량이나 요금 감소를 보장하지 않는다.

2026-09-12 사용자 승인으로 기존 `everyday_api`를 통합 이미지로 전환하고 `everyday_spring`을 제거했다. 운영에는 `everyday_web`, `everyday_api`, 기존 `Postgres`가 남아 있다. 웹/API 공개 주소와 DB 볼륨은 유지했다. 이후 provider 변경도 대상과 효과가 승인된 범위에서만 진행한다. 배포와 검증 근거는 [리뷰](DEPLOYMENT_REVIEW.md)에 보존한다.

## 서비스 설정

별도 승인된 신규 설정 또는 전환에서는 Dockerfile 선택을 각 서비스의 Variables에서 설정한다. 구형 `railway.json` Config File 및 Build Command·Start Command 수동 override가 있다면 승인 범위에서 정리하여 Dockerfile의 build/CMD를 사용한다.

| 설정 | api | web |
| --- | --- | --- |
| `RAILWAY_DOCKERFILE_PATH` | `infra/Dockerfile.api` | `infra/Dockerfile.web` |
| Healthcheck Path | `/health/ready` | `/` |
| Healthcheck Timeout | 120초 | 120초 |
| 공개 도메인 | 기존 API 도메인 유지 | 기존 웹 도메인 유지 |

`PORT`는 Railway가 제공하는 값을 사용한다. API와 Next.js 모두 그 값을 직접 읽는다. API의 우선순위는 `PORT` → 로컬 호환용 `API_PORT` → `3001`이다. API 운영 기본 호스트는 `0.0.0.0`이다. 웹의 컨테이너 기본 포트는 `3000`이다.

공개 API에는 `API_HOST=127.0.0.1` 같은 로컬 설정을 사용하지 않는다. `API_PORT`는 Railway에서 설정할 필요 없다. 이미 `PORT=3001`을 설정한 API도 그대로 동작한다. Spring은 supervisor가 `127.0.0.1:18080`으로 고정하며 공개 Node의 포트가 18080인 경우에만 내부 포트를 18081로 바꾼다. 내부 Spring 포트는 공개 도메인에 연결하지 않는다.

**Public Domain의 target port는 해당 서비스의 실제 `PORT`와 같아야 한다.** API의 시작 로그 `Server listening at ...`에서 실제 포트를 확인할 수 있다. 고정 target port 3001을 유지하고 싶으면 API에 `PORT=3001`을 명시해도 된다. web의 고정 target port 3000도 같은 방식이다.

## api 환경변수

| 변수 | 값 |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (실제 DB 서비스 이름 사용) |
| `WEB_ORIGINS` | web의 정확한 공개 HTTPS Origin, 끝의 `/` 없이 |
| `API_AUDIENCE` | api의 정확한 공개 HTTPS Origin, 끝의 `/` 없이 |
| `SPRING_DATASOURCE_URL` | `jdbc:postgresql://<기존 Postgres private host>:5432/<기존 database>` |
| `SPRING_DATASOURCE_USERNAME`, `SPRING_DATASOURCE_PASSWORD` | 기존 Spring과 같은 PostgreSQL 자격 증명·변수 참조 |
| `ANTHROPIC_API_KEY` | Node 마켓 AI와 Spring 생성·대화에서 함께 사용하는 서버 비밀값 |
| `HIGGSFIELD_API_KEY`, `HIGGSFIELD_API_SECRET` | Spring 초상·사진·Soul 연동의 서버 비밀값 |

운영 로그인에는 `DATABASE_URL`, `WEB_ORIGINS`, `API_AUDIENCE`를 모두 설정한다. 제품 기능에는 Spring JDBC 변수 세 개도 필요하다. 두 런타임이 기존의 같은 PostgreSQL을 사용하도록 하며 DB를 새로 만들거나 데이터를 이관하지 않는다. 복수 WEB_ORIGINS는 쉼표로 구분하며 wildcard를 허용하지 않는다. Postgres는 같은 Railway 프로젝트/환경의 private 연결을 사용하고 외부 공개 포트는 필요 없다.

`ANTHROPIC_BASE_URL`·`ANTHROPIC_MODEL`·`HIGGSFIELD_BASE_URL`의 기존 사용자 설정이 있다면 통합 API에 함께 유지한다. 실제 공급자 키가 없으면 생성·대화·사진 검증을 완료할 수 없다. 비밀/JSON 값을 전달할 때 UTF-8 BOM을 붙이지 않고, 실제 해석된 값은 프로그램 안에서 비교하여 비밀값 자체를 로그로 남기지 않는다.

`SPRING_API_URL`, `WALLET_AUTH_URL`, `APP_MARKET_API_URL`은 배포 환경에서 설정하지 않는다. [start-backend.mjs](start-backend.mjs)가 양쪽의 실제 포트를 사용한 loopback URL로 강제한다. 기존 private domain 주소를 유지할 필요가 없다. 운영에서 baseline profile을 켜지 않는다.

기존 Spring의 `JAVA_TOOL_OPTIONS=-XX:MaxRAMPercentage=70`은 통합 API로 옮기지 않는다. 통합 이미지의 Java 기본값은 40%이며 Node와 JVM의 네이티브 메모리도 같은 컨테이너 한도를 사용한다. 두 런타임의 실제 사용량을 측정한 뒤 별도 승인된 자원 설정에서 조정한다. DB 연결 풀도 그대로 남으므로 통합만으로 연결 수가 줄지는 않는다.

API는 시작 시 실제 Postgres에 연결해 `public` 스키마를 적용한 후 listen한다. Spring은 별도 `everyday` 스키마에 Flyway V1–V11을 적용하고 Hibernate validate를 실행한다. 기존 migration이나 데이터를 추정해 합치지 않는다. 별도 pre-deploy migration 명령은 없다. 단일 API replica로 시작하며 DB 연결/스키마 적용 실패를 성공으로 처리하지 않는다.

## web 환경변수

`NEXT_PUBLIC_API_BASE=https://실제-api-공개도메인`을 설정한 다음 빌드한다. 따옴표, 끝의 `/`, `/v1`을 넣지 않는다. 브라우저가 직접 호출하므로 `railway.internal` 주소를 넣으면 안 된다. 이 값이 없거나 잘못되면 빌드가 설명 메시지와 함께 실패한다.

공개 주소 생성 → api/web 주소 변수 설정 → 배포 순서로 진행한다. `NEXT_PUBLIC_*`는 빌드 시 JavaScript에 들어가므로 변경하면 web을 다시 빌드한다. `EVERYDAY_STATIC_EXPORT`와 `NEXT_PUBLIC_LEGACY_BASELINE`은 운영에 설정하지 않는다. 서버 비밀키는 web 변수에 넣지 않는다.

## 통합 백엔드의 시작과 종료

[start-backend.mjs](start-backend.mjs)가 Node와 Java를 동시에 시작하고 둘의 종료를 감시한다. 한 프로세스가 예상치 않게 종료되면 다른 프로세스도 종료하고 컨테이너를 실패 처리한다. 별도 Spring 서비스나 공개 포트를 만들지 않는다.

정상 종료 신호를 받으면 Spring을 먼저 종료하여 진행 중 Spring 요청이 Node의 인증·이용권·기억 기능을 사용할 시간을 준다. 이후 Node를 종료한다. 전체 종료는 최대 35초로 제한하며 제한을 넘긴 프로세스는 강제 종료한다. 종료 중 진행되는 공급자 작업까지 반드시 완료된다는 보장은 없으며 기존 작업 큐와 멱등·복구 처리를 유지한다.

## 기존 운영 전환 순서 — 별도 승인 필요

아래는 전환 시 실행할 구체적 체크리스트이며 이 문서 수정이나 로컬 검증이 provider 변경 승인은 아니다. 대상 서비스의 변수·배포·설정 변경과 마지막 Spring 삭제에 대한 명시적 승인이 있을 때만 실행한다.

1. 검토된 커밋과 통합 API 이미지의 로컬 검사 결과를 확정하고, 기존 API 서비스·공개 도메인·PostgreSQL을 전환 대상으로 지정한다. 기존 웹/API 주소와 DB 데이터를 유지한다.
2. 기존 Spring의 JDBC 변수 세 개와 Anthropic·Higgsfield 설정을 API 서비스로 이전하도록 준비한다. 같은 DB와 비밀값을 참조하는지 확인하며 값을 문서나 로그에 노출하지 않는다. 이전 내부 주소 변수와 독립 Spring의 70% Java 메모리 설정은 통합 설정에서 제거한다.
3. API Watch Paths에 `apps/api/**` 전체, `packages/contracts/**`, 루트 npm manifest·lockfile·TypeScript 설정, `infra/Dockerfile.api`, `infra/start-backend.mjs`, `.dockerignore`를 포함한다. web은 `apps/web/**`와 공통 npm/DTO 설정·웹 Dockerfile·`.dockerignore` 범위를 유지한다. 기존 자동 배포 설정을 승인 없이 바꾸지 않는다.
4. 승인된 API 설정과 이미지로 기존 API 서비스에 배포한다. target port와 `/health/ready`를 확인한다. 웹의 API 주소·Move package가 같으면 통합만을 이유로 웹 공개 변수를 바꾸거나 재빌드할 필요가 없다.
5. 양쪽 런타임과 DB readiness, 지갑 로그인, gateway 제품 요청, 이용권 가져오기·접근·개인 기억 격리, 실제 AI·이미지 공급자 흐름을 확인한다. 체인 거래나 유료 공급자 호출은 해당 검증에 대한 승인 범위에서만 수행하고, 미검증 항목은 명시한다. 통합 API가 기존 private Spring에 의존하지 않는지도 확인한다.
6. 기존 Spring은 검증 전까지 유지한다. 중복 작업 큐 실행 가능성을 검토하고, 통합 배포 확인 후 별도로 승인된 마지막 단계에서 기존 Spring 서비스를 제거한다. 전환 실패를 이유로 임의의 재배포·rollback·DB 변경을 하지 않는다.

## 헬스체크와 오류 진단

- API `/health/ready`: Node DB 질의와 내부 Spring `/health/ready`가 모두 성공하면 200, 어느 하나라도 실패하면 503이다. Spring readiness는 Spring DB 연결도 확인한다. 헬스체크는 일반 요청 rate limit에서 제외한다.
- API `/health/live`: 프로세스 응답 여부만 확인한다. readiness 실패를 숨기기 위해 이 경로로 바꾸지 않는다.
- web `/`: 웹 서버 응답을 확인한다. `/health/ready`는 웹 경로가 아니다.
- `Application failed to respond`: Runtime/Deploy Logs에서 실제 listen 성공 여부를 먼저 확인하고 도메인의 target port를 맞춘다. 이 화면만으로 DB/포트/설정 오류를 확정할 수 없다.
- `No start command detected`와 Railpack 출력: 해당 서비스의 `RAILWAY_DOCKERFILE_PATH`가 새 배포에 적용됐는지 확인한다. 루트 start 스크립트 하나로 웹/API를 동시에 띄우지 않는다.

## 실제 마켓 기능

API/웹 호스팅 성공과 온체인 결제 성공은 별도 검증이다.

- testnet에 실제 배포한 package ID를 api의 `SUI_MARKET_PACKAGE_ID`와 web의 `NEXT_PUBLIC_SUI_PACKAGE_ID`에 동일하게 설정한다.
- 마켓 AI는 api의 `ANTHROPIC_API_KEY`로 기존 Claude 계정을 재사용할 수 있다. 별도 OpenAI 호환 공급자를 쓸 때만 `AI_ENDPOINT`, `AI_MODEL`, `AI_API_KEY` 세 변수를 함께 설정한다.
- `AI_DAILY_LIMIT` 기본 50, `AI_GLOBAL_DAILY_LIMIT` 기본 100은 사용자별/서버 전체 일일 요청 한도다. Node/Spring/선물 판단에 같은 DB 예약 함수를 사용한다. 요청 수 제한이며 공급자 청구액 상한은 아니다. 읽기 요청은 AI를 생성하지 않고 첫 인사는 별도 제한된 POST 요청이다.
- Seal/Walrus/operator 및 MemWal의 필수 변수 그룹은 [API 환경 예시](../apps/api/.env.example)와 [마켓 실행 가이드](../docs/MARKET_RUNBOOK.md)를 따른다.
- 공개 변수 목록은 [웹 환경 예시](../apps/web/.env.local.example)를 따른다. P1 선물은 기본 비활성이다.

2026-09-12 Walrus/Sui epoch 구분을 수정해 v2 testnet package `0x3ff2bfc626a8b26ca76eb13045009f642103a7a623188794f5b534882d210023`를 게시했다. [배포 기록](../contracts/everyday/deployments/testnet.json)을 참조한다. 재확인은 `node infra/deploy-testnet.mjs --execute --deployment-state market-testnet-v2`다. 이전 v1은 Git 기록과 기존 로컬 상태에 남기며 새 상품과 혼용하지 않는다. 키/서명은 ignored `.local-tools/market-testnet-v2`에만 있다.

실제 가상 데이터 검증: `node infra/verify-market-testnet.mjs --execute --with-memory`. 같은 서명/거래를 재확인하고 불확실한 업로드를 자동 재시도하지 않는다. [거래 증거](../contracts/everyday/deployments/testnet-verification.json)와 [기억 증거](../contracts/everyday/deployments/memory-verification.json)는 공개 식별자만 담는다. 검증용 가상 상품을 운영 카탈로그에 등록했다고 간주하지 않는다.

`node infra/verify-market-api.mjs`는 실제 체인/저장/기억 어댑터를 두 Origin의 인증 API로 검증한다. DB는 별도 PGlite이고 AI/이미지 호출은 하지 않는다. 시드 상품은 `--seed-market` 옵션으로 게시한 [10명 기록](../contracts/everyday/deployments/market-seed.json)을 사용한다. 새 API와 DB migration이 준비된 뒤 `node infra/register-market-seed.mjs --execute --api https://everydayapi-production.up.railway.app --origin https://everydayweb-production.up.railway.app`로 운영 카탈로그에 등록한다. 이미 게시한 상품만 등록하며 새 결제·업로드는 하지 않는다.

## 검증

검증 결과와 한계는 [배포 리뷰](DEPLOYMENT_REVIEW.md)에 기록한다. Railway 계정 접근 없이 클라우드 배포 성공을 주장하지 않는다.

공식 문서: [Dockerfiles](https://docs.railway.com/builds/dockerfiles), [Healthchecks](https://docs.railway.com/deployments/healthchecks), [Monorepos](https://docs.railway.com/deployments/monorepo).
