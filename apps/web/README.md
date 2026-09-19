# @everyday/web

원래 everyday 화면과 경로를 사용하며 서비스명은 Dear Mine이다. 디자인 기반은 [공통 스타일](app/globals.css), [컴포넌트](app/components.tsx), [아이콘](app/icons.tsx), [레이아웃](app/layout.tsx)이다. 비교용 원본 `frontend/app`과는 2026-09-19 리브랜드로 바뀐 워드마크(`.logo` 서체·텍스트)와 제목·태그라인을 제외하고 줄바꿈만 다르며, 원본 체크아웃은 현재 앱의 실행 의존성이 아니다.

- 로그인 버튼은 `로그인`, 성공 후 `/home`이다. 실제 메시지 서명을 서버가 검증한다. 개인키는 저장하지 않는다. 세션은 메모리와 현재 탭의 sessionStorage에 보관하고 계정 변경·연결 해제 시 폐기한다.
- 기존 `/api`는 단일 TypeScript/Fastify 백엔드의 [제품 모듈](../api/src/product)에서 처리한다. 생성·채팅·에피소드·갤러리의 저장 주체는 기존 PostgreSQL이다. 백엔드 이전으로 화면·경로·DTO를 바꾸지 않으며 빈 계정은 홈의 기존 추가 카드에 머문다.
- 기존 커뮤니티 카드를 실제 이용권 카탈로그로 연결한다. 구매자별 대화·호칭·기억은 상품에서 분리한다. 필요한 등록·기억 입력은 기존 캐릭터 설정의 입력/버튼 스타일을 재사용한다.
- 생성·대화·첫 인사·미리보기는 요청 ID로 재시도를 구분한다. 결과가 불확실한 요청을 새 요청으로 자동 제출하지 않는다. 초상 생성 중 새로고침하면 같은 캐릭터와 사진 느낌을 복구한다.
- 사진 생성은 작업 ID로 상태를 조회한다. 같은 SUI 결제 digest의 중복 사용을 막고 작업 상태를 복구한다.

[공개 환경변수 예시](.env.local.example)의 API 주소와 패키지 ID는 API 설정과 맞추고 변경 후 다시 빌드한다. 서버 키를 공개 환경변수에 넣지 않는다. 실행·배포 구성은 [루트 안내](../../README.md)와 [배포 가이드](../../infra/DEPLOYMENT.md)를 따른다.

루트에서 다음 비브라우저 검증을 실행한다.

```powershell
npm.cmd run test:unit --workspace @everyday/web
npm.cmd run typecheck --workspace @everyday/web
npm.cmd run build
```

실제 검증 범위와 미완료 항목은 [배포 리뷰](../../infra/DEPLOYMENT_REVIEW.md)를 따른다. 빌드 성공은 실제 AI·이미지 공급자 호출이나 브라우저 시연의 증거가 아니다.

[비교 모드](BASELINE.md)는 과거 원본 검증용 기록이며 운영에서 사용하지 않는다. 현재 실행·빌드에는 Java·Gradle이 필요하지 않다. [사진 개선 기록](docs/사진-생성-개선-리캡.md)과 [Soul 스타일 목록](docs/soul-스타일-전체목록.md)은 원본에서 가져온 과거 참고 자료다.
