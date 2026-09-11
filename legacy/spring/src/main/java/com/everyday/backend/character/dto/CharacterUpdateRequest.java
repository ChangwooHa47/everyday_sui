package com.everyday.backend.character.dto;

import java.util.List;

public record CharacterUpdateRequest(String appearance, String personality, List<String> speechStyles) {
}
