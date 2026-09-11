package com.everyday.backend.episode.repository;

import com.everyday.backend.episode.entity.CharacterEpisode;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CharacterEpisodeRepository extends JpaRepository<CharacterEpisode, Long> {

    Optional<CharacterEpisode> findByCharacterIdAndEpisodeId(Long characterId, Long episodeId);
}
