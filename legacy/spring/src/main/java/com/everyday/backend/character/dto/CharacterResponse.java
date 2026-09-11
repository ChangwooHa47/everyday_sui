package com.everyday.backend.character.dto;

import com.everyday.backend.character.entity.Character;
import java.time.LocalDate;
import java.util.List;

public record CharacterResponse(
        Long id,
        String name,
        LocalDate birthday,
        int age,
        String relationshipType,
        String gender,
        String summary,
        String appearance,
        String personality,
        List<String> speechStyles,
        String profileImageUrl,
        String callName,
        boolean soulTrained
) {
    public static CharacterResponse from(Character character) {
        return new CharacterResponse(
                character.getId(),
                character.getName(),
                character.getBirthday(),
                character.calculateAge(),
                character.getRelationshipType().getLabel(),
                character.getGender().getLabel(),
                character.getSummary(),
                character.getAppearance(),
                character.getPersonality(),
                character.getSpeechStyles(),
                character.getProfileImageUrl(),
                character.getCallName(),
                character.getSoulId() != null
        );
    }
}
