package com.everyday.backend.episode.dto;

import java.util.List;

public record EpisodeStartResponse(
        Long characterEpisodeId,
        String title,
        String emoji,
        String description,
        String status,
        List<String> starters
) {
}
