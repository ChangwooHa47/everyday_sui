package com.everyday.backend.llm.prompt;

import java.util.List;

/**
 * 캐릭터 엔티티에 대한 의존 없이 system prompt를 구성하기 위한 값 객체.
 */
public record CharacterPersona(
        String name,
        String relationshipType,
        String gender,
        String summary,
        String appearance,
        String personality,
        List<String> speechStyles,
        String callName
) {
}
