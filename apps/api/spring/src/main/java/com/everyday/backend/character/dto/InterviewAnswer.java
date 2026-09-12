package com.everyday.backend.character.dto;

import jakarta.validation.constraints.NotBlank;

public record InterviewAnswer(
        @NotBlank @jakarta.validation.constraints.Size(max = 80) String category,
        @NotBlank @jakarta.validation.constraints.Size(max = 1000) String question,
        @NotBlank @jakarta.validation.constraints.Size(max = 2000) String answer
) {
}
