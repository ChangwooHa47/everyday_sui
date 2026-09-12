# 검증 기록 — 2026-09-08

> 마켓 피봇 이전 Web3 구현의 과거 검증 기록이다. 현재 화면·아키텍처·테스트 수·배포 상태는 [배포 리뷰](../../infra/DEPLOYMENT_REVIEW.md)를 따른다. 이 문서의 브라우저 검사는 현재 수정본의 검증 결과가 아니다.

이 문서는 기존 README가 참조했지만 누락돼 있던 검증 기록을 보완한다.
과거 실행을 추정하지 않고 이번에 다시 확인한 결과만 적는다.

| 검사 | 결과 |
|---|---|
| `npm run typecheck` | 통과: 공통 계약, API, 웹, 테스트 타입 |
| `npm test` | API 4개 + 웹 저장 포맷 4개 통과 |
| Sui 1.79.0 `move test` | 4개 통과: 캐릭터 외부 이전, 다른 지갑 복호화 거절, 잘못된 Seal identity, stale revision |
| `npm run build` | API와 Next production 빌드 통과 |
| `npm run build:static` | 통과: 기본 Web3 모드의 정적 페이지 16개와 `apps/web/out` 생성 |
| `npm run test:web3` | Edge 1개 통과: 테스트 지갑 + 실제 Ed25519 서명 + 실제 로컬 인증 API |
| Web3 브라우저 세부 | 지갑 변경 시 세션/입력 초기화, 배포 미설정 거절, `/chat` deep link, Spring 요청 0 |
| `npm audit` / `npm audit --omit=dev` | 취약점 0개. Next 15.5.25, PostCSS 8.5.28 override와 lockfile 반영 |
| `docker compose -f infra/compose.yaml config --quiet` | 통과 |
| `npm run baseline:build` + `npm run test:e2e` | 통과: 기존 Spring/H2 실제 HTTP 캐릭터 생성→채팅→에피소드→사진→갤러리 흐름 |

일반 빌드와 비교 모드 빌드는 서로 다른 환경변수를 포함하므로 마지막 빌드 모드에 주의한다.
정적 export 이후 `next start`를 사용하려면 일반 `build`를 다시 실행한다.

실제 Sui/Walrus/Seal 원격 왕복, Docker 이미지 빌드/기동, 운영 Postgres 연동은 검증하지 않았다.
이 컴퓨터의 Docker daemon이 실행되지 않아 Compose 구성 파싱만 확인했다.
인증·AI SQL 테스트는 실제 PostgreSQL 엔진을 사용하는 PGlite에서 수행했다.
브라우저 지갑은 자동화용 Wallet Standard 테스트 지갑이며 일반 지갑 확장과의 실제 거래 테스트를 대신하지 않는다.

브라우저 스크린샷은 `apps/web/test-results/`에 생성된다. 이 폴더는 Git에서 제외된다.
Sui CLI는 로컬 Move 검사 과정에서 사용자 홈의 기본 Sui 설정과 새 개발 지갑을 자동 생성했다.
해당 지갑으로 입금·배포·거래를 실행하지 않았고 지갑 비밀은 프로젝트 파일에 기록하지 않았다.
