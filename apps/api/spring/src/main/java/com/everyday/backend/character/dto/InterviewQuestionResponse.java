package com.everyday.backend.character.dto;

import java.util.List;

public record InterviewQuestionResponse(
        String category,
        String question,
        List<String> suggestedAnswers,
        boolean done
) {
}
