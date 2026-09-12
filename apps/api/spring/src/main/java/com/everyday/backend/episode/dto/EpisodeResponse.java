package com.everyday.backend.episode.dto;

import com.everyday.backend.episode.entity.Episode;

public record EpisodeResponse(Long id, String code, String title, String emoji, String description) {

    public static EpisodeResponse from(Episode episode) {
        return new EpisodeResponse(
                episode.getId(), episode.getCode(), episode.getTitle(), episode.getEmoji(), episode.getDescription());
    }
}
