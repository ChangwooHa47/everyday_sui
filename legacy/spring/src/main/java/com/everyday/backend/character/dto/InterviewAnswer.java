package com.everyday.backend.character.dto;

import jakarta.validation.constraints.NotBlank;

public record InterviewAnswer(
        @NotBlank String category,
        @NotBlank String question,
        @NotBlank String answer
) {
}
