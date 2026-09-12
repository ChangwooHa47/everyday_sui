package com.everyday.backend.character.dto;

import java.util.List;

public record CharacterUpdateRequest(
        @jakarta.validation.constraints.Size(max = 4000) String appearance,
        @jakarta.validation.constraints.Size(max = 4000) String personality,
        @jakarta.validation.constraints.Size(max = 20) List<@jakarta.validation.constraints.NotBlank @jakarta.validation.constraints.Size(max = 255) String> speechStyles) {
}
