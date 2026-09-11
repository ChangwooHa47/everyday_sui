# Web3 전환 구현 기록 — 2026-09-08

현재 결과는 **로컬에서 검증한 Web3 베타 구현**이다. 실제 Sui 테스트넷 패키지 게시,
Walrus 업로드, Seal 키 서버 왕복을 수행한 배포 완료 상태가 아니다.

## 이번에 바뀐 동작

기본 웹 실행에서 데모 로그인과 Spring 호출을 차단했다. 루트와 기존 deep link는
새 지갑 화면을 보여준다. 예전 화면은 `baseline:*` 실행에서만 활성화한다.

| 기능 | 구현 |
|---|---|
| 지갑 | 새 Mysten dApp Kit + Sui gRPC, 테스트넷 선택, 연결·계정 전환 |
| API 인증 | 256비트 nonce, 5분 challenge, 정확한 메시지의 실제 서명 검증, 원자적 1회 소비 |
| 세션 | Postgres에 토큰 hash만 저장, 30분 만료, Origin 바인딩, 로그아웃·지갑 전환 폐기 |
| 지원 서명 | Ed25519, Secp256k1, Secp256r1을 실제 키로 테스트. 기타 방식은 명시적으로 거절 |
| 캐릭터 | Move owned 객체, 공개 manifest 참조·SHA-256·revision, 외부 이전 가능 |
| 개인 보관함 | `store` 없는 Move 객체, owner·정확한 vault ID를 검사하는 Seal 정책 |
| 저장 | 버전 1 canonical JSON, 브라우저 Seal 암호화, Walrus publisher 업로드, aggregator 재조회·hash 검사 |
| 재개 | IndexedDB에 공개 파일 또는 암호문과 업로드 참조 저장, 서명 취소 후 재사용 |
| 보관 거래 | 서명한 bytes의 digest를 제출 전에 저장, 결과 불명은 같은 digest로 조회, 자동 새 거래 금지 |
| 복원 | 주소 소유 객체 전체 페이지 조회 → BCS 디코딩 → Walrus → Seal → schema/package/revision 검사 |
| 내보내기 | 공개 원본·암호문, 열린 기록의 명시적 평문 export, 복원 참조 목록 |
| 개인 설정 | 캐릭터별 개인 이름·성격·말투·호칭을 암호화 보관함에 저장 |
| 사진 | 2MB 이하 PNG/JPEG/WebP 직접 추가, 전체 보관함 8MB 제한, 암호화 저장·복원·다운로드 |
| 대화 | 일반/사용자 입력 에피소드 분리, turn ID, 최근 문맥 기반 TS AI gateway, 명시적 대화 시작 |
| AI 운영 | 인증, 일별 주소당 50회 제한, 원자적 quota 증가, 요청 중복 방지, 결과 불명 자동 재요청 금지 |
| DB 개인정보 | AI 프롬프트·완료 본문을 저장하지 않고 입력 hash와 상태만 운영 원장에 저장 |
| 인프라 | 실제 Postgres+API Compose, Docker 없는 로컬용 PGlite 실행, 기존 비교 CI 보존 |

## 실행

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run dev:api:local
```

다른 터미널에서 `npm.cmd run dev:web` 후 http://127.0.0.1:3000 접속.
로컬 API는 `.local-tools/everyday-pglite`에 인증 DB를 보관한다. 이 실행 모드는 AI
제공자를 연결하지 않는다. 운영 API는 `DATABASE_URL`이 필수이며 Postgres를 사용한다.
Compose는 `docker compose -f infra/compose.yaml up --build`로 실행한다.

`apps/web/.env.local.example`을 `.env.local`로 복사하고 아래 공개 설정을 채운다.

1. `contracts/everyday`를 검토한 다음 전용 테스트넷 지갑으로 게시한 패키지 ID.
2. 같은 테스트넷의 Walrus publisher와 aggregator URL. publisher는 브라우저 CORS를
   지원해야 한다. 외부 공개 무인증 publisher를 운영하는 배포 템플릿은 제공하지 않는다.
3. 독립 Seal 키 서버 2개 이상의 object ID와 threshold. SDK의 authenticity 검증을 유지한다.
4. API 주소와 `WEB_ORIGINS`의 실제 프론트 Origin. API 비밀키는 서버 환경에만 둔다.

환경 설정이 없으면 동작을 거절한다. 가짜 저장 성공이나 가짜 AI 응답으로 대체하지 않는다.
변경 후 웹을 다시 빌드한다. `NEXT_PUBLIC_LEGACY_BASELINE`은 일반 실행에서 설정하지 않는다.

## 실제 사용 순서

1. 지갑 연결 → 자산 새로고침.
2. 공개 이름·소개 게시에 동의 → Walrus 업로드 → 지갑에서 캐릭터 생성 승인.
3. 개인 보관함 생성 → 지갑으로 열기.
4. 개인 설정·사진·대화 추가 → **암호화 후 보관 확정**.
5. 다른 브라우저에서 같은 지갑 연결 → 자산 새로고침 → 개인 기록 복원.
6. 캐릭터 이전 후 새 소유자는 공개 캐릭터만 받고, 이전 지갑의 개인 기록은 받지 않는다.

AI 사용은 별도 API 로그인이 필요하지만, 1~6의 자산·저장·복원 자체는 API 세션이 필요 없다.
AI 제공자에게 전송하는 최근 문맥과 설정은 그 제공자가 볼 수 있다.

## 남은 구현과 검증

- 실제 테스트넷 두 지갑의 생성→업로드→복원→외부 이전 시험, Seal 키 서버 장애 시험.
- Move가 Walrus certification을 직접 검증하는 결합. 현재는 publisher 응답과 byte hash를 확인한다.
- 이미지 생성 worker, 영속 job/outbox/lease, 제공자 receipt 조회, 부분 완료와 재생성 비용 처리.
- 기존 AI 인터뷰/초상 후보/포토부스 생성/Soul ID, 기존 에피소드 카탈로그의 새 UI 이전.
- 암호화된 자동 로컬 초안. 현재 **보관 준비 전 편집은 메모리 임시 상태**이고 새로고침·지갑 전환 시 사라진다.
  보관 버튼으로 Seal 암호화가 끝난 뒤부터 IndexedDB 재개를 지원한다.
- 보관함 전체를 하나의 암호화 blob으로 저장하는 초기 모델이다. 대용량 파일 분리·대화 segment/hash chain·quilt는 미구현이다.
- 업로드 timeout 직후 응답을 받지 못하면 provider의 업로드 여부를 알 수 없다. 재시도 저장 비용은 아직 완전히 방지하지 못한다.
- 새 revision과 충돌한 대기 파일은 백업→대기 해제→최신 복원 후 수동 재작성해야 한다. 자동 merge는 없다.
- 비공개 원본 export는 키 복구를 보장하지 않는다. 암호문 import와 지갑 교체 정책은 별도 작업이다.
- 저장 Blob object/receipt 상세 원장, epoch 현재값 조회·자동 연장·가스 및 WAL 후원·전역 비용 한도.
- 체크포인트 indexer, 대규모 목록 검색, 운영 DB 백업·복원. 현재 목록은 Sui에서 직접 조회한다.
- Walrus Sites 실제 게시, portal deep link·Origin·CSP 실측, 실제 운영 Postgres와 Docker 이미지 실행.
- mainnet 배포·업그레이드 정책·키 관리·운영 감사를 수행하지 않았다.

위 항목을 완료하기 전에는 원래 계획의 P1~P6 전체 완료나 운영 서비스 출시로 간주하지 않는다.
서명 검증/프론트/Move 로컬 테스트와 실제 외부 네트워크 인수 테스트는 구분한다.

## 근거 문서

- [Mysten dApp Kit Next.js](https://sdk.mystenlabs.com/dapp-kit/getting-started/next-js)
- [Sui gRPC SDK](https://sdk.mystenlabs.com/sui/clients/grpc)
- [Walrus HTTP 저장 응답](https://docs.wal.app/docs/http-api/storing-blobs)
- [Seal 공식 저장소](https://github.com/MystenLabs/seal)
- 설치된 SDK의 타입 선언과 소스를 기준으로 컴파일했다. 현재 설치한 Seal은 문서 예시의
  extension 대신 실제 export인 `SealClient`를 사용한다.
