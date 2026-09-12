package com.everyday.backend.character.dto;

import jakarta.validation.constraints.NotBlank;
import java.time.LocalDate;
import java.util.List;

public record CompileRequest(
        @NotBlank String relationshipType,
        @NotBlank String gender,
        @jakarta.validation.constraints.Size(max = 8000) String freeText,
        @jakarta.validation.Valid @jakarta.validation.constraints.Size(max = 12) List<InterviewAnswer> interviewAnswers,
        @NotBlank @jakarta.validation.constraints.Size(max = 80) String name,
        @jakarta.validation.constraints.PastOrPresent LocalDate birthday,
        boolean deferPortraitGeneration,
        java.util.UUID requestId
) {
}
