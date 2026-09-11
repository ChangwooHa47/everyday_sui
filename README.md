# Everyday Sui

현재 방향은 **AI 캐릭터 비독점 이용권 마켓**입니다. 새 백엔드·컨트랙트 기준과 API는
[마켓 피봇](docs/MARKET_PIVOT.md), 검증·코드리뷰는 [마켓 검증 기록](docs/MARKET_REVIEW.md)을 참고하세요.
현재 제작·게시·구매 채팅·MemWal 기억·선물 실행 코드와 `/market`, `/viewer`를 연결했습니다.
실행 방법은 [마켓 실행 가이드](docs/MARKET_RUNBOOK.md), 최신 상태는 [구현·리뷰 기록](docs/MARKET_IMPLEMENTATION.md)을 참고하세요.
실제 배포는 테스트넷 faucet 429로 중단됐고 외부 키/스토리지 설정 후 리허설이 필요합니다.

기존 기반은 Sui 지갑 소유권, Walrus 저장, Seal 비공개 보관을 연결한 Web3 베타 구현입니다.
**로컬 구현·검증까지 진행했으며 실제 테스트넷 배포와 저장/복호화 왕복은 아직 수행하지 않았습니다.**

진행 내역과 미완료 범위는 [Web3 구현 기록](docs/WEB3_IMPLEMENTATION.md), 검사 결과는
[검증 기록](docs/P0_VALIDATION.md), 전체 설계는 [전환 계획](docs/WEB3_NATIVE_PLAN.md)에 있습니다.

## 로컬 실행

Node 24와 npm 11을 사용합니다. 루트에서:

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run dev:api:local
```

다른 터미널에서 `npm.cmd run dev:web`을 실행하고 http://127.0.0.1:3000 에 접속합니다.
Docker 없는 로컬 서버는 PGlite를 사용하며 기본 설정에서는 AI 제공자를 연결하지 않습니다.
운영 API는 Postgres가 필요합니다. `docker compose -f infra/compose.yaml up --build`로
Postgres와 API를 함께 실행할 수 있습니다.

체인·저장 기능을 실행하려면 `apps/web/.env.local.example`을 `.env.local`로 복사하고
실제 테스트넷 Move 패키지 ID, Walrus publisher/aggregator, Seal 키 서버를 설정합니다.
설정이 없으면 생성·저장을 거절합니다. 지갑 연결과 로컬 서명 인증은 별도로 확인할 수 있습니다.
웹 환경변수에는 비밀키를 넣지 않습니다. 변경 후 다시 빌드해야 합니다.

AI 대화는 `apps/api/.env.example`에 설명한 서버 전용 제공자 설정이 필요합니다.
환경변수는 API 프로세스에 주입합니다. 자동 dotenv 로딩은 하지 않습니다.

## 검증

```powershell
npm.cmd run typecheck
npm.cmd run check:backend
npm.cmd test
npm.cmd run build
npm.cmd run test:web3
npm.cmd run build:static
```

Move는 Sui CLI `testnet-v1.79.0`으로 `sui move test --path contracts/everyday`를 실행합니다.
이 작업 환경에서는 `.local-tools/sui-1.79.0/sui.exe`를 사용할 수 있습니다.
브라우저 검사는 설치된 Edge를 사용합니다. CI에서는 Playwright Chromium을 설치하고
`PLAYWRIGHT_CHROMIUM=1`로 실행합니다. 정적 결과는 `apps/web/out/`에 생성됩니다.

## 구조

```text
apps/web              기본 Web3 화면, 지갑·체인·암호화·복원 클라이언트
apps/api              Fastify 인증·AI gateway, Postgres 운영 원장
contracts/everyday    Market 이용권·정산·캐릭터 금고, 기존 Character/UserVault
packages/contracts    공통 TypeScript 계약
infra                 Postgres + API Compose, API Dockerfile
legacy                기존 Spring과 이전 프론트 소스
```

## 기존 기능 비교

일반 실행에서는 Spring API를 호출하지 않습니다. 기존 화면은 비교 실행에서만 활성화됩니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File legacy/spring/scripts/baseline.ps1 serve
```

다른 터미널에서 `npm.cmd run baseline:build` 후 `npm.cmd run test:e2e`를 실행합니다.
이 모드는 로컬 H2 Spring 서버와 고정 AI 응답을 사용합니다. 사용 후 일반 Web3 실행으로
돌아갈 때 `npm.cmd run build` 또는 `npm.cmd run build:static`으로 다시 빌드합니다.

현재 이미지 생성 worker, 자동 보관 갱신·가스 후원, checkpoint indexer, Walrus Sites 게시,
mainnet 운영 구성은 미완료입니다. 개인 편집 내용은 보관 준비 전까지 메모리 임시 상태이며,
Seal 암호화가 끝난 보관 대기 파일부터 IndexedDB 재개를 지원합니다.
