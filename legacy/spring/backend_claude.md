# Backend 작업 정리 (Claude 작업 기록)

> 원본 백엔드의 과거 작업 기록이다. 아래 ‘현재 상태’와 후속 지시는 당시 시점에 한정한다. 현재 구현·검증 기준은 [배포 리뷰](../../infra/DEPLOYMENT_REVIEW.md)를 따른다.

이 문서는 Claude Code가 `everyday` 백엔드를 처음부터 구현하면서 진행한 작업, 현재 상태,
그리고 **나중에 이어서 작업할 때 반드시 알아야 할 사항**을 정리한 문서다.
`README.md`가 서비스 기획/스펙 문서라면, 이 문서는 실제 구현 이력 + 운영 노트에 가깝다.

---

## 0. 전제: 이 백엔드의 목표

- **실서비스가 아니라 데모용 MVP.** 확장성, 대규모 트래픽, 완벽한 보안보다 "데모 시연 때 화면
  플로우가 실제로 끝까지 동작하는 것"이 최우선 목표였다.
- LLM(Anthropic Claude)과 이미지 생성(Higgsfield)은 **목업이 아니라 실제 API 연동**으로 구현했다.
  단, 두 서비스 모두 API 키가 없으면 해당 기능만 502 에러를 반환하고 나머지 기능(인증, CRUD 등)은
  정상 동작하도록 설계했다.
- 커뮤니티, 결제(실과금), 실시간 채팅(WebSocket), 푸시 알림은 README의 MVP 범위 정의에 따라
  백엔드에서 아예 구현하지 않았다. 포인트는 "차감되는 숫자"만 구현했고 실제 결제/구독 등급 변경은 없다.

---

## 1. 커밋 구성 (총 11개, 기능 단위)

| # | 커밋 | 내용 |
|---|------|------|
| 1 | `chore(setup)` | Security/JWT/springdoc 의존성, `common` 패키지(BaseTimeEntity, ApiResponse, 예외처리, Security/Swagger 뼈대) |
| 2 | `feat(auth)` | User 엔티티, 회원가입/로그인, JWT 발급·검증 필터 |
| 3 | `feat(llm)` | `LlmClient` 인터페이스 + Anthropic 구현체, 캐릭터 system prompt 빌더 |
| 4 | `feat(image)` | `ImageClient` 인터페이스 + Higgsfield 구현체 (작업 등록 → 폴링) |
| 5 | `feat(character)` | Character/Photo 엔티티, AI 인터뷰 → 컴파일 → 초상 선택 → CRUD |
| 6 | `feat(chat)` | ChatMessage 엔티티, 대화 조회/전송, 첫 인사 지연 생성 |
| 7 | `feat(episode)` | Episode 카탈로그(시드 3종) + CharacterEpisode 진행 상태 + 에피소드 전용 채팅 |
| 8 | `feat(photo)` | 포토부스 생성 API (포인트 차감 포함) |
| 9 | `feat(gallery)` | 캐릭터별 갤러리 조회 API |
| 10 | `feat(mypage)` | `/api/me` 조회·수정 |
| 11 | `chore(demo)` | 데모 시드 데이터, 401 응답 수정, 버그 3건 수정, README/`.env.example` 정리 |

전체 이력은 `git log`로 확인 가능. 각 커밋은 그 시점까지 독립적으로 컴파일·부팅되도록 순서를 잡았다.

---

## 2. 패키지 구조

```
com.everyday.backend
├── common     (BaseTimeEntity, ApiResponse, 예외처리, SecurityConfig, SwaggerConfig, SecurityUtils)
├── user       (User 엔티티 + 포인트, 마이페이지 조회/수정)
├── auth       (JWT 발급/검증, 회원가입·로그인)
├── character  (Character/RelationshipType/Gender, 생성 플로우 전체)
├── chat       (ChatMessage, 일반 채팅)
├── episode    (Episode 카탈로그, CharacterEpisode, 에피소드 채팅)
├── photo      (Photo 엔티티 — 프로필 후보 + 포토부스 결과 공용, PhotoConcept)
├── gallery    (Photo 조회 전용, 자체 엔티티 없음)
├── llm        (LlmClient, AnthropicLlmClient, CharacterPromptBuilder)
├── image      (ImageClient, HiggsfieldImageClient)
├── DemoDataSeeder.java   (데모 계정 + 샘플 캐릭터 자동 시드)
└── BackendApplication.java
```

**의존 방향상 알아둘 점:**
- `character`, `chat`, `photo`, `episode`는 서로 **엔티티 FK 연관관계를 맺지 않고** `characterId`,
  `characterEpisodeId` 같은 단순 Long 컬럼으로만 참조한다. (예: `Photo.characterId`,
  `ChatMessage.characterId/characterEpisodeId`) 이는 패키지 간 결합을 줄이기 위한 의도된 설계다.
  join이 필요하면 서비스 레이어에서 각 리포지토리를 조합해서 처리한다.
- 예외적으로 `Character.user`(User와의 @ManyToOne)와 `CharacterEpisode.episode`(Episode와의
  @ManyToOne)는 실제 JPA 연관관계로 매핑되어 있다.
- `user` 패키지와 `character` 패키지는 서로의 DTO/엔티티를 참조해서 **양방향 패키지 의존성**이
  존재한다 (`MyPageResponse` → `CharacterSummaryResponse` → `Character` → `User`). 자바 컴파일에는
  문제없지만, 나중에 모듈을 분리(멀티모듈 Gradle 등)할 계획이 있다면 이 지점을 먼저 정리해야 한다.

---

## 3. 데이터 모델 요약

- **User**: `email`, `password`(BCrypt), `points`(기본 1200)
- **Character**: `user`, `name`, `birthday`, `relationshipType`(LOVER/CRUSH/FRIEND/ONE_SIDED_LOVE),
  `gender`(FEMALE/MALE/OTHER), `summary`, `appearance`, `personality`, `speechStyles`(List),
  `systemPrompt`(LONGTEXT, LLM 호출용 캐시), `imagePrompt`, `profileImageUrl`, `callName`(호칭),
  `soulId`(이미지 API 인물 일관성용, nullable)
- **Photo**: `characterId`, `type`(PROFILE/PHOTOBOOTH), `concept`, `promptText`, `imageUrl`, `selected`
- **ChatMessage**: `characterId`, `characterEpisodeId`(nullable — null이면 일반 채팅), `sender`(USER/AI),
  `content`(LONGTEXT)
- **Episode**: 카탈로그(시드 데이터) — `code`, `title`, `emoji`, `description`, `scenePromptSeed`
- **CharacterEpisode**: `characterId`, `episode`, `status`(IN_PROGRESS/COMPLETED)

`ddl-auto: update`를 사용 중이므로 엔티티 필드를 추가하면 컬럼이 자동으로 추가된다. 단, **기존 컬럼의
타입을 좁히는 방향으로 바꾸는 경우** Hibernate가 자동으로 처리하지 못할 수 있으니 아래 4장의
"겪었던 버그" 참고.

---

## 4. 구현 중 실제로 겪었던 버그 (재발 방지용 기록)

로컬 MySQL에 직접 붙여서 부팅 → 로그인 → API 호출까지 실제로 테스트하면서 아래 3개 버그를
발견하고 고쳤다. 비슷한 패턴을 다시 만들 때 참고할 것.

1. **`@Lob` + `@Column(nullable = false)`를 같이 쓰면 Hibernate가 `TINYTEXT`(255바이트)로 매핑한다.**
   - `Character.systemPrompt`, `ChatMessage.content`에서 실제로 발생 (`Data truncation` 에러).
   - `@Column`에 length를 안 주면 기본값 255가 적용되는데, `@Lob`이 있어도 이 기본값이 우선 적용되는
     Hibernate 6의 동작 때문. `@Lob`만 단독으로 쓴 필드(`appearance`, `personality` 등)는 문제없이
     `longtext`로 매핑됨.
   - **해결**: `nullable=false`가 필요한 Lob 필드는 반드시
     `@Column(nullable = false, columnDefinition = "LONGTEXT")`를 명시할 것.
   - 다행히 `ddl-auto=update`가 `ALTER TABLE ... MODIFY COLUMN ... LONGTEXT`를 자동으로 실행해줘서
     기존 컬럼도 데이터 손실 없이 넓혀졌다 (MySQL 8.4 + Hibernate 6.6 기준으로 확인됨).

2. **`@ElementCollection` 필드에 `List.of(...)`(불변 리스트)를 넣으면 이후 저장(merge) 시 터진다.**
   - `Character.speechStyles`에 불변 리스트를 할당한 채로 엔티티를 두 번째 저장(update)하면
     Hibernate의 `PersistentBag`이 내부적으로 `.clear()`를 호출하다가
     `UnsupportedOperationException` 발생.
   - **해결**: 엔티티 생성자와 `updateSettings()`에서 항상 `new ArrayList<>(입력값)`으로
     방어적 복사를 하도록 고쳐놨다. **앞으로 `@ElementCollection`/`@OneToMany` 컬렉션 필드에 값을
     넣는 새 코드를 작성할 때, 절대 `List.of(...)`/`Collections.emptyList()` 같은 불변 컬렉션을
     엔티티에 직접 주입하지 말 것.** (엔티티 쪽에서 항상 방어적 복사를 하고 있긴 하지만, 새 엔티티를
     만들 때도 동일 패턴을 유지할 것)

3. **`CommandLineRunner` 안에서 하는 다단계 저장은 반드시 `@Transactional`로 묶을 것.**
   - `DemoDataSeeder`가 처음엔 `@Transactional` 없이 여러 번 `save()`를 호출했는데, 중간에 예외가
     나면 앞쪽 저장(예: User)만 커밋되고 뒤쪽(Character)은 안 되는 반쪽 상태가 남았다.
   - 거기에 더해 "이미 시드했는지" 판단 기준이 `userRepository.existsByEmail(...)`만 보고 있어서,
     반쪽 상태에서 재기동하면 시더가 스킵돼버려 영원히 캐릭터가 안 만들어지는 문제도 있었다.
   - **해결**: `run()` 전체를 `@Transactional`로 묶고, "이미 시드됨" 판단을 "유저가 존재하고 +
     그 유저의 캐릭터가 1개 이상 존재"로 바꿔서 자가 치유(self-healing)되게 함.

---

## 5. 환경 변수 (API 키 등)

`.env.example` 참고. 핵심만 요약:

| 변수 | 용도 | 없을 때 동작 |
|---|---|---|
| `JWT_SECRET` | JWT 서명 키 | 데모 기본값 사용 (운영 전환 시 반드시 교체) |
| `ANTHROPIC_API_KEY` | LLM(Claude) 호출 | 채팅/인터뷰/에피소드/포토부스 프롬프트 생성 요청이 `502 LLM_API_ERROR`로 응답 (앱 전체는 안 죽음) |
| `ANTHROPIC_MODEL` | 사용할 Claude 모델명 | 기본값 `claude-sonnet-4-5` |
| `HIGGSFIELD_API_KEY` / `HIGGSFIELD_API_SECRET` | 이미지 생성 | 캐릭터 컴파일(초상 생성), 포토부스, 얼굴 학습 요청이 `502 IMAGE_API_ERROR`로 응답 |
| `CORS_ALLOWED_ORIGINS` | 프론트 Origin 허용 | 기본값 `http://localhost:3000` |

**데모 계정**: `demo@everyday.app` / `demo1234!` — 앱 최초 기동 시 `DemoDataSeeder`가 자동 생성.
샘플 캐릭터 "서준"(연인·24세·남성)이 이미 만들어져 있어서, 회원가입/캐릭터 생성 플로우를 안 타도
바로 채팅/에피소드/포토부스 시연이 가능하다. (단, 프로필 이미지는 `placehold.co`의 플레이스홀더
이미지 URL이고, systemPrompt는 실제 LLM 호출 없이 하드코딩된 값이다.)

---

## 6. 나중에 실제 LLM/이미지 API로 "갈아끼울" 때 알아둘 것

### LLM (`com.everyday.backend.llm`)
- 지금은 **Anthropic Claude Messages API**(`AnthropicLlmClient`)로 구현되어 있다.
- 다른 벤더로 바꾸려면 `LlmClient` 인터페이스(`generate(systemPrompt, messages)`)만 구현하는
  새 `@Component`를 만들고, 기존 `AnthropicLlmClient`의 `@Component`를 제거(또는
  `@ConditionalOnProperty` 등으로 스위칭)하면 된다. **호출하는 쪽(character/chat/episode/photo
  서비스)은 전혀 수정할 필요 없음** — 전부 `LlmClient` 인터페이스에만 의존하도록 설계했다.
- 현재 JSON 파싱이 필요한 지점(인터뷰 다음 질문, 캐릭터 컴파일, 에피소드 스타터 생성)은 모두
  **"반드시 JSON만 응답하라"는 프롬프트 지시 + 코드펜스 스트리핑(```json 같은 마크다운 wrapping
  제거) + try/catch 후 안전한 fallback**으로 방어되어 있다. 모델을 바꾸면 이 JSON 준수율이
  달라질 수 있으니, 모델 교체 후에는 인터뷰/컴파일/에피소드 시작 플로우를 꼭 다시 수동 테스트할 것.

### 이미지 생성 (`com.everyday.backend.image`)
- 지금은 **Higgsfield API를 가정**하고 "작업 등록(POST /v1/image/generate) → job 폴링(GET
  /v1/jobs/{id})" 형태의 비동기 API로 구현했다 (`HiggsfieldImageClient`).
- **주의: 엔드포인트 경로/요청·응답 필드명/헤더 이름(`hf-api-key`, `hf-secret`)은 실제 Higgsfield
  공식 문서를 보지 않고 일반적인 이미지 생성 API 패턴을 가정해서 작성한 것이다.** 실제 연동 전에
  Higgsfield 공식 API 문서를 보고 `HiggsfieldImageClient.java`의 요청/응답 DTO와 엔드포인트 경로를
  반드시 재확인·수정해야 한다.
- 마찬가지로 `ImageClient` 인터페이스(`generateImages`, `trainSoul`)만 구현하면 다른 이미지 생성
  벤더로 교체 가능하고, 호출하는 쪽(character/photo 서비스)은 수정할 필요 없다.
- 폴링은 2초 간격 최대 30회(총 1분) 후 타임아웃 처리된다. 실제 API의 평균 생성 시간이 이보다
  길다면 `HiggsfieldImageClient`의 `POLL_INTERVAL_MS`/`MAX_POLL_ATTEMPTS` 상수를 조정할 것.

---

## 7. 계정/인증 관련 알아둘 것

- 인증은 **표준 JWT** 방식. `POST /api/auth/signup` → `POST /api/auth/login` 하면
  `accessToken`(Bearer)을 받고, 이후 모든 API(`/api/auth/**`, Swagger 경로 제외)는
  `Authorization: Bearer {accessToken}` 헤더가 필수다.
- Access Token 수명은 `JWT_ACCESS_EXPIRATION_MS`(기본 24시간)이며, **Refresh Token은 구현하지
  않았다** (데모 스코프 밖). 토큰 만료 시 재로그인만 지원한다.
- 인증 실패(토큰 없음/무효) 시 `401`, 본인 소유가 아닌 캐릭터에 접근 시 `403
  FORBIDDEN_CHARACTER_ACCESS`을 반환한다. 프론트에서 이 둘을 구분해서 처리하면 된다.
- 비밀번호는 BCrypt로 해시 저장. 평문 비밀번호는 어디에도 로그/DB에 남지 않는다.
- **새로 계정을 만들 때(회원가입) 유의사항**: `points`는 가입 시 자동으로 1200(`User.DEFAULT_SIGNUP_POINTS`)이 지급된다. 이메일은 유니크 제약이 걸려 있어 중복 가입 시 `409 DUPLICATE_EMAIL`을 반환한다.
- `JWT_SECRET`은 데모 기본값이 코드에 박혀 있다(`application.yaml`의 `${JWT_SECRET:...}` 기본값).
  **운영/공개 배포 전에는 반드시 환경변수로 별도의 강한 시크릿을 주입해야 한다.** 그렇지 않으면
  누구나 기본 시크릿으로 토큰을 위조할 수 있다.

---

## 8. 그 외 알아두면 좋은 설계 결정

- **포인트/구독**: `User.points`만 실제로 차감되는 숫자다. 구독 등급(Free/Day/Plus/Pro)은 백엔드에
  없고, `/api/me` 응답의 `subscriptionTier`는 항상 문자열 `"Free"` 고정값이다. 실제 결제 연동이
  필요해지면 이 부분부터 새로 설계해야 한다.
- **채팅 컨텍스트 윈도우**: 일반 채팅/에피소드 채팅 모두 최근 10개 메시지(대략 5턴)만 LLM에
  넘긴다 (`MAX_CONTEXT_MESSAGES`). 그 이전 대화는 저장은 되지만 AI 응답 생성에는 반영되지 않는다
  (README의 "AI Memory 고도화"가 Future Improvements로 남아있는 이유).
  참고로 위 표기는 `ChatService`/`EpisodeService`/`PhotoService`에 개별 상수로 흩어져 있다.
- **먼저 건네는 인사**: 캐릭터별로 대화 이력이 하나도 없는 상태에서 `GET
  /api/characters/{id}/messages`를 호출하면, 그 순간 LLM을 호출해 인사말을 생성·저장한 뒤
  반환한다 (홈 화면의 "오늘 뭐 했어? 나 하루종일 네 생각했는데 ㅎㅎ" 같은 선톡 연출).
- **포토부스 프롬프트**: 사용자가 고른 컨셉 + 캐릭터 외모 + 최근 대화 분위기(최근 5개 메시지)를
  LLM에 넘겨서 이미지 생성용 영어 프롬프트를 한 번 더 다듬은 뒤 이미지 API를 호출한다
  (`PhotoService.refineImagePrompt`).
- **Swagger UI**: `/swagger-ui.html` (경로는 `application.yaml`의 `springdoc.swagger-ui.path`),
  API 문서 JSON은 `/v3/api-docs`. 둘 다 인증 없이 접근 가능하도록 permitAll 처리되어 있다.
- **CORS**: `CORS_ALLOWED_ORIGINS` 환경변수(콤마 구분)로 허용 Origin을 지정한다. 기본값은
  `http://localhost:3000` 하나뿐이라, 프론트 개발 서버 포트가 다르면 반드시 이 값을 바꿔야 CORS
  에러 없이 붙는다.

---

## 9. 다음에 이어서 할 만한 것 (미구현/의도적 보류)

- Refresh Token / 로그아웃(토큰 무효화) — 현재는 access token만 있고 서버 사이드 무효화 수단이 없음
- 캐릭터 설정 편집 시 "말투 다시 정리하기"처럼 LLM을 다시 호출해 appearance/personality를
  재생성하는 기능 (지금 `PATCH /api/characters/{id}`는 사용자가 준 값을 그대로 반영하고
  systemPrompt만 재생성함, LLM 재호출은 안 함)
   — 참고: 캐릭터 편집 API 자체는 이미 있음 → [character 패키지](src/main/java/com/everyday/backend/character)
- 에피소드 완료 처리(`CharacterEpisode.status`를 `COMPLETED`로 바꾸는 트리거) — 엔티티 필드는
  있지만 이걸 호출하는 API/로직이 아직 없음
- 갤러리/채팅 메시지 페이지네이션 — 지금은 전체를 한 번에 반환 (데모 스코프에서는 데이터량이
  적어 문제없지만 실제 서비스라면 필요)
