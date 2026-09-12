package com.everyday.backend.character.dto;

import com.everyday.backend.character.entity.Character;

public record CharacterSummaryResponse(
        Long id,
        String name,
        int age,
        String gender,
        String relationshipType,
        String profileImageUrl
) {
    public static CharacterSummaryResponse from(Character character) {
        return new CharacterSummaryResponse(
                character.getId(),
                character.getName(),
                character.calculateAge(),
                character.getGender().getLabel(),
                character.getRelationshipType().getLabel(),
                character.getProfileImageUrl()
        );
    }
}
