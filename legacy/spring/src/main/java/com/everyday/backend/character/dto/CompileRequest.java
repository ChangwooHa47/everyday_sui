package com.everyday.backend.character.dto;

import jakarta.validation.constraints.NotBlank;
import java.time.LocalDate;
import java.util.List;

public record CompileRequest(
        @NotBlank String relationshipType,
        @NotBlank String gender,
        String freeText,
        List<InterviewAnswer> interviewAnswers,
        @NotBlank String name,
        LocalDate birthday
) {
}
