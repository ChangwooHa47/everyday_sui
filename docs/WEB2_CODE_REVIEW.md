> 초기 Web2 코드 조사 기록이다. 현재 실행 순서는 [Web3 전환 계획](WEB3_NATIVE_PLAN.md)을 따른다.

**Everyday 코드 조사 및 리팩토링 작업 계획**

작성일: 2026-09-07. 목표는 기존 캐릭터 생성·대화·에피소드·사진 기능을 유지하면서 구조를 정리하고, 이어서 Sui/Walrus에 기존 데이터와 소유 정보를 연결하는 것이다.

이번에는 소스와 호출 관계를 조사하고 계획만 작성했다. 애플리케이션 코드 변경, 의존성 설치, 서버 실행, DB 변경, 외부 AI 호출, 체인 배포는 수행하지 않았다. 아래 실행 검증 항목은 앞으로 할 일이다.

**조사 기준과 현재 구조**

| 대상 | 조사 기준 |
|---|---|
| 프론트엔드 | `joh537874/everyday`, 커밋 `81ca6eb406499f657806a155b9414a04fbb1d724` |
| 백엔드 | `joh537874/everday_project_backend`, 커밋 `cb071ac2b1cc4e6a2e90609434593758fec46652` |
| 프론트 구성 | 페이지 15개, Next.js API route 8개. lockfile 기준 Next.js 15.5.20, React 19.2.7, TypeScript 5.9.3 |
| 백엔드 구성 | main Java 파일 81개. Java 21, Spring Boot 3.5.16, JPA, MySQL, JWT |
| 현재 검증 코드 | 백엔드는 `contextLoads` 1개. 프론트의 tone/measure 스크립트는 실제 AI 호출을 통한 실험 도구이며 자동 회귀 테스트가 아님 |
| 로컬 환경 확인 | Node와 Docker 실행 파일은 PATH에서 확인. Java와 MySQL CLI는 PATH에서 발견되지 않음. 다른 위치의 설치 여부와 Docker 실행 상태는 미확인 |

현재 주요 제품 흐름은 `화면 → lib/api.ts → Spring Controller → Service → JPA / LlmClient / ImageClient`이다. 프론트의 `/api/chat` 등을 주요 화면이 호출하는 구조로 오해하지 않는 것이 중요하다.

백엔드는 이미 character/chat/episode/photo/auth/user 단위로 나뉘어 있고, `LlmClient`와 `ImageClient` 인터페이스도 있다. 이 경계를 활용해 책임이 섞인 부분을 정리한다.

| 기능 | 실제 경로와 저장 위치 | 리팩토링 시 보존할 기준 |
|---|---|---|
| 진입·로그인 | `/` → `ensureAuth` → 공용 데모 계정 로그인 → JWT localStorage | 로그인 성공·실패·만료와 캐릭터 유무에 따른 이동 |
| 캐릭터 생성 | `/create` → interview/compile → Character DB 저장 → 비동기 초상 생성 → gallery 폴링 → select-portrait | 관계·성별·자유 입력·문답·이름·생일·프로필·초상 선택 |
| 캐릭터 설정 | `/character`, `/edit`는 redirect → PATCH 설정/호칭 | 외모·성격·말투·호칭의 저장과 대화 반영 |
| 일반 대화 | `/chat` → Spring messages API → DB + Anthropic | 대화 순서, 캐릭터 격리, 첫 인사, 실패 시 화면·저장 상태 |
| 에피소드 | `/episode` → start → `/chat?episode=...` → 별도 messages API | 카탈로그, 스타터, 일반 대화와 에피소드 대화의 분리 |
| 포토부스 | `/photobooth` → Spring PhotoService → LLM 프롬프트 → Higgsfield → Photo DB | 컨셉·자유 입력, 사진 결과, 성공·실패별 포인트 처리 |
| 갤러리 | `/gallery`, `/character` 갤러리 탭 → 동일 gallery API | 캐릭터별 사진, 선택 전환, 결과 조회 |
| 홈·채팅 목록 | 캐릭터 목록 + 캐릭터별 전체 메시지 조회 | 카드 선택, 마지막 메시지, 대화 시작일 |
| 마이페이지 | `/my` → `/api/me` | 계정·포인트·캐릭터 목록. 구독 등급 응답은 현재 Free 고정 |
| 개발·이전 경로 | `/measure` → Next chat/summarize, `/train` → localStorage + Next image/training API | 주요 제품 경로와 분리해 보존·이식 대상을 명시 |

커뮤니티의 게시물·설정집과 구독 구매는 표시용이다. 채팅방 삭제는 서버 삭제가 아닌 localStorage 숨김이다. 에피소드 COMPLETED는 enum만 있고 완료 전환 로직은 없다. 이 상태들을 먼저 기록해 기능 추가를 리팩토링 완료 조건으로 오인하지 않도록 한다.

**코드에서 확인한 핵심 정리 대상**

| 번호 | 근거 | 확인한 내용과 영향 |
|---|---|---|
| F1 | [lib/api.ts](../apps/web/lib/api.ts), [lib/store.ts](../apps/web/lib/store.ts), [train](../legacy/frontend/app/train/page.tsx) | Spring의 숫자 ID와 이전 localStorage 문자열 ID가 공존한다. 현재 생성 화면이 만든 캐릭터를 이전 train 페이지가 동일 데이터로 읽지 못한다. |
| F2 | [create](../apps/web/app/create/page.tsx) | 1,031줄에 단계 전환, 요청, 폴링, 편집, JSX가 함께 있다. 단계도 0→1→2→3→4→6→7→5로 표현되어 흐름을 추적하기 어렵다. |
| F3 | [create](../apps/web/app/create/page.tsx), [CharacterService](../legacy/spring/src/main/java/com/everyday/backend/character/service/CharacterService.java) | 사진 느낌 입력은 서버에 전달되지 않는다. ‘재생성’은 gallery 재조회다. 초상 생성은 카드 수정·사진 느낌 입력 전에 시작된다. 저장 실패를 무시하고 다음 단계로 진행하는 코드도 있다. |
| F4 | [ChatService](../legacy/spring/src/main/java/com/everyday/backend/chat/service/ChatService.java), [home](../apps/web/app/home/page.tsx), [chatlist](../apps/web/app/chatlist/page.tsx) | 메시지 GET에서 이력이 비어 있으면 AI 인사를 생성·저장한다. 홈의 대화 일수 조회와 목록 미리보기에서도 이 동작이 발생할 수 있다. |
| F5 | [CharacterService.updateCallName](../legacy/spring/src/main/java/com/everyday/backend/character/service/CharacterService.java), [CharacterPromptBuilder](../legacy/spring/src/main/java/com/everyday/backend/llm/prompt/CharacterPromptBuilder.java) | 호칭 필드만 변경하고 저장된 systemPrompt는 갱신하지 않는다. 채팅은 저장된 프롬프트를 사용하므로 새 호칭이 그 경로로 전달되지 않는다. |
| F6 | [PortraitGenerationService](../legacy/spring/src/main/java/com/everyday/backend/character/service/PortraitGenerationService.java), [PhotoService](../legacy/spring/src/main/java/com/everyday/backend/photo/service/PhotoService.java) | 초상은 메모리 내 비동기 작업이고 실패는 로그에만 남는다. 포토부스는 DB 트랜잭션 안에서 외부 생성 완료를 기다린다. 작업 상태·재시작 복구·중복 요청 정책이 없다. |
| F7 | [ChatService](../legacy/spring/src/main/java/com/everyday/backend/chat/service/ChatService.java), [EpisodeService](../legacy/spring/src/main/java/com/everyday/backend/episode/service/EpisodeService.java), [PhotoService](../legacy/spring/src/main/java/com/everyday/backend/photo/service/PhotoService.java) | 최근 메시지 10개 또는 5개만 필요해도 전체 이력을 읽고 자른다. 소유권 검사, 메시지 변환, JSON 코드펜스 제거도 중복된다. |
| F8 | [CharacterResponse](../legacy/spring/src/main/java/com/everyday/backend/character/dto/CharacterResponse.java), [ImageClient](../legacy/spring/src/main/java/com/everyday/backend/image/ImageClient.java), [HiggsfieldImageClient](../legacy/spring/src/main/java/com/everyday/backend/image/HiggsfieldImageClient.java) | soulTrained는 작업 완료가 아니라 soulId 존재 여부다. 저장된 soulId를 실제 이미지 생성 요청의 custom_reference_id로 전달하는 경로는 없다. 이전 TS 경로는 이 파라미터를 지원한다. |
| F9 | [api.ts](../apps/web/lib/api.ts), [chat](../apps/web/app/chat/page.tsx), [gallery](../apps/web/app/gallery/page.tsx) | 인증·HTTP·DTO·활성 캐릭터 상태가 한 파일에 모여 있다. JSON이 아닌 실패 응답 처리와 동시 로그인 합치기가 없다. 채팅은 모든 오류를 정책 거절 문구로 표시하며, 갤러리는 일부 오류를 숨긴다. |
| F10 | [Photo](../legacy/spring/src/main/java/com/everyday/backend/photo/entity/Photo.java), [User](../legacy/spring/src/main/java/com/everyday/backend/user/entity/User.java), [CharacterEpisode](../legacy/spring/src/main/java/com/everyday/backend/episode/entity/CharacterEpisode.java) | 파일 원본은 보관하지 않고 제공자 URL만 저장한다. 포인트 경쟁 요청과 캐릭터별 에피소드 중복 시작을 보호하는 명시적 잠금/버전·복합 유일 제약이 없다. |
| F11 | [application.yaml](../legacy/spring/src/main/resources/application.yaml), [DemoDataSeeder](../legacy/spring/src/main/java/com/everyday/backend/DemoDataSeeder.java), [Next API](../legacy/frontend/app/api) | DB 설정과 데모 인증 설정의 환경 분리가 필요하다. Next 개발 API에는 Spring JWT 보호가 적용되지 않는다. nano-angles는 개인 환경의 hf CLI와 OAuth에 의존한다. |
| F12 | [README](../legacy/frontend/README.md), [백엔드 작업 기록](../legacy/spring/backend_claude.md), [사진 개선 기록](../apps/web/docs/사진-생성-개선-리캡.md) | 문서에 기술된 이전 흐름과 현재 Spring 연결 흐름이 다르다. 기록에 있는 스타일·말투·재생성 개선을 현재 동작으로 간주하면 안 된다. |

F10의 동시성 문제, F6의 커밋 전 비동기 시작과 재시작 손실, 갤러리 전환의 늦은 응답 덮어쓰기는 코드에서 예상되는 위험이다. 실제 재현 여부는 R0 및 해당 수정 단계의 테스트로 확인한다. 프롬프트 반영 누락과 전달되지 않는 입력은 정적으로 확인한 사실이다.

**작업 순서와 완료 기준**

| 순서 | 작업 묶음 | 성격 | 완료 기준 |
|---|---|---|---|
| R0 | 실행 환경과 기존 동작 기준 확립 | 검증 기반 | 새 환경에서 실행 절차를 따라 기동하고, 주요 성공·실패 흐름을 재현할 수 있음 |
| R1 | 제품 경로와 개발·이전 경로 구분 | 구조 정리 | 각 화면/API의 역할과 호출자가 명확하고, 기존 기능·데이터가 보존됨 |
| R2 | 프론트 API·상태·화면 책임 분리 | 구조 정리 | 같은 사용자 흐름과 API 계약을 유지하면서 중복 초기화·대형 페이지를 줄임 |
| R3 | 백엔드 책임·쿼리·프롬프트 정리 | 구조 정리 | 기존 응답과 컨텍스트 순서를 유지하고, 공통 정책의 수정 지점이 명확해짐 |
| R4 | 확인된 동작 오류 수정 | 동작 변경 | 조회의 부수 동작, 호칭 반영, 오류 표시, 잘못된 선택을 회귀 테스트로 검증 |
| R5 | 외부 생성 작업과 DB 변경 분리 | 실행 기반 변경 | 생성 지연·실패·부분 성공·재시작·재요청을 상태로 추적하고 포인트 중복 차감을 방지 |
| R6 | 파일 참조와 데이터 내보내기 형식 정리 | 이관 준비 | 기존 URL과 새 저장 참조가 공존하고, 기존 기능 데이터를 명시적 스키마로 직렬화 가능 |
| C1 이후 | 기존 사진 → 캐릭터 → 대화·에피소드 이관 | 체인 연동 | 각 단계에서 업로드뿐 아니라 기존 화면의 조회·수정·재조회까지 검증 |

각 묶음은 독립적으로 검토 가능한 변경 단위로 나눈다. 특히 파일 이동·추출과 동작 수정은 별도 변경으로 남긴다. R0 실행 결과가 나오면 범위와 예상 공수를 다시 산정한다.

**R0 — 먼저 비교 가능한 기준을 만든다.**

- Java 21/MySQL 실행 방법과 환경변수 설정을 정리한다. Node 의존성은 기존 lockfile을 기준으로 설치한다.
- DB를 테스트용으로 분리하고, 데모 시드·JWT 기본값·AI 키 설정을 실행 환경별로 구분한다. 현재 `ddl-auto: update` 상태를 기록하고 이후 스키마 변경은 버전 있는 마이그레이션으로 관리한다.
- 프론트 빌드·타입 검사, 백엔드 컴파일·테스트의 변경 전 결과를 기록한다. `.env` 파일을 Spring이 자동으로 로드한다고 가정하지 않고 실제 전달 방법을 문서화한다.
- 테스트용 `LlmClient`/`ImageClient` 대체 구현과 고정 데이터를 사용해 자동 검증에서 실제 유료 API를 호출하지 않도록 한다.
- 생성 → 설정 수정 → 채팅 → 에피소드 → 사진 → 갤러리 흐름의 기준 화면·API 요청·응답을 기록한다. 현재 오류는 별도로 기록하고 ‘원래 동작’이라는 이유로 영구 고정하지 않는다.

**R1 — 이전 코드의 기능 차이를 정리한 뒤 분리한다.**

- 주요 제품의 데이터 원본은 현재 Spring 경로로 통일하는 것을 기본안으로 삼는다.
- `/measure`와 tone/measure 스크립트는 개발 도구로 분리한다. 개발 API는 배포 환경에서 명시적으로 비활성화하거나 인증한다. 단순히 Next route group 이름을 바꾸는 것으로 비공개가 되지는 않는다.
- `/train`과 photo/interview/compile/recompile 이전 API는 호출 관계와 기능 차이를 표로 기록하고 보존한다. 호출자 검색만으로 외부 사용이 없다고 단정해 삭제하지 않는다.
- 현재 제품이 참조하는 `RELATIONSHIPS` 등 기본 데이터는 프로토타입의 프롬프트·가격표와 분리한다.
- localStorage 데이터는 자동 삭제하지 않는다. 이전 캐릭터를 가져오는 작업은 기존 데이터 형식을 확인한 후 별도 이관 작업으로 다룬다.
- 사진 느낌·재생성·Soul 학습의 빠진 연결은 아래 ‘별도 기능 보완’ 목록에 남긴다. 이전 구현을 통째로 합치면서 AI 출력까지 바꾸지 않는다.

**R2 — 프론트는 페이지 구성, 기능 상태, 서버 통신을 나눈다.**

권장 배치 예시:

```text
frontend/
  app/                         라우팅과 페이지 조립
  features/
    character/                 생성 단계, 설정 편집, 활성 캐릭터
    chat/                      일반·에피소드 대화 상태
    episode/                   카탈로그와 시작 흐름
    photo/                     생성 상태, 갤러리, 이미지 뷰어
  lib/
    api/                       HTTP 공통 처리, DTO, 기능별 API
    auth/                      세션과 데모 로그인 전략
  components/                  실제 공유하는 UI
```

- `api.ts`는 우선 호환 export를 유지하면서 내부를 분리한다. DTO 필드·URL 변경은 단계적으로 진행한다.
- 활성 캐릭터 선택, 유효하지 않은 저장 ID 처리, 빈 목록 이동, 요청 취소/오래된 응답 무시를 공통화한다. 사용자·환경이 바뀌면 이전 선택·숨김 상태가 섞이지 않도록 저장 키를 구분한다.
- 인증 시도는 진행 중인 요청을 공유하도록 하고, HTTP 상태·오류 코드·메시지·JSON 파싱 실패를 구조화한다. 실패한 생성 POST를 무조건 재전송하는 정책은 넣지 않는다.
- create는 의미 있는 단계 이름과 상태 전환 함수로 정리하고 각 단계 UI를 추출한다. 생성 요청과 초상 폴링을 별도 훅으로 나눈다.
- 폴링은 character/job ID 기준으로 동작하게 한다. 현재처럼 편집 중 compiled 객체가 바뀔 때마다 대기 시간이 초기화되지 않도록 한다.
- 갤러리 그리드·뷰어, 로딩·오류·재시도 UI 중 실제 중복된 부분을 공통화한다. 화면 디자인은 기존 기준과 비교한다.

**R3 — 백엔드는 기존 패키지를 활용해 책임을 나눈다.**

- 공통 소유권 조회를 추출하되 현재 존재하지 않는 캐릭터/타인 캐릭터의 404·403 계약을 유지한다.
- CharacterService에서 인터뷰, 프로필 컴파일, 프롬프트 조립을 분리한다. 프롬프트 문구·모델 변경은 구조 추출과 별도로 다룬다.
- 일반·에피소드 대화의 최근 이력 조회와 LLM 메시지 변환을 공유한다. 에피소드 경계와 캐릭터 소유 검증은 명시적으로 유지한다.
- 최근 N개를 DB에서 제한 조회하고 시간·ID 기준으로 순서를 안정화한다. 목록 미리보기와 최초 메시지 시각은 전체 대화를 내려받지 않는 조회로 제공한다.
- 외부 AI JSON의 파싱·필수값 검증과 오류 분류를 공통화한다. 파싱 실패를 인터뷰 완료로 처리하는 현재 fallback은 동작 수정 단계에서 명시적으로 변경한다.
- `LlmClient`·`ImageClient`를 확장할 때 프롬프트, 모델, 생성 파라미터, 작업 ID와 결과를 구분한다. 범용 서비스 하나에 DB·AI·체인 처리를 모두 넣지 않는다.

**R4 — 작은 동작 수정부터 검증한다.**

- 호칭 변경 후 일반·에피소드 대화에 새 호칭이 전달되게 한다. 저장된 프롬프트를 재생성하거나 최신 설정으로 조립하는 책임을 한 곳으로 모은다.
- 메시지 조회를 순수 조회로 만들고 첫 인사는 채팅 진입의 명시적 초기화로 옮긴다. 중복 초기화에서도 인사는 한 번만 생성·저장되도록 한다. 홈/목록과 채팅 화면을 함께 변경한다.
- 프로필 사진 선택은 본인 캐릭터의 PROFILE 사진인지 검사한다. 현재는 같은 캐릭터의 PHOTOBOOTH 사진도 ID로 선택할 수 있는 경로다.
- 네트워크·인증·입력·AI·이미지 생성 실패를 구분한다. 오류가 났는데 빈 갤러리 또는 정책 거절로 보이는 흐름, 수정 실패 후 다음 단계로 넘어가는 흐름을 고친다.
- 사진 느낌 입력·재생성 버튼처럼 동작과 표현이 다른 부분은 기준 동작에 맞춰 표현을 정리한다. 실제 생성 기능 연결은 아래 별도 범위로 남긴다.

**R5 — 이미지 생성과 체인 연동에서 함께 쓸 작업 처리 기반을 만든다.**

- 우선 초상·포토부스에 한정해 DB에 생성 작업을 기록한다. 요청 ID, 제공자 작업 ID, 입력 버전, 진행 상태, 결과, 실패 이유를 보관한다.
- 작업 접수·포인트 예약·결과 확정은 짧은 DB 트랜잭션으로 하고, 외부 생성 대기는 트랜잭션 밖에서 처리한다. 동시 요청의 잔액 검증과 실패 시 예약 해제도 같은 정책으로 묶는다.
- 작업은 원본 DB 변경이 커밋된 뒤 실행한다. Spring의 커밋 후 이벤트는 실행 시점 제어에 사용할 수 있지만, 재시작 복구를 보장하려면 DB 작업 기록과 재조회가 함께 필요하다. [Spring 트랜잭션 이벤트](https://docs.spring.io/spring-framework/reference/data-access/transaction/event.html)
- 기존 제공자 job ID가 있으면 그 작업을 재조회한다. 생성 요청 결과가 불명확한 상태에서는 새 유료 생성을 무조건 다시 제출하지 않는다.
- 초상 4장 중 일부만 성공해도 완료/부분 성공/실패를 구분한다. 프론트는 gallery 장수 대신 작업 상태를 기준으로 대기를 끝낸다.
- 결과 저장 뒤 작업 완료 표시가 실패하거나 프로세스가 재시작되어도 사진·포인트가 중복 반영되지 않도록 유일 키와 상태 전이를 검증한다.
- 오래 기다리는 채팅 API도 DB 트랜잭션 범위를 줄이되, 실패한 사용자 메시지 보존·재전송·응답 순서 정책을 먼저 정한다. 이 변경은 이미지 작업과 별도 단위로 검토한다.

**R6 — 저장 위치가 바뀌어도 기능 코드가 유지되는 데이터 경계를 만든다.**

- Photo의 제공자 원본 URL과 서비스가 관리하는 파일 참조를 구분한다. 기존 사진 URL은 읽을 수 있게 유지하고, 새 저장 방식은 별도 참조로 추가한다.
- DB ID, 제공자 job ID, Walrus blob ID, Sui object ID는 서로 다른 식별자로 취급한다. 기존 숫자 ID를 Sui 주소처럼 재사용하지 않는다.
- 캐릭터 설정, 사진 메타데이터, 일반/에피소드 대화를 각각 스키마 버전이 있는 직렬화 형식으로 정의한다. JPA 엔티티 전체를 그대로 직렬화하지 않는다.
- 저장 어댑터의 경계는 파일 쓰기·읽기·참조·수명 관리로 좁힌다. 실제 Walrus 저장 시 C1에서 구현체와 함께 도입하고, 호출되지 않는 빈 추상화만 미리 늘리지 않는다.
- DB 스키마는 참조 필드 추가 → 새 데이터 저장 → 기존 데이터 점진 이관 → 읽기 전환 순서로 바꾼다. 원본 삭제를 이관 작업에 묶지 않는다.

**리팩토링 뒤 기존 기능을 Sui/Walrus로 연결하는 순서**

AI 추론은 기존 서버와 제공자가 수행하고, 생성된 데이터의 저장과 사용자 소유·변경 권한을 연결한다. Walrus는 blob 저장을, Sui는 객체 소유와 변경 권한을 제공한다. [Walrus 구조](https://docs.wal.app/docs/getting-started), [Sui 객체 소유](https://docs.sui.io/develop/objects/object-ownership)

| 단계 | 기존 기능의 이관 내용 | 통과 조건 |
|---|---|---|
| C1 사진·갤러리 | 생성 이미지의 실제 바이트를 Walrus에 저장. 업로드 상태와 파일 참조를 DB에 기록 | 저장된 파일을 다시 읽어 바이트/해시를 검증하고 기존 갤러리에서 표시. 저장 실패와 생성 실패를 구분 |
| C2 캐릭터 | 지갑 서명으로 기존 계정과 주소를 검증해 연결. 캐릭터 설정·프로필 참조를 Walrus에 저장하고 Sui 객체에 소유 및 최신 버전 참조 기록 | 본인만 변경 가능, 타인 변경 실패, 새로고침 시 확정된 최신 버전 표시 |
| C3 대화·에피소드 | 기존 원문과 에피소드 데이터를 암호화한 묶음으로 보관. 일반/에피소드 구분과 순서 유지 | 복원한 기록이 원문과 일치하고 기존 채팅 화면에서 읽힘. 다른 사용자에게 평문 노출되지 않음 |
| C4 기존 데이터 이관 | 테스트 데이터부터 소량씩 이전하고 완료 상태·실패·재시도를 기록 | 중복 실행에도 중복 기록이 생기지 않고, 기존 URL/DB 읽기에서 전환 가능 |

- C1은 testnet에서 시작한다. 저장 완료·읽기 가능·수명 만료를 따로 확인한다. testnet의 데이터 지속성은 보장되지 않는다. [Walrus 시작 가이드](https://docs.wal.app/docs/getting-started)
- 사진의 공개 범위, 개인 대화의 암호화와 키 보관·복구, 업로드 비용 부담 주체와 서명 경로를 해당 이관 단계 전에 확정한다. Walrus에 저장된 평문은 공개 접근 가능하며 보관 기간 연장이 필요하다. [Walrus 데이터 관리](https://docs.wal.app/docs/getting-started)
- 체인으로 이관한 소유권·최신 버전은 확인된 Sui 상태를 기준으로 하고 DB는 조회용 인덱스로 맞춘다. Walrus 업로드와 Sui 갱신은 하나의 DB 트랜잭션이 아니므로 단계별 성공 상태를 보관하고 실패한 단계부터 복구한다.
- 기존 포인트는 현재 사용량 정책으로 유지한다. 토큰 결제·구독·거래는 기존 구현의 단순 이관이 아니므로 이 계획에 포함하지 않는다. 장기 기억 추출·새 AI 기능도 이번 목표와 분리한다.

**별도 기능 보완으로 남길 항목과 기본안**

| 항목 | 기본안 |
|---|---|
| 사진 느낌·실제 재생성 | 현재의 미연결 상태를 먼저 문서화. R5 이후 입력 버전과 생성 작업을 연결하는 별도 변경으로 구현 범위 결정 |
| Soul 학습 | 이전 코드 보존. 제품에 연결할 경우 다중 사진 입력·완료 상태 조회·생성 요청의 Soul ID 전달을 함께 처리 |
| 이전 프로토타입의 말투·배경·스타일 | 현재 응답과 비교할 수 있게 보존. 프롬프트 품질 변경은 구조 정리와 별도 검증 |
| 채팅방 삭제 | 현재는 숨김이라는 동작을 명확히 표시. 서버 삭제·Walrus 보관 해제와 같은 데이터 정책은 따로 설계 |
| 지갑 로그인 | 리팩토링에서는 인증 책임만 분리. 실제 지갑 연동은 C2에서 계정/주소의 소유 증명을 포함해 구현 |
| 저장 서명·SDK 배치 | R6까지 계약을 정리하고 C1/C2에서 정함. Spring HTTP 어댑터와 TS SDK 경로를 검증한 뒤 선택 |

**검증은 실제로 깨질 수 있는 경계에 집중한다.**

| 영역 | 필요한 검증 |
|---|---|
| 기준 실행 | 프론트 빌드·타입 검사, 백엔드 테스트, 독립된 테스트 DB |
| 인증·소유 | 만료·동시 요청, 사용자 변경 시 상태 격리, 다른 캐릭터/사진 접근 거절 |
| 캐릭터·프롬프트 | 설정과 호칭 저장 후 다음 LLM 요청에 반영, 잘못된 사진 종류 선택 거절 |
| 조회·대화 | 홈/목록 조회에서 AI 생성 0회, 첫 인사 중복 방지, 최근 N개 순서, 일반/에피소드 격리 |
| 프론트 비동기 | 캐릭터 빠른 전환에서 오래된 응답 무시, 생성 단계 이동, 부분 성공·실패 표시 |
| 작업·포인트 | 동시 생성 요청, 실패 시 정산, 재시작 후 기존 job 재조회, 결과 중복 저장 방지 |
| Walrus·Sui | 파일 왕복, 버전 갱신, 권한 검사, 중간 실패 복구, 저장 만료·연장, 암호화 데이터 복원 |

기본 자동 테스트는 고정 응답을 사용하고, 실제 모델의 품질 확인과 실제 testnet 검증은 따로 수행한다. 파일 이동 자체를 확인하는 테스트를 늘리는 대신 관찰 가능한 API·사용자 동작과 데이터 정합성을 검증한다.

2026-09-07 R0 진행 결과: H2와 고정 AI 응답을 사용하는 로컬 실행 기준을 구축했다. 백엔드 5개 테스트·JAR 생성, 프론트 기준 빌드·타입 검사, 실제 Spring API를 사용하는 브라우저 시나리오 1개가 통과했다. 실행 방법과 한계는 [백엔드 기준 실행](../legacy/spring/BASELINE.md), [프론트 기준 실행](../apps/web/BASELINE.md)에 기록했다. Docker 데몬을 사용할 수 없어 MySQL 검증은 남아 있다. 일반 프론트 빌드의 AI 키 의존 문제도 기준 runner로만 우회했으며 R1에서 정리한다.

다음 작업 묶음은 R1이다. R1~R3의 구조 정리, R4~R5의 동작·작업 처리 수정, R6의 데이터 경계 정리까지 검토하고 C1 사진 저장을 연결한다. MySQL 검증은 DB 스키마·트랜잭션 변경 전에 보완한다.
