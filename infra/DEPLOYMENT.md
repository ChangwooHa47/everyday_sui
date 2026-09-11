# Railway 배포

같은 GitHub 저장소의 `main`을 Railway 프로젝트의 `web`, `api` 두 서비스에 연결하고 PostgreSQL 서비스를 추가한다. npm workspace와 루트 lockfile을 공유하므로 두 서비스의 Root Directory는 `/`다.

## 서비스 설정

Dockerfile 선택은 각 서비스의 Variables에서 설정한다. 구형 `railway.json` Config File 설정은 제거한다. Build Command와 Start Command의 수동 override도 지워 Dockerfile의 build/CMD를 사용한다.

| 설정 | api | web |
| --- | --- | --- |
| `RAILWAY_DOCKERFILE_PATH` | `infra/Dockerfile.api` | `infra/Dockerfile.web` |
| Healthcheck Path | `/health/ready` | `/` |
| Healthcheck Timeout | 120초 | 120초 |
| Restart Policy | On Failure, 최대 3회 | On Failure, 최대 3회 |

`PORT`는 Railway가 제공하는 값을 사용한다. API와 Next.js 모두 그 값을 직접 읽는다. API의 우선순위는 `PORT` → 로컬 호환용 `API_PORT` → `3001`이다. API 운영 기본 호스트는 `0.0.0.0`이다. 웹의 컨테이너 기본 포트는 `3000`이다.

기존 `API_HOST=127.0.0.1` 같은 로컬 설정은 Railway에서 제거한다. `API_PORT`는 Railway에서 설정할 필요 없다. 이미 `PORT=3001`을 설정한 API도 그대로 동작한다.

**Public Domain의 target port는 해당 서비스의 실제 `PORT`와 같아야 한다.** API의 시작 로그 `Server listening at ...`에서 실제 포트를 확인할 수 있다. 고정 target port 3001을 유지하고 싶으면 API에 `PORT=3001`을 명시해도 된다. web의 고정 target port 3000도 같은 방식이다.

## api 환경변수

| 변수 | 값 |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (실제 DB 서비스 이름 사용) |
| `WEB_ORIGINS` | web의 정확한 공개 HTTPS Origin, 끝의 `/` 없이 |
| `API_AUDIENCE` | api의 정확한 공개 HTTPS Origin, 끝의 `/` 없이 |

운영 로그인에는 세 변수 모두 설정한다. 복수 WEB_ORIGINS는 쉼표로 구분하며 wildcard를 허용하지 않는다. Postgres는 같은 Railway 프로젝트/환경의 private 연결을 사용하고 외부 공개 포트는 필요 없다.

API는 시작 시 실제 Postgres에 연결해 스키마를 적용한 후 listen한다. 별도 pre-deploy migration 명령은 없다. 단일 API replica로 시작한다. DB 연결/스키마 적용 실패를 성공으로 처리하지 않는다.

## web 환경변수

`NEXT_PUBLIC_API_BASE=https://실제-api-공개도메인`을 설정한 다음 빌드한다. 따옴표, 끝의 `/`, `/v1`을 넣지 않는다. 브라우저가 직접 호출하므로 `railway.internal` 주소를 넣으면 안 된다. 이 값이 없거나 잘못되면 빌드가 설명 메시지와 함께 실패한다.

공개 주소 생성 → api/web 주소 변수 설정 → 배포 순서로 진행한다. `NEXT_PUBLIC_*`는 빌드 시 JavaScript에 들어가므로 변경하면 web을 다시 빌드한다. `EVERYDAY_STATIC_EXPORT`와 `NEXT_PUBLIC_LEGACY_BASELINE`은 운영에 설정하지 않는다. 서버 비밀키는 web 변수에 넣지 않는다.

## 헬스체크와 오류 진단

- API `/health/ready`: DB 질의 성공 시 200, 실패 시 503. 헬스체크는 일반 요청 rate limit에서 제외한다.
- API `/health/live`: 프로세스 응답 여부만 확인한다. readiness 실패를 숨기기 위해 이 경로로 바꾸지 않는다.
- web `/`: 웹 서버 응답을 확인한다. `/health/ready`는 웹 경로가 아니다.
- `Application failed to respond`: Runtime/Deploy Logs에서 실제 listen 성공 여부를 먼저 확인하고 도메인의 target port를 맞춘다. 이 화면만으로 DB/포트/설정 오류를 확정할 수 없다.
- `No start command detected`와 Railpack 출력: 해당 서비스의 `RAILWAY_DOCKERFILE_PATH`가 새 배포에 적용됐는지 확인한다. 루트 start 스크립트 하나로 웹/API를 동시에 띄우지 않는다.

## 실제 마켓 기능

API/웹 호스팅 성공과 온체인 결제 성공은 별도 검증이다.

- testnet에 실제 배포한 package ID를 api의 `SUI_MARKET_PACKAGE_ID`와 web의 `NEXT_PUBLIC_SUI_PACKAGE_ID`에 동일하게 설정한다.
- AI는 api의 `AI_ENDPOINT`, `AI_MODEL`, `AI_API_KEY`를 함께 설정한다.
- Seal/Walrus/operator 및 MemWal의 필수 변수 그룹은 [API 환경 예시](../apps/api/.env.example)와 [마켓 실행 가이드](../docs/MARKET_RUNBOOK.md)를 따른다.
- 공개 변수 목록은 [웹 환경 예시](../apps/web/.env.local.example)를 따른다. P1 선물은 기본 비활성이다.

2026-09-11 공식 웹 faucet으로 가스를 확보해 testnet 게시를 완료했다. 검증된 package ID는 `0x361efffcabf0ecd042a605ede4f9ff114fc3c0af39ce0d3ef51adfd9e0cc1263`이다. [배포 기록](../contracts/everyday/deployments/testnet.json)을 참조한다. 재확인은 `node infra/deploy-testnet.mjs --execute`로 실행한다. 기존 bootstrap 대신 이 검토된 진입점을 사용한다. 키와 서명 파일은 `.local-tools/market-testnet`에만 보관한다.

## 검증

검증 결과와 한계는 [배포 리뷰](DEPLOYMENT_REVIEW.md)에 기록한다. Railway 계정 접근 없이 클라우드 배포 성공을 주장하지 않는다.

공식 문서: [Dockerfiles](https://docs.railway.com/builds/dockerfiles), [Healthchecks](https://docs.railway.com/deployments/healthchecks), [Monorepos](https://docs.railway.com/deployments/monorepo).
