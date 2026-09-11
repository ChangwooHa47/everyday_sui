package com.everyday.backend.common.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

@Getter
public enum ErrorCode {

    INVALID_REQUEST(HttpStatus.BAD_REQUEST, "잘못된 요청입니다."),
    UNAUTHORIZED(HttpStatus.UNAUTHORIZED, "인증이 필요합니다."),

    DUPLICATE_EMAIL(HttpStatus.CONFLICT, "이미 가입된 이메일입니다."),
    INVALID_CREDENTIALS(HttpStatus.UNAUTHORIZED, "이메일 또는 비밀번호가 올바르지 않습니다."),

    USER_NOT_FOUND(HttpStatus.NOT_FOUND, "사용자를 찾을 수 없습니다."),
    CHARACTER_NOT_FOUND(HttpStatus.NOT_FOUND, "캐릭터를 찾을 수 없습니다."),
    PHOTO_NOT_FOUND(HttpStatus.NOT_FOUND, "사진을 찾을 수 없습니다."),
    EPISODE_NOT_FOUND(HttpStatus.NOT_FOUND, "에피소드를 찾을 수 없습니다."),
    CHARACTER_EPISODE_NOT_FOUND(HttpStatus.NOT_FOUND, "진행 중인 에피소드를 찾을 수 없습니다."),

    FORBIDDEN_CHARACTER_ACCESS(HttpStatus.FORBIDDEN, "본인의 캐릭터가 아닙니다."),
    INSUFFICIENT_POINTS(HttpStatus.PAYMENT_REQUIRED, "포인트가 부족합니다."),

    LLM_API_ERROR(HttpStatus.BAD_GATEWAY, "AI 응답 생성에 실패했습니다."),
    IMAGE_API_ERROR(HttpStatus.BAD_GATEWAY, "이미지 생성에 실패했습니다.");

    private final HttpStatus status;
    private final String message;

    ErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}
