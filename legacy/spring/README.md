# Everyday

> 원본 Spring 사본의 과거 문서다. 아래 JWT·MySQL·환경/배포 안내는 현재 운영 설정이 아니다. 실제 운영 소스는 [TypeScript 제품 API](../../apps/api/src/product), 실행은 [루트 README](../../README.md)를 따른다.

> AI Companion 서비스

사용자가 원하는 AI 캐릭터를 생성하고,

캐릭터와 지속적으로 대화하며,

다양한 컨셉의 사진과 추억을 만드는 AI Companion 서비스입니다.

---

# Project Overview

Everyday는 AI 기반 캐릭터 생성부터

AI 채팅,

AI 포토부스,

에피소드 생성까지 하나의 서비스에서 제공하는 AI Companion 플랫폼입니다.

사용자는 AI 인터뷰를 통해 자신만의 캐릭터를 생성하고,

생성된 캐릭터와 자연스럽게 대화하며,

다양한 컨셉의 사진을 생성하고,

AI가 만들어주는 에피소드를 함께 경험할 수 있습니다.

본 프로젝트는 **데모 시연을 목표로 하는 MVP**이며,
핵심 기능 구현에 집중합니다.

---

# Main Features

## AI Character Creation

사용자의 이상형 또는 원하는 캐릭터를 생성합니다.

### Flow

- 자유 입력
- 관계 / 성별 선택
- AI 인터뷰
- 이름 / 생일 입력
- AI 캐릭터 컴파일
- 캐릭터 프로필 생성
- 프로필 이미지 생성

---

## AI Chat

생성된 캐릭터와 자연스럽게 대화합니다.

- 캐릭터 성격 유지
- 최근 대화 기억
- AI 응답 생성
- 채팅 저장

---

## AI Episode

캐릭터와 함께 에피소드를 진행합니다.

- 에피소드 목록
- 장면 생성
- 스타터 제공
- AI 이어쓰기

---

## AI Photo Booth

캐릭터와 함께 다양한 사진을 생성합니다.

- 셀카
- 인생네컷
- 첫 데이트
- 웨딩
- 놀이공원
- 자유 프롬프트

---

## Gallery

생성된 모든 사진을 관리합니다.

- 사진 조회
- 사진 상세
- 다운로드

---

## My Page

사용자 정보를 관리합니다.

- 내 정보
- 캐릭터 조회
- 프로필 수정

---

# MVP Scope

## 구현

- 회원가입
- 로그인
- 캐릭터 생성
- AI 인터뷰
- AI 프로필 생성
- AI 채팅
- 에피소드
- 포토부스
- 갤러리
- 마이페이지

---

## 백엔드 제외

- Community
- 댓글
- 좋아요
- 게시판
- HOT
- 실시간 채팅
- 결제
- 푸시 알림
- AI Memory 고도화

---

# Tech Stack

## Frontend

- Node.js

---

## Backend

- Java 21
- Spring Boot 3
- Spring Data JPA
- Spring Validation
- MySQL
- JWT
- Swagger (OpenAPI)
- Gradle

---

## AI

- LLM API
- Higgsfield API

---

## Development

- VS Code
- Docker
- Dev Container
- GitHub
- Claude Code

---

# Architecture

```
Frontend

↓

REST API

↓

Spring Boot

↓

MySQL

↓

LLM API

↓

Higgsfield API
```

---

# Backend Structure

```
src

├── auth
├── user
├── character
├── chat
├── episode
├── photo
├── gallery
├── llm
├── image
└── common
```

---

# Database

## User

- 회원 정보
- 로그인 정보

---

## Character

- 이름
- 외모
- 성격
- 세계관
- System Prompt
- Image Prompt
- 프로필 이미지

---

## Chat

- 사용자 메시지
- AI 응답
- 대화 저장

---

## Episode

- 제목
- 장면
- 대화

---

## Photo

- 사진 타입
- Prompt
- Image URL

---

# Core Workflow

## Character Creation

```
사용자 입력

↓

AI 인터뷰

↓

LLM

↓

외모 생성

↓

성격 생성

↓

세계관 생성

↓

System Prompt 생성

↓

Image Prompt 생성

↓

Higgsfield

↓

프로필 이미지 생성

↓

DB 저장

↓

캐릭터 생성 완료
```

---

## AI Chat

```
사용자 메시지

↓

최근 5개의 대화 조회

↓

Character System Prompt

+

최근 대화(Context)

↓

LLM

↓

AI 응답 생성

↓

채팅 저장

↓

사용자 반환
```

---

## Episode

```
사용자 선택

↓

Episode 생성

↓

LLM

↓

장면 생성

↓

사용자 진행
```

---

## Photo Booth

```
사진 컨셉 선택

↓

Character 정보 조회

↓

최근 5개의 대화 조회

↓

LLM이 이미지 Prompt 생성

↓

Higgsfield

↓

이미지 생성

↓

Gallery 저장

↓

사용자 반환
```

---

# REST API

실제 구현된 엔드포인트 기준이며, Swagger UI(`/swagger-ui.html`)에서 상세 스펙을 확인할 수 있다.
`/api/auth/**`를 제외한 모든 API는 `Authorization: Bearer {accessToken}` 헤더가 필요하다.

## Auth

- POST /api/auth/signup
- POST /api/auth/login

---

## Character

- POST /api/characters/interview
- POST /api/characters/compile
- POST /api/characters/{id}/select-portrait
- GET /api/characters
- GET /api/characters/{id}
- PATCH /api/characters/{id}
- PATCH /api/characters/{id}/call-name
- POST /api/characters/{id}/train-face

---

## Chat

- GET /api/characters/{id}/messages
- POST /api/characters/{id}/messages

---

## Episode

- GET /api/episodes
- POST /api/characters/{id}/episodes/{episodeId}/start
- GET /api/characters/{id}/episodes/{episodeId}/messages
- POST /api/characters/{id}/episodes/{episodeId}/messages

---

## Photo (포토부스)

- GET /api/photo/concepts
- POST /api/characters/{id}/photos

---

## Gallery

- GET /api/characters/{id}/gallery

---

## MyPage

- GET /api/me
- PATCH /api/me

---

# Development Environment

- Java 21
- Spring Boot 3
- MySQL 8
- Gradle
- VS Code

---

# 환경 변수

로컬/데모 실행 전 아래 환경변수를 설정해야 한다 (예시는 `.env.example` 참고).

| 변수 | 설명 | 기본값 |
| --- | --- | --- |
| `JWT_SECRET` | JWT 서명 키 (운영 배포 시 반드시 교체) | 데모용 기본값 |
| `JWT_ACCESS_EXPIRATION_MS` | Access Token 만료(ms) | 86400000 (24시간) |
| `ANTHROPIC_API_KEY` | Anthropic Claude API 키 (없으면 AI 대화/생성 기능이 오류 응답) | (없음) |
| `ANTHROPIC_MODEL` | 사용할 Claude 모델 | claude-sonnet-4-5 |
| `HIGGSFIELD_API_KEY` / `HIGGSFIELD_API_SECRET` | Higgsfield 이미지 생성 API 키 (없으면 이미지 생성 기능이 오류 응답) | (없음) |
| `CORS_ALLOWED_ORIGINS` | 프론트엔드 Origin (콤마 구분) | http://localhost:3000 |

키가 없어도 인증/캐릭터 CRUD 등 텍스트 기반 API는 정상 동작하며, LLM·이미지 생성이 필요한 요청만 오류를 반환한다.

데모 계정: `demo@everyday.app` / `demo1234!` (앱 최초 기동 시 자동 시드, 샘플 캐릭터 "서준" 포함)

---

# Future Improvements

- AI Memory
- Streaming Chat
- WebSocket
- Multi Language
- Payment
