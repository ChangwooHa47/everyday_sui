package com.everyday.backend.chat.dto;

import jakarta.validation.constraints.NotBlank;

public record SendMessageRequest(@NotBlank @jakarta.validation.constraints.Size(max = 8000) String content, java.util.UUID requestId) {
}
