# @everyday/web

원래 Everyday 화면과 경로를 사용한다. `app/globals.css`, `components.tsx`, `icons.tsx`, `layout.tsx`는 비교용 원본 `frontend/app`과 줄바꿈을 제외하고 동일하다.

- 로그인 버튼은 `로그인`, 성공 후 `/home`이다. 실제 메시지 서명을 서버가 검증한다. 개인키는 저장하지 않는다. 세션은 메모리와 현재 탭의 sessionStorage에 보관하고 계정 변경·연결 해제 시 폐기한다.
- 기존 `/api`는 인증된 Node gateway → `apps/api/spring`으로 연결한다. 생성·채팅·에피소드·갤러리의 저장 주체는 PostgreSQL이다. 빈 계정은 홈의 기존 추가 카드에 머문다.
- 기존 커뮤니티 카드를 실제 이용권 카탈로그로 연결한다. 구매자별 대화·호칭·기억은 상품에서 분리한다. 필요한 등록·기억 입력은 기존 캐릭터 설정의 입력/버튼 스타일을 재사용한다.
- 사진 생성은 작업 ID로 상태를 조회한다. 같은 요청의 중복 차감을 막고 실패 시 환불한다.

`NEXT_PUBLIC_LEGACY_BASELINE=1`은 원래 Spring 비교 테스트 전용이다. 운영에서 사용하지 않는다. 서버 키를 공개 환경변수에 넣지 않는다.

루트 `npm run build`, `npm run test:unit --workspace @everyday/web`으로 비브라우저 검증을 실행한다. 이번 작업에서는 사용자 지시에 따라 브라우저 테스트를 실행하지 않았다.

실제 검증 범위와 미완료 항목은 [배포 리뷰](../../infra/DEPLOYMENT_REVIEW.md)를 따른다. 빌드 성공을 실제 로그인·AI 호출·두 환경 UI 검증으로 표현하지 않는다.
