package com.everyday.backend.user.dto;

import com.everyday.backend.character.dto.CharacterSummaryResponse;
import com.everyday.backend.user.entity.User;
import java.util.List;

public record MyPageResponse(
        Long id,
        String email,
        int points,
        String subscriptionTier,
        List<CharacterSummaryResponse> characters
) {
    public static MyPageResponse of(User user, List<CharacterSummaryResponse> characters) {
        return new MyPageResponse(user.getId(), user.getEmail(), user.getPoints(), "Free", characters);
    }
}
