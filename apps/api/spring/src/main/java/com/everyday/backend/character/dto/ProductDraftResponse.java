package com.everyday.backend.character.dto;

import com.everyday.backend.character.entity.Character;
import java.util.List;

/** An explicit allowlist: never export callName, prompts, chats, memories, user or Soul credentials. */
public record ProductDraftResponse(String name, String personality, String summary, String appearance,
        List<String> speechStyles, String imageUrl, List<Example> examples, String gender, String relationshipType) {
    public record Example(String role, String content) {}
    public static ProductDraftResponse from(Character character) {
        return new ProductDraftResponse(character.getName(), character.getPersonality(), character.getSummary(),
                character.getAppearance(), List.copyOf(character.getSpeechStyles()), character.getProfileImageUrl(),
                character.getAuthoredExamples().stream().map(e -> new Example(e.getRole(), e.getContent())).toList(),
                character.getGender().getLabel(), character.getRelationshipType().getLabel());
    }
}
