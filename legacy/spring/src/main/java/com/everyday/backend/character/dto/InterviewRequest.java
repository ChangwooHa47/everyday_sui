package com.everyday.backend.character.dto;

import jakarta.validation.constraints.NotBlank;
import java.util.List;

public record InterviewRequest(
        @NotBlank String relationshipType,
        @NotBlank String gender,
        String freeText,
        List<InterviewAnswer> previousAnswers
) {
}
