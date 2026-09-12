package com.everyday.backend.auth.dto;

public record TokenResponse(String accessToken, String tokenType, long expiresInMs) {

    public static TokenResponse of(String accessToken, long expiresInMs) {
        return new TokenResponse(accessToken, "Bearer", expiresInMs);
    }
}
