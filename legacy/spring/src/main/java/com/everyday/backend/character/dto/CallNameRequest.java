package com.everyday.backend.character.dto;

import jakarta.validation.constraints.NotBlank;

public record CallNameRequest(@NotBlank String callName) {
}
