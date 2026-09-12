# Everyday Sui

AI 캐릭터를 만들고 대화하며, 작가가 설계한 캐릭터의 **개인 사용용 비독점 이용권**을 거래하는 서비스다. 캐릭터 설정은 판매하지만 사용자별 대화·관계·기억은 판매하지 않는다.

기존 Next.js 화면과 Spring 제품 기능을 사용하고, Fastify API가 지갑 인증과 Sui·Walrus·Seal·MemWal 연동을 맡는다. Railway에는 web, api, 비공개 spring을 별도 서비스로 배포하고 PostgreSQL을 공유한다.

## 문서 안내

| 문서 | 기준으로 삼을 내용 |
| --- | --- |
| [기획과 구현 경계](docs/MARKET_PIVOT.md) | P0/P1 요구사항, 온체인·오프체인 분담, 미완료 범위 |
| [로컬 실행·검증](docs/MARKET_RUNBOOK.md) | 설정, 기존 화면의 흐름, 검증 명령과 실행 범위 |
| [Railway 배포](infra/DEPLOYMENT.md) | 세 서비스, 환경변수, 내부 연결, 헬스체크 |
| [배포·코드 리뷰](infra/DEPLOYMENT_REVIEW.md) | DB 검토, 실제 검증 증거와 그 한계 |
| [프론트 기준](apps/web/README.md) | 원래 컴포넌트·디자인 유지 원칙 |
| [Move 계약](contracts/everyday/README.md) | 이용권·정산·금고 정책과 배포 기록 |

현재 상태와 실행 방법은 위 문서를 따른다. [과거 Web2 조사](docs/history/WEB2_CODE_REVIEW.md), [폐기된 Web3 전환 계획](docs/history/WEB3_NATIVE_PLAN.md), [초기 Web3 구현](docs/history/WEB3_IMPLEMENTATION.md), [초기 검증](docs/history/P0_VALIDATION.md), [초기 마켓 리뷰](docs/history/MARKET_REVIEW.md), [초기 마켓 구현](docs/history/MARKET_IMPLEMENTATION.md)은 당시 기록이며 현재 기능 안내가 아니다.

## 확인된 상태

2026-09-12 기준 실제 testnet 이용권 구매·제작자/금고 정산, Walrus 저장·Seal 복호화, MemWal 기억 저장·검색·사용자/캐릭터 격리를 확인했다. 가상 성인 시드 캐릭터 10명도 게시하고 운영 카탈로그에 등록했다. 거래 식별자와 테스트 환경은 [배포 리뷰](infra/DEPLOYMENT_REVIEW.md)에 연결되어 있다.

**전체 기획이 완료된 상태는 아니다.** 마지막 운영 확인에서는 Claude/Higgsfield 키가 없어 실제 생성·대화·사진 호출을 검증하지 못했다. P1의 대화 기반 선물 제안부터 상품 제공·채팅 영수증까지도 미완료다. 현재 수정본의 브라우저 테스트는 실행하지 않았다.

## 시작하기

Node 24, npm 11과 Docker를 사용한다. 원래 제품 기능까지 실행하려면 PostgreSQL·API·Spring을 함께 실행한다.

```powershell
npm.cmd ci --ignore-scripts
Copy-Item apps/api/.env.example apps/api/.env.local
Copy-Item apps/web/.env.local.example apps/web/.env.local
docker compose --env-file apps/api/.env.local -f infra/compose.yaml up --build
```

다른 터미널에서 `npm.cmd run dev:web`을 실행하고 [로컬 홈](http://127.0.0.1:3000)에 접속한다. 설정 파일 복사는 최초 한 번만 한다. 공급자·체인·기억 설정은 [실행 가이드](docs/MARKET_RUNBOOK.md)를 따른다. 설정 없이 기동할 수 있어도 AI 생성이나 유료 상품 접근까지 가능한 것은 아니다.

## 검증

```powershell
node infra/check-docs.mjs
npm.cmd run check:backend
npm.cmd run test:unit --workspace @everyday/web
npm.cmd run build
```

Spring 변경은 Java 21에서 `apps/api/spring/gradlew.bat -p apps/api/spring test bootJar --no-daemon`도 실행한다. 이후 `node infra/test-spring.mjs`는 별도 Docker PostgreSQL과 실제 인증·gateway로 제품 흐름을 검사한다. AI·이미지 응답은 fixture이며 실제 공급자 왕복을 증명하지 않는다. 추가 검증의 범위는 [실행 가이드](docs/MARKET_RUNBOOK.md)에 있다.

## 저장소 구조

| 경로 | 역할 |
| --- | --- |
| `apps/web` | 기존 Next.js 제품 화면, 로그인·이용권·개인 기억 클라이언트 |
| `apps/api/src` | Fastify 인증·마켓·AI 한도·체인/저장/기억 어댑터·Spring gateway |
| `apps/api/spring` | 기존 생성·대화·에피소드·사진·사용자 기능, JPA/Flyway |
| `packages/contracts` | 웹/API 공통 DTO 타입 |
| `contracts/everyday` | Move 이용권·정산·캐릭터 금고, 공개 testnet 증거 |
| `infra` | Docker/Compose, 배포 가이드, 검증 도구 |
| `legacy` | 비교용으로 보존한 이전 소스와 당시 문서 |

npm workspace와 루트 lockfile은 하나다. 웹에서 API 소스를 직접 가져오지 않는다. 무시된 `frontend/`, `backend/`는 원래 독립 checkout이며 현재 배포 대상이 아니다. 키·서명 복구 상태가 있는 무시된 로컬 폴더는 문서 정리 대상으로 삭제하지 않는다.
