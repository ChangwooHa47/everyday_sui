# everyday × Blockthon 2026: 백엔드·컨트랙트 기준

## 목표

잘 설계된 AI 캐릭터의 **개인용 비독점 이용권**을 판매한다. 캐릭터 상품은
거래되지만 사용자 대화·취향·관계 기억은 거래되지 않는다.

- P0: 미리보기 → 구매 → 권한 변화, 제작자/캐릭터 정산, 사용자 기억 분리와 두 클라이언트 복원.
- P1: 대화 맥락에 따른 선물 제안 → Move 정책 검증 → 실제 테스트넷 결제.
- 제외: 재판매, 기억 승계, 토큰 발행, 음성, 자체 모델 학습.

새 마켓 작업은 이 문서를 기준으로 한다. 기존 WEB3_NATIVE_PLAN.md 등은 이전 구현 기록이다.
기존 Character 객체 양도 기능을 마켓 이용권 판매로 사용하지 않는다.

## 모노레포

| 경로 | 책임 |
| --- | --- |
| apps/web | 제작·마켓·지갑 서명 UI |
| apps/api | 인증, 카탈로그, 체인 권한 검증, AI gateway, 본인 기억 참조 |
| packages/contracts | 공통 API 타입. DB 모델·키 제외 |
| contracts/everyday | Move 자산, 이용권, 정산, Seal 정책, 캐릭터 금고 |
| infra | Postgres/API 배포 설정 |
| legacy | 이전 Spring/프론트 비교용, 신규 마켓 의존 금지 |

루트 npm workspace와 lockfile 하나를 사용한다. Move도 루트 test:move/build:move로 검증한다.
API 소스를 웹에서 직접 import하지 않는다. 웹과 API의 Sui 로직이 공유될 때 packages/sui로 추출한다.

## 구현 상태

| 영역 | 상태 |
| --- | --- |
| Creator, Listing 게시, License, 정산 | Move 구현·로컬 검증 |
| 선물 허용 상품, 건별/UTC 일별 한도, intent 재실행 차단 | Move 구현·로컬 검증 |
| 카탈로그, 구매 transaction 생성 | API 구현·로컬 검증 |
| 온체인 이용권 검증 | gRPC 어댑터 구현, fixture 검증; 실배포 객체 미검증 |
| 개인 기억 | 기존 참조 레지스트리와 별도로 사용자 계정 기반 MemWal 저장·검색 API 연결 |
| 미리보기 N턴 / 구매 후 서버 채팅 | 연결 완료. 원자적 한도·서버 패키지 사용·구매 권한 검증 통합 테스트 통과 |
| Walrus + Seal 마켓 패키지 왕복 | 서버 암호화·업로드·해시 검증·복호화 경로 구현. 실제 저장 왕복은 미검증 |
| MemWal SDK, 사용자 delegate, 두 번째 클라이언트 | SDK 0.1.6 연동, 사용자 계정/위임 검증, remember/job/recall, /viewer 구현. 실제 기억 쓰기는 미검증 |
| LLM 선물 트리거·worker | 정책 금고 지출 연결 및 불확실한 거래 복구 구현. 현재 실행키는 서버 operator 공용, 금고는 캐릭터별 |
| zkLogin | 미구현. 인증은 일반 지갑 서명만 지원 |
| 실제 테스트넷 배포·결제·가스 후원 | 전용 지갑 생성 후 faucet HTTP 429로 배포 중단. 테스트넷/SDK health 실호출 성공 |

최신 실행 방법·추가 API·검증 범위는 [마켓 실행 가이드](MARKET_RUNBOOK.md)와
[구현·리뷰 기록](MARKET_IMPLEMENTATION.md)을 기준으로 한다. 아래 '다음 구현'은 최초 계획이다.

## Move 자금·권한 모델

1. register_creator → create_listing으로 공유 Listing을 먼저 만든다.
2. Seal identity = Listing ID의 32바이트 BCS. 캐릭터 패키지만 암호화해 Walrus에 저장한다.
3. publish에 blob ID, **암호문** SHA-256, 종료 epoch를 기록한다.
4. purchase는 price와 정확히 같은 Coin<SUI>를 받는다. 캐릭터 몫은
   floor(price × agent_bps / 10000), 나머지는 creator에게 보낸다. 금액은 MIST 정수.
5. 양도 불가능한 License를 구매자에게 지급한다. 구매자 테이블은 Seal 승인에 사용한다.
6. send_gift는 operator만 호출하고 구매자에게만 보낸다. merchant·가격은 Admin이 만든
   GiftProduct에서 읽는다. 호출자가 merchant·가격을 바꿀 수 없다.

**기획 조정:** 일반 주소 지갑에 SUI를 두면 백엔드 키가 정책 밖으로 송금할 수 있다.
지출 제한 대상 자금은 Listing 내부 Balance<SUI> 금고에 둔다. operator 주소의 일반 잔액과
캐릭터 금고 잔액을 UI에서도 구분한다. 캐릭터별 키는 P1에서 실행·가스 지불용으로 연결한다.

일별 한도는 Clock 기준 UTC 자정에 초기화된다. intent는 32바이트이며 Listing 안에서
중복을 영구 거절한다. 실패 거래는 정산 전체가 롤백된다. 판매 중지는 기존 구매자 접근을 취소하지 않는다.
게시된 패키지는 불변이며 새 버전은 새 Listing이다. extend_retention은 종료 epoch만 늘린다.
실제 Walrus 갱신이나 저장 증명은 아니다. blob·해시 길이 검증은 보관 보장이 아니다.

현 코드에는 한도 상향·자유 출금 함수가 없다. UpgradeCap으로 업그레이드할 수 있으므로
운영 전 업그레이드 권한 정책을 정해야 한다. Seal은 접근 제어이며 복제 방지 DRM이 아니다.

## API

인증 요청은 허용 Origin과 Bearer 세션이 필요하다. 사용자는 세션 주소에서만 결정한다.
두 번째 클라이언트는 WEB_ORIGINS에 추가하고 해당 Origin에서 새로 로그인한다.

| 경로 | 의미 |
| --- | --- |
| POST /v1/market/listings | {listingId}. 게시 후 체인 creator만 카탈로그 등록 |
| GET /v1/market/listings?after=…&limit=10 | ID 순 커서 페이지, 최대 20개 |
| GET /v1/market/listings/:listingId | 최신 체인 Listing |
| POST /v1/market/listings/:listingId/purchase-transaction | 사용자 서명 전 transaction JSON |
| GET /v1/market/listings/:listingId/access?licenseId=… | creator 또는 실제 이용권 소유자의 접근 확인 |
| POST /v1/me/relationships/:listingId/memory | 본인 공간 참조 등록·revision 비교 갱신 |
| GET /v1/me/relationships/:listingId/memory | 본인 참조만 조회, 다른 사용자 주소 인자 없음 |

구매 transaction은 Transaction.from(response.transaction)으로 복원하여 사용자 지갑이
서명·전송한다. 성공 후 생성된 License ID로 접근한다. transaction digest만으로 권한을 주지 않는다.
타입의 package ID·실제 객체 소유자·buyer·listing을 모두 검사한다. RPC 장애 시 503으로 실패한다.
중복 구매·만료는 Move가 최종 거절한다. 카탈로그는 비활성 상품도 포함하므로 UI에 상태를 표시한다.
공개 Listing의 암호문 참조는 공개 정보다. 실제 평문 접근 경계는 Seal이다.

기억 참조 body:

```json
{
  "provider": "memwal",
  "spaceId": "opaque-provider-space-id",
  "expectedRevision": 0,
  "consent": true,
  "licenseId": "0x..."
}
```

최초 생성은 제작자/구매 권한을 확인한다. 본인 참조의 이후 조회·갱신은 판매 상태와 독립적이다.
동시 갱신은 현재 revision이 맞는 요청 하나만 성공하고 나머지는 409다.
대화·delegate 비밀키·복호화 키를 넣지 않는다. space ID의 소유권·암호화·provider 권한은
아직 검증하지 않는다. 이 참조만 믿고 서버가 provider 데이터를 자동 복호화하면 안 된다.

## 다음 구현과 통과 조건

1. 전용 testnet 계정으로 Move 배포, Walrus 암호문 업로드/다운로드, MemWal SDK 공간 생성·쓰기·검색을
   각각 1회 실행하고 패키지·blob·거래 ID를 기록한다.
2. 서버 operator의 Seal 패키지 loader를 연결한다. 공개 프리뷰/유료 패키지를 분리하고
   사용자×Listing별 N턴을 DB에서 원자적으로 차감한다. 유료 채팅은 requireMarketAccess를 호출한다.
   가격·상품 프롬프트를 클라이언트 입력으로 대체하지 않는다.
3. 확인한 기억만 provider에 저장하고 사용자별 공간·delegate 권한과 철회를 검증한다.
   A의 공간을 B가 못 읽고 A가 별도 Origin에서 이어 읽는 데모가 통과 조건이다.
4. P1: 비밀 저장소의 실행키, DB intent 상태, LLM 상품 제안, Move 실행 worker를 연결한다.
   응답이 불확실하면 intent/거래를 확인한다. GiftSent 확인 후 선물 영수증을 표시한다.

Sui testnet도 테스트 SUI로 가스를 소비한다. faucet 또는 후원이 필요하다.
가스 0·완전 자율·운영자도 평문을 볼 수 없음·복제 불가로 설명하지 않는다.

## 공식 참고

- [Sui SDK 객체 조회·BCS](https://sdk.mystenlabs.com/sui/clients/querying)
- [Seal 접근 제어](https://www.sui.io/blog/seal-programmable-access-control)
- [Walrus Memory 개념 참고](https://docs.wal.app/walrus-memory/python-sdk/usage/memwal)

현재 SDK는 @mysten-incubation/memwal 0.1.6이다. [TypeScript API](https://docs.wal.app/walrus-memory/sdk/api-reference)를 확인했다.
2026-09-10 실제 중계 서버 /config와 공식 문서의 package ID가 달랐다. 환경 설정에는
probe:testnet으로 확인한 package/registry를 넣고 서버가 일치 여부를 재검사한다.
