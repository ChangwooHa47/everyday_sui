package com.everyday.backend.character.dto;

import jakarta.validation.constraints.NotBlank;
import java.util.List;

public record InterviewRequest(
        @NotBlank String relationshipType,
        @NotBlank String gender,
        @jakarta.validation.constraints.Size(max = 8000) String freeText,
        @jakarta.validation.Valid @jakarta.validation.constraints.Size(max = 12) List<InterviewAnswer> previousAnswers
) {
}
