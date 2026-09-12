package com.everyday.backend.user.dto;

import jakarta.validation.constraints.Email;

public record MyPageUpdateRequest(@Email String email) {
}
