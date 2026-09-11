# 배포 코드 리뷰 및 검증 — 2026-09-11

이번 리뷰는 담당 에이전트의 코드 검토와 실제 실행 검증이다. 별도 독립 보안 감사는 아니다.

## 수정한 결함

1. API가 Railway의 PORT를 무시했다. PORT를 최우선으로 사용하고 운영 기본 호스트를 0.0.0.0으로 변경했다. 잘못된 PORT는 로컬 API_PORT로 숨기지 않고 실패한다.
2. readiness가 일반 요청 quota에 묶이고 DB 실패에 일반 500을 반환했다. quota를 제외하고 DB 장애에 명시적으로 503을 반환한다.
3. Postgres 재시작 시 idle connection 오류를 받을 핸들러가 없었다. pg pool 오류를 처리해 프로세스를 유지하며, DB가 복구되기 전에는 readiness와 DB 의존 요청이 성공하지 않는다.
4. 신규 Railway 서비스에 구형 Config as Code를 적용하라는 안내가 부정확했다. 해당 JSON 파일을 제거하고 서비스별 RAILWAY_DOCKERFILE_PATH 및 healthcheck 설정으로 통일했다.
5. 웹의 공개 API 주소 누락 오류가 Invalid URL만 출력했다. 필요한 변수와 재빌드 방법을 설명하도록 변경했다. localhost로 조용히 대체하지 않는다.
6. 기존 testnet bootstrap은 모든 조회 오류를 not-found로 취급했다. 새 infra/deploy-testnet.mjs는 명시적인 TransactionError/notFound에서만 같은 서명 거래를 제출하고 provider 실패 시 중단한다. 소스 hash, sender, digest를 재검사하고 성공 후 Admin/UpgradeCap 소유권과 package 연결을 검증한다.

## 통과한 검증

- `npm run check:backend`: API 16개, Move 20개 테스트 통과.
- `npm run build`: 공통 패키지, API, 웹 빌드 통과. 이후 API의 pg 오류 핸들러 변경은 API Docker 재빌드 및 check:backend로 다시 검증했다.
- API 및 웹 Linux Docker 이미지 실제 빌드 성공. 웹은 검증용 공개 Origin `https://api.example.com`을 build ARG로 사용했다.
- `node infra/smoke-deployment.mjs`: 일회용 Postgres 17, API, 웹 컨테이너와 전용 네트워크를 생성해 검증 후 제거한다.
- 실제 DB 초기 스키마 적용, 외부 연결 가능한 API PORT=8080/API_PORT=3001 우선순위, 65회 readiness 호출, 허용 Origin의 CORS preflight 통과.
- 웹 PORT=8090, /market, /viewer, SVG, JavaScript chunk HTTP 200. 양쪽 컨테이너 non-root(uid 1000) 실행 확인.
- Postgres 중단 시 readiness 503/liveness 200, 재시작 후 readiness 200 복구 확인. 초기 smoke harness의 2초 timeout은 DB 연결 제한 5초보다 짧아 실패했고, 15초로 수정 후 전체 통과했다.
- 실제 testnet 게시 시뮬레이션, 게시 성공, Admin/UpgradeCap 소유권 및 package 연결, package immutable 소유권 확인.
- 게시 명령을 재실행하여 동일 digest와 동일 객체를 확인했다. 새 거래를 서명/게시하지 않았다.
- 게시 후 별도 gRPC 조회에서도 success=true를 확인했다. 실제 가스 순지출은 `49026680` MIST이며 전용 지갑 잔액은 `950973320` MIST였다.
- 게시 시 생성된 Move.lock의 의존성 revision을 저장하고 경로 구분자를 이식 가능한 `/`로 정규화한 뒤 Move 테스트 20개를 다시 통과했다.

컨테이너 검증 재현:

```powershell
docker build -f infra/Dockerfile.api -t everyday-api:deployment-review .
docker build -f infra/Dockerfile.web --build-arg NEXT_PUBLIC_API_BASE=https://api.example.com -t everyday-web:deployment-review .
node infra/smoke-deployment.mjs
```

## Move 검토 범위

market.move의 creator/operator 권한, 정확한 구매 금액, u128 중간 계산을 사용하는 정산, non-transferable License, Move-controlled treasury, 선물 allowlist/건별·일별 한도/intent 재사용 차단을 검토했다. vault.move의 owner 및 정확한 Seal identity 검사와 상품/개인 기억 분리도 검토했다. 이번 작업에서 Move 소스 자체는 변경하지 않았다.

operator는 마켓 패키지를 복호화할 수 있다. UpgradeCap은 배포 지갑이 보유하므로 향후 업그레이드 권한이 남아 있다. Walrus 참조 길이와 hash 저장은 실제 보관 증명이 아니다. 이 신뢰 경계를 보장 이상의 설명으로 바꾸지 않았다.

## 남은 검증 범위

Railway CLI는 미로그인 상태이므로 실제 서비스 변수, 도메인 target port, 배포 로그를 직접 확인하지 못했다. GitHub 코드 업로드와 Railway 배포 성공은 구분한다. 기존 서비스 설정은 DEPLOYMENT.md에 맞춰야 한다.

testnet **패키지 게시**는 완료했다. 실제 상품 구매/정산 거래, Walrus 저장, Seal 복호화, MemWal 개인 기억 왕복, P1 선물 실거래는 이번 게시 검증에 포함되지 않는다. 과거 docs의 faucet 429/미배포 기록은 이번 기록 이전의 상태다.
